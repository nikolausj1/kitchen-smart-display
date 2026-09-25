// spec.js - the layout spec as the editor sees it: the Contract v1 and v2
// shape and ranges (docs/designs/layout-editor.md), geometry in percent of the
// canvas, and the pure helpers the rest of the editor builds on.
//
// normalizeSpec mirrors the contract on purpose rather than importing the
// app's layoutSpec.js: the editor must write a valid spec whatever the app
// build in the iframe is. Its rules follow that file's normalizeSpec (ranges,
// hundreds for weights, hub paths or http(s) for images, at most 100 panels);
// knob props are validated against the panel schemas (schema.js) rather than
// dropped. Positions are percent with 2 decimals; every geometric edit goes
// through whole canvas pixels first (pxRectToPct), so nudging 1 px at a time
// never drifts (2 decimals of percent is under 0.1 px on any canvas up to
// 8192 px).
//
// v2 (steps 3 and 4) adds, all optional:
//   eveningFrom   hour the Evening variant starts
//   variants      { morning | evening | weekend: { panels, global? } }
// and the full panel type registry. The base panels and global are "Day".

import { cleanKnob, isPlainValue, knobFields, UNIVERSAL_KEYS } from './schema.js'
import { clamp, colorForWell, deepEqual, isDict, normalizeColor as colorOr, round2, toNum } from './util.js'

export { clamp, colorForWell, deepEqual, isDict, round2 }

export const SPEC_VERSION = 2

// --- layouts and day parts ----------------------------------------------------

export const LAYOUTS = [
  { id: 'entry', label: 'Entry board', variants: true, backdrop: true },
  { id: 'board', label: 'Board', variants: false, backdrop: false },
]
export const DEFAULT_LAYOUT_ID = 'entry'
export const isLayoutId = (id) => LAYOUTS.some((l) => l.id === id)
export const layoutMeta = (id) => LAYOUTS.find((l) => l.id === id) || LAYOUTS[0]

// 'day' is the base (spec.panels / spec.global); the others are variants.
export const DAYPARTS = ['day', 'morning', 'evening', 'weekend']
export const VARIANT_PARTS = ['morning', 'evening', 'weekend']
export const DAYPART_LABELS = { day: 'Day', morning: 'Morning', evening: 'Evening', weekend: 'Weekend' }
export const EVENING_DEFAULT = 18
export const EVENING_RANGE = [12, 23]

// When each variant is on show (resolveDaypart in the app's layoutSpec.js).
export function partWhen(part, eveningFrom) {
  if (part === 'morning') return 'during a school morning'
  if (part === 'evening') return `from ${eveningFrom ?? EVENING_DEFAULT}:00 until midnight`
  if (part === 'weekend') return 'on Saturdays and Sundays'
  return 'the rest of the time'
}

// --- panel types -----------------------------------------------------------------

// Functional panels (unique per layout, id === type) and blocks (any number).
// The app's sd-edit:ready may name more; registerPanelTypes adds them.
const BUILTIN_FUNCTIONAL = [
  'clock',
  'weather',
  'forecast',
  'sunmoon',
  'wear',
  'airquality',
  'headline',
  'agenda',
  'countdowns',
  'departure',
  'nowplaying',
  'photo',
  'school',
]
export const BLOCK_TYPES = ['text', 'image']
const functional = new Set(BUILTIN_FUNCTIONAL)
export const isFunctionalType = (t) => functional.has(t)

export const TYPE_LABELS = {
  clock: 'Clock',
  weather: 'Weather',
  forecast: 'Forecast',
  sunmoon: 'Sun and moon',
  wear: 'What to wear',
  airquality: 'Air quality',
  headline: 'Headline',
  agenda: 'Agenda',
  countdowns: 'Countdowns',
  departure: 'Departure',
  nowplaying: 'Now playing',
  photo: 'Photo',
  school: 'School',
  text: 'Text',
  image: 'Image',
}

// sd-edit:ready's panelTypes: [{ type, unique | kind: 'panel' }]. Types the
// editor did not know become functional panels too (never dropped on save).
export function registerPanelTypes(list) {
  if (!Array.isArray(list)) return
  for (const t of list) {
    if (!isDict(t) || typeof t.type !== 'string' || BLOCK_TYPES.includes(t.type)) continue
    if (t.unique === true || t.kind === 'panel') functional.add(t.type)
  }
}

export const RANGES = {
  textScale: [0.5, 2],
  opacity: [0.1, 1],
  padding: [0, 3],
  radius: [0, 3],
  size: [0.5, 50], // text block: percent of the canvas height
  weight: [100, 900], // in hundreds
  lineHeight: [0.8, 3],
  z: [0, 999],
  canvas: [100, 10000],
  globalTextScale: [0.5, 2],
}
export const BACKGROUNDS = ['none', 'card', 'solid']
export const ALIGNS = ['start', 'center', 'end']
export const SCRIMS = ['none', 'soft', 'strong']
export const FITS = ['contain', 'cover']
export const MAX_PANELS = 100

