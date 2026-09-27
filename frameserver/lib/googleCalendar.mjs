// googleCalendar.mjs - Google Calendar for the Entry board, via a service account.
//
// Justin's and Sheena's calendars are shared (read-only, "See all event
// details") with a Google Cloud service account whose JSON key sits in the
// service root at secrets/google-calendar.json (GOOGLE_CALENDAR_KEY_FILE),
// copied there by hand, never through git. No OAuth consent flow, no refresh
// token to expire. Decided 2026-09-24, docs/designs/entry-board.md.
//
// Auth: a JWT assertion (RFC 7523) signed RS256 with node:crypto, exchanged at
// oauth2.googleapis.com/token for a one-hour access token, cached until a
// minute before it expires. The key file is read on every refresh, so adding
// or replacing it needs no restart.
//
// Events: each calendar in shared.calendar.calendars, one window from local
// midnight 31 days back (PAST_DAYS: the month grid's first weeks) to local
// midnight 60 days out (WINDOW_DAYS: countdowns look 60 ahead, the calendar
// views up to 60), recurring events expanded by Google (singleEvents=true),
// every page. Normalized to the shape GET /api/calendar serves:
//
//   { id, calendarId, calendarLabel, color, title, description, location,
//     allDay, start, end, startDate, endDate, status }
//
//   all-day: startDate / endDate 'YYYY-MM-DD' as Google gives them, endDate
//            EXCLUSIVE; start / end null.
//   timed:   start / end ISO (UTC); startDate = the LOCAL date of start;
//            endDate = the day after the last local date the event touches,
//            so it is exclusive too and one rule covers both kinds: an event
//            is on day d when startDate <= d < endDate.
//   description / location: trimmed, null when empty. Google keeps
//            descriptions edited on the web as HTML; they are passed through
//            as stored (countdowns.mjs reads the marker out of the HTML).
//
// Dropped: cancelled events and Workspace "working location" entries. The
// same event on two calendars (an invitation between Justin and Sheena) is
// listed once, from the first calendar in the registry's order; the other
// calendars it was on ride along as `alsoOn` ([{ calendarId, calendarLabel,
// color }], [] for most events), so a screen that consolidates can draw every
// calendar's colour (docs/designs/panels-and-controls.md, chunk 3).
//
// Refreshed every 5 minutes, at startup, and as soon as the list of calendar
// ids in the registry changes. Labels and colours are joined at read time, so
// a dashboard rename shows at once without a fetch. Each calendar keeps its
// own last good copy: an unshared or mistyped calendar reports an error
// without blanking the other. Also cached on disk (calendar-cache.json) so a
// restart serves the last copy at once. The cache file is { savedAt,
// window: { timeMin, timeMax }, calendars }; `window` (added with the past
// days, 2026-09-26) is informational, and a file without it (the 60-day
// window from today) reads the same, its past days simply missing until the
// first fetch.
//
// No key file and no fixture: connected false, error 'no service account
// key', no events, logged at most once per 10 minutes. The routes work either
// way; the headline then falls back to day parts.
//
// GOOGLE_CALENDAR_FIXTURE: a JSON file of events, [...] or { events: [...] },
// in the normalized shape or Google's raw one, served instead of Google and
// re-read whenever the file changes. For tests and running without a key.
// Like Google mode, an event whose calendarId is not in the registry's list is
// left out; an event without a calendarId always shows (its own
// calendarLabel / color, if any).

import { createSign } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dateKey } from './countdown.mjs'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars'
// The one window every fetch covers: WINDOW_DAYS forward (the countdowns look
// 60 days ahead; GET /api/calendar serves up to `days=60`) and PAST_DAYS back
// (`past=31`: a month grid of the current month).
export const WINDOW_DAYS = 60
export const PAST_DAYS = 31
export const NO_KEY = 'no service account key'
export const CALENDAR_DEFAULTS = Object.freeze({ calendars: [], countdownLeadDays: 30, countdownMax: 3 })
const REFRESH_MS = 5 * 60 * 1000
const LOG_REPEAT_MS = 10 * 60 * 1000
const TOKEN_MARGIN_MS = 60 * 1000
const HTTP_TIMEOUT_MS = 15_000
const MAX_PAGES = 20 // x 250 events, per calendar
const DEFAULT_COLORS = ['#e0457b', '#4a90e2', '#f5a623', '#50b86c', '#9b59b6', '#16a2b8']
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function num(v, fallback, lo, hi) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

