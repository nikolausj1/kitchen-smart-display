import { dateKey } from '../../../lib/schoolDay.js'
import { wmoToIcon, wmoDescription } from './wmo.js'

// Demo fixtures for ?demo=1 - a full, plausible Today with music playing, a
// school day in progress and a timer counting down, so the layouts can be
// designed and screenshotted without Sonos, the lunch proxy or the morning
// actually being 7:24 AM. Photos are deliberately NOT faked: the slideshow is
// the one source that always has real data to show.

// Album art as an inline SVG data URI so the demo works with no network and no
// Sonos: a warm sunset gradient behind a pale disc. Encoded once at module
// load (the '#' in the colours has to be escaped for a data: URI).
const ALBUM_ART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a1a38"/>
      <stop offset="0.42" stop-color="#8b3b52"/>
      <stop offset="0.74" stop-color="#d97441"/>
      <stop offset="1" stop-color="#f3b862"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff3d4" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#fff3d4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="600" fill="url(#sky)"/>
  <circle cx="300" cy="348" r="196" fill="url(#glow)"/>
  <circle cx="300" cy="348" r="94" fill="#ffeecf" fill-opacity="0.94"/>
  <rect y="452" width="600" height="148" fill="#1c1225" fill-opacity="0.5"/>
</svg>`

export const DEMO_ALBUM_ART = `data:image/svg+xml,${encodeURIComponent(ALBUM_ART_SVG)}`

// elapsedMs is the position at the moment the fixture was "fetched"; the panel
// advances it against `now`, so the progress bar really moves in demo mode.
export const DEMO_MUSIC = {
  playing: true,
  paused: false,
  track: {
    title: 'Golden Hour',
    artist: 'Wandering Lights',
    album: 'Long Way Home',
    albumArtUrl: DEMO_ALBUM_ART,
    durationMs: 270_000,
    elapsedMs: 72_000,
  },
  stationName: 'Sonos Radio',
  sourceLabel: 'Sonos Radio',
  sourceKind: 'Radio',
  volume: 24,
  error: null,
}

export const DEMO_SCHOOL = {
  noSchool: false,
  entree: 'Chicken Tenders',
  grab: 'Turkey & Cheese Wrap',
  activities: [
    { name: 'Vinny', label: 'Library' },
    { name: 'Chase', label: 'Coding' },
  ],
}

// Scalars only. The target Date depends on when the demo was opened, so
// useTodayData freezes it once at mount rather than baking it in here.
export const DEMO_TIMER = {
  mode: 'active',
  kind: 'default',
  travelMode: 'driving',
  minutesLeft: 18,
  band: 'green',
}
export const DEMO_TIMER_MINUTES = 18

// Five plausible early-September Seattle days. code is a WMO code, so the icon
// and description come from the same table the live data uses.
const DEMO_DAYS = [
  { code: 2, highF: 68, lowF: 52, precipPct: 10 },
  { code: 3, highF: 64, lowF: 51, precipPct: 20 },
  { code: 61, highF: 59, lowF: 50, precipPct: 70 },
  { code: 80, highF: 61, lowF: 49, precipPct: 45 },
  { code: 1, highF: 66, lowF: 50, precipPct: 5 },
]

const DEMO_SUNRISE = { hour: 6, minute: 31 }
const DEMO_SUNSET = { hour: 19, minute: 52 }

function atTime(base, offsetDays, { hour, minute }) {
  const d = new Date(base)
  d.setDate(base.getDate() + offsetDays)   // calendar arithmetic, DST safe
  d.setHours(hour, minute, 0, 0)
  return d
}

// demoWeather(today) -> the same shape useDailyForecast returns, so the
// composition code can swap one for the other. `today` is any Date on the day
// to anchor the five days to (useTodayData passes local midnight).
export function demoWeather(today) {
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)

  const days = DEMO_DAYS.map((d, i) => {
    const date = atTime(base, i, { hour: 0, minute: 0 })
    return {
      date,
      dateKey: dateKey(date),
      code: d.code,
      iconName: wmoToIcon(d.code),
      highF: d.highF,
      lowF: d.lowF,
      precipPct: d.precipPct,
      sunrise: atTime(base, i, DEMO_SUNRISE),
      sunset: atTime(base, i, DEMO_SUNSET),
    }
  })

  return {
    current: {
      tempF: 62,
      feelsLikeF: 60,
      code: 2,
      iconName: wmoToIcon(2),
      description: wmoDescription(2),
      windMph: 6,
      isDay: true,
    },
    days,
    sunrise: days[0].sunrise,
    sunset: days[0].sunset,
  }
}
