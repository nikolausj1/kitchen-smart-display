// Tests for the editor foundations in layoutSpec.js (docs/designs/
// panels-and-controls.md, chunk 1): element styles, the box v2 look, the
// visibility rules, and that a spec using none of them normalises exactly as
// before. Run from code/: node --test src/views/TodayLayouts/layoutSpec.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BOX_SCHEMA,
  DEFAULT_BOARD_SPEC,
  DEFAULT_ENTRY_SPEC,
  ELEMENT_STYLE_SCHEMA,
  FONTS,
  PANEL_TYPE_LIST,
  PANEL_TYPES,
  RULE_KINDS,
  cardJoins,
  clockDaypart,
  hasBoxSurface,
  isInstanceId,
  isSchoolMorning,
  knobsOf,
  newBlock,
  newPanel,
  normalizeElementStyles,
  normalizeSpec,
  normalizeWhen,
  panelType,
  ruleKindsUsed,
  ruleMatches,
  typeOfId,
} from './layoutSpec.js'
import { GLOBAL_SCHEMA, PANEL_ELEMENTS, PANEL_SCHEMAS, elementKeysOf } from './panels/schemas.js'

const V2_KEYS = ['elements', 'bg', 'border', 'shadow', 'blur', 'font', 'color', 'valign', 'title']

// A fixed clock: Thursday 2026-09-24, local time.
const at = (h, m = 0, day = 24) => new Date(2026, 8, day, h, m, 0)

// --- The schemas -----------------------------------------------------------------

test('ELEMENT_STYLE_SCHEMA is the contract, field for field', () => {
  const byKey = Object.fromEntries(ELEMENT_STYLE_SCHEMA.fields.map((f) => [f.key, f]))
  assert.deepEqual(Object.keys(byKey), ['hidden', 'size', 'weight', 'color', 'spaceAbove', 'spaceBelow', 'tracking', 'caps', 'fit'])
  assert.deepEqual(byKey.size, { key: 'size', type: 'number', label: 'Size', min: 0.5, max: 2.5, step: 0.05, default: 1, unit: 'x' })
  assert.equal(byKey.weight.default, null)
  assert.deepEqual(byKey.weight.options.map((o) => o[0]), [null, 300, 400, 500, 600, 700, 800])
  assert.deepEqual(byKey.tracking, { key: 'tracking', type: 'number', label: 'Letter spacing', min: -0.05, max: 0.2, step: 0.01, default: 0, unit: 'em' })
  assert.deepEqual(byKey.fit.options.map((o) => o[0]), ['wrap', 'shrink', 'clip'])
  assert.equal(byKey.color.nullable, true)
})

test('BOX_SCHEMA has one field per leaf, keyed by path, fonts from the registry', () => {
  const keys = BOX_SCHEMA.fields.map((f) => f.key)
  assert.deepEqual(keys, [
    'bg.color', 'bg.color2', 'bg.gradient', 'bg.opacity', 'border.width', 'border.color',
    'shadow', 'blur', 'font', 'color', 'valign', 'title.mode', 'title.text',
  ])
  BOX_SCHEMA.fields.forEach((f) => assert.deepEqual(f.path, f.key.split('.')))
  const font = BOX_SCHEMA.fields.find((f) => f.key === 'font')
  assert.deepEqual(font.options.map((o) => o[0]), ['inherit'].concat(FONTS.map((x) => x.id)))
  const globalFont = GLOBAL_SCHEMA.fields.find((f) => f.key === 'font')
  assert.deepEqual(globalFont.options.map((o) => o[0]), FONTS.map((x) => x.id))
})

test('RULE_KINDS lists the contract kinds with their parameters', () => {
  assert.deepEqual(RULE_KINDS.map((k) => k.kind), [
    'schoolMorning', 'weekend', 'weekday', 'daypart', 'timeRange', 'musicPlaying', 'plexPlaying', 'alertActive', 'countdownWithin',
  ])
  assert.equal(RULE_KINDS.find((k) => k.kind === 'daypart').param, 'daypart')
  assert.deepEqual(RULE_KINDS.find((k) => k.kind === 'timeRange').params, ['from', 'to'])
  assert.equal(RULE_KINDS.find((k) => k.kind === 'countdownWithin').param, 'days')
})

