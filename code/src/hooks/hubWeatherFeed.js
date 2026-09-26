// hubWeatherFeed.js - pure helpers for the hub's one weather feed, GET
// hubUrl('/api/weather') (docs/designs/panels-and-controls.md, "One weather
// feed"), and for the direct Open-Meteo fetch the weather hooks keep as their
// fallback. No React, no DOM, no clock: every `now` is handed in. Used by
// hooks/useHubWeather.js (the store), hooks/useWeather.js and
// views/TodayLayouts/data/useDailyForecast.js; tested from Node
// (hubWeatherFeed.test.mjs).
//
// The feed, as the hub serves it:
//   { source: 'weatherkit' | 'open-meteo', fetchedAt, error, location,
//     current, hourly (from today's local midnight through 48 hours past the
//     hub's current hour), daily (10), nextHour (WeatherKit only, else null),
//     alerts, sun, moon, attribution }
//
// Hour alignment. A feed hour's `time` is the local wall-clock START of the
// hour it describes ('2026-09-26T14:00' is 2 to 3 pm): its temperature is the
// reading at 2:00, its code, rain chance and gusts cover the hour after.
// Open-Meteo, which the app used to ask directly, stamps its temperature at
// the instant too but its weather code at the END of the hour it covers, and
// the hub moves that column back one stamp. So an hour looked up here has the
// same temperature the old fetch had for that hour, and for Open-Meteo data
// the code the old fetch showed an hour later: the old 3 pm code is the feed's
// 2 pm code. WeatherKit's hours are hour-start natively. A slot or a
// departure hour H reads the entry whose time is H:00, the hour starting then.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80, so no
// Object.hasOwn, Array.prototype.at, structuredClone or String replaceAll.

// The feed is trusted as current up to this age (its own fetchedAt, when the
// hub fetched it upstream). Older, or never answered at all (a hub still on a
// build without /api/weather, or the hub down), and the hooks fall back to
// asking Open-Meteo themselves.
export const FEED_MAX_AGE_MS = 90 * 60 * 1000

// A cached feed older than this is not shown even as a last resort, the same
// limit the old hooks put on their own caches.
export const FEED_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000

// The licence mark, for a WeatherKit feed that arrives without its own.
export const APPLE_ATTRIBUTION = Object.freeze({
  name: 'Apple Weather',
  url: 'https://weatherkit.apple.com/legal-attribution.html',
})

const SOURCES = ['weatherkit', 'open-meteo']

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v) {
  return typeof v === 'string' && v ? v : null
}

