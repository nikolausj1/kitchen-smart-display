import { useEffect, useSyncExternalStore } from 'react'
import { hubUrl } from '../lib/hub.js'
import { DEVICE_ID, READ_ONLY, deepEqual } from '../lib/settings.js'
import { getHouseState, subscribeHouseState } from '../lib/houseState.js'
import { cleanHaSnapshot, mergeHa, readActionResult } from '../lib/haState.js'

// useHomeAssistant - Home Assistant as a screen sees it, through the hub
// (docs/designs/panels-and-controls.md, chunk 5). Screens never talk to Home
// Assistant; the hub keeps a whitelist of entities and actions
// (frameserver/lib/homeAssistant.mjs) and this store reads it two ways:
//
//   the house state   GET /api/state's `ha` (lib/houseState.js, every 10 s,
//                     on every screen already): each whitelisted entity's
//                     state, friendly name, options, position, lastChanged
//   the snapshot      GET /api/ha/state: the same entities with the
//                     dashboard's label and kind (and a sensor's unit), the
//                     actions, and whether actions are switched on. Fetched
//                     at once and then once a minute while something needs
//                     it (a Home Assistant panel on screen, the layout
//                     editor's live options), immediately after any press,
//                     and every 3 s for 30 s after a press that went through,
//                     so the thing pressed updates fast
//
// lib/haState.js merges them (mergeHa): each entity reads the fresher of the
// two. Snapshot: { status: 'loading' | 'ok' | 'offline' | 'hub', loaded,
// connected, entities: { id: { id, state, label, kind, friendlyName,
// options, position, unit, deviceClass, lastChanged } }, actions: [{ id,
// label, entity, service, confirm: 'tap' | 'hold', needs }], actionsKnown,
// actionsEnabled: true | false | null (unknown until the snapshot answers),
// fetchedAt (ms), error }.
//
// runHaAction(actionId, { screen, data }) posts { actionId, screen, data? }
// to /api/ha/action (screen: this screen's device id) and resolves the hub's
// { ok, status, error }; it never retries, a 429 least of all. The hub is the
// guard (the whitelist, the dashboard's switch, its rate limit); this adds
// one of its own: the layout editor's preview (READ_ONLY, ?edit=1) never
// posts.
//
// Same pattern as hooks/usePlexNow.js: a module store read with
// useSyncExternalStore. ACTIVE subscribers keep the snapshot's minute poll
// running (SpecBoard while a Home Assistant panel is on the board, through
// useHaPolling; the layout editor's bridge); PASSIVE ones only listen
// (useTodayData, which hands the panels their data). With no active
// subscriber nothing is fetched beyond the house state every screen polls
// anyway. Not gated on visibility (the Echo's Silk reports it unreliably); a
// page coming back into view asks again at once.

const POLL_MS = 60 * 1000
const FAST_MS = 3 * 1000
// 10 fast polls: 30 s. Counted, not timed, so a page whose Date is frozen
// (the screenshot harness) still stops.
const FAST_POLLS = 10
const FETCH_TIMEOUT_MS = 8 * 1000
// The hub waits up to 8 s on Home Assistant before it answers.
const ACTION_TIMEOUT_MS = 12 * 1000

let snap = null
let snapAt = null
let snapError = null
let house = null
let houseAt = null
let current = mergeHa(null)
const SERVER_SNAPSHOT = Object.freeze(mergeHa(null))

let activeCount = 0
let pollTimer = null
let fastTimer = null
let fastLeft = 0
let inFlight = false
let again = false
const listeners = new Set()

function now() {
  return Date.now()
}

// The hub cannot be reached: the house state has gone a minute without an
// answer (lib/houseState.js `stale`, set only after a failed poll) and the
// snapshot has nothing fresher to say.
function hubDown(hs) {
  return !!hs && hs.stale === true && hs.error != null && (snap == null || snapError != null)
}

function recompute() {
  const hs = getHouseState()
  const next = mergeHa({
    house,
    houseAt,
    snap,
    snapAt,
    hubDown: hubDown(hs),
    error: snapError,
  })
  if (deepEqual(next, current)) return
  current = next
  listeners.forEach((fn) => fn())
}