test('every knob field names an element its panel marks', () => {
  for (const [type, schema] of Object.entries(PANEL_SCHEMAS)) {
    const keys = elementKeysOf(type)
    for (const f of schema.fields) {
      if (f.element) assert.ok(keys.includes(f.element), `${type}.${f.key} -> ${f.element}`)
    }
  }
})

test('every type lists its elements once each, title among them', () => {
  for (const t of PANEL_TYPE_LIST) {
    const keys = elementKeysOf(t.type)
    assert.ok(keys.length > 0, t.type)
    assert.equal(new Set(keys).size, keys.length, `${t.type} repeats a key`)
    assert.ok(keys.includes('title'), `${t.type} has no title`)
    assert.deepEqual(t.schema.elements.map((e) => e.key), keys)
  }
  // The countdown tile's own parts; its header is 'title'.
  assert.deepEqual(elementKeysOf('countdowns'), ['title', 'tile', 'image', 'name', 'number', 'unit', 'empty'])
  assert.ok(Object.isFrozen(PANEL_ELEMENTS.clock))
})

// --- Element styles ------------------------------------------------------------------

test('normalizeElementStyles keeps only what differs from the default', () => {
  const out = normalizeElementStyles(
    {
      time: { size: 1.3, weight: 700, color: '#FFCC00', hidden: false, caps: false, fit: 'wrap', tracking: 0 },
      date: { hidden: true },
      greeting: { size: 1, weight: null, color: null },
      bogus: { size: 2 },
      title: null,
    },
    'clock'
  )
  assert.deepEqual(out, { date: { hidden: true }, time: { size: 1.3, weight: 700, color: '#ffcc00' } })
  // PANEL_ELEMENTS order, whatever the input's.
  assert.deepEqual(Object.keys(out), ['time', 'date'])
})

test('normalizeElementStyles clamps, rounds and drops what is not a value', () => {
  const out = normalizeElementStyles(
    {
      rows: { size: 9, spaceAbove: '0.25', spaceBelow: -1, tracking: 0.123, weight: '600', fit: 'shrink', caps: 'yes', color: 'red' },
      header: { size: 0.1, tracking: -1 },
    },
    'agenda'
  )
  assert.deepEqual(out, {
    header: { size: 0.5, tracking: -0.05 },
    rows: { size: 2.5, weight: 600, spaceAbove: 0.3, tracking: 0.12, fit: 'shrink' },
  })
})

test('normalizeElementStyles: null, junk and empty are absent', () => {
  assert.equal(normalizeElementStyles(null, 'clock'), null)
  assert.equal(normalizeElementStyles([], 'clock'), null)
  assert.equal(normalizeElementStyles({ time: { size: 1 } }, 'clock'), null)
  assert.equal(normalizeElementStyles({ time: { size: 2 } }, 'nope'), null)
  assert.equal(normalizeElementStyles({ constructor: { size: 2 } }, 'clock'), null)
})

// --- Normalising a spec -------------------------------------------------------------

function noV2(spec) {
  const lists = [spec.panels].concat(Object.values(spec.variants || {}).map((v) => v.panels))
  for (const list of lists) {
    for (const p of list) {
      assert.equal(p.when, undefined, `${p.id} has when`)
      for (const k of V2_KEYS) {
        if (k === 'color' && p.type === 'text') continue
        assert.equal(p.props[k], undefined, `${p.id}.${k}`)
      }
    }
  }
}

test('the built-in boards carry none of the new keys', () => {
  noV2(DEFAULT_ENTRY_SPEC)
  noV2(DEFAULT_BOARD_SPEC)
})

test('new keys at their defaults, or null, normalise away', () => {
  const spec = normalizeSpec({
    panels: [
      {
        type: 'clock',
        when: { all: [], any: [{ kind: 'nope' }] },
        props: {
          elements: { time: { size: 1, hidden: false } },
          bg: { color: null, color2: null, gradient: 'none', opacity: 1 },
          border: { width: 0, color: null },
          shadow: 'none',
          blur: 0,
          font: 'inherit',
          color: null,
          valign: 'top',
          title: { mode: 'default', text: 'ignored' },
        },
      },
      { type: 'text', id: 'text-00aa', props: { bg: null, border: null, when: null, elements: null } },
    ],
  })
  noV2(spec)
  assert.deepEqual(
    JSON.stringify(spec.panels[0]),
    JSON.stringify(normalizeSpec({ panels: [{ type: 'clock' }] }).panels[0])
  )
})

