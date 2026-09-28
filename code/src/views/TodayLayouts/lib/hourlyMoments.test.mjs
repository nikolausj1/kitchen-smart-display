// Tests for lib/hourlyMoments.js: the hourly forecast's Show modes (the
// spacing, the roll to tomorrow, the now line, the day parts, the set times,
// night and the moon), and the hourly block's knobs as the layout spec keeps
// them. Run from the project root: node --test 'code/src/**/*.test.mjs'
//
// The house's zone, whatever the machine's: the fixtures are local
// wall-clock hours, and the clock-change days are the house's (each test
// file runs in its own process, so this reaches no other suite).
process.env.TZ = 'America/Los_Angeles'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY_PARTS,
  HOURLY_MODES,
  SET_TIMES_DEFAULT,
  fmtTime,
  hourlyMode,
  hourlyMoments,
  nowLineAt,
  nowLineRow,
  parseTime,
  parseTimes,
  partSky,
  spreadHours,
} from './hourlyMoments.js'
import { fmtHour, hourlyColumns, hourlyTitle, localHourKey, pctOf } from './weatherPanels.js'
import { PANEL_ELEMENTS, PANEL_SCHEMAS, knobDefaults } from '../panels/schemas.js'
import { newPanel, normalizeSpec } from '../layoutSpec.js'
import { synodicPhase } from '../../../components/MoonGlyph/moonGeometry.js'

const pad = (n) => String(n).padStart(2, '0')
const stampOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const dateOf = (d) => stampOf(d).slice(0, 10)
// Monday 2026-09-28 unless told otherwise, local time.
const at = (h, m = 0, day = 28, month = 8) => new Date(2026, month, day, h, m, 0)
// The exact mean phase at a moment's hour (a bare date: its 9 pm), as phaseOn works it out.
const exact = (stamp) => {
  const [d, tm = '21:00'] = String(stamp).split('T')
  const [y, mo, da] = d.split('-').map(Number)
  return synodicPhase(new Date(y, mo - 1, da, Number(tm.slice(0, 2)), 0, 0))
}

// A feed like the hub's: hours from local midnight of the first day, one per
// real hour (so a clock change repeats or skips a stamp, as the hub's does),
// the temperature 40 + the hour + the day's index, rain 3 % an hour of the
// day, wind half the hour, sky code 2 unless `codes` says otherwise ('T21'
// keys, or 'YYYY-MM-DDTHH'); isDay by `isDay(hour)` unless it is null (the
// key is then left out); daily[] with the sun and a phase per day.
function feedFor(opts = {}) {
  const o = {
    year: 2026,
    month: 8,
    day: 28,
    hours: 72,
    codes: {},
    isDay: (h) => h >= 7 && h < 19,
    sunrise: '07:04',
    sunset: '18:54',
    phase0: 0.5,
    ...opts,
  }
  const start = new Date(o.year, o.month, o.day, 0, 0, 0)
  const first = dateOf(start)
  const hourly = []
  for (let i = 0; i < o.hours; i++) {
    const t = new Date(start.getTime() + i * 3600000)
    const h = t.getHours()
    const dayIndex = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate(), 12) - new Date(o.year, o.month, o.day, 12)) / 86400000)
    const stamp = stampOf(t)
    const code = o.codes[stamp.slice(0, 13)] ?? o.codes[`T${pad(h)}`] ?? 2
    const e = { time: stamp, tempF: 40 + h + dayIndex, feelsF: 38 + h + dayIndex, precipProb: h * 3, code, windMph: h / 2 }
    if (o.isDay) e.isDay = o.isDay(h)
    hourly.push(e)
  }
  const daily = [0, 1, 2, 3].map((i) => {
    const d = dateOf(new Date(o.year, o.month, o.day + i, 12))
    return { date: d, sunrise: o.sunrise ? `${d}T${o.sunrise}` : null, sunset: o.sunset ? `${d}T${o.sunset}` : null, moonPhase: o.phase0 + i * 0.03 }
  })
  return {
    hourly,
    daily,
    moon: { phase: 0.9, name: 'Waning Crescent' },
    current: { tempF: 70.4, feelsLikeF: 68, feelsF: 67, code: 0, windMph: 3, isDay: true },
    first,
  }
}

const FEED = feedFor()
const run = (mode, now, knobs = {}, feed = FEED) => hourlyMoments({ mode, knobs, now, feed })
const labels = (r) => r.moments.map((m) => m.label)
const flags = (r, key) => r.moments.map((m) => m[key])

// --- The spacing --------------------------------------------------------------------------

