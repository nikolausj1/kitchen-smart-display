// headline.test.mjs - lib/headline.mjs, the Entry board's one line.
//
//   node --test frameserver/test/headline.test.mjs
//
// Every `now` is a fixed local time. The zone is pinned to the house's
// (America/Los_Angeles) before any date is built, so the weekday and clock
// words come out the same on any machine (the NWS fixtures are Pacific).

process.env.TZ = 'America/Los_Angeles'

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SOON_MINUTES, TOMORROW_FROM_HOUR, dayPartLine, headlineFor } from '../lib/headline.mjs'
import { parseForecast } from '../lib/hubWeather.mjs'
import { parseAlerts } from '../lib/nwsAlerts.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

// Thursday 24 September 2026, local.
const at = (h, m = 0, day = 24, month = 9) => new Date(2026, month - 1, day, h, m)
const iso = (d) => d.toISOString()

let seq = 0
function timed(title, start, end, extra = {}) {
  return {
    id: `ev-${++seq}`,
    title,
    allDay: false,
    start: iso(start),
    end: end ? iso(end) : null,
    startDate: null,
    endDate: null,
    ...extra,
  }
}

function allDay(title, startDate, endDate, extra = {}) {
  return { id: `ev-${++seq}`, title, allDay: true, start: null, end: null, startDate, endDate, ...extra }
}

