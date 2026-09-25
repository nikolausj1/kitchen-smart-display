// layoutSpec.js - the layout spec a screen's Entry board is drawn from
// (docs/designs/layout-editor.md, "Contract v1"). Pure: no React, no DOM, no
// clock. The app's renderer (Entry/EntryLayout.jsx) and the editor
// (code/src/editor/) both import it, so a spec means the same thing on both
// sides of the iframe.
//
// A spec, as stored in the device registry at config.layouts.entry:
//
//   { version: 1,
//     canvas: { w, h },            what it was drawn on (informational)
//     global: { textScale },       multiplies every panel's text scale
//     panels: [ { id, type, x, y, w, h, z, hidden, locked, props } ] }
//
// x, y, w, h are PERCENT of the canvas (2 decimals), so a layout drawn at
// 1920x1080 lands in the same place at 1280x800. Canvas pixels are for
// readouts only. null or absent in the registry means "the built-in default".
//
// Runtime rule for this file: it runs on every screen, and Silk on the Echo
// may be as old as Chrome 80 (vite.config.js lowers syntax, not APIs). So no
// Array.prototype.at, Object.hasOwn, structuredClone, String replaceAll.

export const SPEC_VERSION = 1
export const ENTRY_LAYOUT_ID = 'entry'

// --- Panel types ---------------------------------------------------------------
//
// kind 'panel': a functional panel, at most once per spec, id === type.
// kind 'block': free content, any number, ids 'text-<4 hex>' / 'image-<4 hex>'.
//
// min      the smallest box a spec may hold, percent of the canvas. normalizeSpec
//          clamps to it, and the editor's resize should stop there.
// minPx    the smallest content box (inside the box's padding), in CSS
//          pixels, the panel can draw in. Below it the renderer shows a quiet
//          "Too small" instead of overflowing (Entry/SpecPanel.css holds the
//          same numbers as container queries; keep the two in step). null: the
//          content copes at any size (text wraps and clips, an image scales).
//          The default board clears every one of them down to 960x480.
// padShape [y, x] factors of --tl-pad that `padding: 1` means for this type.
//          Every type is [1, 1] except the air quality chip, whose phase 1 card
//          had a thinner vertical padding (0.55) than the panels above it.

const TYPE_TABLE = [
  { type: 'clock', label: 'Clock', kind: 'panel', min: { w: 6, h: 4 }, minPx: { w: 110, h: 40 } },
  { type: 'weather', label: 'Weather', kind: 'panel', min: { w: 10, h: 6 }, minPx: { w: 150, h: 52 } },
  { type: 'wear', label: 'What to wear', kind: 'panel', min: { w: 10, h: 5 }, minPx: { w: 140, h: 40 } },
  {
    type: 'airquality',
    label: 'Air quality',
    kind: 'panel',
    min: { w: 6, h: 3 },
    minPx: { w: 90, h: 22 },
    padShape: [0.55, 1],
  },
  { type: 'headline', label: 'Headline', kind: 'panel', min: { w: 6, h: 2.5 }, minPx: { w: 110, h: 20 } },
  { type: 'agenda', label: 'Agenda', kind: 'panel', min: { w: 14, h: 10 }, minPx: { w: 300, h: 90 } },
  // Also the departure countdown's box during a school morning (as on the phase
  // 1 board), so its minimum covers that panel too.
  { type: 'countdowns', label: 'Countdowns', kind: 'panel', min: { w: 8, h: 10 }, minPx: { w: 140, h: 110 } },
  { type: 'text', label: 'Text', kind: 'block', min: { w: 2, h: 2 }, minPx: null },
  { type: 'image', label: 'Image', kind: 'block', min: { w: 2, h: 2 }, minPx: null },
]

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.keys(o).forEach((k) => deepFreeze(o[k]))
  }
  return o
}

// The list, as sent to the editor in sd-edit:ready (panelTypes).
export const PANEL_TYPE_LIST = deepFreeze(
  TYPE_TABLE.map((t) => ({
    type: t.type,
    label: t.label,
    kind: t.kind,
    unique: t.kind === 'panel',
    min: { ...t.min },
    minPx: t.minPx ? { ...t.minPx } : null,
    padShape: t.padShape ? t.padShape.slice() : [1, 1],
  }))
)