test('spreadHours: both ends exact, those between on the nearest hour, none twice', () => {
  assert.deepEqual(spreadHours(8, 22, 6), [8, 11, 14, 16, 19, 22])
  assert.deepEqual(spreadHours(8, 22, 3), [8, 15, 22])
  assert.deepEqual(spreadHours(15, 22, 5), [15, 17, 19, 20, 22])
  assert.deepEqual(spreadHours(0, 24, 12), [0, 2, 4, 7, 9, 11, 13, 15, 17, 20, 22, 24])
  // A span shorter than the count: fewer moments, each hour once.
  assert.deepEqual(spreadHours(8, 10, 6), [8, 9, 10])
  assert.deepEqual(spreadHours(21, 22, 5), [21, 22])
  assert.deepEqual(spreadHours(22, 22, 4), [22])
  assert.deepEqual(spreadHours(8, 22, 0), [])
  assert.deepEqual(spreadHours('x', 22, 6), [])
})

// --- Next hours: the strip as it always was ----------------------------------------------

// The panel's own mapping before the modes (HourlyPanel.jsx at bf35ecb), kept
// here to hold the new one to it.
function legacyColumns(hourly, current, now, k) {
  const list = hourlyColumns(hourly, now, k)
  const nowKey = now instanceof Date && !Number.isNaN(now.getTime()) ? localHourKey(now) : null
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const cur = current || null
  return list.map((e, i) => {
    const isNow = i === 0 && nowKey != null && String(e.time).slice(0, 13) === nowKey
    const live = isNow && cur ? cur : null
    const pick = (a, b) => (live && num(a) != null ? a : b)
    return {
      key: e.time,
      label: isNow ? 'Now' : fmtHour(e.time),
      current: isNow,
      tempF: pick(live && live.tempF, e.tempF),
      code: live && typeof live.code === 'number' ? live.code : e.code,
      feelsF: pick(live && (num(live.feelsLikeF) != null ? live.feelsLikeF : live.feelsF), e.feelsF),
      rain: pctOf(e.precipProb),
      windMph: pick(live && live.windMph, e.windMph),
    }
  })
}

const pickLegacy = (m) => ({ key: m.key, label: m.label, current: m.current, tempF: m.tempF, code: m.code, feelsF: m.feelsF, rain: m.rain, windMph: m.windMph })

test('next: exactly the columns, labels, values and header the strip always had', () => {
  const knobSets = [
    {},
    { range: 'hours', hours: 6 },
    { range: 'hours', hours: 24, step: 3 },
    { range: 'untilHour', untilHour: 22, step: 2 }, // the Echo Show 15's
    { range: 'untilHour', untilHour: 24, step: 1 },
    { range: 'untilHour', untilHour: 18, step: 4 },
    { hours: 'x', step: 7 },
  ]
  const times = [at(0, 20), at(7, 0), at(14, 5), at(21, 30), at(22, 30), at(23, 59), at(14, 5, 29)]
  for (const k of knobSets) {
    for (const now of times) {
      const got = run('next', now, k)
      const want = legacyColumns(FEED.hourly, FEED.current, now, k)
      assert.deepEqual(got.moments.map(pickLegacy), want, `${JSON.stringify(k)} at ${stampOf(now)}`)
      assert.equal(got.header, hourlyTitle(k))
      assert.equal(got.nowLine, null)
      assert.ok(got.moments.every((m) => m.past === false))
    }
  }
  // No mode is Next hours, and so is anything that is not a mode.
  assert.deepEqual(hourlyMoments({ knobs: { range: 'untilHour', step: 2 }, now: at(14, 5), feed: FEED }), run('next', at(14, 5), { range: 'untilHour', step: 2 }))
  assert.equal(hourlyMode(undefined, { mode: 'bogus' }), 'next')
  assert.equal(hourlyMode(null, null), 'next')
  assert.equal(hourlyMode('dayParts', { mode: 'next' }), 'dayParts')
  assert.deepEqual(HOURLY_MODES, ['next', 'untilEnd', 'wholeDay', 'dayParts', 'setTimes'])
  // The Echo Show 15's block at 2:05 pm: Now, then every 2 hours to 10 pm.
  assert.deepEqual(labels(run('next', at(14, 5), { range: 'untilHour', untilHour: 22, step: 2 })), ['Now', '4 PM', '6 PM', '8 PM', '10 PM'])
})

// --- Now until ------------------------------------------------------------------------

