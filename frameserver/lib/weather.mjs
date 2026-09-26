// weather.mjs - the hub's one weather feed (docs/designs/panels-and-controls.md,
// "One weather feed"; docs/designs/entry-board.md's headline weather rules
// keep reading lib/hubWeather.mjs, now a thin adapter over this).
//
// GET /api/weather serves this feed's current snapshot directly (server.mjs).
// Apple WeatherKit (lib/weatherKit.mjs) when configured, Open-Meteo
// (lib/openMeteoWeather.mjs) otherwise, with automatic fallback: whichever
// source is NOT the preferred one for a `WEATHER_SOURCE=weatherkit|open-meteo`
// setting is still tried when the preferred one fails, so `source` in the
// response always says which data is actually in it, while `error` explains
// why the PREFERRED source (WeatherKit, in `auto`, when configured) is not
// what is being served, if anything. `WEATHER_SOURCE=auto` (default): prefer
// WeatherKit when it is configured, else Open-Meteo.
//
// A location's IANA timezone (shared.location.timezone is usually the literal
// string 'auto', device-registry.md) is resolved once via a plain Open-Meteo
// fetch (which resolves it from lat/lon for free: the `timezone` field of its
// own response) and cached indefinitely per location - timezones do not move.
// A shared.location.timezone that already names a real zone overrides this.
// WeatherKit's request needs a real zone; every local-stamp field in the
// contract (`time`, `date`, `sunrise`, `sunset`) does too, for the same reason
// hubWeather.mjs's Open-Meteo stamps already work with weatherRules.mjs: they
// are parsed with `new Date(offsetless)`, which JS reads in the process's own
// zone (the house's).
//
// Refreshed every 15 minutes, retried in 5 after a failure, single-flight, one
// disk cache (CACHE_FILE, in the service root) so a restart serves the last
// snapshot at once; a snapshot survives up to MAX_AGE_MS (3 hours) past its
// fetch before it is treated as no snapshot at all. Alerts are NOT frozen into
// that cache: `getWeather()` merges the source's own alerts (WeatherKit's, if
// any) with lib/nwsAlerts.mjs's live list (injected as `getNwsAlerts`, to
// avoid a lib/nwsAlerts.mjs <-> lib/hubWeather.mjs <-> lib/weather.mjs import
// cycle - server.mjs wires the real one through) fresh on every read, deduped
// by event name + end time, NWS preferred on a clash, ended alerts dropped,
// most severe first (lib/weatherRules.mjs's own activeAlerts/compareAlerts).
//
// getWeather(now) -> the /api/weather contract. startWeatherRefresher(getLocation,
// options) starts it (lib/hubWeather.mjs calls this; nothing else should).
// brief() -> { source, fetchedAt, error, weatherKit: { configured, lastOkAt,
// lastError }, openMeteo: { lastOkAt, lastError } } for GET /healthz.

