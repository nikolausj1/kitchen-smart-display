// Tests for lib/calendarViews.js: the calendar views' pure parts (the time
// formats, places and descriptions, consolidation, up next, the week grid's
// placement and lanes, the month grid, the windows each view asks for).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAgendaDays } from './agenda.js'
import {
  AGENDA_SCAN_DAYS,
  agendaItems,
  allDayText,
  calendarState,
  daysWithEvents,
  splitPaint,
  tinyClock,
  boardCalendarNeed,
  calendarNeed,
  clockParts,
  clockText,
  covered,
  coversAll,
  dayWord,
  descriptionLine,
  eventsOnDay,
  hour24Of,
  hourLabel,
  isOver,
  laneLayout,
  legendOf,
  longDate,
  monthGrid,
  placeOf,
  rangeText,
  shortClock,
  timeText,
  untilText,
  upNext,
  viewEvents,
  visibleRows,
  weekGrid,
  weekStartKey,
} from './calendarViews.js'

// Saturday 2026-09-26, local time.
const at = (h, m = 0, day = 26, month = 8) => new Date(2026, month, day, h, m, 0)
const iso = (d) => d.toISOString()
const JUSTIN = { calendarId: 'justin@x', calendarLabel: 'Justin', color: '#e0457b' }
const SHEENA = { calendarId: 'sheena@x', calendarLabel: 'Sheena', color: '#4a90e2' }

function timed(id, cal, title, start, end, extra = {}) {
  return { id, ...cal, title, allDay: false, start: iso(start), end: iso(end), status: 'confirmed', ...extra }
}

function allDay(id, cal, title, startDate, endDate, extra = {}) {
  return { id, ...cal, title, allDay: true, start: null, end: null, startDate, endDate, status: 'confirmed', ...extra }
}

// --- Time formats -------------------------------------------------------------------

test('hour24Of: the knob, else the screen, else 12-hour', () => {
  assert.equal(hour24Of('24h'), true)
  assert.equal(hour24Of('12h', true), false)
  assert.equal(hour24Of('auto'), false)
  assert.equal(hour24Of('auto', true), true)
  assert.equal(hour24Of(undefined, null), false)
})

test('clock texts in 12 and 24 hours', () => {
  assert.deepEqual(clockParts(at(9, 5), false), { hm: '9:05', ampm: 'am' })
  assert.deepEqual(clockParts(at(0, 30), false), { hm: '12:30', ampm: 'am' })
  assert.deepEqual(clockParts(at(12, 0), false), { hm: '12:00', ampm: 'pm' })
  assert.deepEqual(clockParts(at(9, 5), true), { hm: '09:05', ampm: '' })
  assert.equal(clockText(at(17, 0), false), '5:00 pm')
  assert.equal(clockText(at(17, 0), true), '17:00')
  assert.equal(shortClock(at(9, 0), false), '9 am')
  assert.equal(shortClock(at(9, 30), false), '9:30 am')
  assert.equal(shortClock(at(21, 0), true), '21:00')
  assert.equal(clockText(new Date('nope'), false), '--:--')
})

test('rangeText: one meridiem once, both when they differ, the later day named', () => {
  assert.equal(rangeText(at(9), at(10, 30), false), '9:00 – 10:30 am')
  assert.equal(rangeText(at(11, 30), at(13), false), '11:30 am – 1:00 pm')
  assert.equal(rangeText(at(9), at(10, 30), true), '09:00 – 10:30')
  // To midnight is still that evening.
  assert.equal(rangeText(at(22), at(0, 0, 27), false), '10:00 pm – 12:00 am')
  assert.equal(rangeText(at(22), at(1, 0, 27), false), '10:00 pm – Sun 1:00 am')
  // No end, or none after the start: the start alone.
  assert.equal(rangeText(at(9), at(9), false), '9:00 am')
  assert.equal(rangeText(at(9), null, false), '9:00 am')
})

