// Tests for hooks/hubWeatherFeed.js: the hub's weather feed as the weather
// hooks read it, held against the direct Open-Meteo fetch it replaces. The
// alignment cases run the hub's own Open-Meteo parser over the hub's recorded
// response for the house (frameserver/test/fixtures/weather, fetched
// 2026-09-26 15:14 PDT with a day of past hours), so the feed and the old
// fetch see one and the same weather, and the feed's hours start at local
// midnight as the hub now serves them.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseOpenMeteoWeather } from '../../../frameserver/lib/openMeteoWeather.mjs'
import { normalizeWeatherKit } from '../../../frameserver/lib/weatherKit.mjs'
import { synodicPhase } from '../components/MoonGlyph/moonGeometry.js'
import { moonPhase as sunMoonPhase } from '../views/TodayLayouts/lib/sun.js'
import {
  APPLE_ATTRIBUTION,
  FEED_MAX_AGE_MS,
  cleanFeed,
  dailySnapshotFromFeed,
  dailySnapshotFromOpenMeteo,
  entryAt,
  feedFresh,
  forecastFromColumns,
  forecastFromHours,
  hasFeedData,
  hourKeyOf,
  hourStamp,
  isDayAt,
  moonPhaseFor,
  openMeteoColumnsOf,
  parseLocalStamp,
  pickSlots,
  skyFor,
  slotsFromHours,
} from './hubWeatherFeed.js'

const FIXTURES = fileURLToPath(new URL('../../../frameserver/test/fixtures/weather/', import.meta.url))
const raw = JSON.parse(readFileSync(`${FIXTURES}open-meteo-house.json`, 'utf8'))

// The feed the hub would serve from that response.
function omFeed(payload = raw, fetchedAt = '2026-09-26T18:31:00.000Z') {
  const { timezone, ...snap } = parseOpenMeteoWeather(payload)
  return cleanFeed({ source: 'open-meteo', fetchedAt, error: null, location: { lat: 47.66, lon: -122.4, timezone }, ...snap })
}

const DAY = raw.current.time.slice(0, 10) // '2026-09-26', the day the response was fetched on

test('cleanFeed: every key present, typed; junk is null', () => {
  assert.equal(cleanFeed(null), null)
  assert.equal(cleanFeed([]), null)
  const f = cleanFeed({ source: 'nope', hourly: [{ time: 'x' }, { time: '2026-09-26T10:00', tempF: 50 }], alerts: [{ event: '' }, { event: 'Wind Advisory' }] })
  assert.equal(f.source, null)
  // The hour as sent, with its sky filled in: no sunrise known, so 10 am is
  // day by the 6-to-8 rule; no moon known, so it is worked out.
  assert.deepEqual(f.hourly, [
    { time: '2026-09-26T10:00', tempF: 50, isDay: true, moonPhase: synodicPhase(new Date(2026, 8, 26, 10)) },
  ])
  assert.deepEqual(f.alerts, [{ event: 'Wind Advisory' }])
  assert.deepEqual(f.daily, [])
  assert.equal(f.current, null)
  assert.equal(f.nextHour, null)
  assert.deepEqual(f.sun, { sunrise: null, sunset: null })
  assert.equal(f.attribution, null)
})

test('cleanFeed: a WeatherKit feed always carries the Apple attribution; Open-Meteo never', () => {
  assert.deepEqual(cleanFeed({ source: 'weatherkit' }).attribution, APPLE_ATTRIBUTION)
  assert.deepEqual(
    cleanFeed({ source: 'weatherkit', attribution: { name: 'Apple Weather', url: 'https://example.test/legal' } }).attribution,
    { name: 'Apple Weather', url: 'https://example.test/legal' }
  )
  assert.equal(cleanFeed({ source: 'open-meteo', attribution: APPLE_ATTRIBUTION }).attribution, null)
})

