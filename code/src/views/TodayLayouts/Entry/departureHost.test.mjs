import { test } from 'node:test'
import assert from 'node:assert/strict'
import { departureHost, departureInCountdowns } from './departureHost.js'

// A school settings object as settings.school holds it: the window 7:00 to 9:00.
const SCHOOL = { autoShowAt: { hour: 7, minute: 0 }, morningEndsAt: { hour: 9, minute: 0 }, noSchool: false }
const box = (id, type, props = {}) => ({ id, type, props })
const at = (h, m, extra = {}) => ({ now: new Date(2026, 8, 28, h, m), school: SCHOOL, timer: null, ...extra })

test('the countdown block keeps its countdowns on a school morning by default', () => {
  const panels = [box('clock', 'clock'), box('countdowns', 'countdowns')]
  assert.equal(departureInCountdowns(at(7, 30)), true)
  assert.equal(departureHost(panels, panels, at(7, 30)), null)
})

test('the School departure switch lets the countdown block take the departure', () => {
  const panels = [box('countdowns', 'countdowns', { schoolDeparture: true })]
  assert.equal(departureHost(panels, panels, at(7, 30)), 'countdowns')
  assert.equal(departureHost(panels, panels, at(10, 0)), null, 'outside the window, no manual timer')
})

test('a manual timer borrows only a switched-on countdown block', () => {
  const manual = { timer: { mode: 'active', kind: 'manual' } }
  const off = [box('countdowns', 'countdowns')]
  const on = [box('countdowns', 'countdowns', { schoolDeparture: true })]
  assert.equal(departureHost(off, off, at(15, 0, manual)), null)
  assert.equal(departureHost(on, on, at(15, 0, manual)), 'countdowns')
})

test('the Board rule still uses the now-playing box while a countdown runs', () => {
  const running = { timer: { mode: 'active', kind: 'default' } }
  const panels = [box('countdowns', 'countdowns'), box('nowplaying', 'nowplaying')]
  assert.equal(departureHost(panels, panels, at(7, 30, running)), 'nowplaying')
})

test('a layout with its own Departure block never borrows', () => {
  const panels = [box('countdowns', 'countdowns', { schoolDeparture: true }), box('departure', 'departure')]
  assert.equal(departureHost(panels, panels, at(7, 30)), null)
})

test('with several countdown blocks, the first switched-on one in list order', () => {
  const a = box('countdowns', 'countdowns')
  const b = box('countdowns-1a2b', 'countdowns', { schoolDeparture: true })
  const c = box('countdowns-3c4d', 'countdowns', { schoolDeparture: true })
  assert.equal(departureHost([c, b, a], [a, b, c], at(7, 30)), 'countdowns-1a2b')
})

test('a no-school day never borrows the countdown block', () => {
  const panels = [box('countdowns', 'countdowns', { schoolDeparture: true })]
  const d = { ...at(7, 30), school: { ...SCHOOL, noSchool: true } }
  assert.equal(departureHost(panels, panels, d), null)
})
