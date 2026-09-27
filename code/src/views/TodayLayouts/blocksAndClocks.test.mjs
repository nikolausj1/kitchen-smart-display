// Tests for the chunk 4 types in the layout spec (docs/designs/
// panels-and-controls.md, "Blocks and clocks"): the shape block and the
// flip clock, analog clock, second clock, date and day count panels, as the
// spec, the schemas and the box v2 look (Entry/specStyles.js) see them. The
// pure clock and date parts have their own suites (lib/clocks.test.mjs,
// lib/dates.test.mjs).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BLOCK_TYPES,
  DEFAULT_BOARD_SPEC,
  DEFAULT_ENTRY_SPEC,
  FUNCTIONAL_TYPES,
  PANEL_TYPES,
  cardJoins,
  isValidBlockId,
  knobsOf,
  newBlock,
  newPanel,
  normalizeSpec,
} from './layoutSpec.js'
import { PANEL_ELEMENTS, PANEL_SCHEMAS, elementKeysOf, knobDefaults } from './panels/schemas.js'
import { boxLook, shapeFill, shapeLine } from './Entry/specStyles.js'

const PANELS = ['flipclock', 'analog', 'clock2', 'date', 'daycount']

// --- The types ------------------------------------------------------------------------

test('the five clocks and counts are panels, the shape a block', () => {
  PANELS.forEach((t) => {
    assert.equal(PANEL_TYPES[t].kind, 'panel', t)
    assert.equal(PANEL_TYPES[t].unique, true, t)
    assert.ok(FUNCTIONAL_TYPES.includes(t), t)
  })
  assert.equal(PANEL_TYPES.shape.kind, 'block')
  assert.equal(PANEL_TYPES.shape.unique, false)
  assert.deepEqual([...BLOCK_TYPES].sort(), ['image', 'shape', 'text'])
  assert.deepEqual(
    PANELS.concat('shape').map((t) => PANEL_TYPES[t].label),
    ['Flip clock', 'Analog clock', 'Second clock', 'Date', 'Day count', 'Shape']
  )
})

test('each type carries its knobs and elements to the editor', () => {
  const keys = (t) => PANEL_SCHEMAS[t].fields.map((f) => f.key)
  assert.deepEqual(keys('shape'), ['kind', 'fillPreset'])
  assert.deepEqual(keys('flipclock'), ['hour24', 'showMeridiem', 'showDate', 'scale'])
  assert.deepEqual(keys('analog'), ['style', 'showSeconds', 'handColor', 'faceOpacity'])
  assert.deepEqual(keys('clock2'), ['timezone', 'label', 'hour24', 'showDate', 'showOffset', 'size'])
  assert.deepEqual(keys('date'), ['format', 'showYear', 'size', 'align'])
  assert.deepEqual(keys('daycount'), ['show', 'label', 'size'])
  assert.deepEqual(elementKeysOf('shape'), ['title'])
  assert.deepEqual(elementKeysOf('flipclock'), ['title', 'hour', 'minutes', 'tab', 'date'])
  assert.deepEqual(elementKeysOf('analog'), ['title', 'face', 'numerals', 'hands'])
  assert.deepEqual(elementKeysOf('clock2'), ['title', 'label', 'time', 'date', 'offset'])
  assert.deepEqual(elementKeysOf('date'), ['title', 'text', 'weekday', 'month', 'day', 'year'])
  assert.deepEqual(elementKeysOf('daycount'), ['title', 'number', 'label'])
  PANELS.concat('shape').forEach((t) => {
    assert.deepEqual(PANEL_TYPES[t].schema.fields.map((f) => f.key), keys(t), t)
    assert.deepEqual(PANEL_TYPES[t].schema.elements, JSON.parse(JSON.stringify(PANEL_ELEMENTS[t])), t)
  })
})

