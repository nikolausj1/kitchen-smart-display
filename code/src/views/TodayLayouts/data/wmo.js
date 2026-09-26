// WMO weather-code lookups for the Today layouts.
//
// wmoToIcon MIRRORS the table of the same name in hooks/hubWeatherFeed.js
// (the weather hooks' own, which hooks/useWeather.js kept until the hub's
// weather feed). It is a copy on purpose: the layouts keep their own lookups.
// The two tables have to stay in step - if you change one, change the other.
// The names it returns are the keys of FILES in
// components/WeatherIcon/WeatherIcon.jsx.

export function wmoToIcon(code) {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'partly-cloudy'
  if (code === 3) return 'overcast'
  if (code === 45 || code === 48) return 'fog'
  if (code === 51) return 'light-drizzle'
  if (code === 53 || code === 55) return 'drizzle'
  if ([56, 57, 66, 67].includes(code)) return 'freezing-rain'
  if ([61, 63, 80, 81].includes(code)) return 'rain'
  if ([65, 82].includes(code)) return 'heavy-rain'
  if ([71, 73, 77, 85].includes(code)) return 'snow'
  if ([75, 86].includes(code)) return 'heavy-snow'
  if ([95, 96, 99].includes(code)) return 'thunderstorm'
  return 'overcast'
}

// Short human text for a code, for the line under the big temperature. Kept to
// two words where possible so it fits a narrow panel.
const DESCRIPTIONS = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

// Empty string (not 'Unknown') for a code we do not have text for, so a panel
// that renders it inline just shows nothing instead of a placeholder word.
export function wmoDescription(code) {
  return DESCRIPTIONS[code] || ''
}

// Codes that mean liquid precipitation is falling. Used by lib/wear.js to
// decide rain gear. Mirrors the rain-ish groupings above (drizzle, freezing
// rain, rain, showers, thunderstorm). Snow is tracked separately.
export const RAIN_CODES = new Set([
  51, 53, 55,
  56, 57, 66, 67,
  61, 63, 65, 80, 81, 82,
  95, 96, 99,
])

export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
