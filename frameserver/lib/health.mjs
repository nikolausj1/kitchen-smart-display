// health.mjs - the screens' own health reports (the heartbeat) and the power
// events they raise.
//
// On 2026-09-22 the kitchen Pi hung unattended and nothing on any screen said
// why. It runs off an outlet's USB-A port, which cannot deliver the 27 W a
// Pi 5 wants; `vcgencmd get_throttled` read 0x50000 (undervoltage and
// throttling since boot). pi/kiosk-server.py now POSTs a report every minute
// and the dashboard's Screen card shows it, so a power problem reads as one
// instead of as a software fault.
//
//   POST /api/devices/<id>/health    one report, JSON, at most 1 KB -> 204
//   GET  /api/devices/<id>/health    healthFor(id)
//   GET  /api/health/events?limit=N  the newest N power events (default 50)
//
// A report. Every field but the URL's id is optional; unknown fields are
// dropped, so a newer Pi never breaks an older hub:
//   { id, at, uptimeS, throttled: { raw: '0x50000', underVoltageNow, ...,
//     softTempLimitOccurred } | null, tempC, load1, memFreeMb, diskFreeGb,
//     kernel, model, build, underVoltageDips, lastDipAgoS }
// The eight flags are re-derived here from `raw`, the register itself, so the
// stored flags can never disagree with it.
//
// The latest report per screen lives in memory only, like lastSeenAt: it
// refills within a minute of a restart. Power events go to health-events.json
// (the newest 200):
//   { id, at, kind: 'undervoltage'|'throttled'|'temp'|'freq', now, raw,
//     tempC, uptimeS }
// `at` is this hub's clock, not the Pi's. An event is written the first time
// in a boot that a flag is seen set: each "occurred since boot" flag (on the
// kitchen that is the inrush at power-on), and underVoltageNow / throttledNow
// when a sample catches one. A flag that stays set writes nothing more until
// the next boot, so it is one event per boot, not one a minute. A new boot is
// an uptime that went down, or a boot time (receive time minus uptime) that
// moved on; after a hub restart, the events already on file for the same
// boot keep it from writing them twice (deploys restart the hub often).

import { join } from 'node:path'
import { isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const STALE_AFTER_S = 180
export const MAX_EVENTS = 200
export const MAX_REPORT_BYTES = 1024
const DAY_MS = 24 * 3600 * 1000
// An events-only device (no report since this hub started) still counts in
// healthSummary() while its last event is this recent.
const SUMMARY_EVENT_MS = 7 * DAY_MS
// How far one boot's boot time may wander between two reports: the request's
// own latency, plus 100 ppm of clock drift across the time between them. Two
// real boots are always further apart: a Pi takes longer than this to come up
// and send its first report.
const BOOT_JITTER_MS = 20_000
const DRIFT = 1e-4

// get_throttled's four conditions: [event kind, now flag, occurred flag, bit].
// The occurred flag is the same bit + 16.
const CONDITIONS = [
  ['undervoltage', 'underVoltageNow', 'underVoltageOccurred', 0],
  ['freq', 'armFreqCappedNow', 'armFreqCappedOccurred', 1],
  ['throttled', 'throttledNow', 'throttledOccurred', 2],
  ['temp', 'softTempLimitNow', 'softTempLimitOccurred', 3],
]
const KINDS = new Set(CONDITIONS.map(([kind]) => kind))
// The "now" flags that raise an event of their own when a sample catches one.
// The other two are covered by their "occurred" flag.
const NOW_EVENT_KINDS = new Set(['undervoltage', 'throttled'])

// '0x50000' -> { raw, underVoltageNow, ..., softTempLimitOccurred }, or null.
export function decodeThrottled(raw) {
  if (typeof raw !== 'string' || !/^0x[0-9a-f]{1,8}$/i.test(raw)) return null
  const v = Number.parseInt(raw.slice(2), 16)
  const out = { raw: `0x${v.toString(16)}` }
  for (const [, nowKey, , bit] of CONDITIONS) out[nowKey] = ((v >>> bit) & 1) === 1
  for (const [, , occKey, bit] of CONDITIONS) out[occKey] = ((v >>> (bit + 16)) & 1) === 1
  return out
}

const absent = (v) => v === undefined || v === null
const numberIn = (min, max, int = false) => (v) =>
  absent(v) || (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)))
