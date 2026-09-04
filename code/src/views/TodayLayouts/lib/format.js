// Shared formatting for the Today layouts. Panels built by different hands
// must agree on how a time, a day, or a data age reads, so it all lives here.

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

// { hm: '3:10', ampm: 'PM' } (or '3:10:05' with seconds). 12-hour, no leading zero.
export function fmtTime(date, { seconds = false } = {}) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return { hm: '--:--', ampm: '' }
  const h = date.getHours()
  const hour12 = h % 12 || 12
  const hm = seconds
    ? `${hour12}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    : `${hour12}:${pad2(date.getMinutes())}`
  return { hm, ampm: h < 12 ? 'AM' : 'PM' }
}

// '7:06 am' - lower-case meridiem, for inline use (sunrise, "as of").
export function fmtClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--'
  const { hm, ampm } = fmtTime(date)
  return `${hm} ${ampm.toLowerCase()}`
}

// 'Friday, August 14'
export function fmtDateLong(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return `${DAY_LONG[date.getDay()]}, ${MONTH_LONG[date.getMonth()]} ${date.getDate()}`
}

// 'Fri'
export function fmtDayShort(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return DAY_SHORT[date.getDay()]
}

// 'Friday'
export function fmtDayLong(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  return DAY_LONG[date.getDay()]
}

// Data age for FreshnessStamp: 'just now' under a minute, 'N min ago' under an
// hour, then a clock time ('as of 12:36 pm'). null when there is no fetch yet.
export function fmtAge(fetchedAt, now = new Date()) {
  if (!fetchedAt) return null
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const ageMs = nowMs - fetchedAt
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now'
  if (ageMs < 60_000) return 'just now'
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)} min ago`
  return `as of ${fmtClock(new Date(fetchedAt))}`
}

// 'm:ss' from milliseconds, for track progress.
export function fmtMinutes(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`
}

// Time-of-day greeting. Boundaries: <5 night, 5-11 morning, 12-16 afternoon,
// 17-21 evening, 22+ night.
export function greetingFor(date = new Date()) {
  const h = date.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Good night'
}