test('untilEnd: Now, then the rest spread from the next whole hour to the end', () => {
  const r = run('untilEnd', at(14, 5))
  assert.equal(r.header, 'Rest of day')
  assert.deepEqual(labels(r), ['Now', '3 PM', '5 PM', '7 PM', '8 PM', '10 PM'])
  // Now is the current reading, where it has one; the rest the feed's hours.
  assert.equal(r.moments[0].tempF, 70.4)
  assert.equal(r.moments[0].code, 0)
  assert.equal(r.moments[0].rain, 42) // the hour's own chance, as the strip always drew it
  assert.equal(r.moments[0].current, true)
  assert.equal(r.moments[1].tempF, 55)
  assert.equal(r.moments[1].time, '2026-09-28T15:00')
  assert.equal(r.nowLine, null)
  // Three moments: Now and the two ends. An end at midnight is tomorrow's
  // first hour.
  assert.deepEqual(labels(run('untilEnd', at(14, 5), { count: 3 })), ['Now', '3 PM', '10 PM'])
  assert.deepEqual(labels(run('untilEnd', at(14, 5), { count: 4 })), ['Now', '3 PM', '7 PM', '10 PM'])
  const midnight = run('untilEnd', at(23, 10), { endHour: 24 })
  assert.deepEqual(labels(midnight), ['Now', '12 AM'])
  assert.deepEqual(flags(midnight, 'tomorrow'), [false, true])
  // Late: only what is left, no hour twice.
  assert.deepEqual(labels(run('untilEnd', at(20, 30))), ['Now', '9 PM', '10 PM'])
  assert.deepEqual(labels(run('untilEnd', at(21, 59))), ['Now', '10 PM'])
})

test('untilEnd: from the end hour on, tomorrow from the hour of its sunrise', () => {
  const r = run('untilEnd', at(22, 0))
  assert.equal(r.header, 'Tomorrow')
  assert.deepEqual(labels(r), ['7 AM', '10 AM', '1 PM', '4 PM', '7 PM', '10 PM'])
  assert.ok(r.moments.every((m) => m.tomorrow && !m.past && !m.current))
  assert.equal(r.moments[0].time, '2026-09-29T07:00')
  assert.equal(r.moments[0].tempF, 48) // 40 + 7 + tomorrow's 1
  assert.deepEqual(labels(run('untilEnd', at(22, 30), { count: 4, endHour: 22 })), ['7 AM', '12 PM', '5 PM', '10 PM'])
  // Tomorrow's sunrise at 6:40: from 6 am. No sunrise at all: from 7 am.
  const early = feedFor({ sunrise: '06:40' })
  assert.equal(labels(run('untilEnd', at(22, 30), {}, early))[0], '6 AM')
  const none = feedFor({ sunrise: null, sunset: null })
  assert.equal(labels(run('untilEnd', at(22, 30), {}, none))[0], '7 AM')
  // An end before tomorrow's sunrise: from midnight.
  assert.deepEqual(labels(run('untilEnd', at(14, 5), { endHour: 5, count: 3 })), ['12 AM', '3 AM', '5 AM'])
})

test('untilEnd: Now from the feed when there is no current reading, none with neither', () => {
  const noCurrent = { ...FEED, current: null }
  const r = run('untilEnd', at(14, 5), {}, noCurrent)
  assert.equal(r.moments[0].label, 'Now')
  assert.equal(r.moments[0].tempF, 54)
  const late = feedFor({ day: 28 })
  late.hourly = late.hourly.filter((e) => e.time >= '2026-09-28T15')
  late.current = null
  assert.deepEqual(labels(run('untilEnd', at(14, 5), {}, late)), ['3 PM', '5 PM', '7 PM', '8 PM', '10 PM'])
})

// --- Whole day ---------------------------------------------------------------------------

test('wholeDay: 8 am to 10 pm in six; before the start, nothing past and no line', () => {
  const r = run('wholeDay', at(7, 0))
  assert.equal(r.header, 'Today')
  assert.deepEqual(labels(r), ['8 AM', '11 AM', '2 PM', '4 PM', '7 PM', '10 PM'])
  assert.deepEqual(flags(r, 'past'), [false, false, false, false, false, false])
  assert.deepEqual(flags(r, 'current'), [false, false, false, false, false, false])
  assert.equal(r.nowLine, null)
  assert.deepEqual(r.moments.map((m) => m.tempF), [48, 51, 54, 56, 59, 62])
})