test('the box v2 look normalises field by field', () => {
  const spec = normalizeSpec({
    panels: [
      {
        type: 'weather',
        props: {
          bg: { color: '#223344', color2: 'nope', gradient: 'diagonal', opacity: 0.456 },
          border: { width: 9, color: '#ABC' },
          shadow: 'soft',
          blur: 12.6,
          font: 'barlow',
          color: '#eeeeee',
          valign: 'middle',
          title: { mode: 'custom', text: 'Outside' },
        },
      },
      { type: 'text', id: 'text-00aa', props: { color: '#112233', font: 'plexmono', title: { mode: 'none', text: 'x' } } },
      { type: 'image', id: 'image-00bb', props: { color: '#112233', blur: -3, shadow: 'huge', valign: 'bottom' } },
    ],
  })
  const [w, t, i] = spec.panels
  assert.deepEqual(w.props.bg, { color: '#223344', gradient: 'diagonal', opacity: 0.46 })
  assert.deepEqual(w.props.border, { width: 4, color: '#abc' })
  assert.equal(w.props.shadow, 'soft')
  assert.equal(w.props.blur, 13)
  assert.equal(w.props.font, 'barlow')
  assert.equal(w.props.color, '#eeeeee')
  assert.equal(w.props.valign, 'middle')
  assert.deepEqual(w.props.title, { mode: 'custom', text: 'Outside' })
  // A text block's colour is its own prop (always there); the box look adds
  // the font and the title.
  assert.equal(t.props.color, '#112233')
  assert.equal(t.props.font, 'plexmono')
  assert.deepEqual(t.props.title, { mode: 'none' })
  assert.equal(i.props.color, '#112233')
  assert.equal(i.props.blur, undefined)
  assert.equal(i.props.shadow, undefined)
  assert.equal(i.props.valign, 'bottom')
})

test('normalizeSpec stays idempotent with every new key set', () => {
  const raw = {
    panels: [
      {
        type: 'countdowns',
        when: { any: [{ kind: 'countdownWithin', days: '10' }, { kind: 'timeRange', from: '7:05', to: '9:00', not: true }] },
        props: {
          elements: { name: { hidden: true }, number: { size: 1.5, fit: 'shrink' }, tile: { color: '#fff' } },
          bg: { color: '#102030', gradient: 'down' },
          title: { mode: 'custom', text: 'Soon' },
        },
      },
    ],
  }
  const once = normalizeSpec(raw)
  assert.deepEqual(normalizeSpec(once), once)
  assert.deepEqual(once.panels[0].when, {
    any: [{ kind: 'countdownWithin', days: 10 }, { kind: 'timeRange', not: true, from: '07:05', to: '09:00' }],
  })
  assert.deepEqual(Object.keys(once.panels[0].props.elements), ['tile', 'name', 'number'])
})

test('normalizeWhen drops what cannot be a condition', () => {
  assert.equal(normalizeWhen(null), null)
  assert.equal(normalizeWhen({ all: [] }), null)
  assert.equal(normalizeWhen({ all: 'x', any: {} }), null)
  assert.deepEqual(
    normalizeWhen({
      all: [
        { kind: 'weekend', not: 'yes' },
        { kind: 'daypart', daypart: 'noon' },
        { kind: 'daypart', daypart: 'evening' },
        { kind: 'timeRange', from: '25:00', to: '10:00' },
        { kind: 'countdownWithin' },
        { kind: 'countdownWithin', days: 999 },
        { kind: 'toString' },
      ],
    }),
    {
      all: [
        { kind: 'weekend' },
        { kind: 'daypart', daypart: 'evening' },
        { kind: 'countdownWithin', days: 7 },
        { kind: 'countdownWithin', days: 365 },
      ],
    }
  )
})

test('a box with a v2 surface is never joined to a flush card', () => {
  const panels = normalizeSpec(null).panels
  const plain = cardJoins(panels)
  assert.ok(plain.weather && plain.wear && plain.airquality)
  const styled = panels.map((p) => (p.id === 'wear' ? { ...p, props: { ...p.props, shadow: 'soft' } } : p))
  const joins = cardJoins(styled)
  assert.equal(joins.wear, undefined)
  assert.equal(joins.weather, undefined)
  assert.equal(joins.airquality, undefined)
  assert.equal(hasBoxSurface({ font: 'roboto', valign: 'middle' }), false)
  assert.equal(hasBoxSurface({ bg: { opacity: 0.5 } }), true)
})

// --- Rules ---------------------------------------------------------------------------

