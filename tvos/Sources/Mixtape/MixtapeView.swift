import SwiftUI
import UIKit

// MixtapeView - the cassette-deck Now Playing style (docs/designs/mixtape.md).
// Replaces the mat when musicMatMode == .framed and framedBackdrop == .mixtape.
//
// Layering, back to front:
//   1. deck plate (deck_empty.png): a plain Image OUTSIDE the TimelineView, so
//      it is composited once and never re-rendered per frame;
//   then, inside the TimelineView (the only per-frame subtree):
//   2. the open well (well_open.png), only while a tape or the door is shown,
//      so the door baked into the plate never shows twice;
//   3. the tape group: sprite, pack discs, hub sprites, label content, moving
//      as one unit on eject and insert;
//   4. the door glass, then the door frame, tilted together on the hinge;
//   5. transport key overlays and the VU needles.
// Everything is placed from the normalised manifest; nothing is hand-tuned.

struct MixtapeView: View {
    let state: SonosState
    @ObservedObject var remote: MixtapeRemoteSignal
    @StateObject private var model = MixtapeModel()

    var body: some View {
        GeometryReader { geo in
            let F = MixFrame(fit: geo.size, frameW: model.manifest?.frameW ?? 3840,
                             frameH: model.manifest?.frameH ?? 2160)
            ZStack(alignment: .topLeading) {
                Color.black
                if let deck = model.deckImages {
                    MixtapePlate(image: deck.plate, rect: F.frameRect)
                        .equatable()
                        .transition(.opacity)
                }
                TimelineView(.animation(minimumInterval: nil, paused: model.timelinePaused)) { ctx in
                    MixtapeAnimatedLayer(model: model, now: ctx.date, F: F)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
            .animation(.easeIn(duration: 0.4), value: model.deckImages != nil)
        }
        .ignoresSafeArea()
        .onAppear { model.ingest(state) }
        .onChange(of: state) { _, s in model.ingest(s) }
        .onChange(of: remote.seq) { _, _ in model.press() }
    }
}

// Maps the normalised 3840x2160 frame onto the screen, aspect-fill, centred.
struct MixFrame: Equatable {
    let frameRect: CGRect
    init(fit size: CGSize, frameW: Double, frameH: Double) {
        let s = max(size.width / frameW, size.height / frameH)
        let w = frameW * s, h = frameH * s
        frameRect = CGRect(x: (size.width - w) / 2, y: (size.height - h) / 2, width: w, height: h)
    }
    var W: CGFloat { frameRect.width }
    var H: CGFloat { frameRect.height }
    func x(_ v: Double) -> CGFloat { frameRect.minX + v * W }
    func y(_ v: Double) -> CGFloat { frameRect.minY + v * H }
    func rect(_ r: NRect) -> CGRect { CGRect(x: x(r.x), y: y(r.y), width: r.w * W, height: r.h * H) }
    /// Frame-pixel length (at 3840 wide) to points.
    func px(_ v: Double) -> CGFloat { v * W / 3840 }
}

private struct MixtapePlate: View, Equatable {
    let image: UIImage
    let rect: CGRect
    static func == (a: Self, b: Self) -> Bool { a.image === b.image && a.rect == b.rect }
    var body: some View {
        Image(uiImage: image)
            .resizable()
            .interpolation(.high)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
            .allowsHitTesting(false)
    }
}

// MARK: - The per-frame layer

private struct MixtapeAnimatedLayer: View {
    let model: MixtapeModel
    let now: Date
    let F: MixFrame

    private var deck: MixtapeDeck { model.manifest?.deck ?? .fallback }

    var body: some View {
        let phase = model.phase
        let t = now.timeIntervalSince(model.phaseStart)
        let door = Self.doorOpen(phase: phase, t: t)
        let tape = model.tape(for: model.current)
        let f = model.windFraction(now)
        let driving = phase == .seated && model.playing
        if let tape {
            model.clock.step(now: now, driving: driving, playing: model.playing && phase == .seated,
                             f: f, r0: tape.packMinRadius, R: tape.packMaxRadius)
        } else {
            model.clock.step(now: now, driving: false, playing: false, f: f, r0: 0.03, R: 0.04)
        }
        let showDoor = tape != nil || door > 0.001

        return ZStack(alignment: .topLeading) {
            if let imgs = model.deckImages, showDoor {
                if let well = imgs.wellOpen {
                    let r = F.rect(deck.door)
                    Image(uiImage: well).resizable()
                        .frame(width: r.width, height: r.height)
                        .position(x: r.midX, y: r.midY)
                }
            }

            if let tape, let load = model.current, let imgs = model.tapeImages[tape.id] {
                let m = Self.tapeMotion(phase: phase, t: t, tape: tape)
                let sr = F.rect(tape.spriteRect)
                TapeGroup(tape: tape, load: load, images: imgs,
                          packTexture: model.deckImages?.pack ?? imgs.pack,
                          art: load.artURL.flatMap { model.art[$0] },
                          F: F, angleL: model.clock.angleL, angleR: model.clock.angleR,
                          f: f)
                    .frame(width: sr.width, height: sr.height)
                    .scaleEffect(m.scale)
                    .blur(radius: m.blur * F.px(1))
                    .position(x: sr.midX, y: sr.midY + m.dy * F.H)
            }

            if let imgs = model.deckImages, showDoor {
                doorLayers(imgs, open: door, tapeIn: tape != nil && model.current != nil)
            }

            if let imgs = model.deckImages {
                keyOverlays(imgs)
            }
            vuNeedles()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    // MARK: Door

    // 0 = closed, 1 = fully open.
    static func doorOpen(phase: MixtapeModel.Phase, t: Double) -> Double {
        func ease(_ u: Double) -> Double { let c = min(1, max(0, u)); return c * c * (3 - 2 * c) }
        switch phase {
        case .opening: return ease(t / MixtapeModel.doorTime)
        case .ejecting, .gap, .inserting: return 1
        case .closing: return 1 - ease(t / MixtapeModel.doorTime)
        case .empty, .seated: return 0
        }
    }

    // The door is hinged at the bottom and falls toward the camera. Glass and
    // frame tilt together around the manifest's hinge line; the perspective
    // widens the top edge as it comes forward (the keystone that makes it read
    // as a tilt, not a slide).
    //
    // Smoke: every tape.png already carries the door's smoke (the tapes were
    // photographed behind it), so over a seated tape with the door shut the
    // glass must not darken again. Closed, the glass is drawn with a screen
    // blend: its black smoke drops out and only the bright reflections add.
    // As the door starts to tip, the full (normal) glass fades in over the
    // first quarter of the swing, so a tilting door still reads as smoked.
    @ViewBuilder
    private func doorLayers(_ imgs: MixtapeDeckImages, open: Double, tapeIn: Bool) -> some View {
        let fr = F.frameRect
        let u = min(1, open / 0.25)
        // No tape behind it: the glass keeps its full smoke all the way shut,
        // matching the smoke baked into the empty-well plate it hands over to.
        let smoke = tapeIn ? u * u * (3 - 2 * u) : 1
        if let g = imgs.glass, smoke < 0.999 {
            // Flat (closed) glass, reflections only. Kept outside the rotated
            // group so the screen blend composites against the tape itself.
            Image(uiImage: g).resizable()
                .frame(width: fr.width, height: fr.height)
                .blendMode(.screen)
                .opacity(1 - smoke)
                .position(x: fr.midX, y: fr.midY)
        }
        ZStack {
            if let g = imgs.glass, smoke > 0.001 { Image(uiImage: g).resizable().opacity(smoke) }
            if let fImg = imgs.frame { Image(uiImage: fImg).resizable() }
        }
        .frame(width: fr.width, height: fr.height)
        .rotation3DEffect(.degrees(-72 * open), axis: (x: 1, y: 0, z: 0),
                          anchor: UnitPoint(x: deck.door.midX, y: deck.doorHingeY),
                          perspective: 0.55)
        // A touch darker as it tips away from the lamp above the deck.
        .brightness(-0.18 * open)
        .position(x: fr.midX, y: fr.midY)
    }

    // MARK: Tape motion

    struct Motion { var dy: Double = 0; var scale: Double = 1; var blur: Double = 0 }

    static func tapeMotion(phase: MixtapeModel.Phase, t: Double, tape: MixtapeTape) -> Motion {
        // Distance (fraction of frame height) that clears the tape off the top.
        let out = -(tape.spriteRect.maxY + 0.06)
        switch phase {
        case .ejecting:
            let u = min(1, max(0, t / MixtapeModel.ejectTime))
            // A short lift out of the spindles, then it accelerates away.
            if u < 0.25 {
                return Motion(dy: -0.02 * (u / 0.25), scale: 1 + 0.06 * u, blur: 0)
            }
            let w = (u - 0.25) / 0.75
            return Motion(dy: -0.02 + (out + 0.02) * w * w, scale: 1 + 0.06 * u, blur: 10 * w)
        case .inserting:
            let u = min(1, max(0, t / MixtapeModel.insertTime))
            // Comes down into the well and settles with a small overshoot.
            let c1 = 1.2, c3 = c1 + 1
            let back = 1 + c3 * pow(u - 1, 3) + c1 * pow(u - 1, 2)   // easeOutBack
            let dy = out * (1 - back)
            let speed = max(0, 1 - u / 0.6)
            return Motion(dy: dy, scale: 1 + 0.06 * (1 - min(1, u / 0.7)), blur: 10 * speed)
        case .gap:
            return Motion(dy: out, scale: 1.06, blur: 0)
        default:
            return Motion()
        }
    }

    // MARK: Keys

    @ViewBuilder
    private func keyOverlays(_ imgs: MixtapeDeckImages) -> some View {
        let pressed = model.pressDate.map { now.timeIntervalSince($0) < 0.15 } ?? false
        let playing = model.playing && model.current != nil
        let pausedLatched = model.paused && model.current != nil
        if let r = deck.keyCaps["play"] {
            let cr = F.rect(r)
            let toward: CGFloat = cr.midX < F.frameRect.midX ? 1 : -1
            if pressed, let cap = imgs.caps["play"] {
                Image(uiImage: cap).resizable()
                    .frame(width: cr.width, height: cr.height)
                    .overlay(Color.black.opacity(0.16))
                    .position(x: cr.midX + toward * F.px(2), y: cr.midY + F.px(2))
            }
            if playing { capGlow(cr) }
        }
        if pausedLatched, let r = deck.keyCaps["pause"] {
            capGlow(F.rect(r))
        }
    }

    private func capGlow(_ cr: CGRect) -> some View {
        RoundedRectangle(cornerRadius: F.px(10))
            .fill(LinearGradient(colors: [Color(red: 1, green: 0.72, blue: 0.36).opacity(0.22),
                                          Color(red: 1, green: 0.62, blue: 0.28).opacity(0.06)],
                                 startPoint: .top, endPoint: .bottom))
            .blendMode(.screen)
            .frame(width: cr.width, height: cr.height)
            .position(x: cr.midX, y: cr.midY)
    }

    // MARK: VU needles

    // dB -> degrees from vertical, read off the plate's printed scale.
    static func vuAngle(_ db: Double) -> Double {
        let pts: [(Double, Double)] = [(-20, -26.3), (-10, -17.5), (-5, -8.4), (0, 0), (6, 25)]
        if db <= pts[0].0 { return pts[0].1 }
        for i in 1..<pts.count where db <= pts[i].0 {
            let (a, fa) = pts[i - 1], (b, fb) = pts[i]
            return fa + (fb - fa) * (db - a) / (b - a)
        }
        return pts.last!.1
    }

    @ViewBuilder
    private func vuNeedles() -> some View {
        ForEach(Array(["left", "right"].enumerated()), id: \.offset) { i, side in
            if let face = deck.vuFaces[side], let pivot = deck.vuPivots[side] {
                let dome = deck.vuDomes[side]
                let bottom = (dome?.y ?? face.maxY) - 0.022
                let clip = F.rect(NRect(x: face.x, y: face.y, w: face.w, h: max(0, bottom - face.y)))
                let len = deck.vuArcRadiusH * F.H * 1.05
                let px = F.x(pivot.x) - clip.minX, py = F.y(pivot.y) - clip.minY
                ZStack(alignment: .topLeading) {
                    Capsule()
                        .fill(Color(white: 0.08).opacity(0.85))
                        .frame(width: F.px(5), height: len)
                        .rotationEffect(.degrees(Self.vuAngle(model.clock.vu[i])), anchor: .bottom)
                        .position(x: px, y: py - len / 2)
                }
                .frame(width: clip.width, height: clip.height, alignment: .topLeading)
                .clipped()
                .position(x: clip.midX, y: clip.midY)
            }
        }
    }
}

// MARK: - Tape group

// Everything that rides with the cassette on eject and insert, laid out in the
// sprite's own coordinate space (its frame is the manifest's spriteRect).
private struct TapeGroup: View {
    let tape: MixtapeTape
    let load: MixtapeLoad
    let images: MixtapeTapeImages
    let packTexture: UIImage?
    let art: UIImage?
    let F: MixFrame
    let angleL: Double
    let angleR: Double
    let f: Double

    var body: some View {
        let sr = F.rect(tape.spriteRect)
        func lx(_ v: Double) -> CGFloat { F.x(v) - sr.minX }
        func ly(_ v: Double) -> CGFloat { F.y(v) - sr.minY }
        let radii = MixtapeClock.radii(f: f, r0: tape.packMinRadius, R: tape.packMaxRadius)
        let hubD = 2 * tape.hubRadius * F.W

        return ZStack(alignment: .topLeading) {
            Image(uiImage: images.sprite).resizable()
                .frame(width: sr.width, height: sr.height)

            // Tape packs, seen through the window only. tape.png is opaque with
            // the photo's own packs baked into the window, so the window is
            // first covered by a dark cavity (so the baked packs never show
            // through mismatched), then both live packs go on top. The cavity
            // is not flat black: a faint amber glow sits in the middle, the
            // way the reference deck's lamp lights the tape between the reels.
            // The clip is the window's stadium (the manifest windowRect with
            // fully rounded ends): its corners are label paper on every tape.
            if let w = tape.windowRect {
                let wr = CGRect(x: lx(w.x), y: ly(w.y), width: w.w * F.W, height: w.h * F.H)
                ZStack(alignment: .topLeading) {
                    ZStack {
                        Color(white: 0.03)
                        EllipticalGradient(colors: [Self.amber.opacity(0.08),
                                                    Self.amber.opacity(0.03), .clear],
                                           center: .center, startRadiusFraction: 0,
                                           endRadiusFraction: 0.5)
                    }
                    .frame(width: wr.width, height: wr.height)
                    .offset(x: wr.minX, y: wr.minY)
                    if let pack = packTexture {
                        packDisc(pack, r: radii.rs, angle: angleL)
                            .position(x: lx(tape.hubL.x), y: ly(tape.hubL.y))
                        packDisc(pack, r: radii.rt, angle: angleR)
                            .position(x: lx(tape.hubR.x), y: ly(tape.hubR.y))
                    }
                }
                .frame(width: sr.width, height: sr.height, alignment: .topLeading)
                .mask(alignment: .topLeading) {
                    Capsule()
                        .frame(width: wr.width, height: wr.height)
                        .offset(x: wr.minX, y: wr.minY)
                }
            }

            // Hub rings, turning with their packs.
            if let hub = images.hub {
                Image(uiImage: hub).resizable()
                    .frame(width: hubD, height: hubD)
                    .rotationEffect(.degrees(angleL))
                    .position(x: lx(tape.hubL.x), y: ly(tape.hubL.y))
                Image(uiImage: hub).resizable()
                    .frame(width: hubD, height: hubD)
                    .rotationEffect(.degrees(angleR + 23))
                    .position(x: lx(tape.hubR.x), y: ly(tape.hubR.y))
            }

            MixtapeLabel(tape: tape, load: load, art: art, W: F.W, H: F.H, origin: sr.origin,
                         frameOrigin: F.frameRect.origin)
                .equatable()
        }
        .frame(width: sr.width, height: sr.height, alignment: .topLeading)
    }

    static let amber = Color(red: 1.0, green: 0.66, blue: 0.30)

    // A wound pack of brown oxide tape: the shared pack texture drawn at the
    // pack's current radius and turning with its hub. The raw texture is a
    // deep, saturated brown; it is desaturated and lifted a little toward the
    // reference's warmer, dustier brown. On top, the outer wraps darken
    // (a radial falloff to the edge, the pack's side in shadow) and a soft
    // warm highlight sits on the upper-left, as the deck lamp catches it.
    // Neither overlay rotates, so the light stays put while the tape turns.
    private func packDisc(_ img: UIImage, r: Double, angle: Double) -> some View {
        let full = 2 * tape.packMaxRadius * F.W
        let d = 2 * r * F.W
        return ZStack {
            Image(uiImage: img).resizable()
                .interpolation(.high)
                .frame(width: d, height: d)
                .rotationEffect(.degrees(angle))
                .saturation(Self.packSaturation)
                .brightness(Self.packLift)
            Circle()
                .fill(RadialGradient(colors: [.clear, .clear, .black.opacity(0.18), .black.opacity(0.42)],
                                     center: .center, startRadius: 0, endRadius: d / 2))
                .frame(width: d, height: d)
            Circle()
                .fill(RadialGradient(colors: [Self.amber.opacity(0.30), Self.amber.opacity(0.10), .clear],
                                     center: UnitPoint(x: 0.30, y: 0.28),
                                     startRadius: 0, endRadius: d * 0.62))
                .blendMode(.screen)
                .frame(width: d, height: d)
        }
        .frame(width: full, height: full)
    }

    static let packSaturation = 0.72
    static let packLift = 0.10
}

// MARK: - Label

// Album art in the slot, then artist / album / song in the tape's hand font and
// ink. Equatable so SwiftUI skips it on every animation frame.
private struct MixtapeLabel: View, Equatable {
    let tape: MixtapeTape
    let load: MixtapeLoad
    let art: UIImage?
    let W: CGFloat
    let H: CGFloat
    let origin: CGPoint        // sprite origin, screen space
    let frameOrigin: CGPoint   // frame origin, screen space

    static func == (a: Self, b: Self) -> Bool {
        a.tape == b.tape && a.load == b.load && a.art === b.art && a.W == b.W && a.H == b.H
            && a.origin == b.origin
    }

    private func lx(_ v: Double) -> CGFloat { frameOrigin.x + v * W - origin.x }
    private func ly(_ v: Double) -> CGFloat { frameOrigin.y + v * H - origin.y }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let slot = tape.artSlotRect, !load.isRadio {
                Group {
                    if let art {
                        Image(uiImage: art).resizable().scaledToFill()
                            .frame(width: slot.w * W, height: slot.h * H)
                            .clipped()
                            .opacity(0.95)
                            .transition(.opacity)
                    }
                }
                .frame(width: slot.w * W, height: slot.h * H)
                .offset(x: lx(slot.x), y: ly(slot.y))
                .animation(.easeIn(duration: 0.4), value: art != nil)
            }
            ForEach(Array(tape.textLines.enumerated()), id: \.offset) { i, line in
                let text = value(for: line.field)
                // A caption with nothing after it (a radio stream has no
                // artist) is hidden; the other lines keep their baselines.
                if tape.printedFields, !text.isEmpty {
                    caption(for: line)
                }
                if !text.isEmpty {
                    handLine(text, line: line, seed: i)
                }
            }
        }
    }

    private func value(for field: String) -> String {
        switch field {
        case "artist": return load.artist
        case "album":  return load.isRadio ? load.station : (load.album.isEmpty ? load.station : load.album)
        case "song", "title": return load.title
        default: return ""
        }
    }

    private var ink: Color { Color(hex: tape.inkColorHex) ?? HandFont.ink }

    private var fontName: String {
        UIFont(name: tape.font, size: 12) != nil ? tape.font : HandFont.postScriptName
    }

    // Font size whose x-height matches the manifest's, shrunk to fit the line's
    // max width down to 60% of nominal; past that, the tail is ellipsised.
    private func handLine(_ text: String, line: MixtapeTextLine, seed: Int) -> some View {
        let name = fontName
        let ref = UIFont(name: name, size: 100) ?? .systemFont(ofSize: 100)
        let nominal = line.xHeight * H / max(0.01, ref.xHeight / 100)
        let maxW = line.maxWidth * W
        // Fit to 97% so SwiftUI's own layout (which kerns a hair wider than the
        // CoreText measure) does not ellipsise a line that was shrunk to fit.
        let fitW = maxW * 0.97
        let natural = (text as NSString).size(withAttributes: [.font: ref.withSize(nominal)]).width
        let size = natural > fitW ? max(nominal * 0.6, nominal * fitW / natural) : nominal
        // A hair of hand-written tilt, stable per tape and line.
        let tilt = (Double(fnv1a32(tape.id + "\(seed)") % 100) / 100 - 0.5) * 1.2
        // A zero-size anchor at the baseline start; the text hangs off it by
        // its first baseline, so the manifest's baselineY is exact.
        return Color.clear.frame(width: 0, height: 0)
            .overlay(alignment: .topLeading) {
                Text(text)
                    .font(.custom(name, size: size))
                    .foregroundStyle(ink.opacity(0.92))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(width: maxW, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .alignmentGuide(.top) { $0[.firstTextBaseline] }
                    .rotationEffect(.degrees(tilt), anchor: .bottomLeading)
            }
            .offset(x: lx(line.x), y: ly(line.baselineY))
    }

    // Pre-printed field names (printed label styles): a small-caps sans in a
    // printed ink grey, sitting on the value's baseline at the manifest's
    // captionX. The value starts at line.x, so each caption must end a small
    // gap short of it. All captions share ONE size, as a printed form would:
    // nominal from the smallest line's x-height, shrunk just enough that the
    // widest caption (e.g. STATION on a radio tape) still fits its room.
    private static let captionKern = 0.10

    private func captionLabel(_ line: MixtapeTextLine) -> String {
        switch line.field {
        case "artist": return "ARTIST"
        case "album": return load.isRadio ? "STATION" : "ALBUM"
        default: return "SONG"
        }
    }

    private func captionWidth(_ label: String, size: CGFloat) -> CGFloat {
        let f = UIFont.systemFont(ofSize: size, weight: .medium)
        return (label as NSString).size(withAttributes: [.font: f, .kern: size * Self.captionKern]).width
    }

    private var captionSize: CGFloat {
        let xh = tape.textLines.map(\.xHeight).min() ?? 0.01
        let nominal = xh * H * 0.95 / 0.70          // cap height about 0.95 x-height
        var size = nominal
        for line in tape.textLines {
            let room = (line.x - (line.captionX ?? line.x)) * W - 0.004 * W
            guard room > 0 else { continue }
            let w = captionWidth(captionLabel(line), size: nominal)
            size = min(size, nominal * room / max(1, w))
        }
        return size
    }

    private func caption(for line: MixtapeTextLine) -> some View {
        let label = captionLabel(line)
        let size = captionSize
        let bx = line.captionX ?? line.x
        let by = line.captionBaselineY ?? (line.baselineY - line.xHeight * 1.9)
        return Color.clear.frame(width: 0, height: 0)
            .overlay(alignment: .topLeading) {
                Text(label)
                    .font(.system(size: size, weight: .medium))
                    .kerning(size * Self.captionKern)
                    .foregroundStyle(Color(red: 0.30, green: 0.30, blue: 0.31).opacity(0.85))
                    .fixedSize()
                    .alignmentGuide(.top) { $0[.firstTextBaseline] }
            }
            .offset(x: lx(bx), y: ly(by))
    }
}

extension Color {
    /// "#rrggbb" or "rrggbb".
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xFF) / 255,
                  green: Double((v >> 8) & 0xFF) / 255,
                  blue: Double(v & 0xFF) / 255)
    }
}
