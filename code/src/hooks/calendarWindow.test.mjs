// Tests for hooks/calendarWindow.js: the calendar store's window (the union
// of what the panels want, the request path, the range an answer covers).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WINDOW,
  calendarPath,
  cleanRange,
  cleanWindow,
  rangeOf,
  sameRange,
  unionWindow,
  wider,
} from './calendarWindow.js'

test('the default window is the agenda’s: six days from today, none back', () => {
  assert.deepEqual(DEFAULT_WINDOW, { days: 6, past: 0 })
  assert.deepEqual(unionWindow([]), { days: 6, past: 0 })
  assert.deepEqual(unionWindow([{ days: 2, past: 0 }, { days: 1 }]), { days: 6, past: 0 })
})

test('unionWindow: the widest of each, within the hub’s caps', () => {
  assert.deepEqual(unionWindow([{ days: 2, past: 5 }, { days: 43, past: 0 }]), { days: 43, past: 5 })
  assert.deepEqual(unionWindow([{ days: 400, past: 90 }]), { days: 60, past: 31 })
  assert.deepEqual(cleanWindow({ days: 'x', past: -3 }), { days: 6, past: 0 })
})

test('wider: a want that reaches further either way', () => {
  assert.equal(wider({ days: 6, past: 1 }, { days: 6, past: 0 }), true)
  assert.equal(wider({ days: 7, past: 0 }, { days: 6, past: 0 }), true)
  assert.equal(wider({ days: 6, past: 0 }, { days: 14, past: 3 }), false)
  assert.equal(wider({ days: 6, past: 0 }, null), true)
})

test('calendarPath: the default request unchanged, past only when asked', () => {
  assert.equal(calendarPath(DEFAULT_WINDOW), '/api/calendar?days=6')
  assert.equal(calendarPath({ days: 42, past: 31 }), '/api/calendar?days=42&past=31')
  assert.equal(calendarPath({ days: 14, past: 0 }), '/api/calendar?days=14')
})

test('rangeOf: the hub’s own dates, else its days from the request’s day', () => {
  const at = new Date(2026, 8, 26, 15).getTime()
  assert.deepEqual(rangeOf({ days: 42, past: 31, from: '2026-08-26', to: '2026-11-07' }, { days: 42, past: 31 }, at), {
    from: '2026-08-26',
    to: '2026-11-07',
  })
  // A hub from before the window: days capped at 14 there, and no past.
  assert.deepEqual(rangeOf({ days: 14 }, { days: 42, past: 31 }, at), { from: '2026-09-26', to: '2026-10-10' })
  assert.deepEqual(rangeOf({}, { days: 6, past: 0 }, at), { from: '2026-09-26', to: '2026-10-02' })
  assert.equal(rangeOf({}, {}, NaN), null)
})

test('cleanRange and sameRange', () => {
  assert.equal(cleanRange({ from: '2026-09-26', to: '2026-09-26' }), null)
  assert.equal(cleanRange({ from: 'x', to: '2026-09-26' }), null)
  assert.deepEqual(cleanRange({ from: '2026-09-26', to: '2026-09-27', other: 1 }), { from: '2026-09-26', to: '2026-09-27' })
  assert.equal(sameRange({ from: 'a', to: 'b' }, { from: 'a', to: 'b' }), true)
  assert.equal(sameRange(null, { from: 'a', to: 'b' }), false)
  assert.equal(sameRange(null, null), true)
})
