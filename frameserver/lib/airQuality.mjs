// airQuality.mjs - the hub's air quality reading for the house.
//
// The Entry board shows a small air quality chip next to the weather (the
// DAKboard screen had one; wildfire smoke makes it matter in late summer).
// Computed once on the hub and published as /api/state.airQuality so every
// screen shows the same number:
//
//   { pm25: 12.0, aqi: 74, label: 'Moderate', fetchedAt: ISO }
//
// Open-Meteo's air quality API (free, no key) for shared.location, current
// hour: pm2_5 in ug/m3 and the US AQI. Labels by US AQI: 0-50 Good, 51-100
// Moderate, 101-150 Unhealthy for sensitive groups, 151-200 Unhealthy,
// 201-300 Very unhealthy, 301+ Hazardous.
//
// Refreshed hourly, at startup, and as soon as shared.location changes;
// retried in 15 minutes after a failure. Persisted to air-quality.json so a
// restart shows the last reading at once. A failed fetch keeps the last
// reading, but a reading older than 6 hours is no reading (null): a stale
// "Good" during a smoke event would be worse than no chip.

import { join } from 'node:path'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'
const REFRESH_MS = 60 * 60 * 1000
const RETRY_MS = 15 * 60 * 1000
export const MAX_AGE_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

// Everything that changes the answer. A different key means refresh now.
function inputsKey(shared) {
  const loc = shared?.location || {}
  return JSON.stringify([loc.lat ?? null, loc.lon ?? null])
}

export function airQualityUrl(location) {
  const url = new URL(AIR_QUALITY_URL)
  url.searchParams.set('latitude', location.lat)
  url.searchParams.set('longitude', location.lon)
  url.searchParams.set('current', 'pm2_5,us_aqi')
  url.searchParams.set('timezone', 'auto')
  return url
}

export function aqiLabel(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi)) return null
  if (aqi <= 50) return 'Good'
  if (aqi <= 100) return 'Moderate'
  if (aqi <= 150) return 'Unhealthy for sensitive groups'
  if (aqi <= 200) return 'Unhealthy'
  if (aqi <= 300) return 'Very unhealthy'
  return 'Hazardous'
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// An Open-Meteo payload -> the reading. Throws when it carries neither value.
export function parseAirQuality(payload, now = new Date()) {
  const c = payload?.current
  const pm = finite(c?.pm2_5)
  const aqiRaw = finite(c?.us_aqi)
  if (pm == null && aqiRaw == null) throw new Error('no current pm2_5 / us_aqi in the response')
  const aqi = aqiRaw == null ? null : Math.round(aqiRaw)
  return {
    pm25: pm == null ? null : Math.round(pm * 10) / 10,
    aqi,
    label: aqiLabel(aqi),
    fetchedAt: now.toISOString(),
  }
}

const validValue = (v) => isDict(v) && typeof v.fetchedAt === 'string' && ('aqi' in v || 'pm25' in v)

function fresh(v, now) {
  const age = now.getTime() - Date.parse(v.fetchedAt)
  return Number.isFinite(age) && age >= -60_000 && age <= MAX_AGE_MS
}

// getShared() returns the registry's current shared block (read per refresh,
// so a dashboard edit is picked up without a restart).
export function createAirQuality({ dir, getShared, log = (m) => console.log(m) }) {
  const file = join(dir, 'air-quality.json')
  let value = null
  let lastKey = null
  let inFlight = null
  let rerun = false
  let failing = false
  let timer = null

  function schedule(ok) {
    clearTimeout(timer)
    timer = setTimeout(() => refresh('timer'), ok ? REFRESH_MS : RETRY_MS)
    timer.unref?.()
  }

  async function fetchReading(shared) {
    const loc = shared?.location
    if (!isDict(loc) || loc.lat == null || loc.lon == null) {
      throw new Error('no shared.location in the registry')
    }
    const { res, body } = await fetchWithTimeout(airQualityUrl(loc), {
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': 'KitchenSmartDisplay/1.0 (+hub)' },
    })
    if (!res.ok) throw new Error(`Open-Meteo air quality HTTP ${res.status}`)
    return parseAirQuality(JSON.parse(body.toString('utf8')), new Date())
  }

  // Never rejects: the result lands in `value`, failures only in the log.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const shared = getShared()
      lastKey = inputsKey(shared)
      let ok = false
      try {
        const next = await fetchReading(shared)
        const changed = !value || value.label !== next.label
        value = next
        ok = true
        try {
          writeJsonFileAtomic(file, value)
        } catch (e) {
          log(`[air] could not write ${file}: ${e.message}`)
        }
        if (changed || failing) log(`[air] AQI ${next.aqi ?? '?'} (${next.label ?? 'no label'}), PM2.5 ${next.pm25 ?? '?'} (${reason})`)
        failing = false
      } catch (e) {
        if (!failing) {
          const keep = value && fresh(value, new Date())
          log(`[air] refresh failed (${reason}): ${e.message}; ` +
              (keep ? `keeping the reading from ${value.fetchedAt}` : 'no reading until the next try'))
        }
        failing = true
      } finally {
        inFlight = null
        schedule(ok)
        if (rerun) {
          rerun = false
          if (inputsKey(getShared()) !== lastKey) refresh('location changed')
        }
      }
    })()
    return inFlight
  }

  return {
    // Restore a recent reading from disk, then fetch a fresh one.
    start() {
      const saved = readJsonFile(file, null)
      if (validValue(saved) && fresh(saved, new Date())) value = saved
      refresh('startup')
      return value
    },
    // The reading, or null when there is none younger than 6 hours.
    current(now = new Date()) {
      return value && fresh(value, now) ? value : null
    },
    // Call with the registry's shared block whenever it may have changed.
    noteShared(shared) {
      if (inputsKey(shared) === lastKey) return
      if (inFlight) rerun = true
      else refresh('location changed')
    },
    refresh,
    stop() {
      clearTimeout(timer)
    },
  }
}
