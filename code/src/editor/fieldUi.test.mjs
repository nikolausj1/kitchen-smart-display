// The field vocabulary (schema.js, fields.jsx): `showIf` on any field, and the
// two `ui` controls, an hourRange pair (one slider, two handles, hours) and a
// timeList (24-hour 'H:MM' times, comma-separated). The pure parts: when a
// field shows, the house-style hour and time labels, the handles' limits,
// and the time list's reading and writing.
// Run from code/: node --test src/editor/fieldUi.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as app from '../views/TodayLayouts/layoutSpec.js'
import { finalSpec, readSpec, samePanel } from './appSpec.js'
import { mapPanel, withProps } from './edits.js'
import {
  hiddenBecause,
  hourRangeDraw,
  hourRangePairs,
  hourRangeTrack,
  placeHandle,
  registerFromReady,
  showIfHolds,
  showIfMisses,
  shownFields,
  timeListMax,
  valueReader,
} from './schema.js'
import { withRemovals } from './spec.js'
import {
  addToTimeList,
  hourLabel,
  hourRangeText,
  hourTicks,
  parseTimeList,
  timeLabel,
  timeListText,
  timeMinutes,
  timeText,
} from './util.js'

const J = JSON.stringify

// The hourly forecast's five modes, as the app's schema will send them.
const MODE = {
  key: 'mode',
  label: 'Show',
  type: 'select',
  options: [
    ['next', 'Next hours'],
    ['until', 'Now until'],
    ['day', 'Whole day'],
    ['parts', 'Day parts'],
    ['times', 'Set times'],
  ],
  default: 'next',
}
const FIELDS = [
  MODE,
  { key: 'hours', label: 'Hours', type: 'number', min: 6, max: 24, step: 1, default: 12, showIf: { mode: 'next' } },
  { key: 'untilHour', label: 'Until', type: 'number', min: 12, max: 24, step: 1, default: 22, showIf: { mode: 'until' } },
  { key: 'startHour', label: 'Window', type: 'number', min: 0, max: 24, step: 1, default: 8, ui: 'hourRange', pair: 'endHour', showIf: { mode: 'day' } },
  { key: 'endHour', label: 'Until', type: 'number', min: 0, max: 24, step: 1, default: 22, ui: 'hourRange', pairOf: 'startHour', showIf: { mode: 'day' } },
  { key: 'times', label: 'Times', type: 'text', ui: 'timeList', max: 4, default: '7:00,12:00,17:00', showIf: { mode: 'times' } },
  { key: 'step', label: 'Every', type: 'select', options: [[1, '1 h'], [2, '2 h'], [3, '3 h']], default: 1, showIf: { mode: ['next', 'until', 'day'] } },
  { key: 'showTemps', label: 'Temperatures', type: 'toggle', default: true },
  { key: 'tempLine', label: 'Line', type: 'toggle', default: false, showIf: { mode: ['next', 'day'], showTemps: true } },
]
const keysShown = (props) => {
  const read = valueReader(FIELDS, props)
  return shownFields(FIELDS, read).map((f) => f.key)
}

test('showIf: a value, any of a list, every key; read with the defaults filled in', () => {
  // A saved block without `mode` has the schema's (Next hours).
  assert.deepEqual(keysShown({}), ['mode', 'hours', 'step', 'showTemps', 'tempLine'])
  assert.deepEqual(keysShown({ mode: 'until' }), ['mode', 'untilHour', 'step', 'showTemps'])
  // The hourRange partner is drawn with its first, never on its own.
  assert.deepEqual(keysShown({ mode: 'day' }), ['mode', 'startHour', 'step', 'showTemps', 'tempLine'])
  assert.deepEqual(keysShown({ mode: 'parts' }), ['mode', 'showTemps'])
  assert.deepEqual(keysShown({ mode: 'times' }), ['mode', 'times', 'showTemps'])
  // Several keys: all must hold.
  assert.deepEqual(keysShown({ mode: 'day', showTemps: false }), ['mode', 'startHour', 'step', 'showTemps'])
  // A stored value the select does not have reads as the default.
  assert.deepEqual(keysShown({ mode: 'bogus' }), keysShown({}))
})

