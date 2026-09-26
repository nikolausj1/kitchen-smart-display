// openMeteoWeather.mjs - Open-Meteo, normalised to the hub's one weather
// contract (docs/designs/panels-and-controls.md, "One weather feed").
//
// This is the DEFAULT and the FALLBACK source for lib/weather.mjs: no key, no
// sign-up. It replaces the narrow forecast lib/hubWeather.mjs used to keep for
// the headline (that module's own fetch/parse stays as is, pinned by
// frameserver/test/weatherRules.test.mjs and headline.test.mjs; this is a
// separate, richer client for the full contract, DAYS=10 instead of 3, plus
// current conditions, humidity, UV, snow, and a locally computed moon phase).
//
// parseOpenMeteoWeather(payload) -> the contract's fields (minus source,
// fetchedAt, error and location, which lib/weather.mjs fills in):
//   { current, hourly, daily, nextHour: null, alerts: [], sun, moon, attribution: null }
//
// Units: Fahrenheit, mph, inches (requested that way), pressure millibars
// (Open-Meteo's surface_pressure is already hPa = mb), visibility converted to
// miles from whatever unit the response says it used (Open-Meteo ties
// visibility's unit to the wind speed unit; asking for mph gets feet back).
//
// The hours run from today's local midnight (`past_hours` asks for a day of
// them, trimmed here to midnight) through HOURS past the current hour, so
// `hourly[0].time` is today's 'T00:00' and there are HOURS plus the hours
// elapsed today: a screen drawing this morning's slots in the afternoon finds
// them in the feed.
//
// Hour semantics: `hourly[].time` is the START of the hour it describes, same
// rule as hubWeather.mjs and the same reason. Open-Meteo stamps
// precipitation_probability, precipitation, snowfall, weather_code and
// wind_gusts_10m at the END of their hour ("preceding hour"); temperature,
// apparent_temperature, wind_speed_10m, relative_humidity_2m, uv_index and
// is_day are the instant's own values. So the four/five "preceding hour"
// columns are read one stamp ahead of the rest, exactly as hubWeather.mjs
// already does for its narrower set.
//
// `condition` (the source's own text) is null for Open-Meteo: it has no
// condition-name string, only the WMO `code` shared with WeatherKit's mapped
// one. `daily[].moonPhase` and the top-level `moon` are computed locally (a
// standard synodic-month calculation): Open-Meteo has no moon data.

import { fetchWithTimeout, isDict } from './io.mjs'

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const CURRENT_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'surface_pressure',
  'visibility', 'uv_index', 'cloud_cover', 'weather_code', 'is_day', 'precipitation',
]
export const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability', 'precipitation',
  'snowfall', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'relative_humidity_2m',
  'uv_index', 'is_day',
]
export const DAILY_VARS = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max',
  'precipitation_sum', 'weather_code', 'sunrise', 'sunset', 'uv_index_max', 'wind_gusts_10m_max',
]
// Hours ahead of the current one (the current one included); the hours of
// today before it come on top.
export const HOURS = 48
// Past hours asked for: a day, enough to reach back to local midnight.
export const PAST_HOURS = 24
export const DAYS = 10

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
const str = (v) => (typeof v === 'string' && v ? v : null)
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

export function openMeteoWeatherUrl({ lat, lon }) {
  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('current', CURRENT_VARS.join(','))
  url.searchParams.set('hourly', HOURLY_VARS.join(','))
  url.searchParams.set('daily', DAILY_VARS.join(','))
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('wind_speed_unit', 'mph')
  url.searchParams.set('precipitation_unit', 'inch')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(DAYS))
  // A day back, trimmed to local midnight by the parser.
  url.searchParams.set('past_hours', String(PAST_HOURS))
  // One stamp past HOURS: the last hour's "preceding hour" columns sit on the next stamp.
  url.searchParams.set('forecast_hours', String(HOURS + 1))
  return url
}

