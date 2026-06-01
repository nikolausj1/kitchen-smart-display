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

    // Displayed-item history + cursor so Left re-shows the actual previous item
    // (and a portrait pair comes back as the same pair). cursor is the index of
    // the currently-shown item within `history`.
    private var history: [DisplayItem] = []
    private var cursor: Int = -1
    private let historyMax = 30

    // After a manual Left/Right press, hold the navigated-to photo for this long
    // before auto-advance resumes. The timer keeps ticking but no-ops while
    // paused.
    private var pausedUntil: Date?
    private let manualPause: TimeInterval = 60

    func configure(photos: [Photo], sortOrder: String, intervalMs: Int) {
        var photos = photos
        #if targetEnvironment(simulator)
        // Sim-only: `defaults write <bundle> debug.forcePair -bool YES` keeps
        // only portrait photos so the engine reliably emits 2-up portrait pairs
        // (for verifying the right-photo mat caption). No effect on device.
        if UserDefaults.standard.bool(forKey: "debug.forcePair") {
            let portraits = photos.filter { $0.isPortrait }
            if !portraits.isEmpty { photos = portraits }
        }
        #endif
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
        history.removeAll()
        cursor = -1
        pausedUntil = nil
        current = nil
        advanceNew()
        restartTimer()
    }

    func stop() { timer?.invalidate(); timer = nil }

    // Siri Remote: Right. Step forward through history if the user had gone
    // back; otherwise generate a fresh item. Pauses auto-advance briefly.
    func next() {
        pausedUntil = Date().addingTimeInterval(manualPause)
        if cursor < history.count - 1 {
            cursor += 1
            show(history[cursor])
        } else {
            advanceNew()
        }
    }

    // Siri Remote: Left. Re-show the actual previous item. Pauses auto-advance.
    func previous() {
        pausedUntil = Date().addingTimeInterval(manualPause)
        guard cursor > 0 else { return }   // already at the oldest remembered item
        cursor -= 1
        show(history[cursor])
    }

    private func restartTimer() {
        timer?.invalidate()
        guard intervalMs > 0 else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Double(intervalMs) / 1000.0,
                                     repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    // Auto-advance tick: no-op while a manual navigation pause is in effect.
    private func tick() {
        if let until = pausedUntil, Date() < until { return }
        pausedUntil = nil
        advanceNew()
    }

    // Generate a brand-new item from the queue, append to history, advance the
    // cursor to it.
    private func advanceNew() {
        guard let item = pickNext() else { return }
        history.append(item)
        if history.count > historyMax { history.removeFirst() }
        cursor = history.count - 1
        show(item)
    }

    // Publish an item (forward or back) + bump generation so the crossfade,
    // EXIF caption, and right-photo metadata refresh.
    private func show(_ item: DisplayItem) {
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
