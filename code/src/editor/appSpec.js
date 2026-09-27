// appSpec.js - the one place the editor uses the app's own layout module
// (views/TodayLayouts/layoutSpec.js, Contract v2), bundled with the editor:
//
//   readSpec(raw, layoutId)     a stored or received spec as the editor holds
//                               it: the editor's clamps, then the app's
//                               normaliser with that layout's defaults, so
//                               every global and knob has its value (what the
//                               board draws is what the inspector shows)
//   finalSpec(spec, layoutId)   the same as the LAST pass before Save or Copy,
//                               so what is stored is exactly what the board
//                               renders
//   sameLayout(a, b, layoutId)  "would the screen draw the same thing?"
//   samePanel(a, b, layoutId)   the same for one panel (the save keeps a panel
//                               it did not change exactly as stored)
//   withVariant / withoutVariant  day-part variants, the app's own helpers
//   newPanel(type, layoutId, overrides, takenIds, { bare })
//                               a functional panel for Add block: that
//                               layout's default box and props for the type,
//                               or the type's own starting box, with the
//                               multi-instance id (the bare type, or
//                               '<type>-<4 hex>' when the part has one)
//   newBlock(type, overrides, takenIds)
//                               a block from the app's own newBlock (a shape:
//                               its starting box and props), or null when the
//                               bundled app does not make that type
//   BLOCK_TYPES, PANEL_TYPE_LIST  registered with schema.js as the type list
//                               (text and image when the app has none); the
//                               ready message's list wins there too
//   ELEMENT_STYLE_SCHEMA, BOX_SCHEMA, FONTS, RULE_KINDS
//                               the panels-and-controls chunk 1 contract
//                               (docs/designs/panels-and-controls.md), as
//                               bundled: the app's exports, else the
//                               fallbacks below. registered with schema.js,
//                               where the copy in sd-edit:ready wins
//
// The editor's spec.js keeps its own copy of the normaliser for editing-time
// clamps; it must write a valid spec whatever app build the iframe shows.
// A panel whose type the bundled module does not know (a shape, while the
// editor is older than the app in the preview; or any type from a newer app)
// never goes through the app's normaliser, which would drop it: it keeps the
// editor's copy (spec.js normalised it from the ready's schema, or kept it as
// stored when nobody here knows the type) in its place in the list.
//
// A namespace import on purpose: the chunk 1 exports are being added to the
// app module alongside this editor work, and `app.X` is simply undefined
// where a named import of a missing export would break the build.
//
// Instances (any number of every type, 2026-09-27) are built on both sides
// at once: an app module whose normaliser still keeps one panel of a
// functional type (and forces its id to the type) is never handed a further
// instance of it ('weather-3fa9'), which it would drop or, first in the list,
// take for the bare one. Such a panel keeps the editor's copy, like a type
// the module does not know. Asked per type (keepsInstances), since a module
// may repeat some types only (the Home Assistant panels came first);
// APP_EXPORTS.instances says whether it repeats the clock, i.e. every type.

import * as app from '../views/TodayLayouts/layoutSpec.js'
import { globalFields, isBlockType, registerBundledContract, registerBundledTypes } from './schema.js'
import { hasPart, isSuffixedId, isValidBlockId, newBlockId, normalizeSpec } from './spec.js'
import { deepEqual, isDict } from './util.js'

// --- the chunk 1 contract: fallbacks ---------------------------------------------
//
// FALLBACKS mirroring the contract, used only while the app's layoutSpec.js
// does not export these yet. Remove at integration once it does (each line
// below that reads `app.X ?? FALLBACK_X` then reads `app.X`), together with
// the carry-over in readSpec.

const FALLBACK_ELEMENT_STYLE_SCHEMA = {
  fields: [
    { key: 'hidden', label: 'Hidden', type: 'toggle', default: false },
    { key: 'size', label: 'Size', type: 'number', min: 0.5, max: 2.5, step: 0.05, unit: 'x', default: 1 },
    {
      key: 'weight',
      label: 'Weight',
      type: 'select',
      options: [
        [null, 'Auto'],
        [300, 'Light'],
        [400, 'Regular'],
        [500, 'Medium'],
        [600, 'Semibold'],
        [700, 'Bold'],
        [800, 'Extra bold'],
      ],
      default: null,
    },
    { key: 'color', label: 'Colour', type: 'color', nullable: true, default: null },
    { key: 'spaceAbove', label: 'Space above', type: 'number', min: 0, max: 3, step: 0.1, unit: 'x', default: 0 },
    { key: 'spaceBelow', label: 'Space below', type: 'number', min: 0, max: 3, step: 0.1, unit: 'x', default: 0 },
    { key: 'tracking', label: 'Letter spacing', type: 'number', min: -0.05, max: 0.2, step: 0.01, unit: 'em', default: 0 },
    { key: 'caps', label: 'Capitals', type: 'toggle', default: false },
    {
      key: 'fit',
      label: 'Fit',
      type: 'select',
      options: [
        ['wrap', 'Wrap'],
        ['shrink', 'Shrink'],
        ['clip', 'Clip'],
      ],
      default: 'wrap',
      hint: 'Text that does not fit wraps or shrinks',
    },
  ],
}