test('showIf: how values compare, and a condition that asks for nothing usable', () => {
  const read = (v) => () => v
  assert.ok(showIfHolds({ step: 1 }, read('1')) && showIfHolds({ step: '3' }, read(3)))
  assert.ok(showIfHolds({ on: true }, read(true)) && !showIfHolds({ on: true }, read(false)))
  assert.ok(showIfHolds({ color: null }, read(undefined)) && !showIfHolds({ color: null }, read('#fff')))
  assert.ok(showIfHolds({ mode: ['a', 'b'] }, read('b')) && !showIfHolds({ mode: ['a', 'b'] }, read('c')))
  // Nothing to hold, or a slip in the schema: the field shows.
  for (const cond of [undefined, null, 'mode', ['mode'], {}, { mode: [] }, { mode: {} }, { mode: undefined }]) {
    assert.ok(showIfHolds(cond, read('x')), J(cond))
  }
  // A key no field has reads the props at that path (a box prop, a universal one).
  const r = valueReader(FIELDS, { background: 'card', title: { mode: 'custom' } })
  assert.ok(showIfHolds({ background: 'card', 'title.mode': 'custom' }, r))
  assert.ok(!showIfHolds({ background: 'none' }, r))
})

test('why a field is hidden: the setting and what it is set to', () => {
  const read = valueReader(FIELDS, { mode: 'day', showTemps: false })
  assert.deepEqual(showIfMisses(FIELDS.find((f) => f.key === 'tempLine').showIf, read), ['showTemps'])
  const hidden = FIELDS.filter((f) => ['hours', 'times', 'tempLine'].includes(f.key))
  assert.deepEqual(hiddenBecause(hidden, FIELDS, read), ['Show is Whole day', 'Temperatures is Off'])
})

test('hourRange pairs: both ways or not at all', () => {
  const { partnerOf, partners } = hourRangePairs(FIELDS)
  assert.equal(partnerOf.get('startHour').key, 'endHour')
  assert.deepEqual([...partners], ['endHour'])
  const plain = (list) => [...hourRangePairs(list).partnerOf.keys()]
  const a = { key: 'a', type: 'number', ui: 'hourRange', pair: 'b' }
  const b = { key: 'b', type: 'number', ui: 'hourRange', pairOf: 'a' }
  assert.deepEqual(plain([a, b]), ['a'])
  assert.deepEqual(plain([a, { ...b, pairOf: 'x' }]), [])
  assert.deepEqual(plain([a, { ...b, ui: 'slider' }]), [])
  assert.deepEqual(plain([a, { ...b, type: 'select', options: [[1, '1']] }]), [])
  assert.deepEqual(plain([{ ...a, pair: 'a' }]), [])
  // A field in one pair at most: b is a's partner, so b's own pair is ignored.
  const c = { key: 'c', type: 'number', ui: 'hourRange', pairOf: 'b' }
  assert.deepEqual(plain([a, { ...b, pair: 'c' }, c]), ['a'])
  // Unpaired, a field is drawn plain: both of a broken pair show.
  const broken = [a, { ...b, pairOf: 'x' }]
  assert.deepEqual(shownFields(broken, () => undefined).map((f) => f.key), ['a', 'b'])
})

test('an hourRange pair follows each side showIf: both, or one side alone', () => {
  // The app's hourly: the start is Whole day's, the end Whole day's and Now until's.
  const fields = [
    { key: 'mode', type: 'select', options: [['next', 'Next'], ['untilEnd', 'Now until'], ['wholeDay', 'Whole day']], default: 'next' },
    { key: 'startHour', label: 'Hours', type: 'number', min: 0, max: 23, default: 8, ui: 'hourRange', pair: 'endHour', showIf: { mode: 'wholeDay' } },
    { key: 'endHour', label: 'Until', type: 'number', min: 1, max: 24, default: 22, ui: 'hourRange', pairOf: 'startHour', showIf: { mode: ['wholeDay', 'untilEnd'] } },
  ]
  const pairs = hourRangePairs(fields)
  const drawn = (mode) => {
    const read = valueReader(fields, { mode })
    return shownFields(fields, read, pairs)
      .filter((f) => f.key !== 'mode')
      .map((f) => {
        const d = hourRangeDraw(f, pairs, read)
        return `${f.key}:${d.first.key}+${d.second.key}:${d.show}`
      })
  }
  assert.deepEqual(drawn('wholeDay'), ['startHour:startHour+endHour:both'])
  assert.deepEqual(drawn('untilEnd'), ['endHour:startHour+endHour:second'])
  assert.deepEqual(drawn('next'), [])
  // The other way round: the first shown, its partner hidden.
  const flipped = fields.map((f) => (f.key === 'endHour' ? { ...f, showIf: { mode: 'wholeDay' } } : f.key === 'startHour' ? { ...f, showIf: { mode: ['wholeDay', 'untilEnd'] } } : f))
  const fp = hourRangePairs(flipped)
  const read = valueReader(flipped, { mode: 'untilEnd' })
  assert.deepEqual(shownFields(flipped, read, fp).map((f) => f.key), ['mode', 'startHour'])
  assert.equal(hourRangeDraw(flipped[1], fp, read).show, 'first')
  assert.equal(hourRangeDraw(fields[0], pairs, read), null)
  // Alone, a handle keeps to its own range: the hidden side does not apply.
  const track = hourRangeTrack(fields[1], fields[2])
  assert.deepEqual([track.lo, track.hi, track.first, track.second], [0, 24, [0, 23], [1, 24]])
  assert.equal(placeHandle(track, 'second', 5, undefined), 5)
  assert.equal(placeHandle(track, 'second', 0, undefined), 1)
  assert.equal(placeHandle(track, 'second', 5, 8), 9)
})

