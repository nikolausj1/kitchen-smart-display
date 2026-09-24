import { useSyncExternalStore } from 'react'
import { hubUrl } from '../lib/hub.js'
import { deepEqual } from '../lib/settings.js'

// useCalendar - the family calendar and its countdowns, from the hub.
//
// FrameServer reads Google Calendar through a service account and serves the
// result normalized (docs/designs/entry-board.md, "GET /api/calendar"):
//
//   GET hubUrl('/api/calendar?days=3') ->
//   { connected, error, fetchedAt, days,
//     calendars:  [{ id, label, color }],
//     events:     [{ id, calendarId, calendarLabel, color, title, description,
//                    location, allDay, start, end, startDate, endDate, status }],
//     countdowns: [{ id, title, date, daysLeft, leadDays, image, emoji,
//                    calendarLabel, color }] }
//
// Same pattern as lib/houseState.js: a module store read with
// useSyncExternalStore, a localStorage cache so a reload while the hub is down
// still shows the week, identical polls dropped so consumers keep their object
// identities. Unlike houseState it polls only while something is subscribed
// (a Today layout on screen): the kitchen on its Framed Today never asks.
//
// Snapshot: { events, countdowns, calendars, connected, fetchedAt, error, stale }
//   events      as the hub sent them, minus anything unusable (no date, a
//               cancelled instance). Sorted by the hub; useTodayData buckets
//               them into days (views/TodayLayouts/lib/agenda.js).
//   countdowns  as the hub sent them (already filtered, sorted and capped).
//   connected   the hub's own flag: its key file is present and its last
//               Google fetch succeeded. null until the hub has answered once.
//   fetchedAt   ms of the HUB's last successful Google fetch, i.e. the age of
//               the events themselves. null when the hub has not said.
//   error       this screen's fetch error (hub unreachable, or a 404 from a hub
//               that predates the route), else the hub's own error string.
//   stale       no successful poll of the hub for five minutes (or none yet).

const CACHE_KEY = 'kitchenCalendarCache'
const POLL_MS = 60 * 1000
const STALE_AFTER_MS = 5 * 60 * 1000
// A cache older than this is not worth showing, even offline.
const CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000
// A hung request must not hold the in-flight latch forever.
const FETCH_TIMEOUT_MS = 15 * 1000
// Collapses StrictMode's double subscribe and a burst of visibility changes.
const MIN_POLL_GAP_MS = 5 * 1000
const DAYS = 3

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function emptyState() {
  return {
    events: [],
    countdowns: [],
    calendars: [],
    connected: null,
    fetchedAt: null,
    error: null,
    stale: true,
  }
}

// useSyncExternalStore needs the same object on every server-snapshot call.
const SERVER_SNAPSHOT = Object.freeze(emptyState())

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

// An event the agenda can place: an all-day one needs its startDate, a timed
// one a parseable start. Kept as the hub sent it otherwise, so a field the hub
// adds later reaches the panels without a change here.
function cleanEvent(e) {
  if (!isObj(e) || e.status === 'cancelled') return null
  if (e.allDay === true) return DATE_KEY_RE.test(e.startDate || '') ? e : null
  return parseMs(e.start) != null ? e : null
}

function cleanCountdown(c) {
  return isObj(c) && DATE_KEY_RE.test(c.date || '') ? c : null
}

function cleanCalendar(c) {
  return isObj(c) && str(c.id) ? c : null
}

function listOf(v, clean) {
  return Array.isArray(v) ? v.map(clean).filter(Boolean) : []
}

function dataFrom(payload) {
  return {
    events: listOf(payload.events, cleanEvent),
    countdowns: listOf(payload.countdowns, cleanCountdown),
    calendars: listOf(payload.calendars, cleanCalendar),
    connected: typeof payload.connected === 'boolean' ? payload.connected : null,
    fetchedAt: parseMs(payload.fetchedAt),
  }
}

function readCache() {
  const base = emptyState()
  if (typeof localStorage === 'undefined') return { state: base, polledAt: null }
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!isObj(raw)) return { state: base, polledAt: null }
    const polledAt = typeof raw.polledAt === 'number' ? raw.polledAt : null
    if (polledAt == null || Date.now() - polledAt > CACHE_MAX_AGE_MS) {
      return { state: base, polledAt: null }
    }
    return {
      state: {
        ...base,
        ...dataFrom(raw),
        stale: Date.now() - polledAt > STALE_AFTER_MS,
      },
      polledAt,
    }
  } catch {
    return { state: base, polledAt: null }
  }
}

function writeCache(s, polledAt) {
  if (typeof localStorage === 'undefined' || polledAt == null) return
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        events: s.events,
        countdowns: s.countdowns,
        calendars: s.calendars,
        connected: s.connected,
        fetchedAt: s.fetchedAt,
        polledAt,
      })
    )
  } catch {
    // storage full or disabled: the in-memory store still works
  }
}

const cached = readCache()
let current = cached.state
// Time of the last successful poll of the hub; drives `stale`.
let lastOkAt = cached.polledAt
let inFlight = false
let lastPollStartedAt = 0
let intervalId = null
const listeners = new Set()

// Keep the array we already hold when the new one is structurally identical,
// so the agenda memo in useTodayData does not rebuild every poll.
function keep(prev, next) {
  return deepEqual(prev, next) ? prev : next
}

// Publish only what a consumer could notice. An identical poll is dropped.
function publish(next) {
  const merged = {
    ...next,
    events: keep(current.events, next.events),
    countdowns: keep(current.countdowns, next.countdowns),
    calendars: keep(current.calendars, next.calendars),
  }
  const same =
    merged.events === current.events &&
    merged.countdowns === current.countdowns &&
    merged.calendars === current.calendars &&
    merged.connected === current.connected &&
    merged.fetchedAt === current.fetchedAt &&
    merged.error === current.error &&
    merged.stale === current.stale
  if (same) return
  current = merged
  writeCache(current, lastOkAt)
  listeners.forEach((fn) => fn())
}

function accept(payload) {
  lastOkAt = Date.now()
  publish({ ...dataFrom(payload), error: str(payload.error), stale: false })
}

function fail(err) {
  const message =
    err && err.name === 'AbortError'
      ? 'timed out'
      : String((err && err.message) || err || 'unreachable')
  publish({
    ...current,
    error: message,
    stale: lastOkAt == null || Date.now() - lastOkAt > STALE_AFTER_MS,
  })
}

async function poll() {
  if (typeof fetch === 'undefined' || inFlight) return
  const startedAt = Date.now()
  if (startedAt - lastPollStartedAt < MIN_POLL_GAP_MS) return
  lastPollStartedAt = startedAt
  inFlight = true
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(hubUrl(`/api/calendar?days=${DAYS}`), {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    if (!isObj(payload)) throw new Error('bad /api/calendar payload')
    accept(payload)
  } catch (err) {
    fail(err)
  } finally {
    if (timeout) clearTimeout(timeout)
    inFlight = false
  }
}

function start() {
  if (intervalId != null || typeof window === 'undefined') return
  poll()
  intervalId = setInterval(poll, POLL_MS)
}

function stop() {
  if (intervalId == null) return
  clearInterval(intervalId)
  intervalId = null
}

function subscribe(fn) {
  listeners.add(fn)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) stop()
  }
}

function getSnapshot() {
  return current
}

// A screen that wakes (the Echo coming back from its night face, a laptop lid)
// asks at once instead of waiting out the interval.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listeners.size > 0) poll()
  })
}

export default function useCalendar() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}

// Synchronous read for code outside render.
export function getCalendar() {
  return current
}
