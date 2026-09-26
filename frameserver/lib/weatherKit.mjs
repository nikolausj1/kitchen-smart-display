// weatherKit.mjs - Apple WeatherKit, normalised to the hub's one weather
// contract (docs/designs/panels-and-controls.md, "One weather feed").
//
// Configuration (.env, lib/env.mjs): WEATHERKIT_KEY_FILE (default
// secrets/weatherkit.p8), WEATHERKIT_TEAM_ID, WEATHERKIT_KEY_ID,
// WEATHERKIT_SERVICE_ID. `loadWeatherKitConfig()` resolves all four and reads
// the key file; `configured` is true only when every one of them checks out.
// The private key never leaves this process except as a signature; the JWT
// itself is never logged (a bearer token good for up to an hour).
//
// The JWT (RFC 7519, ES256): header { alg: 'ES256', kid: <key id>,
// id: '<team id>.<service id>' }, claims { iss: <team id>, iat, exp: iat+1h,
// sub: <service id> }, minted fresh for every fetch (weatherkit.apple.com
// wants a short-lived token, not a cached one). Node's ES256 signature is
// DER by default; JOSE wants the raw (r||s) "IEEE P1363" form, hence
// dsaEncoding: 'ieee-p1363' below - the one non-obvious step in an otherwise
// ordinary JWT.
//
// GET https://weatherkit.apple.com/api/v1/weather/en/<lat>/<lon>
//   ?dataSets=currentWeather,forecastHourly,forecastDaily,forecastNextHour,weatherAlerts
//   &countryCode=US&timezone=<IANA zone>
// Requesting `weatherAlerts` alone (with no other data set) 400s with an
// empty body in testing; the full set above always works and is what we ask
// for. A verified real response for the house lands in
// frameserver/test/fixtures/weather/weatherkit-house.json - no active alerts
// that day, so `weatherAlerts` is simply absent from the payload (Apple omits
// the key rather than sending an empty list).
//
// Units: WeatherKit's metric ("m") units are Celsius, km/h, millibars,
// metres, centimetres (snow) and 0..1 fractions (humidity, cloud cover);
// every current/hourly/daily field below is converted to the contract's
// Fahrenheit / mph / inches / mb / miles / 0..100 %.
//
// Time: WeatherKit's own timestamps are UTC ('...Z'). Every `time` / `date` /
// `sunrise` / `sunset` in the contract is instead the LOCAL wall-clock stamp
// (no zone), matching Open-Meteo's convention that the rest of the hub
// already relies on (weatherRules.mjs, headline.mjs parse these with
// `new Date(offsetless)`, which JS reads in the process's own zone - the
// house's). `io.mjs`'s toLocalStamp() does that conversion using the
// timezone lib/weather.mjs resolved for shared.location, not the process's
// implicit zone, so it is correct even if the two ever differ.
//
// Alerts: the `weatherAlerts` data set's WeatherAlertSummary objects
// (Apple's REST reference) carry no short "event name" field, only `id`,
// `description` (a full sentence, e.g. "Winter Storm Warning issued ... by
// NWS Seattle WA" - the same convention the NWS's own `headline` uses),
// `severity`, `urgency`, `certainty`, `effectiveTime`, `eventOnsetTime`,
// `eventEndTime`, `expireTime`, `issuedTime`, `detailsUrl`, `source`. `event`
// is taken as the text before " issued" in `description` (falling back to the
// whole description) so it reads the same as an NWS alert's `event`
// ("Winter Storm Warning through Sat 6 am"). This is unverified against a
// live alert (none was active anywhere a test point could reach while this
// was built - see frameserver/test/fixtures/weather/weatherkit-alerts-hand-written.json,
// which is hand-written from Apple's documented field names, not a real
// capture); the normaliser is defensive (skips anything that will not parse,
// never throws) so a field-name surprise degrades to "alert dropped", not a
// crash.

import { createPrivateKey, createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fetchWithTimeout, isDict, toLocalStamp } from './io.mjs'
import { SEVERITIES } from './weatherRules.mjs'
import { moonPhaseName } from './openMeteoWeather.mjs'