test('hourLabel', () => {
  assert.equal(hourLabel(7, false), '7 AM')
  assert.equal(hourLabel(12, false), '12 PM')
  assert.equal(hourLabel(0, false), '12 AM')
  assert.equal(hourLabel(24, false), '12 AM')
  assert.equal(hourLabel(7, true), '07')
})

test('dayWord and longDate', () => {
  const today = '2026-09-26'
  assert.equal(dayWord('2026-09-26', today), 'Today')
  assert.equal(dayWord('2026-09-27', today), 'Tomorrow')
  assert.equal(dayWord('2026-09-25', today), 'Yesterday')
  assert.equal(dayWord('2026-09-29', today), 'Tuesday')
  assert.equal(dayWord('2026-10-03', today), 'Sat, Oct 3')
  assert.equal(dayWord('2026-09-20', today), 'Sun, Sep 20')
  assert.equal(longDate('2026-09-26'), 'Saturday, September 26')
})

// --- Places and descriptions ----------------------------------------------------------

test('placeOf: the place before the street address, no state, zip or country', () => {
  assert.equal(placeOf('McGilvra Elementary, 1617 38th Ave E, Seattle, WA 98112'), 'McGilvra Elementary')
  assert.equal(placeOf('F5 Rooftop, 801 5th Ave, Seattle, WA 98104'), 'F5 Rooftop')
  assert.equal(placeOf('Bayview Playfield, North Field B, Seattle, WA'), 'Bayview Playfield, North Field B, Seattle')
  assert.equal(placeOf('1617 38th Ave E, Seattle, WA'), '1617 38th Ave E')
  assert.equal(placeOf('Zoom'), 'Zoom')
  assert.equal(placeOf('Lake Chelan, USA'), 'Lake Chelan')
  assert.equal(placeOf('  '), null)
  assert.equal(placeOf(null), null)
})

test('descriptionLine: the first line people wrote, HTML read as text, markers skipped', () => {
  assert.equal(descriptionLine('Bring cleats\nand water'), 'Bring cleats')
  assert.equal(descriptionLine('<p>Snacks: <b>Chase</b> &amp; Vinny</p><p>more</p>'), 'Snacks: Chase & Vinny')
  assert.equal(descriptionLine('countdown 14\nlabel: Cabin!\nimage: cabin\ncolor: green\n\nPack the car'), 'Pack the car')
  assert.equal(descriptionLine('countdown\n'), null)
  assert.equal(descriptionLine('The countdown is on'), 'The countdown is on')
  assert.equal(descriptionLine(''), null)
  const long = descriptionLine('x'.repeat(400))
  assert.equal(long.length, 200)
  assert.ok(long.endsWith('…'))
})

// --- Events as the views draw them -------------------------------------------------------

test('viewEvents: dates parsed once, colours from the calendar, junk dropped', () => {
  const list = viewEvents([
    timed('a', JUSTIN, '  Vinny   soccer ', at(17), at(18, 15), { location: 'Lower Woodland Playfield, 5851 W Green Lake Way N, Seattle', description: 'Cleats' }),
    allDay('b', SHEENA, 'Sheena in Chicago', '2026-09-27', '2026-09-29'),
    { id: 'c', title: 'no start', allDay: false },
    { id: 'd', title: 'cancelled', allDay: true, startDate: '2026-09-26', status: 'cancelled' },
    null,
  ])
  assert.equal(list.length, 2)
  const [soccer, chicago] = list
  assert.equal(soccer.title, 'Vinny soccer')
  assert.ok(soccer.start instanceof Date)
  assert.equal(soccer.startDate, '2026-09-26')
  assert.equal(soccer.endDate, '2026-09-27')
  assert.deepEqual(soccer.colors, ['#e0457b'])
  assert.equal(soccer.place, 'Lower Woodland Playfield')
  assert.equal(soccer.description, 'Cleats')
  assert.equal(soccer.long, false)
  assert.equal(chicago.allDay, true)
  assert.equal(chicago.tint, 'rgba(74, 144, 226, 0.22)')
})

