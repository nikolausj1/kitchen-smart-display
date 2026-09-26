// weather.test.mjs - lib/weather.mjs: the hub's one weather feed, source
// selection (auto/pinned), automatic fallback, the disk cache, alert merging
// and brief() for /healthz. No network: requestWeatherKit/requestOpenMeteo are
// stubbed; weatherKitConfig and getNwsAlerts are injected.
//
//   node --test frameserver/test/weather.test.mjs

process.env.TZ = 'America/Los_Angeles'

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CACHE_FILE, MAX_AGE_MS, createWeather } from '../lib/weather.mjs'

// A throwaway generated key, so fetchWeatherKit's JWT signing (real ES256, not
// stubbed) succeeds in every scenario below - only the HTTP layer is mocked.
const THROWAWAY_KEY_PEM = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })

const HOUSE = { lat: 47.6610608, lon: -122.3999576, timezone: 'auto' }

// A minimal but valid Open-Meteo payload: 2 hourly stamps (1 usable entry
// after the shift), 1 daily, current present, a resolved timezone.
function omPayload({ timezone = 'America/Los_Angeles', tempF = 60 } = {}) {
  return {
    timezone,
    current_units: { visibility: 'ft' },
    current: {
      time: '2026-09-24T15:00', temperature_2m: tempF, apparent_temperature: tempF,
      relative_humidity_2m: 50, dew_point_2m: 40, wind_speed_10m: 5, wind_gusts_10m: 10,
      wind_direction_10m: 200, surface_pressure: 1013, visibility: 10000, uv_index: 3,
      cloud_cover: 20, weather_code: 1, is_day: 1, precipitation: 0,
    },
    hourly: {
      time: ['2026-09-24T15:00', '2026-09-24T16:00'],
      temperature_2m: [tempF, tempF + 1], apparent_temperature: [tempF, tempF + 1],
      precipitation_probability: [0, 0], precipitation: [0, 0], snowfall: [0, 0],
      weather_code: [1, 1], wind_speed_10m: [5, 5], wind_gusts_10m: [10, 10],
      relative_humidity_2m: [50, 50], uv_index: [3, 3], is_day: [1, 1],
    },
    daily: {
      time: ['2026-09-24'],
      temperature_2m_max: [70], temperature_2m_min: [50], precipitation_probability_max: [10],
      precipitation_sum: [0], weather_code: [1], sunrise: ['2026-09-24T07:00'], sunset: ['2026-09-24T19:00'],
      uv_index_max: [3], wind_gusts_10m_max: [10],
    },
  }
}

// A minimal but valid WeatherKit payload, timestamped around NOW (below) so
// the 48-hour window keeps its (few) hours. `alerts` adds a weatherAlerts block.
const NOW = new Date('2026-09-24T22:05:00Z')
function wkPayload({ tempC = 15, alerts = null } = {}) {
  const hour = (h, t) => ({
    forecastStart: h, cloudCover: 0.2, conditionCode: 'Clear', daylight: true, humidity: 0.5,
    precipitationAmount: 0, precipitationChance: 0, snowfallAmount: 0,
    temperature: t, temperatureApparent: t, uvIndex: 3, windDirection: 200, windGust: 20, windSpeed: 10,
  })
  const out = {
    currentWeather: { ...hour('2026-09-24T22:00:00Z', tempC), asOf: '2026-09-24T22:00:00Z', pressure: 1013, temperatureDewPoint: 5, visibility: 10000 },
    forecastHourly: { hours: [hour('2026-09-24T22:00:00Z', tempC), hour('2026-09-24T23:00:00Z', tempC + 1)] },
    forecastDaily: {
      days: [{
        forecastStart: '2026-09-24T07:00:00Z', conditionCode: 'Clear', maxUvIndex: 3, moonPhase: 'full',
        precipitationAmount: 0, precipitationChance: 0, snowfallAmount: 0,
        sunrise: '2026-09-24T14:00:00Z', sunset: '2026-09-25T02:00:00Z',
        temperatureMax: tempC + 5, temperatureMin: tempC - 5, windGustSpeedMax: 20,
        daytimeForecast: { cloudCover: 0.2 },
      }],
    },
    forecastNextHour: {
      summary: [{ startTime: '2026-09-24T22:00:00Z', condition: 'clear', precipitationChance: 0, precipitationIntensity: 0 }],
      minutes: [{ startTime: '2026-09-24T22:00:00Z', precipitationChance: 0, precipitationIntensity: 0 }],
    },
  }
  if (alerts) out.weatherAlerts = { alerts }
  return out
}

