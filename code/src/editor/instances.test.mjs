// Blocks (2026-09-27): any number of every type, the Delete that removes,
// the numbered names and the Add block catalogue. The ids: the first
// instance of a type keeps the bare type ('weather'), the others are
// '<type>-<4 hex>'; the type of an id is the part before its first '-'.
// Run from code/: node --test src/editor/instances.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as app from '../views/TodayLayouts/layoutSpec.js'
import { APP_EXPORTS, finalSpec, newPanel, readSpec, samePanel } from './appSpec.js'
import { ADD_GROUPS, buildCatalog, filterCatalog } from './catalog.js'
import { addPanel, mapPanel, removePanel, removePanels, withProps } from './edits.js'
import { registerFromReady, typeRegistry } from './schema.js'
import { instanceNames, isSuffixedId, normalizeSpec, panelLabel, typeOfId, withRemovals } from './spec.js'

const J = JSON.stringify
const clone = (v) => JSON.parse(J(v))
const save = (stored, draft) => withRemovals(stored, finalSpec(draft, 'entry'), { samePanel: (a, b) => samePanel(a, b, 'entry') })
registerFromReady({ panelTypes: app.PANEL_TYPE_LIST, schemas: app.PANEL_SCHEMA_TABLE })

// The Entry board as the app stores it, plus a second weather card.
function storedWithTwoWeathers() {
  const base = clone(app.DEFAULT_ENTRY_SPEC)
  const w = base.panels.find((p) => p.id === 'weather')
  const second = { ...clone(w), id: 'weather-3fa9', x: 10, y: 60, z: 12, props: { ...clone(w.props), tempSize: 1.4 } }
  const spec = { ...base, panels: [...base.panels, second] }
  // What the app normalises when it keeps instances; else the editor's copy
  // of the second one, exactly as the editor would write it.
  return clone(readSpec(spec, 'entry'))
}

test('ids: the type of an id, and the suffixed scheme for any type', () => {
  assert.equal(typeOfId('weather'), 'weather')
  assert.equal(typeOfId('weather-3fa9'), 'weather')
  assert.equal(typeOfId('text-00aa'), 'text')
  assert.equal(typeOfId('foo'), 'foo')
  assert.ok(isSuffixedId('weather', 'weather-3fa9') && isSuffixedId('shape', 'shape-0000'))
  assert.ok(!isSuffixedId('weather', 'weather-3FA9') && !isSuffixedId('weather', 'weather-3fa') && !isSuffixedId('weather', 'weathers-3fa9'))
})

test('the editor normaliser keeps every instance, ids and order, and repairs a duplicate', () => {
  const out = normalizeSpec({
    panels: [
      { id: 'weather', type: 'weather', x: 1, y: 1, w: 30, h: 20 },
      { id: 'weather-3fa9', type: 'weather', x: 40, y: 1, w: 30, h: 20 },
      { id: 'weather', type: 'weather', x: 1, y: 40, w: 30, h: 20 },
      { id: 'clock-0001', x: 1, y: 70, w: 30, h: 20 },
      { type: 'agenda', x: 50, y: 50, w: 30, h: 20 },
    ],
  })
  const ids = out.panels.map((p) => p.id)
  assert.deepEqual(ids.slice(0, 2), ['weather', 'weather-3fa9'])
  assert.ok(isSuffixedId('weather', ids[2]) && !ids.slice(0, 2).includes(ids[2]))
  assert.deepEqual([out.panels[3].id, out.panels[3].type], ['clock-0001', 'clock'])
  assert.equal(out.panels[4].id, 'agenda')
  // Deterministic: the same repair twice.
  assert.equal(J(normalizeSpec(out)), J(out))
})

test('read and save: two weathers keep their ids, untouched panels go back byte for byte', () => {
  const stored = storedWithTwoWeathers()
  const read = readSpec(stored, 'entry')
  assert.deepEqual(read.panels.filter((p) => p.type === 'weather').map((p) => p.id), ['weather', 'weather-3fa9'])
  const body = save(stored, mapPanel(read, 'day', 'clock', withProps({ textScale: 1.1 })))
  body.panels.forEach((p, i) => (p.id === 'clock' ? assert.notEqual(J(p), J(stored.panels[i])) : assert.equal(J(p), J(stored.panels[i]))))
})