// The indexes of the hourly stamps to keep: from the first stamp of the
// current hour's day (local midnight) through HOURS past the current hour.
// The current hour is the one `current.time` falls in (the local moment the
// response describes, which is the hour forecast_hours counts from). Without
// it, or when that hour is not among the stamps, the stamps from the first
// on, HOURS of them.
function hourWindow(times, currentTime) {
  const key = typeof currentTime === 'string' && currentTime.length >= 13 ? currentTime.slice(0, 13) : null
  const cur = key ? times.findIndex((t) => typeof t === 'string' && t.slice(0, 13) === key) : -1
  if (cur < 0) return { first: 0, last: HOURS - 1 }
  const day = key.slice(0, 10)
  let first = cur
  while (first > 0 && typeof times[first - 1] === 'string' && times[first - 1].slice(0, 10) >= day) first -= 1
  return { first, last: cur + HOURS - 1 }
}

// Visibility's unit rides along with whatever the response says it used
// (Open-Meteo ties it to the wind speed unit rather than a param of its own).
function visibilityToMiles(value, unit) {
  const v = num(value)
  if (v == null) return null
  if (unit === 'mi') return round1(v)
  if (unit === 'km') return round1(v * 0.621371)
  if (unit === 'ft') return round1(v / 5280)
  return round1(v / 1609.344) // metres, the documented default
}

// --- moon phase, computed locally (Open-Meteo has none) ----------------------------
//
// A standard synodic-month approximation: days since a known new moon, mod the
// synodic period, as a 0..1 fraction (0 and 1 are both New). Good to a
// fraction of a day, plenty for the 8 named phases below.

const SYNODIC_DAYS = 29.530588861
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14) // 2000-01-06 18:14 UTC

export function moonPhaseFraction(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  const days = (date.getTime() - KNOWN_NEW_MOON_MS) / 86_400_000
  return (((days / SYNODIC_DAYS) % 1) + 1) % 1
}

// Bucketed into the 8 named phases, each 1/8 wide and centred on its exact
// point (0.0625 either side); shared with lib/weatherKit.mjs so both sources
// use the same words for the same fraction.
const PHASE_NAMES = [
  [0.0625, 'New Moon'],
  [0.1875, 'Waxing Crescent'],
  [0.3125, 'First Quarter'],
  [0.4375, 'Waxing Gibbous'],
  [0.5625, 'Full Moon'],
  [0.6875, 'Waning Gibbous'],
  [0.8125, 'Last Quarter'],
  [0.9375, 'Waning Crescent'],
]

export function moonPhaseName(fraction) {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null
  const f = ((fraction % 1) + 1) % 1
  for (const [max, name] of PHASE_NAMES) if (f < max) return name
  return 'New Moon'
}

// A 'YYYY-MM-DD' local date -> a Date at local noon (clear of any DST edge).
function noonOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], 12)
}

// --- the response -> the contract ---------------------------------------------------

