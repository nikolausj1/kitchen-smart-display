// schemas.js - the knobs every functional panel declares, as plain data
// (docs/designs/layout-editor.md, Contract v2, "Panel knobs and schemas").
// Pure: no React, no DOM, importable from Node; its one import is the font
// registry (lib/fonts.js, pure data too). The editor renders its inspector
// from these fields, the layout spec normalises a panel's knob props against
// them, and the panels read the values as their `knobs` prop.
//
// A field:
//   { key, label, type: 'number' | 'select' | 'toggle' | 'color' | 'text',
//     min, max, step, unit          number (a slider with a typed field)
//     options: [[value, label]]     select (segmented up to four, else a menu)
//     default                       what a missing value means
//     element                       the data-edit key inside the panel it tunes,
//                                   so selecting that sub-element in the editor
//                                   focuses its fields (absent: the whole panel)
//     hint }                        one line of help, optional
//
// Sizes are multipliers of the panel's own type size ('x'), on top of the
// universal textScale, so 1 is always "as designed". Every default reproduces
// the phase 1 Entry board exactly. The Board differs in a few knobs, which its
// default spec sets explicitly: clock weight 600 with the greeting on, weather
// 'stacked', forecast 4 days (the default already).
//
// Runtime rule (layoutSpec.js): this runs on the Echo's Silk, as old as
// Chrome 80. Plain ES2019 data and functions only.

import { FONTS } from '../lib/fonts.js'

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    Object.keys(o).forEach((k) => deepFreeze(o[k]))
  }
  return o
}

// --- Field builders ------------------------------------------------------------

function withExtras(field, element, hint) {
  if (element) field.element = element
  if (hint) field.hint = hint
  return field
}

// A type size, as a multiplier: 0.5x to 2.5x, 1 = as designed.
function size(key, label, element, hint) {
  return withExtras({ key, label, type: 'number', min: 0.5, max: 2.5, step: 0.05, unit: 'x', default: 1 }, element, hint)
}

// A multiplier that may go to zero (gaps, radii): 0x to 3x.
function factor(key, label, element, hint) {
  return withExtras({ key, label, type: 'number', min: 0, max: 3, step: 0.1, unit: 'x', default: 1 }, element, hint)
}

// A whole number.
function count(key, label, min, max, def, element, hint) {
  return withExtras({ key, label, type: 'number', min, max, step: 1, default: def }, element, hint)
}

function toggle(key, label, def, element, hint) {
  return withExtras({ key, label, type: 'toggle', default: def }, element, hint)
}

function select(key, label, options, def, element, hint) {
  return withExtras({ key, label, type: 'select', options, default: def }, element, hint)
}

// The art-above countdown card's own knobs (countdowns' 'artAbove' tiles and
// the single countdown; panels/CountdownCard.jsx, lib/tileColor.js).
function tileGradientField(element, hint) {
  const options = [
    ['down', 'Down'],
    ['diagonal', 'Diagonal'],
    ['none', 'None'],
  ]
  return select('tileGradient', 'Gradient', options, 'down', element, hint)
}

function tileColorFromField(element, hint) {
  const options = [
    ['auto', 'Auto'],
    ['marker', 'Marker'],
    ['calendar', 'Calendar'],
  ]
  return select('tileColorFrom', 'Colour from', options, 'auto', element, hint)
}

function artSizeField(hint) {
  return withExtras({ key: 'artSize', label: 'Art size', type: 'number', min: 0.4, max: 1.2, step: 0.05, unit: 'x', default: 0.8 }, 'image', hint)
}

function artOverlapField(hint) {
  return withExtras({ key: 'artOverlap', label: 'Art overlap', type: 'number', min: 0, max: 0.8, step: 0.05, default: 0.35 }, 'image', hint)
}

const COLOR_FROM_HINT = "Auto: the event's color: marker, else the art, else the calendar. Marker never reads the art"

const WEIGHTS = [
  [300, 'Light'],
  [400, 'Regular'],
  [600, 'Semibold'],
  [700, 'Bold'],
]

