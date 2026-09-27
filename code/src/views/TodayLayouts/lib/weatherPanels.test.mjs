// Tests for lib/weatherPanels.js: the weather panels' pure parts (the hour
// window, the columns, the curve, the band scale, the rain thresholds and
// labels, the next hour, the alert, the conditions rows).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONDITION_ROWS,
  NEXT_HOUR_FLOOR,
  RAIN_FLOOR,
  RAIN_LINE,
  activeAlerts,
  alertTone,
  alertWhen,
  bandScale,
  bandSpan,
  compass,
  conditionRows,
  conditionValue,
  conditionsColumns,
  curveLevels,
  HOURLY_STEPS,
  HOURLY_UNTIL,
  fmtHour,
  hourlyColumns,
  hourlyGrid,
  hourlyTitle,
  hoursFrom,
  nextHourStrip,
  pickAlert,
  rainLabels,
  rainLevel,
  rainStep,
  tempRange,
  uvBand,
} from './weatherPanels.js'

// Saturday 2026-09-26, local time.
const at = (h, m = 0, day = 26) => new Date(2026, 8, day, h, m, 0)
const stamp = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// 48 feed hours from 1 pm, each the hour STARTING at its time.
const HOURS = Array.from({ length: 48 }, (_, i) => ({ time: stamp(at(13 + i)), tempF: 50 + (i % 10), precipProb: i * 2 }))

test('hoursFrom: from the hour now is in, skipping hours already over', () => {
  // The hub fetched at 1:40; at 3:05 the 1 and 2 pm hours are over.
  const list = hoursFrom(HOURS, at(15, 5), 12)
  assert.equal(list.length, 12)
  assert.equal(list[0].time, '2026-09-26T15:00')
  assert.equal(list[11].time, '2026-09-27T02:00')
  // At 3:59 it is still the 3 pm hour.
  assert.equal(hoursFrom(HOURS, at(15, 59), 1)[0].time, '2026-09-26T15:00')
  // Past the feed's end, or no feed: nothing.
  assert.deepEqual(hoursFrom(HOURS, at(12, 0, 29), 6), [])
  assert.deepEqual(hoursFrom(null, at(15), 6), [])
})

// --- The hourly knobs: step and range ------------------------------------------------

const labels = (list, now) => list.map((e, i) => (i === 0 && e.time.slice(0, 13) === stamp(now).slice(0, 13) ? 'Now' : fmtHour(e.time)))

test('hourlyColumns: at the defaults, and at any step of 1, exactly the hours the strip always showed', () => {
  const now = at(15, 5)
  assert.deepEqual(hourlyColumns(HOURS, now, {}), hoursFrom(HOURS, now, 12))
  assert.deepEqual(hourlyColumns(HOURS, now, null), hoursFrom(HOURS, now, 12))
  for (const hours of [6, 7, 12, 24]) {
    assert.deepEqual(hourlyColumns(HOURS, now, { step: 1, range: 'hours', hours }), hoursFrom(HOURS, now, hours), `hours ${hours}`)
  }
  // Out of range or not a number: the panel's own old reading (6..24, 12).
  assert.equal(hourlyColumns(HOURS, now, { hours: 99 }).length, 24)
  assert.equal(hourlyColumns(HOURS, now, { hours: 2 }).length, 6)
  assert.equal(hourlyColumns(HOURS, now, { hours: 'x' }).length, 12)
  assert.deepEqual(HOURLY_STEPS, [1, 2, 3, 4])
  assert.deepEqual(HOURLY_UNTIL, { min: 18, max: 24, default: 22 })
})