const stringUpTo = (max) => (v) => absent(v) || (typeof v === 'string' && v.length <= max)

// [field, check, what a valid value is]
const FIELDS = [
  ['at', (v) => absent(v) || (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))), 'an ISO date'],
  ['uptimeS', numberIn(0, 1e9), 'a number of seconds'],
  ['tempC', numberIn(-100, 200), 'a number between -100 and 200'],
  ['load1', numberIn(0, 1e4), 'a number of at least 0'],
  ['memFreeMb', numberIn(0, 1e8), 'a number of at least 0'],
  ['diskFreeGb', numberIn(0, 1e7), 'a number of at least 0'],
  ['kernel', stringUpTo(120), 'a string of at most 120 characters'],
  ['model', stringUpTo(120), 'a string of at most 120 characters'],
  ['build', stringUpTo(120), 'a string of at most 120 characters'],
  ['underVoltageDips', numberIn(0, 1e9, true), 'a whole number of at least 0'],
  ['lastDipAgoS', numberIn(0, 1e10), 'a number of seconds'],
]

// A report as received -> { report } or { status, error }.
export function parseReport(id, body) {
  if (!isDict(body)) return { status: 400, error: 'expected a JSON object' }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_REPORT_BYTES) {
    return { status: 413, error: `a report is at most ${MAX_REPORT_BYTES} bytes` }
  }
  if (!absent(body.id) && body.id !== id) return { status: 400, error: `id does not match the URL (${id})` }
  const values = {}
  for (const [key, ok, what] of FIELDS) {
    if (!ok(body[key])) return { status: 400, error: `${key} must be ${what}` }
    values[key] = absent(body[key]) ? null : body[key]
  }
  let throttled = null
  if (!absent(body.throttled)) {
    const t = body.throttled
    throttled = isDict(t) ? decodeThrottled(t.raw) : null
    if (!throttled) return { status: 400, error: 'throttled.raw must be the register in hex, like 0x50000' }
    for (const [, nowKey, occKey] of CONDITIONS) {
      for (const k of [nowKey, occKey]) {
        if (!absent(t[k]) && typeof t[k] !== 'boolean') return { status: 400, error: `throttled.${k} must be true or false` }
      }
    }
  }
  // The Pi's own key order.
  const { at, uptimeS, ...rest } = values
  return { report: { id, at, uptimeS, throttled, ...rest } }
}

function validEvent(e) {
  return isDict(e) && typeof e.id === 'string' && KINDS.has(e.kind) &&
    typeof e.at === 'string' && Number.isFinite(Date.parse(e.at))
}

