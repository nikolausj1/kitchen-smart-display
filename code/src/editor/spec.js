// spec.js - the layout spec as the editor sees it: the Contract v1 shape and
// ranges (docs/designs/layout-editor.md), geometry in percent of the canvas,
// and the pure helpers the rest of the editor builds on.
//
// normalizeSpec mirrors the contract on purpose rather than importing the
// app's layoutSpec.js: the editor must write a valid spec whatever the app
// build in the iframe is. Its rules follow that file's normalizeSpec (ranges,
// hundreds for weights, hub paths or http(s) for images, unknown keys
// dropped, at most 100 panels). Positions are percent with 2 decimals; every
// geometric edit goes through whole canvas pixels first (pxRectToPct), so
// nudging 1 px at a time never drifts (2 decimals of percent is under 0.1 px
// on any canvas up to 8192 px).

export const LAYOUT_ID = 'entry'
export const SPEC_VERSION = 1

export const FUNCTIONAL_TYPES = ['clock', 'weather', 'wear', 'airquality', 'headline', 'agenda', 'countdowns']
export const BLOCK_TYPES = ['text', 'image']

export const TYPE_LABELS = {
  clock: 'Clock',
  weather: 'Weather',
  wear: 'What to wear',
  airquality: 'Air quality',
  headline: 'Headline',
  agenda: 'Agenda',
  countdowns: 'Countdowns',
  text: 'Text',
  image: 'Image',
}

export const RANGES = {
  textScale: [0.5, 2],
  opacity: [0.1, 1],
  padding: [0, 3],
  radius: [0, 3],
  size: [0.5, 50], // text block: percent of the canvas height
  weight: [100, 900], // in hundreds; the inspector offers WEIGHTS
  lineHeight: [0.8, 3],
  z: [0, 999],
  canvas: [100, 10000],
  globalTextScale: [0.5, 2],
}
export const BACKGROUNDS = ['none', 'card', 'solid']
export const ALIGNS = ['start', 'center', 'end']
export const WEIGHTS = [300, 400, 600, 700]
export const FITS = ['contain', 'cover']
export const MAX_PANELS = 100

export const UNIVERSAL_DEFAULTS = { textScale: 1, opacity: 1, padding: 1, background: 'none', radius: 1, align: 'start' }
export const TEXT_DEFAULTS = { text: '', size: 4, weight: 600, color: '#f2f2f0', align: 'center', lineHeight: 1.15 }
export const IMAGE_DEFAULTS = { src: '', fit: 'contain' }
// What a new text block says, so it is visible before it is edited.
export const NEW_TEXT = 'Text'

// New blocks, centred on the canvas (percent).
export const NEW_BLOCK_SIZE = { text: { w: 30, h: 8 }, image: { w: 15, h: 25 } }

// Smallest panel, percent of the canvas, when the app's ready message names none.
export const DEFAULT_MIN_PCT = 4
const TEXT_MAX = 2000
const SRC_MAX = 2048

export const isDict = (v) => v != null && typeof v === 'object' && !Array.isArray(v)
export const round2 = (n) => Math.round(n * 100) / 100
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

function num(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)

// A viewport or canvas size the editor can use (the hub's screen report,
// the app's messages), or null.
export function normalizeCanvas(c) {
  if (!isDict(c)) return null
  const w = Math.round(Number(c.w))
  const h = Math.round(Number(c.h))
  return w >= 1 && w <= 10000 && h >= 1 && h <= 10000 ? { w, h } : null
}

