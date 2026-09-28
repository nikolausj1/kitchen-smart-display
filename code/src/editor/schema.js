// schema.js - panel knobs as the editor reads them (docs/designs/layout-editor.md,
// Contract v2, "Panel knobs and schemas").
//
// Where a type's schema comes from, first hit wins:
//   1. the app's sd-edit:ready: schemas[type], or panelTypes[i].schema
//   2. the app's panels/schemas.js as bundled with this editor (PANEL_SCHEMAS)
//   3. BLOCK_SCHEMAS below: the v1 props of the text and image blocks
// The ready message wins because it describes the build that is actually
// rendering the preview; the bundled copy covers a ready that predates it.
//
// Field shape (the contract):
//   { key, label, type: 'number' | 'select' | 'toggle' | 'color' | 'text',
//     min, max, step, unit,            number
//     options: [[value, label], ...],  select
//     default, element,                element: the data-edit key it tunes
//     hint,
//     showIf, ui, pair, pairOf }       below
// Knob values live in the panel's props next to the universal ones; a missing
// value means the schema's default.
//
// showIf: { key: value } or { key: [value, ...] } (any of them); with several
// keys every one must hold. The values are read with the defaults filled in
// (a saved block without `mode` has the schema's mode), from any field of the
// same list, else from the props (a universal prop, a box path 'title.mode').
// A field that does not show keeps its stored value: hiding never clears it.
//
// ui: how a field is drawn, where the plain control would not do.
//   'hourRange'  a number field with pair: '<key>', whose partner (a number
//                field with ui: 'hourRange', pairOf: '<this key>') it is
//                drawn with as ONE slider with two handles, hours on the
//                track, the first field's label and hint; the partner is
//                not drawn on its own. Each handle writes its own key. Each
//                side keeps its own showIf: with one side hidden the other
//                is drawn alone, one handle on the same track, under its
//                own label (Now until: the end hour without the start).
//   'timeList'   a text field holding 24-hour 'H:MM' times, comma-separated
//                ('7:30,12:00'), drawn as chips with an Add time; `max` is
//                how many it holds (8 when it does not say)
// A ui the editor does not know, on the wrong field type, or a pair that does
// not point back, draws the plain control.
//
// The registry is module state on purpose: it describes the app build in the
// iframe, of which there is one at a time, and the spec normaliser (spec.js)
// needs it without every caller passing it along. registerFromReady is called
// before the reducer hears about the ready, so the re-render that follows
// already sees it.
//
// The same goes for the four objects of the panels-and-controls chunk 1
// contract (docs/designs/panels-and-controls.md): the element style schema,
// the box v2 schema, the fonts and the visibility rule kinds. First hit wins:
// the ready message's elementStyleSchema, boxSchema, fonts and ruleKinds, then
// the copy bundled with the editor, which appSpec.js registers at load (the
// app's own exports, or the editor's fallbacks until those land).
//
// And for the panel types themselves: which types the app knows, and which
// of them are blocks (free content, ids '<type>-<4 hex>': text, image and,
// since chunk 4, the shape). Every other type is a functional panel (its
// first instance's id is the type, any further one's '<type>-<4 hex>'; in the
// UI every one of them is a block too). First
// hit wins: the ready message (its `blockTypes` when it carries that list,
// else its panelTypes marked kind 'block'; every panelType is a type it
// knows), then the app's layoutSpec.js as bundled (PANEL_TYPE_LIST,
// BLOCK_TYPES; appSpec.js registers them at load), then the Contract v1 and v2
// types. A type none of them knows is "not supported by this app": the editor
// keeps such a panel exactly as stored and never edits it (spec.js).

import {
  GLOBAL_SCHEMA as APP_GLOBAL_SCHEMA,
  PANEL_ELEMENTS as APP_PANEL_ELEMENTS,
  PANEL_SCHEMAS as APP_PANEL_SCHEMAS,
} from '../views/TodayLayouts/panels/schemas.js'
import { clamp, decimalsOf, getPath, humanize, isDict, normalizeColor, normalizeTime, roundTo, toNum } from './util.js'

export const FIELD_TYPES = ['number', 'select', 'toggle', 'color', 'text']
export const UNIVERSAL_KEYS = ['textScale', 'opacity', 'padding', 'background', 'radius', 'align', 'scrim']
const TEXT_MAX = 2000

const ALIGN_FIELD_OPTIONS = [
  ['start', 'Left'],
  ['center', 'Centre'],
  ['end', 'Right'],
]