// The same, keyed by type. Look types up with panelType(), which ignores
// inherited keys: a stored type of "constructor" must not find Object's.
export const PANEL_TYPES = deepFreeze(
  PANEL_TYPE_LIST.reduce((acc, t) => {
    acc[t.type] = t
    return acc
  }, {})
)

export const FUNCTIONAL_TYPES = deepFreeze(
  PANEL_TYPE_LIST.filter((t) => t.kind === 'panel').map((t) => t.type)
)
export const BLOCK_TYPES = deepFreeze(PANEL_TYPE_LIST.filter((t) => t.kind === 'block').map((t) => t.type))

function has(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k)
}

// The type's entry from PANEL_TYPES, or null for anything else.
export function panelType(type) {
  return typeof type === 'string' && has(PANEL_TYPES, type) ? PANEL_TYPES[type] : null
}

function isBlockType(type) {
  return type === 'text' || type === 'image'
}

// A spec is polled by every screen every 10 s: a runaway one stops here.
export const MAX_PANELS = 100

// --- Props -------------------------------------------------------------------

export const BACKGROUNDS = ['none', 'card', 'solid']
export const ALIGNS = ['start', 'center', 'end']
export const FITS = ['contain', 'cover']

// Ranges the normalizer clamps to, and the editor's controls can offer.
export const PROP_RANGES = deepFreeze({
  textScale: { min: 0.5, max: 2 },
  opacity: { min: 0.1, max: 1 },
  padding: { min: 0, max: 3 },
  radius: { min: 0, max: 3 },
  // Text block: percent of the canvas height (4 = 4vh in the app).
  size: { min: 0.5, max: 50 },
  weight: { min: 100, max: 900 },
  lineHeight: { min: 0.8, max: 3 },
  z: { min: 0, max: 999 },
  canvas: { min: 100, max: 10000 },
})

export const TEXT_MAX_LENGTH = 2000
export const SRC_MAX_LENGTH = 2048

// Universal props every panel carries (all optional in a stored spec).
//   textScale  multiplies the panel's font sizes (times global.textScale)
//   opacity    of the whole box
//   padding    multiplier of --tl-pad (see padShape)
//   background 'none' | 'card' (the translucent card over a photo, the dark
//              card on black) | 'solid' (the dark card, over a photo too)
//   radius     multiplier of --tl-radius (drawn when there is a background,
//              and always on an image block)
//   align      'start' | 'center' | 'end': text alignment (the clock, the
//              headline and text blocks honour it in v1)
export const UNIVERSAL_DEFAULTS = deepFreeze({
  textScale: 1,
  opacity: 1,
  padding: 1,
  background: 'none',
  radius: 1,
  align: 'start',
})

// A text block. size = percent of the canvas height.
export const TEXT_DEFAULTS = deepFreeze({
  text: '',
  size: 4,
  weight: 600,
  color: '#f2f2f0',
  align: 'center',
  lineHeight: 1.15,
})

// An image block. src: a hub path ('/countdown-art/<file>'), resolved against
// the hub by the renderer, or an http(s) URL used as is.
export const IMAGE_DEFAULTS = deepFreeze({
  src: '',
  fit: 'contain',
})

