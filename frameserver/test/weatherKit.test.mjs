// weatherKit.test.mjs - lib/weatherKit.mjs: Apple WeatherKit normalised to the
// hub's one weather contract (docs/designs/panels-and-controls.md).
//
//   node --test frameserver/test/weatherKit.test.mjs
//
// No network: the JWT is signed with a throwaway generated P-256 key, never a
// real one, and verified independently rather than just shape-checked.
// Fixtures in test/fixtures/weather/:
//   weatherkit-house.json                a real response for the house, fetched
//                                         2026-09-26 (no active alerts that day)
//   weatherkit-alerts-hand-written.json   hand-written (see its own _comment):
//                                         no live alert was reachable while this
//                                         was built; exercises alert normalisation,
//                                         an unknown conditionCode, and the sky-code
//                                         fallback against Apple's documented
//                                         WeatherAlertSummary field names

process.env.TZ = 'America/Los_Angeles'

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATTRIBUTION,
  CONDITION_TO_WMO,
  DATA_SETS,
  HOURS,
  SKY_CODE_CONDITIONS,
  WEATHERKIT_BASE,
  fetchWeatherKit,
  loadWeatherKitConfig,
  localMidnightMs,
  moonPhaseFractionFromWeatherKit,
  normalizeWeatherKit,
  signWeatherKitToken,
  skyCodeFromCloudCover,
  weatherKitUrl,
  wmoFromConditionCode,
} from '../lib/weatherKit.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'weather')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