const ctx = (over) => ({
  now: at(14, 5),
  schoolMorning: false,
  weekend: false,
  daypart: 'day',
  musicPlaying: false,
  plexPlaying: false,
  alertActive: false,
  countdownDaysLeft: [],
  ...over,
})

test('ruleMatches: no rule always shows', () => {
  assert.equal(ruleMatches(null, ctx()), true)
  assert.equal(ruleMatches(undefined, {}), true)
  assert.equal(ruleMatches({}, ctx()), true)
})

test('ruleMatches: the flag kinds and not', () => {
  const one = (kind, c, not) => ruleMatches({ all: [{ kind, ...(not ? { not: true } : {}) }] }, ctx(c))
  assert.equal(one('schoolMorning', { schoolMorning: true }), true)
  assert.equal(one('schoolMorning', {}), false)
  assert.equal(one('schoolMorning', {}, true), true)
  assert.equal(one('musicPlaying', { musicPlaying: true }), true)
  assert.equal(one('plexPlaying', { plexPlaying: true }), true)
  assert.equal(one('plexPlaying', {}), false)
  assert.equal(one('alertActive', { alertActive: true }), true)
  assert.equal(one('weekend', { weekend: true }), true)
  assert.equal(one('weekday', { weekend: true }), false)
  // weekend read off the clock when the context leaves it out: the 26th is a Saturday.
  assert.equal(ruleMatches({ all: [{ kind: 'weekend' }] }, { now: at(10, 0, 26) }), true)
  assert.equal(ruleMatches({ all: [{ kind: 'weekday' }] }, { now: at(10, 0, 24) }), true)
})

test('ruleMatches: day part, countdowns', () => {
  assert.equal(ruleMatches({ all: [{ kind: 'daypart', daypart: 'evening' }] }, ctx({ daypart: 'evening' })), true)
  assert.equal(ruleMatches({ all: [{ kind: 'daypart', daypart: 'evening' }] }, ctx()), false)
  const soon = { all: [{ kind: 'countdownWithin', days: 7 }] }
  assert.equal(ruleMatches(soon, ctx({ countdownDaysLeft: [12, 7] })), true)
  assert.equal(ruleMatches(soon, ctx({ countdownDaysLeft: [12, 8] })), false)
  assert.equal(ruleMatches(soon, ctx({ countdownDaysLeft: [null, -1] })), false)
})

test('ruleMatches: timeRange is [from, to), wraps past midnight, whole day when equal', () => {
  const between = (from, to, h, m) => ruleMatches({ all: [{ kind: 'timeRange', from, to }] }, ctx({ now: at(h, m) }))
  assert.equal(between('07:00', '09:00', 7, 0), true)
  assert.equal(between('07:00', '09:00', 8, 59), true)
  assert.equal(between('07:00', '09:00', 9, 0), false)
  assert.equal(between('07:00', '09:00', 6, 59), false)
  assert.equal(between('22:00', '06:00', 23, 30), true)
  assert.equal(between('22:00', '06:00', 5, 59), true)
  assert.equal(between('22:00', '06:00', 12, 0), false)
  assert.equal(between('08:00', '08:00', 3, 0), true)
})

test('ruleMatches: all must hold, any needs one, unjudgeable conditions are skipped', () => {
  const c = ctx({ musicPlaying: true, daypart: 'evening' })
  assert.equal(ruleMatches({ all: [{ kind: 'musicPlaying' }, { kind: 'daypart', daypart: 'evening' }] }, c), true)
  assert.equal(ruleMatches({ all: [{ kind: 'musicPlaying' }, { kind: 'alertActive' }] }, c), false)
  assert.equal(ruleMatches({ any: [{ kind: 'alertActive' }, { kind: 'musicPlaying' }] }, c), true)
  assert.equal(ruleMatches({ any: [{ kind: 'alertActive' }, { kind: 'plexPlaying' }] }, c), false)
  assert.equal(ruleMatches({ all: [{ kind: 'musicPlaying' }], any: [{ kind: 'alertActive' }] }, c), false)
  // Unknown kinds and malformed parameters never hide a panel.
  assert.equal(ruleMatches({ all: [{ kind: 'bogus' }], any: [{ kind: 'timeRange', from: 'x', to: 'y' }] }, c), true)
  assert.equal(ruleMatches({ any: [{ kind: 'bogus' }, { kind: 'alertActive' }] }, c), false)
})