test('viewEvents: consolidate merges the same event on two calendars, both colours', () => {
  const events = [
    timed('j1', JUSTIN, 'Dinner at Mom’s', at(18), at(20)),
    timed('s1', SHEENA, 'dinner at mom’s', at(18), at(20), { location: 'Mom’s' }),
    timed('s2', SHEENA, 'Dinner at Mom’s', at(18), at(21)), // a different end: its own
    allDay('j2', JUSTIN, 'Fall break', '2026-10-05', '2026-10-10'),
    allDay('s3', SHEENA, 'Fall break', '2026-10-05', '2026-10-10'),
  ]
  const off = viewEvents(events)
  assert.equal(off.length, 5)
  const on = viewEvents(events, { consolidate: true })
  assert.equal(on.length, 3)
  assert.deepEqual(on[0].colors, ['#e0457b', '#4a90e2'])
  assert.deepEqual(on[0].calendars.map((c) => c.label), ['Justin', 'Sheena'])
  assert.equal(on[0].location, 'Mom’s') // the first one there is
  assert.equal(on[1].id, 's2')
  assert.deepEqual(on[2].colors, ['#e0457b', '#4a90e2'])
})

test('viewEvents: consolidate never merges within one calendar, and folds in the hub’s alsoOn', () => {
  const twice = viewEvents([timed('a', JUSTIN, 'Swim', at(9), at(10)), timed('b', JUSTIN, 'Swim', at(9), at(10))], { consolidate: true })
  assert.equal(twice.length, 2)
  const invited = [timed('a', JUSTIN, 'Swim', at(9), at(10), { alsoOn: [{ ...SHEENA }] })]
  assert.deepEqual(viewEvents(invited).map((v) => v.colors), [['#e0457b']])
  assert.deepEqual(viewEvents(invited, { consolidate: true }).map((v) => v.colors), [['#e0457b', '#4a90e2']])
})

test('viewEvents: colorBy none paints no calendar colour', () => {
  const [v] = viewEvents([timed('a', JUSTIN, 'Swim', at(9), at(10))], { colorBy: 'none' })
  assert.deepEqual(v.colors, [])
  assert.equal(v.color, null)
  assert.equal(v.tint, null)
})

test('viewEvents: a timed event of a day or more is long', () => {
  const [v] = viewEvents([timed('a', JUSTIN, 'Conference', at(9), at(17, 0, 28))])
  assert.equal(v.long, true)
  assert.equal(v.endDate, '2026-09-29')
})

test('agendaItems: the very same rows at the defaults; merged, placed and described on request', () => {
  const events = [
    timed('j1', JUSTIN, 'Dinner', at(18), at(20), { location: 'Mom\u2019s house, 12 Elm St, Seattle', description: '<p>Bring pie</p>' }),
    timed('s1', SHEENA, 'Dinner', at(18), at(20), { alsoOn: [{ ...JUSTIN }] }),
    timed('s2', SHEENA, 'Swim', at(9), at(10), { alsoOn: [{ ...JUSTIN }] }),
  ]
  const [today] = buildAgendaDays(events, at(8), 1)
  assert.equal(agendaItems(today.events), today.events)
  assert.equal(agendaItems(today.events, { consolidate: false, colorBy: 'calendar' }), today.events)
  const merged = agendaItems(today.events, { consolidate: true, withPlace: true, withDescription: true })
  assert.deepEqual(merged.map((v) => [v.title, v.colors]), [
    ['Swim', ['#4a90e2', '#e0457b']],
    ['Dinner', ['#e0457b', '#4a90e2']],
  ])
  assert.equal(merged[1].place, 'Mom\u2019s house')
  assert.equal(merged[1].description, 'Bring pie')
  // The keys stay the first copy's, so React keeps its rows.
  assert.equal(merged[1].key, today.events[1].key)
  const plain = agendaItems(today.events, { colorBy: 'none' })
  assert.equal(plain.length, 3)
  assert.deepEqual(plain[0].colors, [])
})