test('delete: the block goes from the PATCH; undo and save bring it back byte-identical', () => {
  const stored = storedWithTwoWeathers()
  const draft = readSpec(stored, 'entry')
  const gone = removePanel(draft, 'day', 'weather')
  const body = save(stored, gone)
  assert.ok(!body.panels.some((p) => p.id === 'weather'))
  assert.equal(body.panels.length, stored.panels.length - 1)
  body.panels.forEach((p) => assert.equal(J(p), J(stored.panels.find((q) => q.id === p.id))))
  // The hub now holds `body`; undo puts the pre-delete draft back.
  const after = clone(body)
  const back = save(after, draft)
  assert.equal(J(back.panels), J(stored.panels))
  // Several at once, one edit.
  const two = removePanels(draft, 'day', ['weather-3fa9', 'clock'])
  assert.deepEqual(two.panels.map((p) => p.id), draft.panels.map((p) => p.id).filter((id) => id !== 'weather-3fa9' && id !== 'clock'))
})

test('a second instance: a suffixed id clear of every part, the app type and look', () => {
  const draft = readSpec(clone(app.DEFAULT_ENTRY_SPEC), 'entry')
  const taken = new Set(draft.panels.map((p) => p.id))
  const first = newPanel('clock', 'entry', { z: 20 }, taken, { bare: true })
  assert.equal(first.panel.id, 'clock')
  const got = newPanel('weather', 'entry', { x: 60, y: 5, w: 39.52, h: 20.4, z: 20 }, taken, { bare: false })
  assert.ok(got && isSuffixedId('weather', got.panel.id) && !taken.has(got.panel.id))
  assert.equal(got.panel.type, 'weather')
  assert.deepEqual([got.panel.x, got.panel.y, got.panel.z], [60, 5, 20])
  assert.ok(['app', 'editor'].includes(got.idFrom))
  const next = addPanel(draft, 'day', got.panel)
  const saved = save(clone(app.DEFAULT_ENTRY_SPEC), next)
  assert.equal(saved.panels.at(-1).id, got.panel.id)
  assert.equal(saved.panels.filter((p) => p.type === 'weather').length, 2)
  console.log(`# instances: bundled app keeps them: ${APP_EXPORTS.instances}; the second id came from the ${got.idFrom}`)
})

test('names: the type label, then "Weather 2", "Weather 3" in list order', () => {
  const list = [
    { id: 'weather', type: 'weather' },
    { id: 'clock', type: 'clock' },
    { id: 'weather-3fa9', type: 'weather' },
    { id: 'weather-0b1c', type: 'weather' },
    { id: 'text-00aa', type: 'text', props: { text: 'Hello' } },
  ]
  const names = instanceNames(list, {})
  assert.deepEqual([...names.values()], ['Weather', 'Clock', 'Weather 2', 'Weather 3', 'Text'])
  assert.equal(panelLabel(list[2], {}, names), 'Weather 2')
  assert.equal(panelLabel(list[4], {}, names), 'Text: Hello')
  assert.equal(panelLabel(list[2], {}), 'Weather')
})

test('the Add block catalogue: every type, grouped in order, the shape twice, counts', () => {
  const groups = buildCatalog({ known: typeRegistry().known, counts: { weather: 2 }, labels: {} })
  const order = ADD_GROUPS.map((g) => g.id)
  const ids = groups.map((g) => g.id)
  assert.deepEqual(ids, [...order.filter((id) => ids.includes(id)), ...(ids.includes('other') ? ['other'] : [])])
  const listed = groups.flatMap((g) => g.items.map((it) => it.type))
  for (const t of typeRegistry().known) assert.ok(listed.includes(t), t)
  const blocks = groups.find((g) => g.id === 'blocks').items.map((it) => it.key)
  assert.deepEqual(blocks, ['text', 'image', 'shape', 'shape:behind'])
  const weather = groups.find((g) => g.id === 'weather').items.find((it) => it.type === 'weather')
  assert.equal(weather.count, 2)
  assert.ok(weather.description && weather.preview === 'previews/weather.png')
  for (const g of groups) for (const it of g.items) assert.ok(it.description, `${it.type} has a description`)
  assert.deepEqual(filterCatalog(groups, 'flip').flatMap((g) => g.items.map((it) => it.type)), ['flipclock'])
  assert.ok(filterCatalog(groups, 'calendar').some((g) => g.id === 'calendar'))
  assert.deepEqual(filterCatalog(groups, 'zzz'), [])
})

test('a type the app adds that no group names goes under Other', () => {
  registerFromReady({ panelTypes: [...app.PANEL_TYPE_LIST, { type: 'aurora', label: 'Aurora', kind: 'panel', unique: true }], schemas: app.PANEL_SCHEMA_TABLE })
  try {
    const groups = buildCatalog({ known: typeRegistry().known, labels: {} })
    assert.equal(groups.at(-1).id, 'other')
    assert.deepEqual(groups.at(-1).items.map((it) => it.label), ['Aurora'])
  } finally {
    registerFromReady({ panelTypes: app.PANEL_TYPE_LIST, schemas: app.PANEL_SCHEMA_TABLE })
  }
})
