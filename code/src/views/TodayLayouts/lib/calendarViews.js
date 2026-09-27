import { dateKey } from '../../../lib/schoolDay.js'
import { addDaysKey, allDayCovers, cleanColor, daysBetweenKeys, keyToDate, tintOf } from './agenda.js'

// calendarViews.js - the calendar views' pure parts (docs/designs/panels-and-
// controls.md, chunk 3): Up next, Day list, Week grid, Month grid, and the
// options they share with the agenda. No React, no DOM, no clock reads: every
// function takes `now` or a date key, so the panels stay pure and Node can
// test it (calendarViews.test.mjs).
//
// Events are the hub's (GET /api/calendar, docs/designs/entry-board.md):
//   all-day  allDay: true, startDate / endDate 'YYYY-MM-DD', endDate EXCLUSIVE
//   timed    allDay: false, start / end ISO, startDate the local date of start
//   alsoOn   [{ calendarId, calendarLabel, color }]: the other calendars the
//            hub found the same event on (an invitation), dropped as copies
// The covering rule is lib/agenda.js's (and the hub's headline's): an all-day
// event is on every day from startDate up to endDate; a timed one, in a list,
// on the day it starts. The grids draw a timed event of 24 hours or more
// like an all-day one ("long"), across every day it touches.
//
// Runtime rule (layoutSpec.js): Chrome 80 on the Echo. No Array.prototype.at,
// Object.hasOwn, structuredClone or String replaceAll.

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MIN_MS = 60 * 1000
const HOUR_MS = 60 * MIN_MS
const DAY_MS = 24 * HOUR_MS

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The hub's caps on GET /api/calendar (frameserver/lib/googleCalendar.mjs
// WINDOW_DAYS, PAST_DAYS): what any view can ask for.
export const HUB_MAX_DAYS = 60
export const HUB_MAX_PAST = 31

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function parseDate(v) {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return validDate(d) ? d : null
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

// Local midnight of a date key, in ms.
function midnightMs(key) {
  return keyToDate(key).getTime()
}

// --- Words ------------------------------------------------------------------------

// 'Today', 'Tomorrow', 'Yesterday', the weekday for the rest of the coming
// week ('Saturday'), else 'Sat, Oct 10'.
export function dayWord(key, todayKey) {
  if (!DATE_KEY_RE.test(String(key)) || !DATE_KEY_RE.test(String(todayKey))) return ''
  const n = daysBetweenKeys(todayKey, key)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  const d = keyToDate(key)
  if (n > 1 && n < 7) return DAY_LONG[d.getDay()]
  return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

// A short day for inside a line: 'Mon' within the coming week, else 'Oct 12'.
export function shortDay(key, todayKey) {
  if (!DATE_KEY_RE.test(String(key))) return ''
  const d = keyToDate(key)
  const n = DATE_KEY_RE.test(String(todayKey)) ? daysBetweenKeys(todayKey, key) : 99
  return n >= 0 && n < 7 ? DAY_SHORT[d.getDay()] : `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

// 'Saturday, September 26'
export function longDate(key) {
  if (!DATE_KEY_RE.test(String(key))) return ''
  const d = keyToDate(key)
  return `${DAY_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}`
}

// --- Time formats -------------------------------------------------------------------
//
// timeFormat is a knob: 'auto' | '12h' | '24h'. Auto is the screen's own
// setting when it has one (screenHour24: true or false), else 12-hour; no
// screen carries one yet, so auto reads 12-hour today.

export function hour24Of(timeFormat, screenHour24 = null) {
  if (timeFormat === '24h') return true
  if (timeFormat === '12h') return false
  return screenHour24 === true
}

// { hm: '9:05', ampm: 'am' } (12-hour, no leading zero) or { hm: '09:05',
// ampm: '' } (24-hour, as the agenda has always drawn it).
export function clockParts(date, h24) {
  if (!validDate(date)) return { hm: '--:--', ampm: '' }
  const h = date.getHours()
  if (h24) return { hm: `${pad2(h)}:${pad2(date.getMinutes())}`, ampm: '' }
  return { hm: `${h % 12 || 12}:${pad2(date.getMinutes())}`, ampm: h < 12 ? 'am' : 'pm' }
}

// '9:05 am' | '09:05'
export function clockText(date, h24) {
  const { hm, ampm } = clockParts(date, h24)
  return ampm ? `${hm} ${ampm}` : hm
}

// A grid's short time: '9 am' on the hour, '9:30 am' off it; '09:00' in 24.
export function shortClock(date, h24) {
  if (!validDate(date)) return ''
  if (h24) return clockText(date, true)
  const h = date.getHours()
  const m = date.getMinutes()
  return `${h % 12 || 12}${m ? `:${pad2(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

// The month grid's time before a title: '5pm', '5:30pm'; '17:00' in 24.
export function tinyClock(date, h24) {
  if (!validDate(date)) return ''
  if (h24) return clockText(date, true)
  const h = date.getHours()
  const m = date.getMinutes()
  return `${h % 12 || 12}${m ? `:${pad2(m)}` : ''}${h < 12 ? 'am' : 'pm'}`
}

// '9:00 – 10:30 am', '11:30 am – 1:00 pm', '09:00 – 10:30'; an end on a
// later day names it ('10:00 pm – Sat 1:00 am'), except an end at exactly
// the next midnight, which is still that evening. No end (or none after the
// start): the start alone.
export function rangeText(start, end, h24) {
  if (!validDate(start)) return ''
  if (!validDate(end) || end.getTime() <= start.getTime()) return clockText(start, h24)
  const sameDay = dateKey(start) === dateKey(end)
  const nextMidnight = !sameDay && end.getHours() === 0 && end.getMinutes() === 0 &&
    end.getTime() - start.getTime() < DAY_MS && dateKey(new Date(end.getTime() - 1)) === dateKey(start)
  const a = clockParts(start, h24)
  const b = clockParts(end, h24)
  const endText = b.ampm ? `${b.hm} ${b.ampm}` : b.hm
  if (!sameDay && !nextMidnight) {
    return `${clockText(start, h24)} – ${DAY_SHORT[end.getDay()]} ${endText}`
  }
  if (!h24 && a.ampm === b.ampm) return `${a.hm} – ${endText}`
  return `${clockText(start, h24)} – ${endText}`
}

// The hour lines' labels: '7 AM', '12 PM'; '07' in 24-hour.
export function hourLabel(hour, h24) {
  const h = ((Math.round(hour) % 24) + 24) % 24
  if (h24) return pad2(h)
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

// --- Places and descriptions ----------------------------------------------------------

const STATE_RE = /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/
const ZIP_RE = /^\d{5}(-\d{4})?$/
const COUNTRY_RE = /^(usa|us|united states( of america)?)$/i

// The place in a location, for a line under an event: the part before the
// street address, without the state, zip and country. "McGilvra Elementary,
// 1617 38th Ave E, Seattle, WA 98112" -> "McGilvra Elementary"; "Bayview
// Playfield, North Field B, Seattle, WA" -> "Bayview Playfield, North Field
// B, Seattle"; a bare address keeps its street ("1617 38th Ave E"); one part
// is itself. null for none.
export function placeOf(location) {
  const loc = str(location)
  if (!loc) return null
  const parts = loc.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length <= 1) return parts[0] || null
  if (/^\d/.test(parts[0])) return parts[0]
  const kept = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (i > 0 && /^\d/.test(p)) break // the street address: the city and the rest follow it
    if (i > 0 && (STATE_RE.test(p) || ZIP_RE.test(p) || COUNTRY_RE.test(p))) continue
    kept.push(p)
  }
  return kept.join(', ') || parts[0]
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&#(\d{1,7});/g, (m, n) => {
      try {
        return String.fromCodePoint(Number(n))
      } catch {
        return m
      }
    })
    .replace(/&amp;/gi, '&')
}

// A countdown marker's own line (frameserver/lib/countdowns.mjs): not text
// anyone wrote for people to read.
const MARKER_LINE_RE = /^(countdown(\s*[:=]?\s*\d.*)?|(label|image|colou?r)\s*[:=].*)$/i
const DESCRIPTION_MAX = 200

// The first line of a description as Google Calendar displays it (its HTML
// read as text), skipping countdown marker lines; null for none. At most 200
// characters (the panels clamp it to their own lines).
export function descriptionLine(description) {
  if (typeof description !== 'string' || !description) return null
  const text = decodeEntities(
    description
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote)(?:\s[^>]*)?>/gi, '\n')
      .replace(/<\/?[a-z][^>]*>/gi, '')
  )
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+/g, ' ').trim()
    if (!line || MARKER_LINE_RE.test(line)) continue
    return line.length > DESCRIPTION_MAX ? `${line.slice(0, DESCRIPTION_MAX - 1).trim()}…` : line
  }
  return null
}

// --- Events as the views draw them -------------------------------------------------------

function cleanTitle(v) {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : ''
  return t || '(No title)'
}

// A timed event's exclusive end date: the day after the last local date it
// touches (the hub's rule, googleCalendar.mjs timedEndDate).
function timedEndDate(start, end) {
  const last = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start
  return addDaysKey(dateKey(last), 1)
}

function calendarOf(ev) {
  return {
    id: str(ev.calendarId),
    label: typeof ev.calendarLabel === 'string' ? ev.calendarLabel : null,
    color: cleanColor(ev.color),
  }
}

function consolidationKey(v) {
  const t = v.title.toLowerCase()
  if (v.allDay) return `${t}|d|${v.startDate}|${v.endDate}`
  const s = v.start ? v.start.getTime() : 0
  const e = v.end ? v.end.getTime() : s
  return `${t}|t|${s}|${e}`
}

function hasCalendar(list, id) {
  return list.some((c) => c.id === id)
}

// A calendar list plus the hub's alsoOn (the other calendars an invitation
// was on), without repeats.
function foldAlsoOn(calendars, alsoOn) {
  if (!Array.isArray(alsoOn) || !alsoOn.length) return calendars
  const out = calendars.slice()
  alsoOn.forEach((c) => {
    const cid = isObj(c) ? str(c.calendarId) : null
    if (cid && !hasCalendar(out, cid)) {
      out.push({ id: cid, label: typeof c.calendarLabel === 'string' ? c.calendarLabel : null, color: cleanColor(c.color) })
    }
  })
  return out
}

// consolidate: the same event on two calendars once. Items carry { title,
// allDay, start, end, startDate, endDate, calendars, alsoOn, location,
// description }; the first copy is kept (a new object when it gains a
// calendar) with every calendar of the copies after it, in order, and the
// first location and description any of them has. Only copies from
// calendars not already in it merge: two identical entries on one calendar
// stay two.
export function mergeShared(items) {
  const out = []
  const byKey = new Map()
  ;(Array.isArray(items) ? items : []).forEach((item) => {
    const cals = foldAlsoOn(item.calendars, item.alsoOn)
    const v = cals === item.calendars ? item : { ...item, calendars: cals }
    const ck = consolidationKey(v)
    const at = byKey.get(ck)
    const ownId = v.calendars.length ? v.calendars[0].id : null
    if (at != null && ownId && !hasCalendar(out[at].calendars, ownId)) {
      const kept = out[at]
      out[at] = {
        ...kept,
        calendars: kept.calendars.concat(v.calendars.filter((c) => !c.id || !hasCalendar(kept.calendars, c.id))),
        location: kept.location || v.location,
        place: kept.place || v.place,
        description: kept.description || v.description,
      }
      return
    }
    if (at == null) byKey.set(ck, out.length)
    out.push(v)
  })
  return out
}

function withColors(v, colorBy) {
  const colors = colorBy === 'none' ? [] : v.calendars.map((c) => c.color).filter(Boolean)
  const color = colors.length ? colors[0] : null
  return { ...v, colors, color, tint: tintOf(color, 0.22), tints: colors.map((c) => tintOf(c, 0.22)).filter(Boolean) }
}

// viewEvents(events, { consolidate, colorBy }) -> the events the views draw,
// in the hub's order (start, all-day first on a tie):
//   { key, id, title, allDay, start, end (Dates; null all day), startDate,
//     endDate (exclusive), long (timed, 24 hours or more), calendars: [{ id,
//     label, color }], colors (their colours; [] for colorBy 'none'), color
//     (the first or null), tint / tints (the all-day washes), location,
//     place (placeOf), description (descriptionLine) }
// consolidate: one entry for the same event on two calendars (mergeShared),
// its calendars (and so its colours) all of theirs: the same title (any
// case), all day on the same dates or timed with the same start and end;
// and the hub's alsoOn (an invitation it listed once). Off, every event is
// its own, as the hub sent it.
export function viewEvents(events, options = {}) {
  const consolidate = options.consolidate === true
  const colorBy = options.colorBy === 'none' ? 'none' : 'calendar'
  const list = Array.isArray(events) ? events : []
  const parsed = []
  const seenKeys = new Set()
  list.forEach((ev, index) => {
    if (!isObj(ev) || ev.status === 'cancelled') return
    const allDay = ev.allDay === true
    let start = null
    let end = null
    let startDate
    let endDate
    if (allDay) {
      if (!DATE_KEY_RE.test(ev.startDate || '')) return
      startDate = ev.startDate
      endDate = DATE_KEY_RE.test(ev.endDate || '') && ev.endDate > ev.startDate ? ev.endDate : addDaysKey(ev.startDate, 1)
    } else {
      start = parseDate(ev.start)
      if (!start) return
      const e = parseDate(ev.end)
      end = e && e.getTime() >= start.getTime() ? e : start
      startDate = DATE_KEY_RE.test(ev.startDate || '') ? ev.startDate : dateKey(start)
      endDate = DATE_KEY_RE.test(ev.endDate || '') && ev.endDate > startDate ? ev.endDate : timedEndDate(start, end)
    }
    const id = ev.id == null ? `i${index}` : String(ev.id)
    let key = `${id}@${allDay ? startDate : start.getTime()}`
    if (seenKeys.has(key)) key = `${key}#${index}`
    seenKeys.add(key)
    parsed.push({
      key,
      id,
      title: cleanTitle(ev.title),
      allDay,
      start,
      end,
      startDate,
      endDate,
      long: !allDay && end.getTime() - start.getTime() >= DAY_MS,
      calendars: [calendarOf(ev)],
      alsoOn: consolidate && Array.isArray(ev.alsoOn) ? ev.alsoOn : null,
      location: str(ev.location),
      place: placeOf(ev.location),
      description: descriptionLine(ev.description),
    })
  })
  return (consolidate ? mergeShared(parsed) : parsed).map((v) => withColors(v, colorBy))
}

// The agenda's rows for its options (panels/AgendaPanel.jsx): lib/agenda.js
// items, each given its calendars and colours (consolidated with
// `consolidate`, neutral with colorBy 'none'), its place and its
// description's first line. The items come back as they are, the very same
// objects, when no option is on, which is how the agenda at its defaults
// draws exactly what it always has.
export function agendaItems(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const consolidate = options.consolidate === true
  const colorBy = options.colorBy === 'none' ? 'none' : 'calendar'
  if (!consolidate && colorBy === 'calendar' && !options.withPlace && !options.withDescription) return list
  const base = list.map((it) => ({
    ...it,
    calendars: [{ id: it.calendarId || null, label: it.calendarLabel || null, color: it.color || null }],
    alsoOn: consolidate ? it.alsoOn : null,
    place: options.withPlace ? placeOf(it.location) : null,
    description: options.withDescription ? descriptionLine(it.description) : it.description,
  }))
  return (consolidate ? mergeShared(base) : base).map((v) => withColors(v, colorBy))
}

// The calendars that fill a legend, in the hub's order (the registry's):
// [{ id, label, color }] with a paintable colour. Without a list from the
// hub, the calendars the events name.
export function legendOf(calendars, events) {
  const out = []
  const seen = new Set()
  const add = (id, label, color) => {
    const c = cleanColor(color)
    const key = id || label
    if (!c || !key || seen.has(key)) return
    seen.add(key)
    out.push({ id: id || key, label: label || id, color: c })
  }
  if (Array.isArray(calendars) && calendars.length) {
    calendars.forEach((c) => {
      if (isObj(c)) add(str(c.id), str(c.label), c.color)
    })
    return out
  }
  ;(Array.isArray(events) ? events : []).forEach((e) => {
    if (isObj(e)) add(str(e.calendarId), str(e.calendarLabel), e.color)
  })
  return out
}

// --- What an event is, now ----------------------------------------------------------

// Over: a timed event whose end has passed; an all-day one once its last day
// is behind today.
export function isOver(v, now) {
  if (!v || !validDate(now)) return false
  if (v.allDay) return v.endDate <= dateKey(now)
  return (v.end || v.start).getTime() <= now.getTime()
}

export function isRunning(v, now) {
  if (!v || !validDate(now)) return false
  if (v.allDay) return allDayCovers(v, dateKey(now))
  return v.start.getTime() <= now.getTime() && v.end.getTime() > now.getTime()
}

// A list's event on `key`: all day (and long timed ones) on every day they
// cover, other timed ones on the day they start.
export function onDay(v, key) {
  if (v.allDay || v.long) return v.startDate <= key && key < v.endDate
  return v.startDate === key
}

function byAllDayThenStart(a, b) {
  const aa = a.allDay || a.long
  const bb = b.allDay || b.long
  if (aa !== bb) return aa ? -1 : 1
  const as = a.start ? a.start.getTime() : midnightMs(a.startDate)
  const bs = b.start ? b.start.getTime() : midnightMs(b.startDate)
  return as - bs
}

// The events of one day, all day first, then by start; with futureOnly, a
// timed event already over is left out (an all-day one stays its whole day).
export function eventsOnDay(list, key, now, futureOnly = false) {
  return (Array.isArray(list) ? list : [])
    .filter((v) => onDay(v, key) && !(futureOnly && !v.allDay && isOver(v, now)))
    .sort(byAllDayThenStart)
}

// Up to `max` rows. When there are more, rows already over give up their
// places first (earliest first), as in the agenda: at 7 pm the evening
// matters more than the morning. more counts the rows left out.
export function visibleRows(rows, now, max) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length <= max) return { shown: list, more: 0 }
  let toDrop = list.length - max
  const kept = []
  list.forEach((v) => {
    if (toDrop > 0 && !v.allDay && isOver(v, now)) {
      toDrop -= 1
      return
    }
    kept.push(v)
  })
  const shown = kept.slice(0, max)
  return { shown, more: list.length - shown.length }
}

