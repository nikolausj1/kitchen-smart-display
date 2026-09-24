import { useSyncExternalStore } from 'react'
import { hubUrl } from './hub.js'
import { dateKey, normalizeDecisions } from './countdown.js'
import { DEVICE_ID, deepEqual } from './settings.js'

// houseState - the house-wide STATE every screen shares through the hub.
//
// Not settings (lib/settings.js): nobody edits these in a form. GET
// hubUrl('/api/state') returns them, composed by FrameServer:
//
//   countdown      the USER DECISIONS behind the morning countdown (dismissed
//                  today, walk/drive override, manual target). Any screen
//                  writes it with postCountdown(); last writer wins.
//   travelDefault  { date, mode, forecast }: walk or drive from the
//                  departure-hour forecast, computed once, on the hub
//   noSchoolToday  from the shared school settings + the hub's school calendar
//   timer          the derived timer the hub publishes for the Apple TV
//
// Screens share decisions, never a derived timer: each one derives the
// countdown itself with frameserver/lib/countdown.mjs (hooks/useTimer.js).
// Until 2026-09-24 every screen ran its own timer state machine and the
// kitchen posted its derived timer to the Pi for the TV, so a second web screen
// would have drifted from the first the moment anyone touched either.
//
// Same pattern as settings.js: a module store read with useSyncExternalStore,
// a localStorage cache so a reload while the hub is down still knows today's
// decisions, and a 10 s poll that picks up the other screens' writes.
//
// Snapshot: { countdown, travelDefault, noSchoolToday, timer, fetchedAt,
// error, stale }. noSchoolToday is null until the hub has said. `stale` is true
// once the last successful fetch is over a minute old (or there has been none).

const CACHE_KEY = 'kitchenHouseState'
const POLL_MS = 10 * 1000
// A poll answered just after a local write can carry the document from before
// it, which would flip the tap straight back until the next poll. Same guard
// as settings.js.
const LOCAL_WRITE_GRACE_MS = 5 * 1000
const STALE_AFTER_MS = 60 * 1000

const STATE_KEYS = ['countdown', 'travelDefault', 'noSchoolToday', 'timer']

function emptyState() {
  return {
    countdown: normalizeDecisions(null),
    travelDefault: null,
    noSchoolToday: null,
    timer: null,
    fetchedAt: null,
    error: null,
    stale: true,
  }
}

// useSyncExternalStore needs the same object on every server-snapshot call.
const SERVER_SNAPSHOT = Object.freeze(emptyState())

function cleanTravelDefault(v) {
  return v && typeof v === 'object' && (v.mode === 'driving' || v.mode === 'walking') ? v : null
}

// Keep the object we already hold when the new one is structurally identical,
// so anything memoised on it (useTimer's inputs) does not churn every poll.
function keep(prev, next) {
  return deepEqual(prev, next) ? prev : next
}

// Apply only the keys a payload actually carries. A POST answered with a bare
// {ok: true}, or a hub that has not learned a field yet, must not wipe what we
// hold.
function stateFrom(payload, base) {
  const next = { ...base }
  if ('countdown' in payload) {
    next.countdown = keep(base.countdown, normalizeDecisions(payload.countdown))
  }
  if ('travelDefault' in payload) {
    next.travelDefault = keep(base.travelDefault, cleanTravelDefault(payload.travelDefault))
  }
  if ('noSchoolToday' in payload) {
    next.noSchoolToday = typeof payload.noSchoolToday === 'boolean' ? payload.noSchoolToday : null
  }
  if ('timer' in payload) {
    const t = payload.timer && typeof payload.timer === 'object' ? payload.timer : null
    next.timer = keep(base.timer, t)
  }
  return next
}

function readCache() {
  const base = emptyState()
  if (typeof localStorage === 'undefined') return base
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return base
    const fetchedAt = typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null
    return {
      ...stateFrom(raw, base),
      fetchedAt,
      stale: fetchedAt == null || Date.now() - fetchedAt > STALE_AFTER_MS,
    }
  } catch {
    return base
  }
}

