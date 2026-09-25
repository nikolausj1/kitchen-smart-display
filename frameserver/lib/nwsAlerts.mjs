// nwsAlerts.mjs - the National Weather Service's active alerts for the house.
//
// GET https://api.weather.gov/alerts/active?point=<lat>,<lon> (free, no key;
// the NWS asks for an identifying User-Agent) for shared.location: every 10
// minutes, at startup, and within a minute of a location change; retried in
// 3 minutes after a failure; one fetch at a time. Normalised to
//
//   [{ id, event, severity, urgency, certainty, headline, description,
//      onset, ends, messageType, senderName }]
//
//   severity     'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown'
//   description  the first 300 characters, whitespace collapsed
//   onset        onset, else effective (as the NWS sent it, with its offset)
//   ends         ends, else expires (the message's own expiry), else null
//
// Dropped: messageType 'Cancel', any status but 'Actual' (tests, exercises,
// drafts), and anything already ended. The list is filtered again on every
// read, so an alert leaves the moment it ends, even while the NWS is down.
//
// getAlerts(now) -> { fetchedAt, error, alerts }. A failed fetch keeps the
// last list (for up to 12 hours) and sets `error`. A point the NWS does not
// cover (outside the US it answers 400 "out of bounds") or a 404 is an empty
// list, quietly: error stays null.
//
// weatherAlertsFor (from weatherRules.mjs, re-exported here) makes the short
// list /api/state publishes. The headline's alert lines are weatherRules.mjs's.
//
// NWS_ALERTS_FIXTURE (environment, resolved against FRAMESERVER_ROOT): a
// saved alerts response read instead of calling the NWS, for tests and for
// previewing an alert on a scratch hub. Never set it on the NUC.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWithTimeout, isDict } from './io.mjs'
import { coordsOf } from './hubWeather.mjs'
import { SEVERITIES, weatherAlertsFor } from './weatherRules.mjs'

export { weatherAlertsFor }

export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active'
export const NWS_HEADERS = Object.freeze({
  'User-Agent': 'kitchen-smart-display-hub',
  Accept: 'application/geo+json',
})
export const REFRESH_MS = 10 * 60 * 1000
export const RETRY_MS = 3 * 60 * 1000
export const MAX_AGE_MS = 12 * 60 * 60 * 1000
export const DESCRIPTION_MAX = 300
const LOCATION_CHECK_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const DEFAULT_ROOT = process.env.FRAMESERVER_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..')

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const collapse = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const time = (v) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? v : null)

function locationKey(loc) {
  const c = coordsOf(loc)
  return c ? `${c.lat},${c.lon}` : 'none'
}

// Four decimal places (about 10 m) is all the NWS keeps.
export function alertsUrl(location) {
  const c = coordsOf(location)
  if (!c) throw new Error('no shared.location in the registry')
  const r = (n) => Number(n.toFixed(4))
  return `${NWS_ALERTS_URL}?point=${r(c.lat)},${r(c.lon)}`
}

// An NWS alerts FeatureCollection -> the normalised list, in the NWS's order.
// Throws when the payload is not a collection at all.
export function parseAlerts(payload, now = new Date()) {
  if (!isDict(payload) || !Array.isArray(payload.features)) throw new Error('not an NWS alerts collection')
  const nowMs = now.getTime()
  const seen = new Set()
  const out = []
  for (const f of payload.features) {
    const p = isDict(f?.properties) ? f.properties : null
    if (!p || p.status !== 'Actual' || p.messageType === 'Cancel') continue
    const ends = time(p.ends) || time(p.expires)
    if (ends && Date.parse(ends) <= nowMs) continue
    const id = str(p.id) || str(f.id)
    const event = collapse(p.event)
    if (!id || !event || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      event,
      severity: SEVERITIES.includes(p.severity) ? p.severity : 'Unknown',
      urgency: str(p.urgency) || 'Unknown',
      certainty: str(p.certainty) || 'Unknown',
      headline: collapse(p.headline) || null,
      description: collapse(p.description).slice(0, DESCRIPTION_MAX) || null,
      onset: time(p.onset) || time(p.effective),
      ends,
      messageType: str(p.messageType),
      senderName: str(p.senderName),
    })
  }
  return out
}

async function httpGet(url, headers) {
  const { res, body } = await fetchWithTimeout(url, { timeoutMs: FETCH_TIMEOUT_MS, headers })
  return { status: res.status, body: body.toString('utf8') }
}

// Not the NWS's area: a 404, or its 400 for a point outside every zone.
function outsideCoverage(status, body) {
  if (status === 404) return true
  if (status !== 400) return false
  try {
    return /out of bounds/i.test(String(JSON.parse(body)?.detail ?? ''))
  } catch {
    return false
  }
}