test('the knob defaults', () => {
  assert.deepEqual(knobDefaults('shape'), { kind: 'rect', fillPreset: 'surface' })
  assert.deepEqual(knobDefaults('flipclock'), { hour24: false, showMeridiem: true, showDate: true, scale: 1 })
  assert.deepEqual(knobDefaults('analog'), { style: 'classic', showSeconds: false, handColor: 'auto', faceOpacity: 1 })
  assert.deepEqual(knobDefaults('clock2'), {
    timezone: 'Europe/London',
    label: '',
    hour24: false,
    showDate: true,
    showOffset: true,
    size: 1,
  })
  assert.deepEqual(knobDefaults('date'), { format: 'long', showYear: false, size: 1, align: 'center' })
  assert.deepEqual(knobDefaults('daycount'), { show: 'weekOfYear', label: '', size: 1 })
})

test('Add panel: each lands in its starting box, above the built-in panels', () => {
  const box = (t, layoutId) => {
    const p = newPanel(t, null, { layoutId })
    return [p.id, p.x, p.y, p.w, p.h, p.z, p.props.background, p.props.padding, p.props.align]
  }
  assert.deepEqual(box('flipclock', 'entry'), ['flipclock', 30, 35, 40, 30, 10, 'none', 0, 'center'])
  assert.deepEqual(box('analog', 'entry'), ['analog', 40, 35, 20, 30, 10, 'none', 0, 'center'])
  assert.deepEqual(box('clock2', 'entry'), ['clock2', 40, 43, 20, 14, 10, 'card', 1, 'start'])
  assert.deepEqual(box('date', 'board'), ['date', 38, 44, 24, 12, 10, 'card', 1, 'center'])
  assert.deepEqual(box('daycount', 'board'), ['daycount', 42, 43, 16, 14, 10, 'card', 1, 'center'])
  PANELS.forEach((t) => {
    assert.equal(DEFAULT_ENTRY_SPEC.panels.some((p) => p.type === t), false)
    assert.equal(DEFAULT_BOARD_SPEC.panels.some((p) => p.type === t), false)
  })
})

// --- The shape block ---------------------------------------------------------------------

test('a shape is a block: any number, ids shape-<4 hex>, a bare box of 20 x 12', () => {
  const a = newBlock('shape')
  const b = newBlock('shape', { props: { kind: 'line' } }, [a.id])
  assert.match(a.id, /^shape-[0-9a-f]{4}$/)
  assert.notEqual(a.id, b.id)
  assert.ok(isValidBlockId('shape', a.id))
  assert.equal(isValidBlockId('text', a.id), false)
  assert.deepEqual([a.x, a.y, a.w, a.h, a.z], [40, 44, 20, 12, 10])
  assert.deepEqual([a.props.background, a.props.padding, a.props.kind, a.props.fillPreset], ['none', 0, 'rect', 'surface'])
  assert.equal(b.props.kind, 'line')
  const spec = normalizeSpec({ panels: [a, b, { id: 'shape-zz', type: 'shape' }, { id: a.id, type: 'shape' }] })
  assert.equal(spec.panels.length, 4)
  assert.ok(spec.panels.every((p) => p.type === 'shape' && /^shape-[0-9a-f]{4}$/.test(p.id)))
  assert.equal(new Set(spec.panels.map((p) => p.id)).size, 4)
  assert.deepEqual(normalizeSpec(spec), spec)
})

test('a shape keeps its knobs, its box v2 look and a custom title; drops the rest', () => {
  const spec = normalizeSpec({
    panels: [
      {
        id: 'shape-0a1b',
        type: 'shape',
        x: 1,
        y: 1,
        w: 0.2,
        h: 0.2,
        props: {
          kind: 'blob',
          fillPreset: 'custom',
          bg: { color: '#2F7FE8', gradient: 'down', opacity: 0.5 },
          shadow: 'soft',
          blur: 8,
          title: { mode: 'custom', text: 'Today' },
          text: 'not a shape prop',
          elements: { title: { caps: true }, time: { size: 2 } },
        },
      },
    ],
  })
  const p = spec.panels[0]
  // The smallest box a shape may be: 1 x 1 percent.
  assert.deepEqual([p.w, p.h], [1, 1])
  assert.equal(p.props.kind, 'rect')
  assert.equal(p.props.fillPreset, 'custom')
  assert.deepEqual(p.props.bg, { color: '#2f7fe8', gradient: 'down', opacity: 0.5 })
  assert.deepEqual([p.props.shadow, p.props.blur], ['soft', 8])
  assert.deepEqual(p.props.title, { mode: 'custom', text: 'Today' })
  assert.equal(p.props.text, undefined)
  assert.deepEqual(p.props.elements, { title: { caps: true } })
  assert.deepEqual(knobsOf(p), { kind: 'rect', fillPreset: 'custom' })
})