// --- The words on an event -------------------------------------------------------------

// All day, and across days: 'All day', or 'All day through Mon' (the last
// day, 'Oct 12' past the coming week).
export function allDayText(v, todayKey) {
  if (!v) return ''
  const last = addDaysKey(v.endDate, -1)
  if (last <= v.startDate) return 'All day'
  return `All day through ${shortDay(last, todayKey)}`
}

// When a running event ends: 'until 6:15 pm' today (an end at the next
// midnight is still tonight), else 'until Tue 6:00 pm'.
export function untilEnd(v, now, h24) {
  if (!v || !v.end || !validDate(now)) return ''
  const todayKey = dateKey(now)
  const tonight = dateKey(new Date(v.end.getTime() - 1)) === todayKey
  return tonight ? `until ${clockText(v.end, h24)}` : `until ${shortDay(dateKey(v.end), todayKey)} ${clockText(v.end, h24)}`
}

// The time line of an event: all day as above; running, until when (untilEnd);
// else its start, or start and end with showEnd.
export function timeText(v, now, h24, showEnd = false) {
  if (!v) return ''
  if (v.allDay) return allDayText(v, validDate(now) ? dateKey(now) : null)
  if (validDate(now) && isRunning(v, now)) return untilEnd(v, now, h24)
  return showEnd ? rangeText(v.start, v.end, h24) : clockText(v.start, h24)
}