test('wholeDay: an hour that has ended is past, the one now is in current, and the line between', () => {
  const r = run('wholeDay', at(14, 5))
  assert.deepEqual(flags(r, 'past'), [true, true, false, false, false, false])
  assert.deepEqual(flags(r, 'current'), [false, false, true, false, false, false])
  // 2:05 pm, a twelfth of the way from 2 pm's centre to 4 pm's: (2.5 + 1/24) / 6.
  assert.equal(r.nowLine, 0.4236)
  const evening = run('wholeDay', at(21, 30))
  assert.deepEqual(flags(evening, 'past'), [true, true, true, true, true, false])
  assert.deepEqual(flags(evening, 'current'), [false, false, false, false, false, false])
  assert.equal(evening.nowLine, 0.8889) // (4.5 + 2.5 / 3) / 6
  // On an hour exactly: on its centre.
  assert.equal(run('wholeDay', at(8, 0)).nowLine, round4(0.5 / 6))
  assert.deepEqual(flags(run('wholeDay', at(8, 0)), 'current'), [true, false, false, false, false, false])
})

const round4 = (v) => Math.round(v * 10000) / 10000

test('wholeDay: from the end hour on it is tomorrow, nothing dimmed', () => {
  for (const now of [at(22, 0), at(22, 30), at(23, 59)]) {
    const r = run('wholeDay', now)
    assert.equal(r.header, 'Tomorrow', stampOf(now))
    assert.deepEqual(labels(r), ['8 AM', '11 AM', '2 PM', '4 PM', '7 PM', '10 PM'])
    assert.ok(r.moments.every((m) => m.tomorrow && !m.past && !m.current))
    assert.equal(r.nowLine, null)
    assert.equal(r.moments[0].time, '2026-09-29T08:00')
    assert.equal(r.moments[0].tempF, 49)
  }
  // Just past midnight the new day is today again, before its start.
  const r = run('wholeDay', at(0, 30, 29))
  assert.equal(r.header, 'Today')
  assert.equal(r.moments[0].time, '2026-09-29T08:00')
  assert.equal(r.nowLine, null)
})

test('wholeDay: the knobs: count, start and end, reversed ends, a short span, midnight', () => {
  assert.deepEqual(labels(run('wholeDay', at(7), { count: 3 })), ['8 AM', '3 PM', '10 PM'])
  assert.deepEqual(labels(run('wholeDay', at(5), { startHour: 6, endHour: 12, count: 12 })), ['6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM'])
  assert.deepEqual(labels(run('wholeDay', at(5), { startHour: 20, endHour: 10, count: 3 })), ['10 AM', '3 PM', '8 PM'])
  const late = run('wholeDay', at(23, 0), { startHour: 18, endHour: 24, count: 4 })
  assert.deepEqual(labels(late), ['6 PM', '8 PM', '10 PM', '12 AM'])
  assert.deepEqual(flags(late, 'past'), [true, true, true, false])
  assert.deepEqual(flags(late, 'tomorrow'), [false, false, false, true])
  assert.equal(late.nowLine, round4((2.5 + 1 / 2) / 4))
  // Out of range or not numbers: the defaults.
  assert.deepEqual(labels(run('wholeDay', at(7), { count: 40, startHour: -3, endHour: 'x' })), ['8 AM', '11 AM', '2 PM', '4 PM', '7 PM', '10 PM'])
})

test('the now line in wrapped rows: the row it falls in, and how far across', () => {
  assert.equal(nowLineAt([8, 11, 14], 7.5), null)
  assert.equal(nowLineAt([8, 11, 14], 14), null) // from the last one on (the strip has rolled by then)
  assert.equal(nowLineAt([], 9), null)
  assert.deepEqual(nowLineRow(0.4236, 6, 6, 1), { row: 0, x: 0.4236 })
  assert.deepEqual(nowLineRow(0.4236, 6, 3, 2), { row: 0, x: 0.8472 })
  assert.deepEqual(nowLineRow(0.8889, 6, 3, 2), { row: 1, x: 0.7778 })
  assert.equal(nowLineRow(null, 6, 3, 2), null)
})

// --- Night and the moon (Justin, 2026-09-28: a moon wherever a moment falls at night) --------

