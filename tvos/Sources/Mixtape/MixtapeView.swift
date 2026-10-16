import SwiftUI
import UIKit

// MixtapeView - the cassette-deck Now Playing style (docs/designs/mixtape.md).
// Replaces the mat when musicMatMode == .framed and framedBackdrop == .mixtape.
//
// Layering, back to front:
//   1. deck plate (deck_empty_v2.png): a plain Image OUTSIDE the TimelineView,
//      so it is composited once and never re-rendered per frame;
//   1b. the deck's state sprites, also outside the TimelineView (they change
//      on state, animated by SwiftUI): the PLAY / PAUSE lamp glows and the
//      OUTPUT knob's dot turned for volume;
//   then, inside the TimelineView (the only per-frame subtree):
//   2. the open well (well_open.png), only while a tape or the door is shown,
//      so the door baked into the plate never shows twice;
//   3. the tape group: sprite, the lit window (lamp glow, pack discs with
//      their edge light, hub sprites), label content, moving as one unit on
//      eject and insert;
//   4. the door glass (its reflection drifting slowly, a specular sweep
//      during the swing), then the door frame, tilted together on the hinge;
//   5. the pressed PLAY cap (150 ms dip) and the VU needles.
// The per-frame values (reel angles with spin-up, coast, rock-back, wow and
// flutter; the lamp flicker; the reflection drift; the needle springs) all
// come from MixtapeClock.
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
                    MixtapeDeckState(deck: model.manifest?.deck ?? .fallback, images: deck, F: F,
                                     playLit: model.playing && model.current != nil,
                                     pauseLit: model.paused && model.current != nil,
                                     volume: model.volume)
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
        // The lamp behind the window is on while the deck is playing or
        // paused with a tape in; it dims out as the door opens for the eject.
        let lampOn = tape != nil && model.current != nil && (model.playing || model.paused)
            && (phase == .seated || phase == .closing)
        model.clock.step(now: now, .init(
            driving: tape != nil && driving,
            playing: tape != nil && model.playing && phase == .seated,
            paused: model.paused, lampOn: lampOn,
            key: phase == .seated ? model.current?.key : nil,
            f: f, r0: tape?.packMinRadius ?? 0.03, R: tape?.packMaxRadius ?? 0.04))
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
                          label: model.label,
                          F: F, angleL: model.clock.angleL, angleR: model.clock.angleR,
                          f: f, lamp: model.clock.lamp, jitter: model.clock.packJitter)
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
            // Room light changes: the streaks drift sideways (1.5% of the door
            // width, Lissajous, see MixtapeClock) and breathe +/- 15%. Under
            // the screen blend the smoke is black and drops out, so only the
            // reflections move; its rim carries no streaks, so the shift never
            // shows an edge. A transform and an opacity: no redraw of the 4K
            // image. (Over the empty well the full-smoke glass stays still.)
            let drift = model.clock.reflectionDrift * 0.015 * deck.door.w * F.W
            Image(uiImage: g).resizable()
                .frame(width: fr.width, height: fr.height)
                .blendMode(.screen)
                .opacity((1 - smoke) * model.clock.reflectionOpacity / 1.15)
                .position(x: fr.midX + drift, y: fr.midY)
        }
        ZStack {
            if let g = imgs.glass, smoke > 0.001 {
                Image(uiImage: g).resizable().opacity(smoke)
                    // A touch darker as it tips away from the lamp above the deck.
                    .brightness(-0.18 * open)
            }
            if open > 0.001 && open < 0.999, let mask = imgs.glassMask {
                specularSweep(open: open, size: fr.size)
                    .mask { Image(uiImage: mask).resizable() }
                    .blendMode(.screen)
            }
            if let fImg = imgs.frame { Image(uiImage: fImg).resizable().brightness(-0.18 * open) }
        }
        .frame(width: fr.width, height: fr.height)
        .rotation3DEffect(.degrees(-72 * open), axis: (x: 1, y: 0, z: 0),
                          anchor: UnitPoint(x: deck.door.midX, y: deck.doorHingeY),
                          perspective: 0.55)
        .position(x: fr.midX, y: fr.midY)
    }

    // The glass catching the room light as it tilts: a soft diagonal band
    // that travels down the glass as the door falls open (and back up as it
    // closes), brightest mid-swing. Drawn in the door's own (full-frame)
    // space, so it tilts with the glass; masked to the glass.
    private func specularSweep(open: Double, size: CGSize) -> some View {
        let d = deck.door
        let dw = d.w * size.width, dh = d.h * size.height
        let peak = pow(sin(.pi * open), 1.3)
        let warm = Color(red: 1.0, green: 0.95, blue: 0.86)
        return ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(LinearGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: warm.opacity(0.22 * peak), location: 0.32),
                    .init(color: warm.opacity(0.62 * peak), location: 0.5),
                    .init(color: warm.opacity(0.22 * peak), location: 0.68),
                    .init(color: .clear, location: 1),
                ], startPoint: .top, endPoint: .bottom))
                .frame(width: dw * 1.5, height: dh * 0.38)
                .rotationEffect(.degrees(-12))
                .position(x: d.midX * size.width,
                          y: (d.y - 0.25 * d.h + open * 1.5 * d.h) * size.height)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
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

    // The press dip on PLAY (decoration, decision 14). The cap is cropped
    // from the plate (unlit in v2), so a lit lamp is redrawn inside the cap
    // and dips with it; the lamp's part in the gap above stays put.
    @ViewBuilder
    private func keyOverlays(_ imgs: MixtapeDeckImages) -> some View {
        let pressed = model.pressDate.map { now.timeIntervalSince($0) < 0.15 } ?? false
        let playing = model.playing && model.current != nil
        if pressed, let r = deck.keyCaps["play"], let cap = imgs.caps["play"] {
            let cr = F.rect(r)
            let toward: CGFloat = cr.midX < F.frameRect.midX ? 1 : -1
            ZStack(alignment: .topLeading) {
                Image(uiImage: cap).resizable()
                    .frame(width: cr.width, height: cr.height)
                if playing, let g = imgs.glows["play"], let gn = deck.glows["play"] {
                    let gr = F.rect(gn)
                    Image(uiImage: g).resizable()
                        .frame(width: gr.width, height: gr.height)
                        .offset(x: gr.minX - cr.minX, y: gr.minY - cr.minY)
                }
            }
            .frame(width: cr.width, height: cr.height, alignment: .topLeading)
            .clipped()
            .overlay(Color.black.opacity(0.16))
            .position(x: cr.midX + toward * F.px(2), y: cr.midY + F.px(2))
        }
    }

    // MARK: VU needles

    // Angles come from MixtapeClock (a damped spring per needle, driven by a
    // per-song hash character, not by audio; see the comment there).

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
                        .rotationEffect(.degrees(model.clock.needleDeg[i]), anchor: .bottom)
                        .position(x: px, y: py - len / 2)
                }
                .frame(width: clip.width, height: clip.height, alignment: .topLeading)
                .clipped()
                .position(x: clip.midX, y: clip.midY)
            }
        }
    }
}