test('a shape is never joined to a flush card, even as a card', () => {
  const panels = normalizeSpec({
    panels: [
      { id: 'weather', type: 'weather', x: 10, y: 10, w: 30, h: 20, props: { background: 'card' } },
      { id: 'shape-0001', type: 'shape', x: 10, y: 30, w: 30, h: 20, props: { background: 'card' } },
      { id: 'wear', type: 'wear', x: 10, y: 50, w: 30, h: 20, props: { background: 'card' } },
    ],
  }).panels
  assert.deepEqual(cardJoins(panels), {})
})

test('shapeFill: the card, the accent, a colour of its own; the line on the card ink', () => {
  assert.deepEqual(shapeFill({}), { kind: 'rect', color: 'var(--tl-spec-card)', card: true })
  assert.deepEqual(shapeFill({ fillPreset: 'accent' }), { kind: 'rect', color: 'var(--tl-accent)', card: false })
  assert.deepEqual(shapeFill({ fillPreset: 'custom', bg: { color: '#2f9e44' } }), { kind: 'rect', color: '#2f9e44', card: false })
  // Custom with no colour yet: still a card.
  assert.deepEqual(shapeFill({ fillPreset: 'custom' }), { kind: 'rect', color: 'var(--tl-spec-card)', card: true })
  // A surface shape's colour is the card's even with a fill colour set.
  assert.equal(shapeFill({ fillPreset: 'surface', bg: { color: '#2f9e44' } }).color, 'var(--tl-spec-card)')
  assert.deepEqual(shapeFill({ kind: 'line' }), { kind: 'line', color: 'var(--tl-rule)', card: true })
  assert.equal(shapeFill({ kind: 'line', fillPreset: 'accent' }).color, 'var(--tl-accent)')
})

test('boxLook draws a fresh shape as a card: the card fill, its hairline, no drop shadow', () => {
  const look = boxLook({ background: 'none', kind: 'rect', fillPreset: 'surface' }, 'shape')
  assert.deepEqual(look.fill, { background: 'var(--tl-spec-card)', opacity: null })
  assert.ok(look.classes.includes('tl-spec--fill'))
  assert.ok(look.classes.includes('tl-spec--frame'))
  assert.equal(look.style['--tl-spec-frame'], 'inset 0 0 0 1px var(--tl-spec-edge)')
  assert.equal(look.boxShadow, 'none')
  assert.equal(look.rounded, true)
})

test('boxLook: a shape gradient runs from its own colour; opacity, border, shadow and blur as any box', () => {
  const look = boxLook(
    {
      fillPreset: 'accent',
      bg: { gradient: 'diagonal', color2: '#2f7fe8', opacity: 0.6 },
      border: { width: 2, color: '#ffffff' },
      shadow: 'strong',
      blur: 10,
    },
    'shape'
  )
  assert.deepEqual(look.fill, { background: 'linear-gradient(to bottom right, var(--tl-accent), #2f7fe8)', opacity: 0.6 })
  assert.equal(look.style['--tl-spec-frame'], 'inset 0 0 0 max(1px, 0.1042vw) #ffffff')
  assert.ok(/rgba\(0, 0, 0, 0\.55\)/.test(look.boxShadow))
  assert.ok(look.classes.includes('tl-spec--blur'))
  // A gradient with no end colour fades out.
  assert.equal(boxLook({ bg: { gradient: 'down' } }, 'shape').fill.background, 'linear-gradient(to bottom, var(--tl-spec-card), transparent)')
})

