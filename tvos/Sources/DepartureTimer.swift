import Foundation
import SwiftUI

// DepartureTimer - the read-only countdown logic for the TV's Today view.
//
// The kitchen's useTimer.js has a full interactive state machine (manual
// timers, set-timer picker, dismissal, Photos handoff). The TV is read-only,
// so we keep only what's needed to DISPLAY the same countdown the kitchen
// shows: the default departure timer derived from school settings, with the
// same color bands.

enum TimerBand {
    case green, yellow, orange, red

    var color: Color {
        switch self {
        case .green: return Color(red: 0.30, green: 0.78, blue: 0.40)
        case .yellow: return Color(red: 0.95, green: 0.80, blue: 0.25)
        case .orange: return Color(red: 0.96, green: 0.55, blue: 0.20)
        case .red: return Color(red: 0.90, green: 0.27, blue: 0.24)
        }
    }
}

enum TravelMode { case driving, walking }

struct DepartureState {
    var active: Bool
    var minutesLeft: Int?
    var band: TimerBand?
    var target: Date?
}

// Matches colourBandForMinutes in useTimer.js (ascending "<=" checks).
func bandForMinutes(_ minutesLeft: Int, _ t: TimerThresholds) -> TimerBand {
    if minutesLeft <= t.orangeAbove { return .red }
    if minutesLeft <= t.yellowAbove { return .orange }
    if minutesLeft <= t.greenAbove { return .yellow }
    return .green
}

private let postExpiryLifetime: TimeInterval = 15 * 60   // matches useTimer.js

func departureTime(school: SchoolSettings, mode: TravelMode, on day: Date) -> Date {
    let hm = (mode == .walking) ? school.walkingDepart : school.drivingDepart
    return Calendar.current.date(
        bySettingHour: hm.hour, minute: hm.minute, second: 0, of: day
    ) ?? day
}

// Compute the display state for "now". On a school day, between autoShowAt and
// (target + 15min), show an active countdown; otherwise inactive.
func computeDeparture(
    settings: AppSettings,
    mode: TravelMode,
    now: Date
) -> DepartureState {
    let cal = Calendar.current
    let weekday = cal.component(.weekday, from: now) - 1   // Calendar: 1=Sun -> 0=Sun
    guard settings.school.schoolDays.contains(weekday) else {
        return DepartureState(active: false, minutesLeft: nil, band: nil, target: nil)
    }

    let autoShow = cal.date(
        bySettingHour: settings.school.autoShowAt.hour,
        minute: settings.school.autoShowAt.minute,
        second: 0, of: now
    ) ?? now
    let target = departureTime(school: settings.school, mode: mode, on: now)
    let dropoff = target.addingTimeInterval(postExpiryLifetime)

    guard now >= autoShow && now <= dropoff else {
        return DepartureState(active: false, minutesLeft: nil, band: nil, target: target)
    }

    let msLeft = target.timeIntervalSince(now)
    let minutesLeft = max(0, Int(ceil(msLeft / 60.0)))
    return DepartureState(
        active: true,
        minutesLeft: minutesLeft,
        band: bandForMinutes(minutesLeft, settings.timerThresholds),
        target: target
    )
}