// --- The panels ----------------------------------------------------------------

export const PANEL_SCHEMAS = deepFreeze({
  clock: {
    fields: [
      size('timeSize', 'Time size', 'time'),
      size('dateSize', 'Date size', 'date'),
      select('weight', 'Weight', WEIGHTS, 300, 'time'),
      toggle('showDate', 'Date', true, 'date'),
      select(
        'dateStyle',
        'Date style',
        [
          ['long', 'Thursday, September 24'],
          ['short', 'Thu, Sep 24'],
          ['day', 'Thursday'],
        ],
        'long',
        'date'
      ),
      toggle('showSeconds', 'Seconds', false, 'time'),
      toggle('showGreeting', 'Greeting', false, 'greeting', 'Good morning, above the time'),
    ],
  },

  weather: {
    fields: [
      size('tempSize', 'Temperature size', 'temp'),
      size('iconSize', 'Icon size', 'icon'),
      select(
        'layout',
        'Layout',
        [
          ['horizontal', 'Side by side'],
          ['stacked', 'Stacked'],
        ],
        'horizontal',
        null,
        'Side by side suits a wide, short box'
      ),
      toggle('showHighLow', 'High and low', true, 'range'),
      toggle('showRain', 'Rain chance', true, 'range', 'Shown from 20%'),
      toggle('showDescription', 'Description', true, 'description'),
    ],
  },

  forecast: {
    fields: [
      count('days', 'Days', 3, 7, 4, null, 'Today first'),
      size('size', 'Size'),
      toggle('showHighLow', 'High and low', true, 'temps', 'Off shows the high only'),
      toggle('showIcons', 'Icons', true, 'icon'),
    ],
  },

  sunmoon: {
    fields: [size('size', 'Size'), toggle('showMoon', 'Moon', true, 'moon')],
  },

  wear: {
    fields: [
      size('size', 'Size', 'label'),
      toggle('showIcon', 'Icon', true, 'icon'),
      select(
        'lines',
        'Lines',
        [
          [1, 'One'],
          [2, 'Two'],
        ],
        2,
        'detail',
        'One: the advice alone. Two: the advice and its detail'
      ),
    ],
  },

  airquality: {
    fields: [
      select(
        'style',
        'Style',
        [
          ['chip', 'Chip'],
          ['inline', 'One line'],
        ],
        'chip'
      ),
      size('size', 'Size'),
      toggle('showPm25', 'PM2.5', true, 'detail'),
    ],
  },

  headline: {
    fields: [
      size('size', 'Size', 'text'),
      select('weight', 'Weight', WEIGHTS, 600, 'text'),
      toggle('showDot', 'Dot', true, 'text', 'Coloured by what the line is: now, soon, later'),
      count('maxLines', 'Max lines', 1, 3, 1, 'text', 'Past one line the text wraps and sizes to fit'),
    ],
  },

  agenda: {
    fields: [
      count('days', 'Days', 1, 5, 3, 'header'),
      select(
        'startDay',
        'Starts',
        [
          ['today', 'Today'],
          ['tomorrow', 'Tomorrow'],
        ],
        'today',
        'header'
      ),
      count('rowsPerDay', 'Rows per day', 2, 10, 6, 'rows', 'Rows size to fit; finished events give up their place first'),
      size('rowSize', 'Row size', 'rows'),
      size('headerSize', 'Header size', 'header'),
      select(
        'timeFormat',
        'Time format',
        [
          ['12h', '1:30 pm'],
          ['24h', '13:30'],
        ],
        '12h',
        'rows'
      ),
      toggle('showAllDayLabel', 'All-day label', true, 'rows'),
      toggle('dimPast', 'Dim finished', true, 'rows'),
      factor('columnGap', 'Column gap'),
      toggle('showColorBars', 'Colour bars', true, 'rows'),
    ],
  },

  countdowns: {
    fields: [
      count('maxTiles', 'Tiles', 1, 4, 3),
      select(
        'tileStyle',
        'Tile style',
        [
          ['card', 'Card'],
          ['bare', 'Bare'],
          ['imageOnly', 'Image only'],
          ['artAbove', 'Art above'],
        ],
        'card',
        'tile',
        'Bare: the image, title and number, nothing else. Art above: the art over a coloured card'
      ),
      select(
        'tileBorder',
        'Edge',
        [
          ['color', 'Calendar colour'],
          ['none', 'None'],
        ],
        'color',
        'tile'
      ),
      select(
        'tileBackground',
        'Background',
        [
          ['card', 'Translucent'],
          ['solid', 'Solid'],
          ['none', 'None'],
        ],
        'card',
        'tile'
      ),
      factor('tileRadius', 'Corner radius', 'tile'),
      tileGradientField('tile', 'Art above: the card runs from its colour to a darker shade'),
      tileColorFromField('tile', `Art above. ${COLOR_FROM_HINT}`),
      // The image already fills what the text leaves it, so it can only shrink.
      withExtras(
        { key: 'imageSize', label: 'Image size', type: 'number', min: 0.25, max: 1, step: 0.05, unit: 'x', default: 1 },
        'image',
        'Of the room the text leaves'
      ),
      artSizeField('Art above: of the card width'),
      artOverlapField("Art above: how much of the art's height dips into the card"),
      size('titleSize', 'Title size', 'name'),
      size('numberSize', 'Number size', 'number'),
      toggle('showUnit', 'Days label', true, 'unit'),
      factor('gap', 'Gap', null, 'Between the tiles'),
      select(
        'prefer',
        'Prefer',
        [
          ['art', 'Art'],
          ['emoji', 'Emoji'],
        ],
        'art',
        'image',
        'Which one a countdown with both shows'
      ),
    ],
  },

  // One countdown, big, drawn as an art-above card (panels/CountdownPanel.jsx).
  countdown: {
    fields: [
      select(
        'pick',
        'Show',
        [
          ['next', 'The next one'],
          ['title', 'By title'],
        ],
        'next',
        null,
        'The next one: the soonest countdown'
      ),
      {
        key: 'titleMatch',
        label: 'Title contains',
        type: 'text',
        default: '',
        maxLength: 80,
        placeholder: 'e.g. Minnesota',
        hint: 'By title: part of the countdown title, any case',
      },
      select(
        'layout',
        'Layout',
        [
          ['stacked', 'Art above'],
          ['side', 'Art left'],
        ],
        'stacked'
      ),
      tileGradientField(null, 'The card runs from its colour to a darker shade'),
      tileColorFromField(null, COLOR_FROM_HINT),
      factor('tileRadius', 'Corner radius'),
      artSizeField('Of the card: its width with the art above, its height with the art left'),
      artOverlapField("How much of the art's height (its width, art left) dips into the card"),
      size('titleSize', 'Title size', 'name'),
      size('numberSize', 'Number size', 'number'),
      toggle('showUnit', 'Days label', true, 'unit'),
      select(
        'prefer',
        'Prefer',
        [
          ['art', 'Art'],
          ['emoji', 'Emoji'],
        ],
        'art',
        'image',
        'Which one a countdown with both shows'
      ),
    ],
  },

  departure: {
    fields: [size('numberSize', 'Number size', 'number'), toggle('showToggle', 'Walk or drive button', true, 'toggle')],
  },

  nowplaying: {
    fields: [
      size('size', 'Size', 'track'),
      toggle('showArt', 'Album art', true, 'art'),
      toggle('showProgress', 'Progress', true, 'progress'),
    ],
  },

  photo: {
    fields: [
      // 0 is the screen's own slideshow interval, which the layout hands the
      // panel as its intervalMs prop (the Board's tile always followed it).
      select(
        'intervalMs',
        'Interval',
        [
          [0, 'Screen setting'],
          [15000, '15 s'],
          [20000, '20 s'],
          [30000, '30 s'],
          [45000, '45 s'],
          [60000, '1 min'],
          [120000, '2 min'],
          [300000, '5 min'],
          [600000, '10 min'],
        ],
        0,
        null,
        "Screen setting follows this screen's slideshow interval"
      ),
      select(
        'fit',
        'Fit',
        [
          ['cover', 'Fill'],
          ['contain', 'Whole photo'],
        ],
        'cover',
        'image'
      ),
      toggle('showCaption', 'Caption', true, 'caption'),
      toggle('showCounter', 'Counter', true, 'counter'),
    ],
  },

  school: {
    fields: [
      size('size', 'Size'),
      toggle('showLunch', 'Lunch', true, 'rows', 'Lunch and Grab & Go'),
      toggle('showActivities', 'Activities', true, 'rows'),
    ],
  },
})

