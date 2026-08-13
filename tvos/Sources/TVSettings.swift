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
//   autoDim              - sunset-anchored evening/night dimming (the software
//                          stand-in for the Frame's light sensor; see Dimmer.swift)
//   manualBrightness     - fixed brightness when autoDim is OFF (1.0 = full)
//   artFacts             - show a rotating curated fun fact on the mat while
//                          an artwork is up (one per showing, bottom-center)

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

// How artworks render inside the mat on the Photos view. Raw values are
// persisted, so keep their order stable.
enum ArtDisplay: Int, CaseIterable {
    case shadowBox = 0   // blurred wash + canvas floating with a soft shadow
    case fill      = 1   // canvas fills the opening edge-to-edge (cropped),
                         // like a mat cut exactly for the piece
    case fillMusic = 2   // fill + the Now Playing presence (album-art corner
                         // and track lines bottom-right; year/movement move
                         // to the mat's bottom-center, fun fact suppressed).
                         // Only reachable from the remote while music plays;
                         // renders as plain Fill when nothing is playing.

    var label: String {
        switch self {
        case .shadowBox: return "Shadow Box"
        case .fill:      return "Fill"
        case .fillMusic: return "Fill + Music"
        }
    }
}

// What fills the mat opening behind the cover in Framed music mode, ordered
// subtle -> aggressive (Justin's curation). Raw values are persisted; the
// 2026-06-11 reorder (Marble to last, Ink renamed Smoke, Ripple added) was a
// one-time remap of stored values - keep them stable from here.
enum FramedBackdrop: Int, CaseIterable {
    case still    = 0   // the original static blurred wash
    case drift    = 1   // the wash on a slow Lissajous wander + scale breathe
    case lava     = 2   // palette-extracted color blobs on slow orbits
    case smoke    = 3   // Metal shader: palette colors billowing like smoke
    case caustics = 4   // Metal shader: sunlit-pool light webs in palette colors
    case ripple   = 5   // Metal shader: sound-waves of palette color radiating
                        // out from behind the cover, prismatic crests
    case bars     = 6   // Metal shader: faux EQ bars in palette colors
                        // (noise-driven - Sonos exposes no audio analysis)
    case marble   = 7   // Metal shader: scrambled album texture folding like
                        // stirred paint (the most aggressive)

    var label: String {
        switch self {
        case .still:    return "Still"
        case .drift:    return "Drift"
        case .lava:     return "Lava"
        case .smoke:    return "Smoke"
        case .caustics: return "Caustics"
        case .ripple:   return "Ripple"
        case .bars:     return "Bars"
        case .marble:   return "Marble"
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
        static let autoDim = "tv.autoDim"
        static let manualBrightness = "tv.manualBrightness"
        static let artFacts = "tv.artFacts"
        static let framedBackdrop = "tv.framedBackdrop"
        static let artDisplay = "tv.artDisplay"
    }

    // Manual brightness choices (fraction of full). 0.2 is still readable in a
    // dark room; full list keeps the left/right stepper grammar.
    static let brightnessChoices: [Double] = [
        0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6,
        0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0,
    ]

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
    @Published var autoDim: Bool {
        didSet { UserDefaults.standard.set(autoDim, forKey: Key.autoDim) }
    }
    // Effective only when autoDim is OFF (the Brightness row reads "Auto"
    // otherwise). 1.0 = no dimming.
    @Published var manualBrightness: Double {
        didSet { UserDefaults.standard.set(manualBrightness, forKey: Key.manualBrightness) }
    }
    @Published var artFacts: Bool {
        didSet { UserDefaults.standard.set(artFacts, forKey: Key.artFacts) }
    }
    @Published var framedBackdrop: FramedBackdrop {
        didSet { UserDefaults.standard.set(framedBackdrop.rawValue, forKey: Key.framedBackdrop) }
    }
    @Published var artDisplay: ArtDisplay {
        didSet { UserDefaults.standard.set(artDisplay.rawValue, forKey: Key.artDisplay) }
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
        // Auto Dim defaults ON - the whole point is hands-off evening dimming.
        autoDim = (d.object(forKey: Key.autoDim) as? Bool) ?? true
        manualBrightness = (d.object(forKey: Key.manualBrightness) as? Double) ?? 1.0
        // Art facts default ON - the educational half of the art feature.
        artFacts = (d.object(forKey: Key.artFacts) as? Bool) ?? true
        // Framed music backdrop defaults to the new lava blobs.
        framedBackdrop = (d.object(forKey: Key.framedBackdrop) as? Int)
            .flatMap(FramedBackdrop.init(rawValue:)) ?? .lava
        // Art rendering defaults to the shadow box (the chosen-from-comps look).
        artDisplay = (d.object(forKey: Key.artDisplay) as? Int)
            .flatMap(ArtDisplay.init(rawValue:)) ?? .shadowBox
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

    // MARK: - Art display

    var artDisplayLabel: String { artDisplay.label }

    // Center-button cycle on the Photos view. Fill + Music only makes sense
    // with a track up, so it is only in the rotation while music plays;
    // otherwise the button just swaps Shadow Box <-> Fill (and exits
    // Fill + Music if the mode was left set when the music stopped).
    func cycleArtDisplay(musicActive: Bool) {
        if musicActive {
            switch artDisplay {
            case .shadowBox: artDisplay = .fill
            case .fill:      artDisplay = .fillMusic
            case .fillMusic: artDisplay = .shadowBox
            }
        } else {
            artDisplay = (artDisplay == .shadowBox) ? .fill : .shadowBox
        }
    }

    // Settings-row stepping (all three values selectable deliberately there;
    // Fill + Music simply renders as Fill until a track plays).
    func stepArtDisplay(_ dir: Int, wrap: Bool = false) {
        let all = ArtDisplay.allCases
        let i = artDisplay.rawValue
        let next = wrap
            ? (i + dir + all.count) % all.count
            : min(all.count - 1, max(0, i + dir))
        artDisplay = all[next]
    }

    // MARK: - Framed backdrop

    var framedBackdropLabel: String { framedBackdrop.label }

    // Step Still -> Drift -> Lava. Left/right clamps; play/pause wraps.
    func stepFramedBackdrop(_ dir: Int, wrap: Bool = false) {
        let all = FramedBackdrop.allCases
        let i = framedBackdrop.rawValue
        let next = wrap
            ? (i + dir + all.count) % all.count
            : min(all.count - 1, max(0, i + dir))
        framedBackdrop = all[next]
    }

    // MARK: - Brightness (manual mode)

    func stepBrightness(_ dir: Int) {
        let choices = Self.brightnessChoices
        let i = choices.firstIndex(where: { abs($0 - manualBrightness) < 0.001 })
            ?? choices.count - 1
        let next = min(choices.count - 1, max(0, i + dir))
        manualBrightness = choices[next]
    }

    var brightnessLabel: String { "\(Int((manualBrightness * 100).rounded()))%" }
}