// The text and image blocks' own props (Contract v1), for an app whose
// schemas do not list them.
export const BLOCK_SCHEMAS = {
  text: {
    fields: [
      { key: 'text', label: 'Text', type: 'text', multiline: true, default: '' },
      { key: 'size', label: 'Size', type: 'number', min: 0.5, max: 50, step: 0.1, unit: '%', default: 4, hint: '% of the height' },
      {
        key: 'weight',
        label: 'Weight',
        type: 'select',
        options: [
          [300, 'Light'],
          [400, 'Regular'],
          [600, 'Semibold'],
          [700, 'Bold'],
        ],
        default: 600,
      },
      { key: 'color', label: 'Colour', type: 'color', default: '#f2f2f0' },
      { key: 'align', label: 'Align', type: 'select', options: ALIGN_FIELD_OPTIONS, default: 'center' },
      { key: 'lineHeight', label: 'Line height', type: 'number', min: 0.8, max: 3, step: 0.05, default: 1.15 },
    ],
  },
  image: {
    fields: [
      { key: 'src', label: 'URL', type: 'text', default: '', placeholder: '/countdown-art/… or https://…' },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        options: [
          ['contain', 'Contain'],
          ['cover', 'Cover'],
        ],
        default: 'contain',
      },
    ],
  },
}

// Global text scale (Contract v1); the global schema lists the rest.
export const TEXT_SCALE_FIELD = {
  key: 'textScale',
  label: 'Text scale',
  type: 'number',
  min: 0.5,
  max: 2,
  step: 0.05,
  unit: 'x',
  default: 1,
  hint: "Multiplies every block's",
}

const EMPTY = { fields: [] }

const isOptionValue = (v) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

// [[value, label]] from [[value, label]], [{ value, label }] or [value]. A
// null value is an option too: "Auto" (the element style's weight).
function cleanOptions(list) {
  return (Array.isArray(list) ? list : [])
    .map((o) =>
      Array.isArray(o)
        ? [o[0], String(o[1] ?? o[0])]
        : isDict(o)
          ? [o.value ?? null, String(o.label ?? o.value)]
          : [o, String(o)]
    )
    .filter(([v]) => isOptionValue(v))
}

// A field the editor can render, or null. Extra keys are kept: element,
// hint, nullable (a colour that may be "Auto"), nullLabel.
function cleanField(f) {
  if (!isDict(f) || typeof f.key !== 'string' || !f.key || !FIELD_TYPES.includes(f.type)) return null
  if (f.type === 'select') {
    const options = cleanOptions(f.options)
    if (!options.length) return null
    return { ...f, options }
  }
  return f
}

function cleanSchema(s) {
  if (!isDict(s) || !Array.isArray(s.fields)) return null
  return { ...s, fields: s.fields.map(cleanField).filter(Boolean) }
}

function cleanTable(t) {
  const out = {}
  if (!isDict(t)) return out
  for (const k of Object.keys(t)) {
    const s = cleanSchema(t[k])
    if (s) out[k] = s
  }
  return out
}

const BUNDLED = cleanTable(APP_PANEL_SCHEMAS)
const BUNDLED_GLOBAL = cleanSchema(APP_GLOBAL_SCHEMA)
const BLOCKS = cleanTable(BLOCK_SCHEMAS)

let fromReady = {}
let readyGlobal = null
let version = 0

// --- panel types: which the app knows, and which are blocks --------------------

// Contract v1 and v2, for an app that names none.
const BUILTIN_PANEL_TYPES = [
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
const BUILTIN_BLOCK_TYPES = ['text', 'image']
const isTypeName = (t) => typeof t === 'string' && t.length > 0 && t.length <= 64

// { known: Set, blocks: [type] | null, labels: { type: label }, descriptions,
// previews } from a type list ([{ type, label, kind: 'panel' | 'block',
// unique, description?, preview? }] or ['clock', ...]) and a block list;
// blocks is null when neither says which are blocks. description (one line
// for the Add block menu) and preview (the path of its thumbnail in the app
// build) are optional: the editor has its own (catalog.js). With no type
// list, the types are `fallbackKnown` (and the blocks named). null for no
// types at all.
const TEXT_OF = (v, max) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null)
function cleanTypes(list, blockList, fallbackKnown) {
  const known = new Set()
  const labels = {}
  const descriptions = {}
  const previews = {}
  let blocks = null
  for (const t of Array.isArray(list) ? list : []) {
    const type = typeof t === 'string' ? t : isDict(t) ? t.type : null
    if (!isTypeName(type)) continue
    known.add(type)
    if (!isDict(t)) continue
    if (typeof t.label === 'string' && t.label.trim()) labels[type] = t.label.trim()
    const description = TEXT_OF(t.description, 200)
    if (description) descriptions[type] = description
    const preview = TEXT_OF(t.preview, 300)
    if (preview) previews[type] = preview
    const block = t.kind === 'block' || (t.kind == null && t.unique === false)
    if (block || t.kind === 'panel' || t.unique === true) {
      blocks = blocks || []
      if (block && !blocks.includes(type)) blocks.push(type)
    }
  }
  if (!known.size && fallbackKnown) for (const t of fallbackKnown) known.add(t)
  if (Array.isArray(blockList)) {
    blocks = [...new Set(blockList.filter(isTypeName))]
    for (const b of blocks) known.add(b)
  }
  return known.size ? { known, blocks, labels, descriptions, previews } : null
}

