// Tests for the Home Assistant types in the layout spec (docs/designs/
// panels-and-controls.md, chunk 5): the status panel, the button, the chips
// and the picker, as the spec and the schemas see them. The panels' pure
// parts have their own suite (panels/haParts.test.mjs); the data's, lib/
// haState.test.mjs.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_BOARD_SPEC,
  DEFAULT_ENTRY_SPEC,
  FUNCTIONAL_TYPES,
  PANEL_SCHEMA_TABLE,
  PANEL_TYPES,
  isRepeatId,
  knobsOf,
  newPanel,
  normalizeSpec,
} from './layoutSpec.js'
import { PANEL_SCHEMAS, elementKeysOf, knobDefaults } from './panels/schemas.js'
import { HA_PANEL_TYPES } from './panels/haParts.js'

const TYPES = ['hastatus', 'habutton', 'hachips', 'hapicker']

test('the four are panels that repeat, with their labels', () => {
  assert.deepEqual([...HA_PANEL_TYPES], TYPES)
  TYPES.forEach((t) => {
    assert.equal(PANEL_TYPES[t].kind, 'panel', t)
    assert.equal(PANEL_TYPES[t].unique, false, t)
    assert.equal(PANEL_TYPES[t].repeat, true, t)
    assert.ok(FUNCTIONAL_TYPES.includes(t), t)
  })
  // Every other functional type is still unique, and says nothing of repeating.
  assert.equal(PANEL_TYPES.clock.unique, true)
  assert.equal('repeat' in PANEL_TYPES.clock, false)
  assert.deepEqual(TYPES.map((t) => PANEL_TYPES[t].label), ['HA status', 'HA button', 'HA chips', 'HA picker'])
  assert.deepEqual(TYPES.map((t) => PANEL_TYPES[t].minPx), [
    { w: 120, h: 44 },
    { w: 80, h: 48 },
    { w: 120, h: 30 },
    { w: 200, h: 44 },
  ])
})

test('their knobs, defaults and elements', () => {
  const keys = (t) => PANEL_SCHEMAS[t].fields.map((f) => f.key)
  assert.deepEqual(keys('hastatus'), ['entity', 'showLabel', 'showSince', 'size', 'layout'])
  assert.deepEqual(keys('habutton'), ['action', 'size', 'style', 'showState'])
  assert.deepEqual(keys('hachips'), ['entities', 'size', 'showLabels'])
  assert.deepEqual(keys('hapicker'), ['entity', 'action', 'size', 'wrap'])
  assert.deepEqual(knobDefaults('hastatus'), { entity: '', showLabel: true, showSince: true, size: 1, layout: 'row' })
  assert.deepEqual(knobDefaults('habutton'), { action: '', size: 1, style: 'filled', showState: true })
  assert.deepEqual(knobDefaults('hachips'), { entities: '', size: 1, showLabels: true })
  assert.deepEqual(knobDefaults('hapicker'), { entity: '', action: '', size: 1, wrap: true })
  assert.deepEqual(elementKeysOf('hastatus'), ['title', 'icon', 'label', 'state', 'since', 'empty'])
  assert.deepEqual(elementKeysOf('habutton'), ['title', 'icon', 'label', 'state', 'hint'])
  assert.deepEqual(elementKeysOf('hachips'), ['title', 'chip', 'label', 'state', 'empty'])
  assert.deepEqual(elementKeysOf('hapicker'), ['title', 'option', 'hint'])
})

test('the whitelist knobs are text in the contract, marked for the live options', () => {
  const f = (t, k) => PANEL_SCHEMA_TABLE[t].fields.find((x) => x.key === k)
  assert.deepEqual([f('hastatus', 'entity').type, f('hastatus', 'entity').ha, f('hastatus', 'entity').format], ['text', 'entity', 'entityId'])
  assert.deepEqual([f('habutton', 'action').type, f('habutton', 'action').ha, f('habutton', 'action').format], ['text', 'action', 'id'])
  assert.deepEqual([f('hachips', 'entities').type, f('hachips', 'entities').ha, f('hachips', 'entities').format], ['text', 'entityList', 'entityIds'])
  assert.deepEqual([f('hapicker', 'entity').ha, f('hapicker', 'action').ha], ['selectEntity', 'optionAction'])
  // The select knobs keep the contract's vocabulary: [value, label] options.
  assert.deepEqual(f('hastatus', 'layout').options, [
    ['row', 'Side by side'],
    ['stacked', 'Stacked'],
  ])
  assert.deepEqual(f('habutton', 'style').options, [
    ['filled', 'Filled'],
    ['outline', 'Outline'],
  ])
})

test('Add panel: each lands in its starting box; the button draws no box of its own', () => {
  const box = (t, layoutId) => {
    const p = newPanel(t, null, { layoutId })
    return [p.id, p.x, p.y, p.w, p.h, p.z, p.props.background, p.props.padding]
  }
  assert.deepEqual(box('hastatus', 'entry'), ['hastatus', 40, 42, 20, 16, 10, 'card', 1])
  assert.deepEqual(box('habutton', 'entry'), ['habutton', 42, 41, 16, 18, 10, 'none', 0])
  assert.deepEqual(box('hachips', 'board'), ['hachips', 25, 44, 50, 12, 10, 'card', 1])
  assert.deepEqual(box('hapicker', 'board'), ['hapicker', 15, 42, 70, 16, 10, 'card', 1])
})

