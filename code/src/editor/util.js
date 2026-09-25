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
