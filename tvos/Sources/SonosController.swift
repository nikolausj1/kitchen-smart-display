import Foundation

// SonosController - polls Sonos state through the Pi /api/sonos proxy and
// exposes transport actions. Mirrors useSonosState.js: reads /zones, finds the
// configured room's group coordinator, and parses its state. Room is "Main"
// (the synced/hardcoded default per the PRD).

struct NowPlayingTrack: Equatable {
    var title: String
    var artist: String
    var album: String
    var albumArtURL: URL?
    var durationMs: Int
    var elapsedMs: Int
}

struct SonosState: Equatable {
    var playing: Bool
    var paused: Bool
    var track: NowPlayingTrack?
    var stationName: String
    var volume: Int
    var loaded: Bool

    static let empty = SonosState(playing: false, paused: false, track: nil,
                                  stationName: "", volume: 0, loaded: false)
}

@MainActor
final class SonosController: ObservableObject {
    @Published var state: SonosState = .empty
    // Timestamp of the last poll that observed playback. Lets the Photos view
    // show the album-art corner for a while after music stops (matches the
    // kitchen's getLastPlayingAt behavior).
    @Published private(set) var lastPlayingAt: Date?

    private let room = "Main"
    private var timer: Timer?

    // True if Sonos is playing now, or stopped within the last `within` seconds.
    func recentlyPlaying(within: TimeInterval = 300) -> Bool {
        if state.playing { return true }
        guard let t = lastPlayingAt else { return false }
        return Date().timeIntervalSince(t) <= within
    }

    func start() {
        Task { await poll() }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.poll() }
        }
    }

    func stop() { timer?.invalidate(); timer = nil }

    // MARK: - Transport (fire-and-forget GETs through the proxy)

    func play()      { send("/play") }
    func pause()     { send("/pause") }
    func playPause() { state.playing ? pause() : play() }
    func next()      { send("/next") }
    func previous()  { send("/previous") }
    func volumeUp()  { send("/volume/+5") }
    func volumeDown(){ send("/volume/-5") }

    private func send(_ path: String) {
        let url = AppConfig.piBase
            .appendingPathComponent("api/sonos")
            .appendingPathComponent(room)
            .appendingPathComponent(String(path.dropFirst()))
        Task {
            var req = URLRequest(url: url)
            req.cachePolicy = .reloadIgnoringLocalCacheData
            _ = try? await URLSession.shared.data(for: req)
            // Nudge state quickly after an action instead of waiting for the tick.
            await poll()
        }
    }

    // MARK: - Polling

    private func poll() async {
        let zonesURL = AppConfig.piBase
            .appendingPathComponent("api/sonos")
            .appendingPathComponent("zones")
        guard let groups: [Zone] = await fetchJSON(zonesURL) else { return }
        guard let coord = findCoordinator(groups, room: room) else { return }
        state = parse(coord)
        if state.playing { lastPlayingAt = Date() }
    }

    private func findCoordinator(_ groups: [Zone], room: String) -> ZonePlayer? {
        for g in groups {
            let members = g.members ?? []
            if members.contains(where: { $0.roomName == room }) {
                return g.coordinator
            }
        }
        return nil
    }

    private func parse(_ co: ZonePlayer) -> SonosState {
        let s = co.state
        let t = s?.currentTrack
        var track: NowPlayingTrack? = nil
        if let t, !(t.title ?? "").isEmpty || !(t.artist ?? "").isEmpty || !(t.album ?? "").isEmpty {
            track = NowPlayingTrack(
                title: t.title ?? "",
                artist: t.artist ?? "",
                album: t.album ?? "",
                albumArtURL: resolveArt(t),
                durationMs: (t.duration ?? 0) * 1000,
                elapsedMs: (s?.elapsedTime ?? 0) * 1000
            )
        }
        return SonosState(
            playing: s?.playbackState == "PLAYING",
            paused: s?.playbackState == "PAUSED_PLAYBACK",
            track: track,
            stationName: cleanStation(t?.stationName ?? ""),
            volume: s?.volume ?? 0,
            loaded: true
        )
    }

    // Prefer the absolute player URL (LAN-reachable from the Apple TV); else
    // proxy a relative art path through the Pi.
    private func resolveArt(_ t: TrackJSON) -> URL? {
        if let abs = t.absoluteAlbumArtUri, abs.hasPrefix("http") { return URL(string: abs) }
        guard let rel = t.albumArtUri, !rel.isEmpty else { return nil }
        if rel.hasPrefix("http") { return URL(string: rel) }
        return URL(string: AppConfig.piBase.absoluteString + "/api/sonos/" + rel.drop(while: { $0 == "/" }))
    }

    private func cleanStation(_ name: String) -> String {
        // Strip Pandora's "(My Station)" / "(Shared)" suffix, matching the web.
        guard !name.isEmpty else { return "" }
        if let r = name.range(of: #"\s*\((My Station|Shared)\)\s*$"#, options: .regularExpression) {
            return String(name[..<r.lowerBound]).trimmingCharacters(in: .whitespaces)
        }
        return name
    }
}

// MARK: - JSON shapes (subset of node-sonos-http-api /zones)

struct Zone: Decodable {
    var coordinator: ZonePlayer?
    var members: [ZoneMember]?
}
struct ZoneMember: Decodable {
    var roomName: String?
}
struct ZonePlayer: Decodable {
    var roomName: String?
    var state: PlayerState?
}
struct PlayerState: Decodable {
    var volume: Int?
    var elapsedTime: Int?
    var playbackState: String?
    var currentTrack: TrackJSON?
}
struct TrackJSON: Decodable {
    var artist: String?
    var title: String?
    var album: String?
    var albumArtUri: String?
    var absoluteAlbumArtUri: String?
    var duration: Int?
    var stationName: String?
}
