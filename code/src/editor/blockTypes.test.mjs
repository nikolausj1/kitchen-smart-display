// Block types from the app (docs/designs/panels-and-controls.md, chunk 4): the
// editor's type registry (schema.js), the shape as a block, a type the app does
// not know kept exactly as stored, and the save's byte-identical round trip.
// Run from code/: node --test src/editor/blockTypes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as app from '../views/TodayLayouts/layoutSpec.js'
import { finalSpec, newBlock, readSpec, samePanel } from './appSpec.js'
import { backmost, insertBehind, mapPanel, styleOf, unionPct, withProps, withStyle } from './edits.js'
import { blockTypes, isBlockType, isFunctionalType, isKnownType, registerFromReady } from './schema.js'
import { frontToBack, isValidBlockId, makeBlock, panelLabel, withRemovals } from './spec.js'

const J = JSON.stringify
const clone = (v) => JSON.parse(J(v))
const save = (stored, draft) => withRemovals(stored, finalSpec(draft, 'entry'), { samePanel: (a, b) => samePanel(a, b, 'entry') })
const readyWith = (panelTypes, extra = {}) => registerFromReady({ panelTypes, schemas: app.PANEL_SCHEMA_TABLE, ...extra })
const FULL = app.PANEL_TYPE_LIST

// A stored Entry layout with a styled shape behind the weather card, as the
// app normalises it, and a type nobody knows.
function storedWithShape() {
  const base = clone(app.DEFAULT_ENTRY_SPEC)
  const bg = { color: '#2a5d8f', gradient: 'diagonal', color2: '#0d1b2a' }
  const props = { fillPreset: 'custom', bg, border: { width: 2, color: '#9ad0ff' }, blur: 10 }
  base.panels.splice(2, 0, app.newBlock('shape', { x: 58.08, y: 3, w: 39.52, h: 42.5, z: 3, props }))
  const stored = clone(app.normalizeSpec(base, { layoutId: 'entry' }))
  stored.panels.push({ id: 'foo-1', type: 'foo', x: 1, y: 1, w: 5, h: 5, z: 50, props: { weird: [1, 2] }, extra: true })
  return stored
}

// First, before any ready message: what appSpec.js registered from the
// bundled layoutSpec.js.
test('the bundled app names the blocks: the shape, text and image', () => {
  assert.deepEqual([...blockTypes()].sort(), ['image', 'shape', 'text'])
  assert.ok(isBlockType('shape') && isKnownType('shape') && !isFunctionalType('shape'))
  assert.ok(isFunctionalType('clock') && !isKnownType('foo'))
  assert.ok(isValidBlockId('shape', 'shape-5d20') && !isValidBlockId('shape', 'shape-5D20') && !isValidBlockId('clock', 'clock-0000'))
})

test('a new shape from the app: its starting box and props, clear of taken ids', () => {
  readyWith(FULL)
  const taken = new Set(['shape-0001'])
  const b = newBlock('shape', { z: 4 }, taken)
  assert.ok(b && isValidBlockId('shape', b.id) && !taken.has(b.id))
  assert.deepEqual([b.x, b.y, b.w, b.h, b.z], [40, 44, 20, 12, 4])
  assert.equal(b.props.kind, 'rect')
  assert.equal(b.props.fillPreset, 'surface')
  assert.equal(b.props.padding, 0)
  // The editor's own, for a block the bundled app cannot make: a bare box.
  const m = makeBlock('shape', [], 'shape-00aa', { z: 2, box: { x: 10, y: 10, w: 30, h: 20 } })
  assert.deepEqual([m.x, m.y, m.w, m.h, m.z, m.props.padding, m.props.background, m.props.kind], [10, 10, 30, 20, 2, 0, 'none', 'rect'])
})

test('a stored shape and an unknown type read and save byte-identical', () => {
  readyWith(FULL)
  const stored = storedWithShape()
  const read = readSpec(stored, 'entry')
  assert.deepEqual(read.panels.map((p) => p.id), stored.panels.map((p) => p.id))
  assert.deepEqual(read.panels.find((p) => p.type === 'shape'), stored.panels.find((p) => p.type === 'shape'))
  assert.deepEqual(read.panels.at(-1), stored.panels.at(-1))
  // An unrelated edit: every other panel goes back exactly as stored.
  const body = save(stored, mapPanel(read, 'day', 'clock', withProps({ textScale: 1.1 })))
  body.panels.forEach((p, i) => (p.id === 'clock' ? assert.notEqual(J(p), J(stored.panels[i])) : assert.equal(J(p), J(stored.panels[i]))))
  assert.equal(panelLabel(stored.panels.at(-1), {}), 'Foo (not supported by this app)')
})