// How long until it starts, for the next event: 'Now' while it runs; 'in 40
// min' and 'in 2 hr 5 min' today; else its day ('Tomorrow', 'Saturday',
// 'Sat, Oct 10'), the time being on the line beside it. All day: 'Today'
// while it covers today, else its first day.
export function untilText(v, now) {
  if (!v || !validDate(now)) return ''
  const todayKey = dateKey(now)
  if (v.allDay) return allDayCovers(v, todayKey) ? 'Today' : dayWord(v.startDate, todayKey)
  if (isRunning(v, now)) return 'Now'
  const startKey = dateKey(v.start)
  if (startKey !== todayKey) return dayWord(startKey, todayKey)
  const mins = Math.max(1, Math.ceil((v.start.getTime() - now.getTime()) / MIN_MS))
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `in ${h} hr ${m} min` : `in ${h} hr`
}

// --- Up next ------------------------------------------------------------------------

// upNext(list, now, { hoursAhead, count }) -> { next, rows, more }: what is
// coming in the next hoursAhead hours (12..72). The next is the first timed
// event that has not ended (one running now included), a long one (a day or
// more: a trip) only when there is nothing else; with none, the first
// all-day event (today's included). The rows are the `count` events after
// it, in order of start (an all-day event at its day's midnight), so an
// all-day event already under way today is not "after" a timed next; more
// counts the rest of the window.
export function upNext(list, now, options = {}) {
  if (!validDate(now)) return { next: null, rows: [], more: 0 }
  const hours = clampInt(options.hoursAhead, 12, 72, 48)
  const count = clampInt(options.count, 0, 6, 3)
  const nowMs = now.getTime()
  const endMs = nowMs + hours * HOUR_MS
  const keyOf = (v) => (v.allDay ? midnightMs(v.startDate) : v.start.getTime())
  const candidates = (Array.isArray(list) ? list : [])
    .filter((v) => {
      if (v.allDay) return midnightMs(v.startDate) < endMs && midnightMs(v.endDate) > nowMs
      return v.end.getTime() > nowMs && v.start.getTime() < endMs
    })
    .sort((a, b) => keyOf(a) - keyOf(b) || (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1))
  if (!candidates.length) return { next: null, rows: [], more: 0 }
  let i = candidates.findIndex((v) => !v.allDay && !v.long)
  if (i < 0) i = candidates.findIndex((v) => !v.allDay)
  if (i < 0) i = 0
  const next = candidates[i]
  const after = candidates.slice(i + 1)
  return { next, rows: after.slice(0, count), more: Math.max(0, after.length - count) }
}

