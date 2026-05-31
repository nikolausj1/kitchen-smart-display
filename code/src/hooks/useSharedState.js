import { useEffect } from 'react'
import { updateSettings } from '../lib/settings.js'

// useSharedState - on the TV surface, pull the kitchen-synced settings subset
// from the Pi (GET /api/state) on mount and every POLL_MS, and apply it into
// the local settings store so every existing hook picks it up. No-op on the
// kitchen. If the Pi is unreachable it silently keeps whatever is already
// cached in localStorage (which updateSettings persists on each apply).
//
// The kiosk flag is parsed directly here (not via kioskMode.js) to keep this
// hook's imports minimal and side-effect free.

const IS_TV =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('kiosk') === 'tv'

// Must match SHARED_KEYS in settings.js (the writer side).
const SHARED_KEYS = ['location', 'school', 'slideshow']
const POLL_MS = 30 * 1000

export default function useSharedState() {
  useEffect(() => {
    if (!IS_TV) return undefined
    let cancelled = false

    async function pull() {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' })
        if (!res.ok) return
        const remote = await res.json()
        if (cancelled || !remote || typeof remote !== 'object') return
        const patch = {}
        for (const k of SHARED_KEYS) {
          if (remote[k] != null) patch[k] = remote[k]
        }
        if (Object.keys(patch).length > 0) updateSettings(patch)
      } catch {
        // Pi unreachable: keep last-known cached settings.
      }
    }

    pull()
    const id = setInterval(pull, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])
}
