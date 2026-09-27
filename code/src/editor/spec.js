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
//
// Panels and controls chunk 1 (docs/designs/panels-and-controls.md) adds,
// all optional and all sparse (a missing key is the look as designed):
//   props.elements  { <data-edit key>: { hidden, size, weight, color,
//                   spaceAbove, spaceBelow, tracking, caps, fit } }, keys
//                   from the type's element list, fields from the element
//                   style schema
//   props.bg, border, shadow, blur, font, color, valign, title   box v2,
//                   fields from the box schema
//   when            null | { all?: [cond], any?: [cond] } on the panel,
//                   cond = { kind, not?, days?, from?, to?, daypart? }
// An explicit null reads as absent everywhere, as the hub stores the nulls
// the editor sends for removals (withRemovals below).
//
// Chunk 4 makes the block types data: which types are blocks, and which the
// app knows at all, come from the app (schema.js, the type registry), so a
// shape is a block like text and image. A panel of a type the app does not
// know is kept exactly as stored (never dropped, never edited), and the
// layers call it "not supported by this app".
//
// Any number of every type (the blocks rename, 2026-09-27; the screen side is
// the app's normaliser): the first instance of a functional type keeps the
// bare type id ('weather'), so every layout saved before is untouched; the
// others are '<type>-<4 hex>' ('weather-3fa9'), the scheme the text, image
// and shape blocks always had (they are suffixed from the first). The type of
// an id is the part before its first '-', unless the id is itself a type. In
// the UI everything on a layout is a "block"; the code keeps its names
// (panels, panelLabel, PANEL_*), as do the spec keys and the messages.

import {
  boxFields,
  boxFieldsFor,
  cleanKnob,
  cleanParamValue,
  elementList,
  elementStyleFields,
  isBlockType,
  isFunctionalType,
  isKnownType,
  isPlainValue,
  knobDefaultsFor,
  knobFields,
  registeredTypeLabel,
  ruleKind,
  ruleKinds,
  UNIVERSAL_KEYS,
} from './schema.js'
import {
  clamp,
  cloneJson,
  colorForWell,
  deepEqual,
  getPath,
  humanize,
  isDict,
  normalizeColor as colorOr,
  round2,
  setPath,
  shortTime,
  toNum,
} from './util.js'

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

// Functional panels (unique per layout, id === type) and blocks (any number):
// which is which, and which types the app knows at all, is the type registry
// in schema.js (the app's sd-edit:ready, else its bundled layoutSpec.js).
export { isBlockType, isFunctionalType, isKnownType }

// Names for a ready message that gives none (the app's own labels win).
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

// New blocks the editor makes itself (makeBlock): the v1 blocks at their own
// size and with their content, centred; any other block (a shape) as a bare
// 20 x 12 box, which is where the app's own newBlock starts one, for when the
// bundled app does not know the type (appSpec.js newBlock is tried first).
const NEW_BLOCKS = {
  text: { w: 30, h: 8, props: { ...TEXT_DEFAULTS, text: NEW_TEXT } },
  image: { w: 15, h: 25, props: { ...IMAGE_DEFAULTS } },
}
const NEW_BLOCK_OTHER = { w: 20, h: 12, props: { background: 'none', padding: 0 } }

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

const HEX4_RE = /^[0-9a-f]{4}$/

// '<type>-<4 hex>' for any type: 'weather-3fa9', 'text-3fa9'.
export const isSuffixedId = (type, id) =>
  typeof type === 'string' &&
  typeof id === 'string' &&
  id.length === type.length + 5 &&
  id.startsWith(`${type}-`) &&
  HEX4_RE.test(id.slice(type.length + 1))

// '<type>-<4 hex>' for a block type: 'text-3fa9', 'image-09c1', 'shape-5d20'.
export function isValidBlockId(type, id) {
  return isBlockType(type) && isSuffixedId(type, id)
}

// A functional type's ids: the bare type (its first instance) or suffixed.
// A block's: suffixed only.
export const isValidPanelId = (type, id) => (isBlockType(type) ? isSuffixedId(type, id) : id === type || isSuffixedId(type, id))

// The type an id names: the id itself when it is a type the app knows
// ('weather'), else the part before its first '-' ('weather-3fa9' ->
// 'weather'); the whole id when it has no '-'.
export function typeOfId(id) {
  if (typeof id !== 'string' || !id) return null
  if (isKnownType(id)) return id
  const i = id.indexOf('-')
  return i > 0 ? id.slice(0, i) : id
}

