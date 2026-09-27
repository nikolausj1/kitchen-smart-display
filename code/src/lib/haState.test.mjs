// Tests for lib/haState.js: the Home Assistant data a screen reads
// (docs/designs/panels-and-controls.md, chunk 5): the house state's compact
// slice cleaned, the hub's snapshot cleaned, the two merged, an action's
// answer read.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanHaSnapshot, cleanHouseHa, isEntityId, kindForId, mergeHa, readActionResult } from './haState.js'

// The live hub's shapes (GET /api/state.ha and GET /api/ha/state, read
// 2026-09-27), cut down.
const HOUSE = {
  connected: true,
  entities: {
    'cover.garage_door_controller': {
      state: 'closed',
      attributes: { friendly_name: 'Garage Door Controller' },
      lastChanged: '2026-09-27T03:14:23.875468+00:00',
    },
    'input_select.day_part_override': {
      state: 'Auto',
      attributes: { friendly_name: 'Day Part Override', options: ['Auto', 'Morning', 'Evening'] },
      lastChanged: '2026-09-27T12:00:00.270363+00:00',
    },
    'person.sheena': { state: 'home', attributes: { friendly_name: 'Sheena' }, lastChanged: '2026-09-27T03:10:42.534459+00:00' },
  },
}

const SNAP = {
  connected: true,
  configured: true,
  fetchedAt: '2026-09-27T08:34:24.734Z',
  lastEventAt: '2026-09-27T15:20:44.674Z',
  error: null,
  actionsEnabled: false,
  entities: {
    'cover.garage_door_controller': {
      state: 'closed',
      attributes: { friendly_name: 'Garage Door Controller', device_class: 'garage' },
      lastChanged: '2026-09-27T03:14:23.875468+00:00',
      label: 'Garage',
      kind: 'cover',
    },
    'input_select.day_part_override': {
      state: 'Auto',
      attributes: { friendly_name: 'Day Part Override', icon: 'mdi:calendar-clock', options: ['Auto', 'Morning', 'Evening'] },
      lastChanged: '2026-09-27T12:00:00.270363+00:00',
      label: 'Day part',
      kind: 'select',
    },
    'person.sheena': { state: 'home', attributes: { friendly_name: 'Sheena' }, lastChanged: '2026-09-27T03:10:42.534459+00:00', label: 'Sheena', kind: 'person' },
    'sensor.kitchen_temperature': {
      state: '71.46',
      attributes: { friendly_name: 'Kitchen Temperature', unit_of_measurement: '°F', device_class: 'temperature' },
      lastChanged: '2026-09-27T15:00:00+00:00',
      label: 'Kitchen',
      kind: 'sensor',
    },
  },
  actions: [
    { id: 'garage-toggle', label: 'Garage', entity: 'cover.garage_door_controller', service: 'cover.toggle', confirm: 'hold', needs: [] },
    { id: 'daypart-set', label: 'Day part', entity: 'input_select.day_part_override', service: 'input_select.select_option', confirm: 'tap', needs: ['option'] },
  ],
}

test('isEntityId and kindForId follow the hub', () => {
  assert.ok(isEntityId('light.downstairs'))
  assert.ok(isEntityId('lock.front_door_smart_code_with_home_connect_technology'))
  assert.ok(!isEntityId('Light.Downstairs') && !isEntityId('downstairs') && !isEntityId('') && !isEntityId(null))
  assert.equal(kindForId('input_boolean.mode_away'), 'switch')
  assert.equal(kindForId('input_select.day_part_override'), 'select')
  assert.equal(kindForId('binary_sensor.front_door_contact_open'), 'sensor')
  assert.equal(kindForId('weather.home'), 'other')
})

