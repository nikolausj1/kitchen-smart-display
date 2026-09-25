// weatherRules.test.mjs - lib/weatherRules.mjs (the headline's weather lines),
// with the two sources that feed it: lib/hubWeather.mjs (the forecast, its
// normaliser and refresher) and lib/nwsAlerts.mjs (the NWS alerts).
//
//   node --test frameserver/test/weatherRules.test.mjs
//
// Every `now` is a fixed local time; the zone is pinned to the house's
// (America/Los_Angeles) before any date is built, so the NWS fixtures (Pacific
// offsets) read the same on any machine. Fixtures in test/fixtures/:
//   nws-active.json            a real response for the house, 2026-09-24 (none active)
//   nws-winter-storm.json      hand-written: a Wind Advisory, a Winter Storm
//                              Warning, and three the normaliser must drop
//   open-meteo-forecast.json   a real Open-Meteo response for the house,
//                              fetched 2026-09-24 23:32 local

process.env.TZ = 'America/Los_Angeles'

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BITTER_BEFORE_HOUR,
  BITTER_FEELS_F,
  FROST_F,
  FROST_FROM_HOUR,
  FROST_UNTIL_HOUR,
  HARD_FREEZE_F,
  HOT_BEFORE_HOUR,
  HOT_F,
  RAIN_PROB,
  RAIN_SOON_MINUTES,
  RAIN_UNTIL_HOUR,
  RAINING_NOW_PROB,
  RANK,
  SNOW_MAX_F,
  TIER_B_RANK,
  VERY_WINDY_GUST_MPH,
  WIND_GUST_MPH,
  WIND_HOURS,
  alertText,
  clock,
  isTierA,
  weatherAlertsFor,
  weatherLinesFor,
} from '../lib/weatherRules.mjs'
import { CACHE_FILE, createHubWeather, forecastUrl, parseForecast } from '../lib/hubWeather.mjs'
import { alertsUrl, createNwsAlerts, parseAlerts } from '../lib/nwsAlerts.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

// Local wall-clock times; the default day is Thursday 24 September 2026.
const at = (h, m = 0, day = 24, month = 9, year = 2026) => new Date(year, month - 1, day, h, m)
const iso = (d) => d.toISOString()