test('hourlyColumns: rest of day at 1:20 pm, every 3 hours: Now, 3 PM, 6 PM, 9 PM', () => {
  const now = at(13, 20)
  const rest = (step, untilHour) => labels(hourlyColumns(HOURS, now, { range: 'untilHour', step, untilHour }), now)
  assert.deepEqual(rest(3, 22), ['Now', '3 PM', '6 PM', '9 PM'])
  assert.deepEqual(rest(2, 22), ['Now', '2 PM', '4 PM', '6 PM', '8 PM', '10 PM'])
  assert.deepEqual(rest(4, 22), ['Now', '4 PM', '8 PM'])
  assert.deepEqual(rest(1, 18), ['Now', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM'])
  // Midnight (24) is tomorrow's first hour, the last column.
  assert.deepEqual(rest(3, 24), ['Now', '3 PM', '6 PM', '9 PM', '12 AM'])
  // The default end is 10 pm; a value that is not an hour on offer reads as it.
  assert.deepEqual(rest(3, undefined), rest(3, 22))
  assert.deepEqual(rest(3, 30), rest(3, 22))
  assert.equal(hourlyTitle({ range: 'untilHour' }), 'Rest of day')
  assert.equal(hourlyTitle({ range: 'hours' }), 'Hourly')
  assert.equal(hourlyTitle(null), 'Hourly')
})

test('hourlyColumns: late in the evening only what is left, never tomorrow', () => {
  const rest = (h, m, untilHour = 22, step = 3, day = 26) =>
    labels(hourlyColumns(HOURS, at(h, m, day), { range: 'untilHour', step, untilHour }), at(h, m, day))
  assert.deepEqual(rest(20, 10), ['Now', '9 PM'])
  assert.deepEqual(rest(21, 30), ['Now'])
  assert.deepEqual(rest(21, 30, 22, 2), ['Now', '10 PM'])
  assert.deepEqual(rest(22, 30), ['Now'])
  // Past the end hour itself: still the current reading, nothing after it.
  assert.deepEqual(rest(23, 10), ['Now'])
  // Just past midnight the new day is the day: through its 10 pm.
  assert.deepEqual(rest(0, 20, 22, 4, 27), ['Now', '4 AM', '8 AM', '12 PM', '4 PM', '8 PM'])
  // No clock, no feed: nothing.
  assert.deepEqual(hourlyColumns(HOURS, null, { range: 'untilHour' }), [])
  assert.deepEqual(hourlyColumns(null, at(13, 20), { range: 'untilHour' }), [])
})

test('hourlyColumns: the next hours at a step: the clock hours the step divides, past midnight too', () => {
  // 12 hours from 1:20 pm run through 12 am; every 3 hours of them.
  assert.deepEqual(labels(hourlyColumns(HOURS, at(13, 20), { range: 'hours', hours: 12, step: 3 }), at(13, 20)), ['Now', '3 PM', '6 PM', '9 PM', '12 AM'])
  // From 10:30 pm, every 4 hours on the clock: 12, 4 and 8 am.
  assert.deepEqual(labels(hourlyColumns(HOURS, at(22, 30), { hours: 12, step: 4 }), at(22, 30)), ['Now', '12 AM', '4 AM', '8 AM'])
  // At 3 pm on the dot, 3 pm is Now and the next is 6 pm.
  assert.deepEqual(labels(hourlyColumns(HOURS, at(15, 0), { hours: 6, step: 3 }), at(15, 0)), ['Now', '6 PM'])
  // A step that is not one of 1 to 4 reads as every hour.
  assert.deepEqual(hourlyColumns(HOURS, at(13, 20), { step: 7 }), hoursFrom(HOURS, at(13, 20), 12))
})

test('fmtHour: 12-hour labels from the stamp, no zone involved', () => {
  assert.equal(fmtHour('2026-09-26T00:00'), '12 AM')
  assert.equal(fmtHour('2026-09-26T09:00'), '9 AM')
  assert.equal(fmtHour('2026-09-26T12:00'), '12 PM')
  assert.equal(fmtHour('2026-09-26T15:00'), '3 PM')
  assert.equal(fmtHour('nope'), '')
})

test('hourlyGrid: auto fits the box in balanced rows; a number is exact', () => {
  assert.deepEqual(hourlyGrid(12, 'auto', 1100, 65), { cols: 12, rows: 1 })
  assert.deepEqual(hourlyGrid(12, 'auto', 362, 46), { cols: 6, rows: 2 }) // fits 7: two rows of 6
  assert.deepEqual(hourlyGrid(24, 'auto', 600, 60), { cols: 8, rows: 3 }) // fits 10: three rows of 8
  assert.deepEqual(hourlyGrid(12, 'auto', 0, 60), { cols: 12, rows: 1 }) // not measured yet
  assert.deepEqual(hourlyGrid(12, 8, 1000, 60), { cols: 8, rows: 2 }) // a row of 8, a row of 4
  assert.deepEqual(hourlyGrid(6, 12, 1000, 60), { cols: 6, rows: 1 })
  assert.deepEqual(hourlyGrid(24, '6', 1000, 60), { cols: 6, rows: 4 })
  assert.deepEqual(hourlyGrid(0, 'auto', 1000, 60), { cols: 0, rows: 0 })
})

test('the curve: 0 at the highest, 1 at the lowest, flat in the middle, gaps kept', () => {
  const r = tempRange([50, null, 60, 55])
  assert.deepEqual(r, { min: 50, max: 60 })
  assert.deepEqual(curveLevels([50, null, 60, 55], r), [1, null, 0, 0.5])
  assert.deepEqual(curveLevels([58, 58], tempRange([58, 58])), [0.5, 0.5])
  assert.equal(tempRange([null, 'x']), null)
})

test('the band scale: the period low to high; each day a span on it', () => {
  const days = [
    { lowF: 47, highF: 60 },
    { lowF: 50, highF: 63 },
    { lowF: null, highF: 57 },
  ]
  const scale = bandScale(days)
  assert.deepEqual(scale, { min: 47, max: 63 })
  assert.deepEqual(bandSpan(47, 63, scale), { left: 0, width: 100 })
  assert.deepEqual(bandSpan(47, 60, scale), { left: 0, width: 81.25 })
  assert.deepEqual(bandSpan(50, 63, scale), { left: 18.75, width: 81.25 })
  // One end missing: a point, widened to the minimum about its place.
  assert.deepEqual(bandSpan(null, 57, scale), { left: 59.5, width: 6 })
  // A one-degree day still shows, and stays on the track at an end.
  assert.deepEqual(bandSpan(63, 63, scale), { left: 94, width: 6 })
  // Reversed ends are swapped; nothing at all is null; a flat week is full.
  assert.deepEqual(bandSpan(60, 47, scale), bandSpan(47, 60, scale))
  assert.equal(bandSpan(null, null, scale), null)
  assert.deepEqual(bandSpan(55, 55, { min: 55, max: 55 }), { left: 0, width: 100 })
})

test('rain: the floor is 20 %, the line 50 %', () => {
  assert.equal(RAIN_FLOOR, 20)
  assert.equal(RAIN_LINE, 50)
  assert.equal(rainLevel(null), 'none')
  assert.equal(rainLevel(0), 'none')
  assert.equal(rainLevel(19), 'slight')
  assert.equal(rainLevel(20), 'possible')
  assert.equal(rainLevel(49), 'possible')
  assert.equal(rainLevel(50), 'likely')
  assert.equal(rainLevel(100), 'likely')
})

test('rain labels: every 3 hours to a day, every 6 past it, Now first', () => {
  assert.equal(rainStep(24), 3)
  assert.equal(rainStep(25), 6)
  // From 1 pm: Now, then 3, 6, 9 pm ...
  const day = hoursFrom(HOURS, at(13), 24)
  const labels = rainLabels(day, 3)
  assert.deepEqual(labels.slice(0, 4), [
    { index: 0, text: 'Now' },
    { index: 2, text: '3 PM' },
    { index: 5, text: '6 PM' },
    { index: 8, text: '9 PM' },
  ])
  assert.equal(labels.length, 9)
  // From 3 pm, a label hour: Now takes its place.
  assert.deepEqual(rainLabels(hoursFrom(HOURS, at(15), 24), 3).slice(0, 2), [
    { index: 0, text: 'Now' },
    { index: 3, text: '6 PM' },
  ])
  // From 2 pm the first label is one bar away: no Now, it would collide.
  assert.deepEqual(rainLabels(hoursFrom(HOURS, at(14), 24), 3)[0], { index: 1, text: '3 PM' })
  // 48 hours: every 6.
  const two = rainLabels(hoursFrom(HOURS, at(13), 48), 6)
  assert.deepEqual(two.slice(0, 3), [
    { index: 0, text: 'Now' },
    { index: 5, text: '6 PM' },
    { index: 11, text: '12 AM' },
  ])
})

function minutesFrom(start, chances) {
  return chances.map((c, i) => ({ time: stamp(new Date(start.getTime() + i * 60000)), precipChance: c, precipIntensityInHr: 0 }))
}

test('the next hour: shown from 10 %, said in words', () => {
  const now = at(13, 40)
  assert.equal(NEXT_HOUR_FLOOR, 10)
  // All dry, or under the floor: no strip.
  assert.equal(nextHourStrip({ summary: [], minutes: minutesFrom(now, Array(60).fill(0)) }, now), null)
  assert.equal(nextHourStrip({ summary: [], minutes: minutesFrom(now, Array(60).fill(9)) }, now), null)
  assert.equal(nextHourStrip(null, now), null)
  // Rain arriving at minute 12.
  const arriving = Array.from({ length: 60 }, (_, i) => (i < 12 ? 5 : 70))
  const a = nextHourStrip({ summary: [{ time: stamp(now), condition: 'clear' }, { time: stamp(at(13, 52)), condition: 'rain' }], minutes: minutesFrom(now, arriving) }, now)
  assert.equal(a.text, 'Rain likely in 12 min')
  assert.equal(a.chances.length, 60)
  // Raining now, stopping at minute 25; snow named by the summary.
  const stopping = Array.from({ length: 60 }, (_, i) => (i < 25 ? 80 : 0))
  assert.equal(nextHourStrip({ summary: [{ time: stamp(now), condition: 'snow' }], minutes: minutesFrom(now, stopping) }, now).text, 'Snow stopping in 25 min')
  assert.equal(nextHourStrip({ summary: [], minutes: minutesFrom(now, Array(60).fill(90)) }, now).text, 'Rain for the next hour')
  assert.equal(nextHourStrip({ summary: [], minutes: minutesFrom(now, Array(60).fill(30)) }, now).text, 'Rain possible within the hour')
  // Minutes already over are dropped: the hub fetched at 1:28.
  const early = minutesFrom(at(13, 28), Array.from({ length: 84 }, (_, i) => (i < 12 ? 60 : 0)))
  assert.equal(nextHourStrip({ summary: [], minutes: early }, now), null)
})

const ALERTS = [
  { event: 'Special Weather Statement', severity: 'Minor', ends: '2026-09-26T23:00:00-07:00' },
  { event: 'Wind Advisory', severity: 'Moderate', ends: '2026-09-26T21:00:00-07:00', onset: '2026-09-26T12:00:00-07:00' },
  { event: 'High Wind Warning', severity: 'Severe', ends: '2026-09-27T06:00:00-07:00' },
  { event: 'Old Frost Advisory', severity: 'Extreme', ends: '2026-09-26T09:00:00-07:00' },
]

test('alerts: the most severe in force leads; an ended one is gone', () => {
  const now = new Date('2026-09-26T14:00:00-07:00')
  assert.deepEqual(activeAlerts(ALERTS, now).map((a) => a.event), ['High Wind Warning', 'Wind Advisory', 'Special Weather Statement'])
  assert.equal(pickAlert(ALERTS, now).event, 'High Wind Warning')
  assert.equal(pickAlert(ALERTS.slice(0, 2), now).event, 'Wind Advisory')
  assert.equal(pickAlert([], now), null)
  assert.equal(pickAlert(null, now), null)
  // After 9 pm the advisory has ended.
  assert.equal(pickAlert(ALERTS.slice(0, 2), new Date('2026-09-26T21:30:00-07:00')).event, 'Special Weather Statement')
})

test('alerts: red for warnings, amber for the rest', () => {
  assert.equal(alertTone({ event: 'High Wind Warning', severity: 'Moderate' }), 'warning')
  assert.equal(alertTone({ event: 'Heat Advisory', severity: 'Severe' }), 'warning')
  assert.equal(alertTone({ event: 'Wind Advisory', severity: 'Moderate' }), 'advisory')
  assert.equal(alertTone({ event: 'Flood Watch', severity: 'Minor' }), 'advisory')
})

test('alerts: until, through, from, in the headline\'s words', () => {
  const now = new Date(2026, 8, 26, 14, 0)
  assert.equal(alertWhen({ event: 'x', ends: new Date(2026, 8, 26, 18, 0).toISOString() }, now), 'until 6 pm')
  assert.equal(alertWhen({ event: 'x', ends: new Date(2026, 8, 26, 21, 30).toISOString() }, now), 'until 9:30 pm')
  assert.equal(alertWhen({ event: 'x', ends: new Date(2026, 8, 27, 0, 0).toISOString() }, now), 'until midnight')
  assert.equal(alertWhen({ event: 'x', ends: new Date(2026, 8, 27, 6, 0).toISOString() }, now), 'through Sun 6 am')
  assert.equal(alertWhen({ event: 'x', ends: new Date(2026, 9, 9, 6, 0).toISOString() }, now), 'through Oct 9')
  assert.equal(alertWhen({ event: 'x', onset: new Date(2026, 8, 26, 17, 0).toISOString(), ends: new Date(2026, 8, 27, 5, 0).toISOString() }, now), 'from 5 pm')
  assert.equal(alertWhen({ event: 'x' }, now), '')
})

const CURRENT = {
  tempF: 59, feelsLikeF: 56, feelsF: 55.8, humidity: 72, dewF: 49.5, windMph: 5, gustMph: 12.4,
  windDir: 334, pressureMb: 1022, visibilityMi: 13.7, uv: 3, cloudCover: 100,
}

test('conditions: each value as shown, -- when missing', () => {
  const sun = { sunrise: new Date(2026, 8, 26, 7, 2), sunset: new Date(2026, 8, 26, 18, 58) }
  const v = (key, c = CURRENT) => conditionValue(key, c, sun)
  assert.equal(v('feelsLike'), '56°')
  assert.equal(v('feelsLike', { feelsF: 55.6 }), '56°')
  assert.equal(v('humidity'), '72%')
  assert.equal(v('wind'), '5 mph NW')
  assert.equal(v('wind', { windMph: 0.3 }), 'Calm')
  assert.equal(v('wind', { windMph: 8 }), '8 mph')
  assert.equal(v('gusts'), '12 mph')
  assert.equal(v('uv'), '3 Moderate')
  assert.equal(v('pressure'), '30.18 inHg')
  assert.equal(v('visibility'), '14 mi')
  assert.equal(v('visibility', { visibilityMi: 3.24 }), '3.2 mi')
  assert.equal(v('dewPoint'), '50°')
  assert.equal(v('sunrise'), '7:02 am')
  assert.equal(v('sunset'), '6:58 pm')
  assert.equal(v('cloudCover'), '100%')
  assert.equal(conditionValue('humidity', null, null), '--')
  assert.equal(conditionValue('sunset', CURRENT, { sunrise: null, sunset: null }), '--')
  assert.equal(compass(0), 'N')
  assert.equal(compass(359), 'N')
  assert.equal(compass(225), 'SW')
  assert.equal(uvBand(11), 'Extreme')
})

test('conditions: the rows the toggles pick, in order', () => {
  const defaults = { showFeelsLike: true, showHumidity: true, showWind: true, showUv: true, showSunrise: true, showSunset: true }
  assert.deepEqual(conditionRows(defaults, CURRENT, null).map((r) => r.key), ['feelsLike', 'humidity', 'wind', 'uv', 'sunrise', 'sunset'])
  assert.deepEqual(conditionRows({ showCloudCover: true, showGusts: true }, CURRENT, null).map((r) => r.label), ['Gusts', 'Cloud cover'])
  assert.equal(CONDITION_ROWS.length, 11)
})

test('conditions: two columns when that gives the rows bigger type', () => {
  assert.equal(conditionsColumns('auto', 700, 200, 6), 2) // wide and short
  assert.equal(conditionsColumns('auto', 300, 400, 6), 1) // tall and narrow
  assert.equal(conditionsColumns('auto', 500, 500, 6), 1)
  assert.equal(conditionsColumns('one', 700, 200, 6), 1)
  assert.equal(conditionsColumns('two', 300, 400, 6), 2)
  assert.equal(conditionsColumns('two', 300, 400, 1), 1)
  assert.equal(conditionsColumns('auto', 0, 0, 6), 1)
})