// --- Week grid ----------------------------------------------------------------------

// The first column: today, or the Monday or Sunday on or before it.
export function weekStartKey(todayKey, startDay) {
  if (!DATE_KEY_RE.test(String(todayKey))) return null
  if (startDay !== 'monday' && startDay !== 'sunday') return todayKey
  const dow = keyToDate(todayKey).getDay()
  const back = startDay === 'monday' ? (dow + 6) % 7 : dow
  return addDaysKey(todayKey, -back)
}

// Lanes for overlapping spans [top, bottom): clusters of spans that overlap
// one another, each span in the first lane free at its top. A cluster that
// needs more than maxLanes keeps maxLanes - 1 lanes of spans and gives the
// last lane to a "+n" for the rest. Returns { items: [{ ...span, lane, lanes
// }], more: [{ top, bottom, lane, lanes, count }] }. Spans are sorted by top,
// longer first on a tie.
export function laneLayout(spans, maxLanes = 3) {
  const list = (Array.isArray(spans) ? spans : [])
    .slice()
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  const items = []
  const more = []
  let cluster = []
  let clusterBottom = -Infinity
  const flush = () => {
    if (!cluster.length) return
    const laneEnds = []
    const placed = cluster.map((s) => {
      let lane = laneEnds.findIndex((b) => b <= s.top)
      if (lane < 0) {
        lane = laneEnds.length
        laneEnds.push(s.bottom)
      } else {
        laneEnds[lane] = s.bottom
      }
      return { s, lane }
    })
    const lanes = laneEnds.length
    if (lanes <= maxLanes) {
      placed.forEach(({ s, lane }) => items.push({ ...s, lane, lanes }))
    } else {
      const hidden = []
      placed.forEach(({ s, lane }) => {
        if (lane < maxLanes - 1) items.push({ ...s, lane, lanes: maxLanes })
        else hidden.push(s)
      })
      more.push({
        top: Math.min.apply(null, hidden.map((s) => s.top)),
        bottom: Math.max.apply(null, hidden.map((s) => s.bottom)),
        lane: maxLanes - 1,
        lanes: maxLanes,
        count: hidden.length,
      })
    }
    cluster = []
    clusterBottom = -Infinity
  }
  list.forEach((s) => {
    if (cluster.length && s.top >= clusterBottom) flush()
    cluster.push(s)
    clusterBottom = Math.max(clusterBottom, s.bottom)
  })
  flush()
  return { items, more }
}