test('a line shape draws no surface on its box; its line carries the colour and the shadow', () => {
  const props = { kind: 'line', fillPreset: 'custom', bg: { color: '#ffffff', gradient: 'down', opacity: 0.5 }, border: { width: 2 }, shadow: 'soft', blur: 6 }
  const look = boxLook(props, 'shape')
  assert.equal(look.fill, null)
  assert.equal(look.boxShadow, null)
  assert.equal(look.rounded, false)
  assert.equal(look.classes.length, 0)
  const line = shapeLine(props)
  assert.equal(line.backgroundColor, '#ffffff')
  assert.equal(line.opacity, 0.5)
  assert.ok(/calc\(var\(--tl-pad\)/.test(line.boxShadow))
  assert.equal(shapeLine({ kind: 'rect' }), null)
  assert.deepEqual(shapeLine({ kind: 'line' }), { backgroundColor: 'var(--tl-rule)' })
})

test('boxLook for every other type is untouched by the shape', () => {
  // The same props on a text block draw the text block's look, not a shape's.
  assert.equal(boxLook({ kind: 'line', fillPreset: 'accent' }, 'text').fill, null)
  assert.equal(boxLook({ fillPreset: 'accent' }, 'clock').fill, null)
})

// --- The panels' knobs ---------------------------------------------------------------------

test('the clocks and counts normalise their knobs', () => {
  const spec = normalizeSpec({
    panels: [
      { id: 'flipclock', type: 'flipclock', props: { hour24: 'yes', scale: 9, showDate: false } },
      { id: 'analog', type: 'analog', props: { style: 'roman', handColor: 'accent', faceOpacity: -2, showSeconds: true } },
      { id: 'clock2', type: 'clock2', props: { timezone: 'x'.repeat(100), label: 'Grandma', hour24: true, size: 0.1 } },
      { id: 'date', type: 'date', props: { format: 'daynumber', showYear: true, align: 'end' } },
      { id: 'daycount', type: 'daycount', props: { show: 'weekends', label: 'y'.repeat(100) } },
    ],
  })
  const by = Object.fromEntries(spec.panels.map((p) => [p.type, p.props]))
  assert.deepEqual([by.flipclock.hour24, by.flipclock.scale, by.flipclock.showDate, by.flipclock.showMeridiem], [false, 1.5, false, true])
  assert.deepEqual([by.analog.style, by.analog.handColor, by.analog.faceOpacity, by.analog.showSeconds], ['classic', 'accent', 0, true])
  assert.deepEqual([by.clock2.timezone.length, by.clock2.label, by.clock2.hour24, by.clock2.size], [64, 'Grandma', true, 0.5])
  assert.deepEqual([by.date.format, by.date.showYear, by.date.align], ['daynumber', true, 'end'])
  assert.deepEqual([by.daycount.show, by.daycount.label.length], ['weekOfYear', 60])
  // The date and the day count are centred unless set; the second clock is not.
  const fresh = normalizeSpec({ panels: [{ id: 'date', type: 'date' }, { id: 'daycount', type: 'daycount' }, { id: 'clock2', type: 'clock2' }] })
  assert.deepEqual(fresh.panels.map((p) => p.props.align), ['center', 'center', 'start'])
  assert.deepEqual(normalizeSpec(spec), spec)
})

test('the built-in boards normalise exactly as before', () => {
  // Neither carries a new type, nor a key a new type brought.
  const json = JSON.stringify([DEFAULT_ENTRY_SPEC, DEFAULT_BOARD_SPEC])
  ;['flipclock', 'analog', 'clock2', 'daycount', 'shape', 'fillPreset', 'timezone', 'faceOpacity'].forEach((k) => {
    assert.equal(json.includes(`"${k}`), false, k)
  })
  assert.deepEqual(normalizeSpec(DEFAULT_ENTRY_SPEC), DEFAULT_ENTRY_SPEC)
  assert.deepEqual(normalizeSpec(DEFAULT_BOARD_SPEC, { layoutId: 'board' }), DEFAULT_BOARD_SPEC)
})
