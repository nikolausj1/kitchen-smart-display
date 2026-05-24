import { useEffect, useState } from 'react'
import { useSettings } from '../lib/settings.js'

// Open-Meteo: no API key, no sign-up. Hourly forecasts with WMO codes.
// Docs: https://open-meteo.com/en/docs

const REFRESH_MS = 15 * 60 * 1000

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
  const [state, setState] = useState({
    slots: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

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
        setState({
          slots: pickSlots(payload, weatherSlots),
          loading: false,
          error: null,
        })
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
