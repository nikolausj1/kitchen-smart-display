import { useEffect, useState } from 'react'
import { useSettings } from '../lib/settings.js'

// Open-Meteo: no API key, no sign-up. Hourly forecasts with WMO codes.
// Docs: https://open-meteo.com/en/docs

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

function wmoToIcon(code) {
  if (code === 0 || code === 1) return 'clear'
  if (code === 2) return 'partly-cloudy'
  if (code === 3) return 'mostly-cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code === 51) return 'light-drizzle'
  if (code === 53 || code === 55) return 'drizzle'
  if ([56, 57, 66, 67].includes(code)) return 'freezing-rain'
  if ([61, 63, 80, 81].includes(code)) return 'rain'
  if ([65, 82].includes(code)) return 'heavy-rain'
  if ([71, 77].includes(code)) return 'snow'
  if ([73, 75, 85, 86].includes(code)) return 'heavy-snow'
  if ([95, 96, 99].includes(code)) return 'thunderstorm'
  return 'overcast'
}

function hourLabel(hour) {
  if (hour === 0) return '12AM'
  if (hour === 12) return '12PM'
  if (hour < 12) return `${hour}AM`
  return `${hour - 12}PM`
}

function todayLocalIsoDate(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function pickSlots(payload, hours) {
  const times = payload?.hourly?.time || []
  const temps = payload?.hourly?.temperature_2m || []
  const codes = payload?.hourly?.weather_code || []
  const today = todayLocalIsoDate()

  return hours.map((hour) => {
    const stamp = `${today}T${String(hour).padStart(2, '0')}:00`
    const idx = times.indexOf(stamp)
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

export default function useWeather() {
  const { location, weatherSlots } = useSettings()
  // Seed initial state from the cache so a transient Open-Meteo outage
  // doesn't leave us showing --° placeholders. Stale cache (>12h) is
  // ignored - we'd rather show placeholders than yesterday's forecast.
  const [state, setState] = useState(() => {
    const cached = readCache()
    return {
      slots: cached?.slots || null,
      loading: !cached,
      error: null,
      stale: !!cached,  // true when we're showing cached (not fresh) data
    }
  })

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function load() {
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', location.lat)
      url.searchParams.set('longitude', location.lon)
      url.searchParams.set('hourly', 'temperature_2m,weather_code')
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('timezone', location.timezone)
      url.searchParams.set('forecast_days', '2')

      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        const slots = pickSlots(payload, weatherSlots)
        writeCache(slots)
        setState({ slots, loading: false, error: null, stale: false })
        schedule(REFRESH_MS)
      } catch (err) {
        if (cancelled) return
        // Keep showing prior slots (live or cached) - don't blank them.
        setState((prev) => ({
          slots: prev.slots,
          loading: false,
          error: err.message || 'fetch failed',
          stale: !!prev.slots,
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
  }, [location.lat, location.lon, location.timezone, weatherSlots])

  return state
}

export function placeholderSlots(hours = [8, 11, 14, 17, 20]) {
  return hours.map((hour) => ({
    label: hourLabel(hour),
    iconName: 'overcast',
    tempF: null,
  }))
}
