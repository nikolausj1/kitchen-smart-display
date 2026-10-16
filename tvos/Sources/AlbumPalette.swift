import SwiftUI
import UIKit

// AlbumPalette - the album-cover color extraction the Smoke backdrop and the
// Music Videos scene share. It lived in LavaBackdrop.swift until Lava was
// pruned (docs/designs/music-videos.md, "Pruning the backdrop cycle").

// Dominant-color extraction tuned for backdrop use, not color science:
// downsample the cover, bucket pixels by quantized RGB, drop near-grays,
// pick frequent buckets that are mutually distinct, then push saturation /
// brightness up so even a dull cover yields glowing backdrop colors.
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
