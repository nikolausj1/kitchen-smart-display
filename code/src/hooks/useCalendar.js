import { useLayoutEffect, useSyncExternalStore } from 'react'
import { hubUrl } from '../lib/hub.js'
import { deepEqual } from '../lib/settings.js'
import { DEFAULT_WINDOW, calendarPath, cleanRange, cleanWindow, rangeOf, sameRange, unionWindow, wider } from './calendarWindow.js'

// useCalendar - the family calendar and its countdowns, from the hub.
//
// FrameServer reads Google Calendar through a service account and serves the
// result normalized (docs/designs/entry-board.md, "GET /api/calendar"):
//
//   GET hubUrl('/api/calendar?days=6') ->
//   { connected, error, fetchedAt, days, past, from, to,
//     calendars:  [{ id, label, color }],
//     events:     [{ id, calendarId, calendarLabel, color, title, description,
//                    location, allDay, start, end, startDate, endDate, status,
//                    alsoOn }],
//     countdowns: [{ id, title, date, daysLeft, leadDays, image, emoji,
//                    calendarLabel, color, tileColor }] }
//
// The window (docs/designs/panels-and-controls.md, chunk 3): six days from
// today and none back is the default and the agenda's own need, so a screen
// that shows only the agenda asks exactly what it always has. A calendar view
// that draws more (a week from Monday, a month grid) says so with
// wantCalendarWindow({ days, past }) (or the useCalendarWindow hook), which
// returns its release: the store asks for the union of everything wanted
// (hooks/calendarWindow.js), up to the hub's 60 days ahead and 31 back, and
// asks again at once when the union grows. A narrower union waits for the
// next poll.
//
// A countdown's color is its calendar's; tileColor is the `color:` marker in
// its description ('#rrggbb' or null), which the art-above tiles draw
// (views/TodayLayouts/lib/tileColor.js).
//
// Same pattern as lib/houseState.js: a module store read with
// useSyncExternalStore, a localStorage cache so a reload while the hub is down
// still shows the week, identical polls dropped so consumers keep their object
// identities. Unlike houseState it polls only while something is subscribed
// (a Today layout on screen): the kitchen on its Framed Today never asks.
//
// Snapshot: { events, countdowns, calendars, connected, fetchedAt, error,
// stale, range }
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
//   range       { from, to } ('YYYY-MM-DD', to exclusive): the local dates
//               the events cover, as the hub answered; null before an answer.
//               A day outside it is unknown, not free (a hub from before the
//               window serves 14 days at most and nothing back).

const CACHE_KEY = 'kitchenCalendarCache'
const POLL_MS = 60 * 1000
const STALE_AFTER_MS = 5 * 60 * 1000
// A cache older than this is not worth showing, even offline.
const CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000
// A hung request must not hold the in-flight latch forever.
const FETCH_TIMEOUT_MS = 15 * 1000
// Collapses StrictMode's double subscribe and a burst of visibility changes.
const MIN_POLL_GAP_MS = 5 * 1000

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
    range: null,
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
        range: cleanRange(raw.range),
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
        range: s.range,
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
// The windows the calendar views want (wantCalendarWindow), by token; a poll
// asks for their union. `rerun`: the union grew while a poll was out.
const wants = new Map()
let nextWant = 1
let rerun = false

function wantedWindow() {
  return unionWindow(Array.from(wants.values()))
}

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
    merged.stale === current.stale &&
    sameRange(merged.range, current.range)
  if (same) return
  if (sameRange(merged.range, current.range)) merged.range = current.range
  current = merged
  writeCache(current, lastOkAt)
  listeners.forEach((fn) => fn())
}

function accept(payload, asked, requestedAt) {
  lastOkAt = Date.now()
  publish({
    ...dataFrom(payload),
    error: str(payload.error),
    stale: false,
    range: rangeOf(payload, asked, requestedAt),
  })
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

// force: a wider window was just wanted, so the minimum gap between polls
// does not apply.
async function poll(force = false) {
  if (typeof fetch === 'undefined') return
  if (inFlight) {
    if (force) rerun = true
    return
  }
  const startedAt = Date.now()
  if (!force && startedAt - lastPollStartedAt < MIN_POLL_GAP_MS) return
  lastPollStartedAt = startedAt
  inFlight = true
  const asked = wantedWindow()
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(hubUrl(calendarPath(asked)), {
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    if (!isObj(payload)) throw new Error('bad /api/calendar payload')
    accept(payload, asked, startedAt)
  } catch (err) {
    fail(err)
  } finally {
    if (timeout) clearTimeout(timeout)
    inFlight = false
    // A view wanted more while this one was out: ask again now, for all of it.
    if (rerun) {
      rerun = false
      if (listeners.size > 0 && wider(wantedWindow(), asked)) poll(true)
    }
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

// wantCalendarWindow({ days, past }) -> release(): a calendar view needs the
// events from `past` days before today to `days` from today on (today
// counted; days 1..60, past 0..31). Until released, every poll asks the hub
// for at least that; a want that widens what is asked polls again at once
// (when the store is running; else its first poll asks for it). Releasing
// twice is harmless.
export function wantCalendarWindow(window) {
  const token = nextWant++
  const before = wantedWindow()
  wants.set(token, cleanWindow(window))
  if (listeners.size > 0 && wider(wantedWindow(), before)) poll(true)
  let released = false
  return () => {
    if (released) return
    released = true
    wants.delete(token)
  }
}

// The hook form, for a layout: need = { days, past } or null (the default
// window, nothing to want). Re-wants only when the numbers change. A layout
// effect, so on a page's first render the want is in before the store's own
// subscription (a passive effect) starts polling, and the first request asks
// for all of it.
export function useCalendarWindow(need) {
  const days = need && need.days > 0 ? need.days : 0
  const past = need && need.past > 0 ? need.past : 0
  useLayoutEffect(() => {
    if (!days && !past) return undefined
    return wantCalendarWindow({ days: days || DEFAULT_WINDOW.days, past })
  }, [days, past])
}