// --- settings ------------------------------------------------------------------

// The registry's shared.calendar block with defaults; tolerant of a missing
// block, junk entries and duplicate ids. A calendar without a label shows its
// id, one without a colour gets one from a fixed palette.
export function calendarSettings(shared) {
  const c = isDict(shared?.calendar) ? shared.calendar : {}
  const seen = new Set()
  const calendars = []
  for (const x of Array.isArray(c.calendars) ? c.calendars : []) {
    const id = isDict(x) ? str(x.id) : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    calendars.push({
      id,
      label: str(x.label) || id,
      color: str(x.color) || DEFAULT_COLORS[calendars.length % DEFAULT_COLORS.length],
    })
  }
  return {
    calendars,
    countdownLeadDays: num(c.countdownLeadDays, CALENDAR_DEFAULTS.countdownLeadDays, 0, 365),
    countdownMax: num(c.countdownMax, CALENDAR_DEFAULTS.countdownMax, 0, 12),
  }
}

// --- dates -----------------------------------------------------------------------

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + n))
}

function localMidnight(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function parseTime(v) {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

// A timed event's exclusive end date: the day after the last local date it
// touches. 9-10 am on the 24th -> the 25th; 10 pm to midnight -> the 25th too
// (midnight itself is not "on" the next day); 11 pm to 1 am -> the 26th.
function timedEndDate(start, end) {
  const last = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start
  return addDays(dateKey(last), 1)
}

// The Google request window: local midnight `past` days before today to
// local midnight `days` after it. Google keeps an event that overlaps it at
// all (timeMin filters on the end, timeMax on the start).
export function fetchWindow(now = new Date(), days = WINDOW_DAYS, past = PAST_DAYS) {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  return { timeMin: new Date(y, m, d - past).toISOString(), timeMax: new Date(y, m, d + days).toISOString() }
}

// GET /api/calendar's query: `days` 1..60 forward (default 3) and `past`
// 0..31 back (default 0), whole numbers; anything else is the default.
export function calendarQuery({ days, past } = {}) {
  const d = Number.parseInt(days ?? '', 10)
  const p = Number.parseInt(past ?? '', 10)
  return {
    days: Number.isFinite(d) ? Math.min(WINDOW_DAYS, Math.max(1, d)) : 3,
    past: Number.isFinite(p) ? Math.min(PAST_DAYS, Math.max(0, p)) : 0,
  }
}

// The local dates a query covers: from (inclusive) and to (exclusive), as
// 'YYYY-MM-DD'.
export function calendarRange(now = new Date(), { days = 3, past = 0 } = {}) {
  const today = dateKey(now)
  return { from: addDays(today, -past), to: addDays(today, days) }
}

// --- events ----------------------------------------------------------------------

// One item of Google's events.list -> the normalized event (without the
// calendar's label / colour), or null when it is not shown.
export function normalizeGoogleEvent(item, calendarId) {
  if (!isDict(item) || item.status === 'cancelled' || item.eventType === 'workingLocation') return null
  const s = isDict(item.start) ? item.start : {}
  const e = isDict(item.end) ? item.end : {}
  const base = {
    id: item.id != null ? String(item.id) : null,
    calendarId: calendarId ?? null,
    title: str(item.summary) || (item.visibility === 'private' ? 'Busy' : '(No title)'),
    description: str(item.description),
    location: str(item.location),
    status: str(item.status) || 'confirmed',
    recurringEventId: str(item.recurringEventId),
    uid: str(item.iCalUID),
  }
  if (typeof s.date === 'string' && DATE_KEY_RE.test(s.date)) {
    const endDate = typeof e.date === 'string' && DATE_KEY_RE.test(e.date) && e.date > s.date ? e.date : addDays(s.date, 1)
    return { ...base, allDay: true, start: null, end: null, startDate: s.date, endDate }
  }
  const start = parseTime(s.dateTime)
  if (!start) return null
  const endRaw = parseTime(e.dateTime)
  const end = endRaw && endRaw.getTime() >= start.getTime() ? endRaw : start
  return {
    ...base,
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: dateKey(start),
    endDate: timedEndDate(start, end),
  }
}

// A fixture entry: Google's raw shape (start: { date | dateTime }) goes
// through the real normalizer; the normalized shape is checked and completed
// (startDate / endDate derived when missing). calendarLabel / color in the
// fixture are used for calendars the registry does not list.
export function normalizeFixtureEvent(e, i = 0) {
  if (!isDict(e)) return null
  if (isDict(e.start) || isDict(e.end)) {
    const ev = normalizeGoogleEvent(e, str(e.calendarId) || str(e.organizer?.email))
    return ev && { ...ev, id: ev.id ?? `fixture-${i}`, calendarLabel: str(e.calendarLabel), color: str(e.color) }
  }
  if (e.status === 'cancelled') return null
  const base = {
    id: e.id != null ? String(e.id) : `fixture-${i}`,
    calendarId: str(e.calendarId),
    calendarLabel: str(e.calendarLabel),
    color: str(e.color),
    title: str(e.title) || '(No title)',
    description: str(e.description),
    location: str(e.location),
    status: str(e.status) || 'confirmed',
    recurringEventId: str(e.recurringEventId),
    uid: str(e.uid) || str(e.iCalUID),
  }
  const start = parseTime(e.start)
  if (e.allDay === true || (!start && typeof e.startDate === 'string')) {
    if (!DATE_KEY_RE.test(String(e.startDate))) return null
    const endDate = DATE_KEY_RE.test(String(e.endDate)) && e.endDate > e.startDate ? e.endDate : addDays(e.startDate, 1)
    return { ...base, allDay: true, start: null, end: null, startDate: e.startDate, endDate }
  }
  if (!start) return null
  const endRaw = parseTime(e.end)
  const end = endRaw && endRaw.getTime() >= start.getTime() ? endRaw : start
  return {
    ...base,
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: dateKey(start),
    endDate: timedEndDate(start, end),
  }
}

// A cached event from disk is only trusted when it can be sorted and placed.
const validEvent = (e) =>
  isDict(e) && typeof e.allDay === 'boolean' && typeof e.startDate === 'string' && typeof e.endDate === 'string' &&
  (e.allDay || (typeof e.start === 'string' && !Number.isNaN(Date.parse(e.start))))

// The wire shape, exactly; internal bookkeeping (uid, recurringEventId) stays in.
// alsoOn: the other listed calendars the same event was on (dedupe below).
export function publicEvent(e) {
  return {
    id: e.id ?? null,
    calendarId: e.calendarId ?? null,
    calendarLabel: e.calendarLabel ?? null,
    color: e.color ?? null,
    title: e.title,
    description: e.description ?? null,
    location: e.location ?? null,
    allDay: e.allDay,
    start: e.start ?? null,
    end: e.end ?? null,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status ?? 'confirmed',
    alsoOn: Array.isArray(e.alsoOn) ? e.alsoOn : [],
  }
}

const sortKey = (e) => (e.allDay ? localMidnight(e.startDate).getTime() : Date.parse(e.start))

// By start; on a tie all-day first, then by title.
export function sortEvents(list) {
  return list.slice().sort((a, b) =>
    sortKey(a) - sortKey(b) ||
    (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) ||
    String(a.title).localeCompare(String(b.title)))
}

// First copy wins: callers pass events in registry calendar order. A later
// copy on another calendar (an invitation between two listed calendars: the
// same iCalUID and start) is dropped, and its calendar is noted on the copy
// kept as `alsoOn: [{ calendarId, calendarLabel, color }]`, in registry
// order. The cached events are never mutated: a kept copy that gains one is
// a new object.
export function dedupe(list) {
  const at = new Map() // key -> index in out
  const out = []
  for (const e of list) {
    const uid = e.uid || e.id
    if (!uid) {
      out.push(e)
      continue
    }
    const k = `${uid}|${e.allDay ? e.startDate : e.start}`
    const i = at.get(k)
    if (i == null) {
      at.set(k, out.length)
      out.push(e)
      continue
    }
    const kept = out[i]
    const also = Array.isArray(kept.alsoOn) ? kept.alsoOn : []
    if (e.calendarId && e.calendarId !== kept.calendarId && !also.some((c) => c.calendarId === e.calendarId)) {
      out[i] = { ...kept, alsoOn: also.concat({ calendarId: e.calendarId, calendarLabel: e.calendarLabel ?? null, color: e.color ?? null }) }
    }
  }
  return out
}

// Events on any day of today - past .. today + days - 1 (local).
export function eventsForDays(events, { now = new Date(), days = 3, past = 0 } = {}) {
  const { from, to } = calendarRange(now, { days, past })
  return events.filter((e) => e.startDate < to && e.endDate > from)
}

// --- auth ------------------------------------------------------------------------

const b64url = (v) => Buffer.from(v).toString('base64url')

// A signed service-account assertion. `now` in ms.
export function signJwt({ clientEmail, privateKey, privateKeyId = null, scope = SCOPE, aud = TOKEN_URL, now = Date.now(), lifetimeSec = 3600 }) {
  const iat = Math.floor(now / 1000)
  const header = privateKeyId ? { alg: 'RS256', typ: 'JWT', kid: privateKeyId } : { alg: 'RS256', typ: 'JWT' }
  const claims = { iss: clientEmail, scope, aud, iat, exp: iat + lifetimeSec }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  let signature
  try {
    signature = createSign('RSA-SHA256').update(input).sign(privateKey)
  } catch (e) {
    throw new Error(`the key file's private_key cannot sign (${e.message})`)
  }
  return `${input}.${b64url(signature)}`
}

// The service account from its JSON key file, or null when there is no file.
// Throws, readably, when the file is there but unusable.
export function readServiceAccount(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw new Error(`cannot read the key file (${e.code || e.message})`)
  }
  let k
  try {
    k = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('the key file is not valid JSON')
  }
  if (!isDict(k) || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') {
    throw new Error('the key file has no client_email / private_key (not a service account JSON key?)')
  }
  return { clientEmail: k.client_email, privateKey: k.private_key, privateKeyId: str(k.private_key_id) }
}

function parseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    return null
  }
}