// --- The default Entry board ---------------------------------------------------
//
// The phase 1 board (Entry/EntryLayout.css before the editor), expressed in
// percent. That board was a CSS grid inside a 3vh / 2.4vw margin with
// clamp(10px, 1.1vw, 24px) gaps: columns 58fr / 42fr, rows 34fr / 11fr / 55fr,
// and the top-right card split 48 / 34 / 18 between weather, what to wear and
// air quality. Measured (x, y  w x h, CSS px):
//
//               1920x1080                     1280x800
//   clock       46.1,  32.4  1047.9 x 330.8    30.7,  24.0  698.6 x 246.1
//   headline    46.1, 384.3  1047.9 x 107.0    30.7, 284.2  698.6 x  79.6
//   weather   1115.1,  32.4   758.8 x 220.3   743.4,  24.0  505.9 x 163.1
//   wear      1115.1, 252.7   758.8 x 156.0   743.4, 187.1  505.9 x 115.5
//   air       1115.1, 408.7   758.8 x  82.6   743.4, 302.6  505.9 x  61.2
//   agenda      46.1, 512.5  1047.9 x 535.1    30.7, 377.9  698.6 x 398.1
//   countdown 1115.1, 512.5   758.8 x 535.1   743.4, 377.9  505.9 x 398.1
//
// Horizontally the grid is proportional (the gap is in vw), so x and w are
// the same percentages at both sizes (2.4 / 54.58, 58.08 / 39.52) and land
// within 0.04 px. Vertically the vw gap is a different share of the height at
// each size (1.96% vs 1.76%), so a row after a gap cannot sit in the same
// percent place at both: the agenda's top is 47.451% at 1080 and 47.236% at
// 800, and no one value is within half a pixel of both. The numbers below are
// the 1920x1080 grid (the Echo Show 15, the screen the board was drawn for and
// the one running it): every edge within 0.05 px there, so that screen looks
// exactly as before. At 1280x800 every edge is within 1.71 px (the agenda and
// countdown tops, +1.71; the clock's bottom, -1.07; the headline, +0.53; the
// outside card within 0.16).
//
// weather, wear and airquality are three cards stacked flush: the renderer
// joins flush cards into one (cardJoins below, Entry/SpecPanel), which is the
// phase 1 look of a single card divided by hairlines.
const DEFAULT_PANELS = [
  {
    id: 'clock', type: 'clock', x: 2.4, y: 3, w: 54.58, h: 30.63, z: 1,
    props: { background: 'none', padding: 0 },
  },
  {
    id: 'headline', type: 'headline', x: 2.4, y: 35.59, w: 54.58, h: 9.91, z: 2,
    props: { background: 'none', padding: 0 },
  },
  {
    id: 'weather', type: 'weather', x: 58.08, y: 3, w: 39.52, h: 20.4, z: 3,
    props: { background: 'card', padding: 1 },
  },
  {
    id: 'wear', type: 'wear', x: 58.08, y: 23.4, w: 39.52, h: 14.45, z: 4,
    props: { background: 'card', padding: 1 },
  },
  {
    id: 'airquality', type: 'airquality', x: 58.08, y: 37.85, w: 39.52, h: 7.65, z: 5,
    props: { background: 'card', padding: 1 },
  },
  {
    id: 'agenda', type: 'agenda', x: 2.4, y: 47.45, w: 54.58, h: 49.55, z: 6,
    props: { background: 'card', padding: 1 },
  },
  // The countdown tiles are their own cards, and so is the departure panel
  // that takes this box on a school morning, so the box itself draws nothing.
  {
    id: 'countdowns', type: 'countdowns', x: 58.08, y: 47.45, w: 39.52, h: 49.55, z: 7,
    props: { background: 'none', padding: 0 },
  },
]

// Where a block lands when nothing says otherwise: centred, clear of the edges.
const BLOCK_BOXES = {
  text: { x: 30, y: 44, w: 40, h: 12 },
  image: { x: 40, y: 32, w: 20, h: 36 },
}

// Blocks added by the editor sit above the built-in panels (z 1..7).
const BLOCK_Z = 10

// --- Small helpers ---------------------------------------------------------

