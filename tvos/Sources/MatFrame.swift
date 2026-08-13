import SwiftUI

// Shared mat geometry so views can keep UI elements clear of the mat border
// and place elements relative to the opening.
enum MatMetrics {
    // Mat width as a fraction of the screen's short side. Originally 152px on
    // the 2160-tall Figma frame (7.04%); widened to 7.43% in the art-fill
    // depth tuning session (Justin via _review/art-fill-shadow-tweaker.html,
    // 2026-06-11) - applied globally so the "physical" mat never changes
    // size between slides.
    static let fraction: CGFloat = 0.0743

    // Mat width in points for a given size.
    static func matWidth(_ size: CGSize) -> CGFloat {
        min(size.width, size.height) * fraction
    }

    // The opening rectangle (artwork window) inside the mat.
    static func opening(_ size: CGSize) -> CGRect {
        let m = matWidth(size)
        return CGRect(origin: .zero, size: size).insetBy(dx: m, dy: m)
    }

    // How far an overlay element should sit from the screen edge to clear the
    // mat border with a little margin.
    static func safeInset(_ size: CGSize) -> CGFloat {
        matWidth(size) * 1.4
    }
}

// Depth treatment for the opening's inner edge: per-edge cast shadows, an
// optional uniform ambient recess, an optional contact hairline where the
// artwork meets the mat, and the lit bevel. `standard` is the long-standing
// look used everywhere; `artFill` is the gallery-tuned spec for artworks in
// Fill mode (values chosen by Justin in _review/art-fill-shadow-tweaker.html,
// 2026-06-11). Depths are fractions of the opening dimension on that axis;
// pixel widths are in 4K (2160-tall) units, scaled at render time.
struct MatDepth {
    // Inner (opening) shadows. `hardness` = fraction of the depth that stays
    // at full opacity before the fade begins (0 = pure gradient).
    var topOpacity = 0.30;    var topDepth = 0.045;    var topHardness = 0.0
    var sideOpacity = 0.14;   var sideDepth = 0.035;   var sideHardness = 0.0
    var bottomOpacity = 0.10; var bottomDepth = 0.035; var bottomHardness = 0.0
    var ambientBlur: CGFloat = 0      // 4K px; 0 = off
    var ambientOpacity = 0.0
    var contactWidth: CGFloat = 0     // 4K px; 0 = off
    var contactOpacity = 0.0
    var bevelWidth: CGFloat = 2       // 4K px
    var bevelTopOpacity = 0.5
    var bevelBottomOpacity = 0.18
    // Frame shadow: the physical TV frame's lip shading the mat, cast inward
    // from the SCREEN edge. Depths are fractions of the screen dimension on
    // that axis. Applied in every view (it is a property of the frame, not
    // of what hangs in it).
    var frameTopOpacity = 0.59;  var frameTopDepth = 0.020;  var frameTopHardness = 0.06
    var frameSideOpacity = 0.33; var frameSideDepth = 0.007; var frameSideHardness = 0.0
    var frameBottomOpacity = 0.0; var frameBottomDepth = 0.013; var frameBottomHardness = 0.0

    static let standard = MatDepth()
    static let artFill = MatDepth(
        topOpacity: 0.68, topDepth: 0.010, topHardness: 0.18,
        sideOpacity: 0.20, sideDepth: 0.006, sideHardness: 0.10,
        bottomOpacity: 0.08, bottomDepth: 0.004, bottomHardness: 0,
        ambientBlur: 0, ambientOpacity: 0,
        contactWidth: 6, contactOpacity: 0.36,
        bevelWidth: 5, bevelTopOpacity: 0.55, bevelBottomOpacity: 0.91
    )
}

// MatBorderOverlay - just the mat decoration (off-white surface + paper texture
// on the border ring, inner cast shadow, lit bevel), drawn over a transparent
// background. Composable so views can control z-order: e.g. the Photos view
// puts album art UNDER this overlay (inside the opening) and handwritten
// metadata OVER it (printed on the mat).
struct MatBorderOverlay: View {
    var depth: MatDepth = .standard

    private static var base: Color { Color(red: 0.886, green: 0.871, blue: 0.835) }

