// hubWeather.mjs - the hub's own forecast for the house, for the headline.
//
// The screens fetch Open-Meteo themselves for what they draw
// (code/src/hooks/useWeather.js, TodayLayouts/data/useDailyForecast.js). The
// headline's weather lines (lib/weatherRules.mjs) are computed on the hub, so
// it keeps a forecast of its own: Open-Meteo for shared.location, in the units
// the app asks for (Fahrenheit, mph; inches for rain), timezone=auto:
//
//   hourly, 48 hours from the current hour: temperature_2m,
//     apparent_temperature, precipitation_probability, precipitation,
//     weather_code, wind_gusts_10m, wind_speed_10m
//   daily, 3 days from today: temperature_2m_max, temperature_2m_min,
//     precipitation_probability_max, weather_code, sunrise, sunset
//
// getForecast(now) -> { fetchedAt, error, hourly, daily }
//   hourly: [{ time, tempF, feelsF, precipProb, precipIn, code, gustMph, windMph }]
//     `time` is Open-Meteo's local stamp ('2026-09-24T15:00'), and each entry
//     is the hour STARTING then: tempF, feelsF and windMph are the values at
//     `time`; precipProb, precipIn, code and gustMph cover the hour after it.
//     Open-Meteo stamps those four at the END of their hour (its docs:
//     "preceding hour" probability, sum and maximum; the code's rain comes
//     from that same preceding-hour sum), so they are moved back one stamp
//     here. Its 15:00 "60 %" is rain between 2 and 3 pm, and the headline
//     should say "Rain from 2 pm", not 3.
//   daily: [{ date: 'YYYY-MM-DD', highF, lowF, precipProbMax, code, sunrise, sunset }]
//     sunrise / sunset are local stamps ('2026-09-24T06:59').
//   fetchedAt: ISO of the last good fetch (null before one); error: the last
//   failure's message, null once a fetch succeeds.
//   A forecast older than 12 hours, or fetched for another location, is no
//   forecast: hourly and daily come back empty; fetchedAt and error say why.
//
// Refreshed every 30 minutes, at startup, and within a minute of a
// shared.location change; retried in 5 minutes after a failure; one fetch at
// a time. Persisted to weather-cache.json in the service root, so a restart
// serves the last copy at once.

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'weather_code',
  'wind_gusts_10m',
  'wind_speed_10m',
]
export const DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'weather_code',
  'sunrise',
  'sunset',
]
export const HOURS = 48
export const DAYS = 3
export const REFRESH_MS = 30 * 60 * 1000
export const RETRY_MS = 5 * 60 * 1000
export const MAX_AGE_MS = 12 * 60 * 60 * 1000
export const CACHE_FILE = 'weather-cache.json'
const LOCATION_CHECK_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const USER_AGENT = 'KitchenSmartDisplay/1.0 (+hub)'
// Where server.mjs's ROOT would be; server.mjs passes its own anyway.
const DEFAULT_DIR = process.env.FRAMESERVER_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..')

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
const str = (v) => (typeof v === 'string' && v ? v : null)