test('cleanHouseHa keeps connected, state, lastChanged and three attributes', () => {
  const raw = JSON.parse(JSON.stringify(HOUSE))
  raw.entities['cover.garage_door_controller'].attributes.current_position = 140
  raw.entities['cover.garage_door_controller'].attributes.brightness = 200
  raw.entities['not an id'] = { state: 'on' }
  raw.entities['light.bad'] = 'on'
  const out = cleanHouseHa(raw)
  assert.equal(out.connected, true)
  assert.deepEqual(Object.keys(out.entities), ['cover.garage_door_controller', 'input_select.day_part_override', 'person.sheena'])
  assert.deepEqual(out.entities['cover.garage_door_controller'], {
    state: 'closed',
    attributes: { friendly_name: 'Garage Door Controller', current_position: 100 },
    lastChanged: '2026-09-27T03:14:23.875468+00:00',
  })
  assert.deepEqual(out.entities['input_select.day_part_override'].attributes.options, ['Auto', 'Morning', 'Evening'])
  assert.equal(cleanHouseHa(null), null)
  assert.equal(cleanHouseHa([]), null)
  assert.deepEqual(cleanHouseHa({ connected: 'yes' }), { connected: false, entities: {} })
})

test('cleanHaSnapshot: labels, kinds, unit, actions; actions on only for a literal true', () => {
  const out = cleanHaSnapshot(SNAP)
  assert.equal(out.actionsEnabled, false)
  assert.equal(out.entities['cover.garage_door_controller'].label, 'Garage')
  assert.equal(out.entities['cover.garage_door_controller'].attributes.device_class, 'garage')
  assert.equal(out.entities['input_select.day_part_override'].attributes.icon, undefined)
  assert.equal(out.entities['sensor.kitchen_temperature'].attributes.unit_of_measurement, '°F')
  assert.deepEqual(out.actions.map((a) => [a.id, a.confirm, a.needs]), [
    ['garage-toggle', 'hold', []],
    ['daypart-set', 'tap', ['option']],
  ])
  assert.equal(cleanHaSnapshot({ ...SNAP, actionsEnabled: 'true' }).actionsEnabled, false)
  assert.equal(cleanHaSnapshot({ ...SNAP, actionsEnabled: true }).actionsEnabled, true)
  assert.equal(cleanHaSnapshot(null), null)
})

test('cleanHaSnapshot: an unknown confirm is a hold; a bad action or a repeat id is dropped', () => {
  const out = cleanHaSnapshot({
    actions: [
      { id: 'a', label: 'A', entity: 'light.x', service: 'light.toggle', confirm: 'pin' },
      { id: 'b', entity: 'light.x', service: 'light.toggle' },
      { id: 'c', label: 'C', entity: 'not an id', service: 'light.toggle', confirm: 'tap' },
      { label: 'D', entity: 'light.x', confirm: 'tap' },
      { id: 'a', label: 'A again', entity: 'light.y', confirm: 'tap' },
      { id: 'e', label: 'E', entity: 'light.x', service: 'light.toggle', confirm: 'tap' },
    ],
  })
  assert.deepEqual(out.actions.map((a) => [a.id, a.label, a.confirm]), [
    ['a', 'A', 'hold'],
    ['b', 'b', 'hold'],
    ['e', 'E', 'tap'],
  ])
})

test('mergeHa: nothing yet is loading; the snapshot adds labels, kinds, units and actions', () => {
  const none = mergeHa(null)
  assert.equal(none.status, 'loading')
  assert.equal(none.loaded, false)
  assert.equal(none.connected, false)
  assert.equal(none.actionsEnabled, null)
  assert.deepEqual(none.entities, {})

  const houseOnly = mergeHa({ house: cleanHouseHa(HOUSE), houseAt: 1000 })
  assert.equal(houseOnly.status, 'ok')
  assert.equal(houseOnly.actionsKnown, false)
  assert.equal(houseOnly.actionsEnabled, null)
  const g = houseOnly.entities['cover.garage_door_controller']
  assert.equal(g.label, 'Garage Door Controller') // the friendly name, until the dashboard's label arrives
  assert.equal(g.kind, 'cover')
  assert.equal(houseOnly.entities['input_select.day_part_override'].kind, 'select')

  const both = mergeHa({ house: cleanHouseHa(HOUSE), houseAt: 1000, snap: cleanHaSnapshot(SNAP), snapAt: 2000 })
  assert.equal(both.status, 'ok')
  assert.equal(both.entities['cover.garage_door_controller'].label, 'Garage')
  assert.equal(both.entities['sensor.kitchen_temperature'].unit, '°F')
  assert.deepEqual(both.entities['input_select.day_part_override'].options, ['Auto', 'Morning', 'Evening'])
  assert.equal(both.actionsKnown, true)
  assert.equal(both.actionsEnabled, false)
  assert.equal(both.actions.length, 2)
  assert.equal(both.fetchedAt, 2000)
})

