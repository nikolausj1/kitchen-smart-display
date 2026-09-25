// travelDefault.test.mjs - the hub's walk-or-drive default for the morning.
//
// createTravelDefault() is a stateful factory with real network/filesystem
// side effects (Open-Meteo fetch, disk persistence, a midnight-aware
// scheduler); it is intentionally NOT exercised here. This covers the pure
// request builder and the hourly-forecast lookup it is built on
// (decideTravelMode itself is countdown.mjs's, tested there).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { openMeteoUrl, forecastAt } from '../lib/travelDefault.mjs'

describe('openMeteoUrl', () => {
  it('requests hourly temperature and weather code, Fahrenheit, 2 days', () => {
    const url = openMeteoUrl({ lat: 47.6, lon: -122.3, timezone: 'America/Los_Angeles' })
    assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast')
    assert.equal(url.searchParams.get('latitude'), '47.6')
    assert.equal(url.searchParams.get('longitude'), '-122.3')
    assert.equal(url.searchParams.get('hourly'), 'temperature_2m,weather_code')
    assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit')
    assert.equal(url.searchParams.get('timezone'), 'America/Los_Angeles')
    assert.equal(url.searchParams.get('forecast_days'), '2')
  })

  it('defaults the timezone to "auto" when the location has none', () => {
    const url = openMeteoUrl({ lat: 47.6, lon: -122.3 })
    assert.equal(url.searchParams.get('timezone'), 'auto')
  })
})

describe('forecastAt', () => {
  const payload = {
    hourly: {
      time: ['2026-09-24T06:00', '2026-09-24T07:00', '2026-09-24T08:00'],
      weather_code: [3, 61, 0],
      temperature_2m: [50.2, 49.8, 51.9],
    },
  }

  it('finds the hour and rounds the temperature', () => {
    assert.deepEqual(forecastAt(payload, '2026-09-24', 7), { hour: 7, code: 61, tempF: 50 })
  })

  it('returns null when the hour is not in the payload', () => {
    assert.equal(forecastAt(payload, '2026-09-24', 23), null)
  })

  it('malformed input: no hourly array, or a null payload, returns null rather than throwing', () => {
    assert.equal(forecastAt({}, '2026-09-24', 7), null)
    assert.equal(forecastAt(null, '2026-09-24', 7), null)
  })

  it('malformed input: non-number code/temperature fall back to null fields', () => {
    const bad = { hourly: { time: ['2026-09-24T07:00'], weather_code: ['61'], temperature_2m: ['49.8'] } }
    assert.deepEqual(forecastAt(bad, '2026-09-24', 7), { hour: 7, code: null, tempF: null })
  })
})