test('the 10 pm moment is night, with the moon of its own date', () => {
  const r = run('wholeDay', at(14, 5))
  assert.deepEqual(flags(r, 'isDay'), [true, true, true, true, false, false])
  assert.deepEqual(flags(r, 'moonPhase'), r.moments.map((m) => exact(m.time)))
  // Rolled to tomorrow: tomorrow's phase.
  const t = run('wholeDay', at(22, 30))
  assert.equal(t.moments[5].isDay, false)
  assert.equal(t.moments[5].moonPhase, exact(t.moments[5].time))
  // An hour without its own isDay: that date's sunrise and sunset.
  const bare = feedFor({ isDay: null })
  assert.deepEqual(flags(run('wholeDay', at(14, 5), {}, bare), 'isDay'), [true, true, true, true, false, false])
  // Neither: not known (drawn as day); the phase is still the exact one.
  const blind = feedFor({ isDay: null, sunrise: null, sunset: null })
  blind.daily = []
  const b = run('wholeDay', at(14, 5), {}, blind)
  assert.deepEqual(flags(b, 'isDay'), [null, null, null, null, null, null])
  assert.equal(b.moments[5].moonPhase, exact(b.moments[5].time))
  // Now: the current reading's isDay, over its hour's.
  const dusk = { ...FEED, current: { ...FEED.current, isDay: false } }
  assert.equal(run('untilEnd', at(14, 5), {}, dusk).moments[0].isDay, false)
  assert.equal(run('next', at(14, 5), {}, dusk).moments[0].isDay, false)
  assert.equal(run('next', at(14, 5)).moments[0].isDay, true)
})

// --- Day parts ---------------------------------------------------------------------------

test('dayParts: each part one moment, its high (the night: its low) and its wettest hour', () => {
  const r = run('dayParts', at(14, 5))
  assert.equal(r.header, 'Today')
  assert.deepEqual(labels(r), ['Morning', 'Afternoon', 'Evening', 'Overnight'])
  assert.deepEqual(flags(r, 'past'), [true, false, false, false])
  assert.deepEqual(flags(r, 'current'), [false, true, false, false])
  assert.deepEqual(r.moments.map((m) => m.tempF), [51, 56, 60, 41])
  assert.deepEqual(r.moments.map((m) => m.tempWord), [null, null, null, 'Low'])
  assert.deepEqual(r.moments.map((m) => m.feelsF), [49, 54, 58, 39])
  assert.deepEqual(r.moments.map((m) => m.rain), [33, 48, 60, 69])
  assert.deepEqual(r.moments.map((m) => m.windMph), [5.5, 8, 10, 11.5])
  assert.deepEqual(r.moments.map((m) => m.time), ['2026-09-28T06:00', '2026-09-28T12:00', '2026-09-28T17:00', '2026-09-28T21:00'])
  assert.equal(r.nowLine, null)
  assert.deepEqual(DAY_PARTS.map((p) => [p.from, p.to]), [[6, 12], [12, 17], [17, 21], [21, 30]])
})

test('dayParts: from 9 pm, Tonight and tomorrow; after midnight, the same night', () => {
  const r = run('dayParts', at(21, 30))
  assert.equal(r.header, 'Tonight and tomorrow')
  assert.deepEqual(labels(r), ['Tonight', 'Morning', 'Afternoon', 'Evening'])
  assert.deepEqual(flags(r, 'current'), [true, false, false, false])
  assert.deepEqual(flags(r, 'past'), [false, false, false, false])
  assert.deepEqual(flags(r, 'tomorrow'), [false, true, true, true])
  assert.deepEqual(r.moments.map((m) => m.tempF), [41, 52, 57, 61])
  const small = run('dayParts', at(3, 0, 29))
  assert.equal(small.header, 'Tonight and tomorrow')
  assert.deepEqual(small.moments.map((m) => m.time), ['2026-09-28T21:00', '2026-09-29T06:00', '2026-09-29T12:00', '2026-09-29T17:00'])
  assert.deepEqual(flags(small, 'current'), [true, false, false, false])
  const six = run('dayParts', at(6, 0, 29))
  assert.equal(six.header, 'Today')
  assert.deepEqual(flags(six, 'current'), [true, false, false, false])
})

test('dayParts: Tonight is night with the phase of the date it starts on; an Evening in winter is night', () => {
  const r = run('dayParts', at(21, 30))
  assert.equal(r.moments[0].isDay, false)
  assert.equal(r.moments[0].moonPhase, exact('2026-09-28'))
  assert.equal(r.moments[1].moonPhase, exact('2026-09-29'))
  // September: the Evening's 5 and 6 pm are day, 7 and 8 night: not most.
  assert.deepEqual(flags(run('dayParts', at(14, 5)), 'isDay'), [true, true, true, false])
  // December: dark from 4:30, by the feed's own hours and by the sun alone.
  const winter = feedFor({ month: 11, day: 15, isDay: (h) => h >= 8 && h < 16, sunrise: '07:50', sunset: '16:20' })
  const w = run('dayParts', at(14, 5, 15, 11), {}, winter)
  assert.equal(w.moments[2].label, 'Evening')
  assert.equal(w.moments[2].isDay, false)
  const bare = feedFor({ month: 11, day: 15, isDay: null, sunrise: '07:50', sunset: '16:20' })
  assert.equal(run('dayParts', at(14, 5, 15, 11), {}, bare).moments[2].isDay, false)
})