test('feedFresh: data up to 90 minutes old; none, empty or older is not', () => {
  const f = omFeed()
  const t = Date.parse(f.fetchedAt)
  assert.ok(hasFeedData(f))
  assert.equal(feedFresh(f, t), true)
  assert.equal(feedFresh(f, t + FEED_MAX_AGE_MS), true)
  assert.equal(feedFresh(f, t + FEED_MAX_AGE_MS + 1), false)
  assert.equal(feedFresh(f, t - 5 * 60_000), true) // the hub's clock a little ahead
  assert.equal(feedFresh(null, t), false)
  assert.equal(feedFresh(cleanFeed({ source: 'open-meteo', fetchedAt: f.fetchedAt }), t), false)
  assert.equal(feedFresh(cleanFeed({ ...f, fetchedAt: null }), t), false)
})

test('alignment: the same Open-Meteo weather through the feed, hour by hour', () => {
  const feed = omFeed()
  const hours = feed.hourly
  // The feed starts at today's local midnight, 15 hours before the fetch.
  assert.equal(hours[0].time, `${DAY}T00:00`)
  assert.equal(hours.length, 15 + 48)
  let compared = 0
  for (let i = 0; i + 1 < raw.hourly.time.length; i++) {
    const stamp = raw.hourly.time[i]
    if (!hours.some((h) => h.time === stamp)) continue
    const day = stamp.slice(0, 10)
    const hour = Number(stamp.slice(11, 13))
    const viaFeed = forecastFromHours(hours, day, hour)
    const direct = forecastFromColumns(raw.hourly, day, hour)
    // The temperature is the reading at H:00 in both.
    assert.equal(viaFeed.tempF, direct.tempF, `${stamp} temperature`)
    // The code: the feed's hour H is the hour STARTING at H, which Open-Meteo
    // stamps at H+1 (its code covers the hour before its stamp). So the
    // feed's H is the direct fetch's H+1, not its H.
    const next = raw.hourly.time[i + 1]
    const directNext = forecastFromColumns(raw.hourly, next.slice(0, 10), Number(next.slice(11, 13)))
    assert.equal(viaFeed.code, directNext.code, `${stamp} code`)
    compared += 1
  }
  assert.equal(compared, 63)
})

test('alignment: the Framed Today slots, this morning\'s included, read the hour starting at H', () => {
  // A fresh load in the afternoon: the feed alone has 8 and 11 am.
  const feed = omFeed()
  const HOURS = [8, 11, 14, 17, 20]
  const slots = slotsFromHours(feed.hourly, HOURS, DAY)
  const direct = pickSlots(raw, HOURS, DAY)
  slots.forEach((s, i) => {
    assert.equal(s.label, direct[i].label)
    assert.equal(typeof s.tempF, 'number', s.label)
    assert.equal(s.tempF, direct[i].tempF, s.label)
  })
  // The departure-hour lookup, this morning and tomorrow's.
  assert.equal(forecastFromHours(feed.hourly, DAY, 7).tempF, forecastFromColumns(raw.hourly, DAY, 7).tempF)
  assert.equal(forecastFromHours(feed.hourly, '2026-09-27', 7).tempF, forecastFromColumns(raw.hourly, '2026-09-27', 7).tempF)
  // An hour the feed does not carry is a placeholder, as it always was.
  assert.deepEqual(slotsFromHours(feed.hourly, [3], '2026-09-25'), [{ label: '3AM', iconName: 'overcast', tempF: null }])
  assert.equal(forecastFromHours(feed.hourly, '2026-09-25', 3), null)
  // The hook's `hourly` keeps Open-Meteo's column shape.
  const cols = openMeteoColumnsOf(feed.hourly)
  assert.deepEqual(Object.keys(cols), ['time', 'temperature_2m', 'weather_code'])
  assert.equal(cols.time.length, 63)
  assert.equal(forecastFromColumns(cols, DAY, 14).tempF, forecastFromHours(feed.hourly, DAY, 14).tempF)
})