test('clockDaypart and isSchoolMorning follow the clock, not the variants', () => {
  const school = { autoShowAt: { hour: 6, minute: 1 }, morningEndsAt: { hour: 8, minute: 0 }, schoolDays: [1, 2, 3, 4, 5] }
  assert.equal(clockDaypart({ now: at(7, 20), school }), 'morning')
  assert.equal(clockDaypart({ now: at(7, 20), school, noSchoolToday: true }), 'day')
  assert.equal(clockDaypart({ now: at(14, 5), school }), 'day')
  assert.equal(clockDaypart({ now: at(18, 0), school }), 'evening')
  assert.equal(clockDaypart({ now: at(19, 0), school, eveningFrom: 20 }), 'day')
  assert.equal(clockDaypart({ now: at(9, 0, 26), school }), 'weekend')
  assert.equal(isSchoolMorning({ now: at(7, 20), school }), true)
  assert.equal(isSchoolMorning({ now: at(8, 0), school }), false)
  assert.equal(isSchoolMorning({ now: at(7, 20, 26), school }), false)
  assert.equal(isSchoolMorning({ now: at(7, 20), school, noSchoolToday: true }), false)
})

test('ruleKindsUsed collects the kinds of a panel list', () => {
  const kinds = ruleKindsUsed([
    { when: { all: [{ kind: 'plexPlaying' }], any: [{ kind: 'weekend' }] } },
    { when: null },
    {},
    { when: { any: [{ kind: 'plexPlaying' }] } },
  ])
  assert.deepEqual([...kinds].sort(), ['plexPlaying', 'weekend'])
})

// --- Chunk 2: the art-above tiles and the single countdown ------------------------

test('the countdown tiles gain Art above and its four knobs, defaults as before', () => {
  const fields = Object.fromEntries(PANEL_SCHEMAS.countdowns.fields.map((f) => [f.key, f]))
  assert.deepEqual(fields.tileStyle.options.map((o) => o[0]), ['card', 'bare', 'imageOnly', 'artAbove'])
  assert.equal(fields.tileStyle.default, 'card')
  assert.deepEqual(
    ['artSize', 'artOverlap', 'tileGradient', 'tileColorFrom'].map((k) => [k, fields[k].default]),
    [['artSize', 0.8], ['artOverlap', 0.35], ['tileGradient', 'down'], ['tileColorFrom', 'auto']]
  )
  assert.deepEqual([fields.artSize.min, fields.artSize.max, fields.artOverlap.min, fields.artOverlap.max], [0.4, 1.2, 0, 0.8])
  assert.deepEqual(fields.tileGradient.options.map((o) => o[0]), ['down', 'diagonal', 'none'])
  assert.deepEqual(fields.tileColorFrom.options.map((o) => o[0]), ['auto', 'marker', 'calendar'])
  // The built-in board's tiles: the card, as they always were.
  const tiles = DEFAULT_ENTRY_SPEC.panels.find((p) => p.id === 'countdowns')
  assert.equal(tiles.props.tileStyle, 'card')
  assert.equal(knobsOf(tiles).tileGradient, 'down')
})

test('the art-above knobs clamp and fall back like any knob', () => {
  const spec = normalizeSpec({
    panels: [
      { id: 'countdowns', type: 'countdowns', props: { tileStyle: 'artAbove', artSize: 5, artOverlap: -1, tileGradient: 'up', tileColorFrom: 'art' } },
    ],
  })
  const p = spec.panels[0].props
  assert.deepEqual([p.tileStyle, p.artSize, p.artOverlap, p.tileGradient, p.tileColorFrom], ['artAbove', 1.2, 0, 'down', 'auto'])
})

test('the single countdown is a panel type with its knobs and elements', () => {
  const t = PANEL_TYPES.countdown
  assert.equal(t.label, 'Countdown')
  assert.equal(t.kind, 'panel')
  assert.equal(t.unique, true)
  assert.deepEqual(t.minPx, { w: 120, h: 100 })
  assert.deepEqual(elementKeysOf('countdown'), ['title', 'image', 'name', 'number', 'unit', 'empty'])
  assert.deepEqual(PANEL_SCHEMAS.countdown.fields.map((f) => f.key), [
    'pick', 'titleMatch', 'layout', 'tileGradient', 'tileColorFrom', 'tileRadius',
    'artSize', 'artOverlap', 'titleSize', 'numberSize', 'showUnit', 'prefer',
  ])
})