test('mergeHa: each entity reads the reading Home Assistant changed later, whichever source brought it', () => {
  const house = cleanHouseHa(HOUSE)
  const snap = cleanHaSnapshot(SNAP)
  // The snapshot (fetched fast after a press) has the garage opening, newer.
  snap.entities['cover.garage_door_controller'].state = 'opening'
  snap.entities['cover.garage_door_controller'].lastChanged = '2026-09-27T16:00:00+00:00'
  // The house state, polled later, still has the old reading for the garage
  // but a newer one for Sheena.
  house.entities['person.sheena'].state = 'not_home'
  house.entities['person.sheena'].lastChanged = '2026-09-27T16:05:00+00:00'
  const m = mergeHa({ house, houseAt: 3000, snap, snapAt: 2000 })
  assert.equal(m.entities['cover.garage_door_controller'].state, 'opening')
  assert.equal(m.entities['person.sheena'].state, 'not_home')
  // The same change on both: the source that arrived later, the house here.
  house.entities['input_select.day_part_override'].attributes.options = ['Auto', 'Night']
  const m2 = mergeHa({ house, houseAt: 3000, snap, snapAt: 2000 })
  assert.deepEqual(m2.entities['input_select.day_part_override'].options, ['Auto', 'Night'])
})

test('mergeHa: the newer source is the whitelist and says whether Home Assistant is connected', () => {
  const house = cleanHouseHa({ ...HOUSE, connected: false })
  const snap = cleanHaSnapshot(SNAP)
  delete snap.entities['person.sheena'] // taken off the whitelist since
  assert.equal(mergeHa({ house, houseAt: 1000, snap, snapAt: 2000 }).status, 'ok')
  assert.ok(!('person.sheena' in mergeHa({ house, houseAt: 1000, snap, snapAt: 2000 }).entities))
  const houseNewer = mergeHa({ house, houseAt: 3000, snap, snapAt: 2000 })
  assert.equal(houseNewer.status, 'offline')
  assert.equal(houseNewer.connected, false)
  assert.ok('person.sheena' in houseNewer.entities)
})

test('mergeHa: the hub unreachable is its own status, and the last readings stay', () => {
  const m = mergeHa({ house: cleanHouseHa(HOUSE), houseAt: 1000, hubDown: true, error: 'Failed to fetch' })
  assert.equal(m.status, 'hub')
  assert.equal(m.connected, false)
  assert.equal(m.loaded, true)
  assert.equal(m.entities['cover.garage_door_controller'].state, 'closed')
  assert.equal(m.error, 'Failed to fetch')
})

test('readActionResult: the hub body, its status, else the HTTP status', () => {
  assert.deepEqual(readActionResult(200, { ok: true }), { ok: true, status: 200, error: null })
  assert.deepEqual(readActionResult(200, { ok: true, status: 200, error: null }), { ok: true, status: 200, error: null })
  assert.deepEqual(readActionResult(403, { ok: false, status: 403, error: 'actions are disabled on the dashboard' }), {
    ok: false,
    status: 403,
    error: 'actions are disabled on the dashboard',
  })
  assert.deepEqual(readActionResult(429, { ok: false, status: 429, error: 'rate limited' }), { ok: false, status: 429, error: 'rate limited' })
  assert.deepEqual(readActionResult(200, { ok: false, status: 200, error: 'Home Assistant answered HTTP 500' }), {
    ok: false,
    status: 200,
    error: 'Home Assistant answered HTTP 500',
  })
  assert.deepEqual(readActionResult(502, null), { ok: false, status: 502, error: 'HTTP 502' })
  assert.deepEqual(readActionResult(500, { ok: true }), { ok: false, status: 500, error: 'HTTP 500' })
})