let bundledTypes = null
let readyTypes = null

// What the editor goes by: the ready's types, else the bundled ones, else the
// built-in ones. A source that does not say which types are blocks takes the
// bundled (or built-in) blocks it names.
function resolveTypes() {
  const src = readyTypes || bundledTypes
  if (!src) {
    return {
      known: new Set([...BUILTIN_PANEL_TYPES, ...BUILTIN_BLOCK_TYPES]),
      blocks: BUILTIN_BLOCK_TYPES,
      labels: {},
      descriptions: {},
      previews: {},
    }
  }
  const blocks = src.blocks || (bundledTypes?.blocks || BUILTIN_BLOCK_TYPES).filter((t) => src.known.has(t))
  const merged = (k) => ({ ...(bundledTypes?.[k] || {}), ...(readyTypes?.[k] || {}) })
  return {
    known: new Set([...src.known, ...blocks]),
    blocks,
    labels: merged('labels'),
    descriptions: merged('descriptions'),
    previews: merged('previews'),
  }
}

let types = resolveTypes()

// appSpec.js, once at load: the bundled app's PANEL_TYPE_LIST and BLOCK_TYPES
// (text and image when it has none).
export function registerBundledTypes(list, blocks) {
  bundledTypes = cleanTypes(list, Array.isArray(blocks) ? blocks : BUILTIN_BLOCK_TYPES, BUILTIN_PANEL_TYPES)
  types = resolveTypes()
  version += 1
}

// The registry as it stands: { known: Set, blocks, labels }, a new object
// whenever the types change, so a memoised value that reads it can depend on
// it (the ready arrives after the first render).
export const typeRegistry = () => types

// The block types, in the app's order ('shape', 'text', 'image' today). The
// same array until the types change, so it can be a render dependency.
export const blockTypes = () => types.blocks

export const isBlockType = (type) => types.blocks.includes(type)

// Does the app know the type? A panel of a type it does not know is kept as
// stored, drawn by nobody, and not editable ("not supported by this app").
export const isKnownType = (type) => isTypeName(type) && types.known.has(type)

// Unique per layout, id === type.
export const isFunctionalType = (type) => isKnownType(type) && !isBlockType(type)

// The app's name for a type ("Shape", "Flip clock"), or undefined.
export const registeredTypeLabel = (type) => (isTypeName(type) && Object.prototype.hasOwnProperty.call(types.labels, type) ? types.labels[type] : undefined)

// The app's own one-line description of a type and the path of its preview
// thumbnail, when its type list gives them; else undefined (catalog.js has
// the editor's).
const own = (map, type) => (isTypeName(type) && Object.prototype.hasOwnProperty.call(map, type) ? map[type] : undefined)
export const registeredTypeDescription = (type) => own(types.descriptions, type)
export const registeredTypePreview = (type) => own(types.previews, type)

// The v1 blocks (text, image), whose props are their content (Contract v1:
// BLOCK_SCHEMAS above), not knobs: a shape's are knobs, like a panel's.
export const hasOwnProps = (type) => Object.prototype.hasOwnProperty.call(BLOCK_SCHEMAS, type)