const okConfig = { configured: true, teamId: 'T', keyId: 'K', serviceId: 'S', keyPem: THROWAWAY_KEY_PEM, error: null }
const notConfigured = { configured: false, teamId: null, keyId: null, serviceId: null, keyPem: null, error: 'WEATHERKIT_TEAM_ID, WEATHERKIT_KEY_ID or WEATHERKIT_SERVICE_ID missing' }

// request(url, headers) -> { status, body }, queueing one answer per call
// (an Error is thrown instead of returned). Tracks call count.
function queue(...answers) {
  const calls = []
  const fn = async (url, headers) => {
    calls.push({ url: String(url), headers })
    const a = answers.shift()
    if (a instanceof Error) throw a
    return a
  }
  fn.calls = calls
  return fn
}

const ok = (body) => ({ status: 200, body: JSON.stringify(body) })
const fail = (status, body = '{}') => ({ status, body: JSON.stringify(body) })

async function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name)
  const prev = process.env[name]
  if (value == null) delete process.env[name]
  else process.env[name] = value
  try {
    return await fn()
  } finally {
    if (had) process.env[name] = prev
    else delete process.env[name]
  }
}

describe('weather: source selection (auto)', () => {
  test('WeatherKit configured: preferred and served; Open-Meteo not called', async () => {
    const requestOpenMeteo = queue(ok(omPayload()))
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload())),
      requestOpenMeteo,
    })
    await w.refresh('test')
    const out = w.getWeather(NOW)
    assert.equal(out.source, 'weatherkit')
    assert.equal(out.error, null)
    assert.deepEqual(out.attribution, { name: 'Apple Weather', url: 'https://weatherkit.apple.com/legal-attribution.html' })
    // Open-Meteo was still asked once, only to resolve the 'auto' timezone.
    assert.equal(requestOpenMeteo.calls.length, 1)
    w.stop()
  })

  test('WeatherKit not configured: Open-Meteo is preferred and served, no attribution', async () => {
    const requestWeatherKit = queue()
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => notConfigured,
      requestWeatherKit,
      requestOpenMeteo: queue(ok(omPayload())),
    })
    await w.refresh('test')
    const out = w.getWeather(NOW)
    assert.equal(out.source, 'open-meteo')
    assert.equal(out.error, null)
    assert.equal(out.attribution, null)
    assert.equal(requestWeatherKit.calls.length, 0) // never attempted when not configured and not pinned
    w.stop()
  })

  test('the resolved timezone is cached: a second refresh cycle does not re-ask Open-Meteo', async () => {
    const requestOpenMeteo = queue(ok(omPayload()))
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload()), ok(wkPayload())),
      requestOpenMeteo,
    })
    await w.refresh('one')
    await w.refresh('two')
    assert.equal(requestOpenMeteo.calls.length, 1)
    w.stop()
  })

  test('an explicit shared.location.timezone overrides auto-resolution entirely', async () => {
    const requestOpenMeteo = queue()
    const seenTz = []
    const w = createWeather({
      dir: null, getLocation: () => ({ ...HOUSE, timezone: 'America/New_York' }), log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload())),
      requestOpenMeteo,
    })
    await w.refresh('test')
    assert.equal(w.getWeather(NOW).location.timezone, 'America/New_York')
    assert.equal(requestOpenMeteo.calls.length, 0) // never needed
    w.stop()
  })
})

describe('weather: WEATHER_SOURCE pins the preferred source', () => {
  test('open-meteo pinned even though WeatherKit is configured and healthy', () =>
    withEnv('WEATHER_SOURCE', 'open-meteo', async () => {
      const w = createWeather({
        dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
        weatherKitConfig: () => okConfig,
        requestWeatherKit: queue(ok(wkPayload())),
        requestOpenMeteo: queue(ok(omPayload())),
      })
      await w.refresh('test')
      assert.equal(w.getWeather(NOW).source, 'open-meteo')
      w.stop()
    }))

  test('weatherkit pinned but not configured: falls back to Open-Meteo and surfaces the config error', () =>
    withEnv('WEATHER_SOURCE', 'weatherkit', async () => {
      const w = createWeather({
        dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
        weatherKitConfig: () => notConfigured,
        requestWeatherKit: queue(),
        requestOpenMeteo: queue(ok(omPayload())),
      })
      await w.refresh('test')
      const out = w.getWeather(NOW)
      assert.equal(out.source, 'open-meteo')
      assert.match(out.error, /WEATHERKIT_TEAM_ID/)
      w.stop()
    }))
})

