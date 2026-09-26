// openMeteoWeather.test.mjs - lib/openMeteoWeather.mjs: Open-Meteo normalised
// to the hub's one weather contract (docs/designs/panels-and-controls.md).
// This is a SEPARATE, richer client from lib/hubWeather.mjs's own
// createHubWeather/parseForecast (DAYS=10 not 3, current conditions, snow,
// humidity, UV, a local moon phase); that module's own tests
// (weatherRules.test.mjs, headline.test.mjs) are untouched and keep pinning
// its narrower shape.
//
//   node --test frameserver/test/openMeteoWeather.test.mjs
//
// Fixtures: test/fixtures/weather/open-meteo-house.json, a real response for
// the house (lat 47.66, lon -122.40), fetched 2026-09-26 with this module's
// own parameter set (current/hourly/daily, forecast_days=10, forecast_hours=49).

process.env.TZ = 'America/Los_Angeles'

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_VARS,
  DAILY_VARS,
  DAYS,
  FORECAST_URL,
  HOURLY_VARS,
  HOURS,
  fetchOpenMeteoWeather,
  moonPhaseFraction,
  moonPhaseName,
  openMeteoWeatherUrl,
  parseOpenMeteoWeather,
} from '../lib/openMeteoWeather.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'weather')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

describe('openMeteoWeather: the request', () => {
  test('current, hourly and daily variable lists, imperial units, timezone=auto, 10 days, 49 hourly stamps', () => {
    const url = openMeteoWeatherUrl({ lat: 47.6610608, lon: -122.3999576 })
    const q = Object.fromEntries(url.searchParams)
    assert.equal(url.origin + url.pathname, FORECAST_URL)
    assert.deepEqual(q, {
      latitude: '47.6610608',
      longitude: '-122.3999576',
      current: CURRENT_VARS.join(','),
      hourly: HOURLY_VARS.join(','),
      daily: DAILY_VARS.join(','),
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      precipitation_unit: 'inch',
      timezone: 'auto',
      forecast_days: '10',
      forecast_hours: '49',
    })
    assert.equal(HOURS, 48)
    assert.equal(DAYS, 10)
  })

  test('fetchOpenMeteoWeather: a non-2xx throws with the upstream reason; single request', async () => {
    const seen = []
    await assert.rejects(
      fetchOpenMeteoWeather({ lat: 0, lon: 0 }, async (url, headers) => {
        seen.push({ url: String(url), headers })
        return { status: 502, body: JSON.stringify({ reason: 'Upstream down' }) }
      }),
      /Open-Meteo forecast HTTP 502: Upstream down/,
    )
    assert.equal(seen.length, 1)
    assert.match(seen[0].headers['User-Agent'], /KitchenSmartDisplay/)
  })
})

// A minimal but complete payload: 3 hourly stamps (so index 0 has a "next"
// stamp to borrow its preceding-hour columns from, per the shift), 2 daily
// entries, one current block. Distinct per-field values make the shift
// unmistakable.
function syntheticPayload({ visibility = 26400, visibilityUnit = 'ft' } = {}) {
  return {
    timezone: 'America/Los_Angeles',
    // null (not undefined - destructuring defaults would swallow that) means
    // "no current_units block at all", exercising the metres default.
    current_units: visibilityUnit == null ? {} : { visibility: visibilityUnit },
    current: {
      time: '2026-09-24T15:00',
      temperature_2m: 60, apparent_temperature: 58, relative_humidity_2m: 55,
      dew_point_2m: 45, wind_speed_10m: 5, wind_gusts_10m: 12, wind_direction_10m: 270,
      surface_pressure: 1013.2, visibility, uv_index: 4.4, cloud_cover: 30,
      weather_code: 2, is_day: 1, precipitation: 0.01,
    },
    hourly: {
      time: ['2026-09-24T15:00', '2026-09-24T16:00', '2026-09-24T17:00'],
      temperature_2m: [60, 62, 64],
      apparent_temperature: [58, 60, 62],
      precipitation_probability: [10, 20, 30],
      precipitation: [0.0, 0.05, 0.1],
      snowfall: [0.0, 0.0, 0.2],
      weather_code: [1, 61, 71],
      wind_speed_10m: [5, 6, 7],
      wind_gusts_10m: [10, 20, 30],
      relative_humidity_2m: [55, 50, 45],
      uv_index: [4.4, 5.1, 3.0],
      is_day: [1, 1, 0],
    },
    daily: {
      time: ['2026-09-24', '2026-09-25'],
      temperature_2m_max: [70, 72],
      temperature_2m_min: [50, 52],
      precipitation_probability_max: [20, 80],
      precipitation_sum: [0.1, 0.4],
      weather_code: [3, 61],
      sunrise: ['2026-09-24T06:59', '2026-09-25T07:00'],
      sunset: ['2026-09-24T19:02', '2026-09-25T19:00'],
      uv_index_max: [5.2, 4.8],
      wind_gusts_10m_max: [18.5, 40.2],
    },
  }
}

