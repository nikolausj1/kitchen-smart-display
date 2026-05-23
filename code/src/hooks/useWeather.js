import { useEffect, useState } from 'react'
import { LOCATION, WEATHER_SLOT_HOURS } from '../config.js'

// Open-Meteo: no API key, no sign-up, no credit card. Returns hourly forecasts
// with WMO weather codes. Docs: https://open-meteo.com/en/docs

// Refresh weather every 15 minutes. The forecast itself updates roughly hourly
// on Open-Meteo's side, so this is plenty fresh.
const REFRESH_MS = 15 * 60 * 1000

// WMO weather code -> icon name. Mapping is the canonical one in
// Smart Displays.md "WMO weather code to icon mapping". Anything not matched
// falls through to "overcast" (the visually neutral cloud-only icon).
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

// Walk the Open-Meteo hourly arrays, find today's entries that match each of
// our five fixed slot hours, and return them in the shape the WeatherPanel
// expects.
function pickSlots(payload) {
  const times = payload?.hourly?.time || []
  const temps = payload?.hourly?.temperature_2m || []
  const codes = payload?.hourly?.weather_code || []
  const today = todayLocalIsoDate()

  return WEATHER_SLOT_HOURS.map((hour) => {
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
  const [state, setState] = useState({
    slots: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const url = new URL('https://api.open-meteo.com/v1/forecast')
      url.searchParams.set('latitude', LOCATION.lat)
      url.searchParams.set('longitude', LOCATION.lon)
      url.searchParams.set('hourly', 'temperature_2m,weather_code')
      url.searchParams.set('temperature_unit', 'fahrenheit')
      url.searchParams.set('timezone', LOCATION.timezone)
      // Two days of forecast so timezone shifts cannot make today's slots
      // fall off the front of the array.
      url.searchParams.set('forecast_days', '2')

      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        setState({ slots: pickSlots(payload), loading: false, error: null })
      } catch (err) {
        if (cancelled) return
        setState({
          slots: null,
          loading: false,
          error: err.message || 'fetch failed',
        })
      }
    }

    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}

// Fallback slots used when the hook is still loading or has errored. Lets the
// layout stay stable while the real data arrives.
export function placeholderSlots() {
  return WEATHER_SLOT_HOURS.map((hour) => ({
    label: hourLabel(hour),
    iconName: 'overcast',
    tempF: null,
  }))
}
