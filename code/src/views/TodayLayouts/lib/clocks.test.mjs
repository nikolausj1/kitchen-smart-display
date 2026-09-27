// Tests for lib/clocks.js: the chunk 4 clocks' pure parts (a zone's wall
// clock and offset, the second clock's reading, the analog hands, the flip
// clock's fit in a box). Zones are named in every test, the house's too, so
// the machine's own zone never matters.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLIP_AIR,
  cityOf,
  flipFit,
  flipFitPx,
  fmtOffset,
  fmtWallDate,
  fmtWallTime,
  handAngles,
  msToNextSecond,
  relativeOffsetMinutes,
  secondClock,
  wallClock,
  zoneOf,
  zoneOffsetMinutes,
} from './clocks.js'

// 2026-09-26 23:05:30 UTC: 4:05:30 pm in Seattle (PDT), 00:05:30 on Sunday in
// London (BST), 08:05:30 on Sunday in Tokyo, 04:35:30 on Sunday in Kolkata.
const T = new Date(Date.UTC(2026, 8, 26, 23, 5, 30))
const HOUSE = 'America/Los_Angeles'

test('zoneOf: a zone this engine knows, canonical, with its city', () => {
  assert.deepEqual(zoneOf('Europe/London'), { valid: true, zone: 'Europe/London', city: 'London' })
  assert.deepEqual(zoneOf('  America/Los_Angeles '), { valid: true, zone: 'America/Los_Angeles', city: 'Los Angeles' })
  assert.equal(zoneOf('europe/london').zone, 'Europe/London')
  assert.equal(zoneOf('UTC').valid, true)
})

test('zoneOf: anything else is not a zone, and keeps its city as typed', () => {
  assert.deepEqual(zoneOf('Mars/Olympus_Mons'), { valid: false, zone: null, city: 'Olympus Mons' })
  assert.deepEqual(zoneOf(''), { valid: false, zone: null, city: '' })
  assert.deepEqual(zoneOf('   '), { valid: false, zone: null, city: '' })
  assert.equal(zoneOf(null).valid, false)
  assert.equal(zoneOf(42).valid, false)
  assert.equal(zoneOf('London').valid, false)
})

test('cityOf takes the last part, underscores as spaces', () => {
  assert.equal(cityOf('America/Argentina/Buenos_Aires'), 'Buenos Aires')
  assert.equal(cityOf('America/Port-au-Prince'), 'Port-au-Prince')
  assert.equal(cityOf('Etc/GMT+9'), 'GMT+9')
  assert.equal(cityOf('UTC'), 'UTC')
  assert.equal(cityOf(''), '')
  assert.equal(cityOf(undefined), '')
})

test('wallClock reads the clock on the wall in a zone', () => {
  assert.deepEqual(wallClock(T, 'Europe/London'), { year: 2026, month: 8, day: 27, weekday: 0, hour: 0, minute: 5, second: 30 })
  assert.deepEqual(wallClock(T, HOUSE), { year: 2026, month: 8, day: 26, weekday: 6, hour: 16, minute: 5, second: 30 })
  assert.equal(wallClock(T, 'Asia/Tokyo').hour, 8)
  assert.equal(wallClock(T, 'Nowhere/Special'), null)
  assert.equal(wallClock(new Date(NaN), 'Europe/London'), null)
})

test('wallClock with no zone is the local clock', () => {
  const d = new Date(2026, 8, 26, 9, 41, 7)
  assert.deepEqual(wallClock(d), { year: 2026, month: 8, day: 26, weekday: 6, hour: 9, minute: 41, second: 7 })
})

test('zone offsets follow daylight saving', () => {
  assert.equal(zoneOffsetMinutes(T, 'Europe/London'), 60)
  assert.equal(zoneOffsetMinutes(T, HOUSE), -420)
  assert.equal(zoneOffsetMinutes(T, 'Asia/Kolkata'), 330)
  assert.equal(zoneOffsetMinutes(T, 'UTC'), 0)
  const january = new Date(Date.UTC(2026, 0, 15, 12))
  assert.equal(zoneOffsetMinutes(january, 'Europe/London'), 0)
  assert.equal(zoneOffsetMinutes(january, HOUSE), -480)
  assert.equal(zoneOffsetMinutes(T, 'Nowhere/Special'), null)
})

test('the offset from the house, and how it reads', () => {
  assert.equal(relativeOffsetMinutes(T, 'Europe/London', HOUSE), 480)
  assert.equal(relativeOffsetMinutes(T, 'Asia/Tokyo', HOUSE), 960)
  assert.equal(relativeOffsetMinutes(T, 'America/New_York', HOUSE), 180)
  assert.equal(relativeOffsetMinutes(T, 'Pacific/Honolulu', HOUSE), -180)
  assert.equal(relativeOffsetMinutes(T, 'Asia/Kolkata', HOUSE), 750)
  assert.equal(relativeOffsetMinutes(T, 'Bad/Zone', HOUSE), null)
  assert.equal(fmtOffset(480), '+8h')
  assert.equal(fmtOffset(-180), '−3h')
  assert.equal(fmtOffset(750), '+12:30h')
  assert.equal(fmtOffset(-570), '−9:30h')
  assert.equal(fmtOffset(0), '+0h')
  assert.equal(fmtOffset(null), '')
  assert.equal(fmtOffset(NaN), '')
})

