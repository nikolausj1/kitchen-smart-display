import SwiftUI
import UIKit

// LavaBackdrop - "lava lamp" fill for the Framed Now Playing opening: large
// soft blobs in colors extracted from the album cover, wandering on slow
// independent orbits over a darkened base. The Apple-Music-style alternative
// to the blurred-wash backdrops (see FramedBackdrop in TVSettings.swift).
//
// Rendering stays cheap on purpose: blobs are RadialGradients (soft edges
// with no blur filter at all), positions are pure functions of time, and the
// timeline ticks ~20x/s so each step is small. Periods are incommensurate
// per blob, so the composition never visibly repeats.

// MARK: - Palette extraction

// Dominant-color extraction tuned for backdrop use, not color science:
// downsample the cover, bucket pixels by quantized RGB, drop near-grays,
// pick frequent buckets that are mutually distinct, then push saturation /
// brightness up so even a dull cover yields glowing lava colors.
enum AlbumPalette {
    @MainActor private static var cache: [URL: [Color]] = [:]

    @MainActor
    static func extract(from url: URL) async -> [Color] {
        if let hit = cache[url] { return hit }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let ui = UIImage(data: data),
              let cg = ui.cgImage else { return [] }

        let colors = dominantColors(cg)
        cache[url] = colors
        return colors
    }

    private static func dominantColors(_ cg: CGImage) -> [Color] {
        // Downsample to 24x24 RGBA.
        let side = 24
        guard let ctx = CGContext(
            data: nil, width: side, height: side, bitsPerComponent: 8,
            bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return [] }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let buf = ctx.data else { return [] }
        let px = buf.bindMemory(to: UInt8.self, capacity: side * side * 4)

        // Histogram on RGB quantized to 4 bits per channel.
        var counts: [Int: Int] = [:]
        var sums: [Int: (r: Int, g: Int, b: Int)] = [:]
        for i in 0..<(side * side) {
            let r = Int(px[i * 4]), g = Int(px[i * 4 + 1]), b = Int(px[i * 4 + 2])
            // Skip near-black / near-white: they make muddy or washed blobs.
            let mx = max(r, g, b), mn = min(r, g, b)
            if mx < 28 || mn > 232 { continue }
            let key = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)
            counts[key, default: 0] += 1
            let s = sums[key] ?? (0, 0, 0)
            sums[key] = (s.r + r, s.g + g, s.b + b)
        }

        // Frequent buckets first; greedily keep ones far enough from those
        // already picked so the palette has variety, not five shades of one.
        let ranked = counts.sorted { $0.value > $1.value }
        var picked: [(r: Double, g: Double, b: Double)] = []
        for (key, n) in ranked {
            guard picked.count < 5, n >= 3, let s = sums[key] else { continue }
            let c = (r: Double(s.r) / Double(n) / 255,
                     g: Double(s.g) / Double(n) / 255,
                     b: Double(s.b) / Double(n) / 255)
            let distinct = picked.allSatisfy { p in
                let d = abs(p.r - c.r) + abs(p.g - c.g) + abs(p.b - c.b)
                return d > 0.25
            }
            if distinct { picked.append(c) }
        }

        // Vivid-ify: clamp saturation/brightness up in HSB space.
        return picked.map { c in
            let ui = UIColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
            var h: CGFloat = 0, s: CGFloat = 0, br: CGFloat = 0, a: CGFloat = 0
            ui.getHue(&h, saturation: &s, brightness: &br, alpha: &a)
            return Color(hue: h, saturation: max(s, 0.55), brightness: max(br, 0.62))
        }
    }
}

// MARK: - Blob field

struct LavaBackdrop: View {
    let url: URL?
    let opening: CGRect
    @State private var palette: [Color] = []

    // Per-blob choreography: orbit periods (s) and phases are fixed and
    // incommensurate; amplitude/size are fractions of the opening.
    private struct Spec {
        let px: Double; let py: Double      // x/y orbit periods
        let phx: Double; let phy: Double    // phase offsets
        let ax: Double; let ay: Double      // orbit amplitude (fraction)
        let size: Double                    // diameter (fraction of height)
        let pr: Double                      // size-pulse period
    }
    private static let specs: [Spec] = [
        Spec(px: 31, py: 23, phx: 0.0, phy: 1.3, ax: 0.34, ay: 0.30, size: 1.05, pr: 37),
        Spec(px: 19, py: 29, phx: 2.1, phy: 0.4, ax: 0.38, ay: 0.26, size: 0.85, pr: 27),
        Spec(px: 41, py: 17, phx: 4.2, phy: 2.8, ax: 0.30, ay: 0.34, size: 0.95, pr: 43),
        Spec(px: 23, py: 37, phx: 1.0, phy: 4.9, ax: 0.40, ay: 0.22, size: 0.75, pr: 31),
        Spec(px: 29, py: 43, phx: 3.4, phy: 5.6, ax: 0.28, ay: 0.36, size: 0.90, pr: 23),
    ]

    var body: some View {
        Group {
            if palette.isEmpty {
                // Palette still loading (or extraction failed): a quiet dark
                // base so the opening never flashes.
                Color(white: 0.06)
                    .frame(width: opening.width, height: opening.height)
                    .position(x: opening.midX, y: opening.midY)
            } else {
                TimelineView(.periodic(from: .now, by: 0.05)) { ctx in
                    // 0.8x clock = every orbit/pulse period 25% longer
                    // (slowed 20% per Justin's eye on the real TV).
                    let t = ctx.date.timeIntervalSinceReferenceDate * 0.8
                    ZStack {
                        // Base: the first palette color, deep and dark.
                        (palette.first ?? .black).opacity(0.35)
                            .background(Color.black)

                        ForEach(Array(palette.enumerated()), id: \.offset) { i, color in
                            let s = Self.specs[i % Self.specs.count]
                            let x = opening.width * (0.5 + s.ax * sin(t * 2 * .pi / s.px + s.phx))
                            let y = opening.height * (0.5 + s.ay * sin(t * 2 * .pi / s.py + s.phy))
                            let d = opening.height * s.size * (1 + 0.12 * sin(t * 2 * .pi / s.pr + s.phx))
                            RadialGradient(
                                colors: [color.opacity(0.85), color.opacity(0)],
                                center: .center, startRadius: 0, endRadius: d / 2
                            )
                            .frame(width: d, height: d)
                            .position(x: x, y: y)
                            .blendMode(.screen)
                        }
                    }
                    .compositingGroup()
                    .frame(width: opening.width, height: opening.height)
                    .clipped()
                    // Keep the handwritten-metadata / cover contrast familiar.
                    .overlay(Color.black.opacity(0.18))
                    .position(x: opening.midX, y: opening.midY)
                }
            }
        }
        .allowsHitTesting(false)
        .task(id: url) {
            guard let url else { palette = []; return }
            palette = await AlbumPalette.extract(from: url)
        }
    }
}