describe('headline: the rules as shipped in phase 1 (no forecast, no alerts)', () => {
  test('constants', () => {
    assert.equal(SOON_MINUTES, 60)
    assert.equal(TOMORROW_FROM_HOUR, 18)
  })

  test('a running timed event: "<title> now", until its end', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(17, 20), events: [ev] })
    assert.deepEqual(h, { text: 'Vinny soccer now', kind: 'now', eventId: ev.id, until: iso(at(18, 15)) })
  })

  test('running beats a later event, and an event that has ended is skipped', () => {
    const done = timed('Chase dentist', at(8, 15), at(9))
    const running = timed('Lunch with Dana', at(12, 30), at(13, 30))
    const later = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(13), events: [later, done, running] })
    assert.equal(h.text, 'Lunch with Dana now')
    assert.equal(h.kind, 'now')
  })

  test('the next event inside the hour: "in N min", minutes rounded up, until its start', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: new Date(2026, 8, 24, 16, 19, 30), events: [ev] })
    assert.deepEqual(h, { text: 'Vinny soccer in 41 min', kind: 'soon', eventId: ev.id, until: iso(at(17)) })
  })

  test('the soon boundary: 60 min is soon, 61 min is next', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    assert.equal(headlineFor({ now: at(16), events: [ev] }).text, 'Vinny soccer in 60 min')
    assert.equal(headlineFor({ now: at(15, 59), events: [ev] }).kind, 'next')
  })

  test('a later event today: "at 5:00 pm", until an hour before it starts', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(9), events: [ev] })
    assert.deepEqual(h, { text: 'Vinny soccer at 5:00 pm', kind: 'next', eventId: ev.id, until: iso(at(16)) })
  })

  test('clock words: noon, half past midnight, morning', () => {
    const noon = timed('Lunch', at(12), at(13))
    const late = timed('Launch', at(0, 30, 25), at(1, 0, 25))
    const early = timed('Swim', at(9, 5), at(10))
    assert.equal(headlineFor({ now: at(8), events: [noon] }).text, 'Lunch at 12:00 pm')
    assert.equal(headlineFor({ now: at(7), events: [early] }).text, 'Swim at 9:05 am')
    // Tomorrow's 12:30 am event, seen in the evening.
    assert.equal(headlineFor({ now: at(20), events: [late] }).text, 'Tomorrow: Launch at 12:30 am')
  })

  test('titles are trimmed and inner whitespace collapsed; a missing id is null', () => {
    const ev = timed('  Vinny \n  soccer  ', at(17), at(18))
    delete ev.id
    const h = headlineFor({ now: at(9), events: [ev] })
    assert.equal(h.text, 'Vinny soccer at 5:00 pm')
    assert.equal(h.eventId, null)
  })

  test('cancelled events are ignored', () => {
    const ev = timed('Vinny soccer', at(17), at(18), { status: 'cancelled' })
    assert.equal(headlineFor({ now: at(9), events: [ev] }).kind, 'daypart')
  })

  test('a timed event on another day is not "today"', () => {
    const yesterday = timed('Old thing', at(17, 0, 23), at(18, 0, 23))
    const tomorrow = timed('Piano', at(16, 0, 25), at(16, 45, 25))
    const h = headlineFor({ now: at(9), events: [yesterday, tomorrow] })
    assert.equal(h.kind, 'daypart')
    assert.equal(h.text, 'Good morning, everybody.')
  })

  test('a started event with no end is neither running nor next', () => {
    const ev = timed('Open house', at(8), null)
    assert.equal(headlineFor({ now: at(9), events: [ev] }).kind, 'daypart')
  })

  test('an all-day event today: "Today: <title>", until null', () => {
    const ev = allDay('PJ and Stuffy day', '2026-09-24', '2026-09-25')
    assert.deepEqual(headlineFor({ now: at(9), events: [ev] }), {
      text: 'Today: PJ and Stuffy day',
      kind: 'today',
      eventId: ev.id,
      until: null,
    })
  })

  test('all-day coverage: the end date is exclusive, a missing end means one day', () => {
    const span = allDay('Sheena in Chicago', '2026-09-23', '2026-09-25')
    const endsToday = allDay('Over', '2026-09-22', '2026-09-24')
    const single = allDay('Picture day', '2026-09-24', null)
    assert.equal(headlineFor({ now: at(9), events: [span] }).text, 'Today: Sheena in Chicago')
    assert.equal(headlineFor({ now: at(9), events: [endsToday] }).kind, 'daypart')
    assert.equal(headlineFor({ now: at(9), events: [single] }).text, 'Today: Picture day')
  })

  test('a timed event today beats an all-day event today', () => {
    const day = allDay('PJ and Stuffy day', '2026-09-24', '2026-09-25')
    const ev = timed('Vinny soccer', at(17), at(18))
    assert.equal(headlineFor({ now: at(9), events: [day, ev] }).kind, 'next')
  })

  test('after 6 pm, tomorrow: all-day first, else the first timed event with its time', () => {
    const trip = allDay('Sheena Chicago', '2026-09-25', '2026-09-26')
    const piano = timed('Piano', at(16, 0, 25), at(16, 45, 25))
    const early = timed('Dentist', at(10, 0, 25), at(11, 0, 25))
    assert.deepEqual(headlineFor({ now: at(18), events: [piano, trip] }), {
      text: 'Tomorrow: Sheena Chicago',
      kind: 'tomorrow',
      eventId: trip.id,
      until: null,
    })
    assert.equal(headlineFor({ now: at(19), events: [piano, early] }).text, 'Tomorrow: Dentist at 10:00 am')
  })

  test('the 6 pm boundary: 5:59 pm is still the day part', () => {
    const trip = allDay('Sheena Chicago', '2026-09-25', '2026-09-26')
    assert.equal(headlineFor({ now: at(17, 59), events: [trip] }).kind, 'daypart')
    assert.equal(headlineFor({ now: at(18), events: [trip] }).kind, 'tomorrow')
  })

  test('an all-day event today still beats tomorrow in the evening', () => {
    const today = allDay('PJ and Stuffy day', '2026-09-24', '2026-09-25')
    const trip = allDay('Sheena Chicago', '2026-09-25', '2026-09-26')
    assert.equal(headlineFor({ now: at(20), events: [trip, today] }).kind, 'today')
  })

  test('day parts, with their boundaries', () => {
    const cases = [
      [0, 0, "You're up late. Go to bed."],
      [4, 59, "You're up late. Go to bed."],
      [5, 0, 'Good morning, everybody.'],
      [10, 59, 'Good morning, everybody.'],
      [11, 0, 'Good afternoon.'],
      [16, 59, 'Good afternoon.'],
      [17, 0, 'Good evening.'],
      [20, 59, 'Good evening.'],
      [21, 0, 'Good night.'],
      [23, 59, 'Good night.'],
    ]
    for (const [h, m, text] of cases) {
      assert.equal(dayPartLine(at(h, m)), text, `${h}:${m}`)
      assert.deepEqual(headlineFor({ now: at(h, m), events: [] }), { text, kind: 'daypart', eventId: null, until: null })
    }
  })

  test('junk input degrades to the day part', () => {
    assert.equal(headlineFor({ now: at(9), events: null }).kind, 'daypart')
    assert.equal(headlineFor({ now: at(9), events: 'nope' }).kind, 'daypart')
    assert.equal(headlineFor({ now: at(9), events: [null, {}, { start: 'garbage' }] }).kind, 'daypart')
    assert.equal(typeof headlineFor().text, 'string')
  })
})

