import Foundation
import os

// MusicVideoFeed - the Apple TV's view of the hub's video resolver
// (docs/designs/music-videos.md, "The hub resolver"). While Music Videos is on
// screen it asks GET /api/video/now?room=Main every 2 s; that call is also the
// hub's demand signal, so it stops when the view goes away and the hub stops
// polling Sonos for it ~60 s later. The hub reads the zone itself, so the TV
// never sends metadata; the only thing it POSTs is "wrong" (long press).
//
// Every field is optional on purpose: the hub is another worker's moving part
// and a missing key must degrade to a state, not to a failed decode.

/// What GET /api/video/now returns. Shapes follow the shared contract.
struct VideoNow: Decodable, Equatable {
    var configured: Bool?
    var room: String?
    var track: Track?
    var video: Video?
    var next: Next?

    struct Track: Decodable, Equatable {
        var key: String?
        var artist: String?
        var title: String?
        var album: String?
        var station: String?
        var favoriteName: String?
        var favoriteAllowed: Bool?
        var durationMs: Int?
        var elapsedMs: Int?
        /// When the hub sampled elapsedMs. Epoch ms or seconds, or an ISO-8601
        /// string; the contract does not pin the encoding, so all are accepted.
        var elapsedAt: Date?
        var albumArtUrl: String?
        var isAd: Bool?
        var playing: Bool?

        enum CodingKeys: String, CodingKey {
            case key, artist, title, album, station, favoriteName, favoriteAllowed
            case durationMs, elapsedMs, elapsedAt, albumArtUrl, isAd, playing
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            key = try? c.decodeIfPresent(String.self, forKey: .key)
            artist = try? c.decodeIfPresent(String.self, forKey: .artist)
            title = try? c.decodeIfPresent(String.self, forKey: .title)
            album = try? c.decodeIfPresent(String.self, forKey: .album)
            station = try? c.decodeIfPresent(String.self, forKey: .station)
            favoriteName = try? c.decodeIfPresent(String.self, forKey: .favoriteName)
            favoriteAllowed = try? c.decodeIfPresent(Bool.self, forKey: .favoriteAllowed)
            durationMs = Self.int(c, .durationMs)
            elapsedMs = Self.int(c, .elapsedMs)
            elapsedAt = Self.date(c, .elapsedAt)
            albumArtUrl = try? c.decodeIfPresent(String.self, forKey: .albumArtUrl)
            isAd = try? c.decodeIfPresent(Bool.self, forKey: .isAd)
            playing = try? c.decodeIfPresent(Bool.self, forKey: .playing)
        }

        // JS numbers arrive as 1234 or 1234.5; accept either.
        private static func int(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Int? {
            if let i = try? c.decodeIfPresent(Int.self, forKey: k) { return i }
            if let d = try? c.decodeIfPresent(Double.self, forKey: k) { return Int(d) }
            return nil
        }

        private static func date(_ c: KeyedDecodingContainer<CodingKeys>, _ k: CodingKeys) -> Date? {
            if let d = try? c.decodeIfPresent(Double.self, forKey: k) {
                // Milliseconds since 1970 (Date.now()) vs seconds.
                return Date(timeIntervalSince1970: d > 1e11 ? d / 1000 : d)
            }
            if let s = try? c.decodeIfPresent(String.self, forKey: k) {
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let d = f.date(from: s) { return d }
                return ISO8601DateFormatter().date(from: s)
            }
            return nil
        }
    }

    struct Video: Decodable, Equatable {
        /// ready | resolving | none | denied | ad | idle | error
        var status: String?
        var reason: String?
        /// Hub-relative, e.g. /api/video/play/<encodedKey>.
        var url: String?
        var source: String?
        var videoId: String?
        var videoTitle: String?
        var channel: String?
        var videoDurationMs: Int?
        var thumbUrl: String?
    }

