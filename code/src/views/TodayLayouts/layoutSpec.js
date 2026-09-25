// layoutSpec.js - the layout spec a screen's spec-drawn Today layouts (the
// Entry board and the Board) are drawn from (docs/designs/layout-editor.md,
// "Contract v1" and "Contract v2"). Pure: no React, no DOM, no clock. The
// app's renderer (Entry/SpecBoard.jsx) and the editor (code/src/editor/) both
// import it, so a spec means the same thing on both sides of the iframe.
//
// A spec, as stored in the device registry at config.layouts.<layoutId>
// (entry, board):
//
//   { version: 2,
//     canvas: { w, h },            what it was drawn on (informational)
//     global: { textScale, font, accent, text, surfaceOpacity, radius },
//     panels: [ { id, type, x, y, w, h, z, hidden, locked, props } ],
//     eveningFrom: 18,             hour the evening variant starts (12..23)
//     variants: {                  optional, each optional (Entry phase 2)
//       morning: { panels, global? },
//       evening: { panels, global? },
//       weekend: { panels, global? } } }
//
// The base panels and global are the "day" layout. A variant's global, when
// it has one, replaces the base's (normalised full, missing keys taken from
// the base); without one it follows the base's.
//
// x, y, w, h are PERCENT of the canvas, so a layout drawn at 1920x1080 lands
// in the same place at 1280x800. The editor writes 2 decimals; the normaliser
// keeps up to 3 (POSITION_PLACES), which is what lets a built-in board sit on
// the 1/64 px its CSS grid used to (see the Board below). Canvas pixels are
// for readouts only. null or absent in the registry means "the built-in
// default".
// Version 1 specs (no knobs, no v2 globals, no variants) read unchanged and are
// written back as version 2.
//
// Runtime rule for this file: it runs on every screen, and Silk on the Echo
// may be as old as Chrome 80 (vite.config.js lowers syntax, not APIs). So no
// Array.prototype.at, Object.hasOwn, structuredClone, String replaceAll.

import { GLOBAL_SCHEMA, PANEL_SCHEMAS, knobDefaults } from './panels/schemas.js'
import * as Schemas from './panels/schemas.js'

export const SPEC_VERSION = 2
export const ENTRY_LAYOUT_ID = 'entry'
export const BOARD_LAYOUT_ID = 'board'
// The Today layouts drawn from a spec (and so editable in the layout editor).
export const LAYOUT_IDS_SPEC = Object.freeze([ENTRY_LAYOUT_ID, BOARD_LAYOUT_ID])

export function isSpecLayout(id) {
  return LAYOUT_IDS_SPEC.indexOf(id) >= 0
}

// 'board' for the Board, 'entry' for anything else.
function layoutIdOf(id) {
  return id === BOARD_LAYOUT_ID ? BOARD_LAYOUT_ID : ENTRY_LAYOUT_ID
}

// --- Day parts -----------------------------------------------------------------

// 'day' is the base (spec.panels / spec.global); the others are variants.
export const DAYPARTS = Object.freeze(['day', 'morning', 'evening', 'weekend'])
export const VARIANT_DAYPARTS = Object.freeze(['morning', 'evening', 'weekend'])
export const EVENING_FROM_DEFAULT = 18
export const EVENING_FROM_RANGE = Object.freeze({ min: 12, max: 23 })

function isVariantKey(k) {
  return VARIANT_DAYPARTS.indexOf(k) >= 0
}

// --- Panel types -----------------------------------------------------------------
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
//          Both default boards clear every one of them down to 960x480.
// padShape [y, x] factors of --tl-pad that `padding: 1` means for this type.
//          Every type is [1, 1] except the air quality chip, whose phase 1 card
//          had a thinner vertical padding (0.55) than the panels above it.
// box      where the type lands (percent) in a layout whose default has no
//          such panel (the editor's "Add panel"), and props what it starts
//          with there. A layout's own default panel wins over both.

const CARD = { background: 'card', padding: 1 }
const BARE = { background: 'none', padding: 0 }

