import Foundation

// Static config + defaults. The Pi host is where the kitchen kiosk server
// runs; /api/state and /api/sonos are served from the same origin.
enum AppConfig {
    // The real Apple TV resolves smartdisplay.local over mDNS fine. The iOS/
    // tvOS SIMULATOR resolves .local unreliably, so for simulator builds we use
    // the Pi's LAN IP directly. (Update SIM_PI_IP if the Pi's DHCP lease moves;
    // it's only used in the simulator dev loop, never in shipped builds.)
    #if targetEnvironment(simulator)
    static let piBase = URL(string: "http://192.168.4.127:8080")!
    #else
    static let piBase = URL(string: "http://smartdisplay.local:8080")!
    #endif
    static var stateURL: URL { piBase.appendingPathComponent("api/state") }
    static func sonos(_ path: String) -> URL {
        // path like "/Main/playpause"
        piBase.appendingPathComponent("api/sonos").appendingPathComponent(path)
    }
}

// MARK: - Settings model
//
// Mirrors the synced subset the kitchen POSTs to /api/state
// (location, school, slideshow). Fields not in the synced subset
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

struct AppSettings: Equatable {
    var location: LocationSettings
    var school: SchoolSettings
    var timerThresholds: TimerThresholds
    var weatherSlots: [Int]
    var slideshow: SlideshowSettings

    static let defaults = AppSettings(
        location: .defaults,
        school: .defaults,
        timerThresholds: .defaults,
        weatherSlots: [8, 11, 14, 17, 20],
        slideshow: .defaults
    )
}

// Decoding helper: /api/state returns only the synced keys, each possibly
// absent. Decode leniently, falling back to defaults per field.
struct SharedStatePayload: Decodable {
    var location: LocationSettings?
    var school: SchoolSettingsLenient?
    var slideshow: SlideshowLenient?

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
        return out
    }
}
