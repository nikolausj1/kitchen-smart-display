// clocks.js - the pure parts of the chunk 4 clocks (docs/designs/
// panels-and-controls.md, chunk 4 "Blocks and clocks"): the time in another
// IANA zone and its offset from the screen's own, the analog clock's hand
// angles, and how big a flip clock can be in a box. No React, no DOM, no
// clock of its own: every `now` is handed in. Tested from Node
// (clocks.test.mjs).
//
// The house zone is the screen's own local zone: every screen is in the house
// (frameserver/lib/countdown.mjs "Local time throughout"), so a Date's local
// getters are house time. A zone's wall clock comes from Intl.DateTimeFormat.
//
// Runtime rule: Silk on the Echo may be as old as Chrome 80. formatToParts
// (57) and hourCycle (73) are there; no Object.hasOwn, Array.prototype.at,
// structuredClone or String replaceAll.

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// U+2212, the minus sign: as wide as "+" in the display fonts.
const MINUS = '−'

function isDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// --- Time zones ---------------------------------------------------------------------

// One formatter per zone name as typed (null: not a zone this engine knows).
// Building one costs far more than using it, and the second clock asks every
// second. Capped: the names come from a text field.
const FORMATTERS = new Map()
const MAX_FORMATTERS = 32

function formatterFor(tz) {
  if (typeof tz !== 'string') return null
  const key = tz.trim()
  if (!key) return null
  if (FORMATTERS.has(key)) return FORMATTERS.get(key)
  let f
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
  } catch {
    // RangeError: not an IANA zone (or not one this engine carries)
    f = null
  }
  if (FORMATTERS.size >= MAX_FORMATTERS) FORMATTERS.clear()
  FORMATTERS.set(key, f)
  return f
}

// 'Europe/London' -> 'London', 'America/Argentina/Buenos_Aires' -> 'Buenos
// Aires', 'Etc/GMT+9' -> 'GMT+9', 'UTC' -> 'UTC'; '' for nothing.
export function cityOf(zone) {
  if (typeof zone !== 'string') return ''
  const parts = zone.trim().split('/')
  return parts[parts.length - 1].split('_').join(' ')
}

// zoneOf(tz) -> { valid, zone, city }: whether this engine knows the zone,
// its canonical name ('europe/london' -> 'Europe/London') and its city. An
// unknown zone keeps its city as typed, for the label; zone is then null.
export function zoneOf(tz) {
  const f = formatterFor(tz)
  if (!f) return { valid: false, zone: null, city: typeof tz === 'string' ? cityOf(tz) : '' }
  const zone = f.resolvedOptions().timeZone || String(tz).trim()
  return { valid: true, zone, city: cityOf(zone) }
}

// wallClock(date, tz) -> { year, month (0..11), day, weekday (0..6), hour
// (0..23), minute, second }: the clock on the wall in zone tz, or in this
// screen's own zone when tz is null or undefined. null for no date, or for a
// zone this engine does not know.
export function wallClock(date, tz) {
  if (!isDate(date)) return null
  if (tz == null) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      weekday: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    }
  }
  const f = formatterFor(tz)
  if (!f) return null
  const v = {}
  f.formatToParts(date).forEach((p) => {
    v[p.type] = p.value
  })
  const hour = Number(v.hour)
  const out = {
    year: Number(v.year),
    month: Number(v.month) - 1,
    day: Number(v.day),
    weekday: DAY_SHORT.indexOf(v.weekday),
    // An engine that still counts midnight as 24 (h24) despite hourCycle.
    hour: hour === 24 ? 0 : hour,
    minute: Number(v.minute),
    second: Number(v.second),
  }
  return Number.isFinite(out.year) && Number.isFinite(out.hour) && out.weekday >= 0 ? out : null
}

// Minutes the zone is ahead of UTC at that moment (London in summer: 60), or
// this screen's own zone's with tz null; null when it cannot be told.
export function zoneOffsetMinutes(date, tz) {
  if (!isDate(date)) return null
  if (tz == null) return -date.getTimezoneOffset() || 0
  const w = wallClock(date, tz)
  if (!w) return null
  const wall = Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second)
  const instant = Math.floor(date.getTime() / 1000) * 1000
  return Math.round((wall - instant) / 60000) || 0
}

// Minutes zone tz is ahead of the house (houseTz, or this screen's own zone
// when left out): London against Seattle in September, 480. null when either
// cannot be told.
export function relativeOffsetMinutes(date, tz, houseTz) {
  const there = zoneOffsetMinutes(date, tz)
  const here = zoneOffsetMinutes(date, houseTz == null ? null : houseTz)
  return there == null || here == null ? null : there - here
}

// 480 -> '+8h', -420 -> '−7h' (a minus sign), 330 -> '+5:30h', 0 -> '+0h';
// '' for nothing.
export function fmtOffset(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return ''
  const m = Math.round(minutes)
  const a = Math.abs(m)
  const h = Math.floor(a / 60)
  const rest = a % 60
  return `${m < 0 ? MINUS : '+'}${h}${rest ? `:${pad2(rest)}` : ''}h`
}

// A wall clock's time: { hm: '4:05' | '16:05', meridiem: 'PM' | null }.
export function fmtWallTime(w, hour24) {
  if (!w) return { hm: '--:--', meridiem: null }
  if (hour24) return { hm: `${pad2(w.hour)}:${pad2(w.minute)}`, meridiem: null }
  return { hm: `${w.hour % 12 || 12}:${pad2(w.minute)}`, meridiem: w.hour < 12 ? 'AM' : 'PM' }
}