test('Add panel puts the single countdown at about 20 x 30 percent, drawing no box of its own', () => {
  const p = newPanel('countdown', null, { layoutId: 'entry' })
  assert.deepEqual([p.id, p.x, p.y, p.w, p.h, p.z], ['countdown', 40, 35, 20, 30, 10])
  assert.equal(p.props.background, 'none')
  assert.equal(p.props.padding, 0)
  assert.deepEqual(
    [p.props.pick, p.props.titleMatch, p.props.layout, p.props.tileGradient, p.props.tileColorFrom, p.props.artSize, p.props.artOverlap],
    ['next', '', 'stacked', 'down', 'auto', 0.8, 0.35]
  )
  assert.equal(newPanel('countdown', null, { layoutId: 'board' }).w, 20)
  // Neither built-in board has one.
  assert.equal(DEFAULT_ENTRY_SPEC.panels.some((x) => x.type === 'countdown'), false)
  assert.equal(DEFAULT_BOARD_SPEC.panels.some((x) => x.type === 'countdown'), false)
})

test('the single countdown normalises its knobs: a known pick, a title match of 80 at most', () => {
  const spec = normalizeSpec({
    panels: [
      { id: 'countdown', type: 'countdown', props: { pick: 'first', titleMatch: 'x'.repeat(200), layout: 'sideways' } },
      { id: 'countdown', type: 'countdown', props: { pick: 'title' } },
    ],
  })
  // The same id twice is a true duplicate: the first kept.
  assert.equal(spec.panels.length, 1)
  const p = spec.panels[0].props
  assert.deepEqual([p.pick, p.titleMatch.length, p.layout], ['next', 80, 'stacked'])
  assert.deepEqual(normalizeSpec(spec), spec)
})

// --- Any number of every type: the instance scheme (2026-09-27) ---------------------

const ids = (spec) => spec.panels.map((p) => p.id)

test('typeOfId and panelType follow the scheme: the id itself when a type, else the part before the first dash', () => {
  assert.equal(typeOfId('weather'), 'weather')
  assert.equal(typeOfId('weather-3fa9'), 'weather')
  assert.equal(typeOfId('weather-zz'), 'weather')
  assert.equal(typeOfId('text-00aa'), 'text')
  assert.equal(typeOfId('hastatus-3fa9'), 'hastatus')
  for (const junk of ['bogus', 'bogus-3fa9', '-3fa9', 'constructor', 'toString-0001', '', null, 5, {}]) {
    assert.equal(typeOfId(junk), null, String(junk))
  }
  assert.equal(panelType('weather-3fa9'), PANEL_TYPES.weather)
  assert.equal(panelType('agenda'), PANEL_TYPES.agenda)
  assert.equal(panelType('shape-5d20').kind, 'block')
  assert.equal(panelType('constructor'), null)
})

test('isInstanceId: a functional type its bare type or <type>-<4 hex>; a block the suffixed form only', () => {
  assert.ok(isInstanceId('weather', 'weather'))
  assert.ok(isInstanceId('weather', 'weather-3fa9'))
  assert.ok(isInstanceId('clock', 'clock-0000'))
  assert.ok(isInstanceId('text', 'text-00aa'))
  assert.ok(!isInstanceId('text', 'text'))
  assert.ok(!isInstanceId('shape', 'shape'))
  assert.ok(!isInstanceId('weather', 'weather-3FA9'))
  assert.ok(!isInstanceId('weather', 'weather-3fa'))
  assert.ok(!isInstanceId('weather', 'weather-3fa9a'))
  assert.ok(!isInstanceId('weather', 'weathers-3fa9'))
  assert.ok(!isInstanceId('weather', 'clock'))
  assert.ok(!isInstanceId('weather-3fa9', 'weather-3fa9'))
  assert.ok(!isInstanceId('bogus', 'bogus'))
  assert.ok(!isInstanceId('weather', null))
})

test('every type is repeatable: no type carries a repeat flag; a functional type is `unique` only in its bare first id', () => {
  for (const t of PANEL_TYPE_LIST) {
    assert.equal('repeat' in t, false, t.type)
    assert.equal(t.unique, t.kind === 'panel', t.type)
  }
})