describe('openMeteoWeather: parseOpenMeteoWeather, a synthetic payload', () => {
  test('hour 0 keeps its own instant values but borrows hour 1\'s preceding-hour columns', () => {
    const out = parseOpenMeteoWeather(syntheticPayload())
    assert.deepEqual(out.hourly[0], {
      time: '2026-09-24T15:00',
      tempF: 60, feelsF: 58,      // this stamp's own
      precipProb: 20, precipIn: 0.05, snowIn: 0.0, code: 61, // hour 1's ("preceding hour")
      condition: null,
      windMph: 5,                 // this stamp's own
      gustMph: 20,                // hour 1's
      humidity: 55, uv: 4, isDay: true, // this stamp's own (instantaneous, not shifted)
    })
    // Only 2 usable hourly entries: 3 stamps means 2 with a "next" to borrow from.
    assert.equal(out.hourly.length, 2)
    assert.deepEqual(out.hourly[1], {
      time: '2026-09-24T16:00', tempF: 62, feelsF: 60,
      precipProb: 30, precipIn: 0.1, snowIn: 0.2, code: 71, condition: null,
      windMph: 6, gustMph: 30, humidity: 50, uv: 5, isDay: true,
    })
  })

  test('current: units converted (already Fahrenheit/mph/inch/mb from the request), visibility from its own reported unit', () => {
    const ft = parseOpenMeteoWeather(syntheticPayload({ visibility: 26400, visibilityUnit: 'ft' }))
    assert.deepEqual(ft.current, {
      time: '2026-09-24T15:00', tempF: 60, feelsF: 58, humidity: 55, dewF: 45,
      windMph: 5, gustMph: 12, windDir: 270, pressureMb: 1013.2,
      visibilityMi: 5, // 26400 ft / 5280
      uv: 4, cloudCover: 30, code: 2, condition: null, isDay: true, precipIn: 0.01,
    })
    const km = parseOpenMeteoWeather(syntheticPayload({ visibility: 16.09344, visibilityUnit: 'km' }))
    assert.equal(km.current.visibilityMi, 10) // 16.09344 km * 0.621371
    const mi = parseOpenMeteoWeather(syntheticPayload({ visibility: 7, visibilityUnit: 'mi' }))
    assert.equal(mi.current.visibilityMi, 7)
    const metresDefault = parseOpenMeteoWeather(syntheticPayload({ visibility: 1609.344, visibilityUnit: null }))
    assert.equal(metresDefault.current.visibilityMi, 1) // metres is the documented default
  })

  test('daily: passthrough fields, condition null (Open-Meteo has no text), a moon phase per day', () => {
    const out = parseOpenMeteoWeather(syntheticPayload())
    assert.equal(out.daily.length, 2)
    assert.deepEqual(out.daily[0], {
      date: '2026-09-24', highF: 70, lowF: 50, precipProbMax: 20, precipIn: 0.1,
      code: 3, condition: null, sunrise: '2026-09-24T06:59', sunset: '2026-09-24T19:02',
      uvMax: 5, windMaxMph: 18.5, moonPhase: out.daily[0].moonPhase,
    })
    assert.ok(out.daily[0].moonPhase >= 0 && out.daily[0].moonPhase < 1)
    assert.deepEqual(out.sun, { sunrise: '2026-09-24T06:59', sunset: '2026-09-24T19:02' })
    assert.deepEqual(out.moon, { phase: out.daily[0].moonPhase, name: moonPhaseName(out.daily[0].moonPhase) })
  })

  test('the resolved timezone rides along (dropped by lib/weather.mjs before caching/serving)', () => {
    assert.equal(parseOpenMeteoWeather(syntheticPayload()).timezone, 'America/Los_Angeles')
    assert.equal(parseOpenMeteoWeather({ ...syntheticPayload(), timezone: 'auto' }).timezone, null)
    assert.equal(parseOpenMeteoWeather({ ...syntheticPayload(), timezone: undefined }).timezone, null)
  })

  test('nextHour is always null and alerts always [] - WeatherKit-only and merged elsewhere', () => {
    const out = parseOpenMeteoWeather(syntheticPayload())
    assert.equal(out.nextHour, null)
    assert.deepEqual(out.alerts, [])
    assert.equal(out.attribution, null)
  })

  test('no hourly data throws; a missing current block is null, not a crash', () => {
    assert.throws(() => parseOpenMeteoWeather({ daily: {} }), /no hourly data/)
    assert.throws(() => parseOpenMeteoWeather({ hourly: { time: ['2026-09-24T15:00'] } }), /no hourly data/)
    const p = syntheticPayload()
    delete p.current
    assert.equal(parseOpenMeteoWeather(p).current, null)
  })
})

