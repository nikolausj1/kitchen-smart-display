import SwiftUI

// TodayView - native tvOS port of the kitchen Today view, matching the Figma
// design (figma-exports/Today-*.png) and the web CSS in
// code/src/views/TodayView/*.
//
// Layout: two columns (~2946:2207). Left column stacks a time/date panel over
// a weather panel; right column is a full-height timer panel that fills with
// the band color (green/yellow/orange/red) when a departure timer is active,
// or a dark "NO TIMER" panel otherwise. Dark panels are #212528 on black with
// SHARP corners. The TV is read-only: the travel pill shows the current mode
// (driving) but isn't tappable; the SET pill is shown for visual parity only.

// Palette (from TimerPanel.css / TodayView.css).
private enum Palette {
    static let bg = Color.black
    static let panel = Color(red: 0x21/255, green: 0x25/255, blue: 0x28/255)
    static let green = Color(red: 0x2d/255, green: 0xe3/255, blue: 0x68/255)
    static let yellow = Color(red: 0xff/255, green: 0xfb/255, blue: 0x00/255)
    static let orange = Color(red: 0xff/255, green: 0xa1/255, blue: 0x00/255)
    static let red = Color(red: 0xea/255, green: 0x03/255, blue: 0x03/255)
}

private func bandColor(_ band: TimerBand) -> Color {
    switch band {
    case .green: return Palette.green
    case .yellow: return Palette.yellow
    case .orange: return Palette.orange
    case .red: return Palette.red
    }
}

struct TodayView: View {
    @EnvironmentObject var model: AppModel

    private var departure: DepartureState {
        computeDeparture(settings: model.settings, mode: .driving, now: model.now)
    }