function isDict(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function toNum(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

function round(v, places) {
  const f = places === 2 ? 100 : Math.pow(10, places)
  // + 0 turns a -0 into 0, so a clamp at zero never serialises as "-0".
  return Math.round(v * f) / f + 0
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

// A finite number clamped into [lo, hi], else the fallback (itself clamped).
function num(v, lo, hi, fallback, places = 2) {
  const n = toNum(v)
  const base = Number.isFinite(n) ? n : fallback
  return round(clamp(base, lo, hi), places)
}

function oneOf(v, allowed, fallback) {
  return allowed.indexOf(v) >= 0 ? v : fallback
}

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function color(v, fallback) {
  if (typeof v !== 'string') return fallback
  const s = v.trim()
  return HEX_COLOR_RE.test(s) ? s.toLowerCase() : fallback
}

// Hub paths and http(s) URLs only: the spec lives in devices.json, which every
// screen polls, so data: URIs (and anything stranger) stay out.
function imageSrc(v) {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  if (!s || s.length > SRC_MAX_LENGTH) return ''
  if (s.charAt(0) === '/' && s.charAt(1) !== '/') return s
  if (/^https?:\/\/[^\s]+$/i.test(s)) return s
  return ''
}

function text(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return ''
  return v.length > TEXT_MAX_LENGTH ? v.slice(0, TEXT_MAX_LENGTH) : v
}

// FNV-1a, 32 bit. Deterministic ids for blocks whose id is malformed, so
// normalizeSpec stays a pure function (the same bad input, the same repair).
function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function hex4(n) {
  return ('0000' + (n & 0xffff).toString(16)).slice(-4)
}

const BLOCK_ID_RE = /^(text|image)-[0-9a-f]{4}$/

// 'text-3fa9' for a text block, 'image-09c1' for an image block.
export function isValidBlockId(type, id) {
  return isBlockType(type) && typeof id === 'string' && BLOCK_ID_RE.test(id) && id.indexOf(`${type}-`) === 0
}

function repairedBlockId(type, seed, taken) {
  let h = hash32(seed)
  for (let i = 0; i < 0x10000; i++) {
    const id = `${type}-${hex4(h + i)}`
    if (!taken.has(id)) return id
  }
  return `${type}-0000` // 65536 blocks of one type: not a real spec
}

// --- Defaults per type -------------------------------------------------------

const DEFAULT_BY_TYPE = DEFAULT_PANELS.reduce((acc, p) => {
  acc[p.type] = p
  return acc
}, {})

// The full default props for a type: what a missing prop is filled with. A
// functional panel's defaults are its props on the default board (the agenda
// is a card, the clock bare text), so a hand-written spec that says less still
// looks like the board it came from.
export function defaultPropsFor(type) {
  if (type === 'text') return { ...UNIVERSAL_DEFAULTS, ...TEXT_DEFAULTS }
  if (type === 'image') return { ...UNIVERSAL_DEFAULTS, ...IMAGE_DEFAULTS }
  const d = has(DEFAULT_BY_TYPE, type) ? DEFAULT_BY_TYPE[type] : null
  return { ...UNIVERSAL_DEFAULTS, ...(d ? d.props : null) }
}

function defaultBoxFor(type) {
  if (has(DEFAULT_BY_TYPE, type)) {
    const d = DEFAULT_BY_TYPE[type]
    return { x: d.x, y: d.y, w: d.w, h: d.h, z: d.z }
  }
  const b = has(BLOCK_BOXES, type) ? BLOCK_BOXES[type] : { x: 10, y: 10, w: 20, h: 20 }
  return { ...b, z: BLOCK_Z }
}

// --- Normalizing ---------------------------------------------------------------

function normProps(raw, type) {
  const r = isDict(raw) ? raw : {}
  const d = defaultPropsFor(type)
  const out = {
    textScale: num(r.textScale, PROP_RANGES.textScale.min, PROP_RANGES.textScale.max, d.textScale),
    opacity: num(r.opacity, PROP_RANGES.opacity.min, PROP_RANGES.opacity.max, d.opacity),
    padding: num(r.padding, PROP_RANGES.padding.min, PROP_RANGES.padding.max, d.padding),
    background: oneOf(r.background, BACKGROUNDS, d.background),
    radius: num(r.radius, PROP_RANGES.radius.min, PROP_RANGES.radius.max, d.radius),
    align: oneOf(r.align, ALIGNS, d.align),
  }
  if (type === 'text') {
    out.text = r.text === undefined ? d.text : text(r.text)
    out.size = num(r.size, PROP_RANGES.size.min, PROP_RANGES.size.max, d.size)
    // Font weights come in hundreds.
    out.weight = Math.round(num(r.weight, PROP_RANGES.weight.min, PROP_RANGES.weight.max, d.weight, 0) / 100) * 100
    out.color = color(r.color, d.color)
    out.lineHeight = num(r.lineHeight, PROP_RANGES.lineHeight.min, PROP_RANGES.lineHeight.max, d.lineHeight)
  } else if (type === 'image') {
    out.src = imageSrc(r.src)
    out.fit = oneOf(r.fit, FITS, d.fit)
  }
  return out
}

// One panel, or null when it cannot be one (unknown type). The id is decided
// by the caller (functional: the type; block: validated or repaired).
function normPanel(raw, type, id) {
  const t = panelType(type)
  const box = defaultBoxFor(type)
  // Size first, so the position can be clamped to keep the whole box on the
  // canvas: 0 <= x, x + w <= 100, and the same vertically.
  const w = num(raw.w, t.min.w, 100, box.w)
  const h = num(raw.h, t.min.h, 100, box.h)
  const x = num(raw.x, 0, round(100 - w, 2), box.x)
  const y = num(raw.y, 0, round(100 - h, 2), box.y)
  return {
    id,
    type,
    x,
    y,
    w,
    h,
    z: num(raw.z, PROP_RANGES.z.min, PROP_RANGES.z.max, box.z, 0),
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    props: normProps(raw.props, type),
  }
}

function normCanvas(raw, fallback) {
  const r = isDict(raw) ? raw : {}
  const f = isDict(fallback) ? fallback : { w: 1920, h: 1080 }
  const lo = PROP_RANGES.canvas.min
  const hi = PROP_RANGES.canvas.max
  return {
    w: num(r.w, lo, hi, num(f.w, lo, hi, 1920, 0), 0),
    h: num(r.h, lo, hi, num(f.h, lo, hi, 1080, 0), 0),
  }
}

// normalizeSpec(raw, { defaultSpec }) -> a valid spec, from anything.
//
//   - not an object, or no panels array: a fresh copy of defaultSpec
//     (DEFAULT_ENTRY_SPEC unless given; pass null to get null back instead)
//   - version forced to 1; canvas and global filled and clamped
//   - panels: unknown types dropped; a functional type kept once (the first),
//     its id forced to its type; a block whose id is malformed or already
//     taken gets a fresh, deterministic 'text-xxxx' / 'image-xxxx'
//   - every number clamped to the contract's range and rounded (positions to 2
//     decimals), each box kept on the canvas at no less than its type's
//     minimum size; missing props filled from the type's defaults; unknown
//     keys dropped
//
// Pure and deterministic, and idempotent: normalizeSpec(normalizeSpec(x))
// equals normalizeSpec(x). Always returns new objects (callers may mutate).
export function normalizeSpec(raw, options) {
  const defaultSpec = isDict(options) && has(options, 'defaultSpec') ? options.defaultSpec : DEFAULT_ENTRY_SPEC
  if (!isDict(raw) || !Array.isArray(raw.panels)) {
    return defaultSpec ? normalizeSpec(defaultSpec, { defaultSpec: null }) : null
  }

  const source = raw.panels.slice(0, MAX_PANELS)
  const panels = []
  const seenFunctional = new Set()
  // Valid block ids are claimed first, so a repaired id can never steal one
  // that a later block legitimately carries.
  const takenIds = new Set()
  source.forEach((p) => {
    if (isDict(p) && isValidBlockId(p.type, p.id)) takenIds.add(p.id)
  })

  const usedBlockIds = new Set()
  source.forEach((p, index) => {
    if (!isDict(p)) return
    const type = typeof p.type === 'string' ? p.type : ''
    const t = panelType(type)
    if (!t) return // unknown type: dropped
    let id
    if (t.kind === 'panel') {
      if (seenFunctional.has(type)) return // a second clock: the first wins
      seenFunctional.add(type)
      id = type
    } else if (isValidBlockId(type, p.id) && !usedBlockIds.has(p.id)) {
      id = p.id
    } else {
      id = repairedBlockId(type, `${type}:${index}:${typeof p.id === 'string' ? p.id : ''}`, takenIds)
      takenIds.add(id)
    }
    if (t.kind === 'block') usedBlockIds.add(id)
    panels.push(normPanel(p, type, id))
  })

  const g = isDict(raw.global) ? raw.global : {}
  return {
    version: SPEC_VERSION,
    canvas: normCanvas(raw.canvas, defaultSpec && defaultSpec.canvas),
    global: {
      textScale: num(g.textScale, PROP_RANGES.textScale.min, PROP_RANGES.textScale.max, 1),
    },
    panels,
  }
}

// The built-in board, normalized (every prop present) and frozen: copy it
// (normalizeSpec(DEFAULT_ENTRY_SPEC) returns a fresh copy) before editing.
export const DEFAULT_ENTRY_SPEC = deepFreeze(
  normalizeSpec(
    {
      version: SPEC_VERSION,
      canvas: { w: 1920, h: 1080 },
      global: { textScale: 1 },
      panels: DEFAULT_PANELS,
    },
    { defaultSpec: null }
  )
)

// --- Building and comparing ------------------------------------------------

function randomHex4() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return hex4(crypto.getRandomValues(new Uint16Array(1))[0])
    }
  } catch {
    // fall through
  }
  return hex4(Math.floor(Math.random() * 0x10000))
}