export const WEATHERKIT_BASE = 'https://weatherkit.apple.com/api/v1/weather'
export const DATA_SETS = ['currentWeather', 'forecastHourly', 'forecastDaily', 'forecastNextHour', 'weatherAlerts']
export const ATTRIBUTION = Object.freeze({ name: 'Apple Weather', url: 'https://weatherkit.apple.com/legal-attribution.html' })
// WeatherKit's forecastHourly.hours runs from around local midnight through
// several days out (250+ entries seen in testing, some already in the past)
// and forecastDaily.days can run past what the contract promises; both are
// windowed to the contract's own limits below.
export const HOURS = 48
export const DAYS = 10
const JWT_TTL_S = 3600
const FETCH_TIMEOUT_MS = 10_000

const str = (v) => (typeof v === 'string' && v ? v : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100)
const bool = (v) => (typeof v === 'boolean' ? v : null)
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null)

// --- unit conversions (WeatherKit's metric units -> the contract's) ----------------

const cToF = (c) => (num(c) == null ? null : (c * 9) / 5 + 32)
const kmhToMph = (v) => (num(v) == null ? null : v * 0.621371)
const mToMi = (v) => (num(v) == null ? null : v / 1609.344)
const mmToIn = (v) => (num(v) == null ? null : v / 25.4)
const cmToIn = (v) => (num(v) == null ? null : v / 2.54)

// --- configuration -------------------------------------------------------------------