export const UNIVERSAL_DEFAULTS = { textScale: 1, opacity: 1, padding: 1, background: 'none', radius: 1, align: 'start' }
export const TEXT_DEFAULTS = { text: '', size: 4, weight: 600, color: '#f2f2f0', align: 'center', lineHeight: 1.15 }
export const IMAGE_DEFAULTS = { src: '', fit: 'contain' }
const BLOCK_PROP_KEYS = { text: ['text', 'size', 'weight', 'color', 'lineHeight'], image: ['src', 'fit'] }
// What a new text block says, so it is visible before it is edited.
export const NEW_TEXT = 'Text'

// New blocks, centred on the canvas (percent).
export const NEW_BLOCK_SIZE = { text: { w: 30, h: 8 }, image: { w: 15, h: 25 } }

// Smallest panel, percent of the canvas, when the app's ready message names none.
export const DEFAULT_MIN_PCT = 4
const TEXT_MAX = 2000
const SRC_MAX = 2048

function num(v, lo, hi, fallback) {
  const n = toNum(v)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback)

export const normalizeColor = (v, fallback = TEXT_DEFAULTS.color) => colorOr(v, fallback)

// A viewport or canvas size the editor can use (the hub's screen report,
// the app's messages), or null.
export function normalizeCanvas(c) {
  if (!isDict(c)) return null
  const w = Math.round(Number(c.w))
  const h = Math.round(Number(c.h))
  return w >= 1 && w <= 10000 && h >= 1 && h <= 10000 ? { w, h } : null
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

// Universal props first, then a block's own, then the type's knobs: valid
// schema values kept, invalid ones dropped (the schema default applies). A
// type with no schema the editor knows keeps its plain values as they are,
// so nothing the app understands is lost on the way through. Missing
// universal props are filled with the generic defaults (the app fills a
// functional panel's from its built-in board instead, which only differs for
// a hand-written spec: the editor always writes every universal prop).
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
  // scrim (Entry phase 1.5) is kept when valid and otherwise left out, never
  // filled here: the app's normaliser (appSpec.js readSpec) fills it from the
  // layout's own board, so a layout saved before scrims existed shows the
  // Entry board's 'soft' clock and headline, as the screen draws it.
  if (SCRIMS.includes(p.scrim)) out.scrim = p.scrim
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
  const own = new Set([...UNIVERSAL_KEYS, ...(BLOCK_PROP_KEYS[type] || [])])
  const fields = knobFields(type)
  if (fields.length) {
    for (const f of fields) {
      if (own.has(f.key)) continue
      const v = cleanKnob(f, p[f.key])
      if (v !== undefined) out[f.key] = v
    }
  } else {
    for (const k of Object.keys(p)) {
      if (!own.has(k) && k.length <= 64 && isPlainValue(p[k])) out[k] = p[k]
    }
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
  const type =
    typeof raw.type === 'string' ? raw.type : typeof raw.id === 'string' && isFunctionalType(raw.id) ? raw.id : null
  let id
  if (isFunctionalType(type)) {
    id = type // functional panels: id === type, each at most once
    if (taken.has(id)) return null
  } else if (BLOCK_TYPES.includes(type)) {
    id =
      typeof raw.id === 'string' && BLOCK_ID_RE[type].test(raw.id) && !taken.has(raw.id)
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

function normalizePanels(list) {
  const taken = new Set()
  const panels = []
  list.slice(0, MAX_PANELS).forEach((p, i) => {
    const n = normalizePanel(p, i, taken)
    if (n) {
      taken.add(n.id)
      panels.push(n)
    }
  })
  return panels
}

// The base global always carries textScale (v1); the rest (font, accent,
// text, surfaceOpacity, radius) only when set, so an untouched layout keeps
// following its own palette. A variant's global keeps what it has.
function normalizeGlobal(raw, base, globalFieldList) {
  const g = isDict(raw) ? raw : {}
  const out = {}
  if (base || g.textScale !== undefined) out.textScale = round2(num(g.textScale, ...RANGES.globalTextScale, 1))
  for (const f of globalFieldList) {
    if (f.key === 'textScale' || g[f.key] === undefined) continue
    const v = cleanKnob(f, g[f.key])
    if (v !== undefined) out[f.key] = v
  }
  if (!globalFieldList.length) {
    for (const k of Object.keys(g)) if (k !== 'textScale' && k.length <= 64 && isPlainValue(g[k])) out[k] = g[k]
  }
  return out
}

export function normalizeHour(v) {
  const n = toNum(v)
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 23) : null
}

// A valid spec from anything, or null when `raw` is not a spec at all (no
// panels array): null means "the built-in default" in the registry.
// globalFields: the global schema's fields (schema.js globalFields()).
export function normalizeSpec(raw, { canvas, globalFields = [] } = {}) {
  if (!isDict(raw) || !Array.isArray(raw.panels)) return null
  const c = normalizeCanvas(raw.canvas) || normalizeCanvas(canvas) || { w: 1920, h: 1080 }
  const out = {
    version: SPEC_VERSION,
    canvas: { w: clamp(c.w, ...RANGES.canvas), h: clamp(c.h, ...RANGES.canvas) },
    global: normalizeGlobal(raw.global, true, globalFields),
    panels: normalizePanels(raw.panels),
  }
  const ev = normalizeHour(raw.eveningFrom)
  if (ev != null) out.eveningFrom = ev
  if (isDict(raw.variants)) {
    const variants = {}
    for (const part of VARIANT_PARTS) {
      const v = raw.variants[part]
      if (!isDict(v) || !Array.isArray(v.panels)) continue
      const nv = { panels: normalizePanels(v.panels) }
      if (isDict(v.global)) nv.global = normalizeGlobal(v.global, false, globalFields)
      variants[part] = nv
    }
    if (Object.keys(variants).length) out.variants = variants
  }
  return out
}

// --- day parts -------------------------------------------------------------------

// Does the spec have this part? Day always; a variant when it exists.
export const hasPart = (spec, part) => !!spec && (part === 'day' || (isDict(spec.variants?.[part]) && Array.isArray(spec.variants[part].panels)))

// The panels being edited for a part, or null when that part has no variant
// of its own (it shows the Day layout).
export function partPanels(spec, part) {
  if (!spec) return null
  if (part === 'day') return spec.panels
  return hasPart(spec, part) ? spec.variants[part].panels : null
}

// The global a part renders with: the variant's own when it has one.
export function partGlobal(spec, part) {
  if (!spec) return null
  if (part !== 'day' && hasPart(spec, part) && isDict(spec.variants[part].global)) {
    return { ...spec.global, ...spec.variants[part].global }
  }
  return spec.global
}

export const partHasOwnGlobal = (spec, part) => part !== 'day' && hasPart(spec, part) && isDict(spec.variants[part].global)

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

// From the app's ready message (panelTypes: ['clock', ...] or
// [{ type, label, unique, min: { w, h } | minW, minH }]):
//   mins    smallest box per type, percent (else DEFAULT_MIN_PCT)
//   labels  friendlier names
//   types   [{ type, label, unique }] in the app's order, for "Add panel"
export function panelTypeInfo(panelTypes) {
  const mins = {}
  const labels = {}
  const types = []
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
      const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : null
      if (label) labels[type] = label
      const unique = t.unique === true || t.kind === 'panel' || (t.unique == null && t.kind == null && isFunctionalType(type))
      types.push({ type, label: label || TYPE_LABELS[type] || type, unique })
    }
  }
  return { mins, labels, types }
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

export const typeLabel = (type, labels) => labels?.[type] || TYPE_LABELS[type] || type

export function panelLabel(p, labels) {
  const base = typeLabel(p.type, labels)
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

const topZ = (panels) => panels.reduce((m, p) => Math.max(m, p.z), 0) + 1

// A new block, centred, on top of everything.
export function makeBlock(type, panels, id) {
  const size = NEW_BLOCK_SIZE[type]
  return {
    id,
    type,
    x: round2((100 - size.w) / 2),
    y: round2((100 - size.h) / 2),
    w: size.w,
    h: size.h,
    z: Math.min(RANGES.z[1], topZ(panels)),
    hidden: false,
    locked: false,
    props: normalizeProps(type, type === 'text' ? { ...TEXT_DEFAULTS, text: NEW_TEXT } : { ...IMAGE_DEFAULTS }),
  }
}

// A functional panel added back to a layout: twice its minimum size (capped
// to the canvas), centred, on top.
export function makePanel(type, panels, mins) {
  const min = minPctFor(type, mins)
  const w = round2(clamp(min.w * 2, 1, 100))
  const h = round2(clamp(min.h * 2, 1, 100))
  return {
    id: type,
    type,
    x: round2((100 - w) / 2),
    y: round2((100 - h) / 2),
    w,
    h,
    z: Math.min(RANGES.z[1], topZ(panels)),
    hidden: false,
    locked: false,
    props: normalizeProps(type, {}),
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

// The hub's config PATCH deep-merges objects (frameserver/server.mjs
// deepMerge): a key that is gone from the new value survives from the old
// one. So a variant removed in the editor, or a global the new spec no longer
// sets, would come back. withRemovals(old, next) is `next` plus an explicit
// null for every key of `old` that `next` dropped, at every depth where both
// are objects, which the merge then stores as null (and every reader treats as
// absent). Arrays are replaced by the merge anyway.
export function withRemovals(before, after) {
  if (!isDict(before) || !isDict(after)) return after
  const out = { ...after }
  for (const k of Object.keys(before)) {
    if (!Object.prototype.hasOwnProperty.call(after, k)) out[k] = null
    else if (isDict(before[k]) && isDict(after[k])) out[k] = withRemovals(before[k], after[k])
  }
  return out
}
