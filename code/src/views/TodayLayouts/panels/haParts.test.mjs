// Tests for panels/haParts.js: the Home Assistant panels' pure parts
// (docs/designs/panels-and-controls.md, chunk 5): state words, tones and
// icons by kind, "since", the hold's timing, what a refused press says,
// the lookups, the picker's action, the chips' list, the editor's live
// options.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ENTITY_LIST_MAX,
  HA_TEXT,
  HOLD_MS,
  chipIds,
  fmtSince,
  haActionFor,
  haBlocked,
  haEntityFor,
  haErrorText,
  haIconName,
  haKnobOptions,
  haOptionsKey,
  haStateWord,
  haStatusNote,
  haTone,
  haView,
  holdProgress,
  holdRemaining,
  insideRect,
  parseEntityList,
  pickerAction,
  releaseOutcome,
  withHaOptions,
} from './haParts.js'
import { PANEL_SCHEMA_TABLE } from '../layoutSpec.js'
import { demoHa } from '../data/demo.js'

const e = (kind, state, extra = {}) => ({ id: extra.id || `${kind}.x`, kind, state, ...extra })

// --- State words and tones --------------------------------------------------------------

test('a cover: closed is calm, open and on its way are amber', () => {
  assert.equal(haStateWord(e('cover', 'closed')), 'Closed')
  assert.equal(haStateWord(e('cover', 'open')), 'Open')
  assert.equal(haStateWord(e('cover', 'opening')), 'Opening')
  assert.equal(haStateWord(e('cover', 'closing')), 'Closing')
  assert.equal(haStateWord(e('cover', 'open', { position: 40 })), 'Open 40%')
  assert.equal(haStateWord(e('cover', 'open', { position: 100 })), 'Open')
  assert.equal(haTone(e('cover', 'closed')), 'calm')
  assert.equal(haTone(e('cover', 'open')), 'alert')
  assert.equal(haTone(e('cover', 'closing')), 'alert')
  assert.equal(haIconName(e('cover', 'closed')), 'cover-closed')
  assert.equal(haIconName(e('cover', 'opening')), 'cover-open')
})

test('a lock: locked is calm; unlocked, jammed and on its way are amber', () => {
  assert.equal(haStateWord(e('lock', 'locked')), 'Locked')
  assert.equal(haStateWord(e('lock', 'unlocked')), 'Unlocked')
  assert.equal(haStateWord(e('lock', 'jammed')), 'Jammed')
  assert.equal(haStateWord(e('lock', 'unlocking')), 'Unlocking')
  assert.equal(haTone(e('lock', 'locked')), 'calm')
  assert.equal(haTone(e('lock', 'unlocked')), 'alert')
  assert.equal(haTone(e('lock', 'jammed')), 'alert')
  assert.equal(haTone(e('lock', 'locking')), 'alert')
  assert.equal(haIconName(e('lock', 'locked')), 'lock-locked')
  assert.equal(haIconName(e('lock', 'locking')), 'lock-locked')
  assert.equal(haIconName(e('lock', 'unlocked')), 'lock-unlocked')
})

test('a door contact: on is Open (amber), off is Closed (calm)', () => {
  const door = (s) => e('door', s, { id: 'binary_sensor.front_door_contact_open' })
  assert.equal(haStateWord(door('on')), 'Open')
  assert.equal(haStateWord(door('off')), 'Closed')
  assert.equal(haTone(door('on')), 'alert')
  assert.equal(haTone(door('off')), 'calm')
  assert.equal(haIconName(door('on')), 'door-open')
  assert.equal(haIconName(door('off')), 'door-closed')
})

test('lights, switches and modes: On is amber, Off is calm', () => {
  for (const kind of ['light', 'switch', 'mode']) {
    assert.equal(haStateWord(e(kind, 'on')), 'On', kind)
    assert.equal(haStateWord(e(kind, 'off')), 'Off', kind)
    assert.equal(haTone(e(kind, 'on')), 'alert', kind)
    assert.equal(haTone(e(kind, 'off')), 'calm', kind)
    assert.equal(haIconName(e(kind, 'on')), `${kind}-on`, kind)
    assert.equal(haIconName(e(kind, 'off')), `${kind}-off`, kind)
  }
})