const hex4 = (n) => (n & 0xffff).toString(16).padStart(4, '0')

// A fresh '<type>-<4 hex>' id (a block, or a further instance of any type).
// Event handlers only: Math.random has no place in render.
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
  // Box v2 keys and element styles are validated below, never copied raw.
  const reserved = new Set(['elements', ...boxFields().map((b) => b.top)])
  if (fields.length) {
    for (const f of fields) {
      if (own.has(f.key)) continue
      const v = cleanKnob(f, p[f.key])
      if (v !== undefined) out[f.key] = v
    }
  } else {
    for (const k of Object.keys(p)) {
      if (!own.has(k) && !reserved.has(k) && k.length <= 64 && isPlainValue(p[k])) out[k] = p[k]
    }
  }
  return normalizeElementsInto(type, p, normalizeBoxInto(type, p, out))
}

// Does the type declare this prop as its own (the text block's colour)? Then
// it is the block's, not the box's.
const ownsKey = (type, key) => (BLOCK_PROP_KEYS[type] || []).includes(key) || knobFields(type).some((f) => f.key === key)

// A box v2 value worth storing: valid, and not null or an empty text.
export function cleanBoxValue(field, v) {
  const c = cleanKnob(field, v)
  if (c === undefined || c === null) return undefined
  if (field.type === 'text' && c === '') return undefined
  return c
}

// Box v2 props (bg.color, border.width, shadow...) from `raw` onto `out`:
// each one kept when valid, left out otherwise.
function normalizeBoxInto(type, raw, out) {
  let next = out
  for (const b of boxFieldsFor(type)) {
    if (ownsKey(type, b.top)) continue
    const v = cleanBoxValue(b.field, getPath(raw, b.path))
    if (v !== undefined) next = setPath(next, b.path, v)
  }
  return next
}

// One element's style: the valid, non-null fields; {} for none.
export function cleanElementStyle(raw) {
  const out = {}
  if (!isDict(raw)) return out
  for (const f of elementStyleFields()) {
    const v = cleanKnob(f, raw[f.key])
    if (v !== undefined && v !== null) out[f.key] = v
  }
  return out
}

// props.elements: only the type's own element keys, only valid fields; an
// element with nothing left goes, and so does an empty map.
function normalizeElementsInto(type, raw, out) {
  if (!isDict(raw.elements)) return out
  const known = new Set(elementList(type).map((e) => e.key))
  const els = {}
  for (const key of Object.keys(raw.elements)) {
    if (!known.has(key)) continue
    const st = cleanElementStyle(raw.elements[key])
    if (Object.keys(st).length) els[key] = st
  }
  return Object.keys(els).length ? { ...out, elements: els } : out
}

// --- visibility rules (panels[i].when) ----------------------------------------

// Per list, as the app's MAX_RULE_CONDITIONS: a rule is a handful; this only
// stops a runaway one.
export const MAX_CONDITIONS = 20
export const WHEN_MODES = ['all', 'any']

// A condition with a kind the rule registry knows and valid parameters; a
// missing one gets the kind's default (a condition just added), a bad one
// drops the condition, as the app's normaliser does, so the editor never
// shows a rule the screen would ignore. `not` only when true.
export function normalizeCond(raw) {
  if (!isDict(raw) || typeof raw.kind !== 'string') return null
  const k = ruleKind(raw.kind)
  if (!k) return null
  const out = { kind: raw.kind }
  if (raw.not === true) out.not = true
  for (const param of k.params) {
    const given = raw[param.key]
    const v = given === undefined || given === null ? cleanParamValue(param, param.default) : cleanParamValue(param, given)
    if (v === undefined) return null
    out[param.key] = v
  }
  return out
}