describe('weather: automatic fallback', () => {
  test('WeatherKit fails this cycle: Open-Meteo serves it, source flips, error explains why', async () => {
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(fail(401, { reason: 'bad key' })),
      requestOpenMeteo: queue(ok(omPayload()), ok(omPayload())), // one to resolve tz, one for the data
    })
    await w.refresh('test')
    const out = w.getWeather(NOW)
    assert.equal(out.source, 'open-meteo')
    assert.match(out.error, /WeatherKit HTTP 401/)
    assert.ok(out.current) // still got real data from the fallback
    w.stop()
  })

  test('brief() carries both sources\' own bookkeeping through a fallback', async () => {
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(fail(500)),
      requestOpenMeteo: queue(ok(omPayload()), ok(omPayload())),
    })
    await w.refresh('test')
    const b = w.brief()
    assert.equal(b.source, 'open-meteo')
    assert.match(b.error, /WeatherKit HTTP 500/)
    assert.equal(b.weatherKit.configured, true)
    assert.match(b.weatherKit.lastError, /WeatherKit HTTP 500/)
    assert.equal(b.openMeteo.lastError, null)
    assert.ok(b.openMeteo.lastOkAt)
    w.stop()
  })

  test('both sources fail: the last good snapshot keeps serving, error names the preferred source\'s failure', async () => {
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload()), fail(500)),
      requestOpenMeteo: queue(ok(omPayload()), fail(502)),
    })
    await w.refresh('one') // succeeds: weatherkit
    await w.refresh('two') // both fail this cycle
    const out = w.getWeather(NOW)
    assert.equal(out.source, 'weatherkit') // still the last good snapshot
    assert.match(out.error, /WeatherKit HTTP 500/)
    assert.ok(out.current)
    w.stop()
  })

  test('no location at all: an error, no requests, an empty snapshot', async () => {
    const requestWeatherKit = queue()
    const requestOpenMeteo = queue()
    const w = createWeather({
      dir: null, getLocation: () => undefined, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig, requestWeatherKit, requestOpenMeteo,
    })
    await w.refresh('test')
    const out = w.getWeather(NOW)
    assert.match(out.error, /no shared\.location/)
    assert.equal(out.current, null)
    assert.deepEqual(out.hourly, [])
    assert.equal(requestWeatherKit.calls.length, 0)
    assert.equal(requestOpenMeteo.calls.length, 0)
    w.stop()
  })
})

describe('weather: cache age (MAX_AGE_MS = 3 hours)', () => {
  test('served just under 3 hours later; an empty snapshot just over', async () => {
    let now = NOW
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => now,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload())),
      requestOpenMeteo: queue(ok(omPayload())),
    })
    await w.refresh('test')
    const justUnder = new Date(NOW.getTime() + MAX_AGE_MS - 60_000)
    assert.ok(w.getWeather(justUnder).current)
    const justOver = new Date(NOW.getTime() + MAX_AGE_MS + 60_000)
    const stale = w.getWeather(justOver)
    assert.equal(stale.current, null)
    assert.deepEqual(stale.hourly, [])
    w.stop()
    void now
  })
})

