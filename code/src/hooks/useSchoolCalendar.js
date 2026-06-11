import { useEffect, useState } from 'react'

// Fetches the parsed SPS "School Year Dates" calendar from the Pi proxy
// (/api/schoolcal), which returns { noSchoolRanges, firstDays, lastDays }.
// The calendar is static across the year, so we refresh daily and cache a long
// time - a stale copy is far better than none. Returns the payload or null.

const ENDPOINT = '/api/schoolcal'
const REFRESH_MS = 24 * 60 * 60 * 1000
const ERROR_RETRY_MS = 30 * 60 * 1000
const CACHE_KEY = 'kioskSchoolCalCache'
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!parsed?.data || !parsed?.fetchedAt) return null
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(data) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, fetchedAt: Date.now() }))
  } catch {
    // ignore (quota, etc.)
  }
}

// Synchronous read of the last-fetched calendar (for boot logic / watchers that
// run outside React). Returns null if nothing cached yet.
export function getCachedCalendar() {
  return readCache()
}

export default function useSchoolCalendar() {
  const [data, setData] = useState(() => readCache())

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function load() {
      try {
        const res = await fetch(ENDPOINT, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        setData(payload)
        writeCache(payload)
        schedule(REFRESH_MS)
      } catch {
        if (cancelled) return
        schedule(ERROR_RETRY_MS)  // keep prior data (cache) on failure
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
  }, [])

  return data
}