// Google's two error shapes, as a short message: the token endpoint's
// { error, error_description } and the API's { error: { code, message } }.
function googleMessage(res, data) {
  const e = data?.error
  if (typeof e === 'string') return data.error_description ? `${e}: ${data.error_description}` : e
  if (isDict(e) && typeof e.message === 'string' && e.message) return e.message
  return res.statusText || 'error'
}

// A calendar's failure for the dashboard: "Not Found (HTTP 404; is it shared
// with <service account>?)".
function calendarError(err, clientEmail) {
  if (err.status === 404 || err.status === 403) {
    return `${err.message} (HTTP ${err.status}; is it shared with ${clientEmail}?)`
  }
  return err.status ? `${err.message} (HTTP ${err.status})` : err.message
}

// --- the cache -------------------------------------------------------------------
//
// Per calendar: { ok, fetchedAt, error, events }. `ok` is whether its LAST
// attempt succeeded; `events` is its last good copy, kept through failures,
// so one calendar failing (404, 403, the network) never drops another's.
// What snapshot() reports, derived from that at read time:
//
//   connected  no global problem, and at least one listed calendar fetched in
//              its last attempt (with none listed: the key authenticates)
//   error      null; or a global message (no key, a bad key file, the token
//              exchange, a bad fixture); or the failing calendars as
//              "<id>: <message>" joined with "; "
//   fetchedAt  the latest successful fetch of any listed calendar
//   serviceAccount  the key file's client_email (not a secret: it is the
//              address each calendar must be shared with), or null
//   calendars  [{ id, label, color, ok, error, events: <count> }]
//
// Failures are logged per calendar (and globally), each message at most once
// per 10 minutes, a recovery once. Nothing is logged per request.