test('legendOf: the hub’s calendars in order, else the events’', () => {
  assert.deepEqual(legendOf([{ id: 'j', label: 'Justin', color: '#e0457b' }, { id: 'x', label: 'Broken', color: 'nope' }]), [
    { id: 'j', label: 'Justin', color: '#e0457b' },
  ])
  assert.deepEqual(legendOf([], [timed('a', SHEENA, 'x', at(9), at(10)), timed('b', SHEENA, 'y', at(9), at(10))]), [
    { id: 'sheena@x', label: 'Sheena', color: '#4a90e2' },
  ])
})

// --- Days, rows, what an event is now --------------------------------------------------------

const DAY = viewEvents([
  timed('dentist', SHEENA, 'Chase dentist', at(8, 15), at(9)),
  allDay('pj', SHEENA, 'PJ and Stuffy day', '2026-09-26', '2026-09-27'),
  timed('lunch', JUSTIN, 'Lunch with Dana', at(12, 30), at(13, 30)),
  timed('soccer', JUSTIN, 'Vinny soccer', at(17), at(18, 15)),
  allDay('chicago', SHEENA, 'Sheena in Chicago', '2026-09-27', '2026-09-29'),
  timed('swim', JUSTIN, 'Vinny swim meet', at(9, 0, 27), at(11, 30, 27)),
  timed('late', JUSTIN, 'Late show', at(23, 0, 27), at(0, 30, 28)),
])

test('eventsOnDay: all day first, then by start; futureOnly drops what is over', () => {
  const now = at(15)
  assert.deepEqual(eventsOnDay(DAY, '2026-09-26', now).map((v) => v.id), ['pj', 'dentist', 'lunch', 'soccer'])
  assert.deepEqual(eventsOnDay(DAY, '2026-09-26', now, true).map((v) => v.id), ['pj', 'soccer'])
  // A timed event on the day it starts, an all-day one on every day it covers.
  assert.deepEqual(eventsOnDay(DAY, '2026-09-27', now).map((v) => v.id), ['chicago', 'swim', 'late'])
  assert.deepEqual(eventsOnDay(DAY, '2026-09-28', now).map((v) => v.id), ['chicago'])
})

test('visibleRows: finished rows give up their places first', () => {
  const rows = eventsOnDay(DAY, '2026-09-26', at(15))
  const { shown, more } = visibleRows(rows, at(15), 2)
  assert.deepEqual(shown.map((v) => v.id), ['pj', 'soccer'])
  assert.equal(more, 2)
  assert.equal(visibleRows(rows, at(15), 9).more, 0)
})

test('isOver, timeText and allDayText', () => {
  const soccer = DAY.find((v) => v.id === 'soccer')
  const chicago = DAY.find((v) => v.id === 'chicago')
  assert.equal(isOver(soccer, at(18, 15)), true)
  assert.equal(isOver(soccer, at(18, 14)), false)
  assert.equal(timeText(soccer, at(15), false), '5:00 pm')
  assert.equal(timeText(soccer, at(15), false, true), '5:00 – 6:15 pm')
  assert.equal(timeText(soccer, at(17, 30), false), 'until 6:15 pm')
  assert.equal(timeText(soccer, at(15), true, true), '17:00 – 18:15')
  assert.equal(allDayText(chicago, '2026-09-26'), 'All day through Mon')
  assert.equal(timeText(DAY.find((v) => v.id === 'pj'), at(15), false), 'All day')
})

test('untilText: now, minutes, hours, then the day', () => {
  const soccer = DAY.find((v) => v.id === 'soccer')
  assert.equal(untilText(soccer, at(16, 20)), 'in 40 min')
  assert.equal(untilText(soccer, new Date(2026, 8, 26, 16, 59, 30)), 'in 1 min')
  assert.equal(untilText(soccer, at(14, 55)), 'in 2 hr 5 min')
  assert.equal(untilText(soccer, at(14, 0)), 'in 3 hr')
  assert.equal(untilText(soccer, at(17, 5)), 'Now')
  assert.equal(untilText(DAY.find((v) => v.id === 'swim'), at(15)), 'Tomorrow')
  assert.equal(untilText(DAY.find((v) => v.id === 'pj'), at(15)), 'Today')
  assert.equal(untilText(DAY.find((v) => v.id === 'chicago'), at(15)), 'Tomorrow')
})