test('a person: Home is calm; Away and any zone are amber', () => {
  assert.equal(haStateWord(e('person', 'home')), 'Home')
  assert.equal(haStateWord(e('person', 'not_home')), 'Away')
  assert.equal(haStateWord(e('person', 'Work')), 'Work')
  assert.equal(haTone(e('person', 'home')), 'calm')
  assert.equal(haTone(e('person', 'not_home')), 'alert')
  assert.equal(haTone(e('person', 'Work')), 'alert')
  assert.equal(haIconName(e('person', 'home')), 'person-home')
  assert.equal(haIconName(e('person', 'not_home')), 'person-away')
})

test('a select says its option as written, calm', () => {
  assert.equal(haStateWord(e('select', 'Late Evening')), 'Late Evening')
  assert.equal(haTone(e('select', 'Late Evening')), 'calm')
  assert.equal(haIconName(e('select', 'Auto')), 'select')
})

test('a sensor: its value with its unit; a binary sensor by its class', () => {
  assert.equal(haStateWord(e('sensor', '71.46', { unit: '°F' })), '71.5°F')
  assert.equal(haStateWord(e('sensor', '41', { unit: '%' })), '41%')
  assert.equal(haStateWord(e('sensor', '412', { unit: 'ppm' })), '412 ppm')
  assert.equal(haStateWord(e('sensor', 'clean')), 'Clean')
  assert.equal(haTone(e('sensor', '71.46', { unit: '°F' })), 'calm')
  const motion = (s) => e('sensor', s, { id: 'binary_sensor.hall_motion', deviceClass: 'motion' })
  assert.equal(haStateWord(motion('on')), 'Detected')
  assert.equal(haStateWord(motion('off')), 'Clear')
  assert.equal(haTone(motion('on')), 'alert')
  assert.equal(haStateWord(e('sensor', 'on', { id: 'binary_sensor.thing' })), 'On')
  const window = e('sensor', 'on', { id: 'binary_sensor.window', deviceClass: 'window' })
  assert.equal(haStateWord(window), 'Open')
  assert.equal(haIconName(window), 'door-open')
})

test('no state, unavailable and unknown are grey, whatever the kind', () => {
  for (const kind of ['cover', 'lock', 'door', 'light', 'mode', 'select', 'person', 'sensor']) {
    assert.equal(haTone(e(kind, 'unavailable')), 'unknown', kind)
    assert.equal(haTone(e(kind, 'unknown')), 'unknown', kind)
    assert.equal(haTone(e(kind, null)), 'unknown', kind)
  }
  assert.equal(haStateWord(e('lock', 'unavailable')), 'Unavailable')
  assert.equal(haStateWord(e('cover', 'unknown')), 'Unknown')
  assert.equal(haStateWord(e('cover', null)), '--')
  assert.equal(haStateWord(null), '--')
  assert.equal(haIconName(e('lock', 'unavailable')), 'lock-locked')
  assert.equal(haIconName(null), 'other')
})

test('haView: grey whenever Home Assistant is not connected, the word kept', () => {
  const garage = e('cover', 'open')
  assert.deepEqual(haView(garage, 'ok'), { word: 'Open', tone: 'alert', icon: 'cover-open' })
  assert.deepEqual(haView(garage, 'offline'), { word: 'Open', tone: 'unknown', icon: 'cover-open' })
  assert.equal(haView(garage, 'hub').tone, 'unknown')
  assert.equal(haStatusNote('ok'), null)
  assert.equal(haStatusNote('offline'), 'Home Assistant offline')
  assert.equal(haStatusNote('hub'), 'Hub unreachable')
})

// --- Since ---------------------------------------------------------------------------------

test('fmtSince: today a time, this week a day and a time, else a date', () => {
  const now = new Date(2026, 8, 27, 16, 5) // Sun 27 Sep 2026, 4:05 pm, local
  const at = (d, h, m) => new Date(2026, 8, d, h, m).toISOString()
  assert.equal(fmtSince(at(27, 16, 12), now), 'since 4:12 pm') // a little ahead: today's
  assert.equal(fmtSince(at(27, 9, 5), now), 'since 9:05 am')
  assert.equal(fmtSince(at(26, 21, 40), now), 'since Sat 9:40 pm')
  assert.equal(fmtSince(at(21, 8, 0), now), 'since Mon 8:00 am')
  assert.equal(fmtSince(at(20, 8, 0), now), 'since Sep 20')
  assert.equal(fmtSince(null, now), '')
  assert.equal(fmtSince('garbage', now), '')
  assert.equal(fmtSince(at(27, 9, 5), null), '')
})

