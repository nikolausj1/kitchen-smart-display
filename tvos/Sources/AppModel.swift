import Foundation
import Combine

// AppModel - owns settings (polled from the Pi) and a 1Hz clock tick that
// drives the Today countdown. Weather is fetched by WeatherService and cached
// here. ObservableObject so SwiftUI views update reactively.

@MainActor
final class AppModel: ObservableObject {
    @Published var settings: AppSettings = .defaults
    // Seed from the cached forecast so a launch during an Open-Meteo outage
    // still shows the last good weather instead of nothing.
    @Published var weatherSlots: [WeatherSlot] = WeatherCache.read() ?? []
    @Published var now: Date = Date()
    // Immich album index (for the TV's album picker in Settings).
    @Published var photoAlbums: [PhotoAlbum] = []

    private let weather = WeatherService()
    private var started = false

    func start() async {
        guard !started else { return }
        started = true

        // 1Hz clock for the countdown + clock display.
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                await MainActor.run { self?.now = Date() }
            }
        }

        // Settings: pull now, then every 30s (matches the web useSharedState).
        Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshSettings()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }

        // Weather: pull now, then every 30 min on success / 2 min on failure
        // (matches the web useWeather retry cadence). The faster failure retry
        // means the TV recovers quickly after an Open-Meteo outage instead of
        // waiting a full 30 min.
        Task { [weak self] in
            while !Task.isCancelled {
                let ok = await self?.refreshWeather() ?? false
                let delayMin: UInt64 = ok ? 30 : 2
                try? await Task.sleep(nanoseconds: delayMin * 60 * 1_000_000_000)
            }
        }

        // Album index for the picker: pull now, then every 5 min (matches the
        // manifest refresh cadence).
        Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshAlbums()
                try? await Task.sleep(nanoseconds: 5 * 60 * 1_000_000_000)
            }
        }
    }

    func refreshAlbums() async {
        let albums = await PhotoService().fetchAlbums()
        if albums != photoAlbums { photoAlbums = albums }
    }

    func refreshSettings() async {
        guard let payload: SharedStatePayload = await fetchJSON(AppConfig.stateURL) else { return }
        let merged = payload.merged(into: .defaults)
        if merged != settings { settings = merged }
    }

    // Returns true if a live forecast was fetched (drives the retry cadence).
    @discardableResult
    func refreshWeather() async -> Bool {
        let slots = await weather.fetch(
            location: settings.location,
            slots: settings.weatherSlots
        )
        guard let slots else { return false }   // outage: keep showing cache
        weatherSlots = slots
        WeatherCache.write(slots)
        return true
    }
}

// Small generic JSON GET helper.
func fetchJSON<T: Decodable>(_ url: URL) async -> T? {
    var req = URLRequest(url: url)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    req.timeoutInterval = 8
    do {
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return nil
        }
        return try JSONDecoder().decode(T.self, from: data)
    } catch {
        return nil
    }
}