test('the time and date of a wall clock', () => {
  const w = { year: 2026, month: 8, day: 27, weekday: 0, hour: 0, minute: 5, second: 30 }
  assert.deepEqual(fmtWallTime(w, false), { hm: '12:05', meridiem: 'AM' })
  assert.deepEqual(fmtWallTime(w, true), { hm: '00:05', meridiem: null })
  assert.deepEqual(fmtWallTime({ ...w, hour: 16 }, false), { hm: '4:05', meridiem: 'PM' })
  assert.deepEqual(fmtWallTime({ ...w, hour: 12 }, false), { hm: '12:05', meridiem: 'PM' })
  assert.deepEqual(fmtWallTime(null, false), { hm: '--:--', meridiem: null })
  assert.equal(fmtWallDate(w), 'Sun, Sep 27')
  assert.equal(fmtWallDate(null), '')
})

test('secondClock: London against the house, a day ahead', () => {
  assert.deepEqual(secondClock(T, { timezone: 'Europe/London' }, HOUSE), {
    valid: true,
    zone: 'Europe/London',
    label: 'London',
    hm: '12:05',
    meridiem: 'AM',
    date: 'Sun, Sep 27',
    offsetMinutes: 480,
    offset: '+8h',
  })
  const tokyo = secondClock(T, { timezone: 'Asia/Tokyo', label: ' Grandma ', hour24: true }, HOUSE)
  assert.equal(tokyo.label, 'Grandma')
  assert.equal(tokyo.hm, '08:05')
  assert.equal(tokyo.meridiem, null)
  assert.equal(tokyo.offset, '+16h')
})

test('secondClock: a zone it does not know shows the house time, no offset', () => {
  const r = secondClock(T, { timezone: 'Mars/Olympus_Mons' }, HOUSE)
  assert.equal(r.valid, false)
  assert.equal(r.zone, null)
  assert.equal(r.label, 'Olympus Mons')
  assert.equal(r.hm, '4:05')
  assert.equal(r.meridiem, 'PM')
  assert.equal(r.date, 'Sat, Sep 26')
  assert.equal(r.offsetMinutes, null)
  assert.equal(r.offset, '')
  assert.equal(secondClock(T, { timezone: '' }, HOUSE).label, 'Time zone')
  assert.equal(secondClock(T, {}, HOUSE).valid, false)
  assert.equal(secondClock(new Date(NaN), { timezone: 'Europe/London' }, HOUSE).hm, '--:--')
})

test('handAngles: the hour hand with the minutes, the minute hand with the seconds', () => {
  assert.deepEqual(handAngles(new Date(2026, 8, 26, 10, 8, 36)), { hour: 304.3, minute: 51.6, second: 216 })
  assert.deepEqual(handAngles(new Date(2026, 8, 26, 0, 0, 0)), { hour: 0, minute: 0, second: 0 })
  assert.deepEqual(handAngles(new Date(2026, 8, 26, 15, 0, 0)), { hour: 90, minute: 0, second: 0 })
  assert.deepEqual(handAngles(new Date(2026, 8, 26, 21, 45, 30)), { hour: 292.75, minute: 273, second: 180 })
  assert.deepEqual(handAngles(null), { hour: 0, minute: 0, second: 0 })
})

test('msToNextSecond lands just past the next second', () => {
  assert.equal(msToNextSecond(new Date(Date.UTC(2026, 8, 26, 1, 2, 3, 250))), 765)
  assert.equal(msToNextSecond(new Date(Date.UTC(2026, 8, 26, 1, 2, 3, 0)), 0), 1000)
})

test('flipFit: the clock in card heights, with and without its tab and date', () => {
  const full = flipFit({ tab: true, date: true })
  const bare = flipFit({ tab: false, date: false })
  // The tab adds its width less the case's left lip it replaces.
  assert.ok(Math.abs(full.wu - bare.wu - (0.2 - 0.016)) < 1e-9)
  assert.ok(Math.abs(bare.wu - (3.192 + FLIP_AIR * 2)) < 1e-9)
  assert.equal(full.floorPx, 12)
  assert.equal(bare.floorPx, 0)
  assert.ok(full.hu > bare.hu)
  assert.ok(Math.abs(full.hu - full.footU - 0.062) < 1e-9)
})

test('flipFitPx fills a box by its tighter side, the 12 px date floor included', () => {
  const opts = { tab: false, date: false }
  const f = flipFit(opts)
  // A wide box: the height decides.
  assert.ok(Math.abs(flipFitPx(2000, 300, opts) - 300 / f.hu) < 1e-9)
  // A tall box: the width decides.
  assert.ok(Math.abs(flipFitPx(600, 2000, opts) - 600 / f.wu) < 1e-9)
  // A short clock with a date: its 12 px floor is what does not fit.
  const withDate = { tab: true, date: true }
  const g = flipFit(withDate)
  const u = flipFitPx(4000, 100, withDate)
  assert.ok(Math.abs(u - (100 - 12) / g.footU) < 1e-9)
  assert.ok(u * g.footU + Math.max(12, u * 0.062) <= 100 + 1e-9)
  // A big one: the date is 0.062 u, the floor never binds.
  const big = flipFitPx(10000, 1000, withDate)
  assert.ok(Math.abs(big - 1000 / g.hu) < 1e-9)
  assert.equal(flipFitPx(0, 100, opts), 0)
  assert.equal(flipFitPx(100, -1, opts), 0)
  assert.equal(flipFitPx(300, 5, withDate), 0)
})