// The sub-elements each panel marks with data-edit (the `element` of its
// fields point here), with the name the editor shows for them: "Clock > Date".
// The blocks are listed too; their own props are their schema (layoutSpec.js).
//
// Every visible part of a panel carries one of these keys, so the per-element
// styles (props.elements, layoutSpec.js ELEMENT_STYLE_SCHEMA) reach all of it.
// A key may mark several elements (every agenda column, every countdown tile)
// and a style on it styles them all. 'title' is the box's header row
// (PanelFrame): the panel's own title ("Weather"), or the custom title a box
// sets (the universal `title`); panels drawn without a header list it too,
// for that custom title. 'empty' is what a panel says with no data.
//
// Order matters: a key whose elements hold another key's (a countdown tile
// holds its number) comes first, so its styles are written first and the
// inner key's own win (Entry/specStyles.js).
const TITLE = { key: 'title', label: 'Title' }
const EMPTY = { key: 'empty', label: 'Empty message' }

export const PANEL_ELEMENTS = deepFreeze({
  clock: [
    { key: 'greeting', label: 'Greeting' },
    TITLE,
    { key: 'time', label: 'Time' },
    { key: 'date', label: 'Date' },
  ],
  weather: [
    TITLE,
    { key: 'updated', label: 'Updated' },
    { key: 'temp', label: 'Temperature' },
    { key: 'icon', label: 'Icon' },
    { key: 'description', label: 'Description' },
    { key: 'range', label: 'High and low' },
    EMPTY,
  ],
  forecast: [
    TITLE,
    { key: 'updated', label: 'Updated' },
    { key: 'day', label: 'Day' },
    { key: 'icon', label: 'Icon' },
    { key: 'temps', label: 'Temperatures' },
    { key: 'rain', label: 'Rain chance' },
    EMPTY,
  ],
  sunmoon: [
    TITLE,
    { key: 'arc', label: 'Sun arc' },
    { key: 'labels', label: 'Sunrise and sunset labels' },
    { key: 'times', label: 'Times' },
    { key: 'moon', label: 'Moon' },
    { key: 'phase', label: 'Moon phase' },
    EMPTY,
  ],
  wear: [
    TITLE,
    { key: 'icon', label: 'Icon' },
    { key: 'label', label: 'Advice' },
    { key: 'detail', label: 'Detail' },
    EMPTY,
  ],
  airquality: [
    TITLE,
    { key: 'number', label: 'Number' },
    { key: 'label', label: 'Label' },
    { key: 'detail', label: 'Detail' },
  ],
  headline: [TITLE, { key: 'text', label: 'Text' }],
  agenda: [
    TITLE,
    { key: 'header', label: 'Day header' },
    { key: 'rows', label: 'Events' },
    { key: 'message', label: 'Not connected' },
  ],
  countdowns: [
    TITLE,
    { key: 'tile', label: 'Tile' },
    { key: 'image', label: 'Image' },
    { key: 'name', label: 'Event name' },
    { key: 'number', label: 'Number' },
    { key: 'unit', label: 'Days label' },
    EMPTY,
  ],
  countdown: [
    TITLE,
    { key: 'image', label: 'Image' },
    { key: 'name', label: 'Event name' },
    { key: 'number', label: 'Number' },
    { key: 'unit', label: 'Days label' },
    EMPTY,
  ],
  departure: [
    TITLE,
    { key: 'number', label: 'Countdown' },
    { key: 'meta', label: 'Details' },
    { key: 'status', label: 'Status' },
    { key: 'toggle', label: 'Walk or drive' },
  ],
  nowplaying: [
    TITLE,
    { key: 'room', label: 'Room' },
    { key: 'art', label: 'Album art' },
    { key: 'track', label: 'Track' },
    { key: 'artist', label: 'Artist' },
    { key: 'album', label: 'Album' },
    { key: 'meta', label: 'Source' },
    { key: 'progress', label: 'Progress' },
  ],
  photo: [TITLE, { key: 'image', label: 'Photo' }, { key: 'caption', label: 'Caption' }, { key: 'counter', label: 'Counter' }, EMPTY],
  school: [TITLE, { key: 'rows', label: 'Rows' }, EMPTY],
  text: [TITLE, { key: 'text', label: 'Text' }],
  image: [TITLE, { key: 'image', label: 'Image' }],
})

