import Foundation
import SwiftUI

// SlideshowEngine - port of the queue + portrait-buffer advance logic in
// PhotoSlideshow.jsx. Produces DisplayItems (a single landscape, a pair of
// portraits side-by-side, or a solo portrait) and auto-advances on a timer.

enum DisplayItem: Equatable {
    case landscape(Photo)
    case portraitPair(Photo, Photo)
    case portraitSolo(Photo)
}

@MainActor
final class SlideshowEngine: ObservableObject {
    @Published var current: DisplayItem?
    @Published var generation: Int = 0   // bumps each advance (drives EXIF reset)

    private var photos: [Photo] = []
    private var queueIndex = 0
    private var portraitBuffer: [(photo: Photo, arrivedAt: Int)] = []
    private var advanceCount = 0
    private var timer: Timer?
    private var intervalMs = 6000

    private let portraitFallbackAfter = 40

    func configure(photos: [Photo], sortOrder: String, intervalMs: Int) {
        let ordered = Self.order(photos, sortOrder: sortOrder)
        // Only reset if the photo set actually changed (avoid restarting the
        // slideshow on every 30s settings poll).
        if ordered.map(\.id) == self.photos.map(\.id) && intervalMs == self.intervalMs {
            return
        }
        self.photos = ordered
        self.intervalMs = intervalMs
        queueIndex = ordered.isEmpty ? 0 : Int.random(in: 0..<ordered.count)
        portraitBuffer.removeAll()
        advanceCount = 0
        current = nil
        advance()
        restartTimer()
    }

    func stop() { timer?.invalidate(); timer = nil }

    func next() { advance() }   // Siri Remote: next photo
    func previous() { advance() } // simple: advance (no back-stack on TV for now)

    private func restartTimer() {
        timer?.invalidate()
        guard intervalMs > 0 else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Double(intervalMs) / 1000.0,
                                     repeats: true) { [weak self] _ in
            Task { @MainActor in self?.advance() }
        }
    }

    private func advance() {
        guard let item = pickNext() else { return }
        current = item
        generation += 1
    }

    // Port of pickNextDisplay().
    private func pickNext() -> DisplayItem? {
        guard !photos.isEmpty else { return nil }
        var safety = photos.count * 2 + 4
        while safety > 0 {
            safety -= 1
            if portraitBuffer.count >= 2 {
                let a = portraitBuffer.removeFirst()
                let b = portraitBuffer.removeFirst()
                advanceCount += 1
                return .portraitPair(a.photo, b.photo)
            }
            if portraitBuffer.count == 1 {
                let waited = advanceCount - portraitBuffer[0].arrivedAt
                if waited >= portraitFallbackAfter {
                    let lone = portraitBuffer.removeFirst()
                    advanceCount += 1
                    return .portraitSolo(lone.photo)
                }
            }
            let next = photos[queueIndex % photos.count]
            queueIndex += 1
            if next.orientation == "landscape" {
                advanceCount += 1
                return .landscape(next)
            } else {
                portraitBuffer.append((photo: next, arrivedAt: advanceCount))
            }
        }
        return nil
    }

    private static func order(_ photos: [Photo], sortOrder: String) -> [Photo] {
        switch sortOrder {
        case "date-added":
            return photos.sorted { ($0.addedAt ?? 0) < ($1.addedAt ?? 0) }
        case "date-taken":
            return photos   // manifest already oldest->newest by date taken
        default: // "random"
            return photos.shuffled()
        }
    }
}