    var body: some View {
        GeometryReader { geo in
            // Scale type to the render size (design is authored against a
            // 1920-wide reference; tvOS renders at 1920x1080 for 1080p).
            let W = geo.size.width
            let gap = W * 0.0126

            HStack(spacing: gap) {
                // Left column: time/date over weather (~2946 of 5153 units).
                VStack(spacing: geo.size.height * 0.0197) {
                    TimeDatePanel(width: W).frame(maxHeight: .infinity)
                    WeatherPanel(slots: model.weatherSlots, width: W)
                        .frame(maxHeight: .infinity)
                }
                .frame(width: (W - gap) * (2946.0 / 5153.0))

                // Right column: timer panel fills remaining width + full height.
                TimerPanel(departure: departure, width: W)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .padding(.horizontal, W * 0.0094)
            .padding(.vertical, geo.size.height * 0.012)
            .frame(width: geo.size.width, height: geo.size.height)
            .background(Palette.bg)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Time / date panel

private struct TimeDatePanel: View {
    @EnvironmentObject var model: AppModel
    let width: CGFloat

    private static let dayNames = ["SUN","MON","TUE","WED","THU","FRI","SAT"]
    private static let monthNames = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
                                     "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"]

    private var timeText: String {
        let cal = Calendar.current
        let h = cal.component(.hour, from: model.now)
        let m = cal.component(.minute, from: model.now)
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12):\(String(format: "%02d", m))"
    }
    private var dateText: String {
        let cal = Calendar.current
        let wd = cal.component(.weekday, from: model.now) - 1
        let mo = cal.component(.month, from: model.now) - 1
        let d = cal.component(.day, from: model.now)
        return "\(Self.dayNames[wd]), \(Self.monthNames[mo]) \(d)"
    }

    var body: some View {
        ZStack {
            Rectangle().fill(Palette.panel)
            VStack(spacing: width * 0.012) {
                Text(timeText)
                    .font(.system(size: width * 0.1268, weight: .semibold, design: .default))
                    .tracking(-(width * 0.1268) * 0.03)
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Text(dateText)
                    .font(.system(size: width * 0.0326, weight: .regular))
                    .tracking((width * 0.0326) * 0.02)
                    .foregroundStyle(.white)
            }
        }
    }
}

// MARK: - Weather panel

private struct WeatherPanel: View {
    let slots: [WeatherSlot]
    let width: CGFloat

    // Show placeholders (-- temps) when weather hasn't loaded, so the panel
    // never collapses - mirrors placeholderSlots() in the web app.
    private var displaySlots: [WeatherSlot] {
        if !slots.isEmpty { return slots }
        return [8,11,14,17,20].map {
            WeatherSlot(hour: $0, label: labelForSlot($0), temp: nil, icon: "cloudy")
        }
    }

    var body: some View {
        ZStack {
            Rectangle().fill(Palette.panel)
            HStack(alignment: .center, spacing: width * 0.01) {
                ForEach(displaySlots) { slot in
                    VStack(spacing: width * 0.012) {
                        Text(slot.label)
                            .font(.system(size: width * 0.018, weight: .regular))
                            .foregroundStyle(.white)
                        Image(systemName: sfSymbol(forWeatherIcon: slot.icon))
                            .symbolRenderingMode(.multicolor)
                            .font(.system(size: width * 0.045))
                            .frame(height: width * 0.065)
                        Text(slot.temp.map { "\($0)°" } ?? "--°")
                            .font(.system(size: width * 0.0233, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, width * 0.024)
        }
    }
}

private func labelForSlot(_ h: Int) -> String {
    let hr = ((h % 24) + 24) % 24
    if hr == 0 { return "12AM" }
    if hr == 12 { return "12PM" }
    if hr < 12 { return "\(hr)AM" }
    return "\(hr - 12)PM"
}

// MARK: - Timer panel

private struct TimerPanel: View {
    let departure: DepartureState
    let width: CGFloat

    var body: some View {
        ZStack {
            if departure.active, let band = departure.band {
                bandColor(band)
                activeContent(minutes: departure.minutesLeft ?? 0)
                    .foregroundStyle(.black)
            } else {
                Palette.panel
                idleContent
            }
        }
    }

    @ViewBuilder
    private func activeContent(minutes: Int) -> some View {
        VStack(spacing: 0) {
            Spacer()
            if minutes <= 0 {
                Text("LEAVE")
                    .font(.system(size: width * 0.0432, weight: .bold))
                    .tracking((width * 0.0432) * 0.01)
                Text("NOW")
                    .font(.system(size: width * 0.1279, weight: .bold))
                    .lineLimit(1)
            } else {
                Text("LEAVE IN")
                    .font(.system(size: width * 0.0432, weight: .bold))
                    .tracking((width * 0.0432) * 0.01)
                Text("\(minutes)")
                    .font(.system(size: width * 0.1957, weight: .bold))
                    .monospacedDigit()
                    .lineLimit(1)
                Text("MIN")
                    .font(.system(size: width * 0.1031, weight: .bold))
                    .lineLimit(1)
            }
            Spacer()
            // Travel pill (read-only on TV): driving is the synced default.
            HStack(spacing: width * 0.008) {
                Text("DRIVING")
                    .font(.system(size: width * 0.0305, weight: .bold))
                    .tracking((width * 0.0305) * 0.02)
                Image(systemName: "car.fill")
                    .font(.system(size: width * 0.0305))
            }
            .padding(.vertical, width * 0.012)
            .frame(width: width * 0.26)
            .background(Color.black.opacity(0.08), in: Capsule())
            .padding(.bottom, width * 0.012)
        }
        .padding(.vertical, width * 0.02)
    }

    @ViewBuilder
    private var idleContent: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 0) {
                Text("NO")
                Text("TIMER")
            }
            .font(.system(size: width * 0.0432, weight: .bold))
            .tracking((width * 0.0432) * 0.02)
            .foregroundStyle(.white.opacity(0.2))
            Spacer()
            // SET pill shown for visual parity (not interactive on the TV).
            Text("SET")
                .font(.system(size: width * 0.0305, weight: .bold))
                .tracking((width * 0.0305) * 0.08)
                .foregroundStyle(.white)
                .padding(.vertical, width * 0.012)
                .frame(width: width * 0.26)
                .background(Color.white.opacity(0.08), in: Capsule())
                .padding(.bottom, width * 0.012)
        }
        .padding(.vertical, width * 0.02)
    }
}
