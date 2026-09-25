// airQuality.test.mjs - the house's air quality reading (US AQI labels).
//
// createAirQuality() is a stateful factory with real network/filesystem
// side effects (hourly Open-Meteo refresh, disk persistence); it is
// intentionally NOT exercised here. This covers the pure request builder,
// the label thresholds, and the payload parser.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aqiLabel, airQualityUrl, parseAirQuality } from '../lib/airQuality.mjs'

describe('aqiLabel', () => {
  it('follows the documented US AQI boundaries at 50/100/150/200/300', () => {
    assert.equal(aqiLabel(0), 'Good')
    assert.equal(aqiLabel(50), 'Good')
    assert.equal(aqiLabel(51), 'Moderate')
    assert.equal(aqiLabel(100), 'Moderate')
    assert.equal(aqiLabel(101), 'Unhealthy for sensitive groups')
    assert.equal(aqiLabel(150), 'Unhealthy for sensitive groups')
    assert.equal(aqiLabel(151), 'Unhealthy')
    assert.equal(aqiLabel(200), 'Unhealthy')
    assert.equal(aqiLabel(201), 'Very unhealthy')
    assert.equal(aqiLabel(300), 'Very unhealthy')
    assert.equal(aqiLabel(301), 'Hazardous')
    assert.equal(aqiLabel(500), 'Hazardous')
  })

  it('malformed input: non-numbers and NaN return null rather than a label', () => {
    assert.equal(aqiLabel(null), null)
    assert.equal(aqiLabel(undefined), null)
    assert.equal(aqiLabel('50'), null)
    assert.equal(aqiLabel(NaN), null)
  })
})

describe('airQualityUrl', () => {
  it('requests pm2_5 and us_aqi for the given coordinates', () => {
    const url = airQualityUrl({ lat: 47.6, lon: -122.3 })
    assert.equal(url.origin + url.pathname, 'https://air-quality-api.open-meteo.com/v1/air-quality')
    assert.equal(url.searchParams.get('latitude'), '47.6')
    assert.equal(url.searchParams.get('longitude'), '-122.3')
    assert.equal(url.searchParams.get('current'), 'pm2_5,us_aqi')
    assert.equal(url.searchParams.get('timezone'), 'auto')
  })
})

describe('parseAirQuality', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('rounds pm25 to one decimal and aqi to a whole number, with a derived label', () => {
    const reading = parseAirQuality({ current: { pm2_5: 12.34, us_aqi: 55.6 } }, now)
    assert.deepEqual(reading, { pm25: 12.3, aqi: 56, label: 'Moderate', fetchedAt: now.toISOString() })
  })

  it('tolerates a payload with only one of the two values', () => {
    assert.deepEqual(parseAirQuality({ current: { pm2_5: 12.34 } }, now), { pm25: 12.3, aqi: null, label: null, fetchedAt: now.toISOString() })
    assert.deepEqual(parseAirQuality({ current: { us_aqi: 55.6 } }, now), { pm25: null, aqi: 56, label: 'Moderate', fetchedAt: now.toISOString() })
  })

  it('throws when the payload has neither value', () => {
    assert.throws(() => parseAirQuality({ current: {} }, now), /no current pm2_5 \/ us_aqi/)
    assert.throws(() => parseAirQuality({}, now), /no current pm2_5 \/ us_aqi/)
  })
})