// The house state's `ha` keeps its identity while it is unchanged
// (houseState.js keep()), so a new object is a new reading.
function onHouseState() {
  const hs = getHouseState()
  const next = hs ? hs.ha : null
  if (next !== house) {
    house = next
    houseAt = now()
  }
  recompute()
}

async function fetchSnapshot() {
  if (typeof fetch === 'undefined') return
  if (inFlight) {
    again = true
    return
  }
  inFlight = true
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(hubUrl('/api/ha/state'), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const next = cleanHaSnapshot(await res.json())
    if (!next) throw new Error('bad /api/ha/state payload')
    snap = next
    snapAt = now()
    snapError = null
  } catch (err) {
    snapError = err && err.name === 'AbortError' ? 'timed out' : String((err && err.message) || err || 'unreachable')
  } finally {
    if (timer) clearTimeout(timer)
    inFlight = false
  }
  recompute()
  if (again) {
    again = false
    fetchSnapshot()
  }
}

function reconcile() {
  const want = activeCount > 0 && typeof window !== 'undefined'
  if (want && pollTimer == null) {
    fetchSnapshot()
    pollTimer = setInterval(fetchSnapshot, POLL_MS)
  } else if (!want && pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// After a press: the snapshot at once (actions may have been switched off),
// and after one that went through, every FAST_MS for FAST_POLLS polls.
function afterAction(ok) {
  fetchSnapshot()
  if (!ok) return
  fastLeft = FAST_POLLS
  if (fastTimer != null) return
  fastTimer = setInterval(() => {
    fetchSnapshot()
    fastLeft -= 1
    if (fastLeft <= 0) {
      clearInterval(fastTimer)
      fastTimer = null
    }
  }, FAST_MS)
}

// Raw subscription (the layout editor's bridge, useHaPolling): an active one
// keeps the snapshot polled until the returned function is called.
export function subscribeHomeAssistant(fn, { active = false } = {}) {
  listeners.add(fn)
  if (active) activeCount += 1
  reconcile()
  let done = false
  return () => {
    if (done) return
    done = true
    listeners.delete(fn)
    if (active) activeCount -= 1
    reconcile()
  }
}

const subscribeActive = (fn) => subscribeHomeAssistant(fn, { active: true })
const subscribePassive = (fn) => subscribeHomeAssistant(fn, { active: false })
const getSnapshot = () => current
const getServerSnapshot = () => SERVER_SNAPSHOT

// The store's snapshot. active: keep the snapshot polled while mounted.
export function useHomeAssistant(active = false) {
  return useSyncExternalStore(active ? subscribeActive : subscribePassive, getSnapshot, getServerSnapshot)
}

function noop() {}

// Keeps the snapshot polled while `on` (SpecBoard, while a Home Assistant
// panel is on the board), without re-rendering the caller.
export function useHaPolling(on) {
  useEffect(() => {
    if (!on) return undefined
    return subscribeHomeAssistant(noop, { active: true })
  }, [on])
}

export function getHomeAssistant() {
  return current
}

// POST /api/ha/action { actionId, screen, data? } -> { ok, status, error }.
// Never rejects, never retries. screen defaults to this screen's device id;
// data only when given (the day part's { option }).
export async function runHaAction(actionId, opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  if (READ_ONLY) return { ok: false, status: 0, error: 'read-only preview' }
  if (typeof actionId !== 'string' || !actionId) return { ok: false, status: 400, error: 'actionId required' }
  if (typeof fetch === 'undefined') return { ok: false, status: 0, error: 'no fetch' }
  const body = { actionId, screen: typeof o.screen === 'string' && o.screen ? o.screen : DEVICE_ID }
  if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) body.data = o.data
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ACTION_TIMEOUT_MS) : null
  let result
  try {
    const res = await fetch(hubUrl('/api/ha/action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
    const json = await res.json().catch(() => null)
    result = readActionResult(res.status, json)
  } catch (err) {
    result = { ok: false, status: 0, error: err && err.name === 'AbortError' ? 'timed out' : 'hub unreachable' }
  } finally {
    if (timer) clearTimeout(timer)
  }
  afterAction(result.ok)
  return result
}

// Follow the house state from import (it polls from its own import), and ask
// again whenever the page comes back into view.
if (typeof window !== 'undefined') {
  subscribeHouseState(onHouseState)
  onHouseState()
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' && activeCount > 0) fetchSnapshot()
    })
  }
}