describe('weather: alerts merged from NWS and WeatherKit', () => {
  const nwsAlert = (event, severity, ends, onset = '2026-09-24T20:00:00Z') => ({
    id: `nws-${event}`, event, severity, urgency: 'Expected', certainty: 'Likely',
    headline: `${event} headline`, description: null, onset, ends, messageType: 'Alert', senderName: 'NWS Test',
  })

  test('deduped by event + end time (NWS kept on a clash), ended alerts dropped, most severe first', async () => {
    const wk = wkPayload({
      alerts: [
        // Same event name + end time as the NWS one below: dropped in favour of NWS's.
        { id: 'wk-dup', description: 'Wind Advisory issued for testing', severity: 'Moderate', effectiveTime: '2026-09-24T20:00:00Z', eventEndTime: '2026-09-25T02:00:00Z' },
        // Unique to WeatherKit: kept.
        { id: 'wk-unique', description: 'Special Weather Statement about something else', severity: 'Minor', effectiveTime: '2026-09-24T20:00:00Z', eventEndTime: '2026-09-25T04:00:00Z' },
      ],
    })
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wk)),
      requestOpenMeteo: queue(ok(omPayload())),
      getNwsAlerts: () => ({
        alerts: [
          nwsAlert('Wind Advisory', 'Moderate', '2026-09-25T02:00:00Z'), // matches wk-dup: NWS wins
          nwsAlert('Flood Warning', 'Severe', '2026-09-24T21:00:00Z'), // already ended by NOW (22:05)
        ],
      }),
    })
    await w.refresh('test')
    const alerts = w.getWeather(NOW).alerts
    assert.deepEqual(alerts.map((a) => [a.event, a.source]), [
      ['Wind Advisory', 'nws'],
      ['Special Weather Statement about something else', 'weatherkit'],
    ])
    assert.equal(alerts.length, 2) // the duplicate and the ended one are both gone
    w.stop()
  })

  test('getNwsAlerts throwing degrades to no NWS alerts, not a crash', async () => {
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig,
      requestWeatherKit: queue(ok(wkPayload())),
      requestOpenMeteo: queue(ok(omPayload())),
      getNwsAlerts: () => { throw new Error('nws refresher not started') },
    })
    await w.refresh('test')
    assert.deepEqual(w.getWeather(NOW).alerts, [])
    w.stop()
  })
})

describe('weather: the disk cache', () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), 'weather-feed-test-'))
  }

  test('a restart serves the last snapshot at once, with no request at all', async () => {
    const dir = tempDir()
    try {
      const first = createWeather({
        dir, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
        weatherKitConfig: () => okConfig,
        requestWeatherKit: queue(ok(wkPayload())),
        requestOpenMeteo: queue(ok(omPayload())),
      })
      await first.refresh('test')
      first.stop()
      assert.ok(existsSync(join(dir, CACHE_FILE)))

      const requestWeatherKit = queue()
      const requestOpenMeteo = queue()
      const second = createWeather({
        dir, getLocation: () => HOUSE, log: () => {}, clock: () => new Date(NOW.getTime() + 5 * 60_000),
        weatherKitConfig: () => okConfig, requestWeatherKit, requestOpenMeteo,
      })
      const restored = second.start()
      assert.equal(restored.source, 'weatherkit')
      const out = second.getWeather(new Date(NOW.getTime() + 5 * 60_000))
      assert.equal(out.source, 'weatherkit')
      assert.ok(out.current)
      assert.equal(requestWeatherKit.calls.length, 0)
      assert.equal(requestOpenMeteo.calls.length, 0)
      second.stop()
      // Let the startup refresh land before the temp dir is removed.
      await new Promise((r) => setTimeout(r, 10))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the cache file holds the new contract shape, not the old hubWeather.mjs one', async () => {
    const dir = tempDir()
    try {
      const w = createWeather({
        dir, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
        weatherKitConfig: () => okConfig,
        requestWeatherKit: queue(ok(wkPayload())),
        requestOpenMeteo: queue(ok(omPayload())),
      })
      await w.refresh('test')
      w.stop()
      const saved = JSON.parse(readFileSync(join(dir, CACHE_FILE), 'utf8'))
      assert.equal(saved.source, 'weatherkit')
      assert.ok(saved.snapshot.current)
      assert.ok(Array.isArray(saved.snapshot.hourly))
      assert.ok(saved.timezone)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('weather: single-flight', () => {
  test('two refreshes at once make one request per source', async () => {
    const requestWeatherKit = queue(ok(wkPayload()))
    const requestOpenMeteo = queue(ok(omPayload()))
    const w = createWeather({
      dir: null, getLocation: () => HOUSE, log: () => {}, clock: () => NOW,
      weatherKitConfig: () => okConfig, requestWeatherKit, requestOpenMeteo,
    })
    const [a, b] = [w.refresh('one'), w.refresh('two')]
    assert.equal(a, b)
    await a
    assert.equal(requestWeatherKit.calls.length, 1)
    assert.equal(requestOpenMeteo.calls.length, 1) // the tz resolution
    w.stop()
  })
})