// null (always shown) or { all?: [...], any?: [...] } with at least one
// condition.
export function normalizeWhen(raw) {
  if (!isDict(raw) || !ruleKinds().length) return null
  const out = {}
  for (const mode of WHEN_MODES) {
    if (!Array.isArray(raw[mode])) continue
    const list = raw[mode].map(normalizeCond).filter(Boolean).slice(0, MAX_CONDITIONS)
    if (list.length) out[mode] = list
  }
  return Object.keys(out).length ? out : null
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

// A panel of a type the app does not know (a shape saved by a newer app): kept
// exactly as stored, a copy, as long as it has an id to be told apart by; the
// app it came from normalised it, and only that app can change it.
function keepAsStored(raw, taken) {
  const id = raw.id
  if (typeof id !== 'string' || !id || id.length > 64 || taken.has(id)) return null
  return cloneJson(raw)
}

// The type a panel with no type string gets from its id, when the app knows
// that type (a v1 functional panel was { id: 'clock' }); else null.
function knownTypeOfId(id) {
  const t = typeOfId(id)
  return t && isKnownType(t) ? t : null
}

// taken: the ids given out so far; claimed: every valid id in the list, so a
// repaired id never takes one a later panel carries by right.
function normalizePanel(raw, index, taken, claimed) {
  if (!isDict(raw)) return null
  const type = typeof raw.type === 'string' ? raw.type : knownTypeOfId(raw.id)
  if (type == null) return null
  if (!isKnownType(type)) return keepAsStored(raw, taken)
  const busy = { has: (x) => taken.has(x) || claimed.has(x) }
  let id
  if (isValidPanelId(type, raw.id) && !taken.has(raw.id)) {
    id = raw.id
  } else if (!isBlockType(type) && !busy.has(type)) {
    // A functional panel with no id, or a malformed one: the bare type, as
    // every functional panel's id was before instances.
    id = type
  } else {
    id = stableBlockId(type, busy, index)
  }
  const z = Math.round(num(raw.z, ...RANGES.z, index + 1))
  const out = {
    id,
    type,
    ...normalizeBox(raw),
    z,
    hidden: raw.hidden === true,
    locked: raw.locked === true,
    props: normalizeProps(type, raw.props),
  }
  const when = normalizeWhen(raw.when)
  if (when) out.when = when
  return out
}

function normalizePanels(list) {
  const taken = new Set()
  const panels = []
  const source = list.slice(0, MAX_PANELS)
  const claimed = new Set()
  for (const p of source) {
    const type = isDict(p) ? (typeof p.type === 'string' ? p.type : knownTypeOfId(p.id)) : null
    if (type && isKnownType(type) && isValidPanelId(type, p.id)) claimed.add(p.id)
  }
  source.forEach((p, i) => {
    const n = normalizePanel(p, i, taken, claimed)
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
// [{ type, label, min: { w, h } | minW, minH }]):
//   mins    smallest box per type, percent (else DEFAULT_MIN_PCT)
//   labels  friendlier names
// (Which types there are, for Add block, is the type registry: schema.js.)
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
      const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim() : null
      if (label) labels[type] = label
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

// The app's name for a type, else the editor's, else the type made readable
// ('shape' -> 'Shape' for a type nobody here knows).
export const typeLabel = (type, labels) =>
  labels?.[type] || registeredTypeLabel(type) || TYPE_LABELS[type] || humanize(type) || String(type)

// Every block's name in a part: its type's label, numbered from the second
// instance on, in the list's order, when the list holds more than one of the
// type ("Weather", "Weather 2", "Weather 3"). -> Map id -> name. Cheap (one
// pass); the editor works it out once per render and hands it round.
export function instanceNames(list, labels) {
  const count = new Map()
  const seen = new Map()
  const out = new Map()
  const panels = Array.isArray(list) ? list : []
  for (const p of panels) count.set(p.type, (count.get(p.type) || 0) + 1)
  for (const p of panels) {
    const n = (seen.get(p.type) || 0) + 1
    seen.set(p.type, n)
    const base = typeLabel(p.type, labels)
    out.set(p.id, count.get(p.type) > 1 && n > 1 ? `${base} ${n}` : base)
  }
  return out
}

// One block's name ("Weather 2"): from `names` (instanceNames) when it is
// there, else its type's label.
export const blockName = (p, labels, names) => names?.get?.(p?.id) || typeLabel(p?.type, labels)

// What the layers call a panel of a type the app does not know.
const UNSUPPORTED_NOTE = 'not supported by this app'

// The layers' line for a block: its name (numbered, when `names` is given)
// and, for text, an image or a titled shape, what tells it apart.
export function panelLabel(p, labels, names) {
  const base = blockName(p, labels, names)
  if (!isKnownType(p.type)) return `${base} (${UNSUPPORTED_NOTE})`
  if (p.type === 'text') {
    const t = String(p.props?.text || '').replace(/\s+/g, ' ').trim()
    return t ? `${base}: ${t.length > 22 ? `${t.slice(0, 21)}…` : t}` : base
  }
  if (p.type === 'image') {
    const src = String(p.props?.src || '')
    const file = src.split('/').pop()
    return file ? `${base}: ${decodeURIComponentSafe(file).slice(0, 22)}` : `${base} (empty)`
  }
  // Any other block (a shape): its custom title, when it has one, tells it apart.
  const title = isBlockType(p.type) && p.props?.title?.mode === 'custom' ? String(p.props.title.text || '').trim() : ''
  if (title) return `${base}: ${title.length > 22 ? `${title.slice(0, 21)}…` : title}`
  return base
}

function decodeURIComponentSafe(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// One above the highest z (a panel of a type the app does not know is kept as
// stored, so its z may not be a number).
const topZ = (panels) => panels.reduce((m, p) => Math.max(m, Number.isFinite(p.z) ? p.z : 0), 0) + 1

// A new block: centred and on top of everything, unless `place` says where
// ({ box: { x, y, w, h } percent, z }). Its knobs start at their defaults.
export function makeBlock(type, panels, id, place = {}) {
  const seed = NEW_BLOCKS[type] || NEW_BLOCK_OTHER
  const box = isDict(place.box)
    ? normalizeBox(place.box)
    : { x: round2((100 - seed.w) / 2), y: round2((100 - seed.h) / 2), w: seed.w, h: seed.h }
  return {
    id,
    type,
    ...box,
    z: Number.isFinite(place.z) ? clamp(Math.round(place.z), ...RANGES.z) : Math.min(RANGES.z[1], topZ(panels)),
    hidden: false,
    locked: false,
    props: normalizeProps(type, { ...knobDefaultsFor(type), ...seed.props }),
  }
}

// A functional panel for Add block, when the bundled app cannot make the type
// (appSpec.js newPanel is tried first): twice its minimum size (capped to the
// canvas), centred, on top, unless `place` says where ({ box, z }, as
// makeBlock). id: the bare type for the first instance, else '<type>-<4 hex>'.
export function makePanel(type, panels, mins, id = type, place = {}) {
  const min = minPctFor(type, mins)
  const w = round2(clamp(min.w * 2, 1, 100))
  const h = round2(clamp(min.h * 2, 1, 100))
  const box = isDict(place.box) ? normalizeBox(place.box) : { x: round2((100 - w) / 2), y: round2((100 - h) / 2), w, h }
  return {
    id,
    type,
    ...box,
    z: Number.isFinite(place.z) ? clamp(Math.round(place.z), ...RANGES.z) : Math.min(RANGES.z[1], topZ(panels)),
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
// absent).
//
// Panel lists are arrays, which the merge replaces whole, so there the nulls
// only say what went; they are written all the same (the contract: a removed
// rule is `when: null`, a removed element style `elements: { <key>: null }`).
// Panels are matched by id:
//   - a panel the save does not change (opts.samePanel says the stored copy
//     and the new one are the same layout) goes back EXACTLY as stored, so a
//     save never rewrites a panel the user did not edit, whatever a newer
//     normaliser would add to it
//   - an edited one is the new panel plus nulls for what it dropped
// A keyed map of styles (MAP_KEYS: props.elements) that goes as a whole goes
// as { <key>: null } per entry, so an element's removal reads the same
// whether or not the normaliser keeps an empty map.
const MAP_KEYS = new Set(['elements'])
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export function withRemovals(before, after, opts = {}) {
  if (Array.isArray(before) && Array.isArray(after)) return panelsWithRemovals(before, after, opts)
  if (!isDict(before) || !isDict(after)) return after
  const out = { ...after }
  for (const k of Object.keys(before)) {
    if (!hasOwn(after, k)) {
      out[k] = MAP_KEYS.has(k) && isDict(before[k]) ? Object.fromEntries(Object.keys(before[k]).map((e) => [e, null])) : null
    } else if ((isDict(before[k]) && isDict(after[k])) || (Array.isArray(before[k]) && Array.isArray(after[k]))) {
      out[k] = withRemovals(before[k], after[k], opts)
    }
  }
  return out
}

const isPanelList = (list) => list.every((p) => isDict(p) && typeof p.id === 'string')

function panelsWithRemovals(before, after, opts) {
  // Any other array (a rule's conditions) is replaced as it is.
  if (!after.length || !isPanelList(after)) return after
  const stored = new Map()
  for (const p of before) if (isDict(p) && typeof p.id === 'string' && !stored.has(p.id)) stored.set(p.id, p)
  return after.map((p) => {
    const old = stored.get(p.id)
    if (!old) return p
    if (opts.samePanel && opts.samePanel(old, p)) return old
    return withRemovals(old, p, opts)
  })
}

// --- element styles and rules, for the inspector and the layers -----------------

// One element's style as stored (sparse), {} for none.
export function elementStyleOf(panel, key) {
  const st = panel?.props?.elements?.[key]
  return isDict(st) ? st : {}
}

// A field's value in a style: the stored one when valid, else the default.
export function styleValue(field, style) {
  const v = cleanKnob(field, style?.[field.key])
  return v === undefined ? field.default : v
}

// Does the style change anything? (Every field at its default: no.)
export function isStyled(style) {
  if (!isDict(style)) return false
  return elementStyleFields().some((f) => {
    const v = cleanKnob(f, style[f.key])
    return v !== undefined && v !== null && v !== f.default
  })
}

// How many of the panel's elements carry a style.
export function styledCount(panel) {
  const els = panel?.props?.elements
  if (!isDict(els)) return 0
  return Object.keys(els).filter((k) => isStyled(els[k])).length
}

export const isElementHidden = (panel, key) => elementStyleOf(panel, key).hidden === true

// 'all' | 'any' for a rule with one list (the first when it has both).
export function whenMode(when) {
  if (!isDict(when)) return 'all'
  return Array.isArray(when.all) && when.all.length ? 'all' : Array.isArray(when.any) && when.any.length ? 'any' : 'all'
}

// Every condition, with the list it is in: [{ mode, index, cond }].
export function whenConditions(when) {
  const out = []
  if (!isDict(when)) return out
  for (const mode of WHEN_MODES) {
    if (Array.isArray(when[mode])) when[mode].forEach((cond, index) => out.push({ mode, index, cond }))
  }
  return out
}

// "school morning", "not weekend", "7:00 am to 9:00 am", "countdown within 3
// days", "day part: evening".
export function condText(cond) {
  if (!isDict(cond)) return ''
  const k = ruleKind(cond.kind)
  const label = (k?.label || humanize(cond.kind)).toLowerCase()
  let t
  if (cond.kind === 'timeRange') t = `${shortTime(cond.from)} to ${shortTime(cond.to)}`
  else if (cond.kind === 'countdownWithin') t = `countdown within ${cond.days} day${cond.days === 1 ? '' : 's'}`
  else if (cond.kind === 'daypart') {
    const partName = (DAYPART_LABELS[cond.daypart] || humanize(cond.daypart)).toLowerCase()
    t = / is$/.test(label) ? `${label} ${partName}` : `${label}: ${partName}`
  }
  else {
    const extra = (k?.params || [])
      .map((p) => cond[p.key])
      .filter((v) => v !== undefined && v !== null && v !== '')
      .join(', ')
    t = extra ? `${label} (${extra})` : label
  }
  return cond.not ? `not ${t}` : t
}

// The layer row's one line: "shows: school morning", or null when always.
export function whenSummary(when) {
  const conds = whenConditions(when)
  if (!conds.length) return null
  const all = conds.filter((c) => c.mode === 'all').map((c) => condText(c.cond))
  const any = conds.filter((c) => c.mode === 'any').map((c) => condText(c.cond))
  const parts = []
  if (all.length) parts.push(all.join(' and '))
  if (any.length) parts.push(all.length && any.length > 1 ? `(${any.join(' or ')})` : any.join(' or '))
  return `shows: ${parts.join(' and ')}`
}

// The elements a sub-element sits in, outermost first (the breadcrumb's
// middle: Countdowns › Tile › Title). From the parents the element list names
// when it names any, else from the rectangles the app reported for the panel
// ([{ key, x, y, w, h }]): the smallest other element that holds every drawn
// instance of this one, and so on outwards.
export function elementAncestors(type, key, rects) {
  const list = elementList(type)
  const declared = []
  const seen = new Set([key])
  let at = list.find((e) => e.key === key)
  while (at?.parent && !seen.has(at.parent) && declared.length < 4) {
    seen.add(at.parent)
    declared.unshift(at.parent)
    at = list.find((e) => e.key === at.parent)
  }
  if (declared.length) return declared
  return rectAncestors(key, Array.isArray(rects) ? rects : [], 0)
}

const within = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5

function rectAncestors(key, rects, depth) {
  const mine = rects.filter((r) => r.key === key)
  if (!mine.length || depth > 3) return []
  let best = null
  for (const other of new Set(rects.map((r) => r.key))) {
    if (other === key) continue
    const theirs = rects.filter((r) => r.key === other)
    if (!mine.every((m) => theirs.some((t) => within(m, t) && t.w * t.h > m.w * m.h + 1))) continue
    const area = Math.max(...theirs.map((t) => t.w * t.h))
    if (!best || area < best.area) best = { key: other, area }
  }
  return best ? [...rectAncestors(best.key, rects, depth + 1), best.key] : []
}