// newBlock('text' | 'image', overrides, takenIds?) -> a new, normalized block
// with a fresh random id ('text-3fa9'). overrides may set any panel field and
// any props (merged over the type's defaults); overrides.id is ignored. A new
// text block reads "Text" so it is visible before it is edited. takenIds (a
// Set or an array) keeps the id clear of blocks already in the spec.
// Returns null for a type that is not a block.
export function newBlock(type, overrides, takenIds) {
  if (!isBlockType(type)) return null
  const o = isDict(overrides) ? overrides : {}
  const taken = takenIds instanceof Set ? takenIds : new Set(Array.isArray(takenIds) ? takenIds : [])
  let id = `${type}-${randomHex4()}`
  for (let i = 0; i < 64 && taken.has(id); i++) id = `${type}-${randomHex4()}`
  if (taken.has(id)) id = repairedBlockId(type, `${type}:new:${taken.size}`, taken)
  const box = defaultBoxFor(type)
  const seed = type === 'text' ? { text: 'Text' } : {}
  return normPanel(
    { ...box, hidden: false, locked: false, ...o, props: { ...seed, ...(isDict(o.props) ? o.props : null) } },
    type,
    id
  )
}

// Structural equality: same keys, same values, arrays in order. For "has the
// draft changed since the last save", normalize both sides first.
export function specEquals(a, b) {
  if (a === b) return true
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
  const aArr = Array.isArray(a)
  if (aArr !== Array.isArray(b)) return false
  if (aArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!specEquals(a[i], b[i])) return false
    return true
  }
  const ak = Object.keys(a)
  if (ak.length !== Object.keys(b).length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!specEquals(a[k], b[k])) return false
  }
  return true
}

