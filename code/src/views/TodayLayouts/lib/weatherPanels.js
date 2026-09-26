// weatherPanels.js - the pure parts of the weather panels
// (docs/designs/panels-and-controls.md, chunk 2, "Panels"): which hours a
// strip shows and how its columns wrap, the temperature curve, where a day's
// high-low bar sits, when rain counts, what the next hour says, which alert
// leads and what it says, the conditions rows. No React, no DOM, no clock:
// every `now` is handed in. Tested from Node (weatherPanels.test.mjs).
//
// Times are the feed's local wall-clock stamps ('2026-09-26T14:00', the START
// of the hour; hooks/hubWeatherFeed.js "Hour alignment"). Hours and minutes
// are compared as strings of the stamp ('2026-09-26T14'), which sorts in time.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80, so no
// Object.hasOwn, Array.prototype.at, structuredClone or String replaceAll.

import { fmtClock } from './format.js'

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

// 'YYYY-MM-DDTHH' of a local Date.
export function localHourKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}`
}

// 'YYYY-MM-DDTHH:MM' of a local Date.
export function localMinuteKey(d) {
  return `${localHourKey(d)}:${pad2(d.getMinutes())}`
}

function stampOk(t, len) {
  return typeof t === 'string' && t.length >= len && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(t)
}

// The clock hour (0..23) of a stamp, or null.
export function stampHour(time) {
  if (!stampOk(time, 13)) return null
  const h = Number(time.slice(11, 13))
  return h >= 0 && h <= 23 ? h : null
}

// '3 PM', '12 AM', '12 PM' for a stamp; '' for none.
export function fmtHour(time) {
  const h = stampHour(time)
  if (h == null) return ''
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
}

// --- The hourly strip ------------------------------------------------------------------

// The feed's hours from the one `now` is in, at most n. The feed starts at
// the hub's own current hour, so the first entry can be an hour behind; hours
// already over are skipped. [] when there is nothing current.
export function hoursFrom(hourly, now, n) {
  if (!Array.isArray(hourly) || !(now instanceof Date) || Number.isNaN(now.getTime())) return []
  const from = localHourKey(now)
  const out = []
  for (let i = 0; i < hourly.length && out.length < n; i++) {
    const e = hourly[i]
    if (isObj(e) && stampOk(e.time, 13) && e.time.slice(0, 13) >= from) out.push(e)
  }
  return out
}

// hourlyGrid(total, columns, widthPx, minColPx) -> { cols, rows }: how many
// columns a row of the strip has and how many rows the hours wrap into.
// columns 6, 8 or 12 is exactly that many per row (12 hours at 8: a row of 8
// and a row of 4, in columns of one width). 'auto' fits as many columns of
// at least minColPx as the width holds, all the hours in one row when they
// fit, else rows balanced (12 hours that fit 8 wide: two rows of 6).
export function hourlyGrid(total, columns, widthPx, minColPx) {
  const n = Math.max(0, Math.floor(Number(total) || 0))
  if (!n) return { cols: 0, rows: 0 }
  if (columns === 'auto' || columns == null) {
    const fit = widthPx > 0 && minColPx > 0 ? Math.max(1, Math.floor(widthPx / minColPx)) : n
    const rows = Math.ceil(n / Math.min(fit, n))
    return { cols: Math.ceil(n / rows), rows }
  }
  const want = Math.max(1, Math.round(Number(columns)) || n)
  const cols = Math.min(want, n)
  return { cols, rows: Math.ceil(n / cols) }
}

// The lowest and highest of the finite values, or null.
export function tempRange(values) {
  let min = null
  let max = null
  ;(Array.isArray(values) ? values : []).forEach((v) => {
    const t = num(v)
    if (t == null) return
    if (min == null || t < min) min = t
    if (max == null || t > max) max = t
  })
  return min == null ? null : { min, max }
}

// Where each temperature sits in the curve's band: 0 at the top (the range's
// highest), 1 at the bottom (its lowest), 0.5 for all of a flat range, null
// for a missing value.
export function curveLevels(values, range) {
  return (Array.isArray(values) ? values : []).map((v) => {
    const t = num(v)
    if (t == null || !range) return null
    if (range.max === range.min) return 0.5
    return (range.max - t) / (range.max - range.min)
  })
}

// --- Rain ---------------------------------------------------------------------------------

// Rain chances below this are noise (the weather card and the forecast use the
// same floor): shown muted in the hourly strip, highlighted from here.
export const RAIN_FLOOR = 20
// The rain chart's threshold line: from here the bar is drawn full strength.
export const RAIN_LINE = 50

// 'none' (0 or missing), 'slight' (under RAIN_FLOOR), 'possible' (under
// RAIN_LINE) or 'likely'.
export function rainLevel(pct) {
  const p = num(pct)
  if (p == null || p <= 0) return 'none'
  if (p >= RAIN_LINE) return 'likely'
  return p >= RAIN_FLOOR ? 'possible' : 'slight'
}

// A chance as a whole percentage 0..100, or null.
export function pctOf(v) {
  const p = num(v)
  return p == null ? null : Math.min(100, Math.max(0, Math.round(p)))
}

// Hour labels every 3 hours up to a day, every 6 past it.
export function rainStep(n) {
  return n > 24 ? 6 : 3
}

// rainLabels(entries, step) -> [{ index, text }]: a label on every bar whose
// clock hour is a multiple of `step` ('3 PM', '6 PM'), and 'Now' on the first
// bar, in place of its hour when it has one, or on its own when the first
// hour label is at least two bars away (closer, the two would collide).
export function rainLabels(entries, step) {
  const list = Array.isArray(entries) ? entries : []
  const out = []
  list.forEach((e, i) => {
    const h = stampHour(e && e.time)
    if (h != null && h % step === 0) out.push({ index: i, text: fmtHour(e.time) })
  })
  if (!list.length) return out
  if (out.length && out[0].index === 0) {
    out[0] = { index: 0, text: 'Now' }
  } else if (!out.length || out[0].index >= 2) {
    out.unshift({ index: 0, text: 'Now' })
  }
  return out
}

// --- The next hour (WeatherKit's minutes) ---------------------------------------------

// The strip shows when any minute ahead has at least this chance.
export const NEXT_HOUR_FLOOR = 10
// A minute counts as wet from this chance.
const WET = 50

const KINDS = {
  rain: 'Rain',
  drizzle: 'Drizzle',
  snow: 'Snow',
  sleet: 'Sleet',
  hail: 'Hail',
  mixed: 'Mixed precipitation',
  precipitation: 'Precipitation',
}

// The word for what is coming: the first summary segment that is not clear.
function kindOf(nextHour) {
  const segs = nextHour && Array.isArray(nextHour.summary) ? nextHour.summary : []
  for (let i = 0; i < segs.length; i++) {
    const c = String((segs[i] && segs[i].condition) || '').toLowerCase()
    if (c && c !== 'clear') return KINDS[c] || 'Rain'
  }
  return 'Rain'
}

// nextHourStrip(nextHour, now) -> null, or { chances, text } for the minutes
// from `now` on (at most 60): each minute's chance (0..100), and what it adds
// up to ('Rain likely in 12 min', 'Rain stopping in 25 min', 'Rain for the
// next hour', 'Rain possible within the hour'). null when there are no
// minutes, or no minute ahead reaches NEXT_HOUR_FLOOR.
export function nextHourStrip(nextHour, now) {
  const minutes = nextHour && Array.isArray(nextHour.minutes) ? nextHour.minutes : []
  if (!minutes.length || !(now instanceof Date) || Number.isNaN(now.getTime())) return null
  const from = localMinuteKey(now)
  const ahead = minutes.filter((m) => isObj(m) && stampOk(m.time, 16) && m.time.slice(0, 16) >= from).slice(0, 60)
  const chances = ahead.map((m) => pctOf(m.precipChance) ?? 0)
  if (!chances.some((c) => c >= NEXT_HOUR_FLOOR)) return null
  const kind = kindOf(nextHour)
  let text
  if (chances[0] >= WET) {
    let end = -1
    for (let i = 1; i < chances.length; i++) {
      if (chances[i] < WET) {
        end = i
        break
      }
    }
    text = end < 0 ? `${kind} for the next hour` : `${kind} stopping in ${end} min`
  } else {
    let start = -1
    for (let i = 1; i < chances.length; i++) {
      if (chances[i] >= WET) {
        start = i
        break
      }
    }
    text = start < 0 ? `${kind} possible within the hour` : `${kind} likely in ${start} min`
  }
  return { chances, text }
}

// --- Alerts -----------------------------------------------------------------------------

// Most severe first, as the hub orders them (frameserver/lib/weatherRules.mjs).
const SEVERITIES = ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function severityIndex(s) {
  const i = SEVERITIES.indexOf(s)
  return i < 0 ? SEVERITIES.length - 1 : i
}

function timeOf(v) {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function sortKey(d) {
  return d ? d.getTime() : Infinity
}

// The alerts still in force at `now` (no end: in force), most severe first,
// then the earliest to end, then the earliest to start.
export function activeAlerts(alerts, now) {
  const t = now instanceof Date ? now.getTime() : NaN
  const list = (Array.isArray(alerts) ? alerts : []).filter((a) => {
    if (!isObj(a) || typeof a.event !== 'string' || !a.event.trim()) return false
    const ends = timeOf(a.ends)
    return !ends || !Number.isFinite(t) || ends.getTime() > t
  })
  return list
    .map((a, i) => ({ a, i }))
    .sort(
      (x, y) =>
        severityIndex(x.a.severity) - severityIndex(y.a.severity) ||
        sortKey(timeOf(x.a.ends)) - sortKey(timeOf(y.a.ends)) ||
        sortKey(timeOf(x.a.onset)) - sortKey(timeOf(y.a.onset)) ||
        x.i - y.i
    )
    .map((x) => x.a)
}

// The one alert a banner shows, or null.
export function pickAlert(alerts, now) {
  const list = activeAlerts(alerts, now)
  return list.length ? list[0] : null
}

// 'warning' (red): Extreme or Severe, or any Warning by name; else
// 'advisory' (amber): advisories, watches, statements.
export function alertTone(alert) {
  if (!alert) return 'advisory'
  if (severityIndex(alert.severity) <= 1) return 'warning'
  return /\bwarning\b/i.test(String(alert.event || '')) ? 'warning' : 'advisory'
}

// '6 pm', '6:30 pm', '12 pm'.
function clock(d) {
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}${m ? `:${pad2(m)}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

