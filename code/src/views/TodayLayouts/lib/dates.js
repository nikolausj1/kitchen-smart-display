// dates.js - the pure parts of the chunk 4 date block and day count
// (docs/designs/panels-and-controls.md, chunk 4 "Blocks and clocks"): the
// date formats, the ISO week, the day of the year, the days left in it, and
// the school days left until the last day of school. No React, no DOM, no
// clock of its own: every `now` is handed in. Tested from Node
// (dates.test.mjs).
//
// Local time throughout, as everywhere on the screens: a Date's local getters
// are house time (frameserver/lib/countdown.mjs).
//
// Runtime rule: Silk on the Echo may be as old as Chrome 80. No Object.hasOwn,
// Array.prototype.at, structuredClone or String replaceAll.

import { dateKey, isNoSchoolToday } from '../../../lib/countdown.js'

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DAY_MS = 24 * 60 * 60 * 1000

function isDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

// --- The date block -------------------------------------------------------------------

// The date block's formats (panels/schemas.js 'date'), as they read on
// Saturday, September 26, 2026:
//   long       Saturday, September 26
//   medium     Sat, Sep 26
//   short      9/26
//   dayname    Saturday
//   daynumber  a big 26 under a small Sep (DatePanel.jsx lays it out)
// With the year: 'Saturday, September 26, 2026', 'Sat, Sep 26, 2026',
// '9/26/2026', and 'Sep 2026' over the big day; dayname has none.
export const DATE_FORMATS = ['long', 'medium', 'short', 'dayname', 'daynumber']

function part(key, text) {
  return { key, text }
}

const SEP = null

// dateParts(date, format, { year }) -> [{ key, text }]: the date in that
// format, piece by piece. key is 'weekday', 'month', 'day' or 'year' (the
// date block marks each for the layout editor), or null for the punctuation
// between them. An unknown format reads as long; no date, [].
export function dateParts(date, format, opts) {
  if (!isDate(date)) return []
  const year = !!(opts && opts.year)
  const y = String(date.getFullYear())
  const d = String(date.getDate())
  switch (format) {
    case 'medium':
      return [
        part('weekday', DAY_SHORT[date.getDay()]),
        part(SEP, ', '),
        part('month', MONTH_SHORT[date.getMonth()]),
        part(SEP, ' '),
        part('day', d),
      ].concat(year ? [part(SEP, ', '), part('year', y)] : [])
    case 'short':
      return [part('month', String(date.getMonth() + 1)), part(SEP, '/'), part('day', d)].concat(
        year ? [part(SEP, '/'), part('year', y)] : []
      )
    case 'dayname':
      return [part('weekday', DAY_LONG[date.getDay()])]
    case 'daynumber':
      return [part('month', MONTH_SHORT[date.getMonth()])]
        .concat(year ? [part(SEP, ' '), part('year', y)] : [])
        .concat([part('day', d)])
    default:
      return [
        part('weekday', DAY_LONG[date.getDay()]),
        part(SEP, ', '),
        part('month', MONTH_LONG[date.getMonth()]),
        part(SEP, ' '),
        part('day', d),
      ].concat(year ? [part(SEP, ', '), part('year', y)] : [])
  }
}

// The date as one line of text ('Saturday, September 26'; daynumber reads
// 'Sep 26'), for a screen reader and the tests.
export function dateText(date, format, opts) {
  const parts = dateParts(date, format, opts)
  if (format === 'daynumber') {
    const day = parts[parts.length - 1]
    return day ? `${parts.slice(0, -1).map((p) => p.text).join('')} ${day.text}` : ''
  }
  return parts.map((p) => p.text).join('')
}

// --- Day counts -------------------------------------------------------------------------

// A day's number in its year's run of days, from a noon on that date: noon,
// so a daylight-saving change never moves it across a midnight.
function dayIndex(y, m, d) {
  return Math.round(Date.UTC(y, m, d, 12) / DAY_MS)
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365
}

// 1 on January 1, 365 (366) on December 31.
export function dayOfYear(date) {
  if (!isDate(date)) return null
  const y = date.getFullYear()
  return dayIndex(y, date.getMonth(), date.getDate()) - dayIndex(y, 0, 1) + 1
}

// The days after today until the year ends: 0 on December 31.
export function daysLeftInYear(date) {
  if (!isDate(date)) return null
  return daysInYear(date.getFullYear()) - dayOfYear(date)
}

