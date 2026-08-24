import SwiftUI

// FluidBackdrop - host view for the Metal fluid backdrops (Backdrop.metal):
// Marble (paint folding into itself) and Ink (rising, billowing turbulence).
// The shader domain-warps the blurred album texture, so every streak is
// literally the cover's own pixels.
//
// Layout trick: the blurred source renders OVERSCANNED (1.2x the opening) and
// the layerEffect runs on that larger layer; the result is then center-cropped
// to the opening. Warped samples can reach up to `maxOff` (8% of height) past
// any visible edge and still land inside real texture, so the flow never
// drags in transparent border pixels.
struct FluidBackdrop: View {
    enum Style { case marble, smoke, ripple, caustics, bars }

    let url: URL?
    let opening: CGRect
    let style: Style
    // Smoke and Ripple warp a field of palette colors (same extraction Lava
    // uses) instead of the album texture - cleaner, more graphic motion.
    @State private var palette: [Color] = []

    private static let overscan: CGFloat = 1.45

    var body: some View {
        let ow = opening.width * Self.overscan
        let oh = opening.height * Self.overscan
        let maxOff = opening.height * 0.18

        // ~30 updates/s - the fluid tier is meant to clearly flow, and the
        // shader cost is per-tick only (the blur beneath it stays cached).
        TimelineView(.periodic(from: .now, by: 1.0 / 30.0)) { ctx in
            // float32 time: wrap daily so precision stays sub-frame (a single
            // tiny jump once a day is invisible in a noise field).
            let t = Float(ctx.date.timeIntervalSinceReferenceDate
                .truncatingRemainder(dividingBy: 86_400))
            source(width: ow, height: oh)
                .layerEffect(shader(time: t, size: CGSize(width: ow, height: oh), maxOff: maxOff),
                             maxSampleOffset: CGSize(width: maxOff, height: maxOff))
        }
        .frame(width: opening.width, height: opening.height)
        .clipped()
        // Light wash only - the shaders shade themselves, and a heavy scrim
        // was flattening the showpiece.
        .overlay(Color.black.opacity(0.10))
        .position(x: opening.midX, y: opening.midY)
        .allowsHitTesting(false)
        .task(id: url) {
            guard style != .marble, let url else { return }
            palette = await AlbumPalette.extract(from: url)
        }
    }

    private func shader(time: Float, size: CGSize, maxOff: CGFloat) -> Shader {
        let args: [Shader.Argument] = [
            .float2(size.width, size.height),
            .float(time),
            .float(maxOff),
        ]
        let name: String
        switch style {
        case .marble:   name = "marbleBackdrop"
        case .smoke:    name = "smokeBackdrop"
        case .ripple:   name = "rippleBackdrop"
        case .caustics: name = "causticsBackdrop"
        case .bars:     name = "barsBackdrop"
        }
        return Shader(function: ShaderFunction(library: .default, name: name),
                      arguments: args)
    }

    // What the shader warps. Marble: a SCRAMBLED composite of the album
    // texture - four overlapping copies (offset, rescaled, one mirrored, at
    // partial opacity) dissolve faces and objects into pure color texture
    // while keeping the cover's true palette; a red dot in one corner ends up
    // distributed across the canvas. Ink: a fixed field of palette colors -
    // the shader supplies all the motion, the field supplies color regions.
    @ViewBuilder
    private func source(width: CGFloat, height: CGFloat) -> some View {
        switch style {
        case .marble:
            ZStack {
                albumImage(width: width, height: height)
                    .scaleEffect(1.35)
                albumImage(width: width, height: height)
                    .scaleEffect(x: -1.45, y: 1.45)   // mirrored copy
                    .offset(x: width * 0.22, y: -height * 0.18)
                    .opacity(0.6)
                albumImage(width: width, height: height)
                    .scaleEffect(1.6)
                    .offset(x: -width * 0.24, y: height * 0.20)
                    .opacity(0.6)
                albumImage(width: width, height: height)
                    .scaleEffect(x: 1.4, y: -1.4)     // flipped copy
                    .offset(x: width * 0.18, y: height * 0.24)
                    .opacity(0.55)
            }
            .frame(width: width, height: height)
            .clipped()
            // Light blur on top of the scramble: abstracts the seams while
            // keeping structure for the warp to visibly carry.
            .blur(radius: height * 0.022)
        case .smoke, .ripple, .caustics, .bars:
            paletteField(width: width, height: height)
        }
    }

    @ViewBuilder
    private func albumImage(width: CGFloat, height: CGFloat) -> some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    if let img = phase.image {
                        img.resizable().scaledToFill()
                    } else {
                        Color(white: 0.08)
                    }
                }
            } else {
                Color(white: 0.08)
            }
        }
        .frame(width: width, height: height)
        .clipped()
    }

    // A static arrangement of the cover's palette. Denser than the first
    // pass: ten medium, harder-edged regions (palette colors cycling) give
    // the ink visible color boundaries to drag into filaments - five giant
    // soft radials warped into something too smooth to read.
    private static let anchors: [CGPoint] = [
        CGPoint(x: 0.12, y: 0.20), CGPoint(x: 0.42, y: 0.12), CGPoint(x: 0.74, y: 0.22),
        CGPoint(x: 0.92, y: 0.45), CGPoint(x: 0.24, y: 0.48), CGPoint(x: 0.56, y: 0.42),
        CGPoint(x: 0.10, y: 0.78), CGPoint(x: 0.40, y: 0.84), CGPoint(x: 0.70, y: 0.74),
        CGPoint(x: 0.90, y: 0.86),
    ]

    @ViewBuilder
    private func paletteField(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            (palette.first ?? Color(white: 0.10)).opacity(0.4)
                .background(Color.black)
            if !palette.isEmpty {
                ForEach(Array(Self.anchors.enumerated()), id: \.offset) { i, a in
                    RadialGradient(
                        colors: [palette[i % palette.count].opacity(0.95),
                                 palette[i % palette.count].opacity(0)],
                        center: .center, startRadius: 0, endRadius: height * 0.30
                    )
                    .frame(width: height * 0.62, height: height * 0.62)
                    .position(x: width * a.x, y: height * a.y)
                    .blendMode(.screen)
                }
            }
        }
        .compositingGroup()
        .frame(width: width, height: height)
        .clipped()
    }
}