export const NO_CALENDARS = 'no calendars configured (shared.calendar.calendars is empty)'

// `endpoints` ({ token, events }) exists for tests against a local mock;
// production always talks to Google.
export function createGoogleCalendar({
  dir,
  getShared,
  keyFile,
  fixtureFile = null,
  log = (m) => console.log(m),
  endpoints = {},
}) {
  const tokenUrl = endpoints.token || TOKEN_URL
  const eventsBase = (endpoints.events || EVENTS_BASE).replace(/\/+$/, '')
  const cacheFile = dir ? join(dir, 'calendar-cache.json') : null
  let byCal = {} // calendarId -> { ok, fetchedAt, error, events }
  let globalError = null
  let keyOk = false // the last token exchange (or cached token) worked
  let keyCheckedAt = null
  let serviceAccount = null // client_email of the key file, as last read
  let token = null // { value, expiresAt, email, keyId }
  let fixture = { stamp: null, events: [], loadedAt: null }
  let inFlight = null
  let rerun = false
  let lastKey = null
  let timer = null
  let healthy = false
  const throttle = new Map() // log key -> { msg, at }

  const inputsKey = (cfg) => JSON.stringify(cfg.calendars.map((c) => c.id))

  // The same message under the same key at most once per 10 minutes.
  function logThrottled(key, msg) {
    const now = Date.now()
    const last = throttle.get(key)
    if (last && last.msg === msg && now - last.at < LOG_REPEAT_MS) return
    throttle.set(key, { msg, at: now })
    log(msg)
  }

  const eventCount = () =>
    fixtureFile ? fixture.events.length : Object.values(byCal).reduce((n, c) => n + c.events.length, 0)

  function view(cfg) {
    if (fixtureFile) {
      return {
        connected: !globalError,
        error: globalError,
        fetchedAt: fixture.loadedAt,
        serviceAccount: null,
        calendars: cfg.calendars.map((c) => ({
          ...c,
          ok: !globalError,
          error: globalError,
          events: fixture.events.filter((e) => e.calendarId === c.id).length,
        })),
      }
    }
    const calendars = cfg.calendars.map((c) => {
      const s = byCal[c.id]
      if (globalError) return { ...c, ok: false, error: globalError, events: s ? s.events.length : 0 }
      if (!s) return { ...c, ok: false, error: 'not fetched yet', events: 0 }
      return { ...c, ok: !!s.ok, error: s.error ?? null, events: s.events.length }
    })
    const listed = calendars.length > 0
    const failing = calendars.filter((c) => c.error).map((c) => `${c.id}: ${c.error}`)
    const times = cfg.calendars.map((c) => byCal[c.id]?.fetchedAt).filter(Boolean).sort()
    return {
      connected: !globalError && (listed ? calendars.some((c) => c.ok) : keyOk),
      error: globalError || (listed ? failing.join('; ') || null : NO_CALENDARS),
      fetchedAt: listed ? times.pop() ?? null : keyCheckedAt,
      serviceAccount,
      calendars,
    }
  }

  function report(reason, cfg) {
    if (globalError) {
      healthy = false
      logThrottled('global', globalError === NO_KEY
        ? `[calendar] ${NO_KEY} at ${keyFile}; /api/calendar stays empty until one is added`
        : `[calendar] ${globalError}${eventCount() ? ' (serving the last copy)' : ''}`)
      return
    }
    throttle.delete('global')
    if (!fixtureFile) {
      if (!cfg.calendars.length) logThrottled('none', `[calendar] ${NO_CALENDARS}`)
      else throttle.delete('none')
      for (const c of cfg.calendars) {
        const s = byCal[c.id]
        const k = `cal:${c.id}`
        if (s?.error) {
          logThrottled(k, `[calendar] ${c.id}: ${s.error}` +
            (s.events.length ? ` (keeping its last ${s.events.length} events)` : ''))
        } else if (s && throttle.has(k)) {
          throttle.delete(k)
          log(`[calendar] ${c.id}: ok again, ${s.events.length} events`)
        }
      }
    }
    const v = view(cfg)
    if (v.connected && !healthy) {
      healthy = true
      const from = fixtureFile
        ? `the fixture ${fixtureFile}`
        : `${v.calendars.filter((c) => c.ok).length} of ${v.calendars.length} calendar(s)`
      log(`[calendar] connected: ${eventCount()} events from ${from} (${reason})`)
    } else if (!v.connected) {
      healthy = false
    }
  }

  function persist(window) {
    if (!cacheFile || fixtureFile) return
    try {
      writeJsonFileAtomic(cacheFile, { savedAt: new Date().toISOString(), window: window ?? null, calendars: byCal })
    } catch (e) {
      log(`[calendar] could not write ${cacheFile}: ${e.message}`)
    }
  }

  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(() => refresh('timer'), REFRESH_MS)
    timer.unref?.()
  }

  async function getToken(key) {
    const now = Date.now()
    if (token && token.email === key.clientEmail && token.keyId === key.privateKeyId && now < token.expiresAt - TOKEN_MARGIN_MS) {
      return token.value
    }
    const assertion = signJwt({ ...key, now })
    const { res, body } = await fetchWithTimeout(tokenUrl, {
      method: 'POST',
      timeoutMs: HTTP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    })
    const data = parseJson(body)
    if (!res.ok || typeof data?.access_token !== 'string') {
      throw new Error(`token exchange failed: ${googleMessage(res, data)} (HTTP ${res.status})`)
    }
    const lifeMs = Number(data.expires_in) > 0 ? Number(data.expires_in) * 1000 : 3600_000
    token = { value: data.access_token, expiresAt: now + lifeMs, email: key.clientEmail, keyId: key.privateKeyId }
    return token.value
  }

  async function listEvents(calendarId, accessToken, window) {
    const items = []
    let pageToken = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(`${eventsBase}/${encodeURIComponent(calendarId)}/events`)
      u.searchParams.set('singleEvents', 'true')
      u.searchParams.set('orderBy', 'startTime')
      u.searchParams.set('timeMin', window.timeMin)
      u.searchParams.set('timeMax', window.timeMax)
      u.searchParams.set('maxResults', '250')
      if (pageToken) u.searchParams.set('pageToken', pageToken)
      const { res, body } = await fetchWithTimeout(u, {
        timeoutMs: HTTP_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      })
      const data = parseJson(body)
      if (!res.ok || !isDict(data)) {
        const err = new Error(googleMessage(res, data))
        err.status = res.status
        throw err
      }
      if (Array.isArray(data.items)) items.push(...data.items)
      pageToken = str(data.nextPageToken)
      if (!pageToken) return items
    }
    throw new Error(`more than ${MAX_PAGES * 250} events in ${PAST_DAYS + WINDOW_DAYS} days; is this the right calendar?`)
  }

  async function fetchGoogle(cfg) {
    serviceAccount = null
    const key = readServiceAccount(keyFile) // throws for an unusable file
    serviceAccount = key?.clientEmail ?? null
    if (!key) {
      byCal = {}
      token = null
      keyOk = false
      globalError = NO_KEY
      return
    }
    // Always exchange (or reuse) a token, even with no calendars listed: that
    // is what proves the key.
    let accessToken = await getToken(key)
    keyOk = true
    keyCheckedAt = new Date().toISOString()
    globalError = null

    const window = fetchWindow(new Date())
    const fetchOne = async (cal) => {
      try {
        return { cal, items: await listEvents(cal.id, accessToken, window) }
      } catch (err) {
        return { cal, err }
      }
    }
    // Independent: one calendar's failure only ever costs that calendar.
    let results = await Promise.all(cfg.calendars.map(fetchOne))
    if (results.some((r) => r.err?.status === 401)) {
      token = null // revoked or expired early: one fresh token, one retry
      try {
        accessToken = await getToken(key)
        results = await Promise.all(results.map((r) => (r.err?.status === 401 ? fetchOne(r.cal) : r)))
      } catch {
        // Keep the 401s as they are; the other calendars' results still count.
      }
    }

    const at = new Date().toISOString()
    const next = {}
    for (const r of results) {
      const prev = byCal[r.cal.id]
      next[r.cal.id] = r.items
        ? { ok: true, fetchedAt: at, error: null, events: r.items.map((it) => normalizeGoogleEvent(it, r.cal.id)).filter(Boolean) }
        : { ok: false, fetchedAt: prev?.fetchedAt ?? null, error: calendarError(r.err, key.clientEmail), events: prev?.events ?? [] }
    }
    byCal = next // calendars no longer listed drop out here
    persist(window)
  }

  // Returns true when it (re)loaded the file.
  function loadFixture(force) {
    let st
    try {
      st = statSync(fixtureFile)
    } catch {
      fixture = { stamp: null, events: [], loadedAt: null }
      globalError = `fixture not found: ${fixtureFile}`
      return false
    }
    const stamp = `${st.mtimeMs}:${st.size}`
    if (!force && stamp === fixture.stamp) return false
    try {
      const raw = JSON.parse(readFileSync(fixtureFile, 'utf8'))
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : null
      if (!list) throw new Error('expected a JSON list of events, or { events: [...] }')
      fixture = { stamp, events: list.map((e, i) => normalizeFixtureEvent(e, i)).filter(Boolean), loadedAt: new Date().toISOString() }
      globalError = null
    } catch (e) {
      fixture = { stamp, events: [], loadedAt: null }
      globalError = `fixture ${fixtureFile}: ${e.message}`
    }
    return true
  }

  // Never rejects: the outcome lands in byCal / globalError, failures in the log.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const cfg = calendarSettings(getShared())
      lastKey = inputsKey(cfg)
      try {
        if (fixtureFile) loadFixture(true)
        else await fetchGoogle(cfg)
      } catch (e) {
        // An unusable key file or a failed token exchange: keep serving the
        // last copies, flagged.
        globalError = e.message
        keyOk = false
      } finally {
        report(reason, cfg)
        inFlight = null
        schedule()
        if (rerun) {
          rerun = false
          if (inputsKey(calendarSettings(getShared())) !== lastKey) refresh('calendars changed')
        }
      }
    })()
    return inFlight
  }

  return {
    // Restore the disk cache, then fetch. Returns what was restored, for the log.
    start() {
      if (!fixtureFile && cacheFile) {
        const c = readJsonFile(cacheFile, null)
        if (isDict(c) && isDict(c.calendars)) {
          for (const [id, v] of Object.entries(c.calendars)) {
            if (!isDict(v) || !Array.isArray(v.events)) continue
            byCal[id] = { ok: !!v.ok, fetchedAt: str(v.fetchedAt), error: str(v.error), events: v.events.filter(validEvent) }
          }
        }
      }
      const times = Object.values(byCal).map((c) => c.fetchedAt).filter(Boolean).sort()
      const restored = { events: eventCount(), fetchedAt: times.pop() ?? null }
      refresh('startup')
      return restored
    },

    // Everything a reader needs, joined with the registry's current labels
    // and colours: { connected, error, fetchedAt, serviceAccount, calendars,
    // settings, events }.
    // Events carry internal fields too; publicEvent() is the wire shape.
    snapshot(shared = getShared()) {
      const cfg = calendarSettings(shared)
      if (fixtureFile && loadFixture(false)) report('fixture changed', cfg)
      const byId = new Map(cfg.calendars.map((c) => [c.id, c]))
      let list
      if (fixtureFile) {
        list = fixture.events.filter((e) => !e.calendarId || byId.has(e.calendarId)).map((e) => {
          const c = byId.get(e.calendarId)
          return { ...e, calendarLabel: c?.label ?? e.calendarLabel ?? null, color: c?.color ?? e.color ?? null }
        })
      } else if (globalError === NO_KEY) {
        list = []
      } else {
        list = cfg.calendars.flatMap((c) =>
          (byCal[c.id]?.events || []).map((e) => ({ ...e, calendarLabel: c.label, color: c.color })))
      }
      return { ...view(cfg), settings: cfg, events: sortEvents(dedupe(list)) }
    },

    // Call with the registry's shared block whenever it may have changed.
    // Cheap: a string compare unless the calendar ids actually moved.
    noteShared(shared) {
      if (inputsKey(calendarSettings(shared)) === lastKey) return
      if (inFlight) rerun = true
      else refresh('calendars changed')
    },

    refresh,
    stop() {
      clearTimeout(timer)
    },
  }
}