const FALLBACK_BOX_SCHEMA = {
  fields: [
    { key: 'bg.color', label: 'Colour', type: 'color', nullable: true, default: null, nullLabel: 'Preset' },
    { key: 'bg.opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05, default: 1 },
    {
      key: 'bg.gradient',
      label: 'Gradient',
      type: 'select',
      options: [
        ['none', 'None'],
        ['down', 'Down'],
        ['right', 'Right'],
        ['diagonal', 'Diagonal'],
      ],
      default: 'none',
    },
    { key: 'bg.color2', label: 'Second colour', type: 'color', nullable: true, default: null },
    { key: 'border.width', label: 'Width', type: 'number', min: 0, max: 4, step: 0.5, unit: 'px', default: 0 },
    { key: 'border.color', label: 'Colour', type: 'color', nullable: true, default: null },
    {
      key: 'shadow',
      label: 'Shadow',
      type: 'select',
      options: [
        ['none', 'None'],
        ['soft', 'Soft'],
        ['strong', 'Strong'],
      ],
      default: 'none',
    },
    { key: 'blur', label: 'Blur', type: 'number', min: 0, max: 20, step: 1, unit: 'px', default: 0, hint: 'Shows as a tint on the Echo' },
    { key: 'font', label: 'Font', type: 'select', options: [['inherit', 'Global']], default: 'inherit' },
    { key: 'color', label: 'Text colour', type: 'color', nullable: true, default: null, nullLabel: 'Global' },
    {
      key: 'valign',
      label: 'Vertical align',
      type: 'select',
      options: [
        ['top', 'Top'],
        ['middle', 'Middle'],
        ['bottom', 'Bottom'],
      ],
      default: 'top',
    },
    {
      key: 'title.mode',
      label: 'Title',
      type: 'select',
      options: [
        ['default', 'Default'],
        ['custom', 'Custom'],
        ['none', 'None'],
      ],
      default: 'default',
    },
    { key: 'title.text', label: 'Text', type: 'text', default: '', placeholder: 'Block title' },
  ],
}

const FALLBACK_FONTS = [
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, sans-serif" },
  { id: 'fraunces', label: 'Fraunces', stack: "'Fraunces Variable', 'Fraunces', Georgia, serif" },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', system-ui, sans-serif" },
  { id: 'barlow', label: 'Barlow Condensed', stack: "'Barlow Condensed', system-ui, sans-serif" },
  { id: 'plexmono', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, monospace" },
]

const FALLBACK_RULE_KINDS = [
  { kind: 'schoolMorning', label: 'School morning' },
  { kind: 'weekend', label: 'Weekend' },
  { kind: 'weekday', label: 'Weekday' },
  { kind: 'daypart', label: 'Day part', param: 'daypart' },
  { kind: 'timeRange', label: 'Time of day', params: ['from', 'to'] },
  { kind: 'musicPlaying', label: 'Music playing' },
  { kind: 'plexPlaying', label: 'Plex playing' },
  { kind: 'alertActive', label: 'Weather alert' },
  { kind: 'countdownWithin', label: 'Countdown within', param: 'days' },
]

// Does the bundled normaliser keep a further instance of this functional
// type, id and all? (One that predates instances keeps the first only.)
const keeps = new Map()
function keepsInstances(type) {
  if (keeps.has(type)) return keeps.get(type)
  let ok
  try {
    const probe = [
      { id: type, type, x: 1, y: 1, w: 40, h: 40, z: 1, props: {} },
      { id: `${type}-0f0f`, type, x: 50, y: 50, w: 40, h: 40, z: 2, props: {} },
    ]
    const out = app.normalizeSpec({ panels: probe }, { defaultSpec: null, layoutId: 'entry' })
    ok = !!out && Array.isArray(out.panels) && out.panels.map((p) => p.id).join() === `${type},${type}-0f0f`
  } catch {
    ok = false
  }
  keeps.set(type, ok)
  return ok
}

// Which of the four the bundled app module exports itself, and whether it
// takes instances.
export const APP_EXPORTS = {
  elementStyleSchema: app.ELEMENT_STYLE_SCHEMA != null,
  boxSchema: app.BOX_SCHEMA != null,
  fonts: app.FONTS != null,
  ruleKinds: app.RULE_KINDS != null,
  instances: keepsInstances('clock'),
}

export const ELEMENT_STYLE_SCHEMA = app.ELEMENT_STYLE_SCHEMA ?? FALLBACK_ELEMENT_STYLE_SCHEMA
export const BOX_SCHEMA = app.BOX_SCHEMA ?? FALLBACK_BOX_SCHEMA
export const FONTS = app.FONTS ?? FALLBACK_FONTS
export const RULE_KINDS = app.RULE_KINDS ?? FALLBACK_RULE_KINDS

registerBundledContract({ elementStyleSchema: ELEMENT_STYLE_SCHEMA, boxSchema: BOX_SCHEMA, fonts: FONTS, ruleKinds: RULE_KINDS })

// --- the panel types ------------------------------------------------------------------

// The blocks of an app module that predates the list: Contract v1's two.
const FALLBACK_BLOCK_TYPES = ['text', 'image']

registerBundledTypes(
  Array.isArray(app.PANEL_TYPE_LIST) ? app.PANEL_TYPE_LIST : null,
  Array.isArray(app.BLOCK_TYPES) ? app.BLOCK_TYPES : FALLBACK_BLOCK_TYPES
)

// Does the bundled app module know the type? (An app module without
// panelType: as before, it is handed everything.)
const appKnows = (type) => (typeof app.panelType === 'function' ? !!app.panelType(type) : true)

// Can the bundled normaliser take this panel as it is? Its type, and for a
// functional type's further instance ('weather-3fa9') a module that keeps
// instances of that type. A block's ids were always suffixed.
const appTakes = (p) => isDict(p) && appKnows(p.type) && (isBlockType(p.type) || p.id === p.type || keepsInstances(p.type))

// --- the spec -----------------------------------------------------------------------

const editorNormalize = (spec) => normalizeSpec(spec, { globalFields: globalFields() })

function appNormalize(spec, layoutId) {
  try {
    return app.normalizeSpec(spec, { defaultSpec: null, layoutId }) || null
  } catch {
    return null
  }
}

// FALLBACK (remove with the ones above): an app normaliser that predates
// chunk 1 drops what it does not know, so until it exports the contract the
// editor's own validated copy of those keys is carried over onto its result:
// props.elements (element styles), the box v2 props, and the panel's `when`.
const BOX_KEYS = ['bg', 'border', 'shadow', 'blur', 'font', 'color', 'valign', 'title']
function carryOver(mine, theirs) {
  const keepElements = !APP_EXPORTS.elementStyleSchema
  const keepBox = !APP_EXPORTS.boxSchema
  const keepWhen = !APP_EXPORTS.ruleKinds
  if (!keepElements && !keepBox && !keepWhen) return theirs
  const onto = (mineList, theirList) =>
    (theirList || []).map((p) => {
      const m = (mineList || []).find((x) => x.id === p.id)
      if (!m || m === p || !isDict(m.props)) return p
      const props = { ...p.props }
      if (keepElements && m.props.elements) props.elements = m.props.elements
      if (keepBox) for (const k of BOX_KEYS) if (m.props[k] !== undefined && props[k] === undefined) props[k] = m.props[k]
      const out = { ...p, props }
      if (keepWhen && m.when) out.when = m.when
      return out
    })
  const out = { ...theirs, panels: onto(mine.panels, theirs.panels) }
  if (isDict(theirs.variants)) {
    out.variants = {}
    for (const part of Object.keys(theirs.variants)) {
      out.variants[part] = { ...theirs.variants[part], panels: onto(mine.variants?.[part]?.panels, theirs.variants[part].panels) }
    }
  }
  return out
}

// The spec with only the panels the bundled app can take, for its normaliser.
function onlyKnown(spec) {
  const keep = (list) => (Array.isArray(list) ? list.filter(appTakes) : list)
  const out = { ...spec, panels: keep(spec.panels) }
  if (isDict(spec.variants)) {
    out.variants = {}
    for (const part of Object.keys(spec.variants)) {
      const v = spec.variants[part]
      out.variants[part] = isDict(v) ? { ...v, panels: keep(v.panels) } : v
    }
  }
  return out
}

// One panel list back in the editor's order: each panel the app knows as the
// app normalised it (position by position: its normaliser keeps the order),
// each other one as the editor holds it. Should the app have dropped one
// after all, its list comes first and the others after it.
function putBack(mineList, theirList) {
  const mine = Array.isArray(mineList) ? mineList : []
  const theirs = Array.isArray(theirList) ? theirList : []
  const known = mine.filter(appTakes)
  if (known.length === mine.length) return theirs
  if (known.length !== theirs.length) return [...theirs, ...mine.filter((p) => !appTakes(p))]
  let i = 0
  return mine.map((p) => (appTakes(p) ? theirs[i++] : p))
}

function withUnknown(mine, theirs) {
  const out = { ...theirs, panels: putBack(mine.panels, theirs.panels) }
  if (isDict(theirs.variants)) {
    out.variants = {}
    for (const part of Object.keys(theirs.variants)) {
      const v = theirs.variants[part]
      out.variants[part] = { ...v, panels: putBack(mine.variants?.[part]?.panels, v.panels) }
    }
  }
  return out
}

// null for "no spec" (the built-in default in the registry).
export function readSpec(raw, layoutId) {
  const mine = editorNormalize(raw)
  if (!mine) return null
  const theirs = appNormalize(onlyKnown(mine), layoutId)
  return theirs ? carryOver(mine, withUnknown(mine, theirs)) : mine
}

export const finalSpec = readSpec

// canvas is informational and version is the writer's, so neither counts.
function canonical(spec, layoutId) {
  const n = readSpec(spec, layoutId)
  return n ? { ...n, canvas: null, version: null } : null
}

export function sameLayout(a, b, layoutId) {
  if (!a || !b) return a === b
  return deepEqual(canonical(a, layoutId), canonical(b, layoutId))
}

// One panel, normalised on its own, as the save compares a stored panel with
// the one it is about to write.
function canonicalPanel(p, layoutId) {
  const n = readSpec({ panels: [p] }, layoutId)
  return n && n.panels.length === 1 ? n.panels[0] : null
}

export function samePanel(a, b, layoutId) {
  if (!isDict(a) || !isDict(b) || a.id !== b.id) return false
  const ca = canonicalPanel(a, layoutId)
  return !!ca && deepEqual(ca, canonicalPanel(b, layoutId))
}

// Morning (evening, weekend) as a copy of the Day layout. The variant has no
// global of its own until one is edited, so it follows Day's.
export function withVariant(spec, part) {
  if (!spec || part === 'day' || hasPart(spec, part)) return spec
  const out = app.withVariant(spec, part)
  return isDict(out) && hasPart(out, part) ? out : spec
}

// The variant gone: that part shows the Day layout again.
export function withoutVariant(spec, part) {
  if (!spec || part === 'day' || !hasPart(spec, part)) return spec
  const out = app.withoutVariant(spec, part)
  return isDict(out) && Array.isArray(out.panels) && !hasPart(out, part) ? out : spec
}

// A functional panel for Add block, or null when the bundled app does not
// make the type (spec.js makePanel then). overrides: { z } and, for a further
// instance, its box. The id follows the instance scheme: `bare` (the part has
// no panel with the type's own id) wants the type itself; otherwise a
// '<type>-<4 hex>' clear of takenIds (a Set: every id of the layout, all day
// parts). The app's newPanel(type, overrides, { layoutId, takenIds }) makes
// that id itself for a type it repeats (the contract: a suffixed id when the
// bare one is taken); for a type it does not repeat yet it answers with the
// bare id whatever, and the id is made here instead.
//   -> { panel, idFrom: 'app' | 'editor' } | null
export function newPanel(type, layoutId, overrides, takenIds, { bare = true } = {}) {
  const taken = takenIds instanceof Set ? takenIds : new Set()
  // Asked of the app with no taken ids when the bare id is free in the part
  // (so it answers with the bare id), with the layout's otherwise.
  let p
  try {
    p = app.newPanel(type, overrides, { layoutId, takenIds: bare ? new Set() : taken })
  } catch {
    p = null
  }
  if (!isDict(p) || p.type !== type) return null
  if (bare) return { panel: p.id === type ? p : { ...p, id: type }, idFrom: p.id === type ? 'app' : 'editor' }
  if (isSuffixedId(type, p.id) && !taken.has(p.id)) return { panel: p, idFrom: 'app' }
  return { panel: { ...p, id: newBlockId(type, taken) }, idFrom: 'editor' }
}

// A block from the app's own newBlock: its starting box and props for the
// type, with `overrides` over them (a box, a z), its id clear of takenIds (a
// Set). null when the bundled app does not make that type (a shape, while the
// editor is older than the app in the preview): spec.js makeBlock then.
export function newBlock(type, overrides, takenIds) {
  if (typeof app.newBlock !== 'function' || !appKnows(type)) return null
  try {
    const b = app.newBlock(type, overrides, takenIds)
    return isDict(b) && b.type === type && isValidBlockId(type, b.id) && !takenIds.has(b.id) ? b : null
  } catch {
    return null
  }
}
