import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../../lib/settings.js'
import { dateKey } from '../../../lib/schoolDay.js'
import useHubWeather from '../../../hooks/useHubWeather.js'
import { dailySnapshotFromFeed, dailySnapshotFromOpenMeteo, parseLocalStamp } from '../../../hooks/hubWeatherFeed.js'
import { wmoToIcon, wmoDescription } from './wmo.js'

// useDailyForecast - current conditions plus the days (highs, lows, precip
// odds, sunrise, sunset) for the new Today layouts: the forecast strip, the
// weather card, the sun arc, what to wear.
//
// Source: the hub's one weather feed (hooks/useHubWeather.js), Apple
// WeatherKit or Open-Meteo, whichever the hub serves. The direct Open-Meteo
// fetch this hook always made is kept ONLY as the fallback, while the feed
// has never answered or its data is more than 90 minutes old (a hub on a
// build without /api/weather, or the hub down). A feed past its 90 minutes is
// still shown until the fallback has something newer.
//
// Both sources become the same plain, JSON-safe snapshot, { current, days }
// (hooks/hubWeatherFeed.js dailySnapshotFromFeed / dailySnapshotFromOpenMeteo:
// ISO date strings, no Date objects), and the Date-bearing view model is
// derived from it in a useMemo, so it survives a round trip through
// localStorage unchanged and consumers get one stable object identity per
// fetch.
//
// Output, unchanged, plus `feed`: { current, days, sunrise, sunset, loading,
// error, stale, fetchedAt, feed } where `feed` is the hub's whole feed when
// that is what the view was drawn from, else null (the fallback, or nothing
// yet). useTodayData hands the feed on to the weather panels.
//
// Docs: https://open-meteo.com/en/docs

const REFRESH_MS = 15 * 60 * 1000
const ERROR_RETRY_MS = 2 * 60 * 1000   // shorter retry when the API is down
const CACHE_KEY = 'kioskDailyForecastCache'
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000  // older than this is not useful

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

// Snapshot -> the shape consumers read. Days carry `dateKey` so the caller can
// find today without re-deriving it, and `sunrise`/`sunset` per day so a stale
// cache read after midnight can still find the right pair.
function buildView(snapshot) {
  if (!snapshot) return { current: null, days: [], sunrise: null, sunset: null }

  const days = (snapshot.days || [])
    .map((d) => {
      const date = parseLocalStamp(d.dateIso)
      if (!date) return null
      return {
        date,
        dateKey: dateKey(date),
        code: d.code,
        iconName: wmoToIcon(d.code),
        highF: d.highF,
        lowF: d.lowF,
        precipPct: d.precipPct,
        sunrise: parseLocalStamp(d.sunriseIso),
        sunset: parseLocalStamp(d.sunsetIso),
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
  const hub = useHubWeather()
  // Ask Open-Meteo only once the hub has been asked and has nothing current.
  const fallback = hub.checked && hub.stale

  // The fallback's own state, seeded from its cache so a reload during an
  // outage still shows something.
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
    if (!fallback) return undefined
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
        const snapshot = dailySnapshotFromOpenMeteo(payload)
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
  }, [fallback, location.lat, location.lon, location.timezone])

  // The feed while it is current; past its 90 minutes, whichever of it and
  // the fallback is newer.
  const feed = hub.weather
  const fromFeed =
    !!feed && (!hub.stale || !state.snapshot || (hub.fetchedAt ?? 0) >= (state.fetchedAt ?? 0))
  const snapshot = useMemo(
    () => (fromFeed ? dailySnapshotFromFeed(feed) : state.snapshot),
    [fromFeed, feed, state.snapshot]
  )
  const view = useMemo(() => buildView(snapshot), [snapshot])

  const loading = fromFeed ? false : state.loading
  const error = fromFeed ? (hub.stale ? state.error || hub.error : hub.error) : state.error
  const stale = fromFeed ? hub.stale || !!hub.error : state.stale
  const fetchedAt = fromFeed ? hub.fetchedAt : state.fetchedAt
  const feedOut = fromFeed ? feed : null

  // One stable object per fetch, so a consumer memoising on this hook's output
  // is not invalidated by the layout's 1 Hz tick.
  return useMemo(
    () => ({
      ...view,
      loading,
      error,
      stale,
      fetchedAt,
      feed: feedOut,
    }),
    [view, loading, error, stale, fetchedAt, feedOut]
  )
}