import { join } from 'node:path'
import { isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'
import { coordsOf } from './hubWeather.mjs'
import { activeAlerts, compareAlerts } from './weatherRules.mjs'
import { fetchOpenMeteoWeather } from './openMeteoWeather.mjs'
import { fetchWeatherKit, loadWeatherKitConfig, normalizeWeatherKit } from './weatherKit.mjs'

export const CACHE_FILE = 'weather-feed-cache.json'
export const REFRESH_MS = 15 * 60 * 1000
export const RETRY_MS = 5 * 60 * 1000
export const MAX_AGE_MS = 3 * 60 * 60 * 1000
const LOCATION_CHECK_MS = 60 * 1000

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function locationKey(loc) {
  const c = coordsOf(loc)
  return c ? `${c.lat},${c.lon}` : 'none'
}

// 'auto' (or missing) is what shared.location normally carries; anything else
// is an operator override, trusted as is.
function explicitTimezone(loc) {
  const v = str(loc?.timezone)
  return v && v.toLowerCase() !== 'auto' ? v : null
}

// auto: WeatherKit when configured, else Open-Meteo; a pinned value always
// names the preferred source, but the other one is still tried on failure -
// see the header comment on why that is not "ignoring the pin".
function preferredSource(weatherKitCfg) {
  const pin = str(process.env.WEATHER_SOURCE)?.toLowerCase()
  if (pin === 'weatherkit' || pin === 'open-meteo') return pin
  return weatherKitCfg.configured ? 'weatherkit' : 'open-meteo'
}

function candidateOrder(preferred) {
  return preferred === 'weatherkit' ? ['weatherkit', 'open-meteo'] : ['open-meteo', 'weatherkit']
}

// The NWS shape (lib/nwsAlerts.mjs's normalised alerts) -> the contract's
// alert shape.
function nwsToContract(a) {
  return {
    id: a.id, event: a.event, severity: a.severity, urgency: a.urgency, certainty: a.certainty,
    headline: a.headline, description: a.description, onset: a.onset, ends: a.ends,
    source: 'nws', url: null,
  }
}

// NWS first (so a clash keeps NWS's version, which weatherRules.mjs's rules
// are pinned against), then WeatherKit's own, deduped by event name + end
// time, ended ones dropped, most severe first.
function mergeAlerts(nwsAlerts, weatherKitAlerts, now) {
  const seen = new Set()
  const merged = []
  for (const a of [...nwsAlerts, ...weatherKitAlerts]) {
    if (!a || typeof a !== 'object') continue
    const key = `${String(a.event || '').trim().toLowerCase()}|${a.ends || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(a)
  }
  return activeAlerts(merged, now).sort(compareAlerts)
}

const validCache = (v) =>
  isDict(v) && typeof v.fetchedAt === 'string' && (v.source === 'weatherkit' || v.source === 'open-meteo') && isDict(v.location) && isDict(v.snapshot)

function fresh(v, now) {
  const age = now.getTime() - Date.parse(v.fetchedAt)
  return Number.isFinite(age) && age >= -60_000 && age <= MAX_AGE_MS
}

const EMPTY_SNAPSHOT = Object.freeze({
  current: null, hourly: [], daily: [], nextHour: null, alerts: [],
  sun: { sunrise: null, sunset: null }, moon: { phase: null, name: null }, attribution: null,
})

// getLocation() -> the registry's shared.location, read on every refresh and
// once a minute. weatherKitConfig()/getNwsAlerts()/request*() and `clock` are
// for tests; server.mjs supplies the real ones (weatherKitConfig from
// lib/weatherKit.mjs against ROOT, getNwsAlerts from lib/nwsAlerts.mjs's
// getAlerts).
export function createWeather({
  dir,
  getLocation,
  log = (m) => console.log(m),
  clock = () => new Date(),
  weatherKitConfig = () => loadWeatherKitConfig({ root: dir }),
  getNwsAlerts = () => ({ alerts: [] }),
  requestWeatherKit,
  requestOpenMeteo,
}) {
  const file = dir ? join(dir, CACHE_FILE) : null
  let value = null // the last good { fetchedAt, source, location, timezone, snapshot }
  let preferredError = null // the preferred source's error, when it is not what `value` holds
  let resolvedTz = null // { key, timezone } - cached indefinitely per location
  let seenKey = null
  let weatherKitInfo = { lastOkAt: null, lastError: null }
  let openMeteoInfo = { lastOkAt: null, lastError: null }
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

  function persist() {
    if (!file || !value) return
    try {
      writeJsonFileAtomic(file, { ...value, resolvedTz })
    } catch (e) {
      log(`[weather] could not write ${file}: ${e.message}`)
    }
  }

  // A real zone from shared.location wins outright; otherwise once per
  // location, ask Open-Meteo (its own `timezone=auto` resolution) and keep it
  // - a location's zone does not change. Returns the zone plus, when this
  // call itself had to fetch Open-Meteo, that fetch's already-parsed snapshot
  // - free data `refresh()` can serve from directly instead of fetching
  // Open-Meteo a second time in the same cycle when it also turns out to be
  // the chosen (or fallback) source.
  async function resolveTimezone(loc, key) {
    const explicit = explicitTimezone(loc)
    if (explicit) return { timezone: explicit, bonus: null }
    if (resolvedTz && resolvedTz.key === key) return { timezone: resolvedTz.timezone, bonus: null }
    // This talks to Open-Meteo whether or not it ends up the chosen source
    // (WeatherKit may still win the cycle below and let `bonus` go unused),
    // so brief()'s openMeteo bookkeeping is updated here too, not only in the
    // fetch loop.
    let resolved
    try {
      resolved = await fetchOpenMeteoWeather(coordsOf(loc), requestOpenMeteo)
      if (!resolved.timezone) throw new Error('Open-Meteo did not resolve a timezone for this location')
    } catch (e) {
      openMeteoInfo.lastError = String(e.message || e)
      throw e
    }
    openMeteoInfo.lastOkAt = clock().toISOString()
    openMeteoInfo.lastError = null
    resolvedTz = { key, timezone: resolved.timezone }
    return { timezone: resolved.timezone, bonus: resolved }
  }

  async function fetchFrom(src, coords, timezone) {
    if (src === 'weatherkit') {
      const cfg = weatherKitConfig()
      const payload = await fetchWeatherKit({ lat: coords.lat, lon: coords.lon, timezone, config: cfg, request: requestWeatherKit, now: clock() })
      return normalizeWeatherKit(payload, { timezone, now: clock(), log })
    }
    return fetchOpenMeteoWeather(coords, requestOpenMeteo)
  }

  // Never rejects: the result lands in `value`, a failure in `preferredError`
  // and the per-source info, both logged.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const loc = readLocation()
      const coords = coordsOf(loc)
      const key = locationKey(loc)
      seenKey = key
      let ok = false
      try {
        if (!coords) throw new Error('no shared.location in the registry')
        const { timezone, bonus } = await resolveTimezone(loc, key)
        const preferred = preferredSource(weatherKitConfig())
        const order = candidateOrder(preferred)

        let snapshot = null
        let usedSource = null
        let firstError = null
        for (const src of order) {
          try {
            // resolveTimezone() may have already fetched Open-Meteo just now
            // (to learn the zone); reuse that instead of asking it again.
            snapshot = src === 'open-meteo' && bonus ? bonus : await fetchFrom(src, coords, timezone)
            usedSource = src
            const info = src === 'weatherkit' ? weatherKitInfo : openMeteoInfo
            info.lastOkAt = clock().toISOString()
            info.lastError = null
            break
          } catch (e) {
            const msg = String(e.message || e)
            const info = src === 'weatherkit' ? weatherKitInfo : openMeteoInfo
            info.lastError = msg
            if (src === preferred) firstError = msg
          }
        }

        if (snapshot) {
          const first = !value
          const { timezone: _tz, ...snapshotOnly } = snapshot
          value = { fetchedAt: clock().toISOString(), source: usedSource, location: coords, timezone, snapshot: snapshotOnly }
          preferredError = usedSource === preferred ? null : firstError
          persist()
          ok = true
          if (first || failing || usedSource !== preferred) {
            log(`[weather] ${usedSource} for ${key}: ${snapshot.hourly.length} h, ${snapshot.daily.length} day(s)` +
                (usedSource !== preferred ? ` (${preferred} failed: ${firstError}; falling back)` : '') + ` (${reason})`)
          }
        } else {
          preferredError = firstError || 'both weather sources failed'
          const keep = value && fresh(value, clock()) && value.location && locationKey(value.location) === key
          if (!failing) {
            log(`[weather] refresh failed (${reason}): ${preferredError}; ` +
                (keep ? `keeping the forecast from ${value.fetchedAt}` : 'no forecast until the next try'))
          }
        }
        failing = !ok
      } catch (e) {
        preferredError = String(e.message || e)
        if (!failing) log(`[weather] refresh failed (${reason}): ${preferredError}`)
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

  // The current snapshot's source data, or EMPTY_SNAPSHOT when there is none
  // usable (never fetched, or the cache aged past MAX_AGE_MS).
  function servedSnapshot(now) {
    if (value && fresh(value, now) && locationKey(value.location) === seenKey) return value
    return null
  }

  return {
    start() {
      const saved = file ? readJsonFile(file, null) : null
      const key = locationKey(readLocation())
      if (validCache(saved) && fresh(saved, clock()) && locationKey(saved.location) === key) {
        value = saved
        if (isDict(saved.resolvedTz) && saved.resolvedTz.key === key) resolvedTz = saved.resolvedTz
      }
      seenKey = key
      refresh('startup')
      clearInterval(watch)
      watch = setInterval(checkLocation, LOCATION_CHECK_MS)
      watch.unref?.()
      return value ? { fetchedAt: value.fetchedAt, source: value.source } : null
    },

    // The full /api/weather contract.
    getWeather(now = clock()) {
      const served = servedSnapshot(now)
      const loc = readLocation()
      const coords = coordsOf(loc) || served?.location || null
      const timezone = served?.timezone || explicitTimezone(loc) || resolvedTz?.timezone || null
      const snap = served?.snapshot || EMPTY_SNAPSHOT
      const source = served?.source || preferredSource(weatherKitConfig())
      const nws = (() => {
        try {
          const g = getNwsAlerts()
          return Array.isArray(g?.alerts) ? g.alerts : []
        } catch {
          return []
        }
      })()
      return {
        source,
        fetchedAt: served?.fetchedAt ?? null,
        // The PREFERRED source's error from the last refresh attempt (why it
        // is not what `source`/the fields below came from, if it is not),
        // set by refresh() - not re-derived here, so it always matches what
        // was actually attempted.
        error: preferredError,
        location: { lat: coords?.lat ?? null, lon: coords?.lon ?? null, timezone },
        current: snap.current,
        hourly: snap.hourly,
        daily: snap.daily,
        nextHour: snap.nextHour,
        alerts: mergeAlerts(nws.map(nwsToContract), Array.isArray(snap.alerts) ? snap.alerts : [], now),
        sun: snap.sun,
        moon: snap.moon,
        attribution: snap.attribution,
      }
    },

    // GET /healthz.weather.
    brief() {
      const cfg = weatherKitConfig()
      const preferred = preferredSource(cfg)
      return {
        source: value?.source || preferred,
        fetchedAt: value?.fetchedAt ?? null,
        error: preferredError,
        weatherKit: { configured: cfg.configured, lastOkAt: weatherKitInfo.lastOkAt, lastError: weatherKitInfo.lastError },
        openMeteo: { lastOkAt: openMeteoInfo.lastOkAt, lastError: openMeteoInfo.lastError },
      }
    },

    refresh,
    stop() {
      clearTimeout(timer)
      clearInterval(watch)
    },
  }
}

// --- the hub's one weather feed -----------------------------------------------------

let feed = null

// lib/hubWeather.mjs's startWeatherRefresher forwards here; nothing else
// should call this directly. options: { dir, getNwsAlerts, log, clock,
// weatherKitConfig, requestWeatherKit, requestOpenMeteo } - all optional
// except that server.mjs always supplies `dir` and `getNwsAlerts`.
export function startWeatherRefresher(getLocation, options = {}) {
  feed?.stop()
  feed = createWeather({ ...options, getLocation })
  return feed.start()
}

export function getWeather(now = new Date()) {
  if (feed) return feed.getWeather(now)
  return {
    source: 'open-meteo', fetchedAt: null, error: 'not started',
    location: { lat: null, lon: null, timezone: null },
    ...EMPTY_SNAPSHOT,
  }
}

export function brief() {
  if (feed) return feed.brief()
  return {
    source: 'open-meteo', fetchedAt: null, error: 'not started',
    weatherKit: { configured: false, lastOkAt: null, lastError: null },
    openMeteo: { lastOkAt: null, lastError: null },
  }
}