const TYPE_TABLE = [
  { type: 'clock', label: 'Clock', kind: 'panel', min: { w: 6, h: 4 }, minPx: { w: 110, h: 40 }, box: { x: 30, y: 30, w: 40, h: 30 }, props: CARD },
  { type: 'weather', label: 'Weather', kind: 'panel', min: { w: 10, h: 6 }, minPx: { w: 150, h: 52 }, box: { x: 35, y: 35, w: 30, h: 26 }, props: CARD },
  { type: 'forecast', label: 'Forecast', kind: 'panel', min: { w: 12, h: 10 }, minPx: { w: 180, h: 100 }, box: { x: 32, y: 30, w: 36, h: 40 }, props: CARD },
  { type: 'sunmoon', label: 'Sun and moon', kind: 'panel', min: { w: 10, h: 8 }, minPx: { w: 160, h: 90 }, box: { x: 34, y: 34, w: 32, h: 32 }, props: CARD },
  { type: 'wear', label: 'What to wear', kind: 'panel', min: { w: 10, h: 5 }, minPx: { w: 140, h: 40 }, box: { x: 32, y: 41, w: 36, h: 18 }, props: CARD },
  {
    type: 'airquality',
    label: 'Air quality',
    kind: 'panel',
    min: { w: 6, h: 3 },
    minPx: { w: 90, h: 22 },
    padShape: [0.55, 1],
    box: { x: 35, y: 45, w: 30, h: 10 },
    props: CARD,
  },
  { type: 'headline', label: 'Headline', kind: 'panel', min: { w: 6, h: 2.5 }, minPx: { w: 110, h: 20 }, box: { x: 20, y: 44, w: 60, h: 12 }, props: CARD },
  { type: 'agenda', label: 'Agenda', kind: 'panel', min: { w: 14, h: 10 }, minPx: { w: 300, h: 90 }, box: { x: 20, y: 25, w: 60, h: 50 }, props: CARD },
  // Also the departure countdown's box during a school morning (as on the phase
  // 1 board), so its minimum covers that panel too. The tiles are the cards.
  { type: 'countdowns', label: 'Countdowns', kind: 'panel', min: { w: 8, h: 10 }, minPx: { w: 140, h: 110 }, box: { x: 30, y: 30, w: 40, h: 40 }, props: BARE },
  { type: 'departure', label: 'Departure', kind: 'panel', min: { w: 8, h: 10 }, minPx: { w: 140, h: 100 }, box: { x: 35, y: 30, w: 30, h: 40 }, props: CARD },
  // Also the departure countdown's box while one runs (the Board's rule).
  { type: 'nowplaying', label: 'Now playing', kind: 'panel', min: { w: 10, h: 8 }, minPx: { w: 160, h: 70 }, box: { x: 34, y: 34, w: 32, h: 32 }, props: CARD },
  // A tile: the Entry board's full-bleed backdrop is a screen setting, not this.
  { type: 'photo', label: 'Photo', kind: 'panel', min: { w: 6, h: 6 }, minPx: null, box: { x: 30, y: 25, w: 40, h: 50 }, props: { background: 'card', padding: 0 } },
  { type: 'school', label: 'School', kind: 'panel', min: { w: 10, h: 6 }, minPx: { w: 140, h: 50 }, box: { x: 35, y: 35, w: 30, h: 30 }, props: CARD },
  { type: 'text', label: 'Text', kind: 'block', min: { w: 2, h: 2 }, minPx: null, box: { x: 30, y: 44, w: 40, h: 12 }, props: null },
  { type: 'image', label: 'Image', kind: 'block', min: { w: 2, h: 2 }, minPx: null, box: { x: 40, y: 32, w: 20, h: 36 }, props: null },
]

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.keys(o).forEach((k) => deepFreeze(o[k]))
  }
  return o
}

// A deep copy of plain JSON data (schemas, specs): the copies handed out are
// never the panel worker's frozen objects, nor each other's.
function cloneJson(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k)
}

