import UIKit
import CoreGraphics
import CoreText
import CoreImage
import Accelerate

// MixtapeLabelRenderer - the printed cassette label (docs/designs/mixtape.md,
// "The label", v2 decided 2026-10-09). A port of round 3's print treatment
// (scripts/mixtape/build_label_concepts_3.py) to Core Graphics.
//
// One CGImage per track, composed ONCE off the main thread and cached by the
// model, so the per-frame cost of the label is a single image draw. The image
// covers the tape's label paper (measured from the sprite) and is transparent
// over the window capsule, so the window cavity, packs and hubs show through.
//
// Pipeline, all in label-local sprite pixels (about 4K frame pixels):
//   1. paper: the sprite's own label paper, cropped;
//   2. art printed: cover drawn into its box (desaturated 0.9, blacks lifted to
//      5%), any R4 gradient band, multiplied by the white-normalised paper at
//      92%, a soft-light pass of the paper-stock grain, a 1 px soft edge, a
//      faint keyline where the art meets the window cut;
//   3. text as ink: dark ink multiplied, white ink at 90% with the grain in it,
//      ballpoint multiplied; a 0.4 px blur for ink spread. No shadows;
//   4. wear by level (grime; + scuffs; + foxing and yellowed corners);
//   5. clipped to the paper minus the window capsule.
//
// Choice per tape key (FNV-1a, the same hash that picks the shell):
//   layout  = [fit left, fit left, split, fill width][(h / tapeCount) % 4]
//   typeset = [grotesk, condensed, serif, typewriter][(h / (tapeCount * 4)) % 4]
// No art (nil, failed, radio) = the handwritten homemade label.

enum MixtapeLayout: String {
    case fitLeft = "fit-left", split = "split", fillWidth = "fill-width", handwritten = "handwritten"
}

enum MixtapeTypeset: String, CaseIterable {
    case grotesk, condensed, serif, typewriter
}

struct MixtapeLabelStyle: Equatable {
    var layout: MixtapeLayout
    var typeset: MixtapeTypeset

    static let layoutWheel: [MixtapeLayout] = [.fitLeft, .fitLeft, .split, .fillWidth]

    /// Stable per key across launches: pure FNV-1a, no process state.
    static func pick(key: String, tapeCount: Int) -> MixtapeLabelStyle {
        let h = fnv1a32(key)
        let n = UInt32(max(1, tapeCount))
        return MixtapeLabelStyle(layout: layoutWheel[Int((h / n) % 4)],
                                 typeset: MixtapeTypeset.allCases[Int((h / (n &* 4)) % 4)])
    }
}

struct MixtapeLabelImage {
    let image: UIImage
    /// The label paper, as fractions of the tape sprite (0..1).
    let paper: CGRect
    let style: MixtapeLabelStyle
    let inks: [String]
    let millis: Double
    var handwritten: Bool { style.layout == .handwritten }
}

struct MixtapeLabelInput {
    var tape: MixtapeTape
    var tapeCount: Int
    var key: String
    var title: String
    var artist: String
    var album: String        // already resolved: station name for radio, "" to omit
    var art: CGImage?
    var sprite: CGImage
}

enum MixtapeLabelRenderer {

    // MARK: - Fonts

    struct Face {
        let name: String
        let caps: Bool
        let tracking: CGFloat   // em
    }

    struct Typeface {
        let title: Face, sub: Face, album: Face
        var handScale: CGFloat? = nil
    }

    // Candidates per typeset, first fully installed one wins. tvOS ships no
    // Avenir Next Condensed (checked on the tvOS 26.5 runtime), so the
    // condensed caps voice falls back to Futura Condensed there.
    private static let wanted: [MixtapeTypeset: [Typeface]] = [
        .grotesk: [Typeface(title: Face(name: "HelveticaNeue-Bold", caps: false, tracking: 0),
                           sub: Face(name: "HelveticaNeue", caps: false, tracking: 0),
                           album: Face(name: "HelveticaNeue", caps: false, tracking: 0))],
        .condensed: [Typeface(title: Face(name: "AvenirNextCondensed-DemiBold", caps: true, tracking: 0.06),
                              sub: Face(name: "AvenirNextCondensed-Medium", caps: false, tracking: 0.01),
                              album: Face(name: "AvenirNextCondensed-Medium", caps: true, tracking: 0.08)),
                     Typeface(title: Face(name: "Futura-CondensedExtraBold", caps: true, tracking: 0.05),
                              sub: Face(name: "Futura-CondensedMedium", caps: false, tracking: 0.01),
                              album: Face(name: "Futura-CondensedMedium", caps: true, tracking: 0.08))],
        .serif: [Typeface(title: Face(name: "Baskerville-SemiBoldItalic", caps: false, tracking: 0),
                          sub: Face(name: "Baskerville", caps: false, tracking: 0),
                          album: Face(name: "Baskerville-Italic", caps: false, tracking: 0)),
                 Typeface(title: Face(name: "Georgia-Italic", caps: false, tracking: 0),
                          sub: Face(name: "Georgia", caps: false, tracking: 0),
                          album: Face(name: "Georgia-Italic", caps: false, tracking: 0))],
        .typewriter: [Typeface(title: Face(name: "AmericanTypewriter-Semibold", caps: false, tracking: 0),
                               sub: Face(name: "AmericanTypewriter", caps: false, tracking: 0),
                               album: Face(name: "AmericanTypewriter", caps: false, tracking: 0))],
    ]
    private static let grotesk = wanted[.grotesk]![0]

    static let hand = Typeface(title: Face(name: HandFont.postScriptName, caps: false, tracking: 0),
                               sub: Face(name: HandFont.postScriptName, caps: false, tracking: 0),
                               album: Face(name: HandFont.postScriptName, caps: false, tracking: 0),
                               handScale: 1.5)

    /// Every typeset checked with UIFont(name:) once; a typeset with any face
    /// missing falls back to the grotesk as a whole.
    static let fontReport: (faces: [MixtapeTypeset: Typeface], lines: [String]) = {
        var out: [MixtapeTypeset: Typeface] = [:]
        var lines: [String] = []
        for ts in MixtapeTypeset.allCases {
            var missed: [String] = []
            for t in wanted[ts] ?? [] {
                let names = [t.title.name, t.sub.name, t.album.name]
                let missing = Set(names.filter { UIFont(name: $0, size: 12) == nil })
                if missing.isEmpty {
                    out[ts] = t
                    break
                }
                missed += missing.sorted()
            }
            let missNote = missed.isEmpty ? "" : "; missing \(missed.joined(separator: ", "))"
            if let t = out[ts] {
                let names = Set([t.title.name, t.sub.name, t.album.name]).sorted()
                lines.append("\(ts.rawValue): \(names.joined(separator: ", "))\(missNote)")
            } else {
                out[ts] = grotesk
                lines.append("\(ts.rawValue): using grotesk\(missNote)")
            }
        }
        let caveat = UIFont(name: HandFont.postScriptName, size: 12) != nil
        lines.append("handwritten: \(caveat ? "OK" : "MISSING") (\(HandFont.postScriptName))")
        return (out, lines)
    }()

