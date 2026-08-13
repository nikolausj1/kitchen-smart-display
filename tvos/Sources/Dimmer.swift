import SwiftUI

// Dimmer - software evening/night dimming for the TV (the app's stand-in for
// the Frame TV's ambient light sensor; tvOS exposes no backlight control).
//
// A black overlay at (1 - brightness) opacity dims everything the app draws,
// with a faint warm tint that scales with the dim amount so the mat reads as
// paper in lamplight instead of a cold lit screen.
//
// Modes (TVSettings):
//   autoDim ON  - brightness follows a sunset-anchored curve (an ambient
//                 display never needs full panel brightness - ceiling tuned
//                 by Justin 2026-06-12):
//                   day .................. 0.60
//                   sunset -> +45 min .... ramp to evening (0.40)
//                   22:30 -> +15 min ..... ramp to night (0.20)
//                   night ................ 0.20 until sunrise
//                   sunrise -> +30 min ... ramp back to 0.60
//                 Sunrise/sunset come from Open-Meteo (free, keyless), fetched
//                 twice a day with a fixed 06:30/20:30 fallback, so seasons
//                 are handled without a config in either mode.
//   autoDim OFF - brightness is the user's fixed manualBrightness.
//
// Settings stays readable while adjusting: the overlay never dims below 0.85
// when the Settings view is up. Phase 2 (backlog) swaps the schedule for a
// Home Assistant lux sensor published through the Pi's /api/state.

@MainActor
final class DimModel: ObservableObject {
    // Local-time sun events for today/tomorrow; nil until first fetch.
    @Published private(set) var sunEvents: [(rise: Date, set: Date)] = []
    // Ticks ~every 30s so the curve animates without a per-frame timer.
    @Published private(set) var now = Date()

    private var timer: Timer?
    private var lastFetch: Date?

    // Curve constants (code-tuned; promote to Settings if they prove wrong).
    static let dayBrightness = 0.40
    static let eveningBrightness = 0.20
    static let nightBrightness = 0.10
    static let sunsetRampMinutes = 45.0
    static let nightStartHour = 22
    static let nightStartMinute = 30
    static let nightRampMinutes = 15.0
    static let sunriseRampMinutes = 30.0

    func start(location: LocationSettings) {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick(location: location) }
        }
        tick(location: location)
    }

    private func tick(location: LocationSettings) {
        now = Date()
        if lastFetch == nil || now.timeIntervalSince(lastFetch!) > 12 * 3600 {
            lastFetch = now
            Task { await fetchSunTimes(location: location) }
        }
    }

    // Brightness 0..1 for `at`, per the mode. Pure so it is unit-testable and
    // the overlay can also evaluate "what would auto do" for previews.
    func brightness(at date: Date, autoDim: Bool, manual: Double) -> Double {
        guard autoDim else { return manual }
        let cal = Calendar.current

        // Today's sun events (fallback covers fetch failures + first launch).
        let todays = sunEvents.first(where: { cal.isDate($0.set, inSameDayAs: date) })
        let sunrise = todays?.rise ?? cal.date(
            bySettingHour: 6, minute: 30, second: 0, of: date)!
        let sunset = todays?.set ?? cal.date(
            bySettingHour: 20, minute: 30, second: 0, of: date)!
        let nightStart = cal.date(
            bySettingHour: Self.nightStartHour, minute: Self.nightStartMinute,
            second: 0, of: date)!

        func ramp(from: Double, to: Double, start: Date, minutes: Double) -> Double {
            let t = date.timeIntervalSince(start) / (minutes * 60)
            return from + (to - from) * min(1, max(0, t))
        }

        if date < sunrise {
            return Self.nightBrightness
        }
        if date < sunrise.addingTimeInterval(Self.sunriseRampMinutes * 60) {
            return ramp(from: Self.nightBrightness, to: Self.dayBrightness,
                        start: sunrise, minutes: Self.sunriseRampMinutes)
        }
        if date < sunset {
            return Self.dayBrightness
        }
        if date < nightStart {
            return ramp(from: Self.dayBrightness, to: Self.eveningBrightness,
                        start: sunset, minutes: Self.sunsetRampMinutes)
        }
        return ramp(from: Self.eveningBrightness, to: Self.nightBrightness,
                    start: nightStart, minutes: Self.nightRampMinutes)
    }

    // Open-Meteo daily sunrise/sunset (local time strings for the location's
    // timezone, which is the house's timezone - parse as TimeZone.current).
    private func fetchSunTimes(location: LocationSettings) async {
        var comps = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        comps.queryItems = [
            URLQueryItem(name: "latitude", value: String(location.lat)),
            URLQueryItem(name: "longitude", value: String(location.lon)),
            URLQueryItem(name: "daily", value: "sunrise,sunset"),
            URLQueryItem(name: "timezone", value: location.timezone),
            URLQueryItem(name: "forecast_days", value: "2"),
        ]
        struct Daily: Decodable { var sunrise: [String]; var sunset: [String] }
        struct Resp: Decodable { var daily: Daily }
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url),
              let resp = try? JSONDecoder().decode(Resp.self, from: data) else { return }
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"
        fmt.timeZone = .current
        let events = zip(resp.daily.sunrise, resp.daily.sunset).compactMap {
            (r, s) -> (rise: Date, set: Date)? in
            guard let rise = fmt.date(from: r), let set = fmt.date(from: s) else { return nil }
            return (rise: rise, set: set)
        }
        if !events.isEmpty { sunEvents = events }
    }
}

// Full-screen dimming overlay: warm tint under a black scrim, both scaled by
// the dim amount. Sits above all views; never intercepts the remote.
struct DimOverlay: View {
    @ObservedObject var model: DimModel
    let autoDim: Bool
    let manualBrightness: Double
    let inSettings: Bool

    var body: some View {
        var b = model.brightness(at: model.now, autoDim: autoDim, manual: manualBrightness)
        // Keep Settings readable while adjusting these very settings.
        if inSettings { b = max(b, 0.85) }
        let dim = 1.0 - b
        return ZStack {
            Color(red: 1.0, green: 0.55, blue: 0.25).opacity(dim * 0.12)
            Color.black.opacity(dim)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: 1.5), value: b)
    }
}
