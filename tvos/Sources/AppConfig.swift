import Foundation

// Static config + defaults. FrameServer on the NUC (the hub) is the app's only
// LAN dependency: the photo manifest and derivatives, house state (/api/state)
// and the Sonos proxy (/api/sonos/*) all live there. Until 2026-09-24 state and
// Sonos came from the kitchen Pi through a second base URL, since removed; see
// docs/designs/echo-show-and-hub.md.
enum AppConfig {
    // The real Apple TV resolves .local names over mDNS fine. The iOS/tvOS
    // SIMULATOR resolves .local unreliably, so simulator builds use the LAN IP
    // directly. The NUC has a DHCP reservation on the eero, so it stays put -
    // but prefer the mDNS name anywhere it works, because a stale hard-coded IP
    // here is exactly what broke the simulator when the Pi's lease moved from
    // .4.127 to .7.131.
    #if targetEnvironment(simulator)
    // Sim-only override for working against a stub hub: `defaults write
    // <bundle> debug.hubBase http://127.0.0.1:8098`. Unset = the real hub.
    static let photosBase: URL = {
        if let s = UserDefaults.standard.string(forKey: "debug.hubBase"),
           let u = URL(string: s) { return u }
        return URL(string: "http://192.168.4.61:8095")!
    }()
    #else
    static let photosBase = URL(string: "http://nuc.local:8095")!
    #endif
    // photosBase -> FrameServer on the NUC: the manifest, every derivative,
    // /api/state and /api/sonos. The name predates state and Sonos moving to
    // the hub; read it as "the hub's base URL".
    static var stateURL: URL { photosBase.appendingPathComponent("api/state") }
    static func sonos(_ path: String) -> URL {
        // path like "/Main/playpause"
        photosBase.appendingPathComponent("api/sonos").appendingPathComponent(path)
    }
}

// MARK: - Settings model
//
// Mirrors the subset of the hub's /api/state the TV uses (location, school,
// slideshow). The hub composes it: shared location + school from its settings
// registry, plus the kitchen's slideshow. Fields not in /api/state
// (timerThresholds, weatherSlots) use built-in defaults that match the
// kitchen's settings.js DEFAULTS, since they rarely change and are not synced.

struct HourMinute: Codable, Equatable {
    var hour: Int
    var minute: Int
}

struct LocationSettings: Codable, Equatable {
    var lat: Double
    var lon: Double
    var timezone: String

    static let defaults = LocationSettings(lat: 47.6610608, lon: -122.3999576, timezone: "auto")
}

struct SchoolSettings: Codable, Equatable {
    var drivingDepart: HourMinute
    var walkingDepart: HourMinute
    var autoShowAt: HourMinute
    var morningEndsAt: HourMinute
    var schoolDays: [Int]   // 0=Sun ... 6=Sat

    static let defaults = SchoolSettings(
        drivingDepart: HourMinute(hour: 7, minute: 42),
        walkingDepart: HourMinute(hour: 7, minute: 32),
        autoShowAt: HourMinute(hour: 6, minute: 0),
        morningEndsAt: HourMinute(hour: 8, minute: 0),
        schoolDays: [1, 2, 3, 4, 5]
    )
}

struct TimerThresholds: Equatable {
    var greenAbove: Int
    var yellowAbove: Int
    var orangeAbove: Int

    // Matches settings.js DEFAULTS.timerThresholds (post-migration).
    static let defaults = TimerThresholds(greenAbove: 7, yellowAbove: 4, orangeAbove: 0)
}

struct SlideshowSettings: Codable, Equatable {
    var intervalMs: Int
    var sortOrder: String        // 'random' | 'date-taken' | 'date-added'
    var displayMode: String      // 'fill' | 'fit' | 'smart'
    var smartCropLossThreshold: Double
    var autoDismissExif: Bool
    var exifVisibleSeconds: Int
    var selectedAlbumIds: [String]?
    var smartFaces: Bool

    static let defaults = SlideshowSettings(
        intervalMs: 6000,
        sortOrder: "random",
        displayMode: "smart",
        smartCropLossThreshold: 0.15,
        autoDismissExif: true,
        exifVisibleSeconds: 5,
        selectedAlbumIds: nil,
        smartFaces: true
    )
}

