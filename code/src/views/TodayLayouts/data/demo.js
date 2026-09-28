import { dateKey } from '../../../lib/schoolDay.js'
import { cleanHaSnapshot, mergeHa } from '../../../lib/haState.js'
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

  // No isDay here: this view knows the day, not the hour. The demo feed's
  // current reading (demoFeed, which useTodayData lays under this one) says
  // whether the demo started in daylight, and carries the moon.
  return {
    current: {
      tempF: 62,
      feelsLikeF: 60,
      code: 2,
      iconName: wmoToIcon(2),
      description: wmoDescription(2),
      windMph: 6,
    },
    days,
    sunrise: days[0].sunrise,
    sunset: days[0].sunset,
  }
}

// --- The hub's weather feed (hooks/useHubWeather.js), faked -----------------
//
// demoFeed(sinceMs) -> a full feed in the hub's shape (GET /api/weather,
// hooks/hubWeatherFeed.js), so the weather panels have everything to draw
// under ?demo=1: its hours, like the hub's, from today's local midnight
// through 48 hours past the hour the demo started, ten days (the first
// five are DEMO_DAYS), the next hour's minutes with rain arriving, a wind
// advisory, the sun, the moon. Like demoWeather it is the last resort: live
// weather always wins (useTodayData), unless the URL also carries
// ?demoWeather=1, which shows the demo weather whatever the sky is doing (a
// dry day has no alert banner and no next-hour strip to design with). It
// claims the house's source, Apple WeatherKit, so a design shot carries the
// attribution a real screen does. Built from the moment demo mode turned on
// and frozen there. Each hour and the current reading are day or night by the
// demo's sunrise and sunset and carry the moon's phase, as the hub's cleaned
// feed does (hooks/hubWeatherFeed.js), so a demo opened after dark draws its
// clear and partly cloudy skies with the moon.

function readForceWeather() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('demoWeather') === '1'
}

export const DEMO_FORCE_WEATHER = readForceWeather()

const DEMO_MORE_DAYS = [
  { code: 3, highF: 63, lowF: 51, precipPct: 15 },
  { code: 61, highF: 58, lowF: 49, precipPct: 80 },
  { code: 2, highF: 62, lowF: 48, precipPct: 10 },
  { code: 0, highF: 67, lowF: 50, precipPct: 0 },
  { code: 3, highF: 64, lowF: 52, precipPct: 25 },
]

// The first evening turns wet: rain chances from 5 pm to midnight.
const DEMO_EVENING_RAIN = { 17: 20, 18: 35, 19: 55, 20: 70, 21: 65, 22: 50, 23: 30 }

// Daylight in the demo: from its sunrise (6:31) up to its sunset (7:52 pm),
// an hour judged at its start, as the hub's sources judge theirs (so 7 am
// through 7 pm are day hours, and a demo opened at 11 pm is a night).
function demoIsDay(hour, minute) {
  const m = hour * 60 + minute
  return m >= DEMO_SUNRISE.hour * 60 + DEMO_SUNRISE.minute && m < DEMO_SUNSET.hour * 60 + DEMO_SUNSET.minute
}

// The demo's moon: a waxing gibbous (0.42) on the day the demo starts, a
// day's share of a synodic month further on each day after, as the hub's
// days advance. Three places, as tidy as the hub's fractions.
const DEMO_MOON_PHASE = 0.42
const SYNODIC_DAYS = 29.530588853