function isDict(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

// --- Schemas ---------------------------------------------------------------------
//
// A functional panel's knobs are its schema's fields (panels/schemas.js,
// PANEL_SCHEMAS); the blocks' schemas are their own props, declared here.
// Universal props (UNIVERSAL_DEFAULTS) are never knobs: a field that repeats
// one is ignored by the normaliser.

// The text and image blocks' own props as schema fields, for the editor's
// inspector. Ranges are PROP_RANGES below (the normaliser's own).
const BLOCK_SCHEMAS = {
  text: {
    fields: [
      { key: 'text', label: 'Text', type: 'text', multiline: true, default: '' },
      { key: 'size', label: 'Size', type: 'number', min: 0.5, max: 50, step: 0.1, unit: '%', default: 4, hint: '% of the height' },
      { key: 'weight', label: 'Weight', type: 'select', options: [[300, 'Light'], [400, 'Regular'], [600, 'Semibold'], [700, 'Bold']], default: 600 },
      { key: 'color', label: 'Colour', type: 'color', default: '#f2f2f0' },
      { key: 'align', label: 'Align', type: 'select', options: [['start', 'Left'], ['center', 'Centre'], ['end', 'Right']], default: 'center' },
      { key: 'lineHeight', label: 'Line height', type: 'number', min: 0.8, max: 3, step: 0.05, default: 1.15 },
    ],
  },
  image: {
    fields: [
      { key: 'src', label: 'URL', type: 'text', default: '', placeholder: '/countdown-art/... or https://...' },
      { key: 'fit', label: 'Fit', type: 'select', options: [['contain', 'Contain'], ['cover', 'Cover']], default: 'contain' },
    ],
  },
}

const PANEL_ELEMENTS = isDict(Schemas.PANEL_ELEMENTS) ? Schemas.PANEL_ELEMENTS : {}

function schemaSource(type) {
  if (has(PANEL_SCHEMAS, type) && isDict(PANEL_SCHEMAS[type])) return PANEL_SCHEMAS[type]
  if (has(BLOCK_SCHEMAS, type)) return BLOCK_SCHEMAS[type]
  return null
}

// The field list of a type (functional knobs, or a block's props), [] for none.
function fieldsOf(type) {
  const s = schemaSource(type)
  return s && Array.isArray(s.fields) ? s.fields.filter((f) => isDict(f) && typeof f.key === 'string' && f.key) : []
}

// { fields, elements } as sent to the editor, or null for a type with neither.
function schemaFor(type) {
  const fields = fieldsOf(type)
  const elements = has(PANEL_ELEMENTS, type) && Array.isArray(PANEL_ELEMENTS[type]) ? PANEL_ELEMENTS[type] : []
  if (!fields.length && !elements.length) return null
  return cloneJson({ fields, elements })
}

function globalFields() {
  const g = isDict(GLOBAL_SCHEMA) && Array.isArray(GLOBAL_SCHEMA.fields) ? GLOBAL_SCHEMA.fields : []
  return g.filter((f) => isDict(f) && typeof f.key === 'string' && f.key && f.key !== 'textScale')
}

// The global schema as sent to the editor (sd-edit:ready globalSchema).
export const GLOBAL_SCHEMA_COPY = deepFreeze({ fields: cloneJson(globalFields()) })

// The list, as sent to the editor in sd-edit:ready (panelTypes). schema is
// { fields, elements } (the same shape as PANEL_SCHEMAS[type], with the
// type's data-edit sub-elements), or null.
export const PANEL_TYPE_LIST = deepFreeze(
  TYPE_TABLE.map((t) => ({
    type: t.type,
    label: t.label,
    kind: t.kind,
    unique: t.kind === 'panel',
    min: { ...t.min },
    minPx: t.minPx ? { ...t.minPx } : null,
    padShape: t.padShape ? t.padShape.slice() : [1, 1],
    schema: schemaFor(t.type),
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

// { type: { fields, elements } } for every type that has a schema, as sent to
// the editor in sd-edit:ready (schemas).
export const PANEL_SCHEMA_TABLE = deepFreeze(
  PANEL_TYPE_LIST.reduce((acc, t) => {
    if (t.schema) acc[t.type] = t.schema
    return acc
  }, {})
)

export const FUNCTIONAL_TYPES = deepFreeze(
  PANEL_TYPE_LIST.filter((t) => t.kind === 'panel').map((t) => t.type)
)
export const BLOCK_TYPES = deepFreeze(PANEL_TYPE_LIST.filter((t) => t.kind === 'block').map((t) => t.type))

const TYPE_EXTRAS = TYPE_TABLE.reduce((acc, t) => {
  acc[t.type] = t
  return acc
}, {})

// The type's entry from PANEL_TYPES, or null for anything else.
export function panelType(type) {
  return typeof type === 'string' && has(PANEL_TYPES, type) ? PANEL_TYPES[type] : null
}

function isBlockType(type) {
  return type === 'text' || type === 'image'
}

// A spec is polled by every screen every 10 s: a runaway one stops here (per
// panel list: the base and each variant).
export const MAX_PANELS = 100

// --- Props -------------------------------------------------------------------

export const BACKGROUNDS = ['none', 'card', 'solid']
export const ALIGNS = ['start', 'center', 'end']
export const FITS = ['contain', 'cover']
// The universal `scrim`, weakest first. An enum, so it sits here with the
// other option lists rather than in PROP_RANGES (numbers only).
export const SCRIMS = ['none', 'soft', 'strong']

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
//              and always on an image block); times global.radius
//   align      'start' | 'center' | 'end': text alignment (the clock, the
//              headline and text blocks honour it)
//   scrim      'none' | 'soft' | 'strong': a shade behind a box with no
//              background, bleeding past its edges, and a close text shadow
//              on its text, so bare text reads over a photo (Entry/SpecPanel,
//              docs/designs/entry-board.md phase 1.5). Ignored under a card.
//              The Entry board's clock and headline are 'soft' by default.
export const UNIVERSAL_DEFAULTS = deepFreeze({
  textScale: 1,
  opacity: 1,
  padding: 1,
  background: 'none',
  radius: 1,
  align: 'start',
  scrim: 'none',
})

const UNIVERSAL_KEYS = Object.keys(UNIVERSAL_DEFAULTS)

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
// phase 1 look of a single card divided by hairlines. Every knob is its
// schema default (panels/schemas.js: the defaults are this board).
//
// The clock and the headline sit straight on the photo (no card), so they
// carry a soft scrim (phase 1.5); everything else is on a card and has none.
// A saved spec with no scrim on its clock or headline gets the same 'soft'
// (normProps fills a missing prop from this board), which is what gives the
// Echo Show 15 its two scrims with the deploy.
const ENTRY_PANELS = [
  {
    id: 'clock', type: 'clock', x: 2.4, y: 3, w: 54.58, h: 30.63, z: 1,
    props: { background: 'none', padding: 0, scrim: 'soft' },
  },
  {
    id: 'headline', type: 'headline', x: 2.4, y: 35.59, w: 54.58, h: 9.91, z: 2,
    props: { background: 'none', padding: 0, scrim: 'soft' },
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

// --- The default Board ---------------------------------------------------------
//
// The dark bento Board (Board/BoardLayout.css before the editor): a 12 x 6 grid
// inside a --tl-pad margin (clamp(12px, 1.6vw, 34px)) with --tl-gap gaps
// (clamp(10px, 1.2vw, 26px)), rows repeat(5, 1fr) 1.3fr. Clock 1-4 / 1-3,
// weather 5-8 / 1-3, photo 9-12 / 1-4, forecast 1-4 / 4-6, sun and moon 5-8 /
// 4-5, what to wear 5-8 / 6, and bottom right (9-12 / 5-6) now playing, which
// shows the departure countdown while one runs. Measured in Chrome (x, y  w x
// h, CSS px):
//
//               1280x800                      1920x1080
//   clock       20.5,  20.5  402.8 x 355.6     30.7,  30.7  604.2 x 476.3
//   weather    438.6,  20.5  402.8 x 355.6    657.9,  30.7  604.2 x 476.3
//   photo      856.8,  20.5  402.8 x 479.3   1285.1,  30.7  604.2 x 642.7
//   forecast    20.5, 391.4  402.8 x 388.1     30.7, 530.0  604.2 x 519.3
//   sunmoon    438.6, 391.4  402.8 x 232.0    657.9, 530.0  604.2 x 309.8
//   wear       438.6, 638.7  402.8 x 140.8    657.9, 862.9  604.2 x 186.4
//   next       856.8, 515.1  402.8 x 264.4   1285.1, 696.4  604.2 x 352.8
//
// Horizontally proportional again (pad and gap in vw): x and w are the same
// percentages at every size. Vertically the vw gaps are a larger share of 800
// than of 1080, so, as for Entry, one screen is exact and the other close. The
// numbers are the 1280x800 grid (the Echo Show 10), to three decimals: Chrome
// floors a percentage to 1/64 px, and every edge lands on the grid's own 1/64
// px there, so that screen draws exactly as before (two decimals missed by up
// to 4/64 px, enough to move text by a subpixel). At 1920x1080 every x edge is
// within 0.02 px, the tops of rows 1, 4, 5 and 6 sit 3.08, 1.58, 1.08 and 0.58
// px higher, and the bottoms at most 3.08 px lower.
//
// Every box is a card with the Board's padding (the photo fills its card).
// Knobs the Board sets against the schema defaults (which are the Entry
// board's): the clock in 600 with the greeting as its label, the weather
// stacked, four days of forecast.
const BOARD_PANELS = [
  {
    id: 'clock', type: 'clock', x: 1.6, y: 2.56, w: 31.468, h: 44.45, z: 1,
    props: { background: 'card', padding: 1, weight: 600, showGreeting: true },
  },
  {
    id: 'weather', type: 'weather', x: 34.267, y: 2.56, w: 31.468, h: 44.45, z: 2,
    props: { background: 'card', padding: 1, layout: 'stacked' },
  },
  {
    id: 'photo', type: 'photo', x: 66.934, y: 2.56, w: 31.468, h: 59.907, z: 3,
    props: { background: 'card', padding: 0 },
  },
  {
    id: 'forecast', type: 'forecast', x: 1.6, y: 48.928, w: 31.468, h: 48.512, z: 4,
    props: { background: 'card', padding: 1, days: 4 },
  },
  {
    id: 'sunmoon', type: 'sunmoon', x: 34.267, y: 48.928, w: 31.468, h: 28.995, z: 5,
    props: { background: 'card', padding: 1 },
  },
  {
    id: 'wear', type: 'wear', x: 34.267, y: 79.842, w: 31.468, h: 17.598, z: 6,
    props: { background: 'card', padding: 1 },
  },
  {
    id: 'nowplaying', type: 'nowplaying', x: 66.934, y: 64.385, w: 31.468, h: 33.055, z: 7,
    props: { background: 'card', padding: 1 },
  },
]

// Per layout: its default panels, the canvas it was measured on, and any
// global value it sets over GLOBAL_SCHEMA's defaults. None today: the schema's
// defaults are both boards' looks (surfaceOpacity 0.5 is the Entry board's
// translucent card, and the opaque cards, the Board's tiles among them, are at
// full strength from 0.5 up; tokens.css "Spec layouts").
const LAYOUTS = {
  entry: { panels: ENTRY_PANELS, canvas: { w: 1920, h: 1080 }, global: {} },
  board: { panels: BOARD_PANELS, canvas: { w: 1280, h: 800 }, global: {} },
}

const DEFAULT_BY_LAYOUT = Object.keys(LAYOUTS).reduce((acc, id) => {
  acc[id] = LAYOUTS[id].panels.reduce((m, p) => {
    m[p.type] = p
    return m
  }, {})
  return acc
}, {})

// Blocks and panels added by the editor sit above the built-in panels (z 1..7).
const ADDED_Z = 10

// Decimals kept on x, y, w, h. Chrome floors a percentage to 1/64 px; two
// decimals of a percent are 0.128 px steps across 1280 px, so a grid line
// can be missed by up to 4/64 px, which is enough to move text by a subpixel
// and container-unit type by a hair. Three decimals reach every 1/64 px on
// screens up to 1920 px. The editor's 2-decimal values read unchanged.
export const POSITION_PLACES = 3

// --- Small helpers ---------------------------------------------------------

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

// Decimal places of a number as written (0.05 -> 2, 5000 -> 0), at most 4.
// The same rule as the editor's (code/src/editor/util.js decimalsOf).
function decimalsOf(n) {
  if (!Number.isFinite(n)) return 0
  const s = String(n)
  const i = s.indexOf('.')
  if (i >= 0) return Math.min(4, s.length - i - 1)
  const m = /e-(\d+)$/.exec(s)
  return m ? Math.min(4, Number(m[1])) : 0
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

// --- Knob values ---------------------------------------------------------------

// The option of a select field matching v (3 matches '3'), or undefined.
function optionValue(field, v) {
  const opts = Array.isArray(field.options) ? field.options : []
  let loose
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i]
    const value = Array.isArray(o) ? o[0] : isDict(o) ? o.value : o
    if (value === v) return value
    if (loose === undefined && v != null && typeof v !== 'object' && String(value) === String(v)) loose = value
  }
  return loose
}

// A valid value for one schema field (a panel knob, a global): v when it is
// one (clamped and rounded to the step for a number), else the fallback (the
// layout's own default), else the field's default. The rules match the
// editor's cleanKnob (code/src/editor/schema.js), so the two sides agree.
function fieldValue(field, v, fallback) {
  const def = fallback === undefined ? field.default : fallback
  switch (field.type) {
    case 'number': {
      const lo = Number.isFinite(field.min) ? field.min : -Infinity
      const hi = Number.isFinite(field.max) ? field.max : Infinity
      const places = Number.isFinite(field.step) && field.step > 0
        ? Math.max(decimalsOf(field.step), decimalsOf(field.min), decimalsOf(field.max))
        : 4
      const n = toNum(v)
      const base = Number.isFinite(n) ? n : toNum(def)
      if (!Number.isFinite(base)) return Number.isFinite(field.default) ? field.default : null
      return round(clamp(base, lo, hi), places)
    }
    case 'select': {
      const hit = optionValue(field, v)
      if (hit !== undefined) return hit
      const back = optionValue(field, def)
      if (back !== undefined) return back
      const own = optionValue(field, field.default)
      if (own !== undefined) return own
      const first = Array.isArray(field.options) && field.options.length ? field.options[0] : null
      return Array.isArray(first) ? first[0] : isDict(first) ? first.value : first
    }
    case 'toggle':
      if (typeof v === 'boolean') return v
      return typeof def === 'boolean' ? def : field.default === true
    case 'color':
      return color(v, color(def, color(field.default, '#000000')))
    case 'text': {
      const max = Number.isFinite(field.maxLength) ? field.maxLength : TEXT_MAX_LENGTH
      if (typeof v === 'string') return v.length > max ? v.slice(0, max) : v
      if (typeof v === 'number' && Number.isFinite(v)) return String(v)
      return typeof def === 'string' ? def : ''
    }
    default:
      // A field type this build does not know: keep a JSON primitive.
      if (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return v
      return def === undefined ? null : def
  }
}

// A functional panel's knob fields, universal keys left out.
function knobFieldsOf(type) {
  if (isBlockType(type)) return []
  return fieldsOf(type).filter((f) => UNIVERSAL_KEYS.indexOf(f.key) < 0)
}

// --- Defaults per type -------------------------------------------------------

function layoutDefaultPanel(type, layoutId) {
  const table = DEFAULT_BY_LAYOUT[layoutIdOf(layoutId)]
  return has(table, type) ? table[type] : null
}

// The full default props for a type in a layout: what a missing prop is filled
// with. A functional panel's defaults are its props on that layout's default
// board (the Entry agenda is a card, its clock bare text; the Board's clock
// carries the greeting), over its knob defaults (panels/schemas.js); a type
// that board lacks starts as a card. So a hand-written spec that says less
// still looks like the board it came from.
export function defaultPropsFor(type, layoutId) {
  if (type === 'text') return { ...UNIVERSAL_DEFAULTS, ...TEXT_DEFAULTS }
  if (type === 'image') return { ...UNIVERSAL_DEFAULTS, ...IMAGE_DEFAULTS }
  const d = layoutDefaultPanel(type, layoutId)
  const extra = has(TYPE_EXTRAS, type) ? TYPE_EXTRAS[type].props : null
  return { ...UNIVERSAL_DEFAULTS, ...knobDefaults(type), ...(d ? d.props : extra) }
}

function defaultBoxFor(type, layoutId) {
  const d = layoutDefaultPanel(type, layoutId)
  if (d) return { x: d.x, y: d.y, w: d.w, h: d.h, z: d.z }
  const b = has(TYPE_EXTRAS, type) ? TYPE_EXTRAS[type].box : { x: 10, y: 10, w: 20, h: 20 }
  return { ...b, z: ADDED_Z }
}

// The default global of a layout: textScale 1, GLOBAL_SCHEMA's defaults, and
// the layout's own values over them.
function layoutGlobalDefaults(layoutId) {
  const out = { textScale: 1 }
  globalFields().forEach((f) => {
    out[f.key] = f.default
  })
  return { ...out, ...LAYOUTS[layoutIdOf(layoutId)].global }
}

// --- Normalizing ---------------------------------------------------------------

function normProps(raw, type, layoutId) {
  const r = isDict(raw) ? raw : {}
  const d = defaultPropsFor(type, layoutId)
  const out = {
    textScale: num(r.textScale, PROP_RANGES.textScale.min, PROP_RANGES.textScale.max, d.textScale),
    opacity: num(r.opacity, PROP_RANGES.opacity.min, PROP_RANGES.opacity.max, d.opacity),
    padding: num(r.padding, PROP_RANGES.padding.min, PROP_RANGES.padding.max, d.padding),
    background: oneOf(r.background, BACKGROUNDS, d.background),
    radius: num(r.radius, PROP_RANGES.radius.min, PROP_RANGES.radius.max, d.radius),
    align: oneOf(r.align, ALIGNS, d.align),
    scrim: oneOf(r.scrim, SCRIMS, d.scrim),
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
  } else {
    // The knobs: every field of the type's schema, validated; anything else
    // in the stored props is dropped.
    knobFieldsOf(type).forEach((f) => {
      out[f.key] = fieldValue(f, r[f.key], d[f.key])
    })
  }
  return out
}

// One panel, or null when it cannot be one (unknown type). The id is decided
// by the caller (functional: the type; block: validated or repaired).
function normPanel(raw, type, id, layoutId) {
  const t = panelType(type)
  const box = defaultBoxFor(type, layoutId)
  // Size first, so the position can be clamped to keep the whole box on the
  // canvas: 0 <= x, x + w <= 100, and the same vertically.
  const w = num(raw.w, t.min.w, 100, box.w, POSITION_PLACES)
  const h = num(raw.h, t.min.h, 100, box.h, POSITION_PLACES)
  const x = num(raw.x, 0, round(100 - w, POSITION_PLACES), box.x, POSITION_PLACES)
  const y = num(raw.y, 0, round(100 - h, POSITION_PLACES), box.y, POSITION_PLACES)
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
    props: normProps(raw.props, type, layoutId),
  }
}

// A panel list (the base's or a variant's).
function normPanels(list, layoutId) {
  const source = list.slice(0, MAX_PANELS)
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
    panels.push(normPanel(p, type, id, layoutId))
  })
  return panels
}

// A full global: textScale plus every GLOBAL_SCHEMA field, each the stored
// value when valid, else from `defaults` (the layout's, or for a variant the
// base's own global).
function normGlobal(raw, defaults) {
  const g = isDict(raw) ? raw : {}
  const out = {
    textScale: num(g.textScale, PROP_RANGES.textScale.min, PROP_RANGES.textScale.max, defaults.textScale),
  }
  globalFields().forEach((f) => {
    out[f.key] = fieldValue(f, g[f.key], defaults[f.key])
  })
  return out
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

function normVariants(raw, layoutId, baseGlobal) {
  if (!isDict(raw)) return null
  const out = {}
  VARIANT_DAYPARTS.forEach((k) => {
    const v = has(raw, k) ? raw[k] : null
    if (!isDict(v) || !Array.isArray(v.panels)) return
    const part = { panels: normPanels(v.panels, layoutId) }
    if (isDict(v.global)) part.global = normGlobal(v.global, baseGlobal)
    out[k] = part
  })
  return Object.keys(out).length ? out : null
}

// normalizeSpec(raw, { defaultSpec, layoutId }) -> a valid spec, from anything.
//
//   layoutId     'entry' (the default) or 'board': whose defaults fill what is
//                missing (boxes, props, knobs, globals, canvas)
//   defaultSpec  what a raw value that is not a spec becomes: the layout's
//                built-in default unless given; pass null to get null back
//
//   - not an object, or no panels array: a fresh copy of defaultSpec
//   - version forced to 2; canvas and global filled and clamped (global gains
//     font, accent, text, surfaceOpacity, radius: GLOBAL_SCHEMA's fields)
//   - panels: unknown types dropped; a functional type kept once (the first),
//     its id forced to its type; a block whose id is malformed or already
//     taken gets a fresh, deterministic 'text-xxxx' / 'image-xxxx'
//   - every number clamped to the contract's range and rounded (positions to
//     POSITION_PLACES decimals), each box kept on the canvas at no less than its type's
//     minimum size; missing props filled from the type's defaults in that
//     layout (a spec saved before `scrim` existed gets the layout's: 'soft'
//     on the Entry board's clock and headline); a functional panel's props
//     gain every knob of its schema, clamped to the schema's range; unknown
//     keys dropped
//   - eveningFrom: a whole hour 12..23, default 18
//   - variants (morning, evening, weekend): each kept when it has a panels
//     array, its panels normalised like the base's, its global (when given)
//     filled from the base's; absent when there are none
//
// Pure and deterministic, and idempotent: normalizeSpec(normalizeSpec(x))
// equals normalizeSpec(x). Always returns new objects (callers may mutate).
export function normalizeSpec(raw, options) {
  const o = isDict(options) ? options : {}
  const layoutId = layoutIdOf(o.layoutId)
  const defaultSpec = has(o, 'defaultSpec') ? o.defaultSpec : defaultSpecFor(layoutId)
  if (!isDict(raw) || !Array.isArray(raw.panels)) {
    return defaultSpec ? normalizeSpec(defaultSpec, { defaultSpec: null, layoutId }) : null
  }

  const global = normGlobal(raw.global, layoutGlobalDefaults(layoutId))
  const out = {
    version: SPEC_VERSION,
    canvas: normCanvas(raw.canvas, (defaultSpec && defaultSpec.canvas) || LAYOUTS[layoutId].canvas),
    global,
    panels: normPanels(raw.panels, layoutId),
    eveningFrom: num(raw.eveningFrom, EVENING_FROM_RANGE.min, EVENING_FROM_RANGE.max, EVENING_FROM_DEFAULT, 0),
  }
  const variants = normVariants(raw.variants, layoutId, global)
  if (variants) out.variants = variants
  return out
}

function buildDefault(layoutId) {
  const l = LAYOUTS[layoutId]
  return deepFreeze(
    normalizeSpec(
      {
        version: SPEC_VERSION,
        canvas: l.canvas,
        global: { textScale: 1, ...l.global },
        panels: l.panels,
      },
      { defaultSpec: null, layoutId }
    )
  )
}

// The built-in boards, normalized (every prop present) and frozen: copy them
// (normalizeSpec(DEFAULT_ENTRY_SPEC) returns a fresh copy) before editing.
export const DEFAULT_ENTRY_SPEC = buildDefault(ENTRY_LAYOUT_ID)
export const DEFAULT_BOARD_SPEC = buildDefault(BOARD_LAYOUT_ID)

// The built-in default spec of a spec layout ('entry', 'board'), else null.
export function defaultSpecFor(layoutId) {
  if (layoutId === BOARD_LAYOUT_ID) return DEFAULT_BOARD_SPEC
  if (layoutId === ENTRY_LAYOUT_ID || layoutId == null) return DEFAULT_ENTRY_SPEC
  return null
}

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

// newPanel(type, overrides, { layoutId }) -> a normalized functional panel
// (id === type) for the editor's "Add panel": its box and props are that
// layout's default for the type, or the type's own starting box (centred, above
// the built-in panels) and a card. overrides may set any panel field and any
// props. null for a type that is not a functional panel.
export function newPanel(type, overrides, options) {
  const t = panelType(type)
  if (!t || t.kind !== 'panel') return null
  const o = isDict(overrides) ? overrides : {}
  const layoutId = layoutIdOf(isDict(options) ? options.layoutId : null)
  const box = defaultBoxFor(type, layoutId)
  return normPanel(
    { ...box, hidden: false, locked: false, ...o, props: isDict(o.props) ? o.props : {} },
    type,
    type,
    layoutId
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
// `spec` may be a spec or variantPanels()'s { panels, global }.
export function layoutTextScale(spec, panel) {
  const g = toNum(spec && spec.global && spec.global.textScale)
  const p = toNum(panel && panel.props && panel.props.textScale)
  return round((Number.isFinite(g) ? g : 1) * (Number.isFinite(p) ? p : 1), 4)
}

// --- Day-part variants ------------------------------------------------------------

// Does the spec carry that variant (with a panel list)? 'day' always does.
export function hasVariant(spec, daypart) {
  if (daypart === 'day') return true
  if (!isVariantKey(daypart) || !spec || !isDict(spec.variants)) return false
  const v = has(spec.variants, daypart) ? spec.variants[daypart] : null
  return isDict(v) && Array.isArray(v.panels)
}

function minutesOf(hm) {
  return isDict(hm) && typeof hm.hour === 'number' && Number.isFinite(hm.hour)
    ? hm.hour * 60 + (typeof hm.minute === 'number' && Number.isFinite(hm.minute) ? hm.minute : 0)
    : null
}

// The school-morning window of a school settings object ({ autoShowAt,
// morningEndsAt }, as in settings.school): [start, end) in minutes of the
// day, start 5:00 and end 8:00 when unset (the shell's own floors).
const MORNING_START_MIN = 5 * 60
const MORNING_END_MIN = 8 * 60

// Is `now` inside the school-morning window? The window only: whether today
// is a school day is the caller's question.
export function inSchoolMorning(now, school) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false
  const start = minutesOf(school && school.autoShowAt)
  const end = minutesOf(school && school.morningEndsAt)
  const m = now.getHours() * 60 + now.getMinutes()
  return m >= (start == null ? MORNING_START_MIN : start) && m < (end == null ? MORNING_END_MIN : end)
}

// A school day: not flagged no-school, and a school weekday when the settings
// list them (settings.school.schoolDays, 0 = Sunday).
function isSchoolDay(now, school, noSchoolToday) {
  if (noSchoolToday === true) return false
  const days = school && Array.isArray(school.schoolDays) ? school.schoolDays : null
  return days ? days.indexOf(now.getDay()) >= 0 : true
}

// resolveDaypart({ now, school, noSchoolToday, spec }) -> 'day' | 'morning' |
// 'evening' | 'weekend': which of the spec's layouts to draw at `now`.
//
//   weekend  Saturday and Sunday, when the spec has that variant; else
//   morning  inside the school-morning window (school.autoShowAt until
//            school.morningEndsAt) on a school day, when it has that variant;
//            else
//   evening  from spec.eveningFrom (18 unless set) until midnight, when it has
//            that variant; else
//   day      the base.
//
// school is the school settings (settings.school: autoShowAt, morningEndsAt,
// schoolDays); noSchoolToday the house's flag for today (true on a holiday,
// and on a weekend). Pure: `now` is the only clock.
export function resolveDaypart(args) {
  const a = isDict(args) ? args : {}
  const now = a.now
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return 'day'
  const spec = a.spec
  const weekday = now.getDay()
  if ((weekday === 0 || weekday === 6) && hasVariant(spec, 'weekend')) return 'weekend'
  if (hasVariant(spec, 'morning') && isSchoolDay(now, a.school, a.noSchoolToday) && inSchoolMorning(now, a.school)) {
    return 'morning'
  }
  if (hasVariant(spec, 'evening')) {
    const from = num(spec && spec.eveningFrom, EVENING_FROM_RANGE.min, EVENING_FROM_RANGE.max, EVENING_FROM_DEFAULT, 0)
    if (now.getHours() >= from) return 'evening'
  }
  return 'day'
}

// variantPanels(spec, daypart) -> { panels, global, daypart }: what to draw for
// a day part. A variant the spec lacks (or 'day', or anything else) is the
// base; a variant's own global replaces the base's (merged over it, so a
// partial one still draws), else the base's applies. daypart is the one
// actually drawn.
export function variantPanels(spec, daypart) {
  const basePanels = spec && Array.isArray(spec.panels) ? spec.panels : []
  const baseGlobal = spec && isDict(spec.global) ? spec.global : { textScale: 1 }
  if (daypart === 'day' || !hasVariant(spec, daypart)) {
    return { panels: basePanels, global: baseGlobal, daypart: 'day' }
  }
  const v = spec.variants[daypart]
  return {
    panels: v.panels,
    global: isDict(v.global) ? { ...baseGlobal, ...v.global } : baseGlobal,
    daypart,
  }
}

// withVariant(spec, daypart, panels?, global?) -> a new spec with that day
// part's layout set: for 'morning' / 'evening' / 'weekend' the variant (made
// if missing), for 'day' the base. Without panels a missing variant starts as
// a copy of the base's panels ("Create Morning from Day") and an existing one
// keeps its own. global: undefined keeps what is there, null drops a variant's
// own global (it follows the base again), an object sets it. The input is not
// changed and nothing is normalised (run normalizeSpec before saving); the
// panel lists are copies, so editing the variant never edits the base.
export function withVariant(spec, daypart, panels, global) {
  if (!isDict(spec)) return spec
  const out = { ...spec }
  if (daypart === 'day') {
    if (Array.isArray(panels)) out.panels = cloneJson(panels)
    if (isDict(global)) out.global = cloneJson(global)
    return out
  }
  if (!isVariantKey(daypart)) return out
  const variants = isDict(spec.variants) ? { ...spec.variants } : {}
  const current = hasVariant(spec, daypart) ? spec.variants[daypart] : null
  const part = {
    panels: cloneJson(
      Array.isArray(panels) ? panels : current ? current.panels : Array.isArray(spec.panels) ? spec.panels : []
    ),
  }
  if (isDict(global)) part.global = cloneJson(global)
  else if (global === undefined && current && isDict(current.global)) part.global = cloneJson(current.global)
  variants[daypart] = part
  out.variants = variants
  return out
}

// withoutVariant(spec, daypart) -> a new spec without that variant (that day
// part draws the base again); `variants` goes when it is empty. 'day' cannot
// be removed: the spec comes back as a copy.
export function withoutVariant(spec, daypart) {
  if (!isDict(spec)) return spec
  const out = { ...spec }
  if (!isVariantKey(daypart) || !isDict(spec.variants)) return out
  const variants = { ...spec.variants }
  delete variants[daypart]
  if (Object.keys(variants).length) out.variants = variants
  else delete out.variants
  return out
}

// --- Rendering helpers (pure) ------------------------------------------------

// The panels to draw, bottom to top: hidden ones dropped, sorted by z with the
// spec's own order breaking ties (so DOM order is paint order). `spec` may be
// a spec or variantPanels()'s { panels, global }.
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

// A panel's knob values: every knob of its type, the stored value where there
// is one, else the schema default. {} for a block. What the renderer hands a
// functional panel as its `knobs` prop.
export function knobsOf(panel) {
  const type = panel && panel.type
  const out = {}
  if (typeof type !== 'string') return out
  const props = panel.props && typeof panel.props === 'object' ? panel.props : {}
  knobFieldsOf(type).forEach((f) => {
    out[f.key] = has(props, f.key) && props[f.key] != null ? props[f.key] : f.default
  })
  return out
}