// weekGrid(list, options) -> the week grid, every position a fraction:
//   columns  [{ key, date, isToday, isPast, weekday ('Sat'), dayNum (26),
//              blocks: [{ v, top, height, lane, lanes, clipTop, clipBottom,
//              past }], more: [{ top, height, lane, lanes, count }] }]
//   allDay   { rows: [{ v, col, span, row, contLeft, contRight, past }],
//              rowCount, more: [n per column] }: all-day and long events as
//              bars across the days they cover, in at most maxAllDayRows rows
//   hours    the hour lines, startHour .. endHour - 1
//   now      { col, top } on today's column inside the hours, else null
// options: now (Date), startDay 'today' | 'monday' | 'sunday', days 5..7,
// startHour 5..12, endHour 17..24, maxLanes (3), maxAllDayRows (3),
// futureOnly (leave out what is over), minHours (the shortest a block is
// drawn, 0.25..2 hours, default 0.5: room for a line of its words). A timed
// event is cut at midnight into a block per day; the part outside the hours
// is pinned to the grid's edge, minHours tall, with its own time on it
// (clipTop, clipBottom).
export function weekGrid(list, options = {}) {
  const now = validDate(options.now) ? options.now : null
  const todayKey = now ? dateKey(now) : null
  const days = clampInt(options.days, 5, 7, 7)
  const startHour = clampInt(options.startHour, 0, 23, 7)
  const endHour = Math.max(startHour + 1, clampInt(options.endHour, 1, 24, 21))
  const maxLanes = clampInt(options.maxLanes, 1, 6, 3)
  const maxAllDayRows = clampInt(options.maxAllDayRows, 1, 6, 3)
  const futureOnly = options.futureOnly === true
  const firstKey = weekStartKey(todayKey, options.startDay) || todayKey
  const span = endHour - startHour
  const minHours = Math.min(2, Math.max(0.25, Number(options.minHours) || 0.5))
  const minFrac = Math.min(1, minHours / span)
  const events = (Array.isArray(list) ? list : []).filter((v) => !(futureOnly && isOver(v, now)))
  const hours = []
  for (let h = startHour; h < endHour; h++) hours.push(h)
  if (!firstKey) return { columns: [], allDay: { rows: [], rowCount: 0, more: [] }, hours, now: null }

  const columns = []
  for (let c = 0; c < days; c++) {
    const key = addDaysKey(firstKey, c)
    const date = keyToDate(key)
    const dayStart = date.getTime()
    const dayEnd = midnightMs(addDaysKey(key, 1))
    const rangeStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour).getTime()
    const rangeEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour).getTime()
    const rangeMs = rangeEnd - rangeStart
    const spans = []
    events.forEach((v) => {
      if (v.allDay || v.long) return
      const s = v.start.getTime()
      const e = Math.max(v.end.getTime(), s + 30 * MIN_MS)
      if (e <= dayStart || s >= dayEnd) return
      if (v.end.getTime() === s && (s < dayStart || s >= dayEnd)) return
      const segStart = Math.max(s, dayStart)
      const segEnd = Math.min(e, dayEnd)
      let top = (segStart - rangeStart) / rangeMs
      let bottom = (segEnd - rangeStart) / rangeMs
      const clipTop = top < 0
      const clipBottom = bottom > 1
      top = Math.max(0, Math.min(1, top))
      bottom = Math.max(0, Math.min(1, bottom))
      if (bottom - top < minFrac) {
        if (top + minFrac > 1) top = 1 - minFrac
        bottom = top + minFrac
      }
      spans.push({ v, top, bottom, clipTop, clipBottom, past: isOver(v, now) })
    })
    const laid = laneLayout(spans, maxLanes)
    columns.push({
      key,
      date,
      isToday: key === todayKey,
      isPast: todayKey != null && key < todayKey,
      weekday: DAY_SHORT[date.getDay()],
      dayNum: date.getDate(),
      blocks: laid.items.map((b) => ({
        v: b.v,
        top: b.top,
        height: b.bottom - b.top,
        lane: b.lane,
        lanes: b.lanes,
        clipTop: b.clipTop,
        clipBottom: b.clipBottom,
        past: b.past,
      })),
      more: laid.more.map((m) => ({ top: m.top, height: m.bottom - m.top, lane: m.lane, lanes: m.lanes, count: m.count })),
    })
  }

  // The all-day band: bars across the days they cover, packed into rows.
  const lastKey = addDaysKey(firstKey, days) // exclusive
  const bars = events
    .filter((v) => (v.allDay || v.long) && v.startDate < lastKey && v.endDate > firstKey)
    .map((v) => {
      const c0 = Math.max(0, daysBetweenKeys(firstKey, v.startDate))
      const c1 = Math.min(days, daysBetweenKeys(firstKey, v.endDate)) // exclusive
      return { v, col: c0, span: Math.max(1, c1 - c0), contLeft: v.startDate < firstKey, contRight: v.endDate > lastKey }
    })
    .sort((a, b) => a.col - b.col || b.span - a.span || byAllDayThenStart(a.v, b.v))
  const rowEnds = []
  const rows = []
  const more = new Array(days).fill(0)
  bars.forEach((b) => {
    let row = rowEnds.findIndex((end) => end <= b.col)
    if (row < 0) {
      row = rowEnds.length
      rowEnds.push(0)
    }
    rowEnds[row] = b.col + b.span
    if (row < maxAllDayRows) rows.push({ ...b, row, past: isOver(b.v, now) })
    else for (let c = b.col; c < b.col + b.span; c++) more[c] += 1
  })

  let nowMark = null
  if (now) {
    const col = columns.findIndex((c) => c.isToday)
    if (col >= 0) {
      const top = (now.getHours() + now.getMinutes() / 60 - startHour) / span
      if (top >= 0 && top < 1) nowMark = { col, top }
    }
  }
  return {
    columns,
    allDay: { rows, rowCount: Math.min(maxAllDayRows, rowEnds.length), more },
    hours,
    now: nowMark,
  }
}