describe('weatherKit: loadWeatherKitConfig', () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), 'weatherkit-config-test-'))
  }

  test('configured only when all three ids resolve and the key file reads', () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'weatherkit.p8'), '-----BEGIN PRIVATE KEY-----\nnot a real key, just a readable file\n-----END PRIVATE KEY-----\n')
      const base = { root: dir, env: { WEATHERKIT_TEAM_ID: 'T1', WEATHERKIT_KEY_ID: 'K1', WEATHERKIT_SERVICE_ID: 'S1', WEATHERKIT_KEY_FILE: 'weatherkit.p8' } }
      const ok = loadWeatherKitConfig(base)
      assert.equal(ok.configured, true)
      assert.equal(ok.teamId, 'T1')
      assert.equal(ok.keyFile, join(dir, 'weatherkit.p8'))
      assert.equal(ok.error, null)

      const missingId = loadWeatherKitConfig({ ...base, env: { ...base.env, WEATHERKIT_KEY_ID: '' } })
      assert.equal(missingId.configured, false)
      assert.match(missingId.error, /WEATHERKIT_KEY_ID/)

      const missingFile = loadWeatherKitConfig({ ...base, env: { ...base.env, WEATHERKIT_KEY_FILE: 'nope.p8' } })
      assert.equal(missingFile.configured, false)
      assert.match(missingFile.error, /nope\.p8/)

      // Default key file: secrets/weatherkit.p8 under root.
      const def = loadWeatherKitConfig({ root: dir, env: { WEATHERKIT_TEAM_ID: 'T1', WEATHERKIT_KEY_ID: 'K1', WEATHERKIT_SERVICE_ID: 'S1' } })
      assert.equal(def.keyFile, join(dir, 'secrets', 'weatherkit.p8'))
      assert.equal(def.configured, false) // that file does not exist here
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('weatherKit: the JWT', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const config = { configured: true, teamId: 'TEAM123456', keyId: 'KEY7890', serviceId: 'com.example.smartdisplay.weather', keyPem, error: null }

  test('header and claims: alg ES256, kid, id = team.service, iss/sub, exp = iat + 1h', () => {
    const nowMs = Date.parse('2026-09-26T12:00:00Z')
    const jwt = signWeatherKitToken(config, nowMs)
    const [h, p, s] = jwt.split('.')
    assert.equal(jwt.split('.').length, 3)
    assert.deepEqual(JSON.parse(b64urlDecode(h)), { alg: 'ES256', kid: 'KEY7890', id: 'TEAM123456.com.example.smartdisplay.weather' })
    const claims = JSON.parse(b64urlDecode(p))
    assert.equal(claims.iss, 'TEAM123456')
    assert.equal(claims.sub, 'com.example.smartdisplay.weather')
    assert.equal(claims.iat, Math.floor(nowMs / 1000))
    assert.equal(claims.exp, claims.iat + 3600)
    assert.ok(!jwt.includes('+') === false || true) // base64url: no assertion needed beyond decode succeeding
    assert.doesNotMatch(jwt, /[+/=]/) // base64url, not base64: no padding or +/
    assert.ok(s.length > 0)
  })

  test('the signature verifies against the matching public key (ieee-p1363), and a tampered payload does not', () => {
    const jwt = signWeatherKitToken(config, Date.parse('2026-09-26T12:00:00Z'))
    const [h, p, s] = jwt.split('.')
    const ok = cryptoVerify('SHA256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64urlDecode(s))
    assert.equal(ok, true)
    const badPayload = p.slice(0, -1) + (p.at(-1) === 'A' ? 'B' : 'A')
    const bad = cryptoVerify('SHA256', Buffer.from(`${h}.${badPayload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64urlDecode(s))
    assert.equal(bad, false)
  })

  test('a fresh token is minted per call (iat changes)', () => {
    const a = signWeatherKitToken(config, 1000)
    const b = signWeatherKitToken(config, 61_000)
    assert.notEqual(a, b)
  })

  test('the request: dataSets, countryCode, timezone', () => {
    const url = weatherKitUrl({ lat: 47.66, lon: -122.4, timezone: 'America/Los_Angeles' })
    assert.equal(url.origin + url.pathname, `${WEATHERKIT_BASE}/en/47.66/-122.4`)
    assert.equal(url.searchParams.get('dataSets'), DATA_SETS.join(','))
    assert.equal(url.searchParams.get('countryCode'), 'US')
    assert.equal(url.searchParams.get('timezone'), 'America/Los_Angeles')
    assert.equal(url.searchParams.get('hourlyStart'), null) // no `now`, no window
  })

  test('the request with a `now`: hourlyStart at local midnight, hourlyEnd HOURS + 1 past the current hour', () => {
    const url = weatherKitUrl({ lat: 47.66, lon: -122.4, timezone: 'America/Los_Angeles', now: new Date('2026-09-26T18:42:00Z') })
    assert.equal(url.searchParams.get('hourlyStart'), '2026-09-26T07:00:00.000Z') // 00:00 PDT
    assert.equal(url.searchParams.get('hourlyEnd'), '2026-09-28T19:00:00.000Z') // 18:00Z + 49 h
  })

  test('localMidnightMs: the zone\'s own midnight, through both DST changes and a half-hour zone', () => {
    const at = (iso, tz) => new Date(localMidnightMs(Date.parse(iso), tz)).toISOString()
    assert.equal(at('2026-09-26T18:42:00Z', 'America/Los_Angeles'), '2026-09-26T07:00:00.000Z')
    assert.equal(at('2026-09-26T02:00:00Z', 'America/Los_Angeles'), '2026-09-25T07:00:00.000Z') // still the 25th there
    assert.equal(at('2026-11-01T18:00:00Z', 'America/Los_Angeles'), '2026-11-01T07:00:00.000Z') // fall back at 2 am: midnight was PDT
    assert.equal(at('2026-03-08T20:00:00Z', 'America/Los_Angeles'), '2026-03-08T08:00:00.000Z') // spring forward: midnight was PST
    assert.equal(at('2026-09-26T18:42:00Z', 'Asia/Kolkata'), '2026-09-26T18:30:00.000Z') // 00:12 on the 27th there
    assert.equal(localMidnightMs(Date.parse('2026-09-26T18:42:00Z'), null), null)
  })

  test('fetchWeatherKit asks for the window from local midnight', async () => {
    const seen = []
    await fetchWeatherKit({
      lat: 47.66, lon: -122.4, timezone: 'America/Los_Angeles', config, now: new Date('2026-09-26T18:42:00Z'),
      request: async (url) => {
        seen.push(new URL(String(url)))
        return { status: 200, body: '{}' }
      },
    })
    assert.equal(seen[0].searchParams.get('hourlyStart'), '2026-09-26T07:00:00.000Z')
    assert.equal(seen[0].searchParams.get('hourlyEnd'), '2026-09-28T19:00:00.000Z')
  })

  test('fetchWeatherKit signs a bearer token and never throws it back out on failure', async () => {
    const seen = []
    const r = await fetchWeatherKit({
      lat: 47.66, lon: -122.4, timezone: 'America/Los_Angeles', config,
      request: async (url, headers) => {
        seen.push({ url: String(url), headers })
        return { status: 200, body: JSON.stringify({ currentWeather: null }) }
      },
    })
    assert.deepEqual(r, { currentWeather: null })
    assert.equal(seen.length, 1)
    assert.match(seen[0].headers.Authorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  test('not configured, or a non-2xx: throws, the error never contains the token', async () => {
    await assert.rejects(
      () => fetchWeatherKit({ lat: 0, lon: 0, timezone: 'UTC', config: { configured: false, error: 'no key' } }),
      /no key/,
    )
    const jwtOfThisCall = signWeatherKitToken(config, Date.now())
    await assert.rejects(async () => {
      await fetchWeatherKit({
        lat: 0, lon: 0, timezone: 'UTC', config,
        request: async () => ({ status: 401, body: JSON.stringify({ reason: 'invalid token' }) }),
      })
    }, (e) => {
      assert.match(e.message, /WeatherKit HTTP 401/)
      assert.ok(!e.message.includes(jwtOfThisCall.split('.')[2])) // the signature part never leaks
      return true
    })
  })
})

describe('weatherKit: condition-code mapping', () => {
  test('the documented table, one entry per group', () => {
    assert.equal(wmoFromConditionCode('Clear'), 0)
    assert.equal(wmoFromConditionCode('MostlyClear'), 1)
    assert.equal(wmoFromConditionCode('PartlyCloudy'), 2)
    assert.equal(wmoFromConditionCode('MostlyCloudy'), 3)
    assert.equal(wmoFromConditionCode('Cloudy'), 3)
    assert.equal(wmoFromConditionCode('Foggy'), 45)
    assert.equal(wmoFromConditionCode('Haze'), 45)
    assert.equal(wmoFromConditionCode('Smoky'), 45)
    assert.equal(wmoFromConditionCode('Drizzle'), 51)
    assert.equal(wmoFromConditionCode('Rain'), 61)
    assert.equal(wmoFromConditionCode('HeavyRain'), 65)
    assert.equal(wmoFromConditionCode('ScatteredShowers'), 80)
    assert.equal(wmoFromConditionCode('SunShowers'), 80)
    assert.equal(wmoFromConditionCode('IsolatedThunderstorms'), 95)
    assert.equal(wmoFromConditionCode('ScatteredThunderstorms'), 95)
    assert.equal(wmoFromConditionCode('Thunderstorms'), 95)
    assert.equal(wmoFromConditionCode('StrongStorms'), 95)
    assert.equal(wmoFromConditionCode('Snow'), 71)
    assert.equal(wmoFromConditionCode('HeavySnow'), 75)
    assert.equal(wmoFromConditionCode('Flurries'), 71)
    assert.equal(wmoFromConditionCode('ScatteredSnowShowers'), 85)
    assert.equal(wmoFromConditionCode('Sleet'), 66)
    assert.equal(wmoFromConditionCode('WintryMix'), 66)
    assert.equal(wmoFromConditionCode('FreezingDrizzle'), 56)
    assert.equal(wmoFromConditionCode('FreezingRain'), 66)
    assert.equal(wmoFromConditionCode('Hail'), 96)
    assert.equal(wmoFromConditionCode('Blizzard'), 75)
    assert.equal(wmoFromConditionCode('BlowingSnow'), 75)
    assert.equal(wmoFromConditionCode('Hurricane'), 65)
    assert.equal(wmoFromConditionCode('TropicalStorm'), 65)
    assert.equal(Object.keys(CONDITION_TO_WMO).length > 20, true)
  })

  test('"keep the sky code": Breezy, Windy, Frigid, Hot fall back to cloudCover, not a fixed code', () => {
    assert.deepEqual([...SKY_CODE_CONDITIONS].sort(), ['Breezy', 'Frigid', 'Hot', 'Windy'])
    assert.equal(wmoFromConditionCode('Windy', { cloudCover: 0.9 }), 3)
    assert.equal(wmoFromConditionCode('Breezy', { cloudCover: 0.2 }), 1)
    assert.equal(wmoFromConditionCode('Frigid'), 0) // no cloudCover given: "keep 0"
    assert.equal(wmoFromConditionCode('Hot', { cloudCover: 0.5 }), 2)
  })

  test('skyCodeFromCloudCover buckets 0/0.125/0.375/0.75 the same way as Open-Meteo\'s own low codes', () => {
    assert.equal(skyCodeFromCloudCover(0), 0)
    assert.equal(skyCodeFromCloudCover(0.125), 0)
    assert.equal(skyCodeFromCloudCover(0.126), 1)
    assert.equal(skyCodeFromCloudCover(0.375), 1)
    assert.equal(skyCodeFromCloudCover(0.376), 2)
    assert.equal(skyCodeFromCloudCover(0.75), 2)
    assert.equal(skyCodeFromCloudCover(0.751), 3)
    assert.equal(skyCodeFromCloudCover(undefined), 0)
    assert.equal(skyCodeFromCloudCover(null), 0)
  })

  test('an unknown code calls onUnknown once per call and still falls back to a sky code', () => {
    const seen = []
    const code = wmoFromConditionCode('SomeFutureCode', { cloudCover: 0.9, onUnknown: (c) => seen.push(c) })
    assert.equal(code, 3)
    assert.deepEqual(seen, ['SomeFutureCode'])
    // A known code never calls onUnknown.
    wmoFromConditionCode('Clear', { onUnknown: () => seen.push('should not happen') })
    assert.deepEqual(seen, ['SomeFutureCode'])
  })
})

describe('weatherKit: moon phase names', () => {
  test('all eight named phases, and an unrecognised string is null', () => {
    assert.equal(moonPhaseFractionFromWeatherKit('new'), 0)
    assert.equal(moonPhaseFractionFromWeatherKit('waxingCrescent'), 0.125)
    assert.equal(moonPhaseFractionFromWeatherKit('firstQuarter'), 0.25)
    assert.equal(moonPhaseFractionFromWeatherKit('waxingGibbous'), 0.375)
    assert.equal(moonPhaseFractionFromWeatherKit('full'), 0.5)
    assert.equal(moonPhaseFractionFromWeatherKit('waningGibbous'), 0.625)
    assert.equal(moonPhaseFractionFromWeatherKit('thirdQuarter'), 0.75)
    assert.equal(moonPhaseFractionFromWeatherKit('waningCrescent'), 0.875)
    assert.equal(moonPhaseFractionFromWeatherKit('sideways'), null)
  })
})

describe('weatherKit: normalizeWeatherKit, the hand-written alerts fixture', () => {
  const payload = fixture('weatherkit-alerts-hand-written.json')
  const now = new Date('2026-10-01T00:05:00Z')

  test('current, hourly and daily convert metric to the contract\'s units', () => {
    const out = normalizeWeatherKit(payload, { timezone: 'America/Los_Angeles', now })
    assert.deepEqual(out.current, {
      time: '2026-09-30T17:05',
      tempF: 41, feelsF: 35.6, humidity: 88, dewF: 38.3,
      windMph: 15.5, gustMph: 24.9, windDir: 200, pressureMb: 1005.2,
      visibilityMi: 3.7, uv: 0, cloudCover: 90, code: 3, condition: 'Cloudy',
      isDay: false, precipIn: 0.02,
    })
    assert.equal(out.hourly.length, 3)
    assert.deepEqual(out.hourly[0], {
      time: '2026-09-30T17:00', tempF: 41, feelsF: 35.6, precipProb: 80, precipIn: 0.02,
      snowIn: 0, code: 3, condition: 'Cloudy', windMph: 15.5, gustMph: 24.9,
      humidity: 88, uv: 0, isDay: false,
    })
    assert.deepEqual(out.daily[0], {
      date: '2026-10-01', highF: 53.6, lowF: 42.8, precipProbMax: 80, precipIn: 0.2,
      code: 61, condition: 'Rain', sunrise: '2026-10-01T07:05', sunset: '2026-10-01T18:50',
      uvMax: 1, windMaxMph: 28, moonPhase: 0.875,
    })
    assert.deepEqual(out.moon, { phase: 0.875, name: 'Waning Crescent' })
    assert.deepEqual(out.sun, { sunrise: '2026-10-01T07:05', sunset: '2026-10-01T18:50' })
    assert.deepEqual(out.attribution, ATTRIBUTION)
  })

  test('an unknown conditionCode in two hourly entries falls back to the sky code and logs once', () => {
    assert.equal(payload.forecastHourly.hours[1].conditionCode, 'TotallyMadeUpCode')
    assert.equal(payload.forecastHourly.hours[1].cloudCover, 0.2)
    const out = normalizeWeatherKit(payload, { timezone: 'America/Los_Angeles', now })
    assert.equal(out.hourly[1].code, skyCodeFromCloudCover(0.2))
    assert.equal(out.hourly[2].code, skyCodeFromCloudCover(0.2))

    // The "once" bookkeeping is process-lifetime (WeatherKit would otherwise
    // repeat the same warning every 15-minute refresh), not per call, so this
    // uses its own marker rather than relying on run order against the test
    // above (which also normalises this same fixture and would already have
    // warned about "TotallyMadeUpCode").
    const marker = 'QuiteUnheardOfConditionZ'
    const withMarker = structuredClone(payload)
    withMarker.forecastHourly.hours[1].conditionCode = marker
    withMarker.forecastHourly.hours[2].conditionCode = marker
    const logs = []
    normalizeWeatherKit(withMarker, { timezone: 'America/Los_Angeles', now, log: (m) => logs.push(m) })
    normalizeWeatherKit(withMarker, { timezone: 'America/Los_Angeles', now, log: (m) => logs.push(m) })
    const matches = logs.filter((l) => l.includes(marker))
    assert.equal(matches.length, 1, 'logged exactly once across two occurrences in one call and a second call')
  })

  test('nextHour: summary segments and per-minute precipitation, converted', () => {
    const out = normalizeWeatherKit(payload, { timezone: 'America/Los_Angeles', now })
    assert.deepEqual(out.nextHour.summary, [{ time: '2026-09-30T17:05', condition: 'precipitation', precipChance: 80, precipIntensityInHr: 0.02 }])
    assert.equal(out.nextHour.minutes.length, 2)
    assert.deepEqual(out.nextHour.minutes[1], { time: '2026-09-30T17:06', precipChance: 80, precipIntensityInHr: 0.02 })
  })

  test('alerts: event from description, severity normalised (case-insensitive, unknown -> Unknown), malformed entries dropped', () => {
    const out = normalizeWeatherKit(payload, { timezone: 'America/Los_Angeles', now })
    assert.equal(out.alerts.length, 3) // two of the five input entries are missing id/description
    const [advisory, ponding, bogus] = out.alerts
    assert.equal(advisory.event, 'Wind Advisory')
    assert.equal(advisory.severity, 'Moderate')
    assert.equal(advisory.onset, '2026-10-01T00:05:00Z') // eventOnsetTime
    assert.equal(advisory.ends, '2026-10-02T01:00:00Z') // eventEndTime
    assert.equal(advisory.source, 'weatherkit')
    assert.equal(advisory.url, 'https://example.invalid/alerts/11111111')
    // No "issued" in the sentence: the whole description is the event.
    assert.equal(ponding.event, 'Localized ponding on roadways is possible.')
    assert.equal(ponding.severity, 'Severe') // "SEVERE" normalised
    assert.equal(ponding.onset, '2026-10-01T00:00:00Z') // falls back to effectiveTime
    assert.equal(ponding.ends, '2026-10-01T12:00:00Z') // falls back to expireTime
    assert.equal(bogus.severity, 'Unknown') // an unrecognised word, not thrown
  })

  test('never throws on a payload missing whole data sets', () => {
    assert.deepEqual(normalizeWeatherKit({}, { timezone: 'America/Los_Angeles', now }).hourly, [])
    const out = normalizeWeatherKit({ currentWeather: payload.currentWeather }, { timezone: 'America/Los_Angeles', now })
    assert.ok(out.current)
    assert.deepEqual(out.hourly, [])
    assert.deepEqual(out.daily, [])
    assert.equal(out.nextHour, null)
    assert.deepEqual(out.alerts, [])
  })
})

describe('weatherKit: normalizeWeatherKit, the real house response', () => {
  const payload = fixture('weatherkit-house.json')
  // Fetched 2026-09-26T18:39:10Z; a `now` a few minutes later, same hour.
  const now = new Date('2026-09-26T18:42:00Z')

  test('windowed to local midnight through 48 hours past the current hour, 10 days, nextHour present, no alerts that day', () => {
    const out = normalizeWeatherKit(payload, { timezone: 'America/Los_Angeles', now })
    // The raw hours start at 2026-09-26T05:00Z, 22:00 the evening before.
    assert.equal(payload.forecastHourly.hours[0].forecastStart, '2026-09-26T05:00:00Z')
    // Today's local midnight (07:00Z) first; the current UTC hour (18:00) in
    // America/Los_Angeles (PDT, UTC-7) is 11:00, eleven hours in.
    assert.equal(out.hourly[0].time, '2026-09-26T00:00')
    assert.equal(out.hourly[11].time, '2026-09-26T11:00')
    assert.equal(out.hourly.length, 11 + HOURS)
    assert.equal(out.hourly[out.hourly.length - 1].time, '2026-09-28T10:00')
    assert.equal(out.daily.length, 10)
    // Strictly increasing, one hour apart, no gaps or repeats.
    for (let i = 1; i < out.hourly.length; i++) {
      const prev = new Date(out.hourly[i - 1].time)
      const cur = new Date(out.hourly[i].time)
      assert.equal(cur.getTime() - prev.getTime(), 3_600_000, `hour ${i}`)
    }
    assert.ok(out.current.tempF > 30 && out.current.tempF < 100, 'a plausible Seattle-area temperature')
    assert.equal(out.current.condition, 'MostlyClear')
    assert.ok(out.nextHour)
    assert.ok(out.nextHour.minutes.length > 0)
    assert.deepEqual(out.alerts, []) // absent from the real payload: none active that day
    assert.deepEqual(out.moon, { phase: 0.5, name: 'Full Moon' }) // the real day's moonPhase was "full"
    assert.deepEqual(out.attribution, ATTRIBUTION)
  })
})
