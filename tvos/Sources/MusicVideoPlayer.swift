import AVFoundation
import Combine
import SwiftUI
import UIKit

// MusicVideoPlayer - the engine under the Music Videos backdrop. One AVPlayer,
// always muted, in an AVPlayerLayer that fills the screen on black. It knows
// nothing about states or looks (that is MusicVideoStates.swift); it loads what
// the view tells it to, seeks ONCE to the Sonos position, and reports back
// whether it is ready, buffering, ended or failed.
//
// Timing (docs/designs/music-videos.md, "Timing"): on a new video the item is
// swapped in (a cut, no crossfade), the player waits for readyToPlay, takes
// the Sonos position THEN (so fetch latency is included), seeks, and plays. No
// further correction: a drifting video is better than one that jumps.
// When the item ends before the song does, the item stays attached so the
// layer keeps the last frame, which the scene dims.
//
// The item's own duration is NEVER read: AVFoundation reports twice the true
// length for the hub's proxied video-only mp4 streams (495 s for a 248 s
// video; WP1's spike). The end of the video is the hub's videoDurationMs, and
// "ended" is any of: currentTime within 500 ms of it, the item's did-play-to-
// end notification, or a stall with currentTime within 2 s of it.

@MainActor
final class MusicVideoPlayer: ObservableObject {
    let player = AVPlayer()

    /// The song key of the item currently attached; nil = nothing loaded.
    @Published private(set) var loadedIdentity: String?
    private var loadedVideoId: String?
    /// The item reached readyToPlay (a first frame can be drawn).
    @Published private(set) var ready = false
    @Published private(set) var ended = false
    @Published private(set) var failed = false
    @Published private(set) var buffering = false

    /// Where Sonos is now, in seconds; asked for at the moment of the seek.
    var positionProvider: () -> Double = { 0 }

    private var wantsPlay = true
    /// The hub's true length of the loaded video; nil = unknown.
    private var videoDuration: Double?
    private var timeObserver: Any?
    private var started = false
    private var cancellables = Set<AnyCancellable>()
    private var itemCancellables = Set<AnyCancellable>()
    private var watchdog: Task<Void, Never>?

    // Ambient never ducks or claims audio focus from anything; set once.
    private static let sessionConfigured: Bool = {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.ambient, mode: .default)
        try? s.setActive(true)
        return true
    }()

    /// How long a stream may sit without reaching readyToPlay before the scene
    /// gives up on it and shows the test pattern.
    private static let loadTimeout: UInt64 = 20_000_000_000

    init() {
        _ = Self.sessionConfigured
        player.isMuted = true
        player.volume = 0
        player.automaticallyWaitsToMinimizeStalling = true
        player.actionAtItemEnd = .pause   // hold the last frame
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] s in
                guard let self else { return }
                self.buffering = (s == .waitingToPlayAtSpecifiedRate)
                // A stall this close to the end is the end, not a hiccup.
                if self.buffering, self.nearEnd(within: 2) { self.markEnded() }
            }
            .store(in: &cancellables)
    }

    /// Swap in a new video. A different song `identity` (the key) replaces the
    /// item (a cut), and so does a re-match: the same song with a different
    /// video id. Anything else is ignored, which is what makes "never re-seek"
    /// hold across every poll. In particular the hub serves the live stream
    /// until the download lands and then the cached file at the SAME URL and id,
    /// and that switch must never reload the item mid-song.
    func load(identity: String, videoId: String?, url: URL, videoDurationMs: Int?) {
        if identity == loadedIdentity {
            guard let new = videoId, let old = loadedVideoId, new != old else { return }
        }
        unload()
        loadedIdentity = identity
        loadedVideoId = videoId
        videoDuration = videoDurationMs.flatMap { $0 > 0 ? Double($0) / 1000 : nil }
        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = 0   // system default
        item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak item] status in
                guard let self, let item else { return }
                switch status {
                case .readyToPlay: self.itemReady(item)
                case .failed:      self.failed = true
                default:           break
                }
            }
            .store(in: &itemCancellables)
        NotificationCenter.default
            .publisher(for: .AVPlayerItemDidPlayToEndTime, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.markEnded() }
            .store(in: &itemCancellables)
        player.replaceCurrentItem(with: item)
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.started, self.nearEnd(within: 0.5) else { return }
                self.markEnded()
            }
        }
        watchdog = Task { [weak self] in
            try? await Task.sleep(nanoseconds: Self.loadTimeout)
            guard !Task.isCancelled, let self, !self.ready else { return }
            self.failed = true
        }
    }

    /// Detach everything: the layer goes back to black.
    func unload() {
        watchdog?.cancel()
        itemCancellables.removeAll()
        if let o = timeObserver { player.removeTimeObserver(o); timeObserver = nil }
        videoDuration = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        loadedIdentity = nil
        loadedVideoId = nil
        ready = false
        ended = false
        failed = false
        started = false
    }

    /// Sonos paused or resumed. Pausing freezes the frame; resuming just plays
    /// on (no re-seek, by design).
    func setPlaying(_ playing: Bool) {
        wantsPlay = playing
        guard started, !ended else { return }
        if playing { player.play() } else { player.pause() }
    }

    private func itemReady(_ item: AVPlayerItem) {
        guard !started else { return }
        started = true
        ready = true
        watchdog?.cancel()
        // The one seek: Sonos position now, held just inside the video's end.
        var target = max(0, positionProvider())
        if let dur = videoDuration { target = min(target, max(0, dur - 0.6)) }
        guard target >= 0.5 else {   // the start of the file: nothing to seek to
            resumeIfWanted(item)
            return
        }
        Task { [weak self] in
            _ = await self?.player.seek(to: CMTime(seconds: target, preferredTimescale: 600),
                                        toleranceBefore: .zero, toleranceAfter: .zero)
            self?.resumeIfWanted(item)
        }
    }

    private func nearEnd(within seconds: Double) -> Bool {
        guard let dur = videoDuration, player.currentItem != nil else { return false }
        let t = player.currentTime().seconds
        return t.isFinite && t >= dur - seconds
    }

    /// The video ran out: pause on the last frame (the layer keeps it).
    private func markEnded() {
        guard !ended, started else { return }
        ended = true
        player.pause()
    }

    private func resumeIfWanted(_ item: AVPlayerItem) {
        guard player.currentItem === item, wantsPlay else { return }
        player.play()
    }
}

// MARK: - The layer

/// An AVPlayerLayer-backed view: aspect-fit on black, so a 16:9 video fills a
/// 16:9 screen and anything else letterboxes rather than crops.
struct MusicVideoLayer: UIViewRepresentable {
    let player: AVPlayer

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let v = LayerView()
        v.backgroundColor = .black
        v.playerLayer.videoGravity = .resizeAspect
        v.playerLayer.player = player
        v.isUserInteractionEnabled = false
        return v
    }

    func updateUIView(_ v: LayerView, context: Context) {
        if v.playerLayer.player !== player { v.playerLayer.player = player }
    }
}