// { configured, teamId, keyId, serviceId, keyFile, keyPem, error }. `error`
// explains why `configured` is false (for logs and brief()); never includes
// the key's own bytes.
export function loadWeatherKitConfig({ root = process.env.FRAMESERVER_ROOT || '.', env = process.env } = {}) {
  const keyFile = resolve(root, env.WEATHERKIT_KEY_FILE || 'secrets/weatherkit.p8')
  const teamId = str(env.WEATHERKIT_TEAM_ID)
  const keyId = str(env.WEATHERKIT_KEY_ID)
  const serviceId = str(env.WEATHERKIT_SERVICE_ID)
  if (!teamId || !keyId || !serviceId) {
    return { configured: false, teamId, keyId, serviceId, keyFile, keyPem: null, error: 'WEATHERKIT_TEAM_ID, WEATHERKIT_KEY_ID or WEATHERKIT_SERVICE_ID missing' }
  }
  try {
    const keyPem = readFileSync(keyFile, 'utf8')
    return { configured: true, teamId, keyId, serviceId, keyFile, keyPem, error: null }
  } catch (e) {
    return { configured: false, teamId, keyId, serviceId, keyFile, keyPem: null, error: `key file ${keyFile}: ${e.code || e.message}` }
  }
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(JSON.stringify(input))
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// A fresh, short-lived JWT. `nowMs` is for tests; never logged by any caller.
export function signWeatherKitToken({ teamId, keyId, serviceId, keyPem }, nowMs = Date.now()) {
  const header = { alg: 'ES256', kid: keyId, id: `${teamId}.${serviceId}` }
  const iat = Math.floor(nowMs / 1000)
  const claims = { iss: teamId, iat, exp: iat + JWT_TTL_S, sub: serviceId }
  const signingInput = `${base64url(header)}.${base64url(claims)}`
  const key = createPrivateKey(keyPem)
  const signature = createSign('SHA256').update(signingInput).sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${base64url(signature)}`
}

export function weatherKitUrl({ lat, lon, timezone }) {
  const url = new URL(`${WEATHERKIT_BASE}/en/${lat}/${lon}`)
  url.searchParams.set('dataSets', DATA_SETS.join(','))
  url.searchParams.set('countryCode', 'US')
  url.searchParams.set('timezone', timezone)
  return url
}

async function httpGet(url, headers) {
  const { res, body } = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers })
  return { status: res.status, body: body.toString('utf8') }
}

// Mints a token and fetches the raw WeatherKit payload. Throws when not
// configured, or on a non-2xx (the body is included; it is Apple's own JSON
// error, never anything of ours). `request(url, headers)` is injectable.
export async function fetchWeatherKit({ lat, lon, timezone, config, request = httpGet, now = Date.now() }) {
  if (!config?.configured) throw new Error(config?.error || 'WeatherKit is not configured')
  const token = signWeatherKitToken(config, now)
  const { status, body } = await request(weatherKitUrl({ lat, lon, timezone }), { Authorization: `Bearer ${token}` })
  if (status < 200 || status >= 300) throw new Error(`WeatherKit HTTP ${status}: ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

// --- WMO condition-code mapping (one table, a fallback, unknowns logged once) ------
//
// conditionCode strings from Apple's WeatherCondition enum -> the WMO code the
// app's icons already understand (code/src/hooks/useWeather.js wmoToIcon(),
// code/src/views/TodayLayouts/data/useDailyForecast.js wmo.js). "Keep the sky
// code" entries have no rain/snow/storm meaning of their own (a windy or a
// hot/frigid day can be clear or overcast), so they fall back to a code
// derived from cloudCover instead of a fixed number.

export const CONDITION_TO_WMO = Object.freeze({
  Clear: 0,
  MostlyClear: 1,
  PartlyCloudy: 2,
  MostlyCloudy: 3,
  Cloudy: 3,
  Foggy: 45,
  Fog: 45,
  Haze: 45,
  Smoky: 45,
  Drizzle: 51,
  FreezingDrizzle: 56,
  Rain: 61,
  HeavyRain: 65,
  FreezingRain: 66,
  Sleet: 66,
  WintryMix: 66,
  Showers: 80,
  ScatteredShowers: 80,
  SunShowers: 80,
  Snow: 71,
  Flurries: 71,
  HeavySnow: 75,
  Blizzard: 75,
  BlowingSnow: 75,
  ScatteredSnowShowers: 85,
  IsolatedThunderstorms: 95,
  ScatteredThunderstorms: 95,
  Thunderstorms: 95,
  StrongStorms: 95,
  Hail: 96,
  Hurricane: 65,
  TropicalStorm: 65,
})

// No rain/snow meaning of their own: fall back to cloudCover.
export const SKY_CODE_CONDITIONS = new Set(['Breezy', 'Windy', 'Frigid', 'Hot'])

// cloudCover is a 0..1 fraction; bucketed onto the same 0/1/2/3 (clear ..
// overcast) scale Open-Meteo's own low codes use. Missing data keeps 0
// (clear) - "Frigid and Hot keep 0 or the sky code".
export function skyCodeFromCloudCover(cloudCover) {
  if (typeof cloudCover !== 'number' || !Number.isFinite(cloudCover)) return 0
  if (cloudCover <= 0.125) return 0
  if (cloudCover <= 0.375) return 1
  if (cloudCover <= 0.75) return 2
  return 3
}

// Pure: `onUnknown(code)` is called (not logged here) for a conditionCode this
// table has never heard of, so the caller can log it once per process.
export function wmoFromConditionCode(conditionCode, { cloudCover, onUnknown } = {}) {
  const code = typeof conditionCode === 'string' ? conditionCode : ''
  if (code in CONDITION_TO_WMO) return CONDITION_TO_WMO[code]
  if (SKY_CODE_CONDITIONS.has(code)) return skyCodeFromCloudCover(cloudCover)
  if (code) onUnknown?.(code)
  return skyCodeFromCloudCover(cloudCover)
}

const warnedConditionCodes = new Set()

// codeFor(): wmoFromConditionCode, logging an unknown code exactly once for
// the life of the process (WeatherKit would otherwise repeat it every 15 min).
function codeFor(conditionCode, cloudCover, log) {
  return wmoFromConditionCode(conditionCode, {
    cloudCover,
    onUnknown: (code) => {
      if (warnedConditionCodes.has(code)) return
      warnedConditionCodes.add(code)
      log(`[weatherkit] unknown conditionCode "${code}"; using the sky code from cloud cover`)
    },
  })
}

// --- moon phase: WeatherKit's named phase -> the shared fraction/name -------------

// Apple's MoonPhase enum, in order, evenly spaced (the canonical fraction each
// name centres on - the same 8-way bucketing openMeteoWeather.mjs uses, so
// both sources say the same thing for the same night).
const WEATHERKIT_MOON_PHASE_FRACTION = {
  new: 0,
  waxingCrescent: 0.125,
  firstQuarter: 0.25,
  waxingGibbous: 0.375,
  full: 0.5,
  waningGibbous: 0.625,
  thirdQuarter: 0.75,
  waningCrescent: 0.875,
}

export function moonPhaseFractionFromWeatherKit(phase) {
  const v = WEATHERKIT_MOON_PHASE_FRACTION[phase]
  return typeof v === 'number' ? v : null
}

// --- alerts --------------------------------------------------------------------------

// WeatherAlertSummary has no short "event" field (Apple's REST reference: id,
// description, severity, urgency, certainty, effectiveTime, eventOnsetTime,
// eventEndTime, expireTime, issuedTime, detailsUrl, source) - `description`
// reads like the NWS's own `headline` ("<Event> issued ... by <sender>"), so
// the event name is the text before " issued".
function eventFromDescription(description) {
  const s = String(description || '').trim().replace(/\s+/g, ' ')
  const m = /^(.*?)\s+issued\b/i.exec(s)
  return (m ? m[1] : s).trim() || 'Weather Alert'
}

function normalizeSeverity(v) {
  const s = String(v || '')
  const hit = SEVERITIES.find((x) => x.toLowerCase() === s.toLowerCase())
  return hit || 'Unknown'
}

function normalizeAlerts(weatherAlertsData) {
  const list = Array.isArray(weatherAlertsData?.alerts) ? weatherAlertsData.alerts : []
  const out = []
  for (const a of list) {
    if (!isDict(a)) continue
    const id = str(a.id)
    const description = str(a.description)
    if (!id || !description) continue
    out.push({
      id,
      event: eventFromDescription(description),
      severity: normalizeSeverity(a.severity),
      urgency: str(a.urgency) || 'Unknown',
      certainty: str(a.certainty) || 'Unknown',
      headline: description,
      description,
      onset: str(a.eventOnsetTime) || str(a.effectiveTime),
      ends: str(a.eventEndTime) || str(a.expireTime),
      source: 'weatherkit',
      url: str(a.detailsUrl),
    })
  }
  return out
}

// --- the response -> the contract ---------------------------------------------------

function currentFrom(cw, timezone, log) {
  return {
    time: toLocalStamp(cw.asOf, timezone),
    tempF: round1(cToF(cw.temperature)),
    feelsF: round1(cToF(cw.temperatureApparent)),
    humidity: pct(cw.humidity),
    dewF: round1(cToF(cw.temperatureDewPoint)),
    windMph: round1(kmhToMph(cw.windSpeed)),
    gustMph: round1(kmhToMph(cw.windGust)),
    windDir: int(cw.windDirection),
    pressureMb: round1(num(cw.pressure)),
    visibilityMi: round1(mToMi(cw.visibility)),
    uv: int(cw.uvIndex),
    cloudCover: pct(cw.cloudCover),
    code: codeFor(cw.conditionCode, cw.cloudCover, log),
    condition: str(cw.conditionCode),
    isDay: bool(cw.daylight),
    precipIn: round2(mmToIn(cw.precipitationIntensity)),
  }
}

function hourFrom(h, timezone, log) {
  return {
    time: toLocalStamp(h.forecastStart, timezone),
    tempF: round1(cToF(h.temperature)),
    feelsF: round1(cToF(h.temperatureApparent)),
    precipProb: pct(h.precipitationChance),
    precipIn: round2(mmToIn(h.precipitationAmount)),
    snowIn: round2(cmToIn(h.snowfallAmount)),
    code: codeFor(h.conditionCode, h.cloudCover, log),
    condition: str(h.conditionCode),
    windMph: round1(kmhToMph(h.windSpeed)),
    gustMph: round1(kmhToMph(h.windGust)),
    humidity: pct(h.humidity),
    uv: int(h.uvIndex),
    isDay: bool(h.daylight),
  }
}

function dayFrom(d, timezone, log) {
  const cloudCover = d.daytimeForecast?.cloudCover
  return {
    date: (toLocalStamp(d.forecastStart, timezone) || '').slice(0, 10) || null,
    highF: round1(cToF(d.temperatureMax)),
    lowF: round1(cToF(d.temperatureMin)),
    precipProbMax: pct(d.precipitationChance),
    precipIn: round2(mmToIn(d.precipitationAmount)),
    code: codeFor(d.conditionCode, cloudCover, log),
    condition: str(d.conditionCode),
    sunrise: toLocalStamp(d.sunrise, timezone),
    sunset: toLocalStamp(d.sunset, timezone),
    uvMax: int(d.maxUvIndex),
    windMaxMph: round1(kmhToMph(d.windGustSpeedMax)),
    moonPhase: moonPhaseFractionFromWeatherKit(d.moonPhase),
  }
}

function nextHourFrom(nh, timezone) {
  const segment = (s) => ({
    time: toLocalStamp(s.startTime, timezone),
    condition: str(s.condition),
    precipChance: pct(s.precipitationChance),
    precipIntensityInHr: round2(mmToIn(s.precipitationIntensity)),
  })
  return {
    summary: Array.isArray(nh.summary) ? nh.summary.filter(isDict).map(segment) : [],
    minutes: Array.isArray(nh.minutes) ? nh.minutes.filter(isDict).map((m) => ({
      time: toLocalStamp(m.startTime, timezone),
      precipChance: pct(m.precipitationChance),
      precipIntensityInHr: round2(mmToIn(m.precipitationIntensity)),
    })) : [],
  }
}

// The raw WeatherKit JSON -> the contract's fields (minus source, fetchedAt,
// error and location, which lib/weather.mjs fills in). `timezone` is the IANA
// zone lib/weather.mjs resolved for shared.location (the same one the request
// itself asked WeatherKit for), used to turn every UTC timestamp into the
// house's local wall-clock stamp. `now` windows `forecastHourly.hours` (which
// runs from around local midnight, well before "now", through several days
// out) down to the contract's 48 hours starting at the current hour. `log`
// gets one line per unknown conditionCode, the first time it is seen.
export function normalizeWeatherKit(payload, { timezone, now = new Date(), log = () => {} } = {}) {
  if (!isDict(payload)) throw new Error('not a WeatherKit response')
  const cw = payload.currentWeather
  const hourly = payload.forecastHourly
  const daily = payload.forecastDaily
  const nextHour = payload.forecastNextHour

  const currentHourMs = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const current = isDict(cw) ? currentFrom(cw, timezone, log) : null
  const hourlyList = Array.isArray(hourly?.hours)
    ? hourly.hours
        .filter(isDict)
        .filter((h) => {
          const t = Date.parse(h.forecastStart)
          return Number.isFinite(t) && t >= currentHourMs
        })
        .slice(0, HOURS)
        .map((h) => hourFrom(h, timezone, log))
    : []
  const dailyList = Array.isArray(daily?.days) ? daily.days.filter(isDict).slice(0, DAYS).map((d) => dayFrom(d, timezone, log)) : []
  const nextHourOut = isDict(nextHour) ? nextHourFrom(nextHour, timezone) : null
  const alerts = normalizeAlerts(payload.weatherAlerts)
  const today = dailyList[0] || null

  return {
    current,
    hourly: hourlyList,
    daily: dailyList,
    nextHour: nextHourOut,
    alerts,
    sun: today ? { sunrise: today.sunrise, sunset: today.sunset } : { sunrise: null, sunset: null },
    moon: today ? { phase: today.moonPhase, name: moonPhaseName(today.moonPhase) } : { phase: null, name: null },
    attribution: { ...ATTRIBUTION },
  }
}