    private static func typeface(_ ts: MixtapeTypeset) -> Typeface {
        fontReport.faces[ts] ?? grotesk
    }

    private static let capRatioLock = NSLock()
    nonisolated(unsafe) private static var capRatios: [String: CGFloat] = [:]

    private static func capRatio(_ name: String) -> CGFloat {
        capRatioLock.lock(); defer { capRatioLock.unlock() }
        if let r = capRatios[name] { return r }
        let f = CTFontCreateWithName(name as CFString, 200, nil)
        let r = max(0.3, CTFontGetCapHeight(f) / 200)
        capRatios[name] = r
        return r
    }

    /// A size in Helvetica Neue Bold "cap units" (round 3's px) to a CTFont
    /// with the same cap height in this face; the hand face scales instead.
    private static func font(_ face: Face, px: CGFloat, tf: Typeface) -> CTFont {
        let size: CGFloat
        if let s = tf.handScale { size = px * s }
        else { size = px * capRatio("HelveticaNeue-Bold") / capRatio(face.name) }
        return CTFontCreateWithName(face.name as CFString, max(8, size.rounded()), nil)
    }

    private static func line(_ text: String, _ f: CTFont, _ tracking: CGFloat) -> CTLine {
        var attrs: [NSAttributedString.Key: Any] = [
            .font: f,
            NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]
        if tracking != 0 { attrs[.kern] = tracking * CTFontGetSize(f) }
        return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    }

    private static func width(_ text: String, _ f: CTFont, _ tr: CGFloat) -> CGFloat {
        CGFloat(CTLineGetTypographicBounds(line(text, f, tr), nil, nil, nil))
    }

    private static func ellipsize(_ text: String, _ f: CTFont, _ tr: CGFloat, _ maxW: CGFloat) -> String {
        var t = text
        while !t.isEmpty && width(t.trimmingCharacters(in: .whitespaces) + "\u{2026}", f, tr) > maxW {
            t.removeLast()
        }
        return t.trimmingCharacters(in: .whitespaces) + "\u{2026}"
    }

    /// One line, shrink to 70%, then ellipsis. wrap = true: two balanced
    /// lines before shrinking (hand down to 60%, typeset down to 70%), then
    /// the greedy first line and an ellipsised second. A typeset Block with
    /// wrapTitle may shrink further as a whole before it accepts that
    /// ellipsis (Block.layout, kMinUncut).
    private static func fit(_ raw: String, _ face: Face, px: CGFloat, tf: Typeface, maxW: CGFloat,
                            wrap: Bool) -> ([String], CTFont) {
        let text = face.caps ? raw.uppercased() : raw
        let tr = face.tracking
        if wrap {
            let floor: CGFloat = tf.handScale != nil ? 0.6 : 0.7
            let f0 = font(face, px: px, tf: tf)
            if width(text, f0, tr) <= maxW { return ([text], f0) }
            let words = text.split(separator: " ").map(String.init)
            if words.count > 1 {
                var s = px
                while s >= px * floor {
                    let f = font(face, px: s, tf: tf)
                    var best: (CGFloat, [String])?
                    for i in 1..<words.count {
                        let a = words[..<i].joined(separator: " "), b = words[i...].joined(separator: " ")
                        let wm = max(width(a, f, tr), width(b, f, tr))
                        if wm <= maxW, best == nil || wm < best!.0 { best = (wm, [a, b]) }
                    }
                    if let best { return (best.1, f) }
                    s -= 2
                }
                let f = font(face, px: px * floor, tf: tf)
                var first: [String] = []
                for w in words {
                    if width((first + [w]).joined(separator: " "), f, tr) > maxW { break }
                    first.append(w)
                }
                let rest = words[first.count...].joined(separator: " ")
                let second = width(rest, f, tr) > maxW ? ellipsize(rest, f, tr, maxW) : rest
                return (first.isEmpty ? [ellipsize(text, f, tr, maxW)] : [first.joined(separator: " "), second], f)
            }
        }
        var s = px
        while s >= px * 0.7 {
            let f = font(face, px: s, tf: tf)
            if width(text, f, tr) <= maxW { return ([text], f) }
            s -= 2
        }
        let f = font(face, px: px * 0.7, tf: tf)
        return ([width(text, f, tr) > maxW ? ellipsize(text, f, tr, maxW) : text], f)
    }

    // MARK: - Blocks (round 3's Block)

    enum Role { case title, sub, album }
    enum Align { case left, right, center }
    enum Ink: Equatable { case dark, white, ballpoint }

    struct Laid { var text: String; var font: CTFont; var tracking: CGFloat; var x: CGFloat; var baseline: CGFloat }

    final class Block {
        let name: String
        let lines: [(String, Role, CGFloat)]
        let box: CGRect                // y down, label px
        var align: Align = .left
        var tf: Typeface
        var wrapTitle = false
        /// The artist may wrap to two lines, but only when the title took one.
        var wrapSub = false
        var baselines: [CGFloat]?      // fixed baselines (handwritten)
        var forced: Ink?
        var laid: [Laid] = []
        var bbox: CGRect = .zero
        var minContrast: Double { lines.allSatisfy { $0.1 == .album } ? 4.5 : 3.0 }

        init(_ name: String, _ lines: [(String, Role, CGFloat)], _ box: CGRect, tf: Typeface) {
            self.name = name; self.lines = lines; self.box = box; self.tf = tf
        }

        private func face(_ r: Role) -> Face { r == .title ? tf.title : (r == .sub ? tf.sub : tf.album) }

        /// Typeset wrap blocks (Fit left, Split): the whole block keeps
        /// scaling down to this before a title ellipsis is accepted, so a
        /// long title wraps, then shrinks, and only then ellipsises.
        static let kMinUncut: CGFloat = 0.75

