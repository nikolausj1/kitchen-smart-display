// travelDefault.mjs - the hub's walk-or-drive default for this morning.
//
// Each web screen used to read the Open-Meteo forecast itself and decide
// walking vs driving from the forecast at the walking departure hour. Two
// screens fetching minutes apart can land on either side of a forecast update
// and disagree ("walk" in the kitchen, "drive" on the Echo). Now the hub
// decides once and publishes it as /api/state.travelDefault:
//
//   { date: 'YYYY-MM-DD', mode: 'walking'|'driving',
//     forecast: { hour, code, tempF }, computedAt: ISO }
//
// Same request as code/src/hooks/useWeather.js, same hour and same
// decideTravelMode as useTodayData.js, so the answer matches what a screen
// would have computed on its own.
//
// Refreshed every 30 minutes, at startup, a minute after local midnight (so
// `date` rolls), and as soon as the inputs change (shared.location or
// shared.school.walkingDepart.hour). Persisted to travel-default.json so a
// restart at 6 AM does not lose the morning's answer. A failed fetch keeps the
// last value while it is still for today, otherwise there is no default
// (screens then resolve to driving, the safe choice).

import { join } from 'node:path'
import { dateKey, decideTravelMode } from './countdown.mjs'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

const REFRESH_MS = 30 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000 // after a failure, sooner than the regular cadence
const AFTER_MIDNIGHT_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

// useTodayData.js: `schoolSettings?.walkingDepart?.hour ?? 7`.
const departHour = (shared) => shared?.school?.walkingDepart?.hour ?? 7

// Everything that changes the answer. A different key means refresh now.
function inputsKey(shared) {
  const loc = shared?.location || {}
  return JSON.stringify([loc.lat ?? null, loc.lon ?? null, loc.timezone ?? null, departHour(shared)])
}

// The forecast request, parameter for parameter as useWeather.js builds it.
export function openMeteoUrl(location) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', location.lat)
  url.searchParams.set('longitude', location.lon)
  url.searchParams.set('hourly', 'temperature_2m,weather_code')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('timezone', location.timezone || 'auto')
  url.searchParams.set('forecast_days', '2')
  return url
}

// Today's entry at `hour` from an Open-Meteo payload, like useWeather's
// forecastForHour, or null when the payload has no such hour.
export function forecastAt(payload, date, hour) {
  const h = payload?.hourly
  if (!Array.isArray(h?.time)) return null
  const idx = h.time.indexOf(`${date}T${String(hour).padStart(2, '0')}:00`)
  if (idx === -1) return null
  const code = h.weather_code?.[idx]
  const temp = h.temperature_2m?.[idx]
  return {
    hour,
    code: typeof code === 'number' ? code : null,
    tempF: typeof temp === 'number' ? Math.round(temp) : null,
  }
}

const validValue = (v) =>
  isDict(v) && typeof v.date === 'string' && (v.mode === 'walking' || v.mode === 'driving')

// getShared() returns the registry's current shared block (read per refresh,
// so a dashboard edit is picked up without a restart).
export function createTravelDefault({ dir, getShared, log = (m) => console.log(m) }) {
  const file = join(dir, 'travel-default.json')
  let value = null
  let lastKey = null // inputs behind the latest attempt
  let inFlight = null
  let rerun = false
  let failing = false
  let timer = null

  function schedule(ok) {
    clearTimeout(timer)
    const now = new Date()
    const midnight = new Date(now)
    midnight.setHours(24, 0, 0, 0) // next local midnight, DST-safe
    const untilRoll = midnight.getTime() - now.getTime() + AFTER_MIDNIGHT_MS
    timer = setTimeout(() => refresh('timer'), Math.min(ok ? REFRESH_MS : RETRY_MS, untilRoll))
  }

  async function compute(shared, now) {
    const loc = shared?.location
    if (!isDict(loc) || loc.lat == null || loc.lon == null) {
      throw new Error('no shared.location in the registry')
    }
    const { res, body } = await fetchWithTimeout(openMeteoUrl(loc), {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'KitchenSmartDisplay/1.0 (+hub)' },
    })
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
    const date = dateKey(now)
    const hour = departHour(shared)
    const forecast = forecastAt(JSON.parse(body.toString('utf8')), date, hour)
    if (!forecast) throw new Error(`no hourly forecast for ${date} ${hour}:00`)
    return { date, mode: decideTravelMode(forecast), forecast, computedAt: now.toISOString() }
  }

  // Never rejects: the result lands in `value`, failures only in the log.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const shared = getShared()
      lastKey = inputsKey(shared)
      let ok = false
      try {
        const next = await compute(shared, new Date())
        const changed = !value || value.date !== next.date || value.mode !== next.mode
        value = next
        ok = true
        try {
          writeJsonFileAtomic(file, value)
        } catch (e) {
          log(`[travel] could not write ${file}: ${e.message}`)
        }
        if (changed || failing) {
          const f = next.forecast
          log(`[travel] ${next.date} ${f.hour}:00 -> ${next.mode} (code ${f.code}, ${f.tempF}F; ${reason})`)
        }
        failing = false
      } catch (e) {
        if (value && value.date !== dateKey(new Date())) value = null
        if (!failing) {
          log(`[travel] refresh failed (${reason}): ${e.message}; ` +
              (value ? `keeping today's ${value.mode}` : 'no default until the next try'))
        }
        failing = true
      } finally {
        inFlight = null
        schedule(ok)
        if (rerun) {
          rerun = false
          if (inputsKey(getShared()) !== lastKey) refresh('inputs changed')
        }
      }
    })()
    return inFlight
  }

  return {
    // Restore today's value from disk, then fetch a fresh one.
    start() {
      const saved = readJsonFile(file, null)
      if (validValue(saved) && saved.date === dateKey(new Date())) value = saved
      refresh('startup')
      return value
    },
    // The default for `now`'s date, or null. Yesterday's answer is no answer.
    current(now = new Date()) {
      return value && value.date === dateKey(now) ? value : null
    },
    // Call with the registry's shared block whenever it may have changed.
    // Cheap: a string compare unless the inputs actually moved.
    noteShared(shared) {
      if (inputsKey(shared) === lastKey) return
      if (inFlight) rerun = true
      else refresh('inputs changed')
    },
    refresh,
    stop() {
      clearTimeout(timer)
    },
  }
}