// --- The hold ------------------------------------------------------------------------------

test('the hold: 1.2 s, the ring filling, the time left', () => {
  assert.equal(HOLD_MS, 1200)
  assert.equal(holdProgress(1000, 1000), 0)
  assert.equal(holdProgress(1000, 1600), 0.5)
  assert.equal(holdProgress(1000, 2200), 1)
  assert.equal(holdProgress(1000, 5000), 1)
  assert.equal(holdProgress(1000, 900), 0)
  assert.equal(holdRemaining(1000, 1000), 1200)
  assert.equal(holdRemaining(1000, 1900), 300)
  assert.equal(holdRemaining(1000, 2300), 0)
})

test('a release: a tap fires on the button; a hold only once it has lasted', () => {
  const tap = { confirm: 'tap', downAt: 0, fired: false }
  assert.equal(releaseOutcome(tap, 80, true), 'fire')
  assert.equal(releaseOutcome(tap, 80, false), 'cancel')
  const hold = { confirm: 'hold', downAt: 0, fired: false }
  assert.equal(releaseOutcome(hold, 1199, true), 'cancel')
  assert.equal(releaseOutcome(hold, 600, true), 'cancel')
  assert.equal(releaseOutcome(hold, 1200, true), 'fire')
  assert.equal(releaseOutcome(hold, 1500, false), 'cancel')
  assert.equal(releaseOutcome({ ...hold, fired: true }, 1500, true), 'none')
  assert.equal(releaseOutcome(null, 10, true), 'none')
})

test('insideRect, with a slop', () => {
  const r = { left: 100, top: 50, right: 300, bottom: 150 }
  assert.ok(insideRect(r, 200, 100, 0))
  assert.ok(!insideRect(r, 310, 100, 0))
  assert.ok(insideRect(r, 310, 100, 12))
  assert.ok(!insideRect(r, 320, 100, 12))
  assert.ok(!insideRect(null, 200, 100, 12))
  assert.ok(!insideRect(r, NaN, 100, 12))
})

// --- A refused press -----------------------------------------------------------------------

test('haErrorText: 403 the switch, 429 the rate limit, else unreachable', () => {
  assert.equal(haErrorText({ ok: false, status: 403, error: 'actions are disabled on the dashboard' }), 'Buttons are off on the dashboard')
  assert.equal(haErrorText({ ok: false, status: 429, error: 'rate limited' }), 'Try again in a moment')
  assert.equal(haErrorText({ ok: false, status: 200, error: 'Home Assistant answered HTTP 500' }), 'Home Assistant unreachable')
  assert.equal(haErrorText({ ok: false, status: 0, error: 'hub unreachable' }), 'Home Assistant unreachable')
  assert.equal(haErrorText({ ok: false, status: 404, error: 'unknown action' }), 'Not on the whitelist')
  assert.equal(haErrorText(null), 'Home Assistant unreachable')
})

// --- Lookups and blocks --------------------------------------------------------------------

const DEMO = demoHa(Date.UTC(2026, 8, 27, 23, 5))

test('haEntityFor: the entity, or what to say instead', () => {
  assert.equal(haEntityFor(DEMO, 'cover.garage_door_controller').entity.state, 'open')
  assert.deepEqual(haEntityFor(DEMO, ''), { entity: null, message: 'Choose an entity' })
  assert.deepEqual(haEntityFor(DEMO, '', HA_TEXT.chooseSelect), { entity: null, message: 'Choose a select' })
  assert.deepEqual(haEntityFor(DEMO, 'light.kitchen'), { entity: null, message: 'Not on the whitelist' })
  assert.equal(haEntityFor({ status: 'loading', loaded: false }, 'light.kitchen').message, 'Waiting for Home Assistant')
  assert.equal(haEntityFor({ status: 'hub', loaded: false }, 'light.kitchen').message, 'Hub unreachable')
  assert.equal(haEntityFor(null, 'light.kitchen').message, 'Waiting for Home Assistant')
})

