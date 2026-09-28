import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import useHubWeather from './useHubWeather.js'
import {
  forecastFromColumns,
  forecastFromHours,
  hourLabel,
  localDateKey,
  openMeteoColumnsOf,
  pickSlots,
  slotsFromHours,
} from './hubWeatherFeed.js'

// useWeather - the hourly weather the Framed Today's slots (views/TodayView,
// the slideshow's time widget) and the departure-hour lookup read.
//
// Source: the hub's one weather feed (hooks/useHubWeather.js), Apple
// WeatherKit or Open-Meteo, whichever the hub serves. The direct Open-Meteo
// fetch this hook always made is kept ONLY as the fallback, while the feed
// has never answered or its data is more than 90 minutes old (a hub on a
// build without /api/weather, or the hub down). Docs:
// https://open-meteo.com/en/docs
//
// Output: { slots, loading, error, stale, hourly, fetchedAt, forecastForHour }
// as always, plus `attribution`: Apple's mark ({ name, url }) while the slots
// are WeatherKit's data, else null (views that draw the slots show it with
// views/TodayLayouts/panels/WeatherAttribution.jsx). An hour H is the feed's
// entry for the hour STARTING at H:00 (hooks/hubWeatherFeed.js, "Hour
// alignment"); the feed's hours run from today's local midnight, so this
// morning's slots are there on a fresh load in the afternoon too.
//
// Each slot is { label, iconName, tempF } as always, plus the hour's `code`,
// `isDay` and `moonPhase` (hubWeatherFeed.js, "Day, night and the moon"), so
// a slot after dark draws its night sky: <WeatherIcon name={slot.iconName}
// isDay={slot.isDay} moonPhase={slot.moonPhase} />. The fallback asks
// Open-Meteo for is_day too and works the moon out itself. A placeholder, or
// a slot cached before these fields, has none and draws by day.

const REFRESH_MS = 15 * 60 * 1000
const ERROR_RETRY_MS = 2 * 60 * 1000  // shorter retry when the API is down
const CACHE_KEY = 'kioskWeatherCache'
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000  // 12 hours - older than this isn't useful

function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.slots || !parsed?.fetchedAt) return null
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(slots) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ slots, fetchedAt: Date.now() })
    )
  } catch {
    // ignore (quota, etc.)
  }
}

const NO_HOURS = Object.freeze([])

function todayLocalIsoDate(now = new Date()) {
  return localDateKey(now)
}

export default function useWeather() {
  const { location, weatherSlots } = useSettings()
  const hub = useHubWeather()
  // Ask Open-Meteo only once the hub has been asked and has nothing current.
  const fallback = hub.checked && hub.stale

  // The fallback's own state, seeded from its cache so a transient outage
  // doesn't leave us showing --° placeholders. Stale cache (>12h) is ignored -
  // we'd rather show placeholders than yesterday's forecast.
  const [state, setState] = useState(() => {
    const cached = readCache()
    return {
      slots: cached?.slots || null,
      loading: !cached,
      error: null,
      stale: !!cached,  // true when we're showing cached (not fresh) data
      // Today's raw hourly arrays from the live payload, for arbitrary-hour
      // lookups (e.g. the departure-time forecast that drives the travel
      // default). Null until a live fetch succeeds (not cached).
      hourly: null,
      // ms epoch of the fetch behind the current slots (cache or live), so a
      // view can show the data's age instead of silently showing stale slots.
      fetchedAt: cached?.fetchedAt || null,
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
      url.searchParams.set('hourly', 'temperature_2m,weather_code,is_day')
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('timezone', location.timezone)
      url.searchParams.set('forecast_days', '2')

      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        const slots = pickSlots(payload, weatherSlots, todayLocalIsoDate())
        writeCache(slots)
        setState({
          slots,
          loading: false,
          error: null,
          stale: false,
          hourly: payload?.hourly || null,
          fetchedAt: Date.now(),
        })
        schedule(REFRESH_MS)
      } catch (err) {
        if (cancelled) return
        // Keep showing prior slots (live or cached) - don't blank them.
        setState((prev) => ({
          slots: prev.slots,
          loading: false,
          error: err.message || 'fetch failed',
          stale: !!prev.slots,
          hourly: prev.hourly,
          fetchedAt: prev.fetchedAt,
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
  }, [fallback, location.lat, location.lon, location.timezone, weatherSlots])

  // The feed's view: today's slots from the feed's hours (from local
  // midnight). A feed past its 90 minutes still beats nothing: it is shown
  // until the fallback has something newer.
  const feed = hub.weather
  const hours = feed ? feed.hourly : NO_HOURS
  const day = hub.day
  const fromFeed =
    hours.length > 0 && (!hub.stale || !state.slots || (hub.fetchedAt ?? 0) >= (state.fetchedAt ?? 0))
  const feedView = useMemo(
    () =>
      fromFeed
        ? {
            slots: slotsFromHours(hours, weatherSlots, day, feed),
            hourly: openMeteoColumnsOf(hours),
          }
        : null,
    [fromFeed, hours, weatherSlots, day, feed]
  )

  if (feedView) {
    // Look up today's forecast for a specific local hour (0-23): { code,
    // tempF } or null. Used by the travel-mode default to read the
    // departure-time forecast.
    const forecastForHour = (hour) => forecastFromHours(hours, day, hour)
    return {
      slots: feedView.slots,
      loading: false,
      error: hub.stale ? state.error || hub.error : hub.error,
      stale: hub.stale || !!hub.error,
      hourly: feedView.hourly,
      fetchedAt: hub.fetchedAt,
      forecastForHour,
      attribution: feed.source === 'weatherkit' ? feed.attribution : null,
    }
  }

  // The fallback's view (its live data, else its cache, else placeholders):
  // Open-Meteo's, which needs no mark.
  const forecastForHour = (hour) => forecastFromColumns(state.hourly, day, hour)
  return { ...state, forecastForHour, attribution: null }
}

export function placeholderSlots(hours = [8, 11, 14, 17, 20]) {
  return hours.map((hour) => ({
    label: hourLabel(hour),
    iconName: 'overcast',
    tempF: null,
  }))
}