function stampOf(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`
}

// A snapshot in hubWeather.mjs's shape: `count` dry, mild hours from `start`
// (local, on the hour), each the hour STARTING at its time. `set(t)` returns
// the fields to change for the hour starting at t.
function forecast({ start = at(0), count = 48, set = () => ({}), daily = [] } = {}) {
  const hourly = []
  for (let i = 0; i < count; i++) {
    const t = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() + i)
    hourly.push({
      time: stampOf(t),
      tempF: 55,
      feelsF: 55,
      precipProb: 0,
      precipIn: 0,
      code: 3,
      gustMph: 5,
      windMph: 3,
      ...set(t),
    })
  }
  return { fetchedAt: iso(start), error: null, hourly, daily }
}

// set() helpers: fields for particular local hours ('24T15' = the 24th, 3 pm).
const key = (t) => `${t.getDate()}T${t.getHours()}`
const hoursWith = (map) => (t) => map[key(t)] ?? {}
const range = (fromDay, fromHour, toDay, toHour, fields) => (t) => {
  const d = new Date(t)
  const from = new Date(2026, 8, fromDay, fromHour)
  const to = new Date(2026, 8, toDay, toHour)
  return d >= from && d <= to ? fields : {}
}

const lines = (now, fc, extra = {}) => weatherLinesFor({ now, forecast: fc, ...extra })
const only = (now, fc, rule, extra) => lines(now, fc, extra).filter((l) => l.rule === rule)
const textOf = (now, fc, rule, extra) => only(now, fc, rule, extra)[0]?.text ?? null

describe('weatherRules: the exported thresholds and ranks', () => {
  test('thresholds', () => {
    assert.equal(RAIN_PROB, 50)
    assert.equal(RAINING_NOW_PROB, 70)
    assert.equal(RAIN_SOON_MINUTES, 60)
    assert.equal(RAIN_UNTIL_HOUR, 21)
    assert.equal(SNOW_MAX_F, 32)
    assert.equal(FROST_F, 34)
    assert.equal(HARD_FREEZE_F, 20)
    assert.equal(FROST_FROM_HOUR, 12)
    assert.equal(FROST_UNTIL_HOUR, 9)
    assert.equal(WIND_GUST_MPH, 30)
    assert.equal(VERY_WINDY_GUST_MPH, 45)
    assert.equal(WIND_HOURS, 12)
    assert.equal(HOT_F, 90)
    assert.equal(HOT_BEFORE_HOUR, 14)
    assert.equal(BITTER_FEELS_F, 15)
    assert.equal(BITTER_BEFORE_HOUR, 10)
  })

  test('tier A sits below TIER_B_RANK, the tier B rules in the order alert, rain, frost, wind, heat, cold', () => {
    assert.ok(RANK.ALERT + 4 < TIER_B_RANK)
    assert.equal(RANK.ADVISORY, TIER_B_RANK)
    const order = [RANK.ADVISORY + 4, RANK.RAIN, RANK.FROST, RANK.WIND, RANK.HEAT, RANK.COLD]
    assert.deepEqual([...order].sort((a, b) => a - b), order)
  })

  test('house time style', () => {
    assert.equal(clock(at(15)), '3 pm')
    assert.equal(clock(at(6, 30)), '6:30 am')
    assert.equal(clock(at(12)), '12 pm')
    assert.equal(clock(at(0, 5)), '12:05 am')
  })

  test('nothing to say without data, and junk is ignored', () => {
    assert.deepEqual(weatherLinesFor({ now: at(9) }), [])
    assert.deepEqual(weatherLinesFor({ now: at(9), forecast: null, alerts: null }), [])
    assert.deepEqual(weatherLinesFor({ now: at(9), forecast: { hourly: 'no', daily: {} }, alerts: 'no' }), [])
    assert.deepEqual(weatherLinesFor({ now: new Date('garbage'), forecast: forecast() }), [])
    assert.deepEqual(lines(at(9), forecast()), [])
    assert.deepEqual(weatherLinesFor(), [])
  })
})

describe('weatherRules: rain', () => {
  test('the probability boundary: 49 % says nothing, 50 % is "Rain from 3 pm", until 2 pm', () => {
    assert.equal(textOf(at(7), forecast({ set: hoursWith({ '24T15': { precipProb: 49 } }) }), 'rain'), null)
    const [l] = only(at(7), forecast({ set: hoursWith({ '24T15': { precipProb: 50 } }) }), 'rain')
    assert.deepEqual(l, { text: 'Rain from 3 pm', kind: 'weather', rank: RANK.RAIN, until: iso(at(14)), rule: 'rain' })
  })

  test('a precipitation code counts whatever the probability', () => {
    const fc = forecast({ set: hoursWith({ '24T15': { precipProb: 10, code: 51 } }) })
    assert.equal(textOf(at(7), fc, 'rain'), 'Rain from 3 pm')
  })

  test('within the hour: 60 minutes out is "within the hour", 61 is "from"', () => {
    const fc = forecast({ set: hoursWith({ '24T15': { precipProb: 60 } }) })
    const [soon] = only(at(14), fc, 'rain')
    assert.equal(soon.text, 'Rain within the hour')
    assert.equal(soon.until, iso(at(15)))
    const [later] = only(at(13, 59), fc, 'rain')
    assert.equal(later.text, 'Rain from 3 pm')
    assert.equal(later.until, iso(at(14)))
  })

  test('this hour likely (50 to 69 %) but no rain code yet: within the hour, until the hour ends', () => {
    const fc = forecast({ set: hoursWith({ '24T14': { precipProb: 69 } }) })
    const [l] = only(at(14, 20), fc, 'rain')
    assert.equal(l.text, 'Rain within the hour')
    assert.equal(l.until, iso(at(15)))
  })

  test('raining now by code: "Raining now, clearing by 5 pm", until 5 pm', () => {
    const fc = forecast({ set: range(24, 10, 24, 16, { precipProb: 40, code: 61 }) })
    const [l] = only(at(10, 30), fc, 'rain')
    assert.equal(l.text, 'Raining now, clearing by 5 pm')
    assert.equal(l.until, iso(at(17)))
  })

  test('raining now by probability: 70 % is raining now, 69 % is not', () => {
    const wet = forecast({ set: range(24, 10, 24, 11, { precipProb: 70 }) })
    assert.equal(textOf(at(10, 30), wet, 'rain'), 'Raining now, clearing by 12 pm')
    const likely = forecast({ set: range(24, 10, 24, 11, { precipProb: 69 }) })
    assert.equal(textOf(at(10, 30), likely, 'rain'), 'Rain within the hour')
  })

  test('the run keeps going through lighter wet hours (>= 50 %) and clears on the first dry one', () => {
    const fc = forecast({
      set: hoursWith({
        '24T10': { code: 63 },
        '24T11': { precipProb: 55 },
        '24T12': { precipProb: 50 },
        '24T13': { precipProb: 49 },
      }),
    })
    assert.equal(textOf(at(10, 5), fc, 'rain'), 'Raining now, clearing by 1 pm')
  })

  test('a run past midnight is "Rain most of the day", until 9 pm; clearing AT midnight is not before it', () => {
    const allDay = forecast({ set: range(24, 0, 25, 3, { code: 61 }) })
    const [l] = only(at(8), allDay, 'rain')
    assert.equal(l.text, 'Rain most of the day')
    assert.equal(l.until, iso(at(RAIN_UNTIL_HOUR)))
    const toMidnight = forecast({ set: range(24, 0, 24, 23, { code: 61 }) })
    assert.equal(textOf(at(8), toMidnight, 'rain'), 'Rain most of the day')
    const toEleven = forecast({ set: range(24, 0, 24, 22, { code: 61 }) })
    assert.equal(textOf(at(8), toEleven, 'rain'), 'Raining now, clearing by 11 pm')
  })

  test('a forecast that ends mid-rain says only "Raining now"', () => {
    const fc = forecast({ start: at(10), count: 5, set: () => ({ code: 61 }) })
    const [l] = only(at(10, 30), fc, 'rain')
    assert.equal(l.text, 'Raining now')
    assert.equal(l.until, iso(at(15)))
  })

  test('the 9 pm cut-off: nothing from 9 pm, and nothing about rain that starts at 9 pm or later', () => {
    const evening = forecast({ set: range(24, 20, 24, 23, { code: 61 }) })
    assert.equal(textOf(at(20, 59), evening, 'rain'), 'Rain most of the day')
    assert.equal(textOf(at(21), evening, 'rain'), null)
    assert.equal(textOf(at(23, 30), evening, 'rain'), null)
    const eightPm = forecast({ set: hoursWith({ '24T20': { precipProb: 80 } }) })
    assert.equal(textOf(at(15), eightPm, 'rain'), 'Rain from 8 pm')
    const ninePm = forecast({ set: hoursWith({ '24T21': { precipProb: 80 } }) })
    assert.equal(textOf(at(15), ninePm, 'rain'), null)
  })

  test('day boundaries: after midnight the new day is scanned', () => {
    const fc = forecast({ set: hoursWith({ '25T7': { precipProb: 90 } }) })
    assert.equal(textOf(at(23, 30), fc, 'rain'), null) // 11:30 pm: past the cut-off
    assert.equal(textOf(at(0, 30, 25), fc, 'rain'), 'Rain from 7 am')
  })

  test('snow and freezing rain by code; a bare probability is snow at 32 F, rain at 33 F', () => {
    assert.equal(textOf(at(7), forecast({ set: hoursWith({ '24T15': { code: 73 } }) }), 'rain'), 'Snow from 3 pm')
    assert.equal(textOf(at(7), forecast({ set: hoursWith({ '24T15': { code: 66 } }) }), 'rain'), 'Freezing rain from 3 pm')
    assert.equal(textOf(at(14), forecast({ set: hoursWith({ '24T15': { code: 85 } }) }), 'rain'), 'Snow within the hour')
    const snowing = forecast({ set: range(24, 9, 24, 16, { code: 71, tempF: 30 }) })
    assert.equal(textOf(at(9, 10), snowing, 'rain'), 'Snowing now, clearing by 5 pm')
    const cold = forecast({ set: hoursWith({ '24T15': { precipProb: 60, tempF: 32 } }) })
    assert.equal(textOf(at(7), cold, 'rain'), 'Snow from 3 pm')
    const coolish = forecast({ set: hoursWith({ '24T15': { precipProb: 60, tempF: 32.6 } }) })
    assert.equal(textOf(at(7), coolish, 'rain'), 'Rain from 3 pm')
  })
})

describe('weatherRules: frost', () => {
  const night = (low) => forecast({ set: hoursWith({ '25T6': { tempF: low } }) })

  test('34 F is "Frost tonight", 35 F is nothing; until 9 am tomorrow', () => {
    const [l] = only(at(15), night(34), 'frost')
    assert.deepEqual(l, { text: 'Frost tonight', kind: 'weather', rank: RANK.FROST, until: iso(at(9, 0, 25)), rule: 'frost' })
    assert.equal(textOf(at(15), night(35), 'frost'), null)
  })

  test('whole degrees first: 34.4 is 34 (frost), 34.5 is 35 (none)', () => {
    assert.equal(textOf(at(15), night(34.4), 'frost'), 'Frost tonight')
    assert.equal(textOf(at(15), night(34.5), 'frost'), null)
  })

  test('20 F is a hard freeze, 21 F plain frost', () => {
    assert.equal(textOf(at(15), night(20), 'frost'), 'Hard freeze tonight')
    assert.equal(textOf(at(15), night(21), 'frost'), 'Frost tonight')
  })

  test('the 9 am cut-off: 8 am counts, 9 am does not', () => {
    assert.equal(textOf(at(15), forecast({ set: hoursWith({ '25T8': { tempF: 30 } }) }), 'frost'), 'Frost tonight')
    assert.equal(textOf(at(15), forecast({ set: hoursWith({ '25T9': { tempF: 30 } }) }), 'frost'), null)
  })

  test('only from noon to midnight: 11:59 am and 12:30 am say nothing, noon and 11:59 pm do', () => {
    const fc = forecast({ set: range(24, 0, 25, 8, { tempF: 30 }) })
    assert.equal(textOf(at(11, 59), fc, 'frost'), null)
    assert.equal(textOf(at(12), fc, 'frost'), 'Frost tonight')
    assert.equal(textOf(at(23, 59), fc, 'frost'), 'Frost tonight')
    assert.equal(textOf(at(0, 30, 25), fc, 'frost'), null)
  })

  test('hours already over do not count', () => {
    const fc = forecast({ set: hoursWith({ '24T13': { tempF: 30 } }) })
    assert.equal(textOf(at(13, 30), fc, 'frost'), 'Frost tonight') // this hour
    assert.equal(textOf(at(14), fc, 'frost'), null) // an hour ago
  })
})

describe('weatherRules: wind', () => {
  const gust = (hour, mph, day = 24) => forecast({ set: hoursWith({ [`${day}T${hour}`]: { gustMph: mph } }) })

  test('29 mph says nothing, 30 mph is windy; named for the peak, until the last gusty hour ends', () => {
    assert.equal(textOf(at(7), gust(14, 29), 'wind'), null)
    const [l] = only(at(7), gust(14, 30), 'wind')
    assert.deepEqual(l, { text: 'Windy afternoon', kind: 'weather', rank: RANK.WIND, until: iso(at(15)), rule: 'wind' })
    assert.equal(textOf(at(7), gust(14, 29.5), 'wind'), 'Windy afternoon') // rounds to 30
  })

  test('44 mph is windy, 45 mph very windy', () => {
    assert.equal(textOf(at(7), gust(14, 44), 'wind'), 'Windy afternoon')
    assert.equal(textOf(at(7), gust(14, 45), 'wind'), 'Very windy afternoon')
  })

  test('morning, afternoon, tonight by the peak hour', () => {
    assert.equal(textOf(at(6), gust(11, 35), 'wind'), 'Windy morning')
    assert.equal(textOf(at(6), gust(12, 35), 'wind'), 'Windy afternoon')
    assert.equal(textOf(at(7), gust(17, 35), 'wind'), 'Windy afternoon')
    assert.equal(textOf(at(7), gust(18, 35), 'wind'), 'Windy tonight')
    assert.equal(textOf(at(22), gust(2, 35, 25), 'wind'), 'Windy tonight')
    assert.equal(textOf(at(1, 0, 25), gust(3, 35, 25), 'wind'), 'Windy tonight')
    assert.equal(textOf(at(20), gust(6, 35, 25), 'wind'), 'Windy tomorrow morning')
  })

  test('the peak wins, the earliest on a tie; until the last gusty hour', () => {
    const fc = forecast({ set: hoursWith({ '24T10': { gustMph: 32 }, '24T14': { gustMph: 50 }, '24T16': { gustMph: 31 } }) })
    const [l] = only(at(8), fc, 'wind')
    assert.equal(l.text, 'Very windy afternoon')
    assert.equal(l.until, iso(at(17)))
    const tie = forecast({ set: hoursWith({ '24T10': { gustMph: 35 }, '24T14': { gustMph: 35 } }) })
    assert.equal(textOf(at(8), tie, 'wind'), 'Windy morning')
  })

  test('the 12 hour window: from 7 am, 6 pm counts and 7 pm does not', () => {
    assert.equal(textOf(at(7), gust(18, 40), 'wind'), 'Windy tonight')
    assert.equal(textOf(at(7), gust(19, 40), 'wind'), null)
  })
})

describe('weatherRules: heat and cold', () => {
  const today = (highF, date = '2026-09-24') => forecast({ daily: [{ date, highF, lowF: 60, precipProbMax: 0, code: 0 }] })
  const feels = (f) => forecast({ set: hoursWith({ '24T9': { feelsF: f } }) })

  test('a 90 F high before 2 pm: "Hot one today, high of 90", until 2 pm; 89 F nothing', () => {
    const [l] = only(at(13, 59), today(90), 'heat')
    assert.deepEqual(l, { text: 'Hot one today, high of 90', kind: 'weather', rank: RANK.HEAT, until: iso(at(14)), rule: 'heat' })
    assert.equal(textOf(at(9), today(89), 'heat'), null)
    assert.equal(textOf(at(9), today(89.5), 'heat'), 'Hot one today, high of 90')
    assert.equal(textOf(at(14), today(94), 'heat'), null)
  })

  test("only today's high: a stale daily entry for yesterday says nothing", () => {
    assert.equal(textOf(at(9), today(97, '2026-09-23'), 'heat'), null)
  })

  test('feels-like 15 F before 10 am: "Bitter cold this morning, feels like 15", until 10 am; 16 F nothing', () => {
    const [l] = only(at(9, 30), feels(15), 'cold')
    assert.deepEqual(l, {
      text: 'Bitter cold this morning, feels like 15',
      kind: 'weather',
      rank: RANK.COLD,
      until: iso(at(10)),
      rule: 'cold',
    })
    assert.equal(textOf(at(9, 30), feels(16), 'cold'), null)
    assert.equal(textOf(at(9, 30), feels(-3.4), 'cold'), 'Bitter cold this morning, feels like -3')
    const tenAm = forecast({ set: hoursWith({ '24T10': { feelsF: 3 } }) })
    assert.equal(textOf(at(10), tenAm, 'cold'), null)
  })

  test("metric changes only the quoted degrees; the thresholds stay Fahrenheit", () => {
    assert.equal(textOf(at(9), today(94), 'heat', { units: 'metric' }), 'Hot one today, high of 34')
    assert.equal(textOf(at(9, 30), feels(5), 'cold', { units: 'metric' }), 'Bitter cold this morning, feels like -15')
    assert.equal(textOf(at(9), today(89), 'heat', { units: 'metric' }), null)
  })
})

describe('weatherRules: NWS alerts', () => {
  const storm = fixture('nws-winter-storm.json')
  const dec = (h, m = 0, day = 17) => at(h, m, day, 12)

  test('Thu 3 pm: the warning is tier A ("through Sat 6 am"), the advisory tier B ("until 6 pm")', () => {
    const now = dec(15)
    const list = weatherLinesFor({ now, alerts: parseAlerts(storm, now) })
    assert.deepEqual(list, [
      {
        text: 'Winter Storm Warning through Sat 6 am',
        kind: 'alert',
        rank: RANK.ALERT + 1,
        until: iso(dec(6, 0, 19)),
        rule: 'alert',
      },
      { text: 'Wind Advisory until 6 pm', kind: 'alert', rank: RANK.ADVISORY + 2, until: iso(dec(18)), rule: 'alert' },
    ])
    assert.ok(list[0].rank < TIER_B_RANK && list[1].rank >= TIER_B_RANK)
  })

  test('before the onset it says "from", until the onset; an advisory still in force ranks by severity', () => {
    const now = dec(8)
    const list = weatherLinesFor({ now, alerts: parseAlerts(storm, now) })
    assert.deepEqual(
      list.map((l) => [l.text, l.rank, l.until]),
      [
        ['Winter Storm Warning from 10 am', RANK.ALERT + 1, iso(dec(10))],
        ['Wind Advisory from 12 pm', RANK.ADVISORY + 2, iso(dec(12))],
        ['Frost Advisory until 9 am', RANK.ADVISORY + 3, iso(dec(9))],
      ],
    )
  })

  test('the evening before: "from Thu 10 am"; after 6 pm Thursday the advisory is gone', () => {
    assert.equal(weatherLinesFor({ now: dec(20, 0, 16), alerts: parseAlerts(storm, dec(20, 0, 16)) })[0].text,
      'Winter Storm Warning from Thu 10 am')
    const evening = weatherLinesFor({ now: dec(18), alerts: parseAlerts(storm, dec(15)) })
    assert.deepEqual(evening.map((l) => l.text), ['Winter Storm Warning through Sat 6 am'])
  })

  test('tier A: Extreme or Severe, or any Warning; watches and statements by severity', () => {
    assert.equal(isTierA({ event: 'Tornado Warning', severity: 'Extreme' }), true)
    assert.equal(isTierA({ event: 'Winter Storm Watch', severity: 'Severe' }), true)
    assert.equal(isTierA({ event: 'Gale Warning', severity: 'Moderate' }), true)
    assert.equal(isTierA({ event: 'Wind Advisory', severity: 'Moderate' }), false)
    assert.equal(isTierA({ event: 'Air Quality Alert', severity: 'Unknown' }), false)
  })

  test('several tier A alerts: the most severe, then the earliest ending; one line per event', () => {
    const now = at(9)
    const a = (event, severity, ends, extra = {}) => ({ id: event + ends, event, severity, onset: iso(at(8)), ends: iso(ends), ...extra })
    const alerts = [
      a('Flood Warning', 'Severe', at(20)),
      a('High Wind Warning', 'Severe', at(16)),
      a('Gale Warning', 'Moderate', at(10)),
      a('Flash Flood Warning', 'Extreme', at(22)),
      a('High Wind Warning', 'Severe', at(18)),
    ]
    assert.deepEqual(weatherLinesFor({ now, alerts }).map((l) => l.text), [
      'Flash Flood Warning until 10 pm',
      'High Wind Warning until 4 pm',
      'Flood Warning until 8 pm',
      'Gale Warning until 10 am',
    ])
  })

  test('alert words: until midnight, through a weekday, a date a week out, no end at all', () => {
    const now = at(9)
    assert.equal(alertText({ event: 'Wind Advisory', onset: iso(at(8)), ends: iso(at(0, 0, 25)) }, now), 'Wind Advisory until midnight')
    assert.equal(alertText({ event: 'Wind Advisory', onset: iso(at(8)), ends: iso(at(6, 30, 26)) }, now), 'Wind Advisory through Sat 6:30 am')
    assert.equal(alertText({ event: 'Flood Warning', onset: iso(at(8)), ends: iso(at(9, 0, 1, 10)) }, now), 'Flood Warning through Oct 1')
    assert.equal(alertText({ event: 'Air Quality Alert', onset: iso(at(8)), ends: null }, now), 'Air Quality Alert')
    assert.equal(alertText({ event: 'Winter Storm Watch', onset: iso(at(0, 0, 25)), ends: iso(at(6, 0, 26)) }, now),
      'Winter Storm Watch from midnight')
  })

  test('an alert that has ended says nothing, even from a stale list', () => {
    const alerts = [{ id: 'x', event: 'Wind Advisory', severity: 'Moderate', onset: iso(at(8)), ends: iso(at(9)) }]
    assert.deepEqual(weatherLinesFor({ now: at(9), alerts }), [])
    assert.equal(weatherLinesFor({ now: at(8, 59), alerts }).length, 1)
  })

  test('accepts the snapshot shape too ({ alerts })', () => {
    const now = dec(15)
    assert.equal(weatherLinesFor({ now, alerts: { fetchedAt: null, error: null, alerts: parseAlerts(storm, now) } }).length, 2)
  })

  test('weatherAlertsFor: most severe first, at most 3, one per event, until = ends as sent', () => {
    const now = dec(8)
    const list = parseAlerts(storm, now)
    assert.deepEqual(weatherAlertsFor(list, now), [
      {
        event: 'Winter Storm Warning',
        severity: 'Severe',
        until: '2026-12-19T06:00:00-08:00',
        headline: 'Winter Storm Warning issued December 17 at 3:45AM PST until December 19 at 6:00AM PST by NWS Seattle WA',
      },
      {
        event: 'Wind Advisory',
        severity: 'Moderate',
        until: '2026-12-17T18:00:00-08:00',
        headline: 'Wind Advisory issued December 17 at 4:12AM PST until December 17 at 6:00PM PST by NWS Seattle WA',
      },
      {
        event: 'Frost Advisory',
        severity: 'Minor',
        until: '2026-12-17T09:00:00-08:00',
        headline: 'Frost Advisory issued December 16 at 9:15PM PST until December 17 at 9:00AM PST by NWS Seattle WA',
      },
    ])
    assert.equal(weatherAlertsFor(list, now, 1).length, 1)
    assert.deepEqual(weatherAlertsFor([], now), [])
  })

  test('alerts outrank the forecast rules, advisories included', () => {
    const now = dec(15)
    const fc = forecast({ start: dec(0), set: (t) => (t.getHours() >= 15 && t.getDate() === 17 ? { code: 73, tempF: 30 } : {}) })
    const all = weatherLinesFor({ now, forecast: fc, alerts: parseAlerts(storm, now) })
    assert.deepEqual(all.map((l) => l.rule), ['alert', 'alert', 'rain', 'frost'])
    assert.deepEqual(all.map((l) => l.text).slice(2), ['Snow most of the day', 'Frost tonight'])
  })
})

describe('nwsAlerts: parseAlerts', () => {
  test('the real house response (none active) parses to an empty list', () => {
    assert.deepEqual(parseAlerts(fixture('nws-active.json'), at(23, 30)), [])
  })

  test('the hand-written fixture: Cancel, Test and ended alerts are dropped; fields normalised', () => {
    const now = at(15, 0, 17, 12)
    const list = parseAlerts(fixture('nws-winter-storm.json'), now)
    assert.deepEqual(list.map((a) => a.event), ['Wind Advisory', 'Winter Storm Warning'])
    const w = list[1]
    assert.equal(w.id, 'urn:oid:2.49.0.1.840.0.test-winter-storm-warning.002.1')
    assert.equal(w.severity, 'Severe')
    assert.equal(w.urgency, 'Expected')
    assert.equal(w.certainty, 'Likely')
    assert.equal(w.onset, '2026-12-17T10:00:00-08:00')
    assert.equal(w.ends, '2026-12-19T06:00:00-08:00')
    assert.equal(w.messageType, 'Update')
    assert.equal(w.senderName, 'NWS Seattle WA')
    assert.equal(w.description.length, 300)
    assert.ok(w.description.startsWith('* WHAT...Heavy snow expected. Total snow accumulations of 6 to 10 inches,'))
    assert.ok(!/\s{2}|\n/.test(w.description))
    assert.deepEqual(Object.keys(w), [
      'id', 'event', 'severity', 'urgency', 'certainty', 'headline', 'description', 'onset', 'ends', 'messageType', 'senderName',
    ])
  })

  test('ends falls back to expires, onset to effective; an odd severity is Unknown; not a collection throws', () => {
    const feature = (props) => ({ id: 'f', properties: { id: 'a1', status: 'Actual', messageType: 'Alert', event: 'Special Weather Statement', ...props } })
    const [a] = parseAlerts({ features: [feature({ ends: null, expires: '2026-09-24T16:30:00-07:00', effective: '2026-09-24T15:00:00-07:00', severity: 'Bad' })] }, at(15))
    assert.equal(a.ends, '2026-09-24T16:30:00-07:00')
    assert.equal(a.onset, '2026-09-24T15:00:00-07:00')
    assert.equal(a.severity, 'Unknown')
    assert.deepEqual(parseAlerts({ features: [feature({ ends: '2026-09-24T14:00:00-07:00' })] }, at(15)), [])
    assert.deepEqual(parseAlerts({ features: [feature({ status: 'Exercise' })] }, at(15)), [])
    assert.throws(() => parseAlerts({ nope: true }), /not an NWS alerts collection/)
  })

  test('the request: four decimals, the NWS headers', async () => {
    assert.equal(alertsUrl({ lat: 47.6610608, lon: -122.3999576 }), 'https://api.weather.gov/alerts/active?point=47.6611,-122.4')
    const seen = []
    const src = createNwsAlerts({
      getLocation: () => ({ lat: 47.6610608, lon: -122.3999576 }),
      log: () => {},
      fixtureFile: null,
      request: async (url, headers) => {
        seen.push({ url, headers })
        return { status: 200, body: JSON.stringify(fixture('nws-active.json')) }
      },
    })
    await src.refresh('test')
    src.stop()
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].headers, { 'User-Agent': 'kitchen-smart-display-hub', Accept: 'application/geo+json' })
    assert.deepEqual(src.current(at(9)), { fetchedAt: src.health().fetchedAt, error: null, alerts: [] })
  })
})

describe('nwsAlerts: the refresher', () => {
  const storm = JSON.stringify(fixture('nws-winter-storm.json'))
  const loc = () => ({ lat: 47.6610608, lon: -122.3999576 })

  // The hand-written fixture's Thursday afternoon.
  const thursday = at(15, 0, 17, 12)

  function source(responses) {
    const calls = []
    const src = createNwsAlerts({
      getLocation: loc,
      log: () => {},
      fixtureFile: null,
      clock: () => thursday,
      request: async (url) => {
        calls.push(url)
        const r = responses.shift()
        if (r instanceof Error) throw r
        return r
      },
    })
    return { src, calls }
  }

  test('outside the US (400 out of bounds) or a 404: an empty list, quietly', async () => {
    const outside = JSON.stringify({ title: 'Invalid Parameter', status: 400, detail: 'Parameter "point" is invalid: out of bounds' })
    const { src } = source([{ status: 400, body: outside }, { status: 404, body: '{}' }])
    await src.refresh('test')
    assert.deepEqual([src.current().alerts, src.current().error], [[], null])
    await src.refresh('test')
    assert.deepEqual([src.current().alerts, src.current().error], [[], null])
    src.stop()
  })

  test('a failure keeps the last list and sets error; the next success clears it', async () => {
    const { src } = source([
      { status: 200, body: storm },
      { status: 503, body: 'down' },
      new Error('timed out after 10s'),
      { status: 200, body: JSON.stringify(fixture('nws-active.json')) },
    ])
    const events = () => src.current().alerts.map((a) => a.event)
    await src.refresh('test')
    assert.deepEqual(events(), ['Wind Advisory', 'Winter Storm Warning'])
    assert.deepEqual(src.health(), { count: 2, fetchedAt: iso(thursday), error: null })
    await src.refresh('test')
    assert.equal(src.current().error, 'NWS alerts HTTP 503')
    assert.deepEqual(events(), ['Wind Advisory', 'Winter Storm Warning'])
    await src.refresh('test')
    assert.equal(src.current().error, 'timed out after 10s')
    assert.equal(events().length, 2)
    // Kept, but an alert still leaves when it ends: the advisory at 6 pm.
    assert.deepEqual(src.current(at(18, 0, 17, 12)).alerts.map((a) => a.event), ['Winter Storm Warning'])
    // Kept for 12 hours at most.
    assert.deepEqual(src.current(at(3, 1, 18, 12)).alerts, [])
    await src.refresh('test')
    assert.equal(src.current().error, null)
    assert.deepEqual(events(), [])
    src.stop()
  })

  test('single flight: two refreshes at once make one request', async () => {
    const { src, calls } = source([{ status: 200, body: storm }])
    const [a, b] = [src.refresh('one'), src.refresh('two')]
    assert.equal(a, b)
    await a
    assert.equal(calls.length, 1)
    src.stop()
  })

  test('a fixture file replaces the NWS', async () => {
    const src = createNwsAlerts({
      getLocation: loc,
      log: () => {},
      fixtureFile: join(FIXTURES, 'nws-winter-storm.json'),
      clock: () => thursday,
      request: async () => assert.fail('no request with a fixture'),
    })
    await src.refresh('test')
    src.stop()
    assert.equal(src.health().error, null)
    assert.equal(src.current().alerts.length, 2)
  })
})

describe('hubWeather: parseForecast and the request', () => {
  const payload = fixture('open-meteo-forecast.json')

  test('48 hours from the current hour; rain, code and gusts moved to the start of their hour', () => {
    const snap = parseForecast(payload, new Date('2026-09-25T06:32:10Z'))
    assert.equal(snap.fetchedAt, '2026-09-25T06:32:10.000Z')
    assert.equal(snap.error, null)
    assert.equal(snap.hourly.length, 48)
    assert.deepEqual(snap.hourly[0], {
      time: '2026-09-24T23:00',
      tempF: 53.2, // the 23:00 stamp's own
      feelsF: 52.4,
      precipProb: 87, // the 00:00 stamp's "preceding hour" values
      precipIn: 0.028,
      code: 53,
      gustMph: 4.7,
      windMph: 3.4,
    })
    assert.equal(snap.hourly[47].time, '2026-09-26T22:00')
    assert.equal(snap.hourly[47].gustMph, payload.hourly.wind_gusts_10m[48])
  })

  test('3 days of daily data', () => {
    const snap = parseForecast(payload, new Date())
    assert.deepEqual(snap.daily[0], {
      date: '2026-09-24',
      highF: 60.1,
      lowF: 50.2,
      precipProbMax: 96,
      code: 55,
      sunrise: '2026-09-24T06:59',
      sunset: '2026-09-24T19:02',
    })
    assert.deepEqual(snap.daily.map((d) => d.date), ['2026-09-24', '2026-09-25', '2026-09-26'])
  })

  test('no hourly data throws', () => {
    assert.throws(() => parseForecast({ daily: {} }), /no hourly data/)
  })

  test('the request asks for the app units, timezone=auto, 49 stamps and 3 days', () => {
    const u = forecastUrl({ lat: 47.6610608, lon: -122.3999576 })
    const q = Object.fromEntries(u.searchParams)
    assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast')
    assert.deepEqual(q, {
      latitude: '47.6610608',
      longitude: '-122.3999576',
      hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_gusts_10m,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunrise,sunset',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto',
      forecast_days: '3',
      forecast_hours: '49',
    })
  })

  test('the real forecast at 7 am on the 25th: rain from 10 am (the 11:00 stamp), windy afternoon', () => {
    const snap = parseForecast(payload, at(23, 32))
    const list = weatherLinesFor({ now: at(7, 0, 25), forecast: snap })
    assert.deepEqual(list.map((l) => [l.text, l.until]), [
      ['Rain from 10 am', iso(at(9, 0, 25))],
      ['Windy afternoon', iso(at(14, 0, 25))],
    ])
  })
})

describe('hubWeather: the refresher', () => {
  const body = JSON.stringify(fixture('open-meteo-forecast.json'))
  const house = { lat: 47.6610608, lon: -122.3999576, timezone: 'auto' }

  function tempDir() {
    return mkdtempSync(join(tmpdir(), 'hub-weather-test-'))
  }

  function source(dir, responses, getLocation = () => house) {
    const calls = []
    const src = createHubWeather({
      dir,
      getLocation,
      log: () => {},
      request: async (url) => {
        calls.push(String(url))
        const r = responses.shift()
        if (r instanceof Error) throw r
        return r
      },
    })
    return { src, calls }
  }

  test('fetches, serves, writes weather-cache.json; single flight', async () => {
    const dir = tempDir()
    try {
      const { src, calls } = source(dir, [{ status: 200, body }])
      const a = src.refresh('one')
      assert.equal(src.refresh('two'), a)
      await a
      src.stop()
      assert.equal(calls.length, 1)
      const snap = src.current()
      assert.equal(snap.error, null)
      assert.equal(snap.hourly.length, 48)
      assert.deepEqual(Object.keys(snap), ['fetchedAt', 'error', 'hourly', 'daily'])
      assert.ok(existsSync(join(dir, CACHE_FILE)))
      assert.deepEqual(src.health(), { fetchedAt: snap.fetchedAt, error: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a restart serves the last copy at once; a failed fetch keeps it and sets error', async () => {
    const dir = tempDir()
    try {
      const first = source(dir, [{ status: 200, body }])
      await first.src.refresh('test')
      first.src.stop()
      const fetchedAt = first.src.current().fetchedAt

      const second = source(dir, [{ status: 502, body: JSON.stringify({ error: true, reason: 'Upstream down' }) }])
      const restored = second.src.start()
      assert.deepEqual(restored, { fetchedAt, hours: 48 })
      assert.equal(second.src.current().hourly.length, 48) // before the fetch lands
      await second.src.refresh('test') // joins the startup fetch
      second.src.stop()
      const snap = second.src.current()
      assert.equal(snap.error, 'Open-Meteo forecast HTTP 502: Upstream down')
      assert.equal(snap.fetchedAt, fetchedAt)
      assert.equal(snap.hourly.length, 48)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a cache for another location, or older than 12 hours, is not served', async () => {
    const dir = tempDir()
    try {
      const first = source(dir, [{ status: 200, body }])
      await first.src.refresh('test')
      first.src.stop()

      const elsewhere = source(dir, [new Error('offline')], () => ({ lat: 40.7, lon: -74 }))
      assert.equal(elsewhere.src.start(), null)
      await elsewhere.src.refresh('test')
      elsewhere.src.stop()
      assert.deepEqual(elsewhere.src.current().hourly, [])
      assert.equal(elsewhere.src.current().error, 'offline')

      const cached = JSON.parse(readFileSync(join(dir, CACHE_FILE), 'utf8'))
      cached.fetchedAt = new Date(Date.now() - 13 * 3_600_000).toISOString()
      writeFileSync(join(dir, CACHE_FILE), JSON.stringify(cached))
      const old = source(dir, [new Error('offline')])
      assert.equal(old.src.start(), null)
      await old.src.refresh('test')
      old.src.stop()
      assert.deepEqual(old.src.current().daily, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('no location in the registry is an error, not a request', async () => {
    const { src, calls } = source(null, [], () => undefined)
    await src.refresh('test')
    src.stop()
    assert.equal(calls.length, 0)
    assert.equal(src.current().error, 'no shared.location in the registry')
  })
})