// --- Up next ------------------------------------------------------------------------

test('upNext: the next timed event, then what follows it', () => {
  const r = upNext(DAY, at(15), { hoursAhead: 48, count: 3 })
  assert.equal(r.next.id, 'soccer')
  // Today's all-day event started before the soccer: not "after" it.
  assert.deepEqual(r.rows.map((v) => v.id), ['chicago', 'swim', 'late'])
  assert.equal(r.more, 0)
  const two = upNext(DAY, at(15), { hoursAhead: 48, count: 2 })
  assert.equal(two.more, 1)
})

test('upNext: a running event is next; the window bounds the list', () => {
  const r = upNext(DAY, at(17, 30), { hoursAhead: 12, count: 6 })
  assert.equal(r.next.id, 'soccer')
  // Within 12 hours of 5:30 pm: the Chicago days start at midnight.
  assert.deepEqual(r.rows.map((v) => v.id), ['chicago'])
})

test('upNext: a trip of a day or more is next only when nothing else is', () => {
  const trip = viewEvents([timed('trip', JUSTIN, 'Justin in Denver', at(9, 0, 25), at(18, 0, 28))])
  const list = trip.concat(DAY)
  const r = upNext(list, at(15), { hoursAhead: 48, count: 6 })
  assert.equal(r.next.id, 'soccer')
  const alone = upNext(trip, at(15), { hoursAhead: 48 })
  assert.equal(alone.next.id, 'trip')
  assert.equal(untilText(alone.next, at(15)), 'Now')
  assert.equal(timeText(alone.next, at(15), false), 'until Mon 6:00 pm')
  assert.equal(timeText(DAY.find((v) => v.id === 'late'), at(23, 30, 27), false), 'until Mon 12:30 am')
})

test('upNext: with no timed event ahead, the first all-day one', () => {
  const r = upNext(DAY.filter((v) => v.allDay), at(15), { hoursAhead: 24, count: 3 })
  assert.equal(r.next.id, 'pj')
  assert.deepEqual(r.rows.map((v) => v.id), ['chicago'])
  assert.deepEqual(upNext([], at(15)), { next: null, rows: [], more: 0 })
})

// --- Week grid ----------------------------------------------------------------------

test('weekStartKey: today, or the Monday or Sunday on or before it', () => {
  assert.equal(weekStartKey('2026-09-26', 'today'), '2026-09-26')
  assert.equal(weekStartKey('2026-09-26', 'monday'), '2026-09-21')
  assert.equal(weekStartKey('2026-09-26', 'sunday'), '2026-09-20')
  assert.equal(weekStartKey('2026-09-28', 'monday'), '2026-09-28')
  assert.equal(weekStartKey('2026-09-27', 'monday'), '2026-09-21')
  assert.equal(weekStartKey('2026-09-27', 'sunday'), '2026-09-27')
})

test('laneLayout: side by side while they overlap, at most three lanes, then +n', () => {
  const s = (id, top, bottom) => ({ id, top, bottom })
  const one = laneLayout([s('a', 0, 0.1), s('b', 0.2, 0.3)])
  assert.deepEqual(one.items.map((i) => [i.id, i.lane, i.lanes]), [['a', 0, 1], ['b', 0, 1]])
  const two = laneLayout([s('a', 0, 0.3), s('b', 0.1, 0.2), s('c', 0.25, 0.4)])
  assert.deepEqual(two.items.map((i) => [i.id, i.lane, i.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 1, 2]])
  const five = laneLayout([s('a', 0, 0.5), s('b', 0, 0.4), s('c', 0.1, 0.3), s('d', 0.1, 0.2), s('e', 0.15, 0.35)], 3)
  assert.deepEqual(five.items.map((i) => [i.id, i.lane, i.lanes]), [['a', 0, 3], ['b', 1, 3]])
  assert.deepEqual(five.more, [{ top: 0.1, bottom: 0.35, lane: 2, lanes: 3, count: 3 }])
})

