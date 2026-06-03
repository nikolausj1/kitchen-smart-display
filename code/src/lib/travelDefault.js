// travelDefault - decide the morning's default travel mode (walking vs driving)
// from the forecast at departure time. Pure + dependency-free so it's trivially
// testable. Used by the Today timer's auto-arm; the Apple TV mirrors the result.

// Below this temperature (Fahrenheit) we default to driving even if it's dry.
export const COLD_THRESHOLD_F = 35

// WMO weather codes that count as precipitation (drizzle, freezing rain, rain,
// snow, showers, thunderstorm). Mirrors the groupings in useWeather.js'
// wmoToIcon. Fog (45/48) and clear/cloudy (0-3) are NOT precip.
export const PRECIP_CODES = new Set([
  51, 53, 55,            // drizzle
  56, 57, 66, 67,        // freezing rain
  61, 63, 65, 80, 81, 82, // rain / rain showers
  71, 73, 75, 77, 85, 86, // snow / snow showers
  95, 96, 99,            // thunderstorm
])

// Decide travel mode from a single hour's forecast.
//   forecast: { code: Number|null, tempF: Number|null } | null
// Returns 'driving' when there's precipitation OR it's cold (or the forecast is
// unavailable - safe default); otherwise 'walking'.
export function decideTravelMode(forecast, coldThresholdF = COLD_THRESHOLD_F) {
  if (!forecast) return 'driving'
  const { code, tempF } = forecast
  if (code == null) return 'driving'
  const precip = PRECIP_CODES.has(code)
  const cold = tempF != null && tempF < coldThresholdF
  return precip || cold ? 'driving' : 'walking'
}
