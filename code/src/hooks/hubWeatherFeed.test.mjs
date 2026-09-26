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
  openMeteoColumnsOf,
  parseLocalStamp,
  pickSlots,
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
  assert.deepEqual(f.hourly, [{ time: '2026-09-26T10:00', tempF: 50 }])
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
