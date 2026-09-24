import { dateKey } from '../../../lib/schoolDay.js'
import { fmtDayLong } from './format.js'

// Agenda and countdown helpers for the Entry board. Pure functions of their
// arguments (no clock reads), so useTodayData can memoise them on the events
// and the day, and the React Compiler purity rule stays happy.
//
// Event shape is the hub's (GET /api/calendar, docs/designs/entry-board.md):
//   all-day  allDay: true, startDate / endDate 'YYYY-MM-DD' with endDate
//            EXCLUSIVE (Google's convention), start / end null
//   timed    allDay: false, start / end ISO strings, startDate = the local
//            date of start
// Same covering rule as frameserver/lib/headline.mjs, so the headline and the
// agenda can never disagree about which day an event is on.

export const AGENDA_DAYS = 3

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const FUNC_COLOR_RE = /^(rgb|hsl)a?\([\d\s.,%/+-]+\)$/i

export function keyToDate(key) {
  const [y, m, d] = String(key).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// 'YYYY-MM-DD' + n days, by local calendar arithmetic (DST safe).
export function addDaysKey(key, n) {
  const [y, m, d] = String(key).split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + n))
}

// Whole days from one local date key to another. Rounded, so a 23 or 25 hour
// DST day still counts as one.
export function daysBetweenKeys(fromKey, toKey) {
  return Math.round((keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / 86_400_000)
}

function parseDate(v) {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// An all-day event covers `key` when startDate <= key < endDate. A missing or
// non-advancing endDate means the one day.
export function allDayCovers(ev, key) {
  if (!ev || ev.allDay !== true || !DATE_KEY_RE.test(ev.startDate || '')) return false
  const end =
    DATE_KEY_RE.test(ev.endDate || '') && ev.endDate > ev.startDate
      ? ev.endDate
      : addDaysKey(ev.startDate, 1)
  return ev.startDate <= key && key < end
}

// A calendar colour the page can safely paint: #rgb, #rrggbb, rgb()/hsl().
export function cleanColor(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return HEX_RE.test(s) || FUNC_COLOR_RE.test(s) ? s : null
}

// rgba() tint of a hex colour, for the all-day band behind a row. null for
// anything that is not hex (the row then falls back to the neutral surface).
export function tintOf(color, alpha) {
  if (typeof color !== 'string' || !HEX_RE.test(color)) return null
  let h = color.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function cleanTitle(v) {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return t || '(No title)'
}

// One row of a day column: plain data plus Dates, nothing to parse in render.
function toItem(ev, key, index, start, end) {
  const color = cleanColor(ev.color)
  const id = ev.id == null ? `i${index}` : String(ev.id)
  return {
    key: `${id}@${key}`,
    id,
    title: cleanTitle(ev.title),
    allDay: ev.allDay === true,
    start,
    end,
    color,
    tint: tintOf(color, 0.22),
    calendarLabel: typeof ev.calendarLabel === 'string' ? ev.calendarLabel : null,
  }
}

function byAllDayThenStart(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  const as = a.start ? a.start.getTime() : 0
  const bs = b.start ? b.start.getTime() : 0
  return as - bs
}

// buildAgendaDays(events, today) -> [{ dateKey, date, label, events }] for
// today and the next two days. label is 'Today', 'Tomorrow', then the weekday
// name. An all-day event lands on every day it covers; a timed event on its
// startDate (the local date of its start when startDate is missing). Within a
// day: all-day first, then by start. The hub's order breaks ties.
export function buildAgendaDays(events, today, count = AGENDA_DAYS) {
  const list = Array.isArray(events) ? events : []
  const firstKey = dateKey(today)
  const out = []
  for (let i = 0; i < count; i++) {
    const key = addDaysKey(firstKey, i)
    const items = []
    list.forEach((ev, index) => {
      if (!ev || typeof ev !== 'object' || ev.status === 'cancelled') return
      if (ev.allDay === true) {
        if (allDayCovers(ev, key)) items.push(toItem(ev, key, index, null, null))
        return
      }
      const start = parseDate(ev.start)
      if (!start) return
      const dayKey = DATE_KEY_RE.test(ev.startDate || '') ? ev.startDate : dateKey(start)
      if (dayKey === key) items.push(toItem(ev, key, index, start, parseDate(ev.end)))
    })
    items.sort(byAllDayThenStart)
    const date = keyToDate(key)
    out.push({
      dateKey: key,
      date,
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDayLong(date),
      events: items,
    })
  }
  return out
}

// Countdowns with daysLeft recounted against `today` from each one's `date`,
// so the tile turns over at midnight rather than at the hub's next fetch.
// Anything already past is dropped; the hub's order and cap are kept.
export function countdownsFor(countdowns, today) {
  const todayKey = dateKey(today)
  const out = []
  for (const c of Array.isArray(countdowns) ? countdowns : []) {
    if (!c || typeof c !== 'object') continue
    const left = DATE_KEY_RE.test(c.date || '')
      ? daysBetweenKeys(todayKey, c.date)
      : Number.isFinite(c.daysLeft)
        ? c.daysLeft
        : null
    if (left == null || left < 0) continue
    out.push(left === c.daysLeft ? c : { ...c, daysLeft: left })
  }
  return out
}