test('partSky: the most significant sky over two hours or more, else the most common', () => {
  assert.equal(partSky([2, 2, 2, 61, 61, 95]), 61)
  assert.equal(partSky([3, 3, 3, 3, 61, 63]), 3)
  assert.equal(partSky([95, 2, 95, 2]), 95)
  assert.equal(partSky([0, 0, 1, 1, 1]), 1)
  assert.equal(partSky([1, 2, 3, 61]), 61) // no sky twice: the most significant of the most common
  assert.equal(partSky([45, 45, 51, 51]), 51)
  assert.equal(partSky([null, 'x']), null)
  assert.equal(partSky([]), null)
  // In a part: a wet afternoon shows its rain.
  const wet = feedFor({ codes: { 'T13': 61, 'T14': 63, 'T15': 61 } })
  assert.equal(run('dayParts', at(9), {}, wet).moments[1].code, 61)
})

// --- Set times ---------------------------------------------------------------------------

test('parseTime: 24-hour, am and pm, noon and midnight; anything else is not a time', () => {
  assert.equal(parseTime('7:30'), 450)
  assert.equal(parseTime('07:30'), 450)
  assert.equal(parseTime(' 19:30 '), 1170)
  assert.equal(parseTime('7:30 pm'), 1170)
  assert.equal(parseTime('7:30PM'), 1170)
  assert.equal(parseTime('7:30 p.m.'), 1170)
  assert.equal(parseTime('7 am'), 420)
  assert.equal(parseTime('7'), 420)
  assert.equal(parseTime('12 am'), 0)
  assert.equal(parseTime('12:15 am'), 15)
  assert.equal(parseTime('12 pm'), 720)
  assert.equal(parseTime('0:00'), 0)
  assert.equal(parseTime('Noon'), 720)
  assert.equal(parseTime('midnight'), 0)
  for (const junk of ['24:00', '7:60', '7:5', '13 pm', '0 am', 'abc', '', ':30', '7.30', '7:30 xm', null, undefined]) {
    assert.equal(parseTime(junk), null, String(junk))
  }
})

test('parseTimes: a comma-separated list, in order, each once, at most eight; junk ignored', () => {
  assert.deepEqual(parseTimes(SET_TIMES_DEFAULT), [450, 720, 915, 1080])
  assert.deepEqual(parseTimes('18:00, 7:30,junk,, 3:15 pm,7:30'), [450, 915, 1080])
  assert.deepEqual(parseTimes('1:00,2:00,3:00,4:00,5:00,6:00,7:00,8:00,9:00,10:00'), [60, 120, 180, 240, 300, 360, 420, 480])
  assert.deepEqual(parseTimes(''), [])
  assert.deepEqual(parseTimes(null), [])
  assert.equal(fmtTime(450), '7:30 AM')
  assert.equal(fmtTime(720), '12 PM')
  assert.equal(fmtTime(915), '3:15 PM')
  assert.equal(fmtTime(0), '12 AM')
})

test('setTimes: each time from the hour holding it, labelled with the time; past dimmed; then tomorrow', () => {
  const r = run('setTimes', at(16, 0), { times: SET_TIMES_DEFAULT })
  assert.equal(r.header, 'Today')
  assert.deepEqual(labels(r), ['7:30 AM', '12 PM', '3:15 PM', '6 PM'])
  assert.deepEqual(flags(r, 'past'), [true, true, true, false])
  assert.deepEqual(flags(r, 'current'), [false, false, false, false])
  assert.deepEqual(r.moments.map((m) => m.tempF), [47, 52, 55, 58])
  assert.deepEqual(r.moments.map((m) => m.time), ['2026-09-28T07:30', '2026-09-28T12:00', '2026-09-28T15:15', '2026-09-28T18:00'])
  assert.equal(r.nowLine, null)
  // In the hour of 3:15 pm (even before it), that moment is the current one.
  assert.deepEqual(flags(run('setTimes', at(15, 5), { times: SET_TIMES_DEFAULT }), 'current'), [false, false, true, false])
  // From the last time on: tomorrow's.
  const t = run('setTimes', at(18, 0), { times: SET_TIMES_DEFAULT })
  assert.equal(t.header, 'Tomorrow')
  assert.ok(t.moments.every((m) => m.tomorrow && !m.past && !m.current))
  assert.equal(t.moments[0].time, '2026-09-29T07:30')
  assert.equal(t.moments[3].moonPhase, exact(t.moments[3].time))
  // Its own isDay is its hour's.
  assert.deepEqual(flags(run('setTimes', at(5), { times: '6:30,12:00,21:15' }), 'isDay'), [false, true, false])
  // No time that reads as one: nothing, and why.
  const none = run('setTimes', at(16), { times: 'soon, later' })
  assert.deepEqual(none.moments, [])
  assert.equal(none.empty, 'noTimes')
  assert.equal(run('setTimes', at(16), {}).empty, 'noTimes')
})