// The data-edit keys of a type, in PANEL_ELEMENTS order ([] for none).
export function elementKeysOf(type) {
  const list = typeof type === 'string' && has(PANEL_ELEMENTS, type) ? PANEL_ELEMENTS[type] : null
  return Array.isArray(list) ? list.map((e) => e.key) : []
}

// --- Global ----------------------------------------------------------------------

// spec.global, applied as CSS variables on the layout root (tokens.css lists
// them): font -> --tl-font-display, accent -> --tl-accent, text -> --tl-fg
// (and --tl-fg-rgb), surfaceOpacity -> --tl-surface-alpha, radius ->
// --tl-radius-scale. textScale (Contract v1) is the layout spec's own.
export const GLOBAL_SCHEMA = deepFreeze({
  fields: [
    // The families are lib/fonts.js's; a box's own font (the universal
    // `font`, layoutSpec.js BOX_SCHEMA) picks from the same list.
    select(
      'font',
      'Display font',
      FONTS.map((f) => [f.id, f.label]),
      'inter',
      null,
      'The big type: time, temperature, headline, numbers'
    ),
    { key: 'accent', label: 'Accent', type: 'color', default: '#d9a066' },
    { key: 'text', label: 'Text colour', type: 'color', default: '#f2f2f0' },
    {
      key: 'surfaceOpacity',
      label: 'Card opacity',
      type: 'number',
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.5,
      hint: 'The translucent card over a photo',
    },
    factor('radius', 'Corner radius'),
  ],
})