function roundOrNull(v) {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// --- WMO codes (the hooks' own table) -----------------------------------------------
//
// views/TodayLayouts/data/wmo.js keeps a copy for the layouts; the two tables
// have to stay in step. The names are the keys of FILES in
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

// '8AM', '12PM': the Framed Today's slot labels.
export function hourLabel(hour) {
  if (hour === 0) return '12AM'
  if (hour === 12) return '12PM'
  if (hour < 12) return `${hour}AM`
  return `${hour - 12}PM`
}

// --- Dates and stamps -------------------------------------------------------------------

// 'YYYY-MM-DD' of a Date, local.
export function localDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// '2026-09-26T08:00': the local stamp of an hour's start.
export function hourStamp(dateKey, hour) {
  return `${dateKey}T${pad2(hour)}:00`
}

// '2026-09-26T08' from any local stamp in that hour, or null.
export function hourKeyOf(time) {
  return typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(time) ? time.slice(0, 13) : null
}

// A local wall-clock stamp ('2026-09-26T07:02', or a bare '2026-09-26') as a
// Date in this screen's zone, or null. A bare date parses as UTC midnight in
// JS, the previous day west of Greenwich, so it gets a time first.
export function parseLocalStamp(s) {
  if (typeof s !== 'string' || !s) return null
  const d = new Date(s.indexOf('T') >= 0 ? s : `${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

// --- The feed -------------------------------------------------------------------------

function listOf(v, keep) {
  return Array.isArray(v) ? v.filter(keep) : []
}

// cleanFeed(raw) -> the contract with every key present and typed, or null
// when raw is not a feed at all. Entries without a usable stamp are dropped;
// the rest are passed through as the hub sent them (the panels read each field
// defensively). A WeatherKit feed always carries its attribution.
export function cleanFeed(raw) {
  if (!isObj(raw)) return null
  const source = SOURCES.indexOf(raw.source) >= 0 ? raw.source : null
  const loc = isObj(raw.location) ? raw.location : {}
  const nh = isObj(raw.nextHour) ? raw.nextHour : null
  const sun = isObj(raw.sun) ? raw.sun : {}
  const moon = isObj(raw.moon) ? raw.moon : {}
  const a = isObj(raw.attribution) ? raw.attribution : null
  let attribution = null
  if (source === 'weatherkit') {
    attribution = a && str(a.name) && str(a.url) ? { name: a.name, url: a.url } : { ...APPLE_ATTRIBUTION }
  }
  const stamped = (e) => isObj(e) && hourKeyOf(e.time) != null
  return {
    source,
    fetchedAt: str(raw.fetchedAt),
    error: str(raw.error),
    location: { lat: num(loc.lat), lon: num(loc.lon), timezone: str(loc.timezone) },
    current: isObj(raw.current) ? raw.current : null,
    hourly: listOf(raw.hourly, stamped),
    daily: listOf(raw.daily, (d) => isObj(d) && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.date)),
    nextHour: nh ? { summary: listOf(nh.summary, stamped), minutes: listOf(nh.minutes, stamped) } : null,
    alerts: listOf(raw.alerts, (x) => isObj(x) && typeof x.event === 'string' && x.event.trim() !== ''),
    sun: { sunrise: str(sun.sunrise), sunset: str(sun.sunset) },
    moon: { phase: num(moon.phase), name: str(moon.name) },
    attribution,
  }
}

// ms epoch of the feed's own fetchedAt (the hub's upstream fetch), or null.
export function feedTimeMs(feed) {
  if (!feed || typeof feed.fetchedAt !== 'string') return null
  const t = Date.parse(feed.fetchedAt)
  return Number.isFinite(t) ? t : null
}

// Anything to draw: current conditions, hours or days.
export function hasFeedData(feed) {
  return !!feed && (feed.current != null || feed.hourly.length > 0 || feed.daily.length > 0)
}

// Is the feed current enough to show without asking Open-Meteo? Its data is
// at most FEED_MAX_AGE_MS old. A hub clock a little ahead of this screen's
// reads as fresh.
export function feedFresh(feed, nowMs, maxAgeMs = FEED_MAX_AGE_MS) {
  if (!hasFeedData(feed)) return false
  const t = feedTimeMs(feed)
  return t != null && nowMs - t <= maxAgeMs
}

// --- Hours --------------------------------------------------------------------------
//
// The hub serves today's hours from local midnight (then 48 past the current
// hour), so the Framed Today's slots (8, 11, 14, 17, 20) and the departure-hour
// lookup find today's earlier hours in the feed itself, even on a fresh load
// in the afternoon. A hub on a build that served from the current hour only
// leaves the earlier slots as placeholders.

// The entry for the hour starting at `hour`:00 on `dateKey`, or null.
export function entryAt(hours, dateKey, hour) {
  if (!Array.isArray(hours)) return null
  const want = `${dateKey}T${pad2(hour)}`
  for (let i = 0; i < hours.length; i++) {
    if (hourKeyOf(hours[i] && hours[i].time) === want) return hours[i]
  }
  return null
}

// useWeather's forecastForHour from feed hours: { code, tempF } or null.
export function forecastFromHours(hours, dateKey, hour) {
  const e = entryAt(hours, dateKey, hour)
  if (!e) return null
  return {
    code: typeof e.code === 'number' ? e.code : null,
    tempF: typeof e.tempF === 'number' ? Math.round(e.tempF) : null,
  }
}

// useWeather's slots from feed hours: [{ label, iconName, tempF }] for the
// given hours of `dateKey`, a placeholder where there is no such hour.
export function slotsFromHours(hours, slotHours, dateKey) {
  return (Array.isArray(slotHours) ? slotHours : []).map((hour) => {
    const e = entryAt(hours, dateKey, hour)
    if (!e) return { label: hourLabel(hour), iconName: 'overcast', tempF: null }
    return {
      label: hourLabel(hour),
      iconName: wmoToIcon(e.code),
      tempF: typeof e.tempF === 'number' ? Math.round(e.tempF) : null,
    }
  })
}

// useWeather's `hourly` (Open-Meteo's column arrays, as the direct fetch
// returned them) from feed hours, so the hook's output keeps its shape.
export function openMeteoColumnsOf(hours) {
  const list = Array.isArray(hours) ? hours : []
  return {
    time: list.map((e) => e.time),
    temperature_2m: list.map((e) => num(e.tempF)),
    weather_code: list.map((e) => num(e.code)),
  }
}

// --- The direct Open-Meteo fetch (the fallback) ----------------------------------------
//
// These are the old hooks' own readings of an Open-Meteo payload, moved here
// unchanged so the fallback and the feed are derived side by side (and the
// alignment test can hold one against the other).

// useWeather's slots from an Open-Meteo hourly payload (`hourly.time`,
// `temperature_2m`, `weather_code`).
export function pickSlots(payload, slotHours, dateKey) {
  const times = (payload && payload.hourly && payload.hourly.time) || []
  const temps = (payload && payload.hourly && payload.hourly.temperature_2m) || []
  const codes = (payload && payload.hourly && payload.hourly.weather_code) || []
  return slotHours.map((hour) => {
    const idx = times.indexOf(hourStamp(dateKey, hour))
    if (idx === -1) {
      return { label: hourLabel(hour), iconName: 'overcast', tempF: null }
    }
    return {
      label: hourLabel(hour),
      iconName: wmoToIcon(codes[idx]),
      tempF: Math.round(temps[idx]),
    }
  })
}

// useWeather's forecastForHour from Open-Meteo's hourly columns.
export function forecastFromColumns(h, dateKey, hour) {
  if (!h || !h.time) return null
  const idx = h.time.indexOf(hourStamp(dateKey, hour))
  if (idx === -1) return null
  const code = h.weather_code && h.weather_code[idx]
  const temp = h.temperature_2m && h.temperature_2m[idx]
  return {
    code: typeof code === 'number' ? code : null,
    tempF: typeof temp === 'number' ? Math.round(temp) : null,
  }
}

// --- The daily block ------------------------------------------------------------------
//
// useDailyForecast holds a plain, JSON-safe snapshot, { current, days }, and
// derives its view (Dates, icons, descriptions) from it. These build that
// snapshot from either source; for the same weather the two are equal.

const DAYS_KEPT = 7

// From an Open-Meteo payload with `current` and `daily` (the fallback).
export function dailySnapshotFromOpenMeteo(payload) {
  const cur = (payload && payload.current) || {}
  const daily = (payload && payload.daily) || {}
  const times = Array.isArray(daily.time) ? daily.time : []
  const at = (name, i) => (Array.isArray(daily[name]) ? daily[name][i] : undefined)
  return {
    current: {
      tempF: roundOrNull(cur.temperature_2m),
      feelsLikeF: roundOrNull(cur.apparent_temperature),
      code: num(cur.weather_code),
      windMph: roundOrNull(cur.wind_speed_10m),
      isDay: cur.is_day == null ? null : !!cur.is_day,
    },
    days: times.slice(0, DAYS_KEPT).map((iso, i) => ({
      dateIso: iso,
      code: num(at('weather_code', i)),
      highF: roundOrNull(at('temperature_2m_max', i)),
      lowF: roundOrNull(at('temperature_2m_min', i)),
      precipPct: roundOrNull(at('precipitation_probability_max', i)),
      sunriseIso: typeof at('sunrise', i) === 'string' ? at('sunrise', i) : null,
      sunsetIso: typeof at('sunset', i) === 'string' ? at('sunset', i) : null,
    })),
  }
}

// From the hub's feed.
export function dailySnapshotFromFeed(feed) {
  const cur = (feed && feed.current) || {}
  const daily = feed && Array.isArray(feed.daily) ? feed.daily : []
  return {
    current: {
      tempF: roundOrNull(cur.tempF),
      feelsLikeF: roundOrNull(cur.feelsF),
      code: num(cur.code),
      windMph: roundOrNull(cur.windMph),
      isDay: cur.isDay == null ? null : !!cur.isDay,
    },
    days: daily.slice(0, DAYS_KEPT).map((d) => ({
      dateIso: d.date,
      code: num(d.code),
      highF: roundOrNull(d.highF),
      lowF: roundOrNull(d.lowF),
      precipPct: roundOrNull(d.precipProbMax),
      sunriseIso: typeof d.sunrise === 'string' ? d.sunrise : null,
      sunsetIso: typeof d.sunset === 'string' ? d.sunset : null,
    })),
  }
}