// --- No data, no clock ---------------------------------------------------------------------

test('no feed, or no clock: no moments, whatever the mode', () => {
  for (const mode of HOURLY_MODES) {
    const knobs = mode === 'setTimes' ? { times: SET_TIMES_DEFAULT } : {}
    assert.deepEqual(run(mode, at(14, 5), knobs, { hourly: [], daily: [], current: null }).moments, [], mode)
    assert.deepEqual(run(mode, new Date(NaN), knobs).moments, [], mode)
    assert.deepEqual(hourlyMoments({ mode, knobs, now: at(14, 5), feed: null }).moments, [], mode)
  }
  // Headers still say what the block is.
  assert.equal(run('wholeDay', null).header, 'Today')
  assert.equal(run('next', null, { range: 'untilHour' }).header, 'Rest of day')
})

// --- A day the clocks change --------------------------------------------------------------

test('a day the clocks go back: the wall clock rules, and the night holds its extra hour', () => {
  // Sunday 2026-11-01: 1 am twice, the feed from Saturday's midnight.
  const dst = feedFor({ month: 9, day: 31 })
  const stamps = dst.hourly.map((e) => e.time)
  assert.equal(stamps.filter((s) => s === '2026-11-01T01:00').length, 2)
  const r = run('wholeDay', at(14, 5, 1, 10), {}, dst)
  assert.deepEqual(labels(r), ['8 AM', '11 AM', '2 PM', '4 PM', '7 PM', '10 PM'])
  assert.deepEqual(r.moments.map((m) => m.time.slice(0, 13)), ['2026-11-01T08', '2026-11-01T11', '2026-11-01T14', '2026-11-01T16', '2026-11-01T19', '2026-11-01T22'])
  assert.equal(r.nowLine, 0.4236)
  assert.deepEqual(flags(r, 'past'), [true, true, false, false, false, false])
  // Saturday night into Sunday: ten hours, both 1 ams among them.
  const night = run('dayParts', at(21, 30, 31, 9), {}, dst)
  assert.equal(night.moments[0].label, 'Tonight')
  const hours = dst.hourly.filter((e) => e.time >= '2026-10-31T21' && e.time < '2026-11-01T06')
  assert.equal(hours.length, 10)
  assert.equal(night.moments[0].tempF, Math.min(...hours.map((e) => e.tempF)))
  assert.equal(night.moments[0].rain, Math.max(...hours.map((e) => e.precipProb)))
  // Next hours still match the helper across the change.
  const now = at(0, 30, 1, 10)
  assert.deepEqual(run('next', now, {}, dst).moments.map(pickLegacy), legacyColumns(dst.hourly, dst.current, now, {}))
})

test('a day the clocks go forward: the missing hour is a gap, not a shift', () => {
  // Sunday 2026-03-08: no 2 am.
  const dst = feedFor({ month: 2, day: 8 })
  assert.ok(!dst.hourly.some((e) => e.time === '2026-03-08T02:00'))
  const r = run('wholeDay', at(0, 30, 8, 2), { startHour: 1, endHour: 4, count: 4 }, dst)
  assert.deepEqual(labels(r), ['1 AM', '2 AM', '3 AM', '4 AM'])
  assert.deepEqual(r.moments.map((m) => m.tempF), [41, null, 43, 44])
  const later = run('wholeDay', at(3, 30, 8, 2), { startHour: 1, endHour: 4, count: 4 }, dst)
  assert.deepEqual(flags(later, 'past'), [true, true, false, false])
  assert.deepEqual(flags(later, 'current'), [false, false, true, false])
})

// --- The block's knobs -------------------------------------------------------------------