// sd-edit:ready: { schemas, globalSchema, panelTypes: [{ type, label, kind,
// unique, schema }], blockTypes?: [type], elementStyleSchema, boxSchema,
// fonts, ruleKinds }. Returns true when anything changed.
export function registerFromReady(msg) {
  const table = cleanTable(msg?.schemas)
  if (Array.isArray(msg?.panelTypes)) {
    for (const t of msg.panelTypes) {
      const type = isDict(t) && typeof t.type === 'string' ? t.type : null
      const s = type && !table[type] ? cleanSchema(t.schema) : null
      if (s) table[type] = s
    }
  }
  const g = cleanSchema(msg?.globalSchema)
  const c = cleanContract({
    elementStyleSchema: msg?.elementStyleSchema,
    boxSchema: msg?.boxSchema,
    fonts: msg?.fonts,
    ruleKinds: msg?.ruleKinds,
  })
  // A ready naming its blocks but not its types keeps the types known so far.
  const knownSoFar = Array.isArray(msg?.blockTypes) ? (readyTypes || bundledTypes)?.known : null
  const t = cleanTypes(msg?.panelTypes, msg?.blockTypes, knownSoFar)
  const key = (x) => (x ? [[...x.known].sort(), x.blocks, x.labels, x.descriptions, x.previews] : null)
  const changed =
    JSON.stringify([table, g, c, key(t || readyTypes)]) !== JSON.stringify([fromReady, readyGlobal, readyContract, key(readyTypes)])
  if (Object.keys(table).length || g) {
    fromReady = table
    readyGlobal = g
  }
  readyContract = c
  if (t) {
    readyTypes = t
    types = resolveTypes()
  }
  if (changed) version += 1
  return changed
}

export const schemasVersion = () => version

export function schemaFor(type) {
  return fromReady[type] || BUNDLED[type] || BLOCKS[type] || EMPTY
}

// The fields the inspector renders for a panel, universal keys excluded
// except `align`, which the text block declares as its own.
export function knobFields(type) {
  return schemaFor(type).fields
}

export function globalFields() {
  const s = readyGlobal || BUNDLED_GLOBAL
  const fields = s ? s.fields.slice() : []
  if (!fields.some((f) => f.key === 'textScale')) fields.push(TEXT_SCALE_FIELD)
  return fields
}

// Does the schema redeclare a universal prop (the text block's align)? The
// inspector then shows it with the knobs only.
export const declares = (type, key) => knobFields(type).some((f) => f.key === key)

// The option value matching v (3 matches '3'), or undefined.
export function optionValue(field, v) {
  const opts = field.options || []
  const hit = opts.find((o) => o[0] === v) || opts.find((o) => String(o[0]) === String(v))
  return hit ? hit[0] : undefined
}

// A valid value for the field, or undefined (the default applies).
export function cleanKnob(field, v) {
  switch (field.type) {
    case 'number': {
      const n = toNum(v)
      if (!Number.isFinite(n)) return undefined
      const lo = Number.isFinite(field.min) ? field.min : -Infinity
      const hi = Number.isFinite(field.max) ? field.max : Infinity
      return roundTo(clamp(n, lo, hi), Number.isFinite(field.step) ? decimalsOf(field.step) : 4)
    }
    case 'select':
      return optionValue(field, v)
    case 'toggle':
      return typeof v === 'boolean' ? v : undefined
    case 'color': {
      const c = normalizeColor(v, null)
      return c ?? undefined
    }
    case 'text':
      if (typeof v === 'string') return v.slice(0, Number.isFinite(field.maxLength) ? field.maxLength : TEXT_MAX)
      if (typeof v === 'number' && Number.isFinite(v)) return String(v)
      return undefined
    default:
      return undefined
  }
}