// file: where the events live (default <dir>/health-events.json).
export function createHealth({ dir, file = join(dir, 'health-events.json'), staleAfterS = STALE_AFTER_S } = {}) {
  const startedAt = new Date()
  const latest = new Map() // id -> { report, receivedAt: ms }
  // id -> { bootAt: ms | null, uptimeS, at: ms, seen: Set of '<kind>:occurred' | '<kind>:now' }
  const boots = new Map()
  const stored = readJsonFile(file, [])
  let events = (Array.isArray(stored) ? stored : []).filter(validEvent).slice(-MAX_EVENTS)

  const save = () => {
    try {
      writeJsonFileAtomic(file, events)
    } catch (e) {
      // Kept in memory: the next event that does get written carries it along.
      console.warn(`[health] could not write ${file}: ${e.message}`)
    }
  }

  // After a restart: what the events on file already say about this boot.
  function seenOnFile(id, bootAt, t) {
    const seen = new Set()
    if (bootAt == null) return seen
    for (const e of events) {
      if (e.id !== id || typeof e.uptimeS !== 'number') continue
      const at = Date.parse(e.at)
      if (Math.abs(at - e.uptimeS * 1000 - bootAt) > BOOT_JITTER_MS + Math.abs(t - at) * DRIFT) continue
      seen.add(`${e.kind}:occurred`)
      if (e.now) seen.add(`${e.kind}:now`)
    }
    return seen
  }

  // The boot this report belongs to, as tracked for the device.
  function bootFor(id, report, t) {
    const bootAt = report.uptimeS == null ? null : t - report.uptimeS * 1000
    const prev = boots.get(id)
    let boot
    if (!prev) {
      boot = { bootAt, uptimeS: report.uptimeS, at: t, seen: seenOnFile(id, bootAt, t) }
    } else if (bootAt != null && prev.bootAt != null &&
               (report.uptimeS < prev.uptimeS ||
                bootAt - prev.bootAt > BOOT_JITTER_MS + (t - prev.at) * DRIFT)) {
      boot = { bootAt, uptimeS: report.uptimeS, at: t, seen: new Set() }
    } else {
      // Same boot. Follow its boot time report by report, so drift never adds up.
      boot = prev
      if (bootAt != null) Object.assign(boot, { bootAt, uptimeS: report.uptimeS, at: t })
    }
    boots.set(id, boot)
    return boot
  }

  function recordHealth(id, body, now = new Date()) {
    const parsed = parseReport(id, body)
    if (parsed.error) return { ok: false, status: parsed.status, error: parsed.error }
    const { report } = parsed
    const t = now.getTime()
    latest.set(id, { report, receivedAt: t })
    const boot = bootFor(id, report, t)

    const added = []
    const flags = report.throttled
    if (flags) {
      for (const [kind, nowKey, occKey] of CONDITIONS) {
        const isNow = flags[nowKey]
        const firstOccurred = (flags[occKey] || isNow) && !boot.seen.has(`${kind}:occurred`)
        const firstNow = isNow && NOW_EVENT_KINDS.has(kind) && !boot.seen.has(`${kind}:now`)
        if (!firstOccurred && !firstNow) continue
        boot.seen.add(`${kind}:occurred`)
        if (isNow) boot.seen.add(`${kind}:now`)
        added.push({
          id, at: new Date(t).toISOString(), kind, now: isNow,
          raw: flags.raw, tempC: report.tempC, uptimeS: report.uptimeS,
        })
      }
    }
    if (added.length) {
      events = events.concat(added).slice(-MAX_EVENTS)
      save()
    }
    return { ok: true, status: 204, events: added }
  }

  // { latest, receivedAt, ageS, stale, staleAfterS, events24h, lastEvent,
  //   hubStartedAt }, or null for a device that has never reported (and has
  // no events on file). latest is null after a hub restart until the first
  // report: stale, counted from hubStartedAt.
  function healthFor(id, now = new Date()) {
    const t = now.getTime()
    const entry = latest.get(id)
    const mine = events.filter((e) => e.id === id)
    if (!entry && !mine.length) return null
    const ageS = entry ? Math.max(0, Math.round((t - entry.receivedAt) / 1000)) : null
    return {
      latest: entry ? entry.report : null,
      receivedAt: entry ? new Date(entry.receivedAt).toISOString() : null,
      ageS,
      stale: ageS == null || ageS > staleAfterS,
      staleAfterS,
      events24h: mine.filter((e) => t - Date.parse(e.at) <= DAY_MS).length,
      lastEvent: mine.length ? mine[mine.length - 1] : null,
      hubStartedAt: startedAt.toISOString(),
    }
  }

  // Every device that has reported since this hub started, plus any with an
  // event in the last week: { <id>: healthFor(id) }.
  function healthSummary(now = new Date()) {
    const t = now.getTime()
    const ids = new Set(latest.keys())
    for (const e of events) if (t - Date.parse(e.at) <= SUMMARY_EVENT_MS) ids.add(e.id)
    return Object.fromEntries([...ids].sort().map((id) => [id, healthFor(id, now)]))
  }

  // For /healthz: { devices: n, stale: [ids] }.
  function brief(now = new Date()) {
    const all = healthSummary(now)
    const ids = Object.keys(all)
    return { devices: ids.length, stale: ids.filter((id) => all[id].stale) }
  }

  // The newest `limit` events (1..200, default 50), newest first.
  function recentEvents(limit) {
    const n = Number.parseInt(limit ?? '', 10)
    const k = Number.isFinite(n) ? Math.min(MAX_EVENTS, Math.max(1, n)) : 50
    return events.slice(-k).reverse()
  }

  return { recordHealth, healthFor, healthSummary, brief, events: recentEvents }
}