        func layout() {
            let hand = tf.handScale != nil
            let avoidCut = wrapTitle && baselines == nil && !hand
            var k: CGFloat = 1
            var out: [(String, CTFont, CGFloat, Bool)] = []
            var base: [CGFloat] = []
            var fallback: ([(String, CTFont, CGFloat, Bool)], [CGFloat])?
            for _ in 0..<50 {
                out = []
                var titleLines = 0
                var titleCut = false
                for (text, role, px) in lines where !text.isEmpty {
                    let fc = face(role)
                    let wrap = (role == .title && wrapTitle) || (role == .sub && wrapSub && titleLines <= 1)
                    let (ls, f) = MixtapeLabelRenderer.fit(text, fc, px: px * k, tf: tf, maxW: box.width,
                                                           wrap: wrap)
                    if role == .title {
                        titleLines = ls.count
                        titleCut = (ls.last?.hasSuffix("\u{2026}") ?? false) && !text.hasSuffix("\u{2026}")
                    }
                    for (j, t) in ls.enumerated() { out.append((t, f, fc.tracking, j > 0)) }
                }
                guard !out.isEmpty else { return }
                base = [CTFontGetCapHeight(out[0].1)]
                var yb = base[0]
                for i in 1..<out.count {
                    let cur = out[i], prev = out[i - 1]
                    let lead: CGFloat = hand ? (cur.3 ? 0.05 : 0.12) : (cur.3 ? 0.14 : 0.30)
                    yb += CTFontGetDescent(prev.1) * 0.55 + CTFontGetSize(cur.1) * lead + CTFontGetCapHeight(cur.1)
                    base.append(yb)
                }
                let hgt = yb + CTFontGetDescent(out[out.count - 1].1) * 0.55
                if baselines != nil || hgt <= box.height {
                    let top = box.minY + (box.height - hgt) / 2
                    base = base.map { $0 + top }
                    if avoidCut && titleCut {
                        // Fits, but the title is cut: remember this, try smaller.
                        if fallback == nil { fallback = (out, base) }
                        if k * 0.96 >= Self.kMinUncut { k *= 0.96; continue }
                        (out, base) = fallback!
                    }
                    break
                }
                k *= 0.96
            }
            if let bl = baselines {
                base = out.indices.map { bl[min($0, bl.count - 1)] }
            }
            laid = []
            var bb: CGRect?
            for (i, o) in out.enumerated() {
                let w = MixtapeLabelRenderer.width(o.0, o.1, o.2)
                let x = align == .left ? box.minX : (align == .right ? box.maxX - w : box.midX - w / 2)
                laid.append(Laid(text: o.0, font: o.1, tracking: o.2, x: x, baseline: base[i]))
                let cap = CTFontGetCapHeight(o.1), desc = CTFontGetDescent(o.1)
                let r = CGRect(x: x, y: base[i] - cap * 1.02, width: w, height: cap * 1.02 + max(4, desc * 0.6))
                bb = bb.map { $0.union(r) } ?? r
            }
            bbox = bb ?? .zero
        }
    }

    // MARK: - Shared assets