test('alignment: the daily snapshot is the same from either source of one weather', () => {
  const feed = omFeed()
  assert.deepEqual(dailySnapshotFromFeed(feed), dailySnapshotFromOpenMeteo(raw))
  const snap = dailySnapshotFromFeed(feed)
  assert.equal(snap.days.length, 7)
  assert.equal(snap.days[0].dateIso, DAY)
  assert.equal(snap.current.tempF, Math.round(raw.current.temperature_2m))
})

test('stamps: hour keys, local parsing, a bare date is local midnight', () => {
  assert.equal(hourStamp('2026-09-26', 7), '2026-09-26T07:00')
  assert.equal(hourKeyOf('2026-09-26T07:34'), '2026-09-26T07')
  assert.equal(hourKeyOf('7:00'), null)
  const d = parseLocalStamp('2026-09-26')
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 8, 26, 0])
  const s = parseLocalStamp('2026-09-26T07:02')
  assert.deepEqual([s.getHours(), s.getMinutes()], [7, 2])
  assert.equal(parseLocalStamp(''), null)
})

// --- Day, night and the moon ---------------------------------------------------------
//
// The WeatherKit fixture is a real response for the house (2026-09-26, the
// night of a full moon), normalised as the hub does, stamps in the house's
// zone whatever this machine's.
const wkRaw = JSON.parse(readFileSync(`${FIXTURES}weatherkit-house.json`, 'utf8'))

function wkFeed() {
  const snap = normalizeWeatherKit(wkRaw, { timezone: 'America/Los_Angeles', now: new Date('2026-09-26T18:42:00Z') })
  return cleanFeed({ source: 'weatherkit', fetchedAt: '2026-09-26T18:42:00.000Z', error: null, location: {}, ...snap })
}

test('night: isDayAt is that date\'s sunrise to sunset, judged at the hour\'s start', () => {
  const w = { daily: [{ date: '2026-09-28', sunrise: '2026-09-28T07:04', sunset: '2026-09-28T18:54' }] }
  assert.equal(isDayAt('2026-09-28T07:00', w), false) // the hour starting before sunrise
  assert.equal(isDayAt('2026-09-28T07:04', w), true) // the sunrise minute is day
  assert.equal(isDayAt('2026-09-28T08:00', w), true)
  assert.equal(isDayAt('2026-09-28T18:00', w), true)
  assert.equal(isDayAt('2026-09-28T18:54', w), false) // the sunset minute is night
  assert.equal(isDayAt('2026-09-28T20:00', w), false)
  assert.equal(isDayAt('2026-09-28T20:00:59', w), false) // seconds dropped
  // A Date or a ms epoch reads as its local wall clock.
  assert.equal(isDayAt(new Date(2026, 8, 28, 12, 30), w), true)
  assert.equal(isDayAt(new Date(2026, 8, 28, 23).getTime(), w), false)
  // The layouts' days (Dates) and the feed's sun (today's) serve as well.
  const days = { days: [{ dateKey: '2026-09-28', sunrise: new Date(2026, 8, 28, 7, 4), sunset: new Date(2026, 8, 28, 18, 54) }] }
  assert.equal(isDayAt('2026-09-28T19:00', days), false)
  assert.equal(isDayAt('2026-09-28T07:30', days), true)
  const sun = { sun: { sunrise: '2026-09-28T07:04', sunset: '2026-09-28T18:54' } }
  assert.equal(isDayAt('2026-09-28T19:30', sun), false)
  // Another date's times are not this date's: 6 am to 8 pm instead.
  assert.equal(isDayAt('2026-09-29T19:30', w), true)
  assert.equal(isDayAt('2026-09-29T20:00', w), false)
  assert.equal(isDayAt('2026-09-29T05:59', null), false)
  assert.equal(isDayAt('2026-09-29T06:00', undefined), true)
  // Nothing to read.
  assert.equal(isDayAt('2026-09-29', w), null)
  assert.equal(isDayAt('7 pm', w), null)
  assert.equal(isDayAt(null, w), null)
  assert.equal(isDayAt(new Date('nope'), w), null)
})