// --- Month grid ------------------------------------------------------------------------

// monthGrid(list, options) -> { label: 'September 2026', monthKey
//   ('2026-09'), weekdays: ['Sun', ...], cells: 42 x { key, day, inMonth,
//   isToday, isPast, events } } for the current month or the next one
//   (options.month), weeks from options.weekStart ('sunday' | 'monday').
//   A cell's events are that day's (eventsOnDay; futureOnly leaves out what
//   is over).
export function monthGrid(list, options = {}) {
  const now = validDate(options.now) ? options.now : null
  if (!now) return { label: '', monthKey: null, weekdays: [], cells: [] }
  const todayKey = dateKey(now)
  const next = options.month === 'next'
  const first = new Date(now.getFullYear(), now.getMonth() + (next ? 1 : 0), 1)
  const monday = options.weekStart === 'monday'
  const lead = monday ? (first.getDay() + 6) % 7 : first.getDay()
  const startKey = addDaysKey(dateKey(first), -lead)
  const events = (Array.isArray(list) ? list : []).filter((v) => !(options.futureOnly === true && isOver(v, now)))
  const cells = []
  for (let i = 0; i < 42; i++) {
    const key = addDaysKey(startKey, i)
    const d = keyToDate(key)
    cells.push({
      key,
      day: d.getDate(),
      inMonth: d.getMonth() === first.getMonth(),
      isToday: key === todayKey,
      isPast: key < todayKey,
      events: eventsOnDay(events, key, now, false),
    })
  }
  const weekdays = []
  for (let i = 0; i < 7; i++) weekdays.push(DAY_SHORT[(i + (monday ? 1 : 0)) % 7])
  return {
    label: `${MONTH_LONG[first.getMonth()]} ${first.getFullYear()}`,
    monthKey: `${first.getFullYear()}-${pad2(first.getMonth() + 1)}`,
    weekdays,
    cells,
  }
}

