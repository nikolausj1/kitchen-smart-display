import SwiftUI

// MusicVideosView - the Music Videos backdrop (docs/designs/music-videos.md).
// Replaces the whole Framed layout the way Mixtape does (NowPlayingView's body
// switch): full bleed, no mat, no cover. It is the glue between the three
// pieces and owns neither look nor transport:
//   MusicVideoFeed    asks the hub what is playing and whether a video exists
//   MusicVideoPlayer  holds the muted AVPlayer and seeks it once
//   MusicVideoStates  draws whichever state the scene is in
// The feed is owned by the shell (so the center-button long press can mark the
// current video wrong); this view only starts and stops its polling.

struct MusicVideosView: View {
    /// The shell's Sonos state: only the fallback for a hub that is not answering.
    let sonosState: SonosState
    @ObservedObject var feed: MusicVideoFeed
    @StateObject private var engine = MusicVideoPlayer()
    @State private var palette: [Color] = []
    @State private var lowerThirdVisible = false
    @State private var lowerThirdToken = 0

    private static let lowerThirdSeconds: UInt64 = 4

    // MARK: - Scene

    private var track: MusicVideoTrack? {
        if let t = feed.now?.track, let key = t.key, !key.isEmpty {
            return MusicVideoTrack(
                key: key,
                title: t.title ?? "", artist: t.artist ?? "", album: t.album ?? "",
                station: t.station ?? "",
                albumArtURL: MusicVideoFeed.artURL(t.albumArtUrl),
                durationMs: t.durationMs ?? 0, elapsedMs: t.elapsedMs ?? 0,
                playing: t.playing ?? true, isAd: t.isAd ?? false)
        }
        // No hub answer yet (or it is down): the TV's own Sonos poll can still
        // name the song, so the test pattern has something to say.
        if feed.now == nil, let t = sonosState.track {
            return MusicVideoTrack(
                key: "", title: t.title, artist: t.artist, album: t.album,
                station: sonosState.stationName, albumArtURL: t.albumArtURL,
                durationMs: t.durationMs, elapsedMs: t.elapsedMs,
                playing: sonosState.playing, isAd: false)
        }
        return nil
    }

    /// The hub's verdict, except that a long press overrides it with
    /// "resolving" until the re-match lands.
    private var video: VideoNow.Video? {
        if let pending = feed.wrongPendingKey, pending == feed.currentKey {
            return VideoNow.Video(status: "resolving")
        }
        return feed.now?.video
    }

    private var scene: MusicVideoScene {
        MusicVideoScene(
            track: track,
            palette: palette,
            video: video,
            player: MusicVideoPlayerState(ready: engine.ready, ended: engine.ended,
                                          failed: engine.failed, buffering: engine.buffering),
            hubUnreachable: feed.now == nil && feed.failures >= 3,
            lowerThirdVisible: lowerThirdVisible)
    }

    var body: some View {
        MusicVideoSceneView(scene: scene) {
            MusicVideoLayer(player: engine.player)
        }
        .ignoresSafeArea()
        .onAppear {
            engine.positionProvider = { [feed] in feed.sonosPositionSeconds() }
            feed.start()
            reconcile()
            #if targetEnvironment(simulator)
            // Sim-only: the simulator cannot hold the Siri Remote's center
            // button, so `defaults write <bundle> debug.wrongAfter -float 8`
            // fires the long press's action (POST /api/video/wrong) that many
            // seconds after the view appears.
            let after = UserDefaults.standard.double(forKey: "debug.wrongAfter")
            if after > 0 {
                Task {
                    try? await Task.sleep(nanoseconds: UInt64(after * 1_000_000_000))
                    feed.reportWrong()
                }
            }
            #endif
        }
        .onDisappear {
            feed.stop()
            engine.unload()
        }
        .onChange(of: feed.now) { _, _ in reconcile() }
        .onChange(of: feed.wrongPendingKey) { _, _ in reconcile() }
        .onChange(of: feed.now?.track?.key, initial: true) { _, key in
            guard let key, !key.isEmpty else { return }
            showLowerThird()
        }
        .task(id: track?.albumArtURL) {
            guard let url = track?.albumArtURL else { palette = []; return }
            palette = await AlbumPalette.extract(from: url)
        }
    }

    // MARK: - Engine

    /// Line the player up with the hub's answer. A video is attached only for
    /// a ready match; a new song or a re-match (new video id) replaces the item
    /// (one seek each) and a routine poll changes nothing, including the hub's
    /// stream-to-cache switch for the same song.
    private func reconcile() {
        guard let key = feed.now?.track?.key, !key.isEmpty,
              feed.now?.video?.status == "ready",
              feed.wrongPendingKey != key,
              let url = MusicVideoFeed.videoURL(feed.now?.video?.url) else {
            engine.unload()
            return
        }
        let v = feed.now?.video
        engine.load(identity: key, videoId: v?.videoId, url: url,
                    videoDurationMs: v?.videoDurationMs)
        engine.setPlaying(feed.now?.track?.playing ?? true)
    }

    /// The lower-third on a track change: up now, down after four seconds.
    private func showLowerThird() {
        lowerThirdToken += 1
        let token = lowerThirdToken
        lowerThirdVisible = true
        Task {
            try? await Task.sleep(nanoseconds: Self.lowerThirdSeconds * 1_000_000_000)
            if token == lowerThirdToken { lowerThirdVisible = false }
        }
    }
}

extension VideoNow.Video {
    init(status: String) {
        self.init(status: status, reason: nil, url: nil, source: nil, videoId: nil,
                  videoTitle: nil, channel: nil, videoDurationMs: nil, thumbUrl: nil)
    }
}
