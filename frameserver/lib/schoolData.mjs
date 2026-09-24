// schoolData.mjs - the school lunch menu and the SPS school calendar, fetched
// server-side (a browser would hit CORS) and cached. A port of fetch_lunch,
// get_lunch, fetch_school_cal and get_school_cal from pi/kiosk-server.py,
// moved to the hub on 2026-09-24 so a screen that can only reach the NUC (the
// family-room Echo Show) gets them too.
//
// Response shapes are the Python's exactly; useLunch and useSchoolCalendar run
// unchanged against either host:
//
//   GET /api/lunch?school=<slug>
//     { days: { 'YYYY-MM-DD': { entrees, grabAndGo, items } }, fetchedAt }
//     502 { error, days: {} }                              nothing cached yet
//   GET /api/schoolcal
//     { noSchoolRanges: [{ start, end, summary }], firstDays, lastDays, fetchedAt }
//     502 { error, noSchoolRanges: [], firstDays: [], lastDays: [] }
//
// On a failed fetch both serve the last good copy with a 200, as the Python
// does. Differences from the Python, none visible to a client:
//   - Both caches are also written to disk (schoolcal-cache.json,
//     lunch-cache.json) so a hub restart serves the last good copy at once,
//     including a restart during an upstream outage.
//   - Concurrent requests share one in-flight fetch instead of stampeding.
//   - The school slug is URL-encoded into the MealViewer path. Identical for
//     real slugs ("Lawton"); the Python would have failed on a space.
//   - Python truthiness (`x or default`, `.get()` on a non-dict) is reproduced
//     with small helpers below, so an odd upstream payload fails (and serves
//     stale) exactly where the Python would have, rather than parsing
//     differently.

import { join } from 'node:path'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const MEALVIEWER_BASE = 'https://api.mealviewer.com/api/v4/school'
export const DEFAULT_SCHOOL_SLUG = 'Lawton'
export const SPS_ICS_URL = 'https://www.seattleschools.org/dates/ics/'
const HTTP_TIMEOUT_MS = 10_000
const HTTP_UA = 'KitchenSmartDisplay/1.0 (+kiosk)'
const LUNCH_TTL_MS = 6 * 3600 * 1000 // the menu changes at most daily
const CAL_TTL_MS = 7 * 24 * 3600 * 1000 // the school calendar is static across the year

// --- Python semantics --------------------------------------------------------

function pyType(v) {
  if (v == null) return 'NoneType'
  if (Array.isArray(v)) return 'list'
  if (typeof v === 'object') return 'dict'
  if (typeof v === 'string') return 'str'
  if (typeof v === 'boolean') return 'bool'
  return Number.isInteger(v) ? 'int' : 'float'
}

// Truthiness of a JSON value as Python sees it: [] and {} are falsy.
function truthy(v) {
  if (v == null || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (isDict(v)) return Object.keys(v).length > 0
  return true
}
const or = (v, fallback) => (truthy(v) ? v : fallback)

// d.get(key): AttributeError when d is not a dict.
function get(obj, key) {
  if (!isDict(obj)) throw new TypeError(`'${pyType(obj)}' object has no attribute 'get'`)
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}

// `for x in v`: lists yield items, dicts their keys, strings their characters.
function iter(v) {
  if (Array.isArray(v)) return v
  if (isDict(v)) return Object.keys(v)
  if (typeof v === 'string') return Array.from(v)
  throw new TypeError(`'${pyType(v)}' object is not iterable`)
}

function requireStr(v, method) {
  if (typeof v !== 'string') throw new TypeError(`'${pyType(v)}' object has no attribute '${method}'`)
  return v
}

// str.strip() with Python's whitespace set. JS trim() differs at the edges:
// it also strips U+FEFF and keeps U+001C-001F and U+0085.
const PY_WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'g')
const strip = (v) => requireStr(v, 'strip').replace(STRIP_RE, '')
const lower = (v) => requireStr(v, 'lower').toLowerCase()