describe('openMeteoWeather: parseOpenMeteoWeather, the real house response', () => {
  const payload = fixture('open-meteo-house.json')

  test('48 hours, 10 days, current present, resolved timezone', () => {
    const out = parseOpenMeteoWeather(payload)
    assert.equal(out.hourly.length, 48)
    assert.equal(out.daily.length, 10)
    assert.equal(out.timezone, 'America/Los_Angeles')
    assert.ok(out.current)
    assert.ok(out.current.tempF > 20 && out.current.tempF < 100)
    assert.equal(out.current.condition, null)
    // Every hourly and daily entry's WMO code is a plain number, ready for the
    // app's existing icon mapping (code/src/hooks/useWeather.js wmoToIcon()).
    for (const h of out.hourly) assert.equal(typeof h.code, 'number')
    for (const d of out.daily) assert.equal(typeof d.code, 'number')
  })

  test('the real day (2026-09-26) independently lands in the Full Moon bucket, matching WeatherKit\'s own report for the same day (weatherKit.test.mjs)', () => {
    const out = parseOpenMeteoWeather(payload)
    const today = out.daily.find((d) => d.date === '2026-09-26')
    assert.ok(today)
    assert.equal(moonPhaseName(today.moonPhase), 'Full Moon')
  })
})

describe('openMeteoWeather: moon phase math', () => {
  test('the reference new moon is phase 0', () => {
    assert.equal(moonPhaseFraction(new Date('2000-01-06T18:14:00Z')), 0)
  })

  test('always wraps into [0, 1)', () => {
    for (const iso of ['1999-01-01T00:00:00Z', '2000-01-06T18:14:00Z', '2026-09-26T12:00:00Z', '2050-12-31T23:59:00Z']) {
      const f = moonPhaseFraction(new Date(iso))
      assert.ok(f >= 0 && f < 1, iso)
    }
  })

  test('an invalid date is null', () => {
    assert.equal(moonPhaseFraction(new Date('garbage')), null)
    assert.equal(moonPhaseFraction('not a date'), null)
  })

  test('moonPhaseName buckets the 8 named phases at their midpoints', () => {
    assert.equal(moonPhaseName(0), 'New Moon')
    assert.equal(moonPhaseName(0.03), 'New Moon')
    assert.equal(moonPhaseName(0.125), 'Waxing Crescent')
    assert.equal(moonPhaseName(0.25), 'First Quarter')
    assert.equal(moonPhaseName(0.375), 'Waxing Gibbous')
    assert.equal(moonPhaseName(0.5), 'Full Moon')
    assert.equal(moonPhaseName(0.625), 'Waning Gibbous')
    assert.equal(moonPhaseName(0.75), 'Last Quarter')
    assert.equal(moonPhaseName(0.875), 'Waning Crescent')
    assert.equal(moonPhaseName(0.97), 'New Moon')
    assert.equal(moonPhaseName(NaN), null)
    assert.equal(moonPhaseName(null), null)
  })

  test('each bucket is a half-open [low, high) span, wrapping at 0/1', () => {
    // Each boundary value itself belongs to the NEXT bucket, not the one it
    // closes (an arbitrary but fixed tie-break; there is no meaningful
    // astronomical difference at this resolution).
    assert.equal(moonPhaseName(0.0625), 'Waxing Crescent')
    assert.equal(moonPhaseName(0.062499), 'New Moon')
    assert.equal(moonPhaseName(0.9375), 'New Moon') // the last boundary wraps back to New
    assert.equal(moonPhaseName(0.937499), 'Waning Crescent')
    assert.equal(moonPhaseName(0.9999), 'New Moon')
    assert.equal(moonPhaseName(1), 'New Moon') // wraps: 1 % 1 === 0
    assert.equal(moonPhaseName(-0.0625), 'New Moon') // wraps the other way to 0.9375
  })
})
