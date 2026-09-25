import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../../lib/settings.js'
import { dateKey } from '../../../lib/schoolDay.js'
import { wmoToIcon, wmoDescription } from './wmo.js'

// useDailyForecast - the second Open-Meteo call the new Today layouts need:
// current conditions plus a five day daily block (highs, lows, precip odds,
// sunrise, sunset). hooks/useWeather.js fetches the HOURLY block for the
// Framed view's time slots and stays untouched; this one asks for what a
// forecast strip and a sun arc need.
//
// Same shape of resilience as useWeather: seed from a localStorage cache so a
// reload during an outage still shows something, keep the prior data when a
// fetch fails, and mark it stale rather than blanking it.
//
// Docs: https://open-meteo.com/en/docs

const REFRESH_MS = 15 * 60 * 1000
const ERROR_RETRY_MS = 2 * 60 * 1000   // shorter retry when the API is down
const CACHE_KEY = 'kioskDailyForecastCache'
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000  // older than this is not useful

// What we persist and hold in state is a plain, JSON-safe snapshot (ISO date
// strings, no Date objects). The Date-bearing view model is derived from it in
// a useMemo, so it survives a round trip through localStorage unchanged and
// consumers get one stable object identity per fetch.

function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.snapshot || !parsed?.fetchedAt) return null
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(snapshot) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ snapshot, fetchedAt: Date.now() }))
  } catch {
    // ignore (quota, etc.)
  }
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function roundOrNull(v) {
  const n = numOrNull(v)
  return n == null ? null : Math.round(n)
}

// Open-Meteo returns local wall-clock stamps when a timezone is requested:
// '2026-09-04T06:32' for sunrise, but a bare '2026-09-04' for the daily date.
// JS parses an offset-less DATE-TIME as local (what we want) and a bare DATE as
// UTC midnight - which is the previous day anywhere west of Greenwich and would
// shift every day label by one. Adding a time forces the local reading.
function parseLocal(iso) {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function toSnapshot(payload) {
  const cur = payload?.current || {}
  const daily = payload?.daily || {}
  const times = Array.isArray(daily.time) ? daily.time : []
  return {
    current: {
      tempF: roundOrNull(cur.temperature_2m),
      feelsLikeF: roundOrNull(cur.apparent_temperature),
      code: numOrNull(cur.weather_code),
      windMph: roundOrNull(cur.wind_speed_10m),
      isDay: cur.is_day == null ? null : !!cur.is_day,
    },
    days: times.slice(0, 7).map((iso, i) => ({
      dateIso: iso,
      code: numOrNull(daily.weather_code?.[i]),
      highF: roundOrNull(daily.temperature_2m_max?.[i]),
      lowF: roundOrNull(daily.temperature_2m_min?.[i]),
      precipPct: roundOrNull(daily.precipitation_probability_max?.[i]),
      sunriseIso: typeof daily.sunrise?.[i] === 'string' ? daily.sunrise[i] : null,
      sunsetIso: typeof daily.sunset?.[i] === 'string' ? daily.sunset[i] : null,
    })),
  }
}

// Snapshot -> the shape consumers read. Days carry `dateKey` so the caller can
// find today without re-deriving it, and `sunrise`/`sunset` per day so a stale
// cache read after midnight can still find the right pair.
function buildView(snapshot) {
  if (!snapshot) return { current: null, days: [], sunrise: null, sunset: null }

  const days = (snapshot.days || [])
    .map((d) => {
      const date = parseLocal(d.dateIso)
      if (!date) return null
      return {
        date,
        dateKey: dateKey(date),
        code: d.code,
        iconName: wmoToIcon(d.code),
        highF: d.highF,
        lowF: d.lowF,
        precipPct: d.precipPct,
        sunrise: parseLocal(d.sunriseIso),
        sunset: parseLocal(d.sunsetIso),
      }
    })
    .filter(Boolean)

  const c = snapshot.current || {}
  // No temperature and no code means the fetch gave us nothing usable. Report
  // null rather than a panel full of dashes pretending to be a reading.
  const current =
    c.tempF == null && c.code == null
      ? null
      : {
          tempF: c.tempF ?? null,
          feelsLikeF: c.feelsLikeF ?? null,
          code: c.code ?? null,
          iconName: wmoToIcon(c.code),
          description: wmoDescription(c.code),
          windMph: c.windMph ?? null,
          isDay: c.isDay ?? null,
        }

  return {
    current,
    days,
    sunrise: days[0]?.sunrise || null,
    sunset: days[0]?.sunset || null,
  }
}

export default function useDailyForecast() {
  const { location } = useSettings()

  const [state, setState] = useState(() => {
    const cached = readCache()
    return {
      snapshot: cached?.snapshot || null,
      fetchedAt: cached?.fetchedAt || null,
      loading: !cached,
      error: null,
      stale: !!cached,   // true while we are showing cached, not fresh, data
    }
  })

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function load() {
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', location.lat)
      url.searchParams.set('longitude', location.lon)
      url.searchParams.set('timezone', location.timezone)
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('wind_speed_unit', 'mph')
      url.searchParams.set('forecast_days', '7')
      url.searchParams.set(
        'current',
        'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m'
      )
      url.searchParams.set(
        'daily',
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
      )

      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        const snapshot = toSnapshot(payload)
        writeCache(snapshot)
        setState({
          snapshot,
          fetchedAt: Date.now(),
          loading: false,
          error: null,
          stale: false,
        })
        schedule(REFRESH_MS)
      } catch (err) {
        if (cancelled) return
        // Keep whatever we already had (live or cached) - never blank it.
        setState((prev) => ({
          snapshot: prev.snapshot,
          fetchedAt: prev.fetchedAt,
          loading: false,
          error: err.message || 'fetch failed',
          stale: !!prev.snapshot,
        }))
        schedule(ERROR_RETRY_MS)
      }
    }

    function schedule(delay) {
      if (cancelled) return
      clearTimeout(timer)
      timer = setTimeout(load, delay)
    }

    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [location.lat, location.lon, location.timezone])

  const view = useMemo(() => buildView(state.snapshot), [state.snapshot])

  // One stable object per fetch, so a consumer memoising on this hook's output
  // is not invalidated by the layout's 1 Hz tick.
  return useMemo(
    () => ({
      ...view,
      loading: state.loading,
      error: state.error,
      stale: state.stale,
      fetchedAt: state.fetchedAt,
    }),
    [view, state.loading, state.error, state.stale, state.fetchedAt]
  )
}