// str(v) for the JSON scalars that can plausibly appear.
function pyStr(v) {
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

// datetime.datetime.now().isoformat(): local time, no offset, microseconds
// (omitted when zero). JS only has milliseconds, so they are padded.
export function pyNowIso(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  const base =
    `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  const ms = d.getMilliseconds()
  return ms ? `${base}.${p(ms * 1000, 6)}` : base
}

// --- HTTP --------------------------------------------------------------------

// urllib.request.urlopen semantics: any non-2xx status is an error.
async function httpGet(url) {
  const { res, body } = await fetchWithTimeout(url, {
    timeoutMs: HTTP_TIMEOUT_MS,
    headers: { 'User-Agent': HTTP_UA, Accept: '*/*' },
  })
  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
  return body
}

// --- Lunch menu (MealViewer) -------------------------------------------------

function foodItems(line) {
  const fil = or(get(line, 'foodItemList'), {})
  const items = isDict(fil) ? get(fil, 'data') : fil
  return Array.isArray(items) ? items : []
}

// MealViewer document -> { 'YYYY-MM-DD': { entrees, grabAndGo, items } }.
// Walks menuSchedules -> menuBlocks (blockName "lunch") ->
// cafeteriaLineList.data -> foodItemList.data. Every scheduled date gets an
// entry, even one with no lunch block (empty lists), as in the Python.
export function parseLunch(doc) {
  const days = {}
  for (const day of iter(or(get(doc, 'menuSchedules'), []))) {
    const di = or(get(day, 'dateInformation'), {})
    const dk = pyStr(or(get(di, 'dateKey'), ''))
    if (dk.length !== 8) continue
    const datekey = `${dk.slice(0, 4)}-${dk.slice(4, 6)}-${dk.slice(6, 8)}`
    const entrees = []
    const grab = []
    const items = []
    for (const block of iter(or(get(day, 'menuBlocks'), []))) {
      if (lower(or(get(block, 'blockName'), '')) !== 'lunch') continue
      const cll = or(get(block, 'cafeteriaLineList'), {})
      const lines = isDict(cll) ? get(cll, 'data') : cll
      for (const line of iter(or(lines, []))) {
        for (const it of foodItems(line)) {
          const name = strip(or(get(it, 'item_Name'), ''))
          const cat = lower(strip(or(get(it, 'item_Type'), '')))
          if (!name) continue
          items.push(name)
          if (cat === 'entree') entrees.push(name)
          else if (cat.startsWith('grab')) grab.push(name)
        }
      }
    }
    days[datekey] = { entrees, grabAndGo: grab, items }
  }
  return days
}

// "%m-%d-%Y" of the local date `days` away from `now`.
function mdY(now, days) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${d.getFullYear()}`
}

// A small window around today (yesterday .. +8 days), like the Python.
export async function fetchLunch(slug, now = new Date()) {
  const url = `${MEALVIEWER_BASE}/${encodeURIComponent(slug)}/${mdY(now, -1)}/${mdY(now, 8)}`
  const doc = JSON.parse((await httpGet(url)).toString('utf8'))
  return { days: parseLunch(doc), fetchedAt: pyNowIso() }
}

// --- School calendar (SPS iCal "School Year Dates" feed) ---------------------

// RFC 5545 line folding: CRLF + space/tab continues the previous line.
const icsUnfold = (text) => text.replace(/\r?\n[ \t]/g, '')

function daysInMonth(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(m) ? 30 : 31
}

// The first 8-digit run as a UTC-midnight Date, or null when it is not a real
// date (datetime.date raising ValueError). setUTCFullYear, not Date.UTC, so a
// year below 100 is not read as 19xx.
function icsDate(val) {
  const m = /(\d{8})/.exec(val || '')
  if (!m) return null
  const s = m[1]
  const y = Number(s.slice(0, 4))
  const mo = Number(s.slice(4, 6))
  const d = Number(s.slice(6, 8))
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo - 1, d)
  return dt
}

function isoDate(dt) {
  if (dt.getUTCFullYear() < 1) throw new RangeError('date value out of range') // OverflowError
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(dt.getUTCFullYear(), 4)}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

// Parse the feed's VEVENTs; keep "No School ..." ranges and first/last days.
// DTEND is exclusive for all-day events, so the inclusive end is DTEND - 1
// day. `[^\n]` rather than `.`: Python's `.` matches \r, JS's does not.
export function parseSchoolCal(text) {
  const ranges = []
  const firstDays = []
  const lastDays = []
  for (const chunk of icsUnfold(text).split('BEGIN:VEVENT').slice(1)) {
    const body = chunk.split('END:VEVENT')[0]
    const sm = /\nSUMMARY:([^\n]+)/.exec(body)
    const ds = /\nDTSTART[^:\n]*:([0-9T]+)/.exec(body)
    const de = /\nDTEND[^:\n]*:([0-9T]+)/.exec(body)
    if (!sm || !ds) continue
    const summary = strip(sm[1])
    const start = icsDate(ds[1])
    if (!start) continue
    const end = de ? icsDate(de[1]) : null
    let incEnd = start
    if (end) {
      incEnd = new Date(end)
      incEnd.setUTCDate(incEnd.getUTCDate() - 1)
    }
    const low = summary.toLowerCase()
    if (low.startsWith('no school')) {
      ranges.push({ start: isoDate(start), end: isoDate(incEnd), summary })
    }
    if (low.includes('first day of school')) firstDays.push(isoDate(start))
    if (low.includes('last day of school')) lastDays.push(isoDate(start))
  }
  return { noSchoolRanges: ranges, firstDays: firstDays.sort(), lastDays: lastDays.sort() }
}

export async function fetchSchoolCal() {
  // .toString('utf8') replaces invalid bytes, like .decode('utf-8', 'replace').
  const text = (await httpGet(SPS_ICS_URL)).toString('utf8')
  return { ...parseSchoolCal(text), fetchedAt: pyNowIso() }
}

