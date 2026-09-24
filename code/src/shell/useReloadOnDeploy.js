// __BUILD_STAMP__ is a Vite define (vite.config.js), declared as a global in
// eslint.config.js; a /* global */ comment here would trip no-redeclare.
import { useEffect } from 'react'
import { SERVED_BY_HUB, hubUrl } from '../lib/hub.js'

// useReloadOnDeploy - picks up a new bundle without anyone touching the screen.
//
// Only for pages FrameServer served itself (SERVED_BY_HUB: the Echo, a laptop
// on the NUC). The kitchen Pi restarts its kiosk as part of deploy.sh, so
// nothing polls there.
//
// Every 5 minutes: GET /build.json from the hub ({ stamp }) and reload when the
// stamp moves. The baseline is this bundle's own compiled __BUILD_STAMP__, so a
// deploy that landed between this page loading and the first poll is caught
// too. Never within the first minute after load, never on a fetch error.
//
// Loop guard: before reloading, the stamp is written to sessionStorage (it
// survives the reload). If the new page then finds /build.json still reporting
// that same stamp while its compiled one differs (the two are written in
// different formats, or a cache handed back the old bundle), it adopts the
// stamp instead of reloading again. So a deploy costs at most one reload.

const POLL_MS = 5 * 60 * 1000
const MIN_UPTIME_MS = 60 * 1000
const RELOADED_FOR_KEY = 'reloadOnDeployFor'
// Module evaluation happens during page load, before the tree mounts.
const LOADED_AT = Date.now()

const COMPILED_STAMP =
  typeof __BUILD_STAMP__ !== 'undefined' && __BUILD_STAMP__ ? String(__BUILD_STAMP__) : null

// undefined = storage unusable (then the guard cannot survive a reload).
function readMarker() {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY)
  } catch {
    return undefined
  }
}

function writeMarker(value) {
  try {
    if (value == null) sessionStorage.removeItem(RELOADED_FOR_KEY)
    else sessionStorage.setItem(RELOADED_FOR_KEY, value)
  } catch {
    // storage disabled
  }
}

export default function useReloadOnDeploy() {
  useEffect(() => {
    if (!SERVED_BY_HUB) return undefined

    let stopped = false
    let interval = null
    const reloadedFor = readMarker()
    // Without storage there is no loop guard, so compare only against stamps
    // this page has seen itself rather than against the compiled one.
    let known = reloadedFor === undefined ? null : COMPILED_STAMP

    async function check() {
      let stamp = null
      try {
        const res = await fetch(hubUrl('/build.json'), { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json()
        if (body && body.stamp != null && body.stamp !== '') stamp = String(body.stamp)
      } catch {
        return // hub unreachable or not JSON: never reload on an error
      }
      if (stopped || stamp == null) return

      if (known == null) {
        known = stamp
        return
      }
      if (stamp === known) {
        if (reloadedFor && stamp === COMPILED_STAMP) writeMarker(null)
        return
      }
      if (stamp === reloadedFor) {
        // Already reloaded once for this deploy and still not carrying it.
        known = stamp
        return
      }
      if (Date.now() - LOADED_AT < MIN_UPTIME_MS) return // the next poll catches it
      writeMarker(stamp)
      window.location.reload()
    }

    const first = setTimeout(() => {
      check()
      interval = setInterval(check, POLL_MS)
    }, Math.max(0, LOADED_AT + MIN_UPTIME_MS - Date.now()))

    return () => {
      stopped = true
      clearTimeout(first)
      if (interval) clearInterval(interval)
    }
  }, [])
}