    var body: some View {
        GeometryReader { geo in
            let full = CGRect(origin: .zero, size: geo.size)
            let opening = MatMetrics.opening(geo.size)
            let px = geo.size.height / 2160   // 4K px -> points

            ZStack {
                matSurface
                    .mask(borderMask(full: full, opening: opening))

                // Frame shadow over the mat (cast by the physical TV frame).
                frameShadow
                    .frame(width: geo.size.width, height: geo.size.height)

                // Uniform ambient recess: a blurred dark ring hugging every
                // opening edge (the CSS inset-shadow equivalent), clipped so
                // the blur never bleeds onto the mat.
                if depth.ambientOpacity > 0, depth.ambientBlur > 0 {
                    let bw = depth.ambientBlur * px
                    Rectangle()
                        .strokeBorder(Color.black.opacity(depth.ambientOpacity), lineWidth: bw)
                        .blur(radius: bw * 0.6)
                        .frame(width: opening.width, height: opening.height)
                        .clipped()
                        .position(x: opening.midX, y: opening.midY)
                }

                innerShadow
                    .frame(width: opening.width, height: opening.height)
                    .position(x: opening.midX, y: opening.midY)

                // Contact hairline: the artwork's paper edge meeting the mat.
                if depth.contactOpacity > 0, depth.contactWidth > 0 {
                    Rectangle()
                        .strokeBorder(Color.black.opacity(depth.contactOpacity),
                                      lineWidth: depth.contactWidth * px)
                        .frame(width: opening.width, height: opening.height)
                        .position(x: opening.midX, y: opening.midY)
                }

                Rectangle()
                    .strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(depth.bevelTopOpacity),
                                                Color.white.opacity(depth.bevelBottomOpacity)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: depth.bevelWidth * px)
                    .frame(width: opening.width, height: opening.height)
                    .position(x: opening.midX, y: opening.midY)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    private var matSurface: some View {
        Self.base
            .overlay(
                Image("PaperTexture")
                    .resizable(resizingMode: .tile)
                    .opacity(0.35)
                    .blendMode(.multiply)
            )
            .ignoresSafeArea()
    }

    private func borderMask(full: CGRect, opening: CGRect) -> some View {
        Path { p in
            p.addRect(full)
            p.addRect(opening)
        }
        .fill(style: FillStyle(eoFill: true))
    }

    // One edge shadow: solid at the edge, optionally holding full opacity for
    // hardness*depth, then fading to clear at depth on a quadratic ease-out.
    // The eased tail lands on the mat with zero slope, which kills the Mach
    // band (the illusory bright line the eye paints where a linear gradient
    // meets a flat field - verified with pixel sampling 2026-06-11: the
    // linear version was monotonic, the highlight purely perceptual).
    private func edgeShadow(opacity: Double, depthFrac: Double, hardness: Double,
                            start: UnitPoint, end: UnitPoint) -> LinearGradient {
        var stops: [Gradient.Stop] = [.init(color: .black.opacity(opacity), location: 0)]
        let solid = depthFrac * min(max(hardness, 0), 1)
        if solid > 0 {
            stops.append(.init(color: .black.opacity(opacity), location: solid))
        }
        let span = max(depthFrac - solid, 0.0001)
        for t in [0.25, 0.5, 0.75] {
            let eased = opacity * (1 - t) * (1 - t)   // (1-t)^2: zero slope at tail
            stops.append(.init(color: .black.opacity(eased), location: solid + span * t))
        }
        stops.append(.init(color: .clear, location: solid + span))
        return LinearGradient(stops: stops, startPoint: start, endPoint: end)
    }

    // Soft shadow the raised mat casts onto the artwork, thin band inside each
    // opening edge, per the depth spec.
    private var innerShadow: some View {
        ZStack {
            edgeShadow(opacity: depth.topOpacity, depthFrac: depth.topDepth,
                       hardness: depth.topHardness, start: .top, end: .bottom)
            edgeShadow(opacity: depth.sideOpacity, depthFrac: depth.sideDepth,
                       hardness: depth.sideHardness, start: .leading, end: .trailing)
            edgeShadow(opacity: depth.sideOpacity, depthFrac: depth.sideDepth,
                       hardness: depth.sideHardness, start: .trailing, end: .leading)
            edgeShadow(opacity: depth.bottomOpacity, depthFrac: depth.bottomDepth,
                       hardness: depth.bottomHardness, start: .bottom, end: .top)
        }
    }

    // The physical TV frame's shadow, cast inward from the screen edge.
    private var frameShadow: some View {
        ZStack {
            if depth.frameTopOpacity > 0 {
                edgeShadow(opacity: depth.frameTopOpacity, depthFrac: depth.frameTopDepth,
                           hardness: depth.frameTopHardness, start: .top, end: .bottom)
            }
            if depth.frameSideOpacity > 0 {
                edgeShadow(opacity: depth.frameSideOpacity, depthFrac: depth.frameSideDepth,
                           hardness: depth.frameSideHardness, start: .leading, end: .trailing)
                edgeShadow(opacity: depth.frameSideOpacity, depthFrac: depth.frameSideDepth,
                           hardness: depth.frameSideHardness, start: .trailing, end: .leading)
            }
            if depth.frameBottomOpacity > 0 {
                edgeShadow(opacity: depth.frameBottomOpacity, depthFrac: depth.frameBottomDepth,
                           hardness: depth.frameBottomHardness, start: .bottom, end: .top)
            }
        }
        .allowsHitTesting(false)
    }
}

// MatFrame - convenience wrapper: full-screen content + the mat border overlay
// on top. Used by Today / Now Playing / Settings. (Photos composes its own
// z-order with MatBorderOverlay directly so it can interleave album art and
// handwritten metadata.)
struct MatFrame<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ZStack {
            content
            MatBorderOverlay()
        }
        .ignoresSafeArea()
    }
}