    struct Next: Decodable, Equatable {
        var key: String?
        var artist: String?
        var title: String?
        var status: String?
    }
}

@MainActor
final class MusicVideoFeed: ObservableObject {
    /// The latest answer from the hub; nil until the first one (or while the
    /// hub is unreachable and nothing has ever come back).
    @Published private(set) var now: VideoNow?
    /// When `now` arrived on this device, the anchor for the position math.
    @Published private(set) var receivedAt = Date()
    /// Consecutive failed polls; the scene shows a test pattern at 3.
    @Published private(set) var failures = 0
    /// Set from the moment "wrong" is pressed until the hub's re-match lands,
    /// so the screen goes to Resolving at once instead of after the next poll.
    @Published private(set) var wrongPendingKey: String?

    private static let log = Logger(subsystem: "com.nikolaus.kitchendisplay.tv", category: "musicvideos")
    private let room = "Main"
    private var loop: Task<Void, Never>?

    /// The song the hub says is current (what a long press marks wrong).
    var currentKey: String? { now?.track?.key }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.poll()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    private var nowURL: URL? {
        var c = URLComponents(url: AppConfig.photosBase.appendingPathComponent("api/video/now"),
                              resolvingAgainstBaseURL: false)
        c?.queryItems = [URLQueryItem(name: "room", value: room)]
        return c?.url
    }

    private func poll() async {
        guard let url = nowURL else { return }
        if let fresh: VideoNow = await fetchJSON(url) {
            receivedAt = Date()
            failures = 0
            if let pending = wrongPendingKey, fresh.track?.key != pending {
                // The song changed under the press; drop the Resolving override.
                // (Otherwise reportWrong clears it once the hub has answered, so
                // a poll already in flight cannot flash the denied video back.)
                wrongPendingKey = nil
            }
            // The hub answers "error" (with a reason) when Sonos is unreachable;
            // it draws like "none", but the reason belongs in the log.
            if fresh.video?.status == "error", fresh.video != now?.video {
                Self.log.error("hub video error: \(fresh.video?.reason ?? "no reason", privacy: .public)")
            }
            if fresh != now { now = fresh }
        } else {
            failures += 1
        }
    }

    /// Long press on the remote's center button: deny this song's current
    /// match and ask the hub for the next candidate (POST /api/video/wrong).
    /// Returns false when there was nothing to mark.
    @discardableResult
    func reportWrong() -> Bool {
        guard let key = currentKey, !key.isEmpty else { return false }
        wrongPendingKey = key
        Task { [weak self] in
            guard let self else { return }
            var req = URLRequest(url: AppConfig.photosBase.appendingPathComponent("api/video/wrong"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["key": key])
            req.timeoutInterval = 20
            _ = try? await URLSession.shared.data(for: req)
            // Pull the re-match now rather than waiting out the 2 s tick.
            await self.poll()
            if self.wrongPendingKey == key { self.wrongPendingKey = nil }
        }
        return true
    }

    /// Where Sonos is in the current song right now, in seconds: the hub's
    /// elapsed sample plus the time since it was taken, clamped to 0...20 s so
    /// a skewed clock cannot throw the seek across the song. Frozen while
    /// Sonos is paused.
    func sonosPositionSeconds(at date: Date = Date()) -> Double {
        guard let t = now?.track else { return 0 }
        let base = Double(t.elapsedMs ?? 0) / 1000
        guard t.playing ?? true else { return base }
        let sampled = t.elapsedAt ?? receivedAt
        return base + min(20, max(0, date.timeIntervalSince(sampled)))
    }

    /// The album art as a URL: absolute as sent, or a hub-relative path.
    static func artURL(_ s: String?) -> URL? {
        guard let s, !s.isEmpty else { return nil }
        if s.hasPrefix("http") { return URL(string: s) }
        return URL(string: AppConfig.photosBase.absoluteString + (s.hasPrefix("/") ? s : "/" + s))
    }

    /// The hub-relative video path as a playable URL.
    static func videoURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: AppConfig.photosBase.absoluteString + (path.hasPrefix("/") ? path : "/" + path))
    }
}
