import { dateKey } from '../lib/countdown.js'

// calendarWindow.js - the pure parts of hooks/useCalendar.js's window: how
// far around today the screen asks the hub for events (GET /api/calendar
// ?days=N&past=P, frameserver/lib/googleCalendar.mjs calendarQuery), and the
// range of local dates an answer covers. No React, no fetch: Node tests it
// (calendarWindow.test.mjs).
//
// A window is { days, past }: `days` from today on (today counted), `past`
// days before today. The store asks for the union of what its panels want,
// never less than the default, which is the agenda's own need (six days from
// today: five columns starting tomorrow), so a screen with only the agenda
// asks exactly what it always has.

export const DEFAULT_WINDOW = Object.freeze({ days: 6, past: 0 })
// The hub's caps (googleCalendar.mjs WINDOW_DAYS, PAST_DAYS).
export const MAX_DAYS = 60
export const MAX_PAST = 31

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function int(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

// A window from anything: days 1..60 (default 6), past 0..31 (default 0).
export function cleanWindow(w) {
  const o = w && typeof w === 'object' ? w : {}
  return {
    days: int(o.days, 1, MAX_DAYS, DEFAULT_WINDOW.days),
    past: int(o.past, 0, MAX_PAST, DEFAULT_WINDOW.past),
  }
}

// The union of the wanted windows and the default: the widest of each.
export function unionWindow(list) {
  let days = DEFAULT_WINDOW.days
  let past = DEFAULT_WINDOW.past
  ;(Array.isArray(list) ? list : []).forEach((w) => {
    const c = cleanWindow(w)
    days = Math.max(days, c.days)
    past = Math.max(past, c.past)
  })
  return { days, past }
}

// Does `a` reach further than `b` either way (so `b`'s events are not
// enough)? A missing `b` never covered anything.
export function wider(a, b) {
  if (!b) return true
  return a.days > b.days || a.past > b.past
}

// The request path: '/api/calendar?days=6', with '&past=P' only when it is
// asked for, so the default request is byte for byte the one the screens
// have always made.
export function calendarPath(w) {
  const c = cleanWindow(w)
  return c.past > 0 ? `/api/calendar?days=${c.days}&past=${c.past}` : `/api/calendar?days=${c.days}`
}

function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + n))
}

// A range from anything: { from, to } date keys, to exclusive and after
// from; else null.
export function cleanRange(r) {
  if (!r || typeof r !== 'object') return null
  const { from, to } = r
  return DATE_KEY_RE.test(from || '') && DATE_KEY_RE.test(to || '') && from < to ? { from, to } : null
}

// The local dates an answer covers, { from, to } (to exclusive): the hub's
// own from / to when it sends them; else (a hub from before the window) its
// `days` from the day the request went out, and its `past`, which such a hub
// never sends, so none. The asked window fills in a missing days.
export function rangeOf(payload, asked, requestedAtMs) {
  const own = cleanRange(payload)
  if (own) return own
  if (!Number.isFinite(requestedAtMs)) return null
  const today = dateKey(new Date(requestedAtMs))
  const w = cleanWindow(asked)
  const days = int(payload && payload.days, 1, MAX_DAYS, w.days)
  const past = int(payload && payload.past, 0, MAX_PAST, 0)
  return { from: addDaysKey(today, -past), to: addDaysKey(today, days) }
}

export function sameRange(a, b) {
  if (a === b) return true
  return !!a && !!b && a.from === b.from && a.to === b.to
}
