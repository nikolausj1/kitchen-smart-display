import SwiftUI

// Shared mat geometry so views can keep UI elements clear of the mat border
// and place elements relative to the opening.
enum MatMetrics {
    // Mat width as a fraction of the screen's short side, taken directly from
    // the Figma (frame authored at the exact TV size 3840x2160): the mat hole
    // is inset 152px on a 2160-tall frame. matWidth = 2160 * this ≈ 152px.
    static let fraction: CGFloat = 152.0 / 2160.0

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

// MatBorderOverlay - just the mat decoration (off-white surface + paper texture
// on the border ring, inner cast shadow, lit bevel), drawn over a transparent
// background. Composable so views can control z-order: e.g. the Photos view
// puts album art UNDER this overlay (inside the opening) and handwritten
// metadata OVER it (printed on the mat).
struct MatBorderOverlay: View {
    private static var base: Color { Color(red: 0.886, green: 0.871, blue: 0.835) }

    var body: some View {
        GeometryReader { geo in
            let full = CGRect(origin: .zero, size: geo.size)
            let opening = MatMetrics.opening(geo.size)

            ZStack {
                matSurface
                    .mask(borderMask(full: full, opening: opening))

                innerShadow
                    .frame(width: opening.width, height: opening.height)
                    .position(x: opening.midX, y: opening.midY)

                Rectangle()
                    .strokeBorder(
                        LinearGradient(colors: [Color.white.opacity(0.5), Color.white.opacity(0.18)],
                                       startPoint: .top, endPoint: .bottom),
                        lineWidth: 2)
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

    // Soft shadow the raised mat casts onto the artwork, thin band inside each
    // opening edge. Top heaviest; bottom lightest.
    private var innerShadow: some View {
        ZStack {
            LinearGradient(stops: [.init(color: .black.opacity(0.30), location: 0),
                                   .init(color: .clear, location: 0.045)],
                           startPoint: .top, endPoint: .bottom)
            LinearGradient(stops: [.init(color: .black.opacity(0.14), location: 0),
                                   .init(color: .clear, location: 0.035)],
                           startPoint: .leading, endPoint: .trailing)
            LinearGradient(stops: [.init(color: .black.opacity(0.14), location: 0),
                                   .init(color: .clear, location: 0.035)],
                           startPoint: .trailing, endPoint: .leading)
            LinearGradient(stops: [.init(color: .black.opacity(0.10), location: 0),
                                   .init(color: .clear, location: 0.035)],
                           startPoint: .bottom, endPoint: .top)
        }
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