// Throws when the payload carries no hourly data at all (nothing usable).
export function parseOpenMeteoWeather(payload) {
  if (!isDict(payload)) throw new Error('not an Open-Meteo response')
  const h = payload.hourly
  const times = Array.isArray(h?.time) ? h.time : []
  if (times.length < 2) throw new Error('no hourly data in the response')
  const col = (name) => (Array.isArray(h[name]) ? h[name] : [])
  const temp = col('temperature_2m')
  const feels = col('apparent_temperature')
  const wind = col('wind_speed_10m')
  const humidity = col('relative_humidity_2m')
  const uv = col('uv_index')
  const isDayCol = col('is_day')
  const prob = col('precipitation_probability')
  const rain = col('precipitation')
  const snow = col('snowfall')
  const code = col('weather_code')
  const gust = col('wind_gusts_10m')

  const c0 = isDict(payload.current) ? payload.current : {}
  const { first, last } = hourWindow(times, c0.time)
  const hourly = []
  for (let i = first; i <= last && i + 1 < times.length; i++) {
    if (typeof times[i] !== 'string') continue
    hourly.push({
      time: times[i],
      tempF: num(temp[i]),
      feelsF: num(feels[i]),
      // The preceding-hour columns of the NEXT stamp are this hour's.
      precipProb: int(prob[i + 1]),
      precipIn: num(rain[i + 1]),
      snowIn: num(snow[i + 1]),
      code: int(code[i + 1]),
      condition: null,
      windMph: num(wind[i]),
      gustMph: num(gust[i + 1]),
      humidity: int(humidity[i]),
      uv: int(uv[i]),
      isDay: isDayCol[i] == null ? null : !!isDayCol[i],
    })
  }

  const d = isDict(payload.daily) ? payload.daily : {}
  const dates = Array.isArray(d.time) ? d.time : []
  const at = (name, i) => (Array.isArray(d[name]) ? d[name][i] : undefined)
  const daily = dates.slice(0, DAYS).map((date, i) => ({
    date: str(date),
    highF: num(at('temperature_2m_max', i)),
    lowF: num(at('temperature_2m_min', i)),
    precipProbMax: int(at('precipitation_probability_max', i)),
    precipIn: num(at('precipitation_sum', i)),
    code: int(at('weather_code', i)),
    condition: null,
    sunrise: str(at('sunrise', i)),
    sunset: str(at('sunset', i)),
    uvMax: int(at('uv_index_max', i)),
    windMaxMph: num(at('wind_gusts_10m_max', i)),
    moonPhase: moonPhaseFraction(noonOf(str(date))),
  }))

  const c = isDict(payload.current) ? payload.current : {}
  const cu = isDict(payload.current_units) ? payload.current_units : {}
  const current = typeof c.time === 'string'
    ? {
        time: c.time,
        tempF: num(c.temperature_2m),
        feelsF: num(c.apparent_temperature),
        humidity: int(c.relative_humidity_2m),
        dewF: num(c.dew_point_2m),
        windMph: num(c.wind_speed_10m),
        gustMph: num(c.wind_gusts_10m),
        windDir: int(c.wind_direction_10m),
        pressureMb: num(c.surface_pressure),
        visibilityMi: visibilityToMiles(c.visibility, cu.visibility),
        uv: int(c.uv_index),
        cloudCover: int(c.cloud_cover),
        code: int(c.weather_code),
        condition: null,
        isDay: c.is_day == null ? null : !!c.is_day,
        precipIn: num(c.precipitation),
      }
    : null

  const today = daily[0] || null
  return {
    // The IANA zone Open-Meteo resolved from lat/lon (we always ask with
    // timezone=auto): lib/weather.mjs's only way to turn shared.location's
    // 'auto' into a real zone, for both sources' local-stamp conversions and
    // for WeatherKit's own required `timezone` request parameter. Not part of
    // the public /api/weather contract itself (that surfaces it as
    // `location.timezone`); dropped from the per-source snapshot before it is
    // cached or served.
    timezone: str(payload.timezone) && payload.timezone !== 'auto' ? payload.timezone : null,
    current,
    hourly,
    daily,
    nextHour: null, // WeatherKit only
    alerts: [], // NWS is merged in by lib/weather.mjs regardless of source
    sun: today ? { sunrise: today.sunrise, sunset: today.sunset } : { sunrise: null, sunset: null },
    moon: today ? { phase: today.moonPhase, name: moonPhaseName(today.moonPhase) } : { phase: null, name: null },
    attribution: null,
  }
}

async function httpGet(url, headers) {
  const { res, body } = await fetchWithTimeout(url, { timeoutMs: 10_000, headers })
  return { status: res.status, body: body.toString('utf8') }
}

function upstreamError(status, body) {
  let reason = ''
  try {
    reason = JSON.parse(body)?.reason || ''
  } catch {
    // not JSON
  }
  return new Error(`Open-Meteo forecast HTTP ${status}${reason ? `: ${reason}` : ''}`)
}

// request(url, headers) -> { status, body }, injectable for tests.
export async function fetchOpenMeteoWeather({ lat, lon }, request = httpGet) {
  const { status, body } = await request(openMeteoWeatherUrl({ lat, lon }), {
    'User-Agent': 'KitchenSmartDisplay/1.0 (+hub)',
  })
  if (status < 200 || status >= 300) throw upstreamError(status, body)
  return parseOpenMeteoWeather(JSON.parse(body))
}