// --- Helpers ---------------------------------------------------------------------

function has(o, k) {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function defaultsOf(schema) {
  const out = {}
  if (schema) {
    schema.fields.forEach((f) => {
      out[f.key] = f.default
    })
  }
  return out
}

// { key: default } for a type's knobs, a fresh object; {} for a type with none
// (the blocks, anything unknown).
export function knobDefaults(type) {
  return defaultsOf(typeof type === 'string' && has(PANEL_SCHEMAS, type) ? PANEL_SCHEMAS[type] : null)
}

// { key: default } for spec.global's v2 fields, a fresh object.
export function globalDefaults() {
  return defaultsOf(GLOBAL_SCHEMA)
}

// What a panel renders with: null when it was handed no knobs (a layout that
// is not drawn from a spec, like Briefing and Ambient: the panel renders
// exactly as it always has), else every knob of the type, the given value
// where there is one and the default otherwise. No clamping: the layout
// spec's normaliser owns validation.
export function panelKnobs(type, knobs) {
  if (knobs == null || typeof knobs !== 'object' || Array.isArray(knobs)) return null
  const out = knobDefaults(type)
  Object.keys(out).forEach((k) => {
    if (has(knobs, k) && knobs[k] != null) out[k] = knobs[k]
  })
  return out
}