test('several of one: the bare type once, then <type>-<4 hex>; ids kept, repaired, deterministic', () => {
  const box = { x: 1, y: 1, w: 20, h: 16 }
  const spec = normalizeSpec(
    {
      panels: [
        { id: 'hastatus', type: 'hastatus', ...box, props: { entity: 'cover.garage_door_controller' } },
        { id: 'hastatus-3fa9', type: 'hastatus', ...box, props: { entity: 'person.justin' } },
        { id: 'hastatus', type: 'hastatus', ...box, props: { entity: 'person.sheena' } }, // a repeat of the bare id
        { id: 'weird', type: 'hastatus', ...box, props: { entity: 'lock.front_door' } },
        { type: 'habutton', ...box, props: { action: 'away-on' } },
        { id: 'habutton-00aa', type: 'habutton', ...box, props: { action: 'garage-toggle' } },
        { type: 'clock', ...box },
        { type: 'clock', ...box }, // a second clock: still dropped
      ],
    },
    { layoutId: 'entry' }
  )
  const ids = spec.panels.map((p) => p.id)
  assert.equal(ids.length, 7)
  assert.deepEqual(ids.slice(0, 2), ['hastatus', 'hastatus-3fa9'])
  assert.ok(isRepeatId('hastatus', ids[2]) && ids[2] !== 'hastatus' && ids[2] !== 'hastatus-3fa9')
  assert.ok(isRepeatId('hastatus', ids[3]) && new Set(ids.slice(0, 4)).size === 4)
  assert.deepEqual(ids.slice(4), ['habutton', 'habutton-00aa', 'clock'])
  assert.deepEqual(
    spec.panels.slice(0, 4).map((p) => knobsOf(p).entity),
    ['cover.garage_door_controller', 'person.justin', 'person.sheena', 'lock.front_door']
  )
  assert.deepEqual(normalizeSpec(spec, { layoutId: 'entry' }), spec)
  assert.ok(!isRepeatId('clock', 'clock-0f0f') && !isRepeatId('hastatus', 'hastatus-3FA9') && !isRepeatId('hastatus', 'habutton'))
})

test('Add panel: a second of a repeating type gets a fresh suffixed id', () => {
  const first = newPanel('hastatus', null, { layoutId: 'entry', takenIds: ['clock', 'agenda'] })
  assert.equal(first.id, 'hastatus')
  const second = newPanel('hastatus', null, { layoutId: 'entry', takenIds: new Set(['hastatus', 'hastatus-3fa9']) })
  assert.ok(isRepeatId('hastatus', second.id) && second.id !== 'hastatus' && second.id !== 'hastatus-3fa9')
  // Any other functional type is its type, whatever is taken.
  assert.equal(newPanel('clock', null, { layoutId: 'entry', takenIds: ['clock'] }).id, 'clock')
})

test('on no default board', () => {
  TYPES.forEach((t) => {
    assert.equal(DEFAULT_ENTRY_SPEC.panels.some((p) => p.type === t), false, t)
    assert.equal(DEFAULT_BOARD_SPEC.panels.some((p) => p.type === t), false, t)
  })
})

test('the normaliser keeps any whitelist id (it cannot know the whitelist), cleaned to its form', () => {
  const spec = normalizeSpec(
    {
      panels: [
        { type: 'hastatus', props: { entity: '  Cover.Garage_Door_Controller ', layout: 'sideways' } },
        { type: 'habutton', props: { action: '  garage-toggle ', style: 'glass' } },
        { type: 'hachips', props: { entities: 'Input_Boolean.mode_away, Away, input_boolean.mode_guest input_boolean.mode_away' } },
        { type: 'hapicker', props: { entity: 'day part', action: 'x'.repeat(80) } },
      ],
    },
    { layoutId: 'entry' }
  )
  const k = (t) => knobsOf(spec.panels.find((p) => p.type === t))
  assert.equal(k('hastatus').entity, 'cover.garage_door_controller')
  assert.equal(k('hastatus').layout, 'row')
  assert.equal(k('habutton').action, 'garage-toggle')
  assert.equal(k('habutton').style, 'filled')
  assert.equal(k('hachips').entities, 'input_boolean.mode_away, input_boolean.mode_guest')
  assert.equal(k('hapicker').entity, '') // not an entity id
  assert.equal(k('hapicker').action, '') // past 64 characters
  // Idempotent, and an array reads as the list.
  assert.deepEqual(normalizeSpec(spec, { layoutId: 'entry' }), spec)
  const arr = normalizeSpec({ panels: [{ type: 'hachips', props: { entities: ['light.a', 'light.b'] } }] }, { layoutId: 'board' })
  assert.equal(arr.panels[0].props.entities, 'light.a, light.b')
  // A value that is not text at all keeps the default.
  const odd = normalizeSpec({ panels: [{ type: 'hastatus', props: { entity: 42 } }] }, { layoutId: 'entry' })
  assert.equal(odd.panels[0].props.entity, '')
})

test('the built-in boards normalise exactly as before', () => {
  assert.deepEqual(normalizeSpec(DEFAULT_ENTRY_SPEC, { layoutId: 'entry' }), JSON.parse(JSON.stringify(DEFAULT_ENTRY_SPEC)))
  assert.deepEqual(normalizeSpec(DEFAULT_BOARD_SPEC, { layoutId: 'board' }), JSON.parse(JSON.stringify(DEFAULT_BOARD_SPEC)))
})