function dayStart(d, offset) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (offset || 0))
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isTonightsMidnight(d, now) {
  return d.getHours() === 0 && d.getMinutes() === 0 && sameDay(d, dayStart(now, 1))
}

// 'midnight' tonight, '6 pm' today, 'Sat 6 am' within the week, else 'Dec 28'.
function whenText(d, now) {
  if (isTonightsMidnight(d, now)) return 'midnight'
  if (sameDay(d, now)) return clock(d)
  const days = Math.round((dayStart(d).getTime() - dayStart(now).getTime()) / 86400000)
  if (days > 0 && days < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

// alertWhen(alert, now) -> 'until 6 pm' (ends today or at midnight tonight),
// 'through Sat 6 am' (later), 'from 3 pm' (not started yet), '' (no end) -
// the hub headline's wording (weatherRules.mjs alertText).
export function alertWhen(alert, now) {
  if (!alert || !(now instanceof Date)) return ''
  const onset = timeOf(alert.onset)
  if (onset && onset.getTime() > now.getTime()) return `from ${whenText(onset, now)}`
  const ends = timeOf(alert.ends)
  if (!ends) return ''
  const today = sameDay(ends, now) || isTonightsMidnight(ends, now)
  return `${today ? 'until' : 'through'} ${whenText(ends, now)}`
}

// --- The forecast band ------------------------------------------------------------------

// The period's lowest low and highest high, over the days shown, or null.
export function bandScale(days) {
  const values = []
  ;(Array.isArray(days) ? days : []).forEach((d) => {
    if (!d) return
    if (num(d.lowF) != null) values.push(d.lowF)
    if (num(d.highF) != null) values.push(d.highF)
  })
  return tempRange(values)
}

// bandSpan(low, high, scale, minPct) -> { left, width } in percent of the
// track: the day's low to high on the period's scale, at least minPct wide
// (widened about its middle and kept on the track) so a day of one degree
// still shows a bar. A missing end uses the other; null when both are.
export function bandSpan(low, high, scale, minPct = 6) {
  let lo = num(low)
  let hi = num(high)
  if (lo == null && hi == null) return null
  if (lo == null) lo = hi
  if (hi == null) hi = lo
  if (lo > hi) {
    const t = lo
    lo = hi
    hi = t
  }
  const span = scale && scale.max > scale.min ? scale.max - scale.min : 0
  let left = span ? ((lo - scale.min) / span) * 100 : 0
  let width = span ? ((hi - lo) / span) * 100 : 100
  if (width < minPct) {
    const mid = left + width / 2
    width = minPct
    left = mid - minPct / 2
  }
  left = Math.min(100 - width, Math.max(0, left))
  const r = (v) => Math.round(v * 1000) / 1000
  return { left: r(left), width: r(width) }
}

// --- Conditions ---------------------------------------------------------------------------

// The rows the Conditions panel can show, in order, with the knob that shows
// each (panels/schemas.js 'conditions').
export const CONDITION_ROWS = [
  { key: 'feelsLike', knob: 'showFeelsLike', label: 'Feels like' },
  { key: 'humidity', knob: 'showHumidity', label: 'Humidity' },
  { key: 'wind', knob: 'showWind', label: 'Wind' },
  { key: 'gusts', knob: 'showGusts', label: 'Gusts' },
  { key: 'uv', knob: 'showUv', label: 'UV index' },
  { key: 'pressure', knob: 'showPressure', label: 'Pressure' },
  { key: 'visibility', knob: 'showVisibility', label: 'Visibility' },
  { key: 'dewPoint', knob: 'showDewPoint', label: 'Dew point' },
  { key: 'sunrise', knob: 'showSunrise', label: 'Sunrise' },
  { key: 'sunset', knob: 'showSunset', label: 'Sunset' },
  { key: 'cloudCover', knob: 'showCloudCover', label: 'Cloud cover' },
]

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

// The eight-point direction the wind blows FROM ('NW'), or ''.
export function compass(deg) {
  const d = num(deg)
  if (d == null) return ''
  return COMPASS[Math.round((((d % 360) + 360) % 360) / 45) % 8]
}

// 'Low' .. 'Extreme', the WHO bands.
export function uvBand(uv) {
  const u = num(uv)
  if (u == null) return ''
  if (u < 3) return 'Low'
  if (u < 6) return 'Moderate'
  if (u < 8) return 'High'
  if (u < 11) return 'Very high'
  return 'Extreme'
}

function round(v) {
  return Math.round(v) + 0
}

// One row's value, as shown ('56°', '72%', '5 mph NW', '3 Moderate',
// '30.18 inHg', '14 mi', '7:02 am'), or '--' when the reading is missing.
// current: the weather card's current conditions with the feed's extras
// (useTodayData d.weather.current); sun: { sunrise, sunset } as Dates.
export function conditionValue(key, current, sun) {
  const c = current || {}
  const DASH = '--'
  switch (key) {
    case 'feelsLike': {
      const f = num(c.feelsLikeF) ?? num(c.feelsF)
      return f == null ? DASH : `${round(f)}°`
    }
    case 'humidity':
      return num(c.humidity) == null ? DASH : `${round(c.humidity)}%`
    case 'wind': {
      const w = num(c.windMph)
      if (w == null) return DASH
      if (round(w) === 0) return 'Calm'
      const dir = compass(c.windDir)
      return `${round(w)} mph${dir ? ` ${dir}` : ''}`
    }
    case 'gusts':
      return num(c.gustMph) == null ? DASH : `${round(c.gustMph)} mph`
    case 'uv':
      return num(c.uv) == null ? DASH : `${round(c.uv)} ${uvBand(c.uv)}`
    case 'pressure':
      return num(c.pressureMb) == null ? DASH : `${(c.pressureMb * 0.02953).toFixed(2)} inHg`
    case 'visibility': {
      const v = num(c.visibilityMi)
      if (v == null) return DASH
      return `${v >= 10 ? round(v) : Math.round(v * 10) / 10} mi`
    }
    case 'dewPoint':
      return num(c.dewF) == null ? DASH : `${round(c.dewF)}°`
    case 'sunrise':
      return sun && sun.sunrise instanceof Date ? fmtClock(sun.sunrise) : DASH
    case 'sunset':
      return sun && sun.sunset instanceof Date ? fmtClock(sun.sunset) : DASH
    case 'cloudCover':
      return num(c.cloudCover) == null ? DASH : `${round(c.cloudCover)}%`
    default:
      return DASH
  }
}

// The rows the knobs show, in CONDITION_ROWS order: [{ key, label, value }].
export function conditionRows(knobs, current, sun) {
  const k = knobs || {}
  return CONDITION_ROWS.filter((r) => k[r.knob] === true).map((r) => ({
    key: r.key,
    label: r.label,
    value: conditionValue(r.key, current, sun),
  }))
}

// The type the rows get: min(row height x 0.5, column width x 0.08). The
// panel's CSS draws with the same two factors (ConditionsPanel.css).
export const CONDITIONS_ROW_FACTOR = 0.5
export const CONDITIONS_COL_FACTOR = 0.08

// conditionsColumns(layout, width, height, rows) -> 1 or 2. 'one' and 'two'
// are that (two needs two rows); 'auto' takes two columns when that gives the
// rows bigger type than one column would, which is when the box is wide.
export function conditionsColumns(layout, width, height, rows) {
  const n = Math.max(0, Math.floor(Number(rows) || 0))
  if (layout === 'one' || n < 2) return 1
  if (layout === 'two') return 2
  if (!(width > 0) || !(height > 0)) return 1
  const size = (cols) => Math.min((height / Math.ceil(n / cols)) * CONDITIONS_ROW_FACTOR, (width / cols) * CONDITIONS_COL_FACTOR)
  return size(2) > size(1) * 1.05 ? 2 : 1
}