function fixtureFromEnv() {
  const v = process.env.NWS_ALERTS_FIXTURE
  return v ? resolve(DEFAULT_ROOT, v) : null
}

// getLocation() returns the registry's shared.location, read on every refresh
// and once a minute. `request(url, headers)` -> { status, body } and `clock`
// are for tests.
export function createNwsAlerts({
  getLocation,
  log = (m) => console.log(m),
  request = httpGet,
  fixtureFile = fixtureFromEnv(),
  clock = () => new Date(),
}) {
  let list = [] // the last good list
  let listKey = null // the location it is for
  let fetchedAt = null
  let error = null
  let outside = false
  let seenKey = null // the location the latest refresh asked about
  let lastIds = null
  let inFlight = null
  let rerun = false
  let failing = false
  let timer = null
  let watch = null

  const readLocation = () => {
    try {
      return getLocation()
    } catch {
      return null
    }
  }

  function schedule(ok) {
    clearTimeout(timer)
    timer = setTimeout(() => refresh('timer'), ok ? REFRESH_MS : RETRY_MS)
    timer.unref?.()
  }

  async function fetchList(loc) {
    if (fixtureFile) {
      return { alerts: parseAlerts(JSON.parse(readFileSync(fixtureFile, 'utf8')), clock()), outside: false }
    }
    const { status, body } = await request(alertsUrl(loc), { ...NWS_HEADERS })
    if (outsideCoverage(status, body)) return { alerts: [], outside: true }
    if (status < 200 || status >= 300) throw new Error(`NWS alerts HTTP ${status}`)
    return { alerts: parseAlerts(JSON.parse(body), clock()), outside: false }
  }

  // Never rejects: the result lands in `list`, a failure in `error` and the log.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const loc = readLocation()
      seenKey = locationKey(loc)
      let ok = false
      try {
        const r = await fetchList(loc)
        if (r.outside && !outside) log(`[alerts] ${seenKey} is outside the NWS area: no alerts (${reason})`)
        const ids = r.alerts.map((a) => a.id).join(' ')
        if (ids !== lastIds || failing) {
          log(`[alerts] ${r.alerts.length ? `${r.alerts.length} active: ${r.alerts.map((a) => a.event).join(', ')}` : 'none active'} (${reason})`)
        }
        list = r.alerts
        listKey = seenKey
        lastIds = ids
        outside = r.outside
        fetchedAt = clock().toISOString()
        error = null
        ok = true
        failing = false
      } catch (e) {
        error = String(e.message || e)
        if (!failing) {
          log(`[alerts] refresh failed (${reason}): ${error}; ` +
              (fetchedAt ? `keeping the ${list.length} alert(s) from ${fetchedAt}` : 'no alerts until the next try'))
        }
        failing = true
      } finally {
        inFlight = null
        schedule(ok)
        if (rerun) {
          rerun = false
          if (locationKey(readLocation()) !== seenKey) refresh('location changed')
        }
      }
    })()
    return inFlight
  }

  function checkLocation() {
    if (locationKey(readLocation()) === seenKey) return
    if (inFlight) rerun = true
    else refresh('location changed')
  }

  function current(now = clock()) {
    const age = fetchedAt ? now.getTime() - Date.parse(fetchedAt) : Infinity
    const usable = age <= MAX_AGE_MS && listKey === seenKey
    const nowMs = now.getTime()
    const alerts = usable ? list.filter((a) => !a.ends || Date.parse(a.ends) > nowMs) : []
    return { fetchedAt, error, alerts }
  }

  return {
    start() {
      if (fixtureFile) log(`[alerts] FIXTURE ${fixtureFile} (instead of the NWS)`)
      seenKey = locationKey(readLocation())
      refresh('startup')
      clearInterval(watch)
      watch = setInterval(checkLocation, LOCATION_CHECK_MS)
      watch.unref?.()
      return { fixture: fixtureFile }
    },
    current,
    health(now = clock()) {
      return { count: current(now).alerts.length, fetchedAt, error }
    },
    refresh,
    stop() {
      clearTimeout(timer)
      clearInterval(watch)
    },
  }
}

// --- the hub's one alert list -------------------------------------------------------

let hub = null

// server.mjs: startAlertsRefresher(() => getShared().location).
export function startAlertsRefresher(getLocation, options = {}) {
  hub?.stop()
  hub = createNwsAlerts({ ...options, getLocation })
  return hub.start()
}

export function getAlerts(now = new Date()) {
  return hub ? hub.current(now) : { fetchedAt: null, error: 'not started', alerts: [] }
}

// GET /healthz: { count, fetchedAt, error }.
export function alertsHealth(now = new Date()) {
  return hub ? hub.health(now) : { count: 0, fetchedAt: null, error: 'not started' }
}