// --- Caches ------------------------------------------------------------------
// Same single-slot caches as the Python (_lunch_cache keyed by one slug,
// _cal_cache), plus a disk copy. `at` is the epoch ms the fetch started, as
// the Python's `now` was taken before fetching.

let calCache = { data: null, at: 0 }
let lunchCache = { data: null, at: 0, slug: null }
let calInFlight = null
let lunchInFlight = null // { slug, promise }
let calFile = null
let lunchFile = null
let log = (msg) => console.log(msg)

// A clock that jumps backwards must not make a cache fresh forever.
const fresh = (at, now, ttl) => now - at >= 0 && now - at < ttl

const validCal = (d) =>
  isDict(d) && Array.isArray(d.noSchoolRanges) && Array.isArray(d.firstDays) && Array.isArray(d.lastDays)
const validLunch = (d) => isDict(d) && isDict(d.days)

function persist(file, value) {
  if (!file) return
  try {
    writeJsonFileAtomic(file, value)
  } catch (e) {
    log(`[school] could not write ${file}: ${e.message}`)
  }
}

// Point the disk caches at `dir` and load whatever is there. Without this the
// module still works, in memory only (tests).
export function initSchoolData({ dir, logger } = {}) {
  if (logger) log = logger
  if (!dir) return { calendar: null, lunch: null }
  calFile = join(dir, 'schoolcal-cache.json')
  lunchFile = join(dir, 'lunch-cache.json')
  const cal = readJsonFile(calFile, null)
  if (isDict(cal) && validCal(cal.data)) calCache = { data: cal.data, at: Number(cal.at) || 0 }
  const lunch = readJsonFile(lunchFile, null)
  if (isDict(lunch) && validLunch(lunch.data) && typeof lunch.slug === 'string') {
    lunchCache = { data: lunch.data, at: Number(lunch.at) || 0, slug: lunch.slug }
  }
  return {
    calendar: calCache.data ? calCache.data.fetchedAt || 'yes' : null,
    lunch: lunchCache.data ? `${lunchCache.slug} ${lunchCache.data.fetchedAt || ''}`.trim() : null,
  }
}

// The cached calendar, however old, or null. Never fetches: this feeds
// noSchoolToday in every GET /api/state, which must not wait on SPS. A stale
// calendar is far better than none (the dates are static for the year).
export function getCachedSchoolCal() {
  return calCache.data
}

export async function getSchoolCal() {
  const now = Date.now()
  if (calCache.data && fresh(calCache.at, now, CAL_TTL_MS)) return calCache.data
  if (calInFlight) return calInFlight
  calInFlight = (async () => {
    try {
      const data = await fetchSchoolCal()
      calCache = { data, at: now }
      persist(calFile, calCache)
      log(`[schoolcal] fetched: ${data.noSchoolRanges.length} no-school ranges, first days ${data.firstDays.join(' ')}`)
      return data
    } finally {
      calInFlight = null
    }
  })()
  return calInFlight
}

export async function getLunch(slug) {
  const now = Date.now()
  const c = lunchCache
  if (c.data && c.slug === slug && fresh(c.at, now, LUNCH_TTL_MS)) return c.data
  if (lunchInFlight && lunchInFlight.slug === slug) return lunchInFlight.promise
  const promise = (async () => {
    try {
      const data = await fetchLunch(slug)
      lunchCache = { data, at: now, slug }
      persist(lunchFile, lunchCache)
      return data
    } finally {
      if (lunchInFlight && lunchInFlight.promise === promise) lunchInFlight = null
    }
  })()
  lunchInFlight = { slug, promise }
  return promise
}

// Route bodies, as { status, body }. Serve stale on error, exactly like the
// Python handler (including the lunch cache being served for any slug).
export async function schoolCalResponse() {
  try {
    return { status: 200, body: await getSchoolCal() }
  } catch (e) {
    log(`[schoolcal] fetch failed: ${e.message}${calCache.data ? ' (serving stale)' : ''}`)
    if (calCache.data) return { status: 200, body: calCache.data }
    return { status: 502, body: { error: String(e.message || e), noSchoolRanges: [], firstDays: [], lastDays: [] } }
  }
}

export async function lunchResponse(slug) {
  try {
    return { status: 200, body: await getLunch(slug) }
  } catch (e) {
    log(`[lunch] ${slug}: fetch failed: ${e.message}${lunchCache.data ? ' (serving stale)' : ''}`)
    if (lunchCache.data) return { status: 200, body: lunchCache.data }
    return { status: 502, body: { error: String(e.message || e), days: {} } }
  }
}

// Fill the calendar cache ahead of the first screen asking, so noSchoolToday
// in /api/state is right from the hub's first minute. A no-op while the cache
// is fresh (7 days). Never throws.
export async function warmSchoolCal() {
  try {
    await getSchoolCal()
  } catch (e) {
    log(`[schoolcal] warm-up failed: ${e.message}${calCache.data ? ' (keeping the cached copy)' : ''}`)
  }
}