test('night: isDayAt agrees with Apple\'s daylight on every hour of the house\'s day', () => {
  const snap = normalizeWeatherKit(wkRaw, { timezone: 'America/Los_Angeles', now: new Date('2026-09-26T18:42:00Z') })
  assert.ok(snap.hourly.length > 48)
  for (const h of snap.hourly) assert.equal(isDayAt(h.time, snap), h.isDay, h.time)
})

test('night: moonPhaseFor is the exact mean phase at the instant, whatever the feed says', () => {
  const w = { daily: [{ date: '2026-09-28', moonPhase: 0.625 }], moon: { phase: 0.6, name: 'Waning Gibbous' } }
  assert.equal(moonPhaseFor('2026-09-28T23:00', w), synodicPhase(new Date(2026, 8, 28, 23)))
  assert.equal(moonPhaseFor('2026-09-28T23:00', null), synodicPhase(new Date(2026, 8, 28, 23)))
  assert.equal(moonPhaseFor('2026-09-28', w), synodicPhase(new Date(2026, 8, 28, 12)))
  assert.equal(moonPhaseFor(new Date(2026, 9, 3, 21), w), synodicPhase(new Date(2026, 9, 3, 21)))
  assert.equal(moonPhaseFor(Date.UTC(2024, 3, 8, 18, 21), {}), synodicPhase(Date.UTC(2024, 3, 8, 18, 21)))
  assert.equal(moonPhaseFor('tonight', null), null)
  assert.equal(moonPhaseFor(undefined, null), null)
  // The Sun and moon panel's model (lib/sun.js), so the two moons agree.
  const at = new Date(2026, 8, 28, 23)
  assert.ok(Math.abs(moonPhaseFor('2026-09-28T23:00') - sunMoonPhase(at).phase) < 1e-12)
})

test('night: cleanFeed gives every hour and the current reading its day and its moon', () => {
  const feed = wkFeed()
  for (const h of feed.hourly) {
    assert.equal(typeof h.isDay, 'boolean', h.time)
    assert.equal(h.moonPhase, moonPhaseFor(h.time), h.time)
  }
  // Tonight: night from 7 pm, the moon exact at the hour.
  assert.equal(entryAt(feed.hourly, '2026-09-26', 21).isDay, false)
  assert.equal(entryAt(feed.hourly, '2026-09-26', 21).moonPhase, synodicPhase(new Date(2026, 8, 26, 21)))
  assert.equal(entryAt(feed.hourly, '2026-09-27', 22).moonPhase, synodicPhase(new Date(2026, 8, 27, 22)))
  assert.equal(feed.current.isDay, true)
  assert.equal(feed.current.moonPhase, moonPhaseFor(feed.current.time))
  // The Open-Meteo feed: the same exact phase.
  const om = omFeed()
  assert.ok(om.hourly.every((h) => typeof h.isDay === 'boolean' && typeof h.moonPhase === 'number'))
  assert.equal(entryAt(om.hourly, DAY, 20).isDay, false)
  assert.equal(entryAt(om.hourly, DAY, 20).moonPhase, moonPhaseFor(entryAt(om.hourly, DAY, 20).time))
  // Idempotent, and an entry that had both is passed on as it came.
  assert.deepEqual(cleanFeed(JSON.parse(JSON.stringify(feed))), feed)
  const again = cleanFeed(feed)
  assert.equal(again.hourly[5], feed.hourly[5])
  assert.equal(again.current, feed.current)
})