test('normalizeSpec keeps every instance, ids as saved, in order, each with its own knobs', () => {
  const spec = normalizeSpec({
    panels: [
      { id: 'weather', type: 'weather', x: 1, y: 1, w: 30, h: 20, props: { layout: 'stacked' } },
      { id: 'agenda', type: 'agenda', x: 1, y: 40, w: 40, h: 40, props: { days: 2 } },
      { id: 'weather-3fa9', type: 'weather', x: 40, y: 1, w: 30, h: 20, props: { tempSize: 1.4 } },
      { id: 'agenda-beef', type: 'agenda', x: 50, y: 40, w: 40, h: 40, props: { days: 1, rowLayout: 'stacked', dayHeader: 'compact' } },
      { id: 'agenda-0001', type: 'agenda', x: 50, y: 10, w: 40, h: 25, props: { rowLayout: 'timeRight', titleLines: 1, rowGap: 0.5 } },
    ],
  })
  assert.deepEqual(ids(spec), ['weather', 'agenda', 'weather-3fa9', 'agenda-beef', 'agenda-0001'])
  const k = Object.fromEntries(spec.panels.map((p) => [p.id, knobsOf(p)]))
  assert.deepEqual([k.weather.layout, k['weather-3fa9'].layout, k['weather-3fa9'].tempSize], ['stacked', 'horizontal', 1.4])
  assert.deepEqual([k.agenda.days, k['agenda-beef'].days, k['agenda-0001'].days], [2, 1, 3])
  assert.deepEqual([k.agenda.rowLayout, k['agenda-beef'].rowLayout, k['agenda-0001'].rowLayout], ['side', 'stacked', 'timeRight'])
  assert.deepEqual([k['agenda-beef'].dayHeader, k['agenda-0001'].titleLines, k['agenda-0001'].rowGap], ['compact', 1, 0.5])
  assert.deepEqual(normalizeSpec(spec), spec)
})

test('a saved id is never renamed: a further instance alone keeps its suffix, and no made id takes one carried later', () => {
  // Only the second weather is left (the first was deleted): it stays weather-3fa9.
  assert.deepEqual(ids(normalizeSpec({ panels: [{ id: 'weather-3fa9', type: 'weather' }] })), ['weather-3fa9'])
  // A panel with no id comes first; the bare id belongs to the later one.
  const spec = normalizeSpec({ panels: [{ type: 'weather' }, { id: 'weather', type: 'weather' }] })
  assert.equal(spec.panels[1].id, 'weather')
  assert.ok(isInstanceId('weather', spec.panels[0].id) && spec.panels[0].id !== 'weather')
  // With no one holding it, a panel with no id (or one outside the scheme) takes the bare type.
  assert.deepEqual(ids(normalizeSpec({ panels: [{ type: 'clock' }, { id: 'Clock-1', type: 'weather' }] })), ['clock', 'weather'])
  // Deterministic: the same input, the same made ids.
  assert.deepEqual(normalizeSpec({ panels: [{ type: 'weather' }, { id: 'weather', type: 'weather' }] }), spec)
})

test('a true duplicate (the same id twice) is dropped, the first kept, for panels and blocks alike', () => {
  const spec = normalizeSpec({
    panels: [
      { id: 'weather', type: 'weather', props: { layout: 'stacked' } },
      { id: 'weather', type: 'weather', props: { layout: 'horizontal' } },
      { id: 'weather-3fa9', type: 'weather' },
      { id: 'weather-3fa9', type: 'weather', x: 50 },
      { id: 'text-00aa', type: 'text', props: { text: 'first' } },
      { id: 'text-00aa', type: 'text', props: { text: 'second' } },
    ],
  })
  assert.deepEqual(ids(spec), ['weather', 'weather-3fa9', 'text-00aa'])
  assert.equal(spec.panels[0].props.layout, 'stacked')
  assert.equal(spec.panels[2].props.text, 'first')
  // The first duplicate wins in a variant too.
  const v = normalizeSpec({ panels: [], variants: { evening: { panels: [{ id: 'clock-0f0f', type: 'clock' }, { id: 'clock-0f0f', type: 'clock', x: 50 }, { id: 'clock', type: 'clock' }] } } })
  assert.deepEqual(v.variants.evening.panels.map((p) => p.id), ['clock-0f0f', 'clock'])
  assert.notEqual(v.variants.evening.panels[0].x, 50)
})

test('a panel with no type takes the type its id names (a v1 functional panel); an unknown one is dropped', () => {
  const spec = normalizeSpec({ panels: [{ id: 'clock' }, { id: 'weather-3fa9' }, { id: 'bogus-0001' }, { id: 'constructor' }, { type: 'weather-3fa9' }] })
  assert.deepEqual(spec.panels.map((p) => [p.id, p.type]), [
    ['clock', 'clock'],
    ['weather-3fa9', 'weather'],
  ])
})