    private static let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
    private static let gray = CGColorSpaceCreateDeviceGray()
    private static let ci = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                .outputColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                .cacheIntermediates: false])

    private static func tex(_ name: String) -> CGImage? {
        guard let url = MixtapeManifest.fileURL("label/\(name).png") else { return nil }
        return UIImage(contentsOfFile: url.path)?.cgImage
    }
    private static let grainAged = tex("grain-aged")
    private static let grainCream = tex("grain-cream")
    private static let grime = tex("grime")
    private static let scuff = tex("scuff")
    private static let foxing = tex("foxing")

    /// sRGB 8-bit -> linear, for WCAG relative luminance.
    private static let lin: [Double] = (0..<256).map { i in
        let c = Double(i) / 255
        return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    private static func relLum(_ r: Double, _ g: Double, _ b: Double) -> Double {
        func l(_ c: Double) -> Double { let x = min(1, max(0, c)); return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
        return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b)
    }

    private static func contrast(_ a: Double, _ b: Double) -> Double {
        (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    // MARK: - Paper (measured once per tape, cached)

    struct Paper {
        let rect: CGRect          // sprite px, y down
        let crop: CGImage
        let normalised: CGImage   // paper / its white level
        let white: Double
        let tint: (Double, Double, Double)   // median paper colour / white
        let warm: Bool
    }

    private static let paperLock = NSLock()
    nonisolated(unsafe) private static var papers: [String: Paper] = [:]

    private static func paper(for t: MixtapeTape, sprite: CGImage) -> Paper? {
        paperLock.lock()
        if let p = papers[t.id] { paperLock.unlock(); return p }
        paperLock.unlock()
        guard let L = t.labelRect, let Wn = t.windowRect else { return nil }
        let sw = CGFloat(sprite.width), sh = CGFloat(sprite.height)
        let sx = sw / CGFloat(t.spriteRect.w), sy = sh / CGFloat(t.spriteRect.h)
        func px(_ r: NRect) -> CGRect {
            CGRect(x: (r.x - t.spriteRect.x) * sx, y: (r.y - t.spriteRect.y) * sy, width: r.w * sx, height: r.h * sy)
        }
        var lr = px(L).integral.intersection(CGRect(x: 0, y: 0, width: sw, height: sh))
        let wr = px(Wn)
        // Sprite pixels, for the measurement.
        let bm = Bitmap(Int(sw), Int(sh))
        bm.ctx.draw(sprite, in: CGRect(x: 0, y: 0, width: sw, height: sh))
        func lum(_ x: Int, _ y: Int) -> Double {
            let p = bm.px(x, y); return (Double(p.0) + Double(p.1) + Double(p.2)) / 765
        }
        // The printed paper can start above labelRect on a dark shell (round
        // 1's paper_rect): walk up a column from inside the strip while the
        // pixels stay paper-light. Accept at most 60 px of extension.
        let cx = Int(lr.minX + 60), cy = Int((lr.minY + wr.minY) / 2)
        var ref = 0.0
        for dy in -4...4 { for dx in -4...4 { ref += lum(cx + dx, cy + dy) } }
        ref /= 81
        var y = cy
        // 0.35: the top few mm of paper sit in the shell's shadow (TDK: 95 vs 160).
        while y > 0 && lum(cx, y - 1) > ref * 0.35 { y -= 1 }
        if CGFloat(y) < lr.minY && CGFloat(y) >= lr.minY - 60 {
            lr = CGRect(x: lr.minX, y: CGFloat(y), width: lr.width, height: lr.maxY - CGFloat(y))
        }
        // White level: 95th percentile of the paper's mean value; median tint.
        var hist = [Int](repeating: 0, count: 256)
        let x0 = Int(lr.minX) + 8, x1 = Int(lr.maxX) - 8, y0 = Int(lr.minY) + 8, y1 = Int(wr.minY) - 8
        if x1 > x0 && y1 > y0 {
            for yy in stride(from: y0, to: y1, by: 2) {
                for xx in stride(from: x0, to: x1, by: 2) {
                    let p = bm.px(xx, yy)
                    hist[(Int(p.0) + Int(p.1) + Int(p.2)) / 3] += 1
                }
            }
        }
        let white = max(0.3, Double(percentile(hist, 0.95)) / 255)
        var acc = (0.0, 0.0, 0.0), n = 0.0
        if x1 > x0 && y1 > y0 {
            for yy in stride(from: y0, to: y1, by: 3) {
                for xx in stride(from: x0, to: x1, by: 3) {
                    let p = bm.px(xx, yy)
                    let m = (Double(p.0) + Double(p.1) + Double(p.2)) / 765
                    if m > 0.6 * white {
                        acc.0 += Double(p.0); acc.1 += Double(p.1); acc.2 += Double(p.2); n += 1
                    }
                }
            }
        }
        n = max(1, n)
        let tint = (min(1, acc.0 / n / 255 / white), min(1, acc.1 / n / 255 / white), min(1, acc.2 / n / 255 / white))
        let warmth = (acc.0 - acc.2) / n / 255 / white
        guard let crop = sprite.cropping(to: lr) else { return nil }
        let k = CGFloat(1 / white)
        let ciImg = CIImage(cgImage: crop).applyingFilter("CIColorMatrix", parameters: [
            "inputRVector": CIVector(x: k, y: 0, z: 0, w: 0),
            "inputGVector": CIVector(x: 0, y: k, z: 0, w: 0),
            "inputBVector": CIVector(x: 0, y: 0, z: k, w: 0),
        ])
        let norm = ci.createCGImage(ciImg, from: ciImg.extent, format: .RGBA8, colorSpace: srgb) ?? crop
        let p = Paper(rect: lr, crop: crop, normalised: norm, white: white, tint: tint, warm: warmth > 0.30)
        paperLock.lock(); papers[t.id] = p; paperLock.unlock()
        return p
    }

    private static func percentile(_ hist: [Int], _ q: Double) -> Int {
        let total = hist.reduce(0, +)
        guard total > 0 else { return 255 }
        let target = Int(Double(total) * q)
        var run = 0
        for (i, c) in hist.enumerated() { run += c; if run >= target { return i } }
        return hist.count - 1
    }

    // MARK: - Render

    /// Builds the whole label. Call off the main thread.
    static func render(_ input: MixtapeLabelInput) -> MixtapeLabelImage? {
        let t0 = Date()
        guard let paper = paper(for: input.tape, sprite: input.sprite) else { return nil }
        var style = MixtapeLabelStyle.pick(key: input.key, tapeCount: input.tapeCount)
        if input.art == nil { style.layout = .handwritten }
        let job = Job(input: input, paper: paper, style: style)
        guard let img = job.run() else { return nil }
        let sw = CGFloat(input.sprite.width), sh = CGFloat(input.sprite.height)
        let pr = paper.rect
        return MixtapeLabelImage(image: UIImage(cgImage: img),
                                 paper: CGRect(x: pr.minX / sw, y: pr.minY / sh, width: pr.width / sw, height: pr.height / sh),
                                 style: style, inks: job.inkLog,
                                 millis: Date().timeIntervalSince(t0) * 1000)
    }

    // One label's working state (round 3's Label).
    private final class Job {
        let input: MixtapeLabelInput
        let paper: Paper
        let style: MixtapeLabelStyle
        let w: Int, h: Int
        let W: CGFloat, H: CGFloat
        let win: CGRect            // label px, y down
        let seed: UInt64
        var artRect: CGRect?       // where the art image is drawn (may overflow), y down
        var artClip: CGRect?       // the art's visible box, y down
        var art: CGImage?
        var artMask: CGImage?
        var blocks: [Block] = []
        var marks: [CGFloat] = []  // ruled-line ys (handwritten)
        var bands: [String: Band] = [:]
        var inkLog: [String] = []
        var decisions: [Ink] = []
        var dominant: (Double, Double, Double) = (0.1, 0.1, 0.1)

        struct Band { var alpha: Double; var mode: String; var rgb: (Double, Double, Double); var y0: CGFloat; var y1: CGFloat; var blocks: Set<String> }

        static let pad: CGFloat = 40
        static let darkInk: (CGFloat, CGFloat, CGFloat) = (0.075, 0.07, 0.08)
        static let ballpoint: (CGFloat, CGFloat, CGFloat) = (0x1d / 255.0, 0x2a / 255.0, 0x6b / 255.0)
        static let whiteOpacity = 0.90
        static let busyMax = 0.035

        init(input: MixtapeLabelInput, paper: Paper, style: MixtapeLabelStyle) {
            self.input = input; self.paper = paper; self.style = style
            w = paper.crop.width; h = paper.crop.height
            W = CGFloat(w); H = CGFloat(h)
            let t = input.tape, s = input.sprite
            let sx = CGFloat(s.width) / CGFloat(t.spriteRect.w), sy = CGFloat(s.height) / CGFloat(t.spriteRect.h)
            let wr = t.windowRect!
            win = CGRect(x: (wr.x - t.spriteRect.x) * sx - paper.rect.minX,
                         y: (wr.y - t.spriteRect.y) * sy - paper.rect.minY,
                         width: wr.w * sx, height: wr.h * sy)
            seed = UInt64(fnv1a32(t.id + "|" + input.key))
        }

        var stripH: CGFloat { win.minY }
        var bandY: CGFloat { win.maxY }
        func up(_ r: CGRect) -> CGRect { CGRect(x: r.minX, y: H - r.maxY, width: r.width, height: r.height) }
        var full: CGRect { CGRect(x: 0, y: 0, width: W, height: H) }

        // Sizes relative to the strip above the window (round 3: 112 / 66 /
        // 46 px at the TDK's 213 px strip), so the title cap height lands
        // around 35 to 55 px at 1080p on every tape.
        var T: CGFloat { min(128, max(96, stripH * 0.526)) }
        var A: CGFloat { T * 0.6 }
        var AL: CGFloat { T * 0.44 }

        var albumText: String {
            let a = input.album.trimmingCharacters(in: .whitespacesAndNewlines)
            if a.isEmpty || a.lowercased() == input.title.trimmingCharacters(in: .whitespaces).lowercased() { return "" }
            return a
        }

        func run() -> CGImage? {
            if let a = input.art { dominant = Job.dominantColour(a) }
            layout()
            for b in blocks { b.layout() }
            let comp = resolveInks()
            applyInk(comp)
            applyWear(comp)
            // Clip to the paper, minus the window capsule.
            let out = Bitmap(w, h)
            let c = out.ctx
            let path = CGMutablePath()
            path.addRoundedRect(in: full, cornerWidth: 22, cornerHeight: 22)
            let wu = up(win)
            path.addRoundedRect(in: wu, cornerWidth: wu.height / 2, cornerHeight: wu.height / 2)
            c.addPath(path)
            c.clip(using: .evenOdd)
            c.draw(comp.image(), in: full)
            return out.image()
        }

        // MARK: Layouts

        func layout() {
            let tf = MixtapeLabelRenderer.typeface(style.typeset)
            let title = input.title.isEmpty ? input.album : input.title
            let pad = Job.pad
            switch style.layout {
            case .fitLeft:
                let side = H - 20
                setArt(cover: CGRect(x: 10, y: 10, width: side, height: side))
                let tx = 10 + side + 44
                let tb = Block("title + artist", [(title, .title, T), (input.artist, .sub, A)],
                               CGRect(x: tx, y: 22, width: W - pad - tx, height: stripH - 40), tf: tf)
                // Long names wrap to two lines before shrinking; the block
                // still scales as a whole to stay above the window.
                tb.wrapTitle = true
                tb.wrapSub = true
                blocks.append(tb)
                blocks.append(albumBlock(x0: tx, align: .left, tf: tf))
                blocks.forEach { $0.forced = .dark }
            case .split:
                let xm = (W / 2).rounded()
                setArt(cover: CGRect(x: 0, y: 0, width: xm, height: H))
                let tb = Block("title + artist", [(title, .title, T - 12), (input.artist, .sub, A - 6)],
                               CGRect(x: xm + 40, y: 20, width: W - pad - xm - 40, height: stripH - 34), tf: tf)
                tb.wrapTitle = true
                tb.wrapSub = true
                blocks.append(tb)
                blocks.append(albumBlock(x0: xm + 40, align: .right, tf: tf))
                blocks.forEach { $0.forced = .dark }
            case .fillWidth:
                if let a = input.art {
                    let ah = W * CGFloat(a.height) / CGFloat(max(1, a.width))
                    art = Job.prepared(a, size: CGSize(width: W, height: ah))
                    artRect = CGRect(x: 0, y: 0, width: W, height: ah)
                    artClip = CGRect(x: 0, y: 0, width: W, height: min(H, ah))
                }
                // Every line centred (Justin, 2026-10-09): title across the
                // top, artist under it, album under the wheels.
                let tb = Block("title + artist", [(title, .title, T + 6), (input.artist, .sub, A)],
                               CGRect(x: pad, y: 20, width: W - 2 * pad, height: stripH - 36), tf: tf)
                tb.align = .center
                blocks.append(tb)
                blocks.append(albumBlock(x0: pad, align: .center, tf: tf))
            case .handwritten:
                layoutHand()
            }
            if let clip = artClip {
                artMask = Job.mask(w, h, blur: 0.7) { c in
                    c.setFillColor(gray: 1, alpha: 1)
                    c.fill(self.up(clip))
                }
            }
        }

        func albumBlock(x0: CGFloat, align: Align, tf: Typeface) -> Block {
            let b = Block("album", [(albumText, .album, AL)],
                          CGRect(x: x0, y: bandY + 12, width: W - Job.pad - x0, height: H - 14 - bandY - 12), tf: tf)
            b.align = align
            return b
        }

        func setArt(cover box: CGRect) {
            guard let a = input.art else { return }
            art = Job.prepared(a, size: box.size, fill: true)
            artRect = box
            artClip = box
        }

        // H1: Caveat in blue ballpoint on printed ruling. A title that does
        // not fit wraps onto the second ruled line; the artist then shares
        // the band under the wheels with the album.
        func layoutHand() {
            let tf = MixtapeLabelRenderer.hand
            let pad = Job.pad
            let sh = stripH
            let bl1 = sh * 0.50, bl2 = sh * 0.86, bl3 = H - 40
            marks = [bl1 + 4, bl2 + 4, H - 36]
            let x0 = pad + 16, maxW = W - pad - x0
            let title = input.title.isEmpty ? albumText : input.title
            let album = input.title.isEmpty ? "" : albumText
            let f = MixtapeLabelRenderer.font(tf.title, px: 118, tf: tf)
            let fits = MixtapeLabelRenderer.width(title, f, 0) <= maxW
            let tb = Block("title", [(title, .title, 118)], CGRect(x: x0, y: 8, width: maxW, height: bl1), tf: tf)
            tb.wrapTitle = true
            tb.baselines = [bl1, bl2]
            if fits || title.split(separator: " ").count < 2 {
                blocks.append(tb)
                if !input.artist.isEmpty {
                    let ab = Block("artist", [(input.artist, .sub, 84)], CGRect(x: x0, y: bl1 + 8, width: maxW, height: bl2 - bl1), tf: tf)
                    ab.baselines = [bl2]
                    blocks.append(ab)
                }
                if !album.isEmpty {
                    let al = Block("album", [(album, .album, 70)], CGRect(x: x0, y: bandY + 8, width: maxW, height: H - 36 - bandY), tf: tf)
                    al.baselines = [bl3]
                    blocks.append(al)
                }
            } else {
                blocks.append(tb)
                let band = [input.artist, album].filter { !$0.isEmpty }.joined(separator: ", ")
                if !band.isEmpty {
                    let al = Block("artist, album", [(band, .album, 70)], CGRect(x: x0, y: bandY + 8, width: maxW, height: H - 36 - bandY), tf: tf)
                    al.baselines = [bl3]
                    blocks.append(al)
                }
            }
            blocks.forEach { $0.forced = .ballpoint }
        }

        // MARK: Art

        /// Cover-fit (or plain scale) to size, desaturated 0.9, blacks lifted
        /// to 5% (ink density: blacks print as dark ink, never void).
        static func prepared(_ img: CGImage, size: CGSize, fill: Bool = false) -> CGImage {
            let bw = max(1, Int(size.width.rounded())), bh = max(1, Int(size.height.rounded()))
            let bm = Bitmap(bw, bh)
            let iw = CGFloat(img.width), ih = CGFloat(img.height)
            var r = CGRect(x: 0, y: 0, width: CGFloat(bw), height: CGFloat(bh))
            if fill {
                let s = max(CGFloat(bw) / iw, CGFloat(bh) / ih)
                r = CGRect(x: (CGFloat(bw) - iw * s) / 2, y: (CGFloat(bh) - ih * s) / 2, width: iw * s, height: ih * s)
            }
            bm.ctx.interpolationQuality = .high
            bm.ctx.draw(img, in: r)
            let k: CGFloat = 0.93
            let out = CIImage(cgImage: bm.image())
                .applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 0.9])
                .applyingFilter("CIColorMatrix", parameters: [
                    "inputRVector": CIVector(x: k, y: 0, z: 0, w: 0),
                    "inputGVector": CIVector(x: 0, y: k, z: 0, w: 0),
                    "inputBVector": CIVector(x: 0, y: 0, z: k, w: 0),
                    "inputBiasVector": CIVector(x: 0.05, y: 0.05, z: 0.05, w: 0),
                ])
            return MixtapeLabelRenderer.ci.createCGImage(out, from: CGRect(x: 0, y: 0, width: bw, height: bh),
                                                         format: .RGBA8, colorSpace: MixtapeLabelRenderer.srgb) ?? bm.image()
        }

        /// Round 2's dominant colour: median of the vivid pixels.
        static func dominantColour(_ img: CGImage) -> (Double, Double, Double) {
            let bm = Bitmap(64, 64)
            bm.ctx.draw(img, in: CGRect(x: 0, y: 0, width: 64, height: 64))
            var vivid: [(Int, Int, Int)] = [], any: [(Int, Int, Int)] = []
            for y in 0..<64 { for x in 0..<64 {
                let p = bm.px(x, y)
                let mx = Int(max(p.0, p.1, p.2)), mn = Int(min(p.0, p.1, p.2))
                let sat = mx == 0 ? 0 : (mx - mn) * 255 / mx
                if sat > 90 && mx > 60 { vivid.append((Int(p.0), Int(p.1), Int(p.2))) }
                if mx > 40 { any.append((Int(p.0), Int(p.1), Int(p.2))) }
            } }
            let set = vivid.count >= 40 ? vivid : (any.isEmpty ? [(25, 25, 25)] : any)
            func med(_ v: [Int]) -> Double { Double(v.sorted()[v.count / 2]) / 255 }
            return (med(set.map { $0.0 }), med(set.map { $0.1 }), med(set.map { $0.2 }))
        }

        // MARK: Compose (paper + printed art + bands + ruling)

        func drawArtAndBands(_ c: CGContext) {
            guard let art, let artRect else { return }
            c.interpolationQuality = .high
            c.draw(art, in: up(artRect))
            for (edge, b) in bands { drawBand(c, edge: edge, b) }
        }

        func compose() -> Bitmap {
            let bm = Bitmap(w, h)
            let c = bm.ctx
            c.draw(paper.crop, in: full)
            if art != nil, let artMask {
                c.saveGState()
                c.clip(to: full, mask: artMask)
                drawArtAndBands(c)
                // Multiply over the white-normalised paper at 92%: the
                // paper's tint carries into the art, yellowed paper warms it.
                c.setBlendMode(.multiply)
                c.setAlpha(0.92)
                c.draw(paper.normalised, in: full)
                // Soft light with the paper-stock grain: fibre in the darks.
                c.setAlpha(1)
                c.setBlendMode(.softLight)
                if let g = paper.warm ? MixtapeLabelRenderer.grainAged : MixtapeLabelRenderer.grainCream {
                    Job.drawTex(c, g, W, H, seed: seed &+ 1, scale: 1.0)
                }
                c.restoreGState()
                // A faint printed keyline where the art meets the window cut.
                c.saveGState()
                c.clip(to: full, mask: artMask)
                let r = up(win).insetBy(dx: -3, dy: -3)
                c.setStrokeColor(CGColor(gray: 0, alpha: 0.22))
                c.setLineWidth(5)
                c.addPath(CGPath(roundedRect: r, cornerWidth: r.height / 2, cornerHeight: r.height / 2, transform: nil))
                c.strokePath()
                c.restoreGState()
            }
            if !marks.isEmpty {
                c.saveGState()
                c.setBlendMode(.multiply)
                c.setStrokeColor(CGColor(srgbRed: 0.55, green: 0.66, blue: 0.86, alpha: 0.55))
                c.setLineWidth(3)
                for y in marks {
                    c.move(to: CGPoint(x: Job.pad, y: H - y))
                    c.addLine(to: CGPoint(x: W - Job.pad, y: H - y))
                }
                c.strokePath()
                c.restoreGState()
            }
            return bm
        }

        func drawBand(_ c: CGContext, edge: String, _ b: Band) {
            let n = 48
            var colors: [CGColor] = [], locs: [CGFloat] = []
            for i in 0...n {
                let y = H * CGFloat(i) / CGFloat(n)
                var a: Double
                if edge == "top" {
                    a = y <= b.y1 ? 1 - 0.15 * Double(y / max(1, b.y1))
                                  : 0.85 * (1 - Job.smooth(Double(b.y1), Double(b.y1) + 120, Double(y)))
                } else {
                    let d = Double(H - y), span = Double(H - b.y0)
                    a = d <= span ? 1 - 0.15 * d / max(1, span) : 0.85 * (1 - Job.smooth(span, span + 120, d))
                }
                a *= b.alpha
                colors.append(CGColor(srgbRed: b.rgb.0, green: b.rgb.1, blue: b.rgb.2, alpha: a))
                locs.append(CGFloat(i) / CGFloat(n))
            }
            guard let g = CGGradient(colorsSpace: MixtapeLabelRenderer.srgb, colors: colors as CFArray, locations: locs) else { return }
            c.drawLinearGradient(g, start: CGPoint(x: 0, y: H), end: CGPoint(x: 0, y: 0), options: [])
        }

        static func smooth(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
            let t = min(1, max(0, (x - e0) / (e1 - e0)))
            return t * t * (3 - 2 * t)
        }

        // MARK: Ink choice (round 3's R1 to R4)

        func inLabel(_ x: Int, _ y: Int) -> Bool {
            let px = CGFloat(x) + 0.5, py = CGFloat(y) + 0.5
            if win.insetBy(dx: -2, dy: -2).contains(CGPoint(x: px, y: py)) {
                // Capsule test.
                let r = win.height / 2 + 2
                let cx = min(max(px, win.minX + r), win.maxX - r)
                let dx = px - cx, dy = py - win.midY
                if dx * dx + dy * dy <= r * r { return false }
            }
            return true
        }

        struct Analysis { var coverage, p10, p90, mean, busy, cWhite, cDark: Double }

        func analyse(_ b: Block, _ comp: Bitmap, _ artOnly: Bitmap?) -> Analysis {
            let x0 = max(0, Int(b.bbox.minX - 10)), y0 = max(0, Int(b.bbox.minY - 10))
            let x1 = min(w, Int(b.bbox.maxX + 10)), y1 = min(h, Int(b.bbox.maxY + 10))
            var lh = [Int](repeating: 0, count: 4096)
            var rh = [Int](repeating: 0, count: 256), gh = rh, bh = rh
            var sum = 0.0, n = 0, inArt = 0
            let lin = MixtapeLabelRenderer.lin
            let clip = artClip ?? .null
            for y in y0..<max(y0, y1) {
                for x in x0..<max(x0, x1) where inLabel(x, y) {
                    let p = comp.px(x, y)
                    let L = 0.2126 * lin[Int(p.0)] + 0.7152 * lin[Int(p.1)] + 0.0722 * lin[Int(p.2)]
                    lh[min(4095, Int(L * 4095))] += 1
                    rh[Int(p.0)] += 1; gh[Int(p.1)] += 1; bh[Int(p.2)] += 1
                    sum += L; n += 1
                    if clip.contains(CGPoint(x: CGFloat(x) + 0.5, y: CGFloat(y) + 0.5)) { inArt += 1 }
                }
            }
            guard n > 0 else { return Analysis(coverage: 0, p10: 1, p90: 1, mean: 1, busy: 0, cWhite: 1, cDark: 21) }
            let p10 = Double(MixtapeLabelRenderer.percentile(lh, 0.10)) / 4095
            let p90 = Double(MixtapeLabelRenderer.percentile(lh, 0.90)) / 4095
            let lw = MixtapeLabelRenderer.relLum(0.887, 0.887, 0.887)   // 90% of 0.93 white over a 0.5 mid
            let cWhite = MixtapeLabelRenderer.contrast(lw, p90)
            let r90 = Double(MixtapeLabelRenderer.percentile(rh, 0.9)) / 255
            let g90 = Double(MixtapeLabelRenderer.percentile(gh, 0.9)) / 255
            let b90 = Double(MixtapeLabelRenderer.percentile(bh, 0.9)) / 255
            let ldOn = MixtapeLabelRenderer.relLum(Double(Job.darkInk.0) * r90, Double(Job.darkInk.1) * g90, Double(Job.darkInk.2) * b90)
            let cDark = MixtapeLabelRenderer.contrast(p10, ldOn)
            let busy = artOnly.map { busyness($0, x0, y0, x1, y1) } ?? 0
            return Analysis(coverage: Double(inArt) / Double(n), p10: p10, p90: p90, mean: sum / Double(n),
                            busy: busy, cWhite: cWhite, cDark: cDark)
        }

        /// Local contrast of the ART behind a block (with any band): mean
        /// absolute band-pass (about 2 px minus 12 px blur) of perceptual
        /// luminance. Paper grain and smooth gradients do not count.
        func busyness(_ art: Bitmap, _ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int) -> Double {
            let rw = x1 - x0, rh = y1 - y0
            guard rw > 4, rh > 4 else { return 0 }
            let lin = MixtapeLabelRenderer.lin
            var src = [UInt8](repeating: 0, count: rw * rh)
            for y in 0..<rh { for x in 0..<rw {
                let p = art.px(x0 + x, y0 + y)
                let L = 0.2126 * lin[Int(p.0)] + 0.7152 * lin[Int(p.1)] + 0.0722 * lin[Int(p.2)]
                src[y * rw + x] = UInt8(min(255, max(0, pow(L, 1 / 2.2) * 255)))
            } }
            var a = [UInt8](repeating: 0, count: rw * rh), b = a
            src.withUnsafeMutableBytes { sp in a.withUnsafeMutableBytes { ap in b.withUnsafeMutableBytes { bp in
                var s = vImage_Buffer(data: sp.baseAddress, height: vImagePixelCount(rh), width: vImagePixelCount(rw), rowBytes: rw)
                var da = vImage_Buffer(data: ap.baseAddress, height: vImagePixelCount(rh), width: vImagePixelCount(rw), rowBytes: rw)
                var db = vImage_Buffer(data: bp.baseAddress, height: vImagePixelCount(rh), width: vImagePixelCount(rw), rowBytes: rw)
                // Tent half-width a has sigma a / sqrt(6): sigma 2 -> 11, sigma 12 -> 59.
                vImageTentConvolve_Planar8(&s, &da, nil, 0, 0, 11, 11, 0, vImage_Flags(kvImageEdgeExtend))
                vImageTentConvolve_Planar8(&s, &db, nil, 0, 0, 59, 59, 0, vImage_Flags(kvImageEdgeExtend))
            } } }
            let clip = artClip ?? .null
            var acc = 0.0, n = 0.0
            for y in 0..<rh { for x in 0..<rw {
                let X = x0 + x, Y = y0 + y
                guard inLabel(X, Y), clip.contains(CGPoint(x: CGFloat(X) + 0.5, y: CGFloat(Y) + 0.5)) else { continue }
                acc += abs(Double(a[y * rw + x]) - Double(b[y * rw + x])) / 255
                n += 1
            } }
            return acc / max(1, n)
        }

        func edge(_ b: Block) -> String { b.bbox.midY < win.midY ? "top" : "bottom" }

        func resolveInks() -> Bitmap {
            var comp = compose()
            for iter in 0..<14 {
                var artOnly: Bitmap?
                if art != nil, style.layout == .fillWidth {
                    let bm = Bitmap(w, h)
                    drawArtAndBands(bm.ctx)
                    artOnly = bm
                }
                var pending = false
                decisions = []
                inkLog = []
                for b in blocks {
                    if let f = b.forced {
                        decisions.append(f)
                        inkLog.append("\(b.name): \(f == .ballpoint ? "ballpoint (fixed; plain paper)" : "paper: dark ink (fixed)")")
                        continue
                    }
                    let e = edge(b)
                    let band = bands[e]
                    let maxed = (band?.alpha ?? 0) >= 0.92
                    let a = analyse(b, comp, artOnly)
                    let target = b.minContrast
                    let tag = String(format: "cover %.2f, white %.2f:1, dark %.2f:1, local %.3f, target %.1f",
                                     a.coverage, a.cWhite, a.cDark, a.busy, target)
                    let banded = band?.blocks.contains(b.name) ?? false
                    func bandTag(_ ink: String) -> String {
                        banded ? String(format: "R4 band (%@, %d%%) then %@ ink", band!.mode, Int(band!.alpha * 100), ink) : ""
                    }
                    if a.coverage < 0.15 {
                        decisions.append(.dark); inkLog.append("\(b.name): R1 paper: dark ink [\(tag)]"); continue
                    }
                    var ink: Ink?
                    if a.busy > Job.busyMax { ink = nil }
                    else if a.cWhite >= target && a.cWhite >= a.cDark { ink = .white }
                    else if a.cDark >= target { ink = .dark }
                    if let ink {
                        decisions.append(ink)
                        let rule = banded ? bandTag(ink == .white ? "white" : "dark")
                                          : (ink == .white ? "R2 white ink on dark art" : "R3 dark ink on light art")
                        inkLog.append("\(b.name): \(rule) [\(tag)]")
                        continue
                    }
                    if !maxed {
                        pending = true
                        let mode = a.cWhite >= a.cDark ? "darken" : "lighten"
                        if var bd = bands[e] {
                            bd.alpha = min(0.92, bd.alpha + 0.08)
                            bd.y0 = min(bd.y0, b.bbox.minY); bd.y1 = max(bd.y1, b.bbox.maxY)
                            bd.blocks.insert(b.name)
                            bands[e] = bd
                        } else {
                            bands[e] = Band(alpha: 0.35, mode: mode, rgb: bandColour(mode),
                                            y0: b.bbox.minY, y1: b.bbox.maxY, blocks: [b.name])
                        }
                        decisions.append(a.cWhite >= a.cDark ? .white : .dark)
                        inkLog.append("\(b.name): pending band [\(tag)]")
                    } else {
                        let best: Ink = a.cWhite >= a.cDark ? .white : .dark
                        decisions.append(best)
                        inkLog.append("\(b.name): R5 best effort (\(best == .white ? "white" : "dark"); band at max) [\(tag)]")
                    }
                }
                if !pending { break }
                comp = compose()
                _ = iter
            }
            return comp
        }

        func bandColour(_ mode: String) -> (Double, Double, Double) {
            if mode == "lighten" { return paper.tint }
            return (min(1, dominant.0 * 0.16 + 0.015), min(1, dominant.1 * 0.16 + 0.015), min(1, dominant.2 * 0.16 + 0.015))
        }

        // MARK: Ink

        func textMask(_ b: Block) -> CGImage {
            Job.mask(w, h, blur: 0.4) { c in
                c.setFillColor(gray: 1, alpha: 1)
                for l in b.laid {
                    let line = MixtapeLabelRenderer.line(l.text, l.font, l.tracking)
                    c.textPosition = CGPoint(x: l.x, y: self.H - l.baseline)
                    CTLineDraw(line, c)
                }
            }
        }

        func applyInk(_ comp: Bitmap) {
            let c = comp.ctx
            for (b, ink) in zip(blocks, decisions) where !b.laid.isEmpty {
                let m = textMask(b)
                c.saveGState()
                c.clip(to: full, mask: m)
                switch ink {
                case .dark:
                    c.setBlendMode(.multiply)
                    c.setFillColor(CGColor(srgbRed: Job.darkInk.0, green: Job.darkInk.1, blue: Job.darkInk.2, alpha: 1))
                    c.fill(full)
                case .ballpoint:
                    c.setBlendMode(.multiply)
                    c.setFillColor(CGColor(srgbRed: Job.ballpoint.0, green: Job.ballpoint.1, blue: Job.ballpoint.2, alpha: 0.94))
                    c.fill(full)
                case .white:
                    // 90% white, warmed a touch by the paper, grain through it.
                    let k = pow((paper.tint.0 + paper.tint.1 + paper.tint.2) / 3, 0.25)
                    c.setFillColor(CGColor(srgbRed: 0.95 * min(1, paper.tint.0 * 0.2 + 0.8) * k,
                                           green: 0.95 * min(1, paper.tint.1 * 0.2 + 0.8) * k,
                                           blue: 0.95 * min(1, paper.tint.2 * 0.2 + 0.8) * k,
                                           alpha: Job.whiteOpacity))
                    c.fill(full)
                    c.setBlendMode(.overlay)
                    if let g = paper.warm ? MixtapeLabelRenderer.grainAged : MixtapeLabelRenderer.grainCream {
                        Job.drawTex(c, g, W, H, seed: seed &+ 1, scale: 1.0)
                    }
                }
                c.restoreGState()
            }
        }

        // MARK: Wear (over art and ink together)

        func applyWear(_ comp: Bitmap) {
            let lvl: Int
            switch input.tape.wear.lowercased() {
            case "heavy": lvl = 2
            case "medium": lvl = 1
            default: lvl = 0
            }
            let c = comp.ctx
            let s = seed
            // Grime: a faint multiply, slightly blue-absorbing, plus a greasy
            // lift toward a paper mid.
            if let g = MixtapeLabelRenderer.grime {
                let m = Job.mask(w, h, blur: 0) { mc in Job.drawTex(mc, g, self.W, self.H, seed: s, scale: 1.45) }
                let k = [0.10, 0.17, 0.24][lvl]
                c.saveGState()
                c.clip(to: full, mask: m)
                c.setBlendMode(.multiply)
                c.setFillColor(CGColor(srgbRed: 0.15, green: 0.05, blue: 0, alpha: k))
                c.fill(full)
                c.setBlendMode(.normal)
                c.setFillColor(CGColor(gray: 0.55, alpha: k * 0.25))
                c.fill(full)
                c.restoreGState()
            }
            // Scuffs: ink rubbed back to bare paper fibre.
            if lvl >= 1, let sc = MixtapeLabelRenderer.scuff {
                let m = Job.mask(w, h, blur: 0) { mc in
                    Job.drawTex(mc, sc, self.W, self.H, seed: s &+ 11, scale: 1.45)
                    if lvl == 2 {
                        mc.setBlendMode(.lighten)
                        mc.setAlpha(0.8)
                        Job.drawTex(mc, sc, self.W, self.H, seed: s &+ 29, scale: 1.45, rotate: true)
                    }
                }
                c.saveGState()
                c.clip(to: full, mask: m)
                c.setAlpha(lvl == 1 ? 0.55 : 0.8)
                c.draw(paper.normalised, in: full)
                c.restoreGState()
            }
            guard lvl == 2 else { return }
            // Foxing spots.
            if let fx = MixtapeLabelRenderer.foxing {
                c.saveGState()
                c.setBlendMode(.multiply)
                c.setAlpha(0.75)
                Job.drawTex(c, fx, W, H, seed: s &+ 5, scale: 1.45)
                c.restoreGState()
            }
            // Yellowed corners and edges.
            let yel = (1.0, 0.86, 0.62)
            func col(_ a: Double) -> CGColor { CGColor(srgbRed: yel.0, green: yel.1, blue: yel.2, alpha: a) }
            c.saveGState()
            c.setBlendMode(.multiply)
            let stops = (0...8).map { Double($0) / 8 }
            if let g = CGGradient(colorsSpace: MixtapeLabelRenderer.srgb,
                                  colors: stops.map { col(0.55 * (1 - Job.smooth(0, 1, $0))) } as CFArray,
                                  locations: stops.map { CGFloat($0) }) {
                for p in [CGPoint(x: 0, y: 0), CGPoint(x: W, y: 0), CGPoint(x: 0, y: H), CGPoint(x: W, y: H)] {
                    c.drawRadialGradient(g, startCenter: p, startRadius: 0, endCenter: p, endRadius: H * 0.75, options: [])
                }
            }
            if let g = CGGradient(colorsSpace: MixtapeLabelRenderer.srgb,
                                  colors: stops.map { col(0.25 * (1 - Job.smooth(0, 1, $0))) } as CFArray,
                                  locations: stops.map { CGFloat($0) }) {
                c.drawLinearGradient(g, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 60, y: 0), options: [])
                c.drawLinearGradient(g, start: CGPoint(x: W, y: 0), end: CGPoint(x: W - 60, y: 0), options: [])
                c.drawLinearGradient(g, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: 60), options: [])
                c.drawLinearGradient(g, start: CGPoint(x: 0, y: H), end: CGPoint(x: 0, y: H - 60), options: [])
            }
            c.restoreGState()
        }

        // MARK: Helpers

        /// A seeded crop of a texture scaled to cover the label (round 3's
        /// tex_region), drawn with the context's current blend and alpha.
        static func drawTex(_ c: CGContext, _ img: CGImage, _ W: CGFloat, _ H: CGFloat, seed: UInt64,
                            scale: CGFloat, rotate: Bool = false) {
            let tw = CGFloat(img.width), th = CGFloat(img.height)
            let s = max(W / tw, H / th) * scale
            let bw = tw * s, bh = th * s
            var rng = SplitMix(seed)
            let ox = CGFloat(rng.next() % UInt64(max(1, Int(bw - W))))
            let oy = CGFloat(rng.next() % UInt64(max(1, Int(bh - H))))
            let r = CGRect(x: -ox, y: H + oy - bh, width: bw, height: bh)
            c.saveGState()
            c.interpolationQuality = .high
            if rotate {
                c.translateBy(x: r.midX, y: r.midY)
                c.rotate(by: .pi / 2)
                c.translateBy(x: -r.midX, y: -r.midY)
            }
            c.draw(img, in: r)
            c.restoreGState()
        }

        /// A DeviceGray mask (white = paint) drawn by `draw`, optionally blurred.
        static func mask(_ w: Int, _ h: Int, blur: CGFloat, _ draw: (CGContext) -> Void) -> CGImage {
            let bm = Bitmap(w, h, gray: true)
            draw(bm.ctx)
            let img = bm.image()
            guard blur > 0 else { return img }
            let ci = CIImage(cgImage: img)
            let out = ci.clampedToExtent().applyingGaussianBlur(sigma: Double(blur)).cropped(to: ci.extent)
            return MixtapeLabelRenderer.ci.createCGImage(out, from: ci.extent, format: .L8,
                                                         colorSpace: MixtapeLabelRenderer.gray) ?? img
        }
    }

    struct SplitMix {
        var s: UInt64
        init(_ seed: UInt64) { s = seed &+ 0x9E3779B97F4A7C15 }
        mutating func next() -> UInt64 {
            s = s &+ 0x9E3779B97F4A7C15
            var z = s
            z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
            z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
            return z ^ (z >> 31)
        }
    }

    /// An 8-bit bitmap context we can read back. RGBA premultiplied sRGB, or
    /// DeviceGray. Row 0 of the memory is the TOP of the image.
    final class Bitmap {
        let w: Int, h: Int
        let ctx: CGContext
        private let bpr: Int
        private let bytes: UnsafeMutablePointer<UInt8>

        init(_ w: Int, _ h: Int, gray: Bool = false) {
            self.w = max(1, w); self.h = max(1, h)
            ctx = CGContext(data: nil, width: self.w, height: self.h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: gray ? MixtapeLabelRenderer.gray : MixtapeLabelRenderer.srgb,
                            bitmapInfo: gray ? CGImageAlphaInfo.none.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue)!
            bpr = ctx.bytesPerRow
            bytes = ctx.data!.assumingMemoryBound(to: UInt8.self)
        }

        func px(_ x: Int, _ y: Int) -> (UInt8, UInt8, UInt8) {
            let i = min(max(0, y), h - 1) * bpr + min(max(0, x), w - 1) * 4
            return (bytes[i], bytes[i + 1], bytes[i + 2])
        }

        func image() -> CGImage { ctx.makeImage()! }
    }
}
