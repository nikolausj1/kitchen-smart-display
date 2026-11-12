// sonosWatchdog.mjs - restarts node-sonos-http-api when writes to one player
// keep timing out while reads still work.
//
// On 2026-10-23 the Family Room Playbar took a new DHCP address. The API
// (nssm service SmartDisplaySonosAPI on this NUC) learns addresses once, at
// discovery, so for six days every command to that player went to the old
// address and hung 21 s (78,417 `connect ETIMEDOUT 192.168.4.67:1400` lines
// in its log) while /zones stayed correct, because the group coordinator
// carries the member's state. The proxy's 6 s timeout turned each write into
// a 502, the Sound card kept sending volume steps, and nothing on any screen
// said why. A `Restart-Service SmartDisplaySonosAPI` fixed it at once.
//
// What this does, fed by the /api/sonos proxy:
//   noteTimeout(rest)   an upstream timeout on a request. Write paths count
//                       against their room over a sliding window; read paths
//                       (an outage, not a stale player) are ignored.
//   noteOk(rest)        an upstream answer. A read marks the API alive; a
//                       write clears its room's timeouts (a player that
//                       answers sometimes is slow, not stale).
//   status()            the /healthz slice the dashboard paints.
// When one room reaches `threshold` write timeouts inside `windowMs`, a read
// has succeeded in the last `readFreshMs` (so the API itself is up: during a
// real outage a restart fixes nothing) and the last restart is more than
// `cooldownMs` ago, `restart()` runs once and every count is cleared. The
// default restart is Restart-Service through PowerShell (below); tests pass
// their own.
//
// Paths are what the proxy forwards, percent-encoded, query included:
// /zones, /Main/state, /Family%20Room/volume/20, /getaa?s=1&u=... A write is
// /<room>/<action>[/...] where the action is not state or favorites; any
// one-segment path is a read.

import { execFile } from 'node:child_process'

export const SONOS_SERVICE_NAME = 'SmartDisplaySonosAPI'
export const DEFAULT_THRESHOLD = 5
export const DEFAULT_WINDOW_MS = 10 * 60_000
export const DEFAULT_COOLDOWN_MS = 30 * 60_000
export const DEFAULT_READ_FRESH_MS = 60_000
const RESTART_CMD_TIMEOUT_MS = 90_000

const READ_ACTIONS = new Set(['state', 'favorites'])

// { room, action } for a write path, null for a read.
export function classifyPath(rest) {
  const path = String(rest || '').split('?')[0]
  const segs = path.split('/').filter(Boolean)
  if (segs.length < 2) return null
  const action = decodeSeg(segs[1]).toLowerCase()
  if (READ_ACTIONS.has(action)) return null
  return { room: decodeSeg(segs[0]), action }
}

function decodeSeg(s) {
  try { return decodeURIComponent(s) } catch { return s }
}

// Restart-Service through PowerShell. The hub runs on the same NUC as the
// API, as Local System or as Justin's account (a local administrator) for
// the Music Videos share; both may restart services. Resolves on exit 0,
// rejects with the command's last output otherwise, and never runs off
// Windows (a dev hub on the Mac points SONOS_UPSTREAM elsewhere anyway).
export function restartSonosService({ serviceName = SONOS_SERVICE_NAME, platform = process.platform } = {}) {
  return new Promise((resolve, reject) => {
    if (platform !== 'win32') return reject(new Error(`not on Windows (${platform}); nothing restarted`))
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `Restart-Service -Name '${serviceName}' -ErrorAction Stop; (Get-Service -Name '${serviceName}').Status`],
      { windowsHide: true, timeout: RESTART_CMD_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || stdout || err.message || '').trim().split(/\r?\n/).slice(-3).join(' ')
          return reject(new Error(tail || `Restart-Service exited ${err.code}`))
        }
        resolve(String(stdout || '').trim())
      },
    )
  })
}

export function createSonosWatchdog({
  restart = restartSonosService,
  now = Date.now,
  log = (m) => console.log(m),
  threshold = DEFAULT_THRESHOLD,
  windowMs = DEFAULT_WINDOW_MS,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  readFreshMs = DEFAULT_READ_FRESH_MS,
} = {}) {
  const timeouts = new Map()   // room -> [ms, ...] inside the window, oldest first
  let lastReadOkAt = 0
  let lastRestart = null       // { at, room, timeouts, ok, error, result }
  let restarts = 0
  let skipped = []             // why the last trigger-worthy room did not restart
  let inFlight = null

  function prune(room, t) {
    const list = timeouts.get(room)
    if (!list) return []
    while (list.length && t - list[0] >= windowMs) list.shift()
    if (!list.length) timeouts.delete(room)
    return list
  }

  function counts(t) {
    const out = {}
    for (const room of [...timeouts.keys()]) {
      const n = prune(room, t).length
      if (n) out[room] = n
    }
    return out
  }

  function noteOk(rest) {
    const t = now()
    const w = classifyPath(rest)
    if (!w) { lastReadOkAt = t; return }
    timeouts.delete(w.room)
  }

  // Returns the restart promise when one was started, else null.
  function noteTimeout(rest) {
    const w = classifyPath(rest)
    if (!w) return null
    const t = now()
    const list = prune(w.room, t)
    list.push(t)
    timeouts.set(w.room, list)
    if (list.length < threshold) return null
    return consider(w.room, list.length, t)
  }

  function consider(room, n, t) {
    const reasons = []
    if (inFlight) reasons.push('a restart is already running')
    if (!lastReadOkAt || t - lastReadOkAt > readFreshMs) reasons.push('reads are failing too (an outage, not a stale player)')
    if (lastRestart && t - lastRestart.at < cooldownMs) {
      reasons.push(`last restart ${Math.round((t - lastRestart.at) / 60_000)} min ago, cooldown ${cooldownMs / 60_000} min`)
    }
    if (reasons.length) {
      const why = reasons.join('; ')
      if (!skipped.length || skipped[0] !== why) {
        log(`[sonos] watchdog: ${n} write timeouts to "${room}" in ${windowMs / 60_000} min, not restarting: ${why}`)
      }
      skipped = [why]
      return null
    }
    skipped = []
    log(`[sonos] watchdog: ${n} write timeouts to "${room}" in ${windowMs / 60_000} min while reads succeed; restarting ${SONOS_SERVICE_NAME}`)
    const entry = { at: t, room, timeouts: n, ok: null, error: null, result: null }
    lastRestart = entry
    restarts += 1
    timeouts.clear()
    inFlight = Promise.resolve()
      .then(() => restart())
      .then((result) => {
        entry.ok = true
        entry.result = result == null ? null : String(result)
        log(`[sonos] watchdog: ${SONOS_SERVICE_NAME} restarted${entry.result ? ` (${entry.result})` : ''}`)
      }, (e) => {
        entry.ok = false
        entry.error = String((e && e.message) || e)
        log(`[sonos] watchdog: restart of ${SONOS_SERVICE_NAME} failed: ${entry.error}`)
      })
      .finally(() => { inFlight = null })
    return inFlight
  }

  function status() {
    const t = now()
    return {
      service: SONOS_SERVICE_NAME,
      threshold,
      windowMs,
      cooldownMs,
      timeouts: counts(t),
      lastReadOkAt: lastReadOkAt ? new Date(lastReadOkAt).toISOString() : null,
      restarts,
      restarting: !!inFlight,
      lastRestart: lastRestart
        ? { ...lastRestart, at: new Date(lastRestart.at).toISOString() }
        : null,
      holding: skipped[0] || null,
    }
  }

  return { noteOk, noteTimeout, status, classifyPath }
}