function demoMoonPhase(dayIndex) {
  const p = (((DEMO_MOON_PHASE + dayIndex / SYNODIC_DAYS) % 1) + 1) % 1
  return Math.round(p * 1000) / 1000
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// '2026-09-26T14:00', the feed's local wall-clock stamp.
function stampOf(d) {
  return `${dateKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// A day's temperature at `hour`: its low at 3 am, its high at 3 pm.
function demoTempAt(day, hour) {
  const shape = (1 + Math.cos(((hour - 15) / 24) * 2 * Math.PI)) / 2
  return Math.round((day.lowF + (day.highF - day.lowF) * shape) * 10) / 10
}

// The demo's current reading (demoWeather's), which the first hours ease into.
const DEMO_NOW_F = 62

function demoHour(t, dayIndex, ease) {
  const day = DEMO_DAYS.concat(DEMO_MORE_DAYS)[dayIndex] || DEMO_DAYS[0]
  const h = t.getHours()
  const rain = dayIndex === 0 && Object.prototype.hasOwnProperty.call(DEMO_EVENING_RAIN, h) ? DEMO_EVENING_RAIN[h] : dayIndex === 1 && h < 11 ? 25 : 5
  const code = rain >= 50 ? 61 : rain >= 20 ? 3 : dayIndex === 0 ? 2 : day.code
  const wind = Math.round((6 + 5 * Math.sin((h / 24) * Math.PI)) * 10) / 10
  const tempF = Math.round((demoTempAt(day, h) + ease) * 10) / 10
  return {
    time: stampOf(t),
    tempF,
    feelsF: Math.round((tempF - wind / 3) * 10) / 10,
    precipProb: rain,
    precipIn: rain >= 50 ? 0.04 : 0,
    snowIn: 0,
    code,
    condition: null,
    windMph: wind,
    gustMph: Math.round(wind * 1.7 * 10) / 10,
    humidity: 60 + Math.round(rain / 3),
    uv: h >= 9 && h <= 17 ? Math.max(0, 5 - Math.abs(13 - h)) : 0,
    isDay: demoIsDay(h, 0),
    moonPhase: demoMoonPhase(dayIndex),
  }
}

export function demoFeed(sinceMs) {
  const since = new Date(sinceMs)
  const base = new Date(since)
  base.setHours(0, 0, 0, 0)

  // The hours, as the hub serves them: from today's local midnight through
  // the hour now is in and the 47 after it (i counts from the hour now), so
  // a strip that shows this morning (the hourly forecast's Whole day, from
  // 8 am) has its hours. The day's curve is eased into the current reading
  // over the six hours either side of now, so the strip's "Now" and its
  // neighbours agree with the weather card; the hours from now on are what
  // they always were.
  const offset = DEMO_NOW_F - demoTempAt(DEMO_DAYS[0], since.getHours())
  const hourly = []
  for (let i = -since.getHours(); i < 48; i++) {
    const t = new Date(since.getFullYear(), since.getMonth(), since.getDate(), since.getHours() + i, 0, 0, 0)
    const dayIndex = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - base.getTime()) / 86400000)
    hourly.push(demoHour(t, dayIndex, offset * Math.max(0, 1 - Math.abs(i) / 6)))
  }

  const daily = DEMO_DAYS.concat(DEMO_MORE_DAYS).map((d, i) => {
    const date = atTime(base, i, { hour: 0, minute: 0 })
    return {
      date: dateKey(date),
      highF: d.highF,
      lowF: d.lowF,
      precipProbMax: d.precipPct,
      precipIn: d.precipPct >= 50 ? 0.3 : 0,
      code: d.code,
      condition: null,
      sunrise: stampOf(atTime(base, i, DEMO_SUNRISE)),
      sunset: stampOf(atTime(base, i, DEMO_SUNSET)),
      uvMax: 5,
      windMaxMph: 18,
      moonPhase: demoMoonPhase(i),
    }
  })

  // Rain arriving: a slight chance now, likely from 18 minutes on.
  const minute0 = new Date(since)
  minute0.setSeconds(0, 0)
  const minutes = []
  for (let i = 0; i < 70; i++) {
    const t = new Date(minute0.getTime() + i * 60000)
    const chance = i < 12 ? 5 : i < 18 ? 20 + (i - 12) * 5 : Math.min(80, 55 + (i - 18))
    minutes.push({ time: stampOf(t), precipChance: chance, precipIntensityInHr: chance >= 50 ? 0.02 : 0 })
  }
  const rainFrom = new Date(minute0.getTime() + 18 * 60000)

  const hour0 = new Date(since)
  hour0.setMinutes(0, 0, 0)
  const alertEnds = new Date(hour0.getTime() + 6 * 3600000)

  return {
    source: 'weatherkit',
    fetchedAt: since.toISOString(),
    error: null,
    location: { lat: null, lon: null, timezone: null },
    current: {
      time: stampOf(since),
      tempF: DEMO_NOW_F,
      feelsF: 60,
      humidity: 71,
      dewF: 52,
      windMph: 6,
      gustMph: 14,
      windDir: 225,
      pressureMb: 1016,
      visibilityMi: 10,
      uv: 4,
      cloudCover: 45,
      code: 2,
      condition: 'PartlyCloudy',
      isDay: demoIsDay(since.getHours(), since.getMinutes()),
      moonPhase: demoMoonPhase(0),
      precipIn: 0,
    },
    hourly,
    daily,
    nextHour: {
      summary: [
        { time: stampOf(minute0), condition: 'clear', precipChance: 5, precipIntensityInHr: 0 },
        { time: stampOf(rainFrom), condition: 'rain', precipChance: 60, precipIntensityInHr: 0.02 },
      ],
      minutes,
    },
    alerts: [
      {
        id: 'demo-wind-advisory',
        event: 'Wind Advisory',
        severity: 'Moderate',
        urgency: 'Expected',
        certainty: 'Likely',
        headline: 'Wind Advisory issued by NWS Seattle WA: southwest winds 20 to 30 mph with gusts to 45 mph',
        description: 'Southwest winds 20 to 30 mph with gusts up to 45 mph. Gusty winds will blow around unsecured objects.',
        onset: new Date(hour0.getTime() - 3600000).toISOString(),
        ends: alertEnds.toISOString(),
        source: 'weatherkit',
        url: null,
      },
    ],
    sun: { sunrise: daily[0].sunrise, sunset: daily[0].sunset },
    moon: { phase: demoMoonPhase(0), name: 'Waxing Gibbous' },
    attribution: { name: 'Apple Weather', url: 'https://weatherkit.apple.com/legal-attribution.html' },
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

// endOffsetDays: the day it ends, for an event that runs past midnight
// (default: the day it starts). extra: location, description.
function demoTimed(base, id, cal, title, offsetDays, [h1, m1], [h2, m2], extra = {}, endOffsetDays = offsetDays) {
  const start = atTime(base, offsetDays, { hour: h1, minute: m1 })
  const end = atTime(base, endOffsetDays, { hour: h2, minute: m2 })
  return {
    id,
    calendarId: cal.id,
    calendarLabel: cal.label,
    color: cal.color,
    title,
    description: extra.description || '',
    location: extra.location || '',
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

// --- The calendar views' six weeks (chunk 3) --------------------------------
//
// A plausible family calendar from three weeks before the demo's day to three
// weeks after (DEMO_SPAN), so ?demo=1 fills every calendar view: a week of
// regular things by weekday (DEMO_WEEK), a few one-offs, some that overlap
// (four at 5 pm three days out: two side by side and "+2" in the week grid),
// all-day events across several days (grandparents visiting, a nine-day fall
// break), a trip timed across three days (drawn with the all-day ones), and
// one dinner on both calendars (for `consolidate`). The three days the agenda
// shows by default (today and the next two) keep the eight events above
// untouched, so the demo Entry board is as it was.
const DEMO_SPAN = { back: 21, ahead: 21 } // days -21 .. +20

const DEMO_PLACES = {
  field: 'Magnolia Playfield South, 2518 34th Ave W, Seattle, WA 98199',
  pool: 'Queen Anne Pool, 1920 1st Ave W, Seattle, WA 98119',
  school: 'Lawton Elementary School, 4000 27th Ave W, Seattle, WA 98199',
  market: 'Ballard Farmers Market, 5345 Ballard Ave NW, Seattle, WA 98107',
  piano: 'Magnolia Music Studio, 3213 W McGraw St, Seattle, WA 98199',
}

// By weekday (0 Sunday): [calendar 'j' | 's', title, start, end, place?, description?].
const DEMO_WEEK = {
  0: [
    ['j', 'Pancake breakfast', [8, 30], [9, 30]],
    ['s', 'Grocery run', [16, 0], [17, 0]],
  ],
  1: [
    ['s', 'Chase piano lesson', [16, 0], [16, 45], 'piano'],
    ['j', 'Vinny soccer practice', [17, 0], [18, 0], 'field', 'Bring shin guards and water'],
  ],
  2: [
    ['s', 'Swim lessons', [16, 30], [17, 15], 'pool'],
    ['s', 'Book club', [19, 0], [21, 0], null, 'This month: The Overstory'],
  ],
  3: [
    ['j', 'Chase coding club', [15, 30], [16, 30], 'school'],
    ['j', 'Recycling out', [20, 0], [20, 15]],
  ],
  4: [
    ['s', 'Yoga', [7, 0], [8, 0]],
    ['j', 'Vinny soccer practice', [17, 0], [18, 15], 'field', 'Bring shin guards and water'],
  ],
  5: [
    ['s', 'Coffee with Priya', [10, 0], [11, 0]],
    ['j', 'Pizza night', [18, 0], [19, 30]],
  ],
  6: [
    ['j', 'Soccer game', [9, 0], [10, 0], 'field', 'Arrive 20 minutes early'],
    ['s', 'Farmers market', [10, 30], [12, 0], 'market'],
  ],
}

function demoWeekDay(base, offset, cals) {
  const d = dayOffset(base, offset)
  return (DEMO_WEEK[d.getDay()] || []).map(([c, title, from, to, place, description], i) =>
    demoTimed(base, `demo-w${offset}-${i}`, c === 's' ? cals.sheena : cals.justin, title, offset, from, to, {
      location: place ? DEMO_PLACES[place] : '',
      description,
    })
  )
}

// The one-offs, by day from the demo's day.
function demoOneOffs(base, { justin, sheena }) {
  return [
    demoAllDay(base, 'demo-books', justin, 'Library books due', -4, 1),
    demoTimed(base, 'demo-denver', justin, 'Justin in Denver', -10, [9, 0], [18, 0], { location: 'Denver, CO' }, -8),
    demoAllDay(base, 'demo-picture', sheena, 'Picture day', -15, 1),
    demoTimed(base, 'demo-haircut', sheena, 'Vinny haircut', -2, [11, 0], [11, 30]),
    // Four at once, three days out.
    demoTimed(base, 'demo-carpool', justin, 'Carpool pickup', 3, [17, 0], [17, 30]),
    demoTimed(base, 'demo-call', sheena, 'Call with Grandma', 3, [17, 0], [17, 45]),
    demoTimed(base, 'demo-ptc', sheena, 'Parent-teacher conference', 3, [17, 15], [17, 45], { location: DEMO_PLACES.school }),
    demoTimed(base, 'demo-cleaners', justin, 'Pick up dry cleaning', 3, [17, 20], [17, 40]),
    // The same dinner on both calendars: consolidate shows it once.
    demoTimed(base, 'demo-parkers-j', justin, 'Dinner with the Parkers', 4, [18, 30], [20, 30], { location: 'The Parkers’, 2811 W Newton St, Seattle, WA 98199' }),
    demoTimed(base, 'demo-parkers-s', sheena, 'Dinner with the Parkers', 4, [18, 30], [20, 30]),
    demoAllDay(base, 'demo-grandparents', sheena, 'Grandparents visiting', 5, 4),
    demoAllDay(base, 'demo-grandma-bday', justin, 'Grandma’s birthday', 5, 1),
    demoAllDay(base, 'demo-fallbreak', justin, 'Fall break', 11, 9),
    demoAllDay(base, 'demo-cabin', sheena, 'Cabin weekend', 12, 2),
    demoTimed(base, 'demo-flu', sheena, 'Flu shots', 8, [15, 30], [16, 0], { location: 'Magnolia Pharmacy, 3217 W McGraw St, Seattle, WA 98199' }),
    demoTimed(base, 'demo-recital', justin, 'Chase piano recital', 9, [18, 0], [19, 0], { location: DEMO_PLACES.piano }),
  ]
}

// The hub's order: by start (an all-day event at its day's midnight), all day
// first on a tie, then by title.
function demoSortKey(e) {
  if (e.allDay) {
    const [y, m, d] = e.startDate.split('-').map(Number)
    return new Date(y, m - 1, d).getTime()
  }
  return Date.parse(e.start)
}

function sortLikeTheHub(list) {
  return list.slice().sort((a, b) =>
    demoSortKey(a) - demoSortKey(b) ||
    (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) ||
    String(a.title).localeCompare(String(b.title)))
}

// demoCalendar(today) -> { events, countdowns, calendars, range }: six weeks
// of events (DEMO_SPAN, above), the three days the agenda shows by default
// being the original eight (one all-day event spans tomorrow and the day
// after, so it shows in two columns), and two countdowns - one whose art is
// a hub path that does not exist, so the tile's fallback runs, and one with
// an emoji. Each countdown carries a marker colour (`tileColor`, the hub's
// palette purple and green: what `color: purple` and `color: green` in an
// event's description send), which only the art-above tiles draw; the other
// tile styles draw as before. range: the dates the events cover, as the
// calendar store reports the hub's (hooks/useCalendar.js).
export function demoCalendar(today) {
  const base = new Date(today)
  base.setHours(0, 0, 0, 0)
  const [justin, sheena] = DEMO_CALENDARS

  const firstThree = [
    demoAllDay(base, 'demo-pj', sheena, 'PJ and Stuffy day', 0, 1),
    demoTimed(base, 'demo-dentist', sheena, 'Chase dentist', 0, [8, 15], [9, 0]),
    demoTimed(base, 'demo-lunch', justin, 'Lunch with Dana', 0, [12, 30], [13, 30]),
    demoTimed(base, 'demo-soccer', justin, 'Vinny soccer', 0, [17, 0], [18, 15], {
      location: DEMO_PLACES.field,
      description: 'Bring shin guards and water',
    }),
    demoAllDay(base, 'demo-chicago', sheena, 'Sheena in Chicago', 1, 2),
    demoTimed(base, 'demo-piano', sheena, 'Chase piano lesson', 1, [16, 0], [16, 45], { location: DEMO_PLACES.piano }),
    demoTimed(base, 'demo-bts', justin, 'Back to school night', 1, [18, 30], [20, 0], { location: DEMO_PLACES.school }),
    demoTimed(base, 'demo-swim', justin, 'Vinny swim meet', 2, [9, 0], [11, 30], { location: DEMO_PLACES.pool }),
  ]
  const weeks = []
  for (let i = -DEMO_SPAN.back; i < DEMO_SPAN.ahead; i++) {
    if (i >= 0 && i <= 2) continue
    demoWeekDay(base, i, { justin, sheena }).forEach((e) => weeks.push(e))
  }
  const events = sortLikeTheHub(firstThree.concat(weeks, demoOneOffs(base, { justin, sheena })))
  const range = { from: dateKey(dayOffset(base, -DEMO_SPAN.back)), to: dateKey(dayOffset(base, DEMO_SPAN.ahead)) }

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

  return { events, countdowns, calendars: DEMO_CALENDARS, range }
}

// --- Home Assistant (docs/designs/panels-and-controls.md, chunk 5) ---------------
//
// demoHa(sinceMs) -> the Home Assistant store's snapshot
// (hooks/useHomeAssistant.js), faked: the whitelist the hub was seeded with
// (the same ids, labels and kinds, so a layout saved against the real one
// draws here too, and the same ten actions), in a plausible afternoon: the
// garage open 38 minutes, the front door locked, Justin home and Sheena
// away, working late on and the other modes off, the day part on Auto, the
// downstairs lights on. Actions are on, so the buttons look live; a press
// only animates (demoHaAction). Like the calendar, the demo always wins over
// the real house: a design shot should not publish who is home. Built
// through lib/haState.js, so it is exactly the store's shape, and frozen at
// the moment demo mode turned on.

const DEMO_DAY_PARTS = ['Auto', 'Morning', 'Day', 'Afternoon', 'Evening', 'Late Evening', 'Night', 'Overnight']

// [id, label, kind, state, minutes since it changed, attributes]
const DEMO_HA_ENTITIES = [
  ['cover.garage_door_controller', 'Garage', 'cover', 'open', 38, { friendly_name: 'Garage Door Controller', device_class: 'garage' }],
  ['lock.front_door_smart_code_with_home_connect_technology', 'Front door', 'lock', 'locked', 131, { friendly_name: 'Front Door Lock' }],
  ['binary_sensor.front_door_contact_open', 'Front door open', 'door', 'off', 132, { friendly_name: 'Front Door Contact', device_class: 'door' }],
  ['input_boolean.mode_away', 'Away', 'mode', 'off', 1210, { friendly_name: 'Mode Away' }],
  ['input_boolean.mode_guest', 'Guest', 'mode', 'off', 2890, { friendly_name: 'Mode Guest' }],
  ['input_boolean.mode_outside', 'Outside', 'mode', 'off', 2890, { friendly_name: 'Mode Outside' }],
  ['input_boolean.mode_vacation', 'Vacation', 'mode', 'off', 2890, { friendly_name: 'Mode Vacation' }],
  ['input_boolean.mode_working_late', 'Working late', 'mode', 'on', 95, { friendly_name: 'Mode - Working Late' }],
  ['input_select.day_part_override', 'Day part', 'select', 'Auto', 245, { friendly_name: 'Day Part Override', options: DEMO_DAY_PARTS }],
  ['light.downstairs', 'Downstairs lights', 'light', 'on', 52, { friendly_name: 'Downstairs' }],
  ['light.basement_basement', 'Basement', 'light', 'off', 410, { friendly_name: 'Basement' }],
  ['person.justin', 'Justin', 'person', 'home', 312, { friendly_name: 'Justin' }],
  ['person.sheena', 'Sheena', 'person', 'not_home', 174, { friendly_name: 'Sheena' }],
]

// The hub's seed actions (frameserver/lib/homeAssistant.mjs SEED_ACTIONS).
const DEMO_HA_ACTIONS = [
  ['downstairs-off', 'Turn off downstairs', 'light.downstairs', 'light.turn_off', 'tap'],
  ['garage-toggle', 'Garage', 'cover.garage_door_controller', 'cover.toggle', 'hold'],
  ['garage-close', 'Close garage', 'cover.garage_door_controller', 'cover.close_cover', 'hold'],
  ['door-lock', 'Lock front door', 'lock.front_door_smart_code_with_home_connect_technology', 'lock.lock', 'tap'],
  ['door-unlock', 'Unlock front door', 'lock.front_door_smart_code_with_home_connect_technology', 'lock.unlock', 'hold'],
  ['away-on', 'Leaving', 'input_boolean.mode_away', 'input_boolean.turn_on', 'tap'],
  ['away-off', 'Home', 'input_boolean.mode_away', 'input_boolean.turn_off', 'tap'],
  ['guest-toggle', 'Guest mode', 'input_boolean.mode_guest', 'input_boolean.toggle', 'tap'],
  ['basement-toggle', 'Basement light', 'light.basement_basement', 'light.toggle', 'tap'],
  ['daypart-set', 'Day part', 'input_select.day_part_override', 'input_select.select_option', 'tap'],
]

export function demoHa(sinceMs) {
  const at = Number.isFinite(sinceMs) ? sinceMs : 0
  const entities = {}
  DEMO_HA_ENTITIES.forEach(([id, label, kind, state, minutes, attributes]) => {
    entities[id] = { state, attributes, lastChanged: new Date(at - minutes * 60000).toISOString(), label, kind }
  })
  const actions = DEMO_HA_ACTIONS.map(([id, label, entity, service, confirm]) => ({
    id,
    label,
    entity,
    service,
    confirm,
    needs: service === 'input_select.select_option' ? ['option'] : [],
  }))
  const snap = cleanHaSnapshot({ connected: true, configured: true, actionsEnabled: true, error: null, entities, actions })
  return mergeHa({ snap, snapAt: at })
}

// A press under ?demo=1: it animates (a spinner, then the check) and sends
// nothing anywhere.
export const DEMO_HA_PRESS_MS = 700

export function demoHaAction() {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ ok: true, status: 200, error: null }), DEMO_HA_PRESS_MS)
  })
}