test('the ids that come out are unique whatever goes in, and a second pass keeps them', () => {
  // A seeded jumble of good, duplicated, malformed and missing ids.
  let s = 7
  const rnd = (n) => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s % n
  }
  const types = ['weather', 'agenda', 'clock', 'text', 'shape', 'hourly']
  const idFor = (t) => [t, `${t}-3fa9`, `${t}-00aa`, `${t}-XYZ`, undefined, 'weird', 'clock'][rnd(7)]
  for (let round = 0; round < 50; round++) {
    const panels = []
    const n = 1 + rnd(14)
    for (let i = 0; i < n; i++) {
      const type = types[rnd(types.length)]
      const id = idFor(type)
      panels.push(id === undefined ? { type } : { id, type })
    }
    const once = normalizeSpec({ panels })
    const got = ids(once)
    assert.equal(new Set(got).size, got.length, JSON.stringify(panels))
    once.panels.forEach((p) => assert.ok(isInstanceId(p.type, p.id), `${p.type} ${p.id}`))
    assert.deepEqual(normalizeSpec(once), once)
  }
})

test('newPanel: the bare type while it is free, else a fresh suffixed id clear of every taken one', () => {
  assert.equal(newPanel('weather', null, { layoutId: 'entry' }).id, 'weather')
  assert.equal(newPanel('weather', null, { layoutId: 'entry', takenIds: ['clock', 'weather-3fa9'] }).id, 'weather')
  const taken = new Set(['weather', 'weather-3fa9'])
  for (let i = 0; i < 20; i++) {
    const p = newPanel('weather', { id: 'weather' }, { layoutId: 'entry', takenIds: taken })
    assert.ok(isInstanceId('weather', p.id) && !taken.has(p.id), p.id)
    taken.add(p.id)
  }
  // An array of taken ids works the same; a second agenda looks like the first.
  const second = newPanel('agenda', null, { layoutId: 'entry', takenIds: ['agenda'] })
  const first = DEFAULT_ENTRY_SPEC.panels.find((p) => p.id === 'agenda')
  assert.ok(isInstanceId('agenda', second.id) && second.id !== 'agenda')
  assert.deepEqual({ ...second, id: 'agenda' }, JSON.parse(JSON.stringify(first)))
  // Only functional types, named exactly.
  assert.equal(newPanel('text', null, {}), null)
  assert.equal(newPanel('weather-3fa9', null, {}), null)
  // Blocks keep their own maker, clear of the taken ids.
  const b = newBlock('shape', null, ['shape-0000'])
  assert.ok(isInstanceId('shape', b.id) && b.id !== 'shape-0000')
})

test('two instances never share a box: cards join by id, and each keeps its own', () => {
  const panels = normalizeSpec({
    panels: [
      { id: 'weather', type: 'weather', x: 10, y: 10, w: 30, h: 20, props: { background: 'card' } },
      { id: 'weather-3fa9', type: 'weather', x: 10, y: 30, w: 30, h: 20, props: { background: 'card' } },
      { id: 'weather-0001', type: 'weather', x: 60, y: 30, w: 30, h: 20, props: { background: 'card' } },
    ],
  }).panels
  assert.deepEqual(cardJoins(panels), { weather: { top: false, bottom: true }, 'weather-3fa9': { top: true, bottom: false } })
})

// --- The editor's words at the source (2026-09-27) ------------------------------------

test('the box schema says block, and the header option that keeps the block its own is Default', () => {
  const valign = BOX_SCHEMA.fields.find((f) => f.key === 'valign')
  assert.equal(valign.hint, 'Top is the block as designed')
  const title = BOX_SCHEMA.fields.find((f) => f.key === 'title.mode')
  assert.deepEqual(title.options, [
    ['default', 'Default'],
    ['custom', 'Custom'],
    ['none', 'None'],
  ])
  // No user-facing word in the type list or the box schema says "panel".
  const words = []
  PANEL_TYPE_LIST.forEach((t) => words.push(t.label))
  BOX_SCHEMA.fields.forEach((f) => words.push(f.label, f.hint || '', ...(f.options || []).map((o) => String(o[1]))))
  words.forEach((w) => assert.ok(!/\bpanels?\b/i.test(w), w))
})