test('haActionFor and haBlocked: the action, and why it cannot go', () => {
  assert.equal(haActionFor(DEMO, 'garage-toggle').action.confirm, 'hold')
  assert.equal(haActionFor(DEMO, '').message, 'Choose an action')
  assert.equal(haActionFor(DEMO, 'open-sesame').message, 'Not on the whitelist')
  assert.equal(haActionFor({ ...DEMO, actionsKnown: false }, 'garage-toggle').message, 'Waiting for Home Assistant')
  assert.equal(haBlocked(DEMO), null)
  assert.equal(haBlocked({ ...DEMO, actionsEnabled: false }), 'Buttons are off on the dashboard')
  assert.equal(haBlocked({ ...DEMO, actionsEnabled: null }), null) // unknown: the hub decides
  assert.equal(haBlocked({ ...DEMO, status: 'offline' }), 'Home Assistant offline')
  assert.equal(haBlocked({ ...DEMO, status: 'hub' }), 'Hub unreachable')
})

test('pickerAction: the named one when it fits, else the first that sets the select', () => {
  const acts = DEMO.actions
  const sel = 'input_select.day_part_override'
  assert.equal(pickerAction(acts, sel, '').id, 'daypart-set')
  assert.equal(pickerAction(acts, sel, 'daypart-set').id, 'daypart-set')
  assert.equal(pickerAction(acts, sel, 'garage-toggle'), null) // names another entity
  assert.equal(pickerAction(acts, sel, 'nope'), null)
  assert.equal(pickerAction(acts, 'cover.garage_door_controller', ''), null) // none takes an option
  assert.equal(pickerAction(acts, '', ''), null)
  assert.equal(pickerAction(null, sel, ''), null)
})

// --- The chips' list -----------------------------------------------------------------------

test('parseEntityList: ids only, lower-cased, each once, capped', () => {
  assert.deepEqual(parseEntityList('input_boolean.mode_away, Input_Boolean.MODE_GUEST;light.downstairs input_boolean.mode_away'), [
    'input_boolean.mode_away',
    'input_boolean.mode_guest',
    'light.downstairs',
  ])
  assert.deepEqual(parseEntityList('Away, Guest, not.an id'), ['not.an'])
  assert.deepEqual(parseEntityList(['light.a', 7, 'light.b']), ['light.a', 'light.b'])
  assert.deepEqual(parseEntityList(''), [])
  assert.deepEqual(parseEntityList(null), [])
  const many = Array.from({ length: 30 }, (_, i) => `light.l${i}`).join(',')
  assert.equal(parseEntityList(many).length, ENTITY_LIST_MAX)
})

test('chipIds: the ids given, else every mode on the whitelist', () => {
  assert.deepEqual(chipIds('', DEMO), [
    'input_boolean.mode_away',
    'input_boolean.mode_guest',
    'input_boolean.mode_outside',
    'input_boolean.mode_vacation',
    'input_boolean.mode_working_late',
  ])
  assert.deepEqual(chipIds('person.justin, person.sheena', DEMO), ['person.justin', 'person.sheena'])
  assert.deepEqual(chipIds('', null), [])
})

// --- The editor's live options ----------------------------------------------------------------

test('haKnobOptions: the whitelist as [id, label], by kind of knob', () => {
  const ents = haKnobOptions('entity', DEMO)
  assert.equal(ents.length, 13)
  assert.deepEqual(ents[0], ['cover.garage_door_controller', 'Garage'])
  assert.deepEqual(haKnobOptions('selectEntity', DEMO), [['input_select.day_part_override', 'Day part']])
  const acts = haKnobOptions('action', DEMO)
  assert.equal(acts.length, 10)
  assert.deepEqual(acts[1], ['garage-toggle', 'Garage (hold)'])
  assert.deepEqual(haKnobOptions('optionAction', DEMO), [['daypart-set', 'Day part']])
  assert.deepEqual(haKnobOptions('entity', { loaded: false }), [])
  assert.deepEqual(haKnobOptions('action', { ...DEMO, actionsKnown: false }), [])
  // Two with one label carry their ids.
  const twin = { ...DEMO, entities: { 'light.a': { label: 'Lamp' }, 'light.b': { label: 'Lamp' }, 'light.c': { label: 'Desk' } } }
  assert.deepEqual(haKnobOptions('entity', twin), [
    ['light.a', 'Lamp (light.a)'],
    ['light.b', 'Lamp (light.b)'],
    ['light.c', 'Desk'],
  ])
})