// #rgb, #rgba, #rrggbb or #rrggbbaa, lowercased, as written.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
export function normalizeColor(v, fallback = TEXT_DEFAULTS.color) {
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

// A hub path ('/countdown-art/<file>', resolved against the hub by the app)
// or an http(s) URL; else ''.
export function normalizeSrc(v) {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  if (!s || s.length > SRC_MAX) return ''
  if (s[0] === '/' && s[1] !== '/') return s
  if (/^https?:\/\/\S+$/i.test(s)) return s
  return ''
}

const BLOCK_ID_RE = { text: /^text-[0-9a-f]{4}$/, image: /^image-[0-9a-f]{4}$/ }

const hex4 = (n) => (n & 0xffff).toString(16).padStart(4, '0')

// A fresh block id. Event handlers only: Math.random has no place in render.
export function newBlockId(type, taken) {
  for (let i = 0; i < 1000; i++) {
    const id = `${type}-${hex4(Math.floor(Math.random() * 0x10000))}`
    if (!taken.has(id)) return id
  }
  throw new Error('no free block id')
}

// A replacement for a missing, malformed or duplicate block id. Deterministic,
// so normalizing the same input twice gives the same spec.
function stableBlockId(type, taken, seed) {
  for (let i = 0; i < 0x10000; i++) {
    const id = `${type}-${hex4(seed + i)}`
    if (!taken.has(id)) return id
  }
  throw new Error('no free block id')
}

// Universal props first, then the block's own; unknown keys are dropped (as
// the app drops them on read). Missing ones are filled with the generic
// defaults: the app fills a functional panel's from the built-in board
// instead, which only differs for a hand-written spec (the editor always
// writes every prop).
function normalizeProps(type, raw) {
  const p = isDict(raw) ? raw : {}
  const d = type === 'text' ? { ...UNIVERSAL_DEFAULTS, align: TEXT_DEFAULTS.align } : UNIVERSAL_DEFAULTS
  const out = {
    textScale: round2(num(p.textScale, ...RANGES.textScale, d.textScale)),
    opacity: round2(num(p.opacity, ...RANGES.opacity, d.opacity)),
    padding: round2(num(p.padding, ...RANGES.padding, d.padding)),
    background: oneOf(p.background, BACKGROUNDS, d.background),
    radius: round2(num(p.radius, ...RANGES.radius, d.radius)),
    align: oneOf(p.align, ALIGNS, d.align),
  }
  if (type === 'text') {
    out.text =
      typeof p.text === 'string'
        ? p.text.slice(0, TEXT_MAX)
        : typeof p.text === 'number' && Number.isFinite(p.text)
          ? String(p.text)
          : TEXT_DEFAULTS.text
    out.size = round2(num(p.size, ...RANGES.size, TEXT_DEFAULTS.size))
    out.weight = Math.round(Math.round(num(p.weight, ...RANGES.weight, TEXT_DEFAULTS.weight)) / 100) * 100
    out.color = normalizeColor(p.color)
    out.lineHeight = round2(num(p.lineHeight, ...RANGES.lineHeight, TEXT_DEFAULTS.lineHeight))
  } else if (type === 'image') {
    out.src = normalizeSrc(p.src)
    out.fit = oneOf(p.fit, FITS, IMAGE_DEFAULTS.fit)
  }
  return out
}

// Percent geometry kept inside the canvas: w and h in [1, 100], x and y so
// the box does not leave it.
function normalizeBox(p) {
  const w = round2(num(p.w, 1, 100, 20))
  const h = round2(num(p.h, 1, 100, 10))
  const x = round2(num(p.x, 0, 100 - w, 0))
  const y = round2(num(p.y, 0, 100 - h, 0))
  return { x, y, w, h }
}

function normalizePanel(raw, index, taken) {
  if (!isDict(raw)) return null
  const type = typeof raw.type === 'string' ? raw.type : typeof raw.id === 'string' && FUNCTIONAL_TYPES.includes(raw.id) ? raw.id : null
  let id
  if (FUNCTIONAL_TYPES.includes(type)) {
    id = type // functional panels: id === type, each at most once
    if (taken.has(id)) return null
  } else if (BLOCK_TYPES.includes(type)) {
    id = typeof raw.id === 'string' && BLOCK_ID_RE[type].test(raw.id) && !taken.has(raw.id)
      ? raw.id
      : stableBlockId(type, taken, index)
  } else {
    return null // unknown type: dropped
  }
  const z = Math.round(num(raw.z, ...RANGES.z, index + 1))
  return {
    id,
    type,
    ...normalizeBox(raw),
    z,
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    props: normalizeProps(type, raw.props),
  }
}

// A valid spec from anything, or null when `raw` is not a spec at all (no
// panels array): null means "the built-in default" in the registry.
export function normalizeSpec(raw, { canvas } = {}) {
  if (!isDict(raw) || !Array.isArray(raw.panels)) return null
  const g = isDict(raw.global) ? raw.global : {}
  const global = { textScale: round2(num(g.textScale, ...RANGES.globalTextScale, 1)) }
  const taken = new Set()
  const panels = []
  raw.panels.slice(0, MAX_PANELS).forEach((p, i) => {
    const n = normalizePanel(p, i, taken)
    if (n) {
      taken.add(n.id)
      panels.push(n)
    }
  })
  const c = normalizeCanvas(raw.canvas) || normalizeCanvas(canvas) || { w: 1920, h: 1080 }
  return {
    version: SPEC_VERSION,
    canvas: { w: clamp(c.w, ...RANGES.canvas), h: clamp(c.h, ...RANGES.canvas) },
    global,
    panels,
  }
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

// Same layout? `canvas` is informational (what it was drawn on), so it does
// not count.
export function sameLayout(a, b) {
  if (!a || !b) return a === b
  const na = normalizeSpec(a)
  const nb = normalizeSpec(b)
  return deepEqual({ ...na, canvas: null }, { ...nb, canvas: null })
}

// --- geometry --------------------------------------------------------------

// Percent box -> canvas pixels (fractional).
export function pctToPx(p, canvas) {
  return { x: (p.x * canvas.w) / 100, y: (p.y * canvas.h) / 100, w: (p.w * canvas.w) / 100, h: (p.h * canvas.h) / 100 }
}

// Percent box -> whole canvas pixels, what the readouts and fields show.
export function pctToPxRound(p, canvas) {
  const r = pctToPx(p, canvas)
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
}

// Whole-pixel box -> percent, 2 decimals.
export function pxRectToPct(r, canvas) {
  return {
    x: round2((r.x / canvas.w) * 100),
    y: round2((r.y / canvas.h) * 100),
    w: round2((r.w / canvas.w) * 100),
    h: round2((r.h / canvas.h) * 100),
  }
}

// A gesture's result back to percent, converting only the fields that moved
// in pixels: a plain move must not re-round the width and height through
// whole pixels (30.63% of 1080 is 330.8 px, and 331 px is 30.65%).
export function pxToPctKeeping(startPct, startPx, rect, canvas) {
  const pct = pxRectToPct(rect, canvas)
  return {
    x: rect.x === startPx.x ? startPct.x : pct.x,
    y: rect.y === startPx.y ? startPct.y : pct.y,
    w: rect.w === startPx.w ? startPct.w : pct.w,
    h: rect.h === startPx.h ? startPct.h : pct.h,
  }
}

// Minimum size in percent per type: from the app's ready message
// (panelTypes: ['clock', ...] or [{ type, minW, minH } | { type, min: { w, h } }]),
// else DEFAULT_MIN_PCT. Also picks up friendlier labels when the app sends them.
export function panelTypeInfo(panelTypes) {
  const mins = {}
  const labels = {}
  if (Array.isArray(panelTypes)) {
    for (const t of panelTypes) {
      if (!isDict(t)) continue
      const type = typeof t.type === 'string' ? t.type : typeof t.id === 'string' ? t.id : null
      if (!type) continue
      const w = Number(t.minW ?? t.min?.w)
      const h = Number(t.minH ?? t.min?.h)
      mins[type] = {
        w: Number.isFinite(w) && w > 0 ? clamp(w, 0.5, 100) : DEFAULT_MIN_PCT,
        h: Number.isFinite(h) && h > 0 ? clamp(h, 0.5, 100) : DEFAULT_MIN_PCT,
      }
      if (typeof t.label === 'string' && t.label.trim()) labels[type] = t.label.trim()
    }
  }
  return { mins, labels }
}

export const minPctFor = (type, mins) => mins?.[type] || { w: DEFAULT_MIN_PCT, h: DEFAULT_MIN_PCT }

// Panels front to back (highest z first; later in the array wins a tie, as
// in the DOM).
export function frontToBack(panels) {
  return panels
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.z - a.p.z || b.i - a.i)
    .map(({ p }) => p)
}

// Re-stack from an id order, front first: z = N .. 1.
export function restack(panels, frontFirstIds) {
  const n = frontFirstIds.length
  const zOf = new Map(frontFirstIds.map((id, i) => [id, n - i]))
  return panels.map((p) => (zOf.has(p.id) ? { ...p, z: zOf.get(p.id) } : p))
}

export function panelLabel(p, labels) {
  const base = labels?.[p.type] || TYPE_LABELS[p.type] || p.type
  if (p.type === 'text') {
    const t = String(p.props?.text || '').replace(/\s+/g, ' ').trim()
    return t ? `${base}: ${t.length > 22 ? `${t.slice(0, 21)}…` : t}` : base
  }
  if (p.type === 'image') {
    const src = String(p.props?.src || '')
    const file = src.split('/').pop()
    return file ? `${base}: ${decodeURIComponentSafe(file).slice(0, 22)}` : `${base} (empty)`
  }
  return base
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// A new block, centred, on top of everything.
export function makeBlock(type, spec, id) {
  const size = NEW_BLOCK_SIZE[type]
  const z = spec.panels.reduce((m, p) => Math.max(m, p.z), 0) + 1
  return {
    id,
    type,
    x: round2((100 - size.w) / 2),
    y: round2((100 - size.h) / 2),
    w: size.w,
    h: size.h,
    z,
    hidden: false,
    locked: false,
    props: normalizeProps(type, type === 'text' ? { ...TEXT_DEFAULTS, text: NEW_TEXT } : { ...IMAGE_DEFAULTS }),
  }
}

// The backdrop lives on the screen's display settings, not in the spec.
export const BACKDROP_DIM_MAX = 0.9
export function readBackdrop(display) {
  const d = isDict(display) ? display : {}
  return {
    entryBackdrop: d.entryBackdrop === 'black' ? 'black' : 'photos',
    entryDim: round2(num(d.entryDim, 0, BACKDROP_DIM_MAX, 0.5)),
  }
}