// The ISO 8601 week (weeks start on Monday; week 1 holds the year's first
// Thursday): 1..53. December 29 can be week 1 of the next year, and January
// 3 week 53 of the last.
export function isoWeek(date) {
  if (!isDate(date)) return null
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const weekday = new Date(Date.UTC(y, m, d)).getUTCDay() || 7
  // The Thursday of this week decides the year the week belongs to.
  const thursday = new Date(Date.UTC(y, m, d + 4 - weekday))
  const ty = thursday.getUTCFullYear()
  const start = Date.UTC(ty, 0, 1)
  return Math.floor((thursday.getTime() - start) / DAY_MS / 7) + 1
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

// 'YYYY-MM-DD' -> that day at local noon, or null. What a caller keyed on the
// day (a memo that should change once a day, not every second) counts from.
export function dayFromKey(key) {
  if (typeof key !== 'string' || !DATE_KEY_RE.test(key)) return null
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12)
  return dateKey(d) === key ? d : null
}

function validKey(v) {
  return dayFromKey(v) ? v : null
}

// lastSchoolDay({ today, school, calendar }) -> 'YYYY-MM-DD' or null: the
// last day of school still ahead (today counts). school.lastDay (the house's
// own, shared.school.lastDay, when the dashboard has one) wins while it is
// not past; else the school calendar's (the hub's /api/schoolcal lastDays)
// first last day from today on; else null.
export function lastSchoolDay(args) {
  const a = args && typeof args === 'object' ? args : {}
  if (!isDate(a.today)) return null
  const today = dateKey(a.today)
  const own = validKey(a.school && a.school.lastDay)
  if (own && own >= today) return own
  const list = a.calendar && Array.isArray(a.calendar.lastDays) ? a.calendar.lastDays : []
  let best = null
  list.forEach((v) => {
    const k = validKey(v)
    if (k && k >= today && (best == null || k < best)) best = k
  })
  return best
}

// Upper bound on the days counted, so a far-off last day cannot run away.
const MAX_SCHOOL_SPAN_DAYS = 400

// schoolDaysLeft({ today, school, calendar, lastDay }) -> the school days
// from today through lastDay, both counted: today while it is a school day
// (a school day is not over until it is), and the last day itself. Which days
// are school days is isNoSchoolToday's call (lib/countdown.js: the school's
// weekdays, the dashboard's no-school dates, the calendar's no-school ranges
// and its session bounds), so it agrees with the morning countdown. null with
// no last day, or one already past.
export function schoolDaysLeft(args) {
  const a = args && typeof args === 'object' ? args : {}
  if (!isDate(a.today)) return null
  const last = validKey(a.lastDay)
  const today = dateKey(a.today)
  if (!last || last < today) return null
  const y = a.today.getFullYear()
  const m = a.today.getMonth()
  const d = a.today.getDate()
  let count = 0
  for (let i = 0; i < MAX_SCHOOL_SPAN_DAYS; i++) {
    const day = new Date(y, m, d + i, 12)
    if (dateKey(day) > last) break
    if (!isNoSchoolToday(a.school, a.calendar || null, day)) count += 1
  }
  return count
}

// The day count's kinds (panels/schemas.js 'daycount' show).
export const DAY_COUNTS = ['weekOfYear', 'dayOfYear', 'daysLeftInYear', 'schoolDays']

// dayCount(show, { now, school, calendar }) -> { value, label, lastDay? } or
// null when it cannot be counted (school days with no last day ahead):
//   weekOfYear      39, 'Week of the year' (the ISO week)
//   dayOfYear       269, 'Day of 365'
//   daysLeftInYear  96, 'Days left in 2026' ('Day left' at 1)
//   schoolDays      the school days left, 'School days left' ('School day
//                   left' at 1), and the lastDay counted to
// An unknown show counts weeks.
export function dayCount(show, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {}
  const now = c.now
  if (!isDate(now)) return null
  switch (show) {
    case 'dayOfYear':
      return { value: dayOfYear(now), label: `Day of ${daysInYear(now.getFullYear())}` }
    case 'daysLeftInYear': {
      const value = daysLeftInYear(now)
      return { value, label: `${value === 1 ? 'Day' : 'Days'} left in ${now.getFullYear()}` }
    }
    case 'schoolDays': {
      const lastDay = lastSchoolDay({ today: now, school: c.school, calendar: c.calendar })
      const value = lastDay ? schoolDaysLeft({ today: now, school: c.school, calendar: c.calendar, lastDay }) : null
      if (value == null) return null
      return { value, label: value === 1 ? 'School day left' : 'School days left', lastDay }
    }
    default:
      return { value: isoWeek(now), label: 'Week of the year' }
  }
}
