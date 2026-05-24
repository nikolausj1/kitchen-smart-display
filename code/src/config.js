// Kitchen Smart Display - runtime configuration.
//
// Phase 1: these values live here. Phase 2 moves them behind a Settings page
// that writes to localStorage on the Pi. Anything that says TODO is a value
// Justin should personalize before the display is in regular use.

// --- Location ----------------------------------------------------------------
// Used for the Open-Meteo weather forecast. Seattle, WA.
export const LOCATION = {
  lat: 47.6610608,
  lon: -122.3999576,
  // Open-Meteo uses an IANA timezone name to align hourly slots with local time.
  // 'auto' makes Open-Meteo pick the timezone of the coordinates.
  timezone: 'auto',
}

// --- School / departure times -----------------------------------------------
// Driving and walking departure times for the default morning timer. Per the
// project spec: school starts 7:50 AM, driving leaves 7:42 AM, walking 7:32 AM.
export const SCHOOL = {
  drivingDepart: { hour: 7, minute: 42 },
  walkingDepart: { hour: 7, minute: 32 },
  // Auto-show the Today screen at this time on weekdays.
  autoShowAt: { hour: 6, minute: 0 },
  // 0 = Sunday, 6 = Saturday. Default Monday through Friday.
  schoolDays: [1, 2, 3, 4, 5],
}

// --- Countdown colour thresholds (minutes remaining) ------------------------
// > GREEN_ABOVE     -> green   (plenty of time)
// > YELLOW_ABOVE    -> yellow  (heads up)
// > ORANGE_ABOVE    -> orange  (almost out of time)
// <= ORANGE_ABOVE   -> red     (leave now)
export const TIMER_THRESHOLDS = {
  greenAbove: 7,
  yellowAbove: 3,
  orangeAbove: 0,
}

// --- Weather timeline slots --------------------------------------------------
// Hours of day shown in the bottom-left weather strip, in 24h local time.
export const WEATHER_SLOT_HOURS = [8, 11, 14, 17, 20]