test('withHaOptions: selects of the live whitelist; text while it is empty; a stored stray kept', () => {
  const saved = {
    panels: [{ id: 'hastatus', type: 'hastatus', props: { entity: 'light.gone' } }],
    variants: { evening: { panels: [{ id: 'habutton', type: 'habutton', props: { action: 'garage-toggle' } }] } },
  }
  const live = withHaOptions(PANEL_SCHEMA_TABLE, DEMO, saved)
  const field = (type, key) => live[type].fields.find((f) => f.key === key)
  const entity = field('hastatus', 'entity')
  assert.equal(entity.type, 'select')
  assert.deepEqual(entity.options[0], ['', 'None'])
  assert.deepEqual(entity.options.at(-1), ['light.gone', 'light.gone (not on the whitelist)'])
  assert.equal(entity.options.length, 1 + 13 + 1)
  assert.equal(entity.default, '')
  assert.equal(field('habutton', 'action').type, 'select')
  assert.equal(field('habutton', 'action').options.length, 1 + 10) // garage-toggle is listed: no stray
  assert.deepEqual(field('hapicker', 'entity').options, [
    ['', 'None'],
    ['input_select.day_part_override', 'Day part'],
  ])
  assert.deepEqual(field('hapicker', 'action').options, [
    ['', 'Automatic'],
    ['daypart-set', 'Day part'],
  ])
  const chips = field('hachips', 'entities')
  assert.equal(chips.type, 'text')
  assert.ok(chips.hint.includes('On the whitelist: cover.garage_door_controller, '))
  // Every other type is the table's own object.
  assert.equal(live.clock, PANEL_SCHEMA_TABLE.clock)
  assert.equal(field('hastatus', 'size').type, 'number')

  const empty = withHaOptions(PANEL_SCHEMA_TABLE, { status: 'loading', loaded: false, entities: {}, actions: [], actionsKnown: false }, null)
  assert.equal(empty.hastatus.fields.find((f) => f.key === 'entity').type, 'text')
  assert.equal(empty.habutton.fields.find((f) => f.key === 'action').type, 'text')
  assert.equal(empty.hachips.fields.find((f) => f.key === 'entities').hint, PANEL_SCHEMA_TABLE.hachips.fields[0].hint)
})

test('haOptionsKey changes with the options, not with the states', () => {
  const k1 = haOptionsKey(DEMO)
  const moved = { ...DEMO, entities: { ...DEMO.entities, 'cover.garage_door_controller': { ...DEMO.entities['cover.garage_door_controller'], state: 'closed' } } }
  assert.equal(haOptionsKey(moved), k1)
  const relabelled = { ...DEMO, entities: { ...DEMO.entities, 'cover.garage_door_controller': { ...DEMO.entities['cover.garage_door_controller'], label: 'Garage door' } } }
  assert.notEqual(haOptionsKey(relabelled), k1)
  assert.notEqual(haOptionsKey({ ...DEMO, actions: DEMO.actions.slice(1) }), k1)
})

// --- The demo -----------------------------------------------------------------------------

test('the demo house: garage open, door locked, Justin home, Sheena away, Auto, downstairs on', () => {
  const s = (id) => DEMO.entities[id].state
  assert.equal(DEMO.status, 'ok')
  assert.equal(DEMO.actionsEnabled, true)
  assert.equal(s('cover.garage_door_controller'), 'open')
  assert.equal(s('lock.front_door_smart_code_with_home_connect_technology'), 'locked')
  assert.equal(s('person.justin'), 'home')
  assert.equal(s('person.sheena'), 'not_home')
  assert.equal(s('input_select.day_part_override'), 'Auto')
  assert.equal(s('light.downstairs'), 'on')
  assert.deepEqual(DEMO.entities['input_select.day_part_override'].options, [
    'Auto', 'Morning', 'Day', 'Afternoon', 'Evening', 'Late Evening', 'Night', 'Overnight',
  ])
  assert.equal(fmtSince(DEMO.entities['cover.garage_door_controller'].lastChanged, new Date(Date.UTC(2026, 8, 27, 23, 5))).startsWith('since '), true)
})