// A JSON primitive worth keeping when no schema describes the key.
export function isPlainValue(v) {
  if (typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  return typeof v === 'string' && v.length <= TEXT_MAX
}

export function fieldDefault(field) {
  return field.default
}

// { key: default } for a type's knobs (universal keys left out).
export function knobDefaultsFor(type) {
  const out = {}
  for (const f of knobFields(type)) {
    if (!UNIVERSAL_KEYS.includes(f.key) && f.default !== undefined) out[f.key] = f.default
  }
  return out
}

// The value a field shows: the stored one when valid, else the default.
export function fieldValue(field, props) {
  const v = props ? cleanKnob(field, props[field.key]) : undefined
  return v === undefined ? field.default : v
}

// Element names: [{ key, label }] or { key: label }, from a schema's own
// `elements`, else the app's PANEL_ELEMENTS table.
function labelsFrom(e) {
  const out = {}
  if (Array.isArray(e)) {
    for (const it of e) if (isDict(it) && typeof it.key === 'string') out[it.key] = String(it.label || humanize(it.key))
  } else if (isDict(e)) {
    for (const k of Object.keys(e)) out[k] = typeof e[k] === 'string' ? e[k] : String(e[k]?.label || humanize(k))
  }
  return out
}

// "Date" for clock/date: the schema's element table (the ready message's, else
// the app's PANEL_ELEMENTS), else what the app reported for that key
// (`reported`: one data-edit-label shared by all its instances), else the key
// made readable. The table comes first: a key can mark several elements (every
// countdown tile is "tile", labelled with its own title), and the knobs it
// names are the same for all of them.
export function elementLabel(type, key, reported) {
  if (!key) return ''
  return (
    labelsFrom(schemaFor(type).elements)[key] ||
    labelsFrom(APP_PANEL_ELEMENTS?.[type])[key] ||
    reported?.[key] ||
    humanize(key)
  )
}

// A type's sub-elements, in order: [{ key, label, parent }] from the ready
// message's schema (its `elements`), else the app's PANEL_ELEMENTS as bundled.
// These are the keys element styles may use (props.elements). parent: the key
// of the element it sits inside when the table says so (else null; the
// inspector's breadcrumb can still find it from the rectangles).
export function elementList(type) {
  const own = listFrom(schemaFor(type).elements)
  return own.length ? own : listFrom(APP_PANEL_ELEMENTS?.[type])
}

function listFrom(e) {
  const out = []
  const seen = new Set()
  const push = (key, label, parent) => {
    if (typeof key !== 'string' || !key || seen.has(key)) return
    seen.add(key)
    out.push({ key, label: typeof label === 'string' && label ? label : humanize(key), parent: typeof parent === 'string' && parent ? parent : null })
  }
  if (Array.isArray(e)) {
    for (const it of e) if (isDict(it)) push(it.key, it.label, it.parent)
  } else if (isDict(e)) {
    for (const k of Object.keys(e)) push(k, typeof e[k] === 'string' ? e[k] : e[k]?.label, e[k]?.parent)
  }
  return out
}

// Fields grouped by element, in the order the schema first names each one;
// fields that name no element come last.
//   -> [{ element: 'time' | null, label, fields }]
export function groupFields(type, fields, reported) {
  const groups = new Map()
  const rest = []
  for (const f of fields) {
    if (typeof f.element === 'string' && f.element) {
      if (!groups.has(f.element)) groups.set(f.element, { element: f.element, label: elementLabel(type, f.element, reported), fields: [] })
      groups.get(f.element).fields.push(f)
    } else {
      rest.push(f)
    }
  }
  const out = [...groups.values()]
  if (rest.length) out.push({ element: null, label: out.length ? 'Other' : '', fields: rest })
  return out
}

// --- showIf and ui (the field vocabulary above) --------------------------------

// Does a value match what a showIf asks for? Primitives as the selects do
// (3 matches '3'); null and a missing value are the same.
function sameValue(v, want) {
  if (v === want || (v == null && want == null)) return true
  return v != null && want != null && typeof v !== 'object' && typeof want !== 'object' && String(v) === String(want)
}

// Does the field's showIf hold? read(key): the current value, defaults
// filled in. Nothing to hold (no showIf, not an object) shows the field; so
// does an entry that asks for nothing usable (an empty list, an object): a
// slip in a schema never hides a field for good.
export function showIfHolds(cond, read) {
  if (!isDict(cond)) return true
  return Object.entries(cond).every(([key, want]) => {
    if (Array.isArray(want)) return !want.length || want.some((w) => sameValue(read(key), w))
    if (want !== null && typeof want === 'object') return true
    if (want === undefined) return true
    return sameValue(read(key), want)
  })
}

// The keys of a field's showIf that do not hold now, in its order.
export function showIfMisses(cond, read) {
  if (!isDict(cond)) return []
  return Object.keys(cond).filter((key) => !showIfHolds({ [key]: cond[key] }, read))
}

// read(key) for a list of fields over a props object: a field's value with
// its default filled in (fieldValue), else the prop at that path as stored.
export function valueReader(fields, props) {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  return (key) => {
    const f = byKey.get(key)
    if (f) return fieldValue(f, props)
    return typeof key === 'string' ? getPath(props, key.split('.')) : undefined
  }
}

// The hourRange pairs in a list: partnerOf (first key -> the partner field),
// firstOf (partner key -> the first field) and the partners' keys. A pair
// counts when both are number fields marked ui: 'hourRange', the first names
// the partner as its `pair` and the partner names the first as its `pairOf`;
// a field is in one pair at most. Anything else is drawn as plain fields.
export function hourRangePairs(fields) {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const partnerOf = new Map()
  const firstOf = new Map()
  const partners = new Set()
  const isRange = (f) => !!f && f.type === 'number' && f.ui === 'hourRange'
  for (const f of fields) {
    if (!isRange(f) || typeof f.pair !== 'string' || f.pair === f.key || partners.has(f.key)) continue
    const g = byKey.get(f.pair)
    if (!isRange(g) || g.pairOf !== f.key || partnerOf.has(g.key) || partners.has(g.key)) continue
    partnerOf.set(f.key, g)
    firstOf.set(g.key, f)
    partners.add(g.key)
  }
  return { partnerOf, firstOf, partners }
}

// The fields to draw, in order: those whose showIf holds. A pair is drawn at
// its first field: as one slider when both sides show, as that side alone
// (one handle) when only one does; so a partner is listed only while its
// first is hidden (Now until: the end hour without the start). -> [field];
// pairs: hourRangePairs(); how to draw each: hourRangeDraw().
export function shownFields(fields, read, pairs = hourRangePairs(fields)) {
  return fields.filter((f) => {
    if (!showIfHolds(f.showIf, read)) return false
    return !pairs.partners.has(f.key) || !showIfHolds(pairs.firstOf.get(f.key).showIf, read)
  })
}

// How a shown field of an hourRange pair is drawn: { first, second, show:
// 'both' | 'first' | 'second' } (the pair's two fields, whose ranges make
// the track, and the handles on it); null for any other field. One side
// alone keeps to its own range: the other does not apply while it is hidden.
export function hourRangeDraw(field, pairs, read) {
  const partner = pairs.partnerOf.get(field.key)
  if (partner) return { first: field, second: partner, show: showIfHolds(partner.showIf, read) ? 'both' : 'first' }
  const first = pairs.firstOf.get(field.key)
  return first ? { first, second: field, show: 'second' } : null
}

// A field's value as its control names it: an option's label, On or Off, a
// number with its unit; anything else as it is.
export function valueText(field, v) {
  if (!field) return String(v ?? '')
  if (field.type === 'select') {
    const hit = (field.options || []).find((o) => sameValue(o[0], v))
    return hit ? String(hit[1]) : String(v ?? '')
  }
  if (field.type === 'toggle') return v ? 'On' : 'Off'
  if (field.type === 'number' && Number.isFinite(v)) return `${v}${field.unit ? ` ${field.unit}` : ''}`
  return String(v ?? '')
}

// Why fields are hidden: each setting whose value hides them, once, as
// 'Show is Whole day'. fields: the hidden ones; all: the list they are in.
export function hiddenBecause(fields, all, read) {
  const keys = []
  for (const f of fields) for (const k of showIfMisses(f.showIf, read)) if (!keys.includes(k)) keys.push(k)
  return keys.map((k) => {
    const f = all.find((x) => x.key === k)
    return `${f?.label || humanize(k)} is ${valueText(f, read(k))}`
  })
}

// How many times a timeList holds: its `max`, else 8.
export const TIME_LIST_MAX = 8
export const timeListMax = (field) => (Number.isFinite(field?.max) && field.max >= 1 ? Math.floor(field.max) : TIME_LIST_MAX)

// An hourRange pair's track: { lo, hi, step, first: [min, max], second: [min,
// max] } in hours. The track spans both fields' min..max (0..24 when they do
// not say), a handle stays inside its own field's range, and the step is the
// first field's (1 hour when it does not say).
export function hourRangeTrack(first, second) {
  const minOf = (f) => (Number.isFinite(f?.min) ? f.min : 0)
  const maxOf = (f) => (Number.isFinite(f?.max) ? f.max : 24)
  const lo = Math.min(minOf(first), minOf(second))
  const hi = Math.max(maxOf(first), maxOf(second), lo + 1)
  const own = Number.isFinite(first?.step) && first.step > 0 ? first.step : Number.isFinite(second?.step) && second.step > 0 ? second.step : 1
  const step = Math.min(own, hi - lo)
  return { lo, hi, step, first: [minOf(first), maxOf(first)], second: [minOf(second), maxOf(second)] }
}

// Where one handle may go: on a step of the track, inside its own field's
// range, and at least one step short of the other handle (the handles never
// cross). which: 'first' | 'second'; other: the other handle's value, or
// undefined for a handle drawn alone (its own range only).
export function placeHandle(track, which, value, other) {
  const { lo, step } = track
  const places = decimalsOf(step)
  const snapped = roundTo(lo + Math.round((toNum(value) - lo) / step) * step, places)
  const [min, max] = track[which]
  const o = toNum(other)
  const hasOther = Number.isFinite(o)
  const lower = which === 'second' && hasOther ? Math.max(min, roundTo(o + step, places)) : min
  const upper = which === 'first' && hasOther ? Math.min(max, roundTo(o - step, places)) : max
  // No room beside the other handle (it sits at this one's end of the
  // track): as near to it as this handle's own range allows.
  if (upper < lower) return which === 'first' ? min : max
  if (!Number.isFinite(snapped)) return which === 'first' ? lower : upper
  return clamp(snapped, lower, upper)
}

// --- the chunk 1 contract ----------------------------------------------------
//
// ELEMENT_STYLE_SCHEMA  { fields }: one element's style (props.elements[key]):
//                       hidden, size, weight, color (nullable), spaceAbove,
//                       spaceBelow, tracking, caps, fit
// BOX_SCHEMA            { fields }: the box v2 props. A field's key may be a
//                       path ('bg.color'), or a field may hold its own
//                       `fields` (a group: { key: 'bg', fields: [...] }); both
//                       read as the path ['bg', 'color'] here
// FONTS                 [{ id, label, stack }]: the box font (and the global
//                       one) is 'inherit' or one of these ids
// RULE_KINDS            [{ kind, label, param? | params? }]: a param is a
//                       condition key ('days', 'from', 'to', 'daypart'), or a
//                       field-like { key, ... } that refines it

const DAYPART_OPTIONS = [
  ['day', 'Day'],
  ['morning', 'Morning'],
  ['evening', 'Evening'],
  ['weekend', 'Weekend'],
]

// How the editor draws a rule's parameters: a time picker for from and to, a
// number for days, the day parts for daypart. A param the app describes with
// its own { key, ... } can refine the label, range, default and options; the
// control type of these four stays.
const PARAM_BUILTINS = {
  days: { key: 'days', label: 'Days', type: 'number', min: 0, max: 60, step: 1, unit: 'days', default: 7 },
  from: { key: 'from', label: 'From', type: 'time', default: '07:00' },
  to: { key: 'to', label: 'To', type: 'time', default: '09:00' },
  daypart: { key: 'daypart', label: 'Day part', type: 'select', options: DAYPART_OPTIONS, default: 'morning' },
}
const PARAM_TYPES = ['number', 'time', 'select', 'text', 'toggle']

function cleanParam(p) {
  const key = typeof p === 'string' ? p : isDict(p) && typeof p.key === 'string' ? p.key : null
  if (!key || key === 'kind' || key === 'not') return null
  const builtin = PARAM_BUILTINS[key]
  const base = builtin || { key, label: humanize(key), type: 'text', default: '' }
  const merged = { ...base, ...(isDict(p) ? p : {}), key }
  if (builtin || !PARAM_TYPES.includes(merged.type)) merged.type = base.type
  if (merged.type === 'select') {
    const options = cleanOptions(isDict(p) && Array.isArray(p.options) ? p.options : base.options)
    if (options.length) merged.options = options
    else merged.type = 'text'
  }
  if (merged.type === 'time' && !normalizeTime(merged.default)) merged.default = base.default
  return merged
}

// A kind may refine its parameters itself: with one `param`, its options,
// default, min, max, step and unit sit on the kind ({ kind: 'countdownWithin',
// param: 'days', min: 0, max: 365, default: 7 }); with several, `defaults`
// holds one default per key ({ params: ['from', 'to'], defaults: { from:
// '07:00', to: '09:00' } }).
const KIND_REFINES = ['options', 'default', 'min', 'max', 'step', 'unit']

function cleanRuleKinds(list) {
  if (!Array.isArray(list)) return null
  const out = []
  const seen = new Set()
  for (const k of list) {
    if (!isDict(k) || typeof k.kind !== 'string' || !k.kind || seen.has(k.kind)) continue
    seen.add(k.kind)
    const raw = Array.isArray(k.params) ? k.params : k.param != null ? [k.param] : []
    const params = raw
      .map((p) => {
        const key = typeof p === 'string' ? p : isDict(p) && typeof p.key === 'string' ? p.key : null
        if (!key) return null
        const extra = {}
        if (raw.length === 1) for (const f of KIND_REFINES) if (k[f] !== undefined) extra[f] = k[f]
        if (isDict(k.defaults) && k.defaults[key] !== undefined) extra.default = k.defaults[key]
        return cleanParam(isDict(p) ? { ...extra, ...p } : { ...extra, key })
      })
      .filter(Boolean)
    out.push({
      kind: k.kind,
      label: typeof k.label === 'string' && k.label ? k.label : humanize(k.kind),
      hint: typeof k.hint === 'string' ? k.hint : undefined,
      params,
    })
  }
  return out.length ? out : null
}

function cleanFonts(list) {
  if (!Array.isArray(list)) return null
  const out = []
  const seen = new Set()
  for (const f of list) {
    const id = typeof f === 'string' ? f : isDict(f) && typeof f.id === 'string' ? f.id : null
    if (!id || id === 'inherit' || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label: isDict(f) && typeof f.label === 'string' && f.label ? f.label : humanize(id),
      stack: isDict(f) && typeof f.stack === 'string' ? f.stack : '',
    })
  }
  return out.length ? out : null
}