// --- What each view needs from the hub ------------------------------------------------

// How far the agenda looks for days with events when it skips empty ones
// (its showEmptyDays off).
export const AGENDA_SCAN_DAYS = 14

// The days a view needs from the hub around today, for hooks/useCalendar.js
// wantCalendarWindow: { days (from today on, today counted), past (days
// before today) }, clamped to what the hub serves, or null for the default
// (six days from today, the agenda's; lib/agenda.js).
export function calendarNeed(type, knobs, now) {
  if (!validDate(now)) return null
  const k = isObj(knobs) ? knobs : {}
  const todayKey = dateKey(now)
  const fit = (days, past) => ({
    days: clampInt(days, 1, HUB_MAX_DAYS, 1),
    past: clampInt(past, 0, HUB_MAX_PAST, 0),
  })
  switch (type) {
    case 'agenda':
      // Skipping empty days looks further ahead for days that have events.
      return k.showEmptyDays === false ? fit(AGENDA_SCAN_DAYS, 0) : null
    case 'upnext': {
      const hours = clampInt(k.hoursAhead, 12, 72, 48)
      const endMs = now.getTime() + hours * HOUR_MS
      return fit(daysBetweenKeys(todayKey, dateKey(new Date(endMs - 1))) + 1, 0)
    }
    case 'daylist':
      return fit(k.day === 'tomorrow' ? 2 : 1, 0)
    case 'weekgrid': {
      const first = weekStartKey(todayKey, k.startDay) || todayKey
      const days = clampInt(k.days, 5, 7, 7)
      const past = Math.max(0, daysBetweenKeys(first, todayKey))
      return fit(Math.max(1, days - past), past)
    }
    case 'monthgrid': {
      const g = monthGrid([], { now, month: k.month, weekStart: k.weekStart })
      if (!g.cells.length) return null
      const firstKey = g.cells[0].key
      const lastKey = g.cells[g.cells.length - 1].key
      return fit(Math.max(1, daysBetweenKeys(todayKey, lastKey) + 1), Math.max(0, daysBetweenKeys(firstKey, todayKey)))
    }
    default:
      return null
  }
}