test('an app without shapes: the shape is not supported, kept and saved untouched', () => {
  readyWith(FULL.filter((t) => t.type !== 'shape'))
  try {
    assert.ok(!isKnownType('shape') && !blockTypes().includes('shape'))
    const stored = storedWithShape()
    const shape = stored.panels.find((p) => p.type === 'shape')
    const read = readSpec(stored, 'entry')
    assert.equal(read.panels[2].id, shape.id)
    assert.equal(panelLabel(read.panels[2], {}), 'Shape (not supported by this app)')
    const body = save(stored, mapPanel(read, 'day', 'clock', withProps({ textScale: 1.1 })))
    assert.equal(J(body.panels[2]), J(shape))
  } finally {
    readyWith(FULL)
  }
})

test('a block only the ready knows (a newer app): a block to the editor, its copy kept', () => {
  const sticker = {
    type: 'sticker',
    label: 'Sticker',
    kind: 'block',
    unique: false,
    min: { w: 1, h: 1 },
    schema: { fields: [{ key: 'emoji', label: 'Emoji', type: 'text', default: '' }], elements: [{ key: 'title', label: 'Title' }] },
  }
  readyWith([...FULL, sticker])
  try {
    assert.ok(isBlockType('sticker') && isKnownType('sticker'))
    const read = readSpec(
      {
        panels: [
          { id: 'clock', type: 'clock', x: 1, y: 1, w: 30, h: 20, z: 1, props: {} },
          { id: 'sticker-00ff', type: 'sticker', x: 50, y: 50, w: 10, h: 10, z: 2, props: { emoji: 'x', bogus: 1 } },
          { id: 'sticker-XYZ', type: 'sticker', x: 60, y: 60, w: 10, h: 10, z: 3, props: {} },
        ],
      },
      'entry'
    )
    assert.deepEqual(read.panels.map((p) => p.type), ['clock', 'sticker', 'sticker'])
    assert.equal(read.panels[1].id, 'sticker-00ff')
    assert.equal(read.panels[1].props.emoji, 'x')
    assert.equal(read.panels[1].props.bogus, undefined)
    assert.ok(isValidBlockId('sticker', read.panels[2].id))
  } finally {
    readyWith(FULL)
  }
})

test('the ready may name its blocks outright (blockTypes)', () => {
  registerFromReady({ panelTypes: ['clock', 'text', 'image'], blockTypes: ['text', 'image'] })
  try {
    assert.deepEqual(blockTypes(), ['text', 'image'])
    assert.ok(isFunctionalType('clock') && !isKnownType('shape'))
  } finally {
    readyWith(FULL)
  }
})

test('a ready naming only its blocks keeps the types known so far', () => {
  readyWith(FULL)
  registerFromReady({ blockTypes: ['text', 'image'] })
  try {
    assert.deepEqual(blockTypes(), ['text', 'image'])
    assert.ok(isFunctionalType('clock') && isFunctionalType('weather') && !isBlockType('shape'))
  } finally {
    readyWith(FULL)
  }
})

test('behind the selection: over its area, just behind it, nothing else moves', () => {
  readyWith(FULL)
  const spec = readSpec(clone(app.DEFAULT_ENTRY_SPEC), 'entry')
  const group = spec.panels.filter((p) => ['weather', 'wear', 'airquality'].includes(p.id))
  assert.deepEqual(unionPct(group), { x: 58.08, y: 3, w: 39.52, h: 42.5 })
  const back = backmost(spec.panels, group.map((p) => p.id))
  assert.equal(back.id, 'weather')
  const shape = newBlock('shape', { ...unionPct(group), z: back.z }, new Set())
  const next = insertBehind(spec, 'day', shape, back.id)
  const order = frontToBack(next.panels).map((p) => p.id)
  assert.equal(order[order.indexOf('weather') + 1], shape.id)
  assert.equal(next.panels.length, spec.panels.length + 1)
  spec.panels.forEach((p) => assert.equal(next.panels.find((q) => q.id === p.id), p))
})

test('paste style onto a shape: the box v2 props, never another type knobs', () => {
  readyWith(FULL)
  const shape = app.newBlock('shape', { props: { fillPreset: 'custom', blur: 6 } })
  const agenda = clone(app.DEFAULT_ENTRY_SPEC.panels.find((p) => p.id === 'agenda'))
  agenda.props.bg = { color: '#12324a', opacity: 0.85 }
  agenda.props.border = { width: 1, color: '#2f6f9f' }
  agenda.props.shadow = 'soft'
  const out = withStyle(styleOf(agenda))(shape)
  assert.deepEqual([out.props.bg, out.props.border, out.props.shadow, out.props.blur], [agenda.props.bg, agenda.props.border, 'soft', undefined])
  assert.deepEqual([out.props.kind, out.props.fillPreset], ['rect', 'custom'])
})