test('night: an hour without the source\'s isDay is judged by its date\'s sunrise and sunset', () => {
  const f = cleanFeed({
    source: 'open-meteo',
    hourly: [
      { time: '2026-09-28T18:00', code: 0, isDay: null },
      { time: '2026-09-28T19:00', code: 0 },
      { time: '2026-09-28T21:00', code: 0, isDay: true }, // the source's word stands
    ],
    daily: [{ date: '2026-09-28', sunrise: '2026-09-28T07:04', sunset: '2026-09-28T18:54', moonPhase: 0.625 }],
    current: { time: '2026-09-28T23:00', code: 0 },
    moon: { phase: 0.625 },
  })
  assert.deepEqual(f.hourly.map((h) => h.isDay), [true, false, true])
  assert.deepEqual(f.hourly.map((h) => h.moonPhase), f.hourly.map((h) => moonPhaseFor(h.time)))
  assert.equal(f.current.isDay, false)
  assert.equal(f.current.moonPhase, synodicPhase(new Date(2026, 8, 28, 23)))
  // A current reading with no stamp is passed on as it came.
  const bare = { tempF: 50 }
  assert.equal(cleanFeed({ current: bare }).current, bare)
})

test('night: the Framed Today\'s slots carry their own hour\'s sky', () => {
  const feed = wkFeed()
  const slots = slotsFromHours(feed.hourly, [8, 11, 14, 17, 20], '2026-09-26', feed)
  assert.deepEqual(slots.map((s) => s.isDay), [true, true, true, true, false])
  assert.deepEqual(slots.map((s) => s.moonPhase), [8, 11, 14, 17, 20].map((h) => synodicPhase(new Date(2026, 8, 26, h))))
  assert.deepEqual(slots.map((s) => s.code), [3, 0, 3, 3, 3])
  // iconName is still the day icon; the night version is WeatherIcon's call.
  assert.equal(slots[1].iconName, 'clear')
  // The fallback: Open-Meteo's is_day at the hour's start, the moon worked out.
  const direct = pickSlots(raw, [8, 20], DAY)
  assert.deepEqual(direct.map((s) => s.isDay), [true, false])
  assert.equal(direct[1].moonPhase, synodicPhase(new Date(2026, 8, 26, 20)))
  assert.equal(typeof direct[1].code, 'number')
  // A payload asked for without is_day: 6 am to 8 pm.
  const noFlag = { hourly: { time: [`${DAY}T19:00`, `${DAY}T20:00`], temperature_2m: [60, 58], weather_code: [0, 0] } }
  assert.deepEqual(pickSlots(noFlag, [19, 20], DAY).map((s) => s.isDay), [true, false])
})

test('night: skyFor is the reading\'s own sky, else worked out for its time or for now', () => {
  assert.deepEqual(skyFor({ time: '2026-09-28T23:00', isDay: false, moonPhase: 0.625 }, null), { isDay: false, moonPhase: 0.625 })
  // Its own time: 11 pm is night by the 6-to-8 rule, and the moon is worked out.
  assert.deepEqual(skyFor({ time: '2026-09-28T23:00' }, new Date(2026, 8, 28, 12)), {
    isDay: false,
    moonPhase: synodicPhase(new Date(2026, 8, 28, 23)),
  })
  // No time of its own: now.
  const w = { daily: [{ date: '2026-09-28', sunrise: '2026-09-28T07:04', sunset: '2026-09-28T18:54', moonPhase: 0.625 }] }
  assert.deepEqual(skyFor({ code: 0 }, new Date(2026, 8, 28, 19, 30), w), { isDay: false, moonPhase: synodicPhase(new Date(2026, 8, 28, 19, 30)) })
  assert.deepEqual(skyFor({ code: 0, isDay: true }, new Date(2026, 8, 28, 19, 30), w), { isDay: true, moonPhase: synodicPhase(new Date(2026, 8, 28, 19, 30)) })
  // Nothing to go by: the day icon and the default moon.
  assert.deepEqual(skyFor({ code: 0 }, null), { isDay: undefined, moonPhase: undefined })
  assert.deepEqual(skyFor(null, undefined), { isDay: undefined, moonPhase: undefined })
})