// The union of what the calendar panels on a board need: { days, past }, or
// null when none needs more than the default. panels: [{ type }], knobs:
// { <panel id>: knobs }.
export function boardCalendarNeed(panels, knobsById, now) {
  let need = null
  ;(Array.isArray(panels) ? panels : []).forEach((p) => {
    if (!p) return
    const n = calendarNeed(p.type, knobsById && knobsById[p.id], now)
    if (!n) return
    need = need ? { days: Math.max(need.days, n.days), past: Math.max(need.past, n.past) } : n
  })
  return need
}

// Is a day inside the range the calendar holds (the store's range: { from,
// to } with to exclusive)? No range known: false, so a view never claims a
// day it has not been told about is free.
export function covered(range, key) {
  return !!range && typeof range.from === 'string' && typeof range.to === 'string' && range.from <= key && key < range.to
}

// Every day from `from` up to `to` (exclusive) covered?
export function coversAll(range, from, to) {
  if (!DATE_KEY_RE.test(String(from)) || !DATE_KEY_RE.test(String(to))) return false
  return covered(range, from) && covered(range, addDaysKey(to, -1))
}

// --- Drawing helpers ---------------------------------------------------------------------

// The paint for an event's colours: null (none: the stylesheet's neutral),
// the colour itself, or for an event on several calendars one hard-edged
// stripe each, in `dir` ('to bottom' for a bar, 'to right' for a dot).
export function splitPaint(colors, dir = 'to bottom') {
  const list = (Array.isArray(colors) ? colors : []).filter((c) => typeof c === 'string' && c)
  if (!list.length) return null
  if (list.length === 1) return list[0]
  const n = list.length
  const stops = []
  list.forEach((c, i) => {
    const a = Math.round((i / n) * 10000) / 100
    const b = Math.round(((i + 1) / n) * 10000) / 100
    stops.push(`${c} ${a}%`, `${c} ${b}%`)
  })
  return `linear-gradient(${dir}, ${stops.join(', ')})`
}

// What a calendar panel can honestly say: 'ok' (draw what there is),
// 'loading' (the hub has not answered yet: say nothing rather than flash a
// message) or 'unreachable' (no events, and the hub is down or its calendar
// is: "Calendar not connected"). hasAny: the panel has events to draw.
export function calendarState({ connected = null, error = null, hasAny = false } = {}) {
  if (hasAny || connected === true) return 'ok'
  if (connected === false || !!error) return 'unreachable'
  return 'loading'
}

// --- The agenda's empty days --------------------------------------------------------------

// The agenda's columns with showEmptyDays off: from the day it starts (today,
// or tomorrow), the first `days` (1..5) that have an event (with futureOnly,
// one not yet over). allDays: lib/agenda.js buildAgendaDays from today,
// AGENDA_SCAN_DAYS of them. No such day at all: the plain columns, which say
// "Nothing scheduled".
export function daysWithEvents(allDays, knobs, now) {
  const list = Array.isArray(allDays) ? allDays : []
  const k = isObj(knobs) ? knobs : {}
  const count = clampInt(k.days, 1, 5, 3)
  const start = k.startDay === 'tomorrow' ? 1 : 0
  const nowMs = validDate(now) ? now.getTime() : null
  const live = (it) => {
    if (!k.futureOnly || it.allDay || nowMs == null) return true
    const end = it.end instanceof Date ? it.end : it.start instanceof Date ? it.start : null
    return !end || end.getTime() > nowMs
  }
  const picked = list.slice(start).filter((d) => d && Array.isArray(d.events) && d.events.some(live)).slice(0, count)
  return picked.length ? picked : list.slice(start, start + count)
}
