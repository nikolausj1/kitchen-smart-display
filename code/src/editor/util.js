// util.js - small pure helpers shared by the editor's spec and schema modules
// (spec.js re-exports the ones the components use).

export const isDict = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
export const round2 = (n) => Math.round(n * 100) / 100 + 0

// Decimal places of a step (0.05 -> 2, 1000 -> 0), at most 4.
export function decimalsOf(step) {
  if (!Number.isFinite(step) || step <= 0) return 4
  const s = String(step)
  const i = s.indexOf('.')
  if (i >= 0) return Math.min(4, s.length - i - 1)
  const m = /e-(\d+)$/.exec(s)
  return m ? Math.min(4, Number(m[1])) : 0
}

export function roundTo(n, places) {
  const f = 10 ** places
  return Math.round(n * f) / f + 0
}

// A finite number from a number or a numeric string, else NaN.
export function toNum(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

// #rgb, #rgba, #rrggbb or #rrggbbaa, lowercased, as written.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
export function normalizeColor(v, fallback = '#f2f2f0') {
  if (typeof v !== 'string') return fallback
  const s = v.trim().toLowerCase()
  return HEX_RE.test(s) ? s : fallback
}

// A colour input only takes #rrggbb.
export function colorForWell(c) {
  const s = normalizeColor(c)
  if (s.length === 4 || s.length === 5) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  return s.slice(0, 7)
}

// Key-order-insensitive deep equality for JSON values.
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b || a == null || b == null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

// 'showGreeting' -> 'Show greeting', 'time' -> 'Time'.
export function humanize(key) {
  const s = String(key || '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

// "5 min ago", "2 h ago", "3 days ago" from an ISO time.
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'at an unknown time'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

// --- nested props (box v2: bg.color, border.width, title.mode) -------------

// The value at a path ['bg', 'color'] of a plain object, else undefined.
export function getPath(obj, path) {
  let v = obj
  for (const k of path) {
    if (!isDict(v)) return undefined
    v = v[k]
  }
  return v
}

// A copy of obj with the value at `path` set; undefined (or null) removes it,
// and an object left empty by that goes too, so a cleared bg.color leaves no
// empty `bg: {}` behind. The input is not changed.
export function setPath(obj, path, value) {
  const base = isDict(obj) ? obj : {}
  const [k, ...rest] = path
  const out = { ...base }
  if (!rest.length) {
    if (value === undefined || value === null) delete out[k]
    else out[k] = value
    return out
  }
  const child = setPath(base[k], rest, value)
  if (Object.keys(child).length) out[k] = child
  else delete out[k]
  return out
}

// A deep copy of JSON data.
export const cloneJson = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

// 'HH:MM' (24 h) from 'H:MM' or 'HH:MM', else null.
export function normalizeTime(v) {
  if (typeof v !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

// 'HH:MM' -> '7:05 am', for the rule summaries.
export function shortTime(hm) {
  const t = normalizeTime(hm)
  if (!t) return String(hm ?? '')
  const [h, m] = t.split(':').map(Number)
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? ' am' : ' pm'}`
}

// --- hours and times in the house style (the hourRange and timeList fields) ----
//
// The screens' own way of writing a time: '5 am' and '10 pm' on the hour,
// '7:30 am' off it, 'Noon', and 'Midnight' for 0 and 24 (the end of the day).

// Minutes of the day (0..1439) -> '7 am', '7:30 am', 'Noon', 'Midnight'.
function clockLabel(minutes) {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  if (m === 0 && h === 0) return 'Midnight'
  if (m === 0 && h === 12) return 'Noon'
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`
}

// An hour of the day (0..24, a fraction for the minutes) in the house style:
// 5 -> '5 am', 12 -> 'Noon', 22 -> '10 pm', 24 -> 'Midnight', 8.5 -> '8:30 am'.
export function hourLabel(h) {
  const n = toNum(h)
  if (!Number.isFinite(n)) return ''
  return clockLabel(((Math.round(n * 60) % 1440) + 1440) % 1440)
}

// Two hours as a window: '8 am to 10 pm'.
export const hourRangeText = (a, b) => `${hourLabel(a)} to ${hourLabel(b)}`

// Where a track from lo to hi hours gets a label: both ends, and every 6, 3,
// 2 or 1 hours between (the widest spacing that still gives a mark or three),
// none closer than half a spacing to an end. -> [{ h, label }]
export function hourTicks(lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return []
  const span = hi - lo
  const every = [6, 3, 2, 1].find((s) => span / s >= 3) ?? 1
  const out = [{ h: lo, label: hourLabel(lo) }]
  for (let h = Math.ceil(lo / every) * every; h < hi; h += every) {
    if (h - lo >= every / 2 && hi - h >= every / 2) out.push({ h, label: hourLabel(h) })
  }
  out.push({ h: hi, label: hourLabel(hi) })
  return out
}

// A time list: 24-hour 'H:MM' times, comma-separated ('7:30,12:00,17:45').
// Written normalised: 'H:MM' (no leading zero on the hour), in time order,
// each once, joined by ','. Read leniently: spaces, a leading zero and empty
// parts (a stray comma) are fine. Anything else is not a time list.
const LIST_TIME_RE = /^(\d{1,2}):(\d{2})$/

// Minutes of the day from 'H:MM' or 'HH:MM', else null.
export function timeMinutes(v) {
  const m = typeof v === 'string' ? LIST_TIME_RE.exec(v.trim()) : null
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

// Minutes of the day -> 'H:MM' ('7:05', '17:45', '0:00').
export const timeText = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

// 'H:MM' -> the house style: '7:30 am', '7 am', 'Noon', 'Midnight'; the input
// as it is when it is not a time.
export function timeLabel(v) {
  const m = timeMinutes(v)
  return m == null ? String(v ?? '') : clockLabel(m)
}

// The times in a stored list, as minutes of the day in order, each once; []
// for an empty one; null when it is not a time list.
export function parseTimeList(v) {
  if (v == null) return []
  if (typeof v !== 'string') return null
  const out = []
  for (const part of v.split(',')) {
    if (!part.trim()) continue
    const m = timeMinutes(part)
    if (m == null) return null
    if (!out.includes(m)) out.push(m)
  }
  return out.sort((a, b) => a - b)
}

// Minutes of the day -> the normalised string: in order, each once.
export const timeListText = (list) => [...new Set(list)].sort((a, b) => a - b).map(timeText).join(',')

// A time added to a list (minutes): in order; unchanged when it is already
// there or the list holds `max` already. -> { list, added, reason: null |
// 'duplicate' | 'full' }
export function addToTimeList(list, minutes, max = Infinity) {
  if (list.includes(minutes)) return { list, added: false, reason: 'duplicate' }
  if (list.length >= max) return { list, added: false, reason: 'full' }
  return { list: [...list, minutes].sort((a, b) => a - b), added: true, reason: null }
}