// The four objects, cleaned; each null when absent or unusable.
function cleanContract(c) {
  return {
    elementStyle: cleanSchema(c?.elementStyleSchema),
    box: isDict(c?.boxSchema) && Array.isArray(c.boxSchema.fields) ? c.boxSchema : null,
    fonts: cleanFonts(c?.fonts),
    ruleKinds: cleanRuleKinds(c?.ruleKinds),
  }
}

let bundledContract = cleanContract(null)
let readyContract = cleanContract(null)

// appSpec.js, once at load: the copy bundled with the editor.
export function registerBundledContract(c) {
  bundledContract = cleanContract(c)
  version += 1
}

const pick = (k) => readyContract[k] || bundledContract[k]

// One element's style fields (hidden, size, weight, color, ...).
export const elementStyleFields = () => (pick('elementStyle') || EMPTY).fields

export const fontList = () => pick('fonts') || []

export const ruleKinds = () => pick('ruleKinds') || []

export const ruleKind = (kind) => ruleKinds().find((k) => k.kind === kind) || null

// 'inherit' first ("Global": the layout's own font), then every font.
export const fontOptions = (fonts = fontList()) => [['inherit', 'Global'], ...fonts.map((f) => [f.id, f.label])]

// The box v2 fields, flattened: [{ path: ['bg', 'color'], key: 'bg.color',
// top: 'bg', group: 'Fill' | null, field }] in schema order. field.key is the
// dotted path. The font field lists fontOptions() whatever the schema says,
// so the per-panel list and the global one share the one registry.
let boxCache = { schema: null, fonts: null, list: [] }
export function boxFields() {
  const schema = pick('box')
  const fonts = fontList()
  if (boxCache.schema === schema && boxCache.fonts === fonts) return boxCache.list
  const list = []
  const walk = (fields, prefix, group) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      if (!isDict(f) || typeof f.key !== 'string' || !f.key) continue
      // A field's own `path` when it gives one, else its dotted key.
      const own = Array.isArray(f.path) && f.path.length && f.path.every((x) => typeof x === 'string' && x) ? f.path : f.key.split('.').filter(Boolean)
      const path = [...prefix, ...own]
      if (!path.length) continue
      if (Array.isArray(f.fields)) {
        walk(f.fields, path, group ?? (typeof f.label === 'string' ? f.label : null))
        continue
      }
      let field = { ...f, key: path.join('.') }
      if (field.type === 'font' || (path.length === 1 && path[0] === 'font')) {
        field = { ...field, type: 'select', options: fontOptions(fonts), default: field.default ?? 'inherit' }
      }
      const clean = cleanField(field)
      if (clean) list.push({ path, key: clean.key, top: path[0], group, field: clean })
    }
  }
  if (schema) walk(schema.fields, [], null)
  boxCache = { schema, fonts, list }
  return list
}