// shared.location -> { lat, lon } numbers, or null when it is not usable.
export function coordsOf(loc) {
  if (!isDict(loc) || loc.lat == null || loc.lon == null || loc.lat === '' || loc.lon === '') return null
  const lat = Number(loc.lat)
  const lon = Number(loc.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
}

// Everything that changes the answer. A different key means fetch again.
function locationKey(loc) {
  const c = coordsOf(loc)
  return c ? `${c.lat},${c.lon}` : 'none'
}

export function forecastUrl(location) {
  const url = new URL(FORECAST_URL)
  url.searchParams.set('latitude', String(location.lat))
  url.searchParams.set('longitude', String(location.lon))
  url.searchParams.set('hourly', HOURLY_VARS.join(','))
  url.searchParams.set('daily', DAILY_VARS.join(','))
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('wind_speed_unit', 'mph')
  url.searchParams.set('precipitation_unit', 'inch')
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', String(DAYS))
  // One stamp past HOURS: the last hour's rain and gusts sit on the next stamp.
  url.searchParams.set('forecast_hours', String(HOURS + 1))
  return url
}

// An Open-Meteo payload -> the snapshot (without location). Throws when it
// carries no hourly data.
export function parseForecast(payload, now = new Date()) {
  const h = payload?.hourly
  const times = Array.isArray(h?.time) ? h.time : []
  if (times.length < 2) throw new Error('no hourly data in the response')
  const col = (name) => (Array.isArray(h[name]) ? h[name] : [])
  const temp = col('temperature_2m')
  const feels = col('apparent_temperature')
  const wind = col('wind_speed_10m')
  const prob = col('precipitation_probability')
  const rain = col('precipitation')
  const code = col('weather_code')
  const gust = col('wind_gusts_10m')

  const hourly = []
  for (let i = 0; i + 1 < times.length && hourly.length < HOURS; i++) {
    if (typeof times[i] !== 'string') continue
    hourly.push({
      time: times[i],
      tempF: num(temp[i]),
      feelsF: num(feels[i]),
      // The preceding-hour values of the NEXT stamp are this hour's.
      precipProb: int(prob[i + 1]),
      precipIn: num(rain[i + 1]),
      code: int(code[i + 1]),
      gustMph: num(gust[i + 1]),
      windMph: num(wind[i]),
    })
  }

  const d = isDict(payload?.daily) ? payload.daily : {}
  const dates = Array.isArray(d.time) ? d.time : []
  const at = (name, i) => (Array.isArray(d[name]) ? d[name][i] : undefined)
  const daily = dates.slice(0, DAYS).map((date, i) => ({
    date: str(date),
    highF: num(at('temperature_2m_max', i)),
    lowF: num(at('temperature_2m_min', i)),
    precipProbMax: int(at('precipitation_probability_max', i)),
    code: int(at('weather_code', i)),
    sunrise: str(at('sunrise', i)),
    sunset: str(at('sunset', i)),
  }))

  return { fetchedAt: now.toISOString(), error: null, hourly, daily }
}

// GET with the hub's timeout; resolves { status, body } for any HTTP status.
async function httpGet(url, headers) {
  const { res, body } = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers })
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

const validSaved = (v) =>
  isDict(v) && typeof v.fetchedAt === 'string' && Array.isArray(v.hourly) && Array.isArray(v.daily) && isDict(v.location)

function fresh(v, now) {
  const age = now.getTime() - Date.parse(v.fetchedAt)
  return Number.isFinite(age) && age >= -60_000 && age <= MAX_AGE_MS
}

// getLocation() returns the registry's shared.location ({ lat, lon, ... }),
// read on every refresh and once a minute, so a dashboard edit needs no
// restart. `request(url, headers)` -> { status, body } and `clock` are for
// tests.
export function createHubWeather({
  dir = DEFAULT_DIR,
  getLocation,
  log = (m) => console.log(m),
  request = httpGet,
  clock = () => new Date(),
}) {
  const file = dir ? join(dir, CACHE_FILE) : null
  let value = null // the last good snapshot, with the location it is for
  let error = null
  let seenKey = null // the location the latest refresh asked about
  let inFlight = null
  let rerun = false
  let failing = false
  let timer = null
  let watch = null

  const readLocation = () => {
    try {
      return getLocation()
    } catch {
      return null
    }
  }

  function schedule(ok) {
    clearTimeout(timer)
    timer = setTimeout(() => refresh('timer'), ok ? REFRESH_MS : RETRY_MS)
    timer.unref?.()
  }

  async function fetchSnapshot(loc) {
    const c = coordsOf(loc)
    if (!c) throw new Error('no shared.location in the registry')
    const { status, body } = await request(forecastUrl(c), { 'User-Agent': USER_AGENT })
    if (status < 200 || status >= 300) throw upstreamError(status, body)
    return parseForecast(JSON.parse(body), clock())
  }

  // Never rejects: the result lands in `value`, a failure in `error` and the log.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const loc = readLocation()
      seenKey = locationKey(loc)
      let ok = false
      try {
        const snap = await fetchSnapshot(loc)
        const first = !value
        value = { ...snap, location: coordsOf(loc) }
        error = null
        ok = true
        if (file) {
          try {
            writeJsonFileAtomic(file, value)
          } catch (e) {
            log(`[weather] could not write ${file}: ${e.message}`)
          }
        }
        if (first || failing || reason === 'location changed') {
          log(`[weather] forecast for ${seenKey}: ${snap.hourly.length} h, ${snap.daily.length} day(s) (${reason})`)
        }
        failing = false
      } catch (e) {
        error = String(e.message || e)
        if (!failing) {
          const keep = value && fresh(value, clock()) && locationKey(value.location) === seenKey
          log(`[weather] refresh failed (${reason}): ${error}; ` +
              (keep ? `keeping the forecast from ${value.fetchedAt}` : 'no forecast until the next try'))
        }
        failing = true
      } finally {
        inFlight = null
        schedule(ok)
        if (rerun) {
          rerun = false
          if (locationKey(readLocation()) !== seenKey) refresh('location changed')
        }
      }
    })()
    return inFlight
  }

  function checkLocation() {
    if (locationKey(readLocation()) === seenKey) return
    if (inFlight) rerun = true
    else refresh('location changed')
  }

  return {
    // Restore a recent forecast for this location from disk, then fetch.
    start() {
      const saved = file ? readJsonFile(file, null) : null
      const key = locationKey(readLocation())
      if (validSaved(saved) && fresh(saved, clock()) && locationKey(saved.location) === key) value = saved
      seenKey = key
      refresh('startup')
      clearInterval(watch)
      watch = setInterval(checkLocation, LOCATION_CHECK_MS)
      watch.unref?.()
      return value ? { fetchedAt: value.fetchedAt, hours: value.hourly.length } : null
    },
    current(now = clock()) {
      if (value && fresh(value, now) && locationKey(value.location) === seenKey) {
        return { fetchedAt: value.fetchedAt, error, hourly: value.hourly, daily: value.daily }
      }
      return { fetchedAt: value?.fetchedAt ?? null, error, hourly: [], daily: [] }
    },
    health() {
      return { fetchedAt: value?.fetchedAt ?? null, error }
    },
    refresh,
    stop() {
      clearTimeout(timer)
      clearInterval(watch)
    },
  }
}