// --- phase 1.5: the weather lines interleaved (lib/weatherRules.mjs) ----------------

function stampOf(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`
}

// 48 dry, mild hours from midnight on the 24th; `wet` lists local hours of the
// 24th with rain, `daily` today's high.
function forecast({ wet = [], highF = 70 } = {}) {
  const hourly = []
  for (let i = 0; i < 48; i++) {
    const t = new Date(2026, 8, 24, i)
    const rain = t.getDate() === 24 && wet.includes(t.getHours())
    hourly.push({
      time: stampOf(t),
      tempF: 55,
      feelsF: 55,
      precipProb: rain ? 80 : 0,
      precipIn: rain ? 0.05 : 0,
      code: rain ? 61 : 3,
      gustMph: 5,
      windMph: 3,
    })
  }
  return { fetchedAt: iso(at(0)), error: null, hourly, daily: [{ date: '2026-09-24', highF, lowF: 50, precipProbMax: 80, code: 61 }] }
}

const alert = (event, severity, onset, ends) => ({
  id: `alert-${event}`,
  event,
  severity,
  urgency: 'Expected',
  certainty: 'Likely',
  headline: `${event} issued`,
  description: null,
  onset: iso(onset),
  ends: iso(ends),
  messageType: 'Alert',
  senderName: 'NWS Seattle WA',
})

const warning = alert('High Wind Warning', 'Severe', at(6), at(22))
const advisory = alert('Wind Advisory', 'Moderate', at(6), at(20))

describe('headline: weather lines interleaved with the calendar', () => {
  test('tier A (a warning) outranks even a running event', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    assert.deepEqual(headlineFor({ now: at(17, 20), events: [ev], alerts: [warning] }), {
      text: 'High Wind Warning until 10 pm',
      kind: 'alert',
      eventId: null,
      until: iso(at(22)),
    })
  })

  test('a running event outranks tier B', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(17, 20), events: [ev], forecast: forecast({ wet: [17, 18] }), alerts: [advisory] })
    assert.equal(h.text, 'Vinny soccer now')
  })

  test('an event inside the hour outranks tier B', () => {
    const ev = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(16, 20), events: [ev], forecast: forecast({ wet: [16] }) })
    assert.equal(h.text, 'Vinny soccer in 40 min')
  })

  test('tier B outranks the next event later today; until is the earlier of the two changes', () => {
    const soccer = timed('Vinny soccer', at(17), at(18, 15))
    assert.deepEqual(headlineFor({ now: at(9), events: [soccer], forecast: forecast({ wet: [15] }) }), {
      text: 'Rain from 3 pm',
      kind: 'weather',
      eventId: null,
      until: iso(at(14)), // "within the hour" at 2 pm comes before soccer's 4 pm
    })
    const piano = timed('Piano', at(13, 30), at(14))
    const h = headlineFor({ now: at(9), events: [piano], forecast: forecast({ wet: [15] }) })
    assert.equal(h.text, 'Rain from 3 pm')
    assert.equal(h.until, iso(at(12, 30))) // piano comes inside the hour first
  })

  test('an advisory is tier B: kind alert, above the next event, below a running one', () => {
    const soccer = timed('Vinny soccer', at(17), at(18, 15))
    const h = headlineFor({ now: at(9), events: [soccer], alerts: [advisory] })
    assert.deepEqual(h, { text: 'Wind Advisory until 8 pm', kind: 'alert', eventId: null, until: iso(at(16)) })
    assert.equal(headlineFor({ now: at(17, 5), events: [soccer], alerts: [advisory] }).text, 'Vinny soccer now')
  })

  test('the advisory outranks the rain line; rain outranks the heat line', () => {
    const fc = forecast({ wet: [15], highF: 95 })
    assert.equal(headlineFor({ now: at(9), forecast: fc, alerts: [advisory] }).text, 'Wind Advisory until 8 pm')
    assert.equal(headlineFor({ now: at(9), forecast: fc }).text, 'Rain from 3 pm')
    assert.equal(headlineFor({ now: at(9), forecast: forecast({ highF: 95 }) }).text, 'Hot one today, high of 95')
  })

  test('tier B outranks all-day today, tomorrow and the day part', () => {
    const today = allDay('PJ and Stuffy day', '2026-09-24', '2026-09-25')
    const trip = allDay('Sheena Chicago', '2026-09-25', '2026-09-26')
    const fc = forecast({ wet: [19] })
    assert.equal(headlineFor({ now: at(9), events: [today], forecast: fc }).text, 'Rain from 7 pm')
    assert.equal(headlineFor({ now: at(18), events: [trip], forecast: fc }).text, 'Rain within the hour')
    assert.equal(headlineFor({ now: at(12), forecast: fc }).kind, 'weather')
  })

  test('once the weather has nothing to say (9 pm) the calendar is back', () => {
    const trip = allDay('Sheena Chicago', '2026-09-25', '2026-09-26')
    const h = headlineFor({ now: at(21), events: [trip], forecast: forecast({ wet: [20, 21, 22] }) })
    assert.equal(h.text, 'Tomorrow: Sheena Chicago')
  })

  test('a forecast with nothing to say, or empty alerts, leaves every phase 1 line as it was', () => {
    const events = [
      allDay('PJ and Stuffy day', '2026-09-24', '2026-09-25'),
      timed('Chase dentist', at(8, 15), at(9)),
      timed('Vinny soccer', at(17), at(18, 15)),
      allDay('Sheena Chicago', '2026-09-25', '2026-09-26'),
    ]
    const quiet = forecast()
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 20, 45]) {
        const now = at(h, m)
        assert.deepEqual(headlineFor({ now, events, forecast: quiet, alerts: [] }), headlineFor({ now, events }), `${h}:${m}`)
      }
    }
  })

  test('units reach the rules', () => {
    const h = headlineFor({ now: at(9), forecast: forecast({ highF: 95 }), units: 'metric' })
    assert.equal(h.text, 'Hot one today, high of 35')
  })

  test('the real Open-Meteo response for the house, 7 am on the 25th: "Rain from 10 am"', () => {
    const snap = parseForecast(fixture('open-meteo-forecast.json'), at(23, 32))
    assert.deepEqual(headlineFor({ now: at(7, 0, 25), events: [], forecast: snap }), {
      text: 'Rain from 10 am',
      kind: 'weather',
      eventId: null,
      until: iso(at(9, 0, 25)),
    })
  })

  test('the hand-written NWS fixture, Thursday 3 pm: the Winter Storm Warning', () => {
    const now = new Date(2026, 11, 17, 15)
    const soccer = timed('Vinny soccer', new Date(2026, 11, 17, 15), new Date(2026, 11, 17, 16))
    const h = headlineFor({ now, events: [soccer], alerts: parseAlerts(fixture('nws-winter-storm.json'), now) })
    assert.deepEqual(h, {
      text: 'Winter Storm Warning through Sat 6 am',
      kind: 'alert',
      eventId: null,
      until: iso(new Date(2026, 11, 19, 6)),
    })
  })
})