// MARK: - Deck state sprites

// The lamps and the OUTPUT knob: drawn above the plate, below the door, and
// outside the TimelineView, so they redraw only when state changes.
//   - glow_play / glow_pause are the lit key rows themselves (lamp strip, the
//     glow in the gap above it, the warm faceplate edge), drawn source-over at
//     deck.glows; opacity 1 is the photo's lit key. 250 ms fade on change.
//   - knob_dot.png turns over the plate's dotless face: clockwise by
//     (min + v (max - min)) - dotAngleDeg, v = volume / 100. 400 ms ease.
private struct MixtapeDeckState: View {
    let deck: MixtapeDeck
    let images: MixtapeDeckImages
    let F: MixFrame
    let playLit: Bool
    let pauseLit: Bool
    let volume: Int?

    var body: some View {
        ZStack(alignment: .topLeading) {
            lamp("play", lit: playLit)
            lamp("pause", lit: pauseLit)
            if let dot = images.knobDot {
                let side = deck.knob.spriteSize * F.H
                Image(uiImage: dot).resizable()
                    .interpolation(.high)
                    .frame(width: side, height: side)
                    .rotationEffect(.degrees(deck.knob.rotation(volume: volume)))
                    .animation(.easeInOut(duration: 0.4), value: volume)
                    .position(x: F.x(deck.knob.center.x), y: F.y(deck.knob.center.y))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private func lamp(_ key: String, lit: Bool) -> some View {
        if let img = images.glows[key], let n = deck.glows[key] {
            let r = F.rect(n)
            Image(uiImage: img).resizable()
                .interpolation(.high)
                .frame(width: r.width, height: r.height)
                .opacity(lit ? 1 : 0)
                .animation(.easeInOut(duration: 0.25), value: lit)
                .position(x: r.midX, y: r.midY)
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
    let label: MixtapeLabelImage?
    let F: MixFrame
    let angleL: Double
    let angleR: Double
    let f: Double
    /// The deck lamp, 0...1 with its flicker (MixtapeClock.lamp).
    let lamp: Double
    /// Pack edge jitter per pack, -1...1 (MixtapeClock.packJitter).
    let jitter: [Double]

    var body: some View {
        let sr = F.rect(tape.spriteRect)
        func lx(_ v: Double) -> CGFloat { F.x(v) - sr.minX }
        func ly(_ v: Double) -> CGFloat { F.y(v) - sr.minY }
        let radii = MixtapeClock.radii(f: f, r0: tape.packMinRadius, R: tape.packMaxRadius)
        let hubD = 2 * tape.hubRadius * F.W

        return ZStack(alignment: .topLeading) {
            Image(uiImage: images.sprite).resizable()
                .frame(width: sr.width, height: sr.height)

            // The printed label: one pre-composed image per track (paper,
            // printed art, ink, wear), transparent over the window, drawn
            // under the packs and hubs so the reels sit over everything.
            MixtapeLabelLayer(label: label, size: sr.size)
                .equatable()

            // Tape packs, seen through the window only. tape.png is opaque with
            // the photo's own packs baked into the window, so the window is
            // first covered by a dark cavity (so the baked packs never show
            // through mismatched), then both live packs go on top. Behind the
            // window sits the deck's lamp: a warm radial glow centred between
            // the hubs, the reference deck's window glow in colour at about
            // half its strength (so the label still leads), with a faint
            // flicker and breathe (MixtapeClock.lamp). It is on while playing
            // or paused and dims out with the eject.
            // The clip is the window's stadium (the manifest windowRect with
            // fully rounded ends): its corners are label paper on every tape.
            if let w = tape.windowRect {
                let wr = CGRect(x: lx(w.x), y: ly(w.y), width: w.w * F.W, height: w.h * F.H)
                let cx = (lx(tape.hubL.x) + lx(tape.hubR.x)) / 2
                let cy = (ly(tape.hubL.y) + ly(tape.hubR.y)) / 2
                let span = abs(lx(tape.hubR.x) - lx(tape.hubL.x))
                ZStack(alignment: .topLeading) {
                    Color(white: 0.03)
                        .frame(width: wr.width, height: wr.height)
                        .offset(x: wr.minX, y: wr.minY)
                    if lamp > 0.002 {
                        EllipticalGradient(stops: Self.lampStops, center: .center,
                                           startRadiusFraction: 0, endRadiusFraction: 0.5)
                            .frame(width: span * 1.35, height: wr.height * 1.15)
                            .opacity(min(1, lamp))
                            .position(x: cx, y: cy)
                    }
                    if let pack = packTexture {
                        packDisc(pack, r: radii.rs, angle: angleL, jitter: jitter[0])
                            .position(x: lx(tape.hubL.x), y: ly(tape.hubL.y))
                        packDisc(pack, r: radii.rt, angle: angleR, jitter: jitter[1])
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

        }
        .frame(width: sr.width, height: sr.height, alignment: .topLeading)
    }

    /// The reference window glow (sampled about (182, 111, 42) mid-window).
    static let lampAmber = Color(red: 1.0, green: 0.61, blue: 0.24)
    static let lampStops: [Gradient.Stop] = [
        .init(color: lampAmber.opacity(0.44), location: 0),
        .init(color: lampAmber.opacity(0.30), location: 0.28),
        .init(color: lampAmber.opacity(0.12), location: 0.62),
        .init(color: .clear, location: 1),
    ]

    // A wound pack of brown oxide tape: the shared pack texture drawn at the
    // pack's current radius and turning with its hub. The raw texture is a
    // deep, saturated brown; it is desaturated and lifted a little toward the
    // reference's warmer, dustier brown. On top, the outer wraps darken
    // (a radial falloff to the edge, the pack's side in shadow), a soft warm
    // highlight sits on the upper-left, and the pack's edge catches the light
    // there as a bright arc. None of those rotate, so the light stays put
    // while the tape turns; all scale with the pack's radius. One faint glint
    // does ride the pack round (one per revolution), so the rotation reads
    // even where the texture is uniform. The edge breathes by a fraction of a
    // pixel while tape moves (MixtapeClock.packJitter).
    private func packDisc(_ img: UIImage, r: Double, angle: Double, jitter: Double) -> some View {
        let full = 2 * tape.packMaxRadius * F.W
        let d = 2 * r * F.W + 2 * jitter * F.px(0.45)
        let lit = 0.5 + 0.5 * min(1, lamp)
        return ZStack {
            Image(uiImage: img).resizable()
                .interpolation(.high)
                .frame(width: d, height: d)
                .rotationEffect(.degrees(angle))
                .saturation(Self.packSaturation)
                .brightness(Self.packLift)
            // The outer wraps' shadow, then the light that stays put: the
            // warm upper-left highlight and the edge arc (a soft wide band
            // and a thin bright line centred on the upper-left), then the
            // travelling glint, a short arc just inside the edge. All are
            // images drawn once (PackLight) and only scaled per frame: as
            // live Shapes with gradients they were re-rasterised every frame
            // as the radius changes (the angular-gradient arcs alone cost
            // about 65% CPU in the simulator).
            Image(uiImage: PackLight.shade).resizable()
                .frame(width: d, height: d)
            Image(uiImage: PackLight.light).resizable()
                .blendMode(.screen)
                .opacity(lit)
                .frame(width: d, height: d)
            Image(uiImage: PackLight.glint).resizable()
                .rotationEffect(.degrees(angle))
                .blendMode(.screen)
                .opacity(lit)
                .frame(width: d, height: d)
        }
        .frame(width: full, height: full)
    }

    static let packSaturation = 0.72
    static let packLift = 0.10
}

// The pack's edge light, drawn once at 512 px with Core Graphics and scaled
// to each pack. Angles run clockwise from +x (screen coordinates), so 225 deg
// is the upper-left.
enum PackLight {
    static let size = 512.0
    static let warm = UIColor(red: 1.0, green: 0.86, blue: 0.66, alpha: 1)

    /// The outer wraps in shadow: clear to the middle, then black 0.18 and
    /// 0.42 at the edge (the stops the live gradient used).
    static let shade: UIImage = render { ctx in
        clipDisc(ctx)
        radial(ctx, center: CGPoint(x: size / 2, y: size / 2), radius: size / 2,
               colors: [.clear, .clear, UIColor(white: 0, alpha: 0.18), UIColor(white: 0, alpha: 0.42)],
               locations: [0, 1.0 / 3, 2.0 / 3, 1])
    }

    /// Everything fixed to the light, drawn screen: the warm upper-left
    /// highlight (amber 0.30 -> 0.10 -> clear, as before), plus the edge arc,
    /// a wide soft band (7% of the diameter) and a thin line (1.6%).
    static let light: UIImage = render { ctx in
        clipDisc(ctx)
        let amber = UIColor(red: 1.0, green: 0.66, blue: 0.30, alpha: 1)
        radial(ctx, center: CGPoint(x: 0.30 * size, y: 0.28 * size), radius: 0.62 * size,
               colors: [amber.withAlphaComponent(0.30), amber.withAlphaComponent(0.10), .clear],
               locations: [0, 0.5, 1])
        band(ctx, center: 225, halfSpan: 65, width: 0.07, inset: 0, alpha: 0.20, layers: 6)
        band(ctx, center: 225, halfSpan: 50, width: 0.016, inset: 0, alpha: 0.55, layers: 2)
    }

    private static func clipDisc(_ ctx: CGContext) {
        ctx.addEllipse(in: CGRect(x: 0, y: 0, width: size, height: size))
        ctx.clip()
    }

    private static func radial(_ ctx: CGContext, center: CGPoint, radius: Double,
                               colors: [UIColor], locations: [CGFloat]) {
        guard let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(),
                                 colors: colors.map(\.cgColor) as CFArray, locations: locations) else { return }
        ctx.drawRadialGradient(g, startCenter: center, startRadius: 0, endCenter: center,
                               endRadius: radius, options: [])
    }

    /// One glint per revolution, rotated with the pack.
    static let glint: UIImage = render { ctx in
        band(ctx, center: 17, halfSpan: 17, width: 0.035, inset: 0.05, alpha: 0.16, layers: 3)
    }

    private static func render(_ draw: (CGContext) -> Void) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        fmt.opaque = false
        return UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: fmt)
            .image { draw($0.cgContext) }
    }

    // An arc band inside the disc's edge, its alpha falling off smoothly to
    // both ends (cosine) and across its width (concentric layers, softest
    // outermost), drawn as 1-degree segments.
    private static func band(_ ctx: CGContext, center: Double, halfSpan: Double, width: Double,
                             inset: Double, alpha: Double, layers: Int) {
        let c = size / 2
        ctx.setLineCap(.butt)
        for l in 0..<layers {
            let lu = layers == 1 ? 0.5 : Double(l) / Double(layers - 1)       // 0 outer .. 1 inner
            let across = sin(.pi * (0.15 + 0.7 * lu))                         // soft both sides
            let lw = width * size / Double(layers)
            let r = c - inset * size - (Double(l) + 0.5) * lw
            ctx.setLineWidth(lw + 0.6)
            var a = center - halfSpan
            while a < center + halfSpan {
                let u = (a - center) / halfSpan
                let along = 0.5 + 0.5 * cos(.pi * u)
                ctx.setStrokeColor(warm.withAlphaComponent(alpha * along * across).cgColor)
                let t0 = a * .pi / 180, t1 = (a + 1.1) * .pi / 180
                ctx.move(to: CGPoint(x: c + r * cos(t0), y: c + r * sin(t0)))
                ctx.addLine(to: CGPoint(x: c + r * cos(t1), y: c + r * sin(t1)))
                ctx.strokePath()
                a += 1
            }
        }
    }
}

// MARK: - Label

// The pre-composed printed label (MixtapeLabelRenderer): one image, placed on
// the sprite's paper rect. Equatable on the image identity, so SwiftUI skips
// it on every animation frame; a new label crossfades in.
private struct MixtapeLabelLayer: View, Equatable {
    let label: MixtapeLabelImage?
    let size: CGSize

    static func == (a: Self, b: Self) -> Bool { a.label?.image === b.label?.image && a.size == b.size }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let label {
                Image(uiImage: label.image).resizable()
                    .interpolation(.high)
                    .frame(width: label.paper.width * size.width, height: label.paper.height * size.height)
                    .offset(x: label.paper.minX * size.width, y: label.paper.minY * size.height)
                    .id(ObjectIdentifier(label.image))
                    .transition(.opacity)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .animation(.easeInOut(duration: 0.4), value: label.map { ObjectIdentifier($0.image) })
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