test('hour labels in the house style', () => {
  const cases = [
    [0, 'Midnight'],
    [5, '5 am'],
    [11, '11 am'],
    [12, 'Noon'],
    [13, '1 pm'],
    [22, '10 pm'],
    [23, '11 pm'],
    [24, 'Midnight'],
    [8.5, '8:30 am'],
    [0.25, '12:15 am'],
    [12.5, '12:30 pm'],
    ['7', '7 am'],
  ]
  for (const [h, want] of cases) assert.equal(hourLabel(h), want, String(h))
  assert.equal(hourLabel(Number.NaN), '')
  assert.equal(hourRangeText(8, 22), '8 am to 10 pm')
  assert.equal(hourRangeText(0, 24), 'Midnight to Midnight')
  assert.equal(hourRangeText(6, 12), '6 am to Noon')
  assert.deepEqual(hourTicks(0, 24).map((t) => t.label), ['Midnight', '6 am', 'Noon', '6 pm', 'Midnight'])
  assert.deepEqual(hourTicks(5, 23).map((t) => t.h), [5, 12, 18, 23])
  assert.deepEqual(hourTicks(6, 12).map((t) => t.h), [6, 8, 10, 12])
  assert.deepEqual(hourTicks(3, 3), [])
})

test('the handles: on a step, inside their own range, never crossing', () => {
  const [, , , start, end] = FIELDS
  const track = hourRangeTrack(start, end)
  assert.deepEqual(track, { lo: 0, hi: 24, step: 1, first: [0, 24], second: [0, 24] })
  // Snapped to whole hours.
  assert.equal(placeHandle(track, 'first', 8.4, 22), 8)
  assert.equal(placeHandle(track, 'first', 8.6, 22), 9)
  // At least one step apart, whichever handle moves.
  assert.equal(placeHandle(track, 'first', 23, 22), 21)
  assert.equal(placeHandle(track, 'first', 22, 22), 21)
  assert.equal(placeHandle(track, 'second', 3, 8), 9)
  assert.equal(placeHandle(track, 'second', 30, 8), 24)
  assert.equal(placeHandle(track, 'first', -5, 22), 0)
  // Each handle keeps to its own field's range; the track spans both.
  const t2 = hourRangeTrack({ ...start, min: 4, max: 20 }, { ...end, min: 6, max: 23, step: 2 })
  assert.deepEqual([t2.lo, t2.hi, t2.step], [4, 23, 1])
  assert.equal(placeHandle(t2, 'first', 1, 22), 4)
  assert.equal(placeHandle(t2, 'second', 24, 8), 23)
  // Half hours.
  const t3 = hourRangeTrack({ ...start, step: 0.5 }, end)
  assert.equal(placeHandle(t3, 'first', 8.3, 22), 8.5)
  assert.equal(placeHandle(t3, 'first', 22, 22), 21.5)
  // No room (the other handle at this one's end): as near as its range allows.
  assert.equal(placeHandle(track, 'first', 5, 0), 0)
  assert.equal(placeHandle(track, 'second', 5, 24), 24)
  // Missing ranges: 0 to 24, a whole hour.
  assert.deepEqual(hourRangeTrack({ key: 'a' }, { key: 'b' }), { lo: 0, hi: 24, step: 1, first: [0, 24], second: [0, 24] })
})