// The house countdown as the hub derives it (/api/state.timer), the same one
// every screen shows. nil = no timer state available (idle fallback).
struct KitchenTimer: Equatable {
    var active: Bool
    var travelMode: String     // "driving" | "walking"
    var target: Date?          // parsed from targetISO
    var kind: String?          // "default" | "manual" | nil
}

struct AppSettings: Equatable {
    var location: LocationSettings
    var school: SchoolSettings
    var timerThresholds: TimerThresholds
    var weatherSlots: [Int]
    var slideshow: SlideshowSettings
    var kitchenTimer: KitchenTimer?    // nil = idle / not posted
    // From the hub's /api/state: true on holidays/breaks/summer so the TV skips
    // the Today auto-boot. The hub derives it from the shared school settings
    // and the school calendar, so every screen agrees.
    var noSchoolToday: Bool

    static let defaults = AppSettings(
        location: .defaults,
        school: .defaults,
        timerThresholds: .defaults,
        weatherSlots: [8, 11, 14, 17, 20],
        slideshow: .defaults,
        kitchenTimer: nil,
        noSchoolToday: false
    )
}

// Decoding helper: the TV reads only these keys of /api/state (the hub also
// sends countdown and travelDefault, already folded into timer), each possibly
// absent. Decode leniently, falling back to defaults per field.
struct SharedStatePayload: Decodable {
    var location: LocationSettings?
    var school: SchoolSettingsLenient?
    var slideshow: SlideshowLenient?
    var timer: TimerLenient?
    var noSchoolToday: Bool?

    struct SchoolSettingsLenient: Decodable {
        var drivingDepart: HourMinute?
        var walkingDepart: HourMinute?
        var autoShowAt: HourMinute?
        var morningEndsAt: HourMinute?
        var schoolDays: [Int]?
    }

    struct SlideshowLenient: Decodable {
        var intervalMs: Int?
        var sortOrder: String?
        var displayMode: String?
        var smartCropLossThreshold: Double?
        var autoDismissExif: Bool?
        var exifVisibleSeconds: Int?
        var selectedAlbumIds: [String]?
        var smartFaces: Bool?
    }

    struct TimerLenient: Decodable {
        var active: Bool?
        var travelMode: String?
        var targetISO: String?
        var kind: String?
    }

    func merged(into base: AppSettings) -> AppSettings {
        var out = base
        if let loc = location { out.location = loc }
        if let s = school {
            var sc = out.school
            if let v = s.drivingDepart { sc.drivingDepart = v }
            if let v = s.walkingDepart { sc.walkingDepart = v }
            if let v = s.autoShowAt { sc.autoShowAt = v }
            if let v = s.morningEndsAt { sc.morningEndsAt = v }
            if let v = s.schoolDays { sc.schoolDays = v }
            out.school = sc
        }
        if let s = slideshow {
            var ss = out.slideshow
            if let v = s.intervalMs { ss.intervalMs = v }
            if let v = s.sortOrder { ss.sortOrder = v }
            if let v = s.displayMode { ss.displayMode = v }
            if let v = s.smartCropLossThreshold { ss.smartCropLossThreshold = v }
            if let v = s.autoDismissExif { ss.autoDismissExif = v }
            if let v = s.exifVisibleSeconds { ss.exifVisibleSeconds = v }
            // selectedAlbumIds: distinguish "absent" from "explicitly set".
            ss.selectedAlbumIds = s.selectedAlbumIds ?? ss.selectedAlbumIds
            if let v = s.smartFaces { ss.smartFaces = v }
            out.slideshow = ss
        }
        // Kitchen timer. Absent -> nil (idle fallback). Present -> mirror.
        if let t = timer {
            out.kitchenTimer = KitchenTimer(
                active: t.active ?? false,
                travelMode: t.travelMode ?? "driving",
                target: t.targetISO.flatMap { Self.parseISO($0) },
                kind: t.kind
            )
        }
        if let ns = noSchoolToday { out.noSchoolToday = ns }
        return out
    }

    // ISO-8601 with fractional seconds (JS Date.toISOString()).
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static func parseISO(_ s: String) -> Date? {
        if let d = isoFormatter.date(from: s) { return d }
        // Fallback without fractional seconds.
        let f = ISO8601DateFormatter()
        return f.date(from: s)
    }
}