// A wall clock's date: 'Sat, Sep 26'.
export function fmtWallDate(w) {
  if (!w) return ''
  return `${DAY_SHORT[w.weekday]}, ${MONTH_SHORT[w.month]} ${w.day}`
}

// secondClock(now, { timezone, label, hour24 }, houseTz?) -> what the second
// clock shows:
//   { valid, zone, label, hm, meridiem, date, offsetMinutes, offset }
// An unknown zone (or none) falls back to the house's time (valid false: the
// panel marks it "?") and has no offset. label is the one given, else the
// zone's city, else 'Time zone'. houseTz is for tests; the app leaves it out.
export function secondClock(now, opts, houseTz) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const z = zoneOf(o.timezone)
  const w = wallClock(now, z.valid ? z.zone : houseTz == null ? null : houseTz)
  const t = fmtWallTime(w, !!o.hour24)
  const given = typeof o.label === 'string' ? o.label.trim() : ''
  const offsetMinutes = z.valid ? relativeOffsetMinutes(now, z.zone, houseTz) : null
  return {
    valid: z.valid,
    zone: z.zone,
    label: given || z.city || 'Time zone',
    hm: t.hm,
    meridiem: t.meridiem,
    date: fmtWallDate(w),
    offsetMinutes,
    offset: fmtOffset(offsetMinutes),
  }
}

// --- The analog clock -----------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100
}

// The hands' angles, clockwise from 12, in degrees: the hour hand moves with
// the minutes, the minute hand with the seconds, the seconds hand in whole
// seconds (it ticks). Zeros with no date.
export function handAngles(date) {
  if (!isDate(date)) return { hour: 0, minute: 0, second: 0 }
  const h = date.getHours() % 12
  const m = date.getMinutes()
  const s = date.getSeconds()
  return {
    hour: round2((h + m / 60 + s / 3600) * 30),
    minute: round2((m + s / 60) * 6),
    second: s * 6,
  }
}

// Milliseconds to wait for the next whole second, and a hair past it, so a
// tick lands on the new second rather than just before it.
export function msToNextSecond(date, slackMs = 15) {
  const ms = isDate(date) ? date.getTime() % 1000 : 0
  return 1000 - ms + slackMs
}

// --- The flip clock in a box ------------------------------------------------------------
//
// FlipClock.css sizes everything from one variable, --tl-flip-u (the card
// height). In a box the clock is as big as the box allows: the largest u at
// which it fits, the case's lips and a little of its shadow included. Its
// extent in u, from FlipClock.css:
//
//   width   the row: the AM / PM tab 0.235 less its 0.035 tuck under the hour
//           card, the hour card 1.38, the colon 0.26, two minute cards 0.75
//           with a 0.018 seam; the case's lips, 0.016 left (the tab is the
//           left edge when it shows) and 0.018 right; and FLIP_AIR each side,
//           where the case's shadow fades
//   height  the case's 0.016 lip above the cards, the cards (1), then the
//           case's 0.032 lip below, or the date line: 0.13 of margin and a
//           line at max(12px, 0.062u); FLIP_AIR above and below, and more
//           below a clock with no date, where the whole shadow shows
//
// A date line never under 12 px (FlipClock.css) is the one part not in u:
// flipFit's floorPx and footU say how the fit accounts for it.
export const FLIP_AIR = 0.04
const FLIP_ROW = { tab: 0.2, hour: 1.38, colon: 0.26, minutes: 0.75 * 2 + 0.018 }
const FLIP_LIP = { top: 0.016, bottom: 0.032, left: 0.016, right: 0.018 }
const FLIP_DATE = { margin: 0.13, size: 0.062, floorPx: 12 }
const FLIP_SHADOW = 0.07

function round4(n) {
  return Math.round(n * 10000) / 10000
}

// flipFit({ tab, date }) -> { wu, hu, footU, floorPx }: the clock is wu u
// wide and hu u tall; with the date's 12 px floor it is footU u plus floorPx
// tall, whichever is taller. So u = min(w / wu, h / hu, (h - floorPx) /
// footU) (flipFitPx; FlipClockPanel.css says the same in container units).
export function flipFit(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const tab = !!o.tab
  const date = !!o.date
  const row = (tab ? FLIP_ROW.tab : FLIP_LIP.left) + FLIP_ROW.hour + FLIP_ROW.colon + FLIP_ROW.minutes + FLIP_LIP.right
  const wu = row + FLIP_AIR * 2
  const above = FLIP_AIR + FLIP_LIP.top + 1
  if (!date) {
    const hu = above + FLIP_LIP.bottom + FLIP_SHADOW
    return { wu: round4(wu), hu: round4(hu), footU: round4(hu), floorPx: 0 }
  }
  const footU = above + FLIP_DATE.margin + FLIP_AIR
  return { wu: round4(wu), hu: round4(footU + FLIP_DATE.size), footU: round4(footU), floorPx: FLIP_DATE.floorPx }
}

// The card height, px, that fills a w x h box (px) with the flip clock; 0
// for no box.
export function flipFitPx(w, h, opts) {
  if (!(w > 0) || !(h > 0)) return 0
  const f = flipFit(opts)
  const byFloor = f.floorPx ? (h - f.floorPx) / f.footU : Infinity
  return Math.max(0, Math.min(w / f.wu, h / f.hu, byFloor))
}