function writeCache(s) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        countdown: s.countdown,
        travelDefault: s.travelDefault,
        noSchoolToday: s.noSchoolToday,
        timer: s.timer,
        fetchedAt: s.fetchedAt,
      })
    )
  } catch {
    // storage full or disabled: the in-memory store still works
  }
}

let current = readCache()
// The true time of the last successful fetch. The snapshot's fetchedAt can
// trail it (see publish), so `stale` is computed from this.
let lastOkAt = current.fetchedAt
let lastLocalWriteAt = 0
let writeSeq = 0
const listeners = new Set()

function dayOf(ms) {
  return ms == null ? null : dateKey(new Date(ms))
}

function pickState(s) {
  const out = {}
  for (const k of STATE_KEYS) out[k] = s[k]
  return out
}

// Publish only what a consumer could notice. An identical poll is dropped:
// republishing would hand every consumer new identities six times a minute for
// nothing (the slideshow bug documented in settings.js). By design, then, the
// snapshot's fetchedAt is when this data was last confirmed on that DAY, not
// the time of the newest identical poll - the day is what useTimer checks, and
// `stale` is the freshness signal, always current.
function publish(next) {
  const same =
    next.error === current.error &&
    next.stale === current.stale &&
    dayOf(next.fetchedAt) === dayOf(current.fetchedAt) &&
    deepEqual(pickState(next), pickState(current))
  if (same) return
  current = next
  writeCache(current)
  listeners.forEach((fn) => fn())
}

function accept(payload) {
  const now = Date.now()
  lastOkAt = now
  publish({ ...stateFrom(payload, current), fetchedAt: now, error: null, stale: false })
}

function fail(err) {
  publish({
    ...current,
    error: String((err && err.message) || err || 'unreachable'),
    stale: lastOkAt == null || Date.now() - lastOkAt > STALE_AFTER_MS,
  })
}

async function poll() {
  if (typeof fetch === 'undefined') return
  if (Date.now() - lastLocalWriteAt < LOCAL_WRITE_GRACE_MS) return
  const startedAt = Date.now()
  try {
    const res = await fetch(hubUrl('/api/state'), { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    if (!payload || typeof payload !== 'object') throw new Error('bad /api/state payload')
    // A local write landed while this request was in flight. The answer may
    // predate it; the write's own response (or the next poll) wins instead.
    if (lastLocalWriteAt >= startedAt) return
    accept(payload)
  } catch (err) {
    fail(err)
  }
}

// Write the next countdown decisions (built with withCancel / withTravelToggle
// / withManualTime from lib/countdown.js). Applied optimistically, so the tap
// shows at once on this screen; the other screens pick it up on their next
// poll. Resolves true when the hub accepted it. On failure the optimistic value
// stands until a poll succeeds, and the hub's copy then wins, exactly like a
// failed settings PATCH.
export function postCountdown(nextDecisions) {
  const countdown = { ...(nextDecisions || {}), by: DEVICE_ID }
  lastLocalWriteAt = Date.now()
  const seq = ++writeSeq
  publish({ ...current, countdown: keep(current.countdown, normalizeDecisions(countdown)) })
  if (typeof fetch === 'undefined') return Promise.resolve(false)
  return fetch(hubUrl('/api/state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ countdown }),
    cache: 'no-store',
  })
    .then(async (res) => {
      if (!res.ok) return false
      const payload = await res.json().catch(() => null)
      // Two quick taps: the first reply must not land on top of the second
      // tap's optimistic value (a visible flicker back to the first).
      if (seq !== writeSeq) return true
      if (payload && typeof payload === 'object' && STATE_KEYS.some((k) => k in payload)) {
        accept(payload)
      }
      return true
    })
    .catch(() => false)
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return current
}

export function useHouseState() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}

// Synchronous read for code outside render (event handlers building the next
// decisions must start from the LATEST write, not the one their render saw).
export function getHouseState() {
  return current
}

// Poll from import, like settings.js. First fetch right away so a screen that
// boots mid-countdown shows the house timer, not its own guess, within a beat.
if (typeof window !== 'undefined') {
  poll()
  setInterval(poll, POLL_MS)
}
