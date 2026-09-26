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

// --- Entry board: calendar, countdowns, headline, air quality ----------------
//
// The same shapes the hub serves (GET /api/calendar, /api/state headline and
// airQuality; docs/designs/entry-board.md), so the demo exercises the very code
// paths live data takes. Built relative to the day the page opened and frozen
// there by useTodayData (a state initializer), so nothing slides with the clock.

export const DEMO_CALENDARS = [
  { id: 'justin@example.com', label: 'Justin', color: '#e0457b' },
  { id: 'sheena@example.com', label: 'Sheena', color: '#4a90e2' },
]

// Fixed on purpose: the default names the 5:00 pm soccer below, whatever the
// time. ?demo=1&demoHeadline=alert (or =weather) swaps in one of the weather
// kinds the hub can send (docs/designs/entry-board.md), so the amber alert
// line and the blue-grey weather dot can be seen without a storm.
export const DEMO_HEADLINES = {
  next: { text: 'Vinny soccer at 5:00 pm', kind: 'next', eventId: 'demo-soccer', until: null },
  alert: { text: 'Wind Advisory until 9 pm', kind: 'alert', eventId: null, until: null },
  weather: { text: 'Rain from 3 pm', kind: 'weather', eventId: null, until: null },
}

function pickDemoHeadline() {
  if (typeof window === 'undefined') return DEMO_HEADLINES.next
  const want = new URLSearchParams(window.location.search).get('demoHeadline')
  return want && Object.hasOwn(DEMO_HEADLINES, want) ? DEMO_HEADLINES[want] : DEMO_HEADLINES.next
}

export const DEMO_HEADLINE = pickDemoHeadline()

export const DEMO_AIR_QUALITY = { pm25: 17, aqi: 31, label: 'Good', fetchedAt: null }

function dayOffset(base, offsetDays) {
  const d = new Date(base)
  d.setDate(base.getDate() + offsetDays)
  return d
}

function demoTimed(base, id, cal, title, offsetDays, [h1, m1], [h2, m2]) {
  const start = atTime(base, offsetDays, { hour: h1, minute: m1 })
  const end = atTime(base, offsetDays, { hour: h2, minute: m2 })
  return {
    id,
    calendarId: cal.id,
    calendarLabel: cal.label,
    color: cal.color,
    title,
    description: '',
    location: '',
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: dateKey(start),
    endDate: dateKey(end),
    status: 'confirmed',
  }
}

// endDate exclusive, as Google sends it: a one-day event ends the next day.
function demoAllDay(base, id, cal, title, offsetDays, lengthDays) {
  return {
    id,
    calendarId: cal.id,
    calendarLabel: cal.label,
    color: cal.color,
    title,
    description: '',
    location: '',
    allDay: true,
    start: null,
    end: null,
    startDate: dateKey(dayOffset(base, offsetDays)),
    endDate: dateKey(dayOffset(base, offsetDays + lengthDays)),
    status: 'confirmed',
  }
}

// demoCalendar(today) -> { events, countdowns, calendars }: eight events over
// three days (one all-day event spans tomorrow and the day after, so it shows
// in two columns), and two countdowns - one whose art is a hub path that does
// not exist, so the tile's fallback runs, and one with an emoji. Each carries
// a marker colour (`tileColor`, the hub's palette purple and green: what
// `color: purple` and `color: green` in an event's description send), which
// only the art-above tiles draw; the other tile styles draw as before.
export function demoCalendar(today) {
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)
  const [justin, sheena] = DEMO_CALENDARS

  const events = [
    demoAllDay(base, 'demo-pj', sheena, 'PJ and Stuffy day', 0, 1),
    demoTimed(base, 'demo-dentist', sheena, 'Chase dentist', 0, [8, 15], [9, 0]),
    demoTimed(base, 'demo-lunch', justin, 'Lunch with Dana', 0, [12, 30], [13, 30]),
    demoTimed(base, 'demo-soccer', justin, 'Vinny soccer', 0, [17, 0], [18, 15]),
    demoAllDay(base, 'demo-chicago', sheena, 'Sheena in Chicago', 1, 2),
    demoTimed(base, 'demo-piano', sheena, 'Chase piano lesson', 1, [16, 0], [16, 45]),
    demoTimed(base, 'demo-bts', justin, 'Back to school night', 1, [18, 30], [20, 0]),
    demoTimed(base, 'demo-swim', justin, 'Vinny swim meet', 2, [9, 0], [11, 30]),
  ]

  const countdowns = [
    {
      id: 'demo-cd-birthday',
      title: "Grandma's birthday",
      date: dateKey(dayOffset(base, 5)),
      daysLeft: 5,
      leadDays: 30,
      image: null,
      emoji: '\u{1F382}',
      calendarLabel: justin.label,
      color: justin.color,
      tileColor: '#8e4ed8',
    },
    {
      id: 'demo-cd-cabin',
      title: 'Cabin weekend',
      date: dateKey(dayOffset(base, 12)),
      daysLeft: 12,
      leadDays: 30,
      image: '/countdown-art/demo-missing-cabin.png',
      emoji: null,
      calendarLabel: sheena.label,
      color: sheena.color,
      tileColor: '#2f9e44',
    },
  ]

  return { events, countdowns, calendars: DEMO_CALENDARS }
}