test('weekGrid: blocks placed by start and duration within the hours', () => {
  const g = weekGrid(DAY, { now: at(15), startDay: 'today', days: 7, startHour: 7, endHour: 21 })
  assert.equal(g.columns.length, 7)
  assert.deepEqual(g.hours, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  const today = g.columns[0]
  assert.equal(today.isToday, true)
  assert.equal(today.weekday, 'Sat')
  assert.equal(today.dayNum, 26)
  const soccer = today.blocks.find((b) => b.v.id === 'soccer')
  assert.ok(Math.abs(soccer.top - 10 / 14) < 1e-9)
  assert.ok(Math.abs(soccer.height - 1.25 / 14) < 1e-9)
  assert.equal(soccer.past, false)
  const dentist = today.blocks.find((b) => b.v.id === 'dentist')
  assert.equal(dentist.past, true)
  // The now line: 3 pm is 8 of 14 hours down today's column.
  assert.deepEqual(g.now, { col: 0, top: 8 / 14 })
})

test('weekGrid: outside the hours pinned to the edge, overnight cut at midnight', () => {
  const g = weekGrid(DAY, { now: at(15), startDay: 'today', days: 7, startHour: 7, endHour: 21 })
  const sun = g.columns[1]
  const late = sun.blocks.find((b) => b.v.id === 'late')
  assert.equal(late.clipBottom, true)
  assert.ok(Math.abs(late.top + late.height - 1) < 1e-9)
  assert.ok(Math.abs(late.height - 0.5 / 14) < 1e-9)
  const mon = g.columns[2]
  const tail = mon.blocks.find((b) => b.v.id === 'late')
  assert.equal(tail.clipTop, true)
  assert.equal(tail.top, 0)
})

test('weekGrid: minHours sets the shortest block', () => {
  const list = viewEvents([timed('r', JUSTIN, 'Recycling out', at(20), at(20, 15))])
  const normal = weekGrid(list, { now: at(8), startDay: 'today', days: 7, startHour: 7, endHour: 21 }).columns[0].blocks[0]
  assert.ok(Math.abs(normal.height - 0.5 / 14) < 1e-9)
  const compact = weekGrid(list, { now: at(8), startDay: 'today', days: 7, startHour: 7, endHour: 21, minHours: 0.75 }).columns[0].blocks[0]
  assert.ok(Math.abs(compact.height - 0.75 / 14) < 1e-9)
  assert.ok(Math.abs(compact.top - 13 / 14) < 1e-9)
  // Near the foot: pushed up rather than past it.
  const late = viewEvents([timed('l', JUSTIN, 'Lights out', at(20, 45), at(20, 50))])
  const b = weekGrid(late, { now: at(8), startDay: 'today', days: 7, startHour: 7, endHour: 21, minHours: 0.75 }).columns[0].blocks[0]
  assert.ok(Math.abs(b.top + b.height - 1) < 1e-9)
})

test('weekGrid: all-day and long events as bars across their days', () => {
  const list = DAY.concat(viewEvents([timed('conf', JUSTIN, 'Conference', at(9, 0, 29), at(17, 0, 30))]))
  const g = weekGrid(list, { now: at(15), startDay: 'monday', days: 7, startHour: 7, endHour: 21 })
  // Mon Sep 21 .. Sun Sep 27: PJ day on Sat (col 5), Chicago from Sun (col 6), past the edge.
  const bars = g.allDay.rows.map((r) => [r.v.id, r.col, r.span, r.row, r.contRight])
  assert.deepEqual(bars, [['pj', 5, 1, 0, false], ['chicago', 6, 1, 0, true]])
  assert.equal(g.columns[0].isPast, true)
  const next = weekGrid(list, { now: at(15), startDay: 'today', days: 7, startHour: 7, endHour: 21 })
  assert.deepEqual(next.allDay.rows.map((r) => [r.v.id, r.col, r.span]), [['pj', 0, 1], ['chicago', 1, 2], ['conf', 3, 2]])
  // Long events are bars, never blocks.
  assert.ok(!next.columns[3].blocks.some((b) => b.v.id === 'conf'))
})

test('weekGrid: futureOnly leaves out what is over; overlapping blocks share lanes', () => {
  const g = weekGrid(DAY, { now: at(15), startDay: 'today', days: 5, futureOnly: true })
  assert.equal(g.columns.length, 5)
  assert.deepEqual(g.columns[0].blocks.map((b) => b.v.id), ['soccer'])
  const busy = viewEvents([
    timed('a', JUSTIN, 'A', at(17), at(18)),
    timed('b', SHEENA, 'B', at(17), at(18)),
    timed('c', JUSTIN, 'C', at(17, 30), at(18, 30)),
    timed('d', SHEENA, 'D', at(17, 45), at(18)),
  ])
  const col = weekGrid(busy, { now: at(8), startDay: 'today', days: 7 }).columns[0]
  assert.equal(col.blocks.length, 2)
  assert.deepEqual(col.more.map((m) => m.count), [2])
})

// --- Month grid ------------------------------------------------------------------------

test('monthGrid: six weeks from the week of the 1st, either week start', () => {
  const g = monthGrid(DAY, { now: at(15), weekStart: 'sunday' })
  assert.equal(g.label, 'September 2026')
  assert.equal(g.monthKey, '2026-09')
  assert.deepEqual(g.weekdays, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  assert.equal(g.cells.length, 42)
  assert.equal(g.cells[0].key, '2026-08-30') // Sep 1 2026 is a Tuesday
  assert.equal(g.cells[0].inMonth, false)
  assert.equal(g.cells[2].key, '2026-09-01')
  const today = g.cells.find((c) => c.isToday)
  assert.equal(today.key, '2026-09-26')
  assert.deepEqual(today.events.map((v) => v.id), ['pj', 'dentist', 'lunch', 'soccer'])
  assert.deepEqual(g.cells.find((c) => c.key === '2026-09-28').events.map((v) => v.id), ['chicago'])
  const mon = monthGrid(DAY, { now: at(15), weekStart: 'monday' })
  assert.equal(mon.cells[0].key, '2026-08-31')
  assert.deepEqual(mon.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
})

test('monthGrid: the next month', () => {
  const g = monthGrid([], { now: at(15), month: 'next', weekStart: 'sunday' })
  assert.equal(g.label, 'October 2026')
  assert.equal(g.cells[0].key, '2026-09-27') // Oct 1 2026 is a Thursday
  assert.equal(g.cells[41].key, '2026-11-07')
  // Across a year end.
  assert.equal(monthGrid([], { now: new Date(2026, 11, 20), month: 'next' }).label, 'January 2027')
})

// --- The windows ------------------------------------------------------------------------

test('calendarNeed: each view asks for what it draws, within the hub’s caps', () => {
  const now = at(15)
  assert.equal(calendarNeed('agenda', {}, now), null)
  assert.deepEqual(calendarNeed('agenda', { showEmptyDays: false }, now), { days: AGENDA_SCAN_DAYS, past: 0 })
  assert.deepEqual(calendarNeed('upnext', { hoursAhead: 48 }, now), { days: 3, past: 0 })
  assert.deepEqual(calendarNeed('upnext', { hoursAhead: 72 }, at(23)), { days: 4, past: 0 })
  assert.deepEqual(calendarNeed('daylist', { day: 'tomorrow' }, now), { days: 2, past: 0 })
  assert.deepEqual(calendarNeed('weekgrid', { startDay: 'monday', days: 7 }, now), { days: 2, past: 5 })
  assert.deepEqual(calendarNeed('weekgrid', { startDay: 'today', days: 5 }, now), { days: 5, past: 0 })
  assert.deepEqual(calendarNeed('monthgrid', { month: 'current', weekStart: 'sunday' }, now), { days: 15, past: 27 })
  assert.deepEqual(calendarNeed('monthgrid', { month: 'next', weekStart: 'sunday' }, now), { days: 43, past: 0 })
  // Sat Oct 31: the grid runs Mon Sep 28 .. Sun Nov 8, and its first days
  // reach past the 31 the hub keeps.
  assert.deepEqual(calendarNeed('monthgrid', { month: 'current', weekStart: 'monday' }, new Date(2026, 9, 31, 12)), { days: 9, past: 31 })
  assert.equal(calendarNeed('clock', {}, now), null)
})

test('boardCalendarNeed: the union of the panels on a board', () => {
  const panels = [{ id: 'agenda', type: 'agenda' }, { id: 'weekgrid', type: 'weekgrid' }, { id: 'upnext', type: 'upnext' }]
  const knobs = { agenda: {}, weekgrid: { startDay: 'sunday', days: 7 }, upnext: { hoursAhead: 72 } }
  assert.deepEqual(boardCalendarNeed(panels, knobs, at(15)), { days: 4, past: 6 })
  assert.equal(boardCalendarNeed([{ id: 'agenda', type: 'agenda' }], { agenda: {} }, at(15)), null)
})

test('covered and coversAll: a day is known only inside the range', () => {
  const range = { from: '2026-09-26', to: '2026-10-02' }
  assert.equal(covered(range, '2026-09-26'), true)
  assert.equal(covered(range, '2026-10-01'), true)
  assert.equal(covered(range, '2026-10-02'), false)
  assert.equal(covered(null, '2026-09-26'), false)
  assert.equal(coversAll(range, '2026-09-26', '2026-10-02'), true)
  assert.equal(coversAll(range, '2026-09-25', '2026-10-02'), false)
})

// --- The agenda's empty days, drawing helpers ---------------------------------------------

test('daysWithEvents: the first days that have something, from today or tomorrow', () => {
  const events = [
    timed('a', JUSTIN, 'A', at(9), at(10)),
    timed('b', JUSTIN, 'B', at(9, 0, 29), at(10, 0, 29)),
    allDay('c', SHEENA, 'C', '2026-10-03', '2026-10-04'),
  ]
  const days = buildAgendaDays(events, at(8), AGENDA_SCAN_DAYS)
  assert.equal(days.length, 14)
  assert.deepEqual(daysWithEvents(days, { days: 3 }, at(8)).map((d) => d.dateKey), ['2026-09-26', '2026-09-29', '2026-10-03'])
  assert.deepEqual(daysWithEvents(days, { days: 2, startDay: 'tomorrow' }, at(8)).map((d) => d.dateKey), ['2026-09-29', '2026-10-03'])
  // futureOnly: today's one event is over by noon, so today is not a day with events.
  assert.deepEqual(daysWithEvents(days, { days: 1, futureOnly: true }, at(12)).map((d) => d.dateKey), ['2026-09-29'])
  // Nothing at all: the plain columns.
  assert.deepEqual(daysWithEvents(buildAgendaDays([], at(8), 14), { days: 2 }, at(8)).map((d) => d.dateKey), ['2026-09-26', '2026-09-27'])
  // A week out the label carries the date.
  assert.equal(days[7].label, 'Sat, Oct 3')
  assert.equal(days[6].label, 'Friday')
})

test('tinyClock, splitPaint and calendarState', () => {
  assert.equal(tinyClock(at(17), false), '5pm')
  assert.equal(tinyClock(at(17, 30), false), '5:30pm')
  assert.equal(tinyClock(at(17, 30), true), '17:30')
  assert.equal(splitPaint([]), null)
  assert.equal(splitPaint(['#e0457b']), '#e0457b')
  assert.equal(splitPaint(['#e0457b', '#4a90e2']), 'linear-gradient(to bottom, #e0457b 0%, #e0457b 50%, #4a90e2 50%, #4a90e2 100%)')
  assert.equal(calendarState({ connected: null, error: null, hasAny: false }), 'loading')
  assert.equal(calendarState({ connected: false, hasAny: false }), 'unreachable')
  assert.equal(calendarState({ connected: null, error: 'timed out', hasAny: false }), 'unreachable')
  assert.equal(calendarState({ connected: false, hasAny: true }), 'ok')
  assert.equal(calendarState({ connected: true, hasAny: false }), 'ok')
})
