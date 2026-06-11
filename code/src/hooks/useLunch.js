import { useEffect, useState } from 'react'
import { useSettings } from '../lib/settings.js'

// Fetches the school lunch menu from the Pi proxy (/api/lunch?school=<slug>),
// which returns { days: { 'YYYY-MM-DD': { entrees, grabAndGo, items } } }.
// Refreshes daily; cached so a transient outage still shows today's menu.
// Returns the payload or null. No-op (null) when lunch is disabled in settings.

const REFRESH_MS = 24 * 60 * 60 * 1000
const ERROR_RETRY_MS = 30 * 60 * 1000
const CACHE_KEY = 'kioskLunchCache'
const CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000  // 3 days

function readCache(slug) {
  if (typeof localStorage === 'undefined') return null
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!parsed?.data || !parsed?.fetchedAt || parsed.slug !== slug) return null
    if (Date.now() - parsed.fetchedAt > CACHE_MAX_AGE_MS) return null
    return parsed.data
  } catch {
    return null
  }
}

function writeCache(slug, data) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ slug, data, fetchedAt: Date.now() }))
  } catch {
    // ignore (quota, etc.)
  }
}

export default function useLunch() {
  const { school } = useSettings()
  const enabled = school?.lunch?.enabled !== false
  const slug = school?.lunch?.schoolSlug || 'Lawton'
  const [data, setData] = useState(() => (enabled ? readCache(slug) : null))

  useEffect(() => {
    if (!enabled) {
      setData(null)
      return
    }
    let cancelled = false
    let timer = null

    async function load() {
      try {
        const res = await fetch(`/api/lunch?school=${encodeURIComponent(slug)}`, {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        setData(payload)
        writeCache(slug, payload)
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
  }, [enabled, slug])

  return data
}
