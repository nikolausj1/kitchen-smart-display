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
//     default, element }               element: the data-edit key it tunes
// Knob values live in the panel's props next to the universal ones; a missing
// value means the schema's default.
//
// The registry is module state on purpose: it describes the app build in the
// iframe, of which there is one at a time, and the spec normaliser (spec.js)
// needs it without every caller passing it along. registerFromReady is called
// before the reducer hears about the ready, so the re-render that follows
// already sees it.

import {
  GLOBAL_SCHEMA as APP_GLOBAL_SCHEMA,
  PANEL_ELEMENTS as APP_PANEL_ELEMENTS,
  PANEL_SCHEMAS as APP_PANEL_SCHEMAS,
} from '../views/TodayLayouts/panels/schemas.js'
import { clamp, decimalsOf, humanize, isDict, normalizeColor, roundTo, toNum } from './util.js'

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
  hint: "Multiplies every panel's",
}

const EMPTY = { fields: [] }

// A field the editor can render, or null.
function cleanField(f) {
  if (!isDict(f) || typeof f.key !== 'string' || !f.key || !FIELD_TYPES.includes(f.type)) return null
  if (f.type === 'select') {
    const options = (Array.isArray(f.options) ? f.options : [])
      .map((o) => (Array.isArray(o) ? [o[0], String(o[1] ?? o[0])] : isDict(o) ? [o.value, String(o.label ?? o.value)] : [o, String(o)]))
      .filter(([v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
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

// sd-edit:ready: { schemas, globalSchema, panelTypes: [{ type, schema }] }.
// Returns true when anything changed.
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
  const changed = JSON.stringify([table, g]) !== JSON.stringify([fromReady, readyGlobal])
  if (Object.keys(table).length || g) {
    fromReady = table
    readyGlobal = g
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