// The effective text scale of one panel: global x its own. Both default to 1.
export function layoutTextScale(spec, panel) {
  const g = toNum(spec && spec.global && spec.global.textScale)
  const p = toNum(panel && panel.props && panel.props.textScale)
  return round((Number.isFinite(g) ? g : 1) * (Number.isFinite(p) ? p : 1), 4)
}

// --- Rendering helpers (pure) ------------------------------------------------

// The panels to draw, bottom to top: hidden ones dropped, sorted by z with the
// spec's own order breaking ties (so DOM order is paint order).
export function visiblePanels(spec) {
  const list = spec && Array.isArray(spec.panels) ? spec.panels : []
  return list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p && !p.hidden)
    .sort((a, b) => a.p.z - b.p.z || a.i - b.i)
    .map(({ p }) => p)
}

// Two cards stacked flush (same left edge, same width, one's bottom on the
// other's top, the same background) draw as ONE card divided by a hairline:
// the phase 1 "outside" card (weather, what to wear, air quality) is three such
// panels in the default spec. Returns { [id]: { top, bottom } } for the joined
// edges. Tolerance: 0.05% of the canvas, well under a pixel on every screen.
const JOIN_EPS = 0.05

export function cardJoins(panels) {
  const out = {}
  const cards = (Array.isArray(panels) ? panels : []).filter(
    (p) => p && !p.hidden && p.props && p.props.background !== 'none'
  )
  for (const a of cards) {
    for (const b of cards) {
      if (a === b || a.props.background !== b.props.background) continue
      if (Math.abs(a.x - b.x) > JOIN_EPS || Math.abs(a.w - b.w) > JOIN_EPS) continue
      if (Math.abs(a.y + a.h - b.y) > JOIN_EPS) continue
      out[a.id] = { ...(out[a.id] || { top: false, bottom: false }), bottom: true }
      out[b.id] = { ...(out[b.id] || { top: false, bottom: false }), top: true }
    }
  }
  return out
}
