import SwiftUI

// TVSettings - Apple-TV-LOCAL preferences, persisted in UserDefaults.
//
// Deliberately separate from AppModel/AppSettings (which is the read-only
// mirror of the kitchen's settings synced via /api/state). These values are
// intentionally TV-specific and NEVER posted back to the Pi - the kitchen and
// the TV are allowed to diverge here.
//
// Fields:
//   photoDurationSeconds - slideshow dwell per photo on the TV (from a fixed
//                          list of choices; independent of the kitchen)
//   photosMatEnabled     - whether the picture-frame mat is drawn on Photos
//   musicMatMode         - how Now Playing relates to the mat: off (full-bleed),
//                          fit (current layout inside the opening), or framed
//                          (blurred ambient fill + metadata on the mat)
//   selectedAlbumIds     - which Immich albums the TV shows (nil = All albums,
//                          so albums added later are auto-included; an explicit
//                          set after any toggle), independent of the kitchen's
//                          album selection

// How the Now Playing screen treats the picture-frame mat. Raw values are
// persisted, so keep their order stable.
enum MusicMatMode: Int, CaseIterable {
    case off    = 0   // full-bleed, no mat
    case fit    = 1   // current two-column layout, shrunk inside the opening
    case framed = 2   // blurred ambient fill + handwritten metadata on the mat

    var label: String {
        switch self {
        case .off:    return "Off"
        case .fit:    return "Fit"
        case .framed: return "Framed"
        }
    }
}

@MainActor
final class TVSettings: ObservableObject {
    private enum Key {
        static let photoDuration = "tv.photoDurationSeconds"
        static let legacyMatEnabled = "tv.matEnabled"   // pre per-view split
        static let photosMatEnabled = "tv.photosMatEnabled"
        static let musicMatMode = "tv.musicMatMode"
        static let todayMatEnabled = "tv.todayMatEnabled"
        static let legacyAlbumId = "tv.albumId"          // pre multi-select
        static let selectedAlbumIds = "tv.selectedAlbumIds"
    }

    // Allowed photo durations, in seconds (10s ... 24h).
    static let durationChoices = [
        10, 30, 60, 180, 300, 600, 900, 1800,        // 10s,30s,1m,3m,5m,10m,15m,30m
        3600, 7200, 10800, 21600, 43200, 86400        // 1h,2h,3h,6h,12h,24h
    ]

    @Published var photoDurationSeconds: Int {
        didSet { UserDefaults.standard.set(photoDurationSeconds, forKey: Key.photoDuration) }
    }
    @Published var photosMatEnabled: Bool {
        didSet { UserDefaults.standard.set(photosMatEnabled, forKey: Key.photosMatEnabled) }
    }
    @Published var musicMatMode: MusicMatMode {
        didSet { UserDefaults.standard.set(musicMatMode.rawValue, forKey: Key.musicMatMode) }
    }
    @Published var todayMatEnabled: Bool {
        didSet { UserDefaults.standard.set(todayMatEnabled, forKey: Key.todayMatEnabled) }
    }
    // nil = "All albums" (albums added to Immich later are auto-included).
    // Non-nil = the explicit set of album ids to show; empty = show nothing.
    @Published var selectedAlbumIds: Set<String>? {
        didSet {
            if let ids = selectedAlbumIds {
                UserDefaults.standard.set(Array(ids).sorted(), forKey: Key.selectedAlbumIds)
            } else {
                UserDefaults.standard.removeObject(forKey: Key.selectedAlbumIds)
            }
        }
    }

    init() {
        let d = UserDefaults.standard
        let stored = d.object(forKey: Key.photoDuration) as? Int
        // Snap any stored value to the nearest allowed choice; default 30s.
        photoDurationSeconds = Self.nearestChoice(stored ?? 30)
        // Photos mat defaults ON; on upgrade, seed from the old global toggle.
        let legacyMat = d.object(forKey: Key.legacyMatEnabled) as? Bool
        photosMatEnabled = (d.object(forKey: Key.photosMatEnabled) as? Bool)
            ?? legacyMat ?? true
        // Music mat defaults to Framed (the full mat treatment).
        musicMatMode = (d.object(forKey: Key.musicMatMode) as? Int)
            .flatMap(MusicMatMode.init(rawValue:)) ?? .framed
        // Today mat defaults ON (mats are on by default across all views).
        todayMatEnabled = (d.object(forKey: Key.todayMatEnabled) as? Bool) ?? true
        // Album selection; migrate the old single-album picker if present.
        if let stored = d.array(forKey: Key.selectedAlbumIds) as? [String] {
            selectedAlbumIds = Set(stored)
        } else if let legacy = d.string(forKey: Key.legacyAlbumId) {
            selectedAlbumIds = [legacy]
            // didSet does not fire during init; persist the migration by hand.
            d.set([legacy], forKey: Key.selectedAlbumIds)
            d.removeObject(forKey: Key.legacyAlbumId)
        } else {
            selectedAlbumIds = nil   // All albums
        }
    }

    // MARK: - Duration

    static func nearestChoice(_ s: Int) -> Int {
        durationChoices.min(by: { abs($0 - s) < abs($1 - s) }) ?? 30
    }

    func stepDuration(_ dir: Int) {
        let choices = Self.durationChoices
        let i = choices.firstIndex(of: photoDurationSeconds)
            ?? choices.firstIndex(of: Self.nearestChoice(photoDurationSeconds)) ?? 0
        let next = min(choices.count - 1, max(0, i + dir))
        photoDurationSeconds = choices[next]
    }

    var photoDurationLabel: String { Self.label(for: photoDurationSeconds) }

    static func label(for s: Int) -> String {
        if s < 60 { return "\(s) sec" }
        if s < 3600 { return "\(s / 60) min" }
        let h = s / 3600
        return h == 1 ? "1 hour" : "\(h) hours"
    }

    // MARK: - Mat

    var musicMatLabel: String { musicMatMode.label }

    // Step Off -> Fit -> Framed. Left/right clamps at the ends; play/pause wraps.
    func stepMusicMat(_ dir: Int, wrap: Bool = false) {
        let all = MusicMatMode.allCases
        let i = musicMatMode.rawValue
        let next = wrap
            ? (i + dir + all.count) % all.count
            : min(all.count - 1, max(0, i + dir))
        musicMatMode = all[next]
    }

    // MARK: - Albums (multi-select; mirrors the kitchen's toggle semantics)

    // A row reads On when the album is in the selection, and everything reads
    // On in the "All albums" (nil) state.
    func isAlbumOn(_ id: String) -> Bool {
        selectedAlbumIds?.contains(id) ?? true
    }

    // Turn one album on/off. Leaving the All state materializes the full set
    // first; re-selecting the last missing album collapses back to nil so
    // future albums are auto-included again.
    func setAlbum(_ id: String, on: Bool, albums: [PhotoAlbum]) {
        let allIds = Set(albums.map(\.id))
        var sel = selectedAlbumIds ?? allIds
        if on { sel.insert(id) } else { sel.remove(id) }
        selectedAlbumIds = (sel == allIds && !allIds.isEmpty) ? nil : sel
    }

    func toggleAlbum(_ id: String, albums: [PhotoAlbum]) {
        setAlbum(id, on: !isAlbumOn(id), albums: albums)
    }

    // For PhotoService.fetch (nil -> all, [] -> none, ids -> filter).
    var selectedAlbumIdList: [String]? {
        selectedAlbumIds.map { Array($0).sorted() }
    }
}