// The box v2 fields a type takes: not those the schema marks `notFor` it
// (the box text colour is not for a text block, which has its own colour),
// nor those whose top key the type declares as a knob of its own.
export const boxFieldsFor = (type) =>
  boxFields().filter((b) => !(Array.isArray(b.field.notFor) && b.field.notFor.includes(type)) && !declares(type, b.top))

// The top-level prop keys the box v2 fields a type takes live under (bg,
// border, shadow, blur, font, color, valign, title).
export const boxTopsFor = (type) => [...new Set(boxFieldsFor(type).map((b) => b.top))]

// A valid value for a rule parameter, or undefined.
export function cleanParamValue(param, v) {
  switch (param.type) {
    case 'time':
      return normalizeTime(v) ?? undefined
    case 'number': {
      const n = toNum(v)
      if (!Number.isFinite(n)) return undefined
      const lo = Number.isFinite(param.min) ? param.min : -Infinity
      const hi = Number.isFinite(param.max) ? param.max : Infinity
      return roundTo(clamp(n, lo, hi), Number.isFinite(param.step) ? decimalsOf(param.step) : 0)
    }
    case 'select':
      return optionValue(param, v)
    case 'toggle':
      return typeof v === 'boolean' ? v : undefined
    default:
      return typeof v === 'string' ? v.slice(0, 200) : undefined
  }
}
