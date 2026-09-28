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
// A text field may carry `format` (layoutSpec.js fieldValue): 'entityId' (a
// Home Assistant entity id, trimmed and lower-cased, else empty), 'id' (an
// action id, trimmed) or 'entityIds' (a list of entity ids, kept as
// 'a.b, c.d'); and `ha`, which marks a knob holding a Home Assistant whitelist
// id, made a select of the live whitelist for the editor (panels/haParts.js
// withHaOptions, editBridge.js).
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

// A knob holding one Home Assistant whitelist id (chunk 5): text here, so the
// normaliser keeps whatever id is stored; a select of the live whitelist in
// the editor. `ha` says which list (panels/haParts.js), `format` how the
// normaliser cleans it.
function haRef(key, label, ha, format, element, hint, placeholder) {
  return withExtras({ key, label, type: 'text', default: '', maxLength: 255, placeholder, format, ha }, element, hint)
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

// --- Calendar views (docs/designs/panels-and-controls.md, chunk 3) ------------
//
// The options the calendar panels share, DAKboard's calendar settings as
// knobs (lib/calendarViews.js draws them): each panel takes the ones that
// mean something to it, the agenda included, and every default is the
// agenda's behaviour before they existed.
//   showLocation     the place under an event (placeOf: not the full address)
//   showEndTime      start and end ('9:00 - 10:30 am'), not just the start
//   showDescription  the first line of its description
//   legend           each calendar's colour and name, at the foot
//   showEmptyDays    agenda: a day with nothing says so; off, only days with
//                    events, up to two weeks ahead
//   futureOnly       leave out what is over (off: it stays, dimmed with dimPast)
//   dimPast          step back what is over
//   consolidate      the same event on two calendars (same title, start and
//                    end, or an invitation the hub listed once) once, with
//                    both colours
//   timeFormat       'auto' (the screen's own when it has one, else 12-hour),
//                    '12h' or '24h'
//   colorBy          'calendar' or 'none' (neutral bars and dots)
const TIME_FORMATS = [
  ['auto', 'Auto'],
  ['12h', '1:30 pm'],
  ['24h', '13:30'],
]

const CALENDAR_OPTIONS = {
  showLocation: (el, def = false) => toggle('showLocation', 'Location', def, el, 'The place, not the full address'),
  showEndTime: (el, def = false) => toggle('showEndTime', 'End time', def, el),
  showDescription: (el, def = false) => toggle('showDescription', 'Description', def, el, 'Its first line'),
  legend: (el, def = false) => toggle('legend', 'Calendar legend', def, el, "Each calendar's colour, at the foot"),
  showEmptyDays: (el, def = true) =>
    toggle('showEmptyDays', 'Empty days', def, el, 'Off: only days with events, up to two weeks ahead'),
  futureOnly: (el, def = false) =>
    toggle('futureOnly', 'Upcoming only', def, el, 'Off: finished events stay, dimmed with Dim finished'),
  dimPast: (el, def = true) => toggle('dimPast', 'Dim finished', def, el),
  consolidate: (el, def = false) =>
    toggle('consolidate', 'Merge shared events', def, el, 'The same event on two calendars once, with both colours'),
  timeFormat: (el, def = 'auto') =>
    select('timeFormat', 'Time format', TIME_FORMATS, def, el, "Auto: the screen's own, else 1:30 pm"),
  colorBy: (el, def = 'calendar') =>
    select(
      'colorBy',
      'Colour by',
      [
        ['calendar', 'Calendar'],
        ['none', 'None'],
      ],
      def,
      el
    ),
}

// The shared options a panel takes, in this order: [key, element, default?].
function calendarOptions(list) {
  return list.map(([key, el, def]) => CALENDAR_OPTIONS[key](el, def))
}
// --- end calendar views ---

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

  // --- Blocks and clocks (docs/designs/panels-and-controls.md, chunk 4) ------
  // The shape is a block (any number of them, layoutSpec.js BLOCK_TYPES);
  // the rest are panels. The clocks read the layout's one `now`
  // (useTodayData); the analog clock's seconds hand keeps its own tick.
  shape: {
    fields: [
      select(
        'kind',
        'Shape',
        [
          ['rect', 'Rectangle'],
          ['line', 'Line'],
        ],
        'rect',
        null,
        'Line: a 2 px line across the middle of the box, in the fill colour'
      ),
      select(
        'fillPreset',
        'Fill',
        [
          ['surface', 'Card'],
          ['accent', 'Accent'],
          ['custom', 'Custom'],
        ],
        'surface',
        null,
        "Card: the layout's card at its opacity. Custom: the fill colour under Fill and border"
      ),
    ],
  },

  flipclock: {
    fields: [
      toggle('hour24', '24-hour', false, 'hour', '00 to 23, and no AM / PM tab'),
      toggle('showMeridiem', 'AM / PM tab', true, 'tab'),
      toggle('showDate', 'Date', true, 'date'),
      withExtras(
        { key: 'scale', label: 'Scale', type: 'number', min: 0.5, max: 1.5, step: 0.05, unit: 'x', default: 1 },
        null,
        '1 fills the box; above it the box crops the clock'
      ),
    ],
  },

  analog: {
    fields: [
      select(
        'style',
        'Style',
        [
          ['minimal', 'Minimal'],
          ['classic', 'Classic'],
          ['numerals', 'Numerals'],
        ],
        'classic',
        'face',
        'Minimal: hour marks. Classic: minute marks too. Numerals: 1 to 12'
      ),
      toggle('showSeconds', 'Seconds hand', false, 'hands'),
      select(
        'handColor',
        'Hands',
        [
          ['auto', 'Auto'],
          ['accent', 'Accent'],
          ['text', 'Text'],
        ],
        'auto',
        'hands',
        'Auto: the text colour, the seconds hand in the accent'
      ),
      withExtras({ key: 'faceOpacity', label: 'Face opacity', type: 'number', min: 0, max: 1, step: 0.05, default: 1 }, 'face', '0: the marks and hands alone'),
    ],
  },

  clock2: {
    fields: [
      withExtras(
        { key: 'timezone', label: 'Time zone', type: 'text', default: 'Europe/London', maxLength: 64, placeholder: 'e.g. Asia/Tokyo' },
        'time',
        "An IANA zone. One this screen does not know shows this screen's time, marked ?"
      ),
      withExtras({ key: 'label', label: 'Label', type: 'text', default: '', maxLength: 40, placeholder: "The zone's city" }, 'label', "Empty: the zone's city"),
      toggle('hour24', '24-hour', false, 'time'),
      toggle('showDate', 'Date', true, 'date'),
      toggle('showOffset', 'Offset', true, 'offset', 'Hours ahead of or behind this screen, as +8h'),
      size('size', 'Size'),
    ],
  },

  date: {
    fields: [
      select(
        'format',
        'Format',
        [
          ['long', 'Saturday, September 26'],
          ['medium', 'Sat, Sep 26'],
          ['short', '9/26'],
          ['dayname', 'Saturday'],
          ['daynumber', 'Big day number'],
        ],
        'long',
        'text',
        'Big day number: the day large, the month small above it'
      ),
      toggle('showYear', 'Year', false, 'year', 'Not with the day name alone'),
      size('size', 'Size', 'text'),
      // The universal align, declared here as the text block does, so the
      // inspector shows it with the date's own settings (centred by default).
      select(
        'align',
        'Align',
        [
          ['start', 'Left'],
          ['center', 'Centre'],
          ['end', 'Right'],
        ],
        'center'
      ),
    ],
  },

  daycount: {
    fields: [
      select(
        'show',
        'Count',
        [
          ['weekOfYear', 'Week of the year'],
          ['dayOfYear', 'Day of the year'],
          ['daysLeftInYear', 'Days left this year'],
          ['schoolDays', 'School days left'],
        ],
        'weekOfYear',
        'number',
        "Week: the ISO week (Monday first). School days: to the dashboard's last day of school, else the school calendar's; hidden when there is neither"
      ),
      withExtras({ key: 'label', label: 'Label', type: 'text', default: '', maxLength: 60, placeholder: 'Automatic' }, 'label', 'Empty: what the count is, as Week of the year'),
      size('size', 'Size'),
    ],
  },
  // --- end blocks and clocks ---

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
      select(
        'style',
        'Style',
        [
          ['rows', 'Side by side'],
          ['band', 'Bars'],
        ],
        'rows',
        'bar',
        "Bars: a day per line, a bar from its low to its high on the week's range"
      ),
    ],
  },

  // --- Weather panels (docs/designs/panels-and-controls.md, chunk 2) ---------
  // The hub's one weather feed (hooks/useHubWeather.js), through useTodayData.
  // `mode` ("Show") picks the moments (lib/hourlyMoments.js): Next hours
  // (`next`, the default, so every block saved before the modes reads as it
  // did: "Now", then every `step` hours on the clock, for the next `hours`
  // hours or through today's `untilHour`, lib/weatherPanels.js
  // hourlyColumns), Now until (`untilEnd`: Now, then `count` - 1 moments to
  // `endHour`), Whole day (`wholeDay`: `count` moments from `startHour` to
  // `endHour`, the past dimmed, a line at now; what a new block starts with,
  // layoutSpec.js TYPE_TABLE startKnobs), Day parts (`dayParts`) or Set
  // times (`setTimes`: `times`, 24-hour 'H:MM', comma-separated). Every mode
  // after its end shows tomorrow. `showIf` says which mode (and range) each
  // field belongs to; startHour and endHour are one two-handle hour slider
  // in an editor that knows `ui: 'hourRange'`, and `times` chips with
  // `ui: 'timeList'` (`max` of them); elsewhere they are plain fields. The
  // mode and its own fields name the hour labels as their element, so the
  // inspector draws them first (it groups a type's fields by element, in the
  // order the fields first name each); the shared look follows.
  hourly: {
    fields: [
      select(
        'mode',
        'Show',
        [
          ['next', 'Next hours'],
          ['untilEnd', 'Now until'],
          ['wholeDay', 'Whole day'],
          ['dayParts', 'Day parts'],
          ['setTimes', 'Set times'],
        ],
        'next',
        'hour',
        'Whole day: the hours past dimmed, a line at now. Every mode shows tomorrow after its end'
      ),
      {
        ...select(
          'range',
          'Range',
          [
            ['hours', 'Next hours'],
            ['untilHour', 'Rest of day'],
          ],
          'hours',
          'hour',
          'Rest of day: from now through the hour set below'
        ),
        showIf: { mode: 'next' },
      },
      { ...count('hours', 'Hours', 6, 24, 12, 'hour', 'From this hour (Range: Next hours)'), showIf: { mode: 'next', range: 'hours' } },
      {
        ...select(
          'untilHour',
          'Until',
          [
            [18, '6 pm'],
            [19, '7 pm'],
            [20, '8 pm'],
            [21, '9 pm'],
            [22, '10 pm'],
            [23, '11 pm'],
            [24, 'Midnight'],
          ],
          22,
          'hour',
          'Through that hour (Range: Rest of day)'
        ),
        showIf: { mode: 'next', range: 'untilHour' },
      },
      {
        ...select(
          'step',
          'Every',
          [
            [1, '1 h'],
            [2, '2 h'],
            [3, '3 h'],
            [4, '4 h'],
          ],
          1,
          'hour',
          'Now, then the hours on the clock the step divides: every 3 h is 3, 6, 9 pm'
        ),
        showIf: { mode: 'next' },
      },
      {
        ...count('count', 'Moments', 3, 12, 6, 'hour', 'Both ends exact, those between on the nearest hour (Now until: Now is one)'),
        showIf: { mode: ['untilEnd', 'wholeDay'] },
      },
      {
        ...count('startHour', 'Hours', 0, 23, 8, 'hour', 'From the first hour to the last; from the last on, tomorrow'),
        ui: 'hourRange',
        pair: 'endHour',
        showIf: { mode: 'wholeDay' },
      },
      {
        ...count('endHour', 'Until', 1, 24, 22, 'hour', 'The last moment (24 is midnight); from its hour on, tomorrow'),
        ui: 'hourRange',
        pairOf: 'startHour',
        showIf: { mode: ['wholeDay', 'untilEnd'] },
      },
      {
        key: 'times',
        label: 'Times',
        type: 'text',
        ui: 'timeList',
        default: '7:30,12:00,15:15,18:00',
        max: 8,
        maxLength: 120,
        placeholder: '7:30,12:00,18:00',
        element: 'hour',
        hint: "Up to eight, 24-hour; after the last, tomorrow's",
        showIf: { mode: 'setTimes' },
      },
      select(
        'columns',
        'Columns',
        [
          ['auto', 'Auto'],
          [6, '6'],
          [8, '8'],
          [12, '12'],
        ],
        'auto',
        null,
        'Hours past the columns wrap to another row'
      ),
      select(
        'style',
        'Temperature line',
        [
          ['columns', 'None'],
          ['curve', 'Curve'],
        ],
        'columns',
        'curve',
        'Curve: a line through the temperatures, above the numbers'
      ),
      toggle('showRain', 'Rain chance', true, 'rain', 'In the accent from 20%'),
      toggle('showFeelsLike', 'Feels like', false, 'feels'),
      toggle('showWind', 'Wind', false, 'wind'),
      size('size', 'Size'),
      size('iconSize', 'Icon size', 'icon'),
    ],
  },

  conditions: {
    fields: [
      select(
        'layout',
        'Layout',
        [
          ['auto', 'Auto'],
          ['one', 'One column'],
          ['two', 'Two columns'],
        ],
        'auto',
        null,
        'Auto: two columns when the box is wide'
      ),
      toggle('showCondition', 'Sky now', true, 'condition', 'The icon and its word, above the rows'),
      toggle('showFeelsLike', 'Feels like', true, 'value'),
      toggle('showHumidity', 'Humidity', true, 'value'),
      toggle('showWind', 'Wind', true, 'value'),
      toggle('showGusts', 'Gusts', false, 'value'),
      toggle('showUv', 'UV index', true, 'value'),
      toggle('showPressure', 'Pressure', false, 'value'),
      toggle('showVisibility', 'Visibility', false, 'value'),
      toggle('showDewPoint', 'Dew point', false, 'value'),
      toggle('showSunrise', 'Sunrise', true, 'value'),
      toggle('showSunset', 'Sunset', true, 'value'),
      toggle('showCloudCover', 'Cloud cover', false, 'value'),
      size('size', 'Size'),
    ],
  },

  precip: {
    fields: [
      count('hours', 'Hours', 12, 48, 24, 'bar', 'From this hour; a label every 3 hours, every 6 past a day'),
      size('size', 'Size'),
    ],
  },

  alert: {
    fields: [size('size', 'Size', 'event')],
  },
  // --- end weather panels ---

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
      // 'auto' joined with the calendar views (chunk 3); the agenda's
      // default stays '12h', which is what auto means today.
      select('timeFormat', 'Time format', TIME_FORMATS, '12h', 'rows', "Auto: the screen's own, else 1:30 pm"),
      toggle('showAllDayLabel', 'All-day label', true, 'rows'),
      toggle('dimPast', 'Dim finished', true, 'rows'),
      factor('columnGap', 'Column gap'),
      toggle('showColorBars', 'Colour bars', true, 'rows'),
      // --- Row layouts (2026-09-27): each default is the agenda as it was ---
      select(
        'rowLayout',
        'Row layout',
        [
          ['side', 'Time beside'],
          ['stacked', 'Time above'],
          ['timeRight', 'Time right'],
        ],
        'side',
        'rows',
        "Time above: in small capitals over the title. Time right: at the row's end, quieter"
      ),
      select(
        'titleLines',
        'Title lines',
        [
          [1, 'One'],
          [2, 'Two'],
        ],
        2,
        'rows',
        'Past them the title ends in an ellipsis'
      ),
      select(
        'dayHeader',
        'Day header',
        [
          ['caps', 'Capitals'],
          ['bold', 'Bold'],
          ['compact', 'Compact'],
        ],
        'caps',
        'header',
        'Bold: the day in its own words. Compact: smaller, with no rule'
      ),
      withExtras({ key: 'rowGap', label: 'Row gap', type: 'number', min: 0, max: 2, step: 0.1, unit: 'x', default: 1 }, 'rows'),
      // --- Calendar views (chunk 3): the shared options, off by default ---
      ...calendarOptions([
        ['showLocation', 'location'],
        ['showEndTime', 'rows'],
        ['showDescription', 'description'],
        ['legend', 'legend'],
        ['showEmptyDays', 'rows'],
        ['futureOnly', 'rows'],
        ['consolidate', 'rows'],
        ['colorBy', 'rows'],
      ]),
      // --- end calendar views ---
    ],
  },

  // --- Calendar views (docs/designs/panels-and-controls.md, chunk 3) ---------
  // The family calendar from the hub (hooks/useCalendar.js), drawn by
  // lib/calendarViews.js. On no default board; they arrive through Add panel.
  upnext: {
    fields: [
      count('count', 'Rows after', 0, 6, 3, 'rows', 'The events after the next one'),
      withExtras({ key: 'hoursAhead', label: 'Looks ahead', type: 'number', min: 12, max: 72, step: 6, unit: 'h', default: 48 }, null, 'Hours from now'),
      size('nextSize', 'Next event size', 'next'),
      size('rowSize', 'Row size', 'rows'),
      ...calendarOptions([
        ['showLocation', 'nextLocation'],
        ['showEndTime', 'nextTime'],
        ['showDescription', 'description'],
        ['legend', 'legend'],
        ['consolidate', 'next'],
        ['timeFormat', 'time'],
        ['colorBy', 'next'],
      ]),
    ],
  },

  daylist: {
    fields: [
      select(
        'day',
        'Day',
        [
          ['today', 'Today'],
          ['tomorrow', 'Tomorrow'],
        ],
        'today',
        'header'
      ),
      count('maxRows', 'Rows', 3, 14, 8, 'rows', 'Finished events give up their place first'),
      size('rowSize', 'Row size', 'rows'),
      size('headerSize', 'Header size', 'header'),
      ...calendarOptions([
        ['showLocation', 'location'],
        ['showEndTime', 'time'],
        ['showDescription', 'description'],
        ['legend', 'legend'],
        ['futureOnly', 'rows'],
        ['dimPast', 'rows'],
        ['consolidate', 'rows'],
        ['timeFormat', 'time'],
        ['colorBy', 'rows'],
      ]),
    ],
  },

  weekgrid: {
    fields: [
      select(
        'startDay',
        'Starts',
        [
          ['today', 'Today'],
          ['monday', 'Monday'],
          ['sunday', 'Sunday'],
        ],
        'today',
        'dayHeader'
      ),
      count('days', 'Days', 5, 7, 7, 'dayHeader'),
      count('startHour', 'From', 5, 12, 7, 'hourLabel', 'Hour of the first row (7 = 7 am)'),
      count('endHour', 'To', 17, 24, 21, 'hourLabel', 'Hour the last row ends (21 = 9 pm)'),
      toggle('showAllDay', 'All-day band', true, 'allday', 'All-day and multi-day events across the top'),
      toggle('hourLabels', 'Hour labels', true, 'hourLabel'),
      toggle('compact', 'Compact', false, 'block', 'Shorter rows: an event and a day header on one line each'),
      size('size', 'Size', 'block'),
      ...calendarOptions([
        ['showLocation', 'block'],
        ['showEndTime', 'block'],
        ['legend', 'legend'],
        ['futureOnly', 'block'],
        ['dimPast', 'block'],
        ['consolidate', 'block'],
        ['timeFormat', 'block'],
        ['colorBy', 'block'],
      ]),
    ],
  },

  monthgrid: {
    fields: [
      select(
        'month',
        'Month',
        [
          ['current', 'This month'],
          ['next', 'Next month'],
        ],
        'current',
        'monthLabel'
      ),
      select(
        'weekStart',
        'Week starts',
        [
          ['sunday', 'Sunday'],
          ['monday', 'Monday'],
        ],
        'sunday',
        'weekday'
      ),
      select(
        'mode',
        'Show',
        [
          ['dots', 'Dots'],
          ['titles', 'Titles'],
        ],
        'dots',
        'day',
        'Dots suit a small screen; titles the Echo Show 15'
      ),
      count('titlesPerDay', 'Titles per day', 1, 4, 3, 'event', 'Titles: more show as +n'),
      toggle('showOtherMonths', 'Other months', true, 'day', 'The days before and after, dimmed'),
      size('size', 'Size', 'day'),
      ...calendarOptions([
        ['legend', 'legend'],
        ['futureOnly', 'day'],
        ['dimPast', 'day'],
        ['consolidate', 'dot'],
        ['timeFormat', 'event'],
        ['colorBy', 'dot'],
      ]),
    ],
  },
  // --- end calendar views ---

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
      toggle(
        'schoolDeparture',
        'School departure',
        false,
        null,
        'On: during the school morning (or a manual timer) this block shows the leave-by countdown instead of the tiles'
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

  // --- Home Assistant (docs/designs/panels-and-controls.md, chunk 5) --------
  // The dashboard's whitelist (hooks/useHomeAssistant.js), through
  // useTodayData. Empty ids draw an honest "Choose ..." rather than a guess.
  hastatus: {
    fields: [
      haRef('entity', 'Entity', 'entity', 'entityId', 'state', "From the dashboard's Home Assistant whitelist", 'e.g. cover.garage_door_controller'),
      toggle('showLabel', 'Label', true, 'label'),
      toggle('showSince', 'Since', true, 'since', 'When it last changed: since 4:12 pm'),
      size('size', 'Size'),
      select(
        'layout',
        'Layout',
        [
          ['row', 'Side by side'],
          ['stacked', 'Stacked'],
        ],
        'row',
        null,
        'Side by side suits a wide box, stacked a tall one'
      ),
    ],
  },

  habutton: {
    fields: [
      haRef('action', 'Action', 'action', 'id', 'label', "From the dashboard's whitelist. A hold action fires after a 1.2 s press", 'e.g. garage-toggle'),
      size('size', 'Size'),
      select(
        'style',
        'Style',
        [
          ['filled', 'Filled'],
          ['outline', 'Outline'],
        ],
        'filled',
        null
      ),
      toggle('showState', 'State', false, 'state', "Its entity's state, under the label"),
    ],
  },

  hachips: {
    fields: [
      withExtras(
        {
          key: 'entities',
          label: 'Entities',
          type: 'text',
          default: '',
          maxLength: 2000,
          placeholder: 'input_boolean.mode_away, input_boolean.mode_guest',
          format: 'entityIds',
          ha: 'entityList',
        },
        'chip',
        'Entity ids, separated by commas; empty shows every mode.'
      ),
      size('size', 'Size', 'chip'),
      toggle('showLabels', 'Labels', true, 'label'),
    ],
  },

  hapicker: {
    fields: [
      haRef('entity', 'Select', 'selectEntity', 'entityId', 'option', 'An input_select on the whitelist', 'e.g. input_select.day_part_override'),
      haRef('action', 'Action', 'optionAction', 'id', 'option', 'Automatic: the whitelisted action that sets this select', 'e.g. daypart-set'),
      size('size', 'Size', 'option'),
      toggle('wrap', 'Wrap', true, 'option', 'Options run onto another row when they do not fit one'),
    ],
  },
  // --- end Home Assistant ---

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
  // --- Blocks and clocks (chunk 4). The shape has no content: its title is
  // its only element. The date's line holds its parts, so it comes first. ---
  shape: [TITLE],
  flipclock: [
    TITLE,
    { key: 'hour', label: 'Hour' },
    { key: 'minutes', label: 'Minutes' },
    { key: 'tab', label: 'AM / PM tab' },
    { key: 'date', label: 'Date' },
  ],
  analog: [TITLE, { key: 'face', label: 'Face' }, { key: 'numerals', label: 'Numerals' }, { key: 'hands', label: 'Hands' }],
  clock2: [
    TITLE,
    { key: 'label', label: 'Label' },
    { key: 'time', label: 'Time' },
    { key: 'date', label: 'Date' },
    { key: 'offset', label: 'Offset' },
  ],
  date: [
    TITLE,
    { key: 'text', label: 'Date' },
    { key: 'weekday', label: 'Weekday' },
    { key: 'month', label: 'Month' },
    { key: 'day', label: 'Day' },
    { key: 'year', label: 'Year' },
  ],
  daycount: [TITLE, { key: 'number', label: 'Number' }, { key: 'label', label: 'Label' }],
  // --- end blocks and clocks ---
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
    { key: 'bar', label: 'High-low bar' },
    EMPTY,
  ],
  // --- Weather panels (chunk 2). Their Apple Weather mark is marked
  // data-edit="attribution" but deliberately left out of these lists, so no
  // element style can hide or restyle it (panels/WeatherAttribution.jsx). ---
  // The header ("Today", "Tomorrow") is the title; the now line is Whole
  // day's (lib/hourlyMoments.js).
  hourly: [
    TITLE,
    { key: 'hour', label: 'Hour' },
    { key: 'icon', label: 'Icon' },
    { key: 'curve', label: 'Temperature line' },
    { key: 'temp', label: 'Temperature' },
    { key: 'feels', label: 'Feels like' },
    { key: 'rain', label: 'Rain chance' },
    { key: 'wind', label: 'Wind' },
    { key: 'nowLine', label: 'Now line' },
    EMPTY,
  ],
  conditions: [
    TITLE,
    { key: 'icon', label: 'Icon' },
    { key: 'condition', label: 'Sky now' },
    { key: 'label', label: 'Label' },
    { key: 'value', label: 'Value' },
    EMPTY,
  ],
  precip: [
    TITLE,
    { key: 'nextHour', label: 'Next hour' },
    { key: 'bar', label: 'Bars' },
    { key: 'label', label: 'Labels' },
    EMPTY,
  ],
  alert: [
    TITLE,
    { key: 'event', label: 'Event' },
    { key: 'until', label: 'Until' },
    { key: 'headline', label: 'Headline' },
  ],
  // --- end weather panels ---
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
    // --- Calendar views (chunk 3): the shared options' parts ---
    { key: 'location', label: 'Location' },
    { key: 'description', label: 'Description' },
    { key: 'legend', label: 'Legend' },
  ],
  // --- Calendar views (chunk 3) ---
  upnext: [
    TITLE,
    { key: 'updated', label: 'Updated' },
    { key: 'next', label: 'Next event' },
    { key: 'nextIn', label: 'Starts in' },
    { key: 'nextTime', label: 'Time' },
    { key: 'nextLocation', label: 'Location' },
    { key: 'description', label: 'Description' },
    { key: 'rows', label: 'Following events' },
    { key: 'day', label: 'Day' },
    { key: 'row', label: 'Event' },
    { key: 'time', label: 'Event time' },
    { key: 'legend', label: 'Legend' },
    EMPTY,
  ],
  daylist: [
    TITLE,
    { key: 'updated', label: 'Updated' },
    { key: 'header', label: 'Date' },
    { key: 'allday', label: 'All-day events' },
    { key: 'rows', label: 'Events' },
    { key: 'row', label: 'Event' },
    { key: 'time', label: 'Time' },
    { key: 'location', label: 'Location' },
    { key: 'description', label: 'Description' },
    { key: 'legend', label: 'Legend' },
    EMPTY,
  ],
  weekgrid: [
    TITLE,
    { key: 'updated', label: 'Updated' },
    { key: 'dayHeader', label: 'Day header' },
    { key: 'hourLabel', label: 'Hour labels' },
    { key: 'allday', label: 'All-day band' },
    { key: 'block', label: 'Event' },
    { key: 'more', label: 'More' },
    { key: 'nowLine', label: 'Now line' },
    { key: 'legend', label: 'Legend' },
    EMPTY,
  ],
  monthgrid: [
    TITLE,
    { key: 'monthLabel', label: 'Month' },
    { key: 'updated', label: 'Updated' },
    { key: 'weekday', label: 'Weekdays' },
    { key: 'day', label: 'Day' },
    { key: 'dayNumber', label: 'Date' },
    { key: 'dot', label: 'Dots' },
    { key: 'event', label: 'Event titles' },
    { key: 'more', label: 'More' },
    { key: 'legend', label: 'Legend' },
    EMPTY,
  ],
  // --- end calendar views ---
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
  // --- Home Assistant (chunk 5). A chip holds its label and state, so it
  // comes first. 'empty' and 'hint' carry the honest states (not connected,
  // not on the whitelist, buttons off). ---
  hastatus: [
    TITLE,
    { key: 'icon', label: 'Icon' },
    { key: 'label', label: 'Label' },
    { key: 'state', label: 'State' },
    { key: 'since', label: 'Since' },
    EMPTY,
  ],
  habutton: [
    TITLE,
    { key: 'icon', label: 'Icon' },
    { key: 'label', label: 'Label' },
    { key: 'state', label: 'State' },
    { key: 'hint', label: 'Hint' },
  ],
  hachips: [TITLE, { key: 'chip', label: 'Chip' }, { key: 'label', label: 'Label' }, { key: 'state', label: 'State' }, EMPTY],
  hapicker: [TITLE, { key: 'option', label: 'Option' }, { key: 'hint', label: 'Hint' }],
  // --- end Home Assistant ---
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