test('the hourly knobs: Show and its modes, each mode its own fields, the editor vocabulary', () => {
  const fields = Object.fromEntries(PANEL_SCHEMAS.hourly.fields.map((f) => [f.key, f]))
  assert.deepEqual(fields.mode.options.map((o) => o[0]), HOURLY_MODES)
  assert.deepEqual(fields.mode.options.map((o) => o[1]), ['Next hours', 'Now until', 'Whole day', 'Day parts', 'Set times'])
  assert.equal(fields.mode.default, 'next')
  assert.deepEqual(fields.range.showIf, { mode: 'next' })
  assert.deepEqual(fields.hours.showIf, { mode: 'next', range: 'hours' })
  assert.deepEqual(fields.untilHour.showIf, { mode: 'next', range: 'untilHour' })
  assert.deepEqual(fields.step.showIf, { mode: 'next' })
  assert.deepEqual(fields.count.showIf, { mode: ['untilEnd', 'wholeDay'] })
  assert.deepEqual([fields.count.min, fields.count.max, fields.count.default], [3, 12, 6])
  assert.deepEqual(fields.startHour.showIf, { mode: 'wholeDay' })
  assert.deepEqual([fields.startHour.min, fields.startHour.max, fields.startHour.default, fields.startHour.ui, fields.startHour.pair], [0, 23, 8, 'hourRange', 'endHour'])
  assert.deepEqual(fields.endHour.showIf, { mode: ['wholeDay', 'untilEnd'] })
  assert.deepEqual([fields.endHour.min, fields.endHour.max, fields.endHour.default, fields.endHour.ui, fields.endHour.pairOf], [1, 24, 22, 'hourRange', 'startHour'])
  assert.deepEqual([fields.times.type, fields.times.ui, fields.times.default, fields.times.max], ['text', 'timeList', SET_TIMES_DEFAULT, 8])
  assert.deepEqual(fields.times.showIf, { mode: 'setTimes' })
  // The default exactly as the editor writes a list: 'H:MM', commas, no spaces.
  assert.match(SET_TIMES_DEFAULT, /^\d{1,2}:\d{2}(,\d{1,2}:\d{2})*$/)
  // Show first, then each mode's own, then the look every mode shares; the
  // mode's fields all tune the hour labels, so the inspector groups them first.
  const keys = PANEL_SCHEMAS.hourly.fields.map((f) => f.key)
  assert.deepEqual(keys.slice(0, 9), ['mode', 'range', 'hours', 'untilHour', 'step', 'count', 'startHour', 'endHour', 'times'])
  for (const key of keys.slice(0, 9)) assert.equal(fields[key].element, 'hour', key)
  for (const key of ['columns', 'style', 'showRain', 'showFeelsLike', 'showWind', 'size', 'iconSize']) assert.equal(fields[key].showIf, undefined, key)
  assert.ok(PANEL_ELEMENTS.hourly.some((e) => e.key === 'nowLine'))
})

test('a saved hourly block keeps Next hours; a new one starts in Whole day', () => {
  // The Echo Show 15's block as stored on the hub (2026-09-28), before modes.
  const echo = {
    id: 'hourly',
    type: 'hourly',
    x: 62.5,
    y: 24.07,
    w: 36.46,
    h: 24.07,
    z: 10,
    hidden: false,
    locked: false,
    props: {
      textScale: 1, opacity: 1, padding: 1, background: 'card', radius: 1, align: 'start', scrim: 'none',
      range: 'untilHour', hours: 10, untilHour: 22, step: 2, columns: 'auto', style: 'columns',
      showRain: true, showFeelsLike: false, showWind: false, size: 1.15, iconSize: 1.15,
    },
  }
  const saved = normalizeSpec({ panels: [echo] }, { layoutId: 'entry' }).panels[0]
  assert.equal(saved.props.mode, 'next')
  for (const [k, v] of Object.entries(echo.props)) assert.equal(saved.props[k], v, k)
  assert.equal(knobDefaults('hourly').mode, 'next')
  // Twice through, the same.
  assert.deepEqual(normalizeSpec(normalizeSpec({ panels: [echo] }, { layoutId: 'entry' }), { layoutId: 'entry' }).panels[0], saved)
  // A bare { type: 'hourly' } in a hand-written spec is a saved block too.
  assert.equal(normalizeSpec({ panels: [{ type: 'hourly' }] }, { layoutId: 'entry' }).panels[0].props.mode, 'next')
  // Add block: Whole day, 8 am to 10 pm, six moments; overrides still win.
  const fresh = newPanel('hourly', null, { layoutId: 'entry' })
  assert.deepEqual([fresh.props.mode, fresh.props.startHour, fresh.props.endHour, fresh.props.count], ['wholeDay', 8, 22, 6])
  assert.equal(newPanel('hourly', { props: { mode: 'dayParts' } }, { layoutId: 'entry' }).props.mode, 'dayParts')
  assert.equal(newPanel('hourly', null, { layoutId: 'board', takenIds: ['hourly'] }).props.mode, 'wholeDay')
  // Other types start as they did.
  assert.equal(newPanel('forecast', null, { layoutId: 'entry' }).props.mode, undefined)
})
