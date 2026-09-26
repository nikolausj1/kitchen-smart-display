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
  RULE_KINDS,
  cardJoins,
  clockDaypart,
  hasBoxSurface,
  isSchoolMorning,
  normalizeElementStyles,
  normalizeSpec,
  normalizeWhen,
  ruleKindsUsed,
  ruleMatches,
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
