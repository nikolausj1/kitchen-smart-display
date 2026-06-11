import Foundation

// WeatherService - mirrors the web useWeather hook: Open-Meteo hourly forecast
// (no API key), reduced to the configured slot hours that are still upcoming
// today. WMO code -> icon name mapping matches the web app.

struct WeatherSlot: Identifiable, Equatable, Codable {
    var hour: Int
    var label: String
    var temp: Int?
    var icon: String
    var id: Int { hour }
}

// Cache the last good forecast so an Open-Meteo outage doesn't blank the TV.
// Mirrors the web useWeather cache: keep for up to 12h, then ignore as stale.
enum WeatherCache {
    private static let key = "tv.weatherCache"
    private static let maxAgeSec: TimeInterval = 12 * 60 * 60

    struct Entry: Codable { var slots: [WeatherSlot]; var fetchedAt: Date }

    static func read() -> [WeatherSlot]? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let e = try? JSONDecoder().decode(Entry.self, from: data),
              Date().timeIntervalSince(e.fetchedAt) <= maxAgeSec
        else { return nil }
        return e.slots
    }

    static func write(_ slots: [WeatherSlot]) {
        let e = Entry(slots: slots, fetchedAt: Date())
        if let data = try? JSONEncoder().encode(e) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}

private let wmoToIcon: [Int: String] = [
    0: "sunny", 1: "mostly-sunny", 2: "partly-cloudy", 3: "cloudy",
    45: "fog", 48: "fog",
    51: "drizzle", 53: "drizzle", 55: "drizzle",
    61: "rain", 63: "rain", 65: "heavy-rain", 66: "rain", 67: "heavy-rain",
    71: "snow", 73: "snow", 75: "heavy-snow", 77: "snow",
    80: "rain", 81: "rain", 82: "heavy-rain",
    85: "snow", 86: "heavy-snow",
    95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
]

private func iconForWmo(_ code: Int) -> String { wmoToIcon[code] ?? "cloudy" }

private func labelForHour(_ h: Int) -> String {
    let hr = ((h % 24) + 24) % 24
    if hr == 0 { return "12a" }
    if hr == 12 { return "12p" }
    if hr < 12 { return "\(hr)a" }
    return "\(hr - 12)p"
}

// SF Symbol equivalents for the icon names (the web app uses custom PNGs;
// on tvOS we use SF Symbols for a crisp native look).
func sfSymbol(forWeatherIcon icon: String) -> String {
    switch icon {
    case "sunny": return "sun.max.fill"
    case "mostly-sunny": return "sun.max"
    case "partly-cloudy": return "cloud.sun.fill"
    case "cloudy": return "cloud.fill"
    case "fog": return "cloud.fog.fill"
    case "drizzle": return "cloud.drizzle.fill"
    case "rain": return "cloud.rain.fill"
    case "heavy-rain": return "cloud.heavyrain.fill"
    case "snow": return "cloud.snow.fill"
    case "heavy-snow": return "snowflake"
    case "thunderstorm": return "cloud.bolt.rain.fill"
    default: return "cloud.fill"
    }
}

struct WeatherService {
    private struct OpenMeteoResponse: Decodable {
        struct Hourly: Decodable {
            let time: [String]
            let temperature_2m: [Double]
            let weather_code: [Int]
        }
        let hourly: Hourly
    }

    func fetch(location: LocationSettings, slots: [Int]) async -> [WeatherSlot]? {
        var comps = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        comps.queryItems = [
            URLQueryItem(name: "latitude", value: String(location.lat)),
            URLQueryItem(name: "longitude", value: String(location.lon)),
            URLQueryItem(name: "hourly", value: "temperature_2m,weather_code"),
            URLQueryItem(name: "temperature_unit", value: "fahrenheit"),
            URLQueryItem(name: "timezone", value: location.timezone),
            URLQueryItem(name: "forecast_days", value: "2"),
        ]
        guard let url = comps.url,
              let data: OpenMeteoResponse = await fetchJSON(url) else { return nil }

        let times = data.hourly.time
        let temps = data.hourly.temperature_2m
        let codes = data.hourly.weather_code

        // Match the web pickSlots(): index by today's local "YYYY-MM-DDTHH:00"
        // stamp and show ALL configured slot hours (not just upcoming ones).
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        let today = df.string(from: Date())

        return slots.map { h in
            let stamp = "\(today)T\(String(format: "%02d", h)):00"
            let idx = times.firstIndex(of: stamp) ?? -1
            return WeatherSlot(
                hour: h,
                label: labelForHour(h),
                temp: idx >= 0 ? Int(temps[idx].rounded()) : nil,
                icon: idx >= 0 ? iconForWmo(codes[idx]) : "cloudy"
            )
        }
    }
}