// --- the hub's one forecast: a thin adapter over lib/weather.mjs -------------------
//
// Since docs/designs/panels-and-controls.md ("One weather feed"), the hub's
// weather comes from lib/weather.mjs (Apple WeatherKit when configured, else
// Open-Meteo, with automatic fallback) rather than from createHubWeather
// above. That factory, parseForecast and forecastUrl stay exactly as they
// were - frameserver/test/weatherRules.test.mjs and headline.test.mjs pin
// their Open-Meteo parsing and hour-shift semantics directly - they are just
// no longer what the running server uses. getForecast() reshapes
// lib/weather.mjs's getWeather() (whichever source) back into the narrow
// shape weatherRules.mjs and headline.mjs have always read, so both, and
// their tests, are unchanged.
import { brief as weatherBrief, getWeather, startWeatherRefresher as startWeatherFeed } from './weather.mjs'

// server.mjs: startWeatherRefresher(() => getShared().location, { dir: ROOT, getNwsAlerts: getAlerts }).
// Returns what was restored from disk ({ fetchedAt, source } or null).
export function startWeatherRefresher(getLocation, options = {}) {
  return startWeatherFeed(getLocation, options)
}

// The feed's hours run from local midnight; the rules look forward from now,
// so they get the hours not yet over, which is what they always had.
function notOverYet(h, nowMs) {
  const t = typeof h?.time === 'string' ? new Date(h.time).getTime() : NaN
  return !Number.isFinite(t) || t + 3_600_000 > nowMs
}

export function getForecast(now = new Date()) {
  const w = getWeather(now)
  const nowMs = now.getTime()
  return {
    fetchedAt: w.fetchedAt,
    error: w.error,
    hourly: (w.hourly || []).filter((h) => notOverYet(h, nowMs)).map((h) => ({
      time: h.time, tempF: h.tempF, feelsF: h.feelsF, precipProb: h.precipProb,
      precipIn: h.precipIn, code: h.code, gustMph: h.gustMph, windMph: h.windMph,
    })),
    daily: (w.daily || []).slice(0, DAYS).map((d) => ({
      date: d.date, highF: d.highF, lowF: d.lowF, precipProbMax: d.precipProbMax,
      code: d.code, sunrise: d.sunrise, sunset: d.sunset,
    })),
  }
}

// GET /healthz: { fetchedAt, error }. GET /healthz.weather (server.mjs) uses
// lib/weather.mjs's own brief() directly for the fuller per-source picture.
export function weatherHealth() {
  const b = weatherBrief()
  return { fetchedAt: b.fetchedAt, error: b.error }
}