test('time lists: read leniently, written normalised and in order', () => {
  assert.deepEqual(parseTimeList('7:30,12:00'), [450, 720])
  assert.deepEqual(parseTimeList(' 07:30 , 12:00 ,'), [450, 720])
  assert.deepEqual(parseTimeList('17:45,7:30,7:30,0:00'), [0, 450, 1065])
  assert.deepEqual(parseTimeList(''), [])
  assert.deepEqual(parseTimeList(undefined), [])
  for (const bad of ['7', '7.30', '24:00', '7:60', '7:30pm', 'banana', '7:30;8:00', '7:5', 730, ['7:30']]) {
    assert.equal(parseTimeList(bad), null, J(bad))
  }
  assert.equal(timeListText([1065, 450, 450, 0]), '0:00,7:30,17:45')
  assert.equal(timeListText(parseTimeList(' 07:30 , 12:00 ,')), '7:30,12:00')
  assert.equal(timeListText([]), '')
  assert.deepEqual([timeMinutes('07:05'), timeMinutes('23:59'), timeMinutes('24:00')], [425, 1439, null])
  assert.deepEqual([timeText(0), timeText(425), timeText(1065)], ['0:00', '7:05', '17:45'])
})

test('time labels in the house style', () => {
  const cases = [
    ['7:30', '7:30 am'],
    ['7:00', '7 am'],
    ['07:05', '7:05 am'],
    ['12:00', 'Noon'],
    ['12:30', '12:30 pm'],
    ['0:00', 'Midnight'],
    ['0:15', '12:15 am'],
    ['17:45', '5:45 pm'],
    ['23:00', '11 pm'],
  ]
  for (const [t, want] of cases) assert.equal(timeLabel(t), want, t)
  assert.equal(timeLabel('soon'), 'soon')
})

test('adding to a time list: in order, once, and no more than its max', () => {
  const list = parseTimeList('7:00,17:00')
  const a = addToTimeList(list, timeMinutes('12:30'), 4)
  assert.deepEqual([timeListText(a.list), a.added, a.reason], ['7:00,12:30,17:00', true, null])
  const dup = addToTimeList(a.list, timeMinutes('07:00'), 4)
  assert.deepEqual([dup.list, dup.added, dup.reason], [a.list, false, 'duplicate'])
  const b = addToTimeList(a.list, timeMinutes('6:15'), 4)
  assert.equal(timeListText(b.list), '6:15,7:00,12:30,17:00')
  const full = addToTimeList(b.list, timeMinutes('20:00'), 4)
  assert.deepEqual([full.list, full.added, full.reason], [b.list, false, 'full'])
  assert.deepEqual([timeListMax({ max: 4 }), timeListMax({}), timeListMax({ max: 0 }), timeListMax({ max: 3.7 })], [4, 8, 8, 3])
})

test('a hidden knob keeps its stored value through a read, an edit and a save', () => {
  const type = {
    type: 'hoursx',
    label: 'Hours (test)',
    kind: 'panel',
    unique: true,
    min: { w: 5, h: 5 },
    schema: { fields: FIELDS, elements: [{ key: 'title', label: 'Title' }] },
  }
  registerFromReady({ panelTypes: [...app.PANEL_TYPE_LIST, type], schemas: app.PANEL_SCHEMA_TABLE })
  try {
    const panel = {
      id: 'hoursx',
      type: 'hoursx',
      x: 10,
      y: 10,
      w: 40,
      h: 20,
      z: 30,
      props: { mode: 'next', startHour: 9, endHour: 21, times: '6:30,18:00', hours: 8 },
    }
    const stored = { ...JSON.parse(J(app.DEFAULT_ENTRY_SPEC)), panels: [...JSON.parse(J(app.DEFAULT_ENTRY_SPEC.panels)), panel] }
    const read = readSpec(stored, 'entry')
    const got = read.panels.find((p) => p.id === 'hoursx').props
    assert.deepEqual([got.mode, got.startHour, got.endHour, got.times, got.hours], ['next', 9, 21, '6:30,18:00', 8])
    // Only the mode changes: the knobs it hides stay as they were.
    const edited = mapPanel(read, 'day', 'hoursx', withProps({ mode: 'parts' }))
    const body = withRemovals(stored, finalSpec(edited, 'entry'), { samePanel: (a, b) => samePanel(a, b, 'entry') })
    const saved = body.panels.find((p) => p.id === 'hoursx').props
    assert.deepEqual([saved.mode, saved.startHour, saved.endHour, saved.times, saved.hours], ['parts', 9, 21, '6:30,18:00', 8])
  } finally {
    registerFromReady({ panelTypes: app.PANEL_TYPE_LIST, schemas: app.PANEL_SCHEMA_TABLE })
  }
})
