#!/usr/bin/env node
// FrameServer - the Smart Display hub.
//
// Runs as a Windows service on the NUC (C:\Services\FrameServer). Since
// 2026-09-24 it is the only server a screen needs: it serves the web app
// itself, the photos, every screen's settings, the shared house state, lunch,
// the school calendar, the photo-flag queue and Sonos. The kitchen Pi keeps
// only its own panel hardware (wlr-randr power, ddcutil brightness). See
// docs/designs/echo-show-and-hub.md.
//
//   GET  / , /index.html              the web app (Vite build in APP_DIR),
//                                     with the hub marker meta injected
//   GET  /editor/                     the layout editor (editor.html, same
//                                     marker); ?device=<id>
//   GET  /assets/*, /icons/*, ...     the rest of the build
//   GET  /stub-photos/manifest.json   the manifest, no-store
//   GET  /stub-photos/<file>          a derivative JPEG
//   POST /api/photos/refresh          start a rebuild (409 if one is running)
//   GET  /api/photos/refresh/status   {running, lastRun, ok, photoCount, error}
//   GET  /api/albums                  album index for the dashboard
//   GET  /admin                       the dashboard
//   ...  /api/devices, /api/settings  the device registry (below)
//   POST /api/devices/<id>/health     a screen's heartbeat, JSON <= 1 KB -> 204
//   GET  /api/devices/<id>/health     its latest report, age and power events
//   GET  /api/health/events?limit=N   the newest power events (lib/health.mjs)
//   GET|POST /api/state               shared house state (lib/houseState.mjs)
//   GET  /api/schoolcal               SPS calendar (lib/schoolData.mjs)
//   GET  /api/lunch?school=<slug>     MealViewer lunch (lib/schoolData.mjs)
//   GET|POST /api/flags, POST /api/flags/resolve, /api/flags/import
//                                     photo-flag queue (lib/flags.mjs)
//   GET  /api/sonos/*                 proxy to node-sonos-http-api
//   GET  /api/calendar?days=N&past=P  Google Calendar events + countdown tiles:
//                                     days 1..60 ahead, past 0..31 back
//                                     (lib/googleCalendar.mjs, lib/countdowns.mjs)
//   GET  /api/countdown-art           the Countdown Art index (lib/countdownArt.mjs)
//   POST /api/countdown-art/refresh   sync it from Immich now (409 if one is running)
//   GET  /countdown-art/<file>        one art image
//   GET  /api/plex/now                what Plex is playing, normalized (lib/plex.mjs)
//   GET  /api/plex/players            every Plex player seen (the follow select)
//   POST /api/plex/command            {machineId, action}: transport, relayed to
//                                     a player that advertises (Plex Companion)
//   GET  /api/plex/person?tmdbId=&name=&exclude=
//                                     a person card: TMDB (lib/tmdb.mjs) + what
//                                     else of theirs is in the Plex library
//   GET  /api/plex/image?path=&w=&h=  a Plex image, the token added here
//   GET  /api/weather                 the one weather feed (lib/weather.mjs):
//                                     Apple WeatherKit when configured, else
//                                     Open-Meteo, with automatic fallback
//   GET  /api/ha/state                Home Assistant snapshot (lib/homeAssistant.mjs)
//   POST /api/ha/action               {actionId, screen, data?}: run a whitelisted action
//   GET  /api/ha/entities?q=          live HA entity search, for the dashboard's Add box
//   GET  /api/ha/actions/log?limit=N  the newest logged action attempts
//   GET  /healthz                     liveness + a glance at everything
//
// Secrets and keys come from the environment or the service root's .env
// (lib/env.mjs; the environment wins): IMMICH_URL, IMMICH_API_KEY,
// GOOGLE_CALENDAR_KEY_FILE (default secrets/google-calendar.json, the service
// account key, never in git), GOOGLE_CALENDAR_FIXTURE (tests). The Entry board
// additions are specified in docs/designs/entry-board.md. The Plex second
// screen: PLEX_URL (default http://127.0.0.1:32400, Plex on this box),
// PLEX_TOKEN or the file PLEX_TOKEN_FILE (default secrets/plex-token.txt),
// TMDB_API_KEY or the file TMDB_API_KEY_FILE (default secrets/tmdb-key.txt,
// optional), PLEX_FIXTURE (tests). WeatherKit (docs/designs/panels-and-controls.md,
// "One weather feed"): WEATHERKIT_KEY_FILE (default secrets/weatherkit.p8, never
// in git), WEATHERKIT_TEAM_ID, WEATHERKIT_KEY_ID, WEATHERKIT_SERVICE_ID,
// WEATHER_SOURCE (auto|weatherkit|open-meteo, default auto). Home Assistant
// (lib/homeAssistant.mjs): HA_URL and HA_TOKEN or HA_TOKEN_FILE (default
// secrets/ha-token.txt). Keys and tokens are never logged.
//
// Paths stay `/stub-photos/...` because that prefix is baked into every
// manifest entry's `src` (build-photo-manifest.mjs) and into both clients.
// Renaming it would mean a coordinated rebuild + tvOS deploy for no gain.
//
// CORS is wide open: the kitchen app is served from the Pi but fetches
// everything here, which is cross-origin. LAN-only service, so allow-all is
// the right level of ceremony.
//
// lib/*.mjs sits next to this file (C:\Services\FrameServer\lib\ on the NUC)
// and is imported relative to it, not to FRAMESERVER_ROOT.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './lib/io.mjs'
import { loadEnvFile } from './lib/env.mjs'
import { acceptStatePost, composeState } from './lib/houseState.mjs'
import { createTravelDefault } from './lib/travelDefault.mjs'
import { createFlags } from './lib/flags.mjs'
import { MAX_REPORT_BYTES, createHealth } from './lib/health.mjs'
import {
  calendarQuery,
  calendarRange,
  calendarSettings,
  createGoogleCalendar,
  eventsForDays,
  publicEvent,
} from './lib/googleCalendar.mjs'
import { buildCountdowns } from './lib/countdowns.mjs'
import { ART_EXTS, createCountdownArt } from './lib/countdownArt.mjs'
import { createAirQuality } from './lib/airQuality.mjs'
import { getForecast, startWeatherRefresher } from './lib/hubWeather.mjs'
import { brief as weatherBrief, getWeather } from './lib/weather.mjs'
import { alertsHealth, getAlerts, startAlertsRefresher, weatherAlertsFor } from './lib/nwsAlerts.mjs'
import { headlineFor } from './lib/headline.mjs'
import { DEFAULT_PLEX_URL, createPlex } from './lib/plex.mjs'
import { createTmdb } from './lib/tmdb.mjs'
import { createHomeAssistant } from './lib/homeAssistant.mjs'
import {
  DEFAULT_SCHOOL_SLUG,
  getCachedSchoolCal,
  initSchoolData,
  lunchResponse,
  schoolCalResponse,
  warmSchoolCal,
} from './lib/schoolData.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.FRAMESERVER_ROOT || resolve(__dirname)
// Before anything below reads process.env. Names only are logged, never values.
const ENV_FILE = loadEnvFile(join(ROOT, '.env'))
const ENV_KEYS = [
  'IMMICH_URL', 'IMMICH_API_KEY', 'GOOGLE_CALENDAR_KEY_FILE', 'GOOGLE_CALENDAR_FIXTURE',
  'PLEX_URL', 'PLEX_TOKEN', 'PLEX_TOKEN_FILE', 'PLEX_FIXTURE', 'TMDB_API_KEY', 'TMDB_API_KEY_FILE',
  'WEATHERKIT_KEY_FILE', 'WEATHERKIT_TEAM_ID', 'WEATHERKIT_KEY_ID', 'WEATHERKIT_SERVICE_ID', 'WEATHER_SOURCE',
  'HA_URL', 'HA_TOKEN', 'HA_TOKEN_FILE',
]
const PHOTOS_DIR = process.env.STUB_PHOTOS_DIR || join(ROOT, 'photos')
const SCRIPTS_DIR = process.env.FRAMESERVER_SCRIPTS_DIR || join(ROOT, 'scripts')
// The Vite build of code/ (index.html, assets/, icons/, build.json, ...).
const APP_DIR = process.env.FRAMESERVER_APP_DIR || join(ROOT, 'app')
// node-sonos-http-api on this box (nssm service SmartDisplaySonosAPI), bound
// to loopback so the proxy below is the only way in from the LAN.
const SONOS_UPSTREAM = (process.env.SONOS_UPSTREAM || 'http://127.0.0.1:5005').replace(/\/+$/, '')
const STATUS_FILE = join(ROOT, 'refresh-status.json')
const STATE_FILE = join(ROOT, 'state.json')
const FLAGS_FILE = join(ROOT, 'flags.json')
const PORT = Number(process.env.FRAMESERVER_PORT || 8095)
// The Google service account's JSON key: copied to the hub by hand, never in
// git. Relative values resolve against ROOT.
const CALENDAR_KEY_FILE = resolve(ROOT, process.env.GOOGLE_CALENDAR_KEY_FILE || join('secrets', 'google-calendar.json'))
const CALENDAR_FIXTURE = process.env.GOOGLE_CALENDAR_FIXTURE ? resolve(ROOT, process.env.GOOGLE_CALENDAR_FIXTURE) : null
const ART_DIR = join(ROOT, 'countdown-art')
const BIND = process.env.FRAMESERVER_BIND || '0.0.0.0'
// Plex Media Server runs on this box; its token is copied here by hand. TMDB
// (optional) fills the Plex view's cast pictures and person cards. Relative
// file values resolve against ROOT, like the calendar key.
const PLEX_URL = (process.env.PLEX_URL || DEFAULT_PLEX_URL).replace(/\/+$/, '')
const PLEX_TOKEN_FILE = resolve(ROOT, process.env.PLEX_TOKEN_FILE || join('secrets', 'plex-token.txt'))
const PLEX_FIXTURE = process.env.PLEX_FIXTURE ? resolve(ROOT, process.env.PLEX_FIXTURE) : null
const TMDB_KEY_FILE = resolve(ROOT, process.env.TMDB_API_KEY_FILE || join('secrets', 'tmdb-key.txt'))

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

// --- refresh state -----------------------------------------------------------
// Single-flight in-process. The nightly Scheduled Task runs the same script, so
// a rebuild can also be started from outside; the lock below only guards against
// this process stacking two at once, which is the case the button can cause.
let running = false

function readStatus() {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8'))
  } catch {
    return { running: false, lastRun: null, ok: null, error: null, photoCount: null }
  }
}

function writeStatus(obj) {
  const tmp = STATUS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, STATUS_FILE) // atomic; clients poll this while a build runs
}

function countPhotos() {
  try {
    return JSON.parse(readFileSync(join(PHOTOS_DIR, 'manifest.json'), 'utf8')).photos.length
  } catch {
    return null
  }
}

function startRefresh(trigger) {
  if (running) return false
  running = true
  const startedAt = new Date().toISOString()
  writeStatus({ running: true, startedAt, trigger })

  const child = spawn(
    process.execPath,
    ['--env-file=' + join(ROOT, '.env'), 'build-photo-manifest.mjs'],
    { cwd: SCRIPTS_DIR, windowsHide: true },
  )
  let tail = ''
  const keep = (buf) => { tail = (tail + buf.toString()).slice(-4000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)

  child.on('close', (code) => {
    running = false
    writeStatus({
      running: false,
      startedAt,
      trigger,
      finishedAt: new Date().toISOString(),
      lastRun: new Date().toISOString(),
      ok: code === 0,
      error: code === 0 ? null : `build exited ${code}: ${tail.slice(-500)}`,
      photoCount: countPhotos(),
    })
  })
  child.on('error', (err) => {
    running = false
    writeStatus({
      running: false, startedAt, trigger,
      finishedAt: new Date().toISOString(), lastRun: new Date().toISOString(),
      ok: false, error: String(err), photoCount: countPhotos(),
    })
  })
  return true
}

// --- device registry ---------------------------------------------------------
// devices.json is the source of truth for what each screen shows. It replaces
// the old model where the kitchen's localStorage was master and pushed a
// three-key subset to the Pi's /api/state, which could not express "the living
// room shows different albums than the kitchen".
//
//   { shared:  { location, school, timerThresholds, weatherSlots },
//     devices: { "<id>": { name, kind, createdAt, seededFrom?, config: { slideshow, display, sonos } } } }
//
// Shared = one value for the family. Config = per screen. Values are stored
// per-field rather than as opaque blobs so a `locked` flag could be added later
// without reshaping the file (locking is deliberately not implemented).
const REGISTRY_FILE = join(ROOT, 'devices.json')

function readRegistry() {
  try {
    const r = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
    return { shared: r.shared || {}, devices: r.devices || {} }
  } catch {
    return { shared: {}, devices: {} }
  }
}

function writeRegistry(reg) {
  const tmp = REGISTRY_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(reg, null, 2))
  renameSync(tmp, REGISTRY_FILE) // atomic: clients poll this
}

// Mirrors deepMerge in code/src/lib/settings.js: objects merge, arrays replace
// wholesale. Replacing arrays matters - selectedAlbumIds and schoolDays are
// sets the user edits by replacement, not by append.
function deepMerge(base, override) {
  if (override == null || typeof override !== 'object') return base
  if (Array.isArray(override)) return override
  const out = { ...base }
  for (const k of Object.keys(override)) {
    const b = base?.[k]
    const o = override[k]
    out[k] = b && o && typeof b === 'object' && typeof o === 'object' &&
             !Array.isArray(b) && !Array.isArray(o)
      ? deepMerge(b, o)
      : o
  }
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (c) => {
      size += c.length
      if (size > 1_000_000) tooLarge = true
      else chunks.push(c)
    })
    req.on('end', () => {
      if (tooLarge) return reject(new Error('body too large'))
      // Join the bytes before decoding: a multi-byte character (a caption like
      // "Zürich") split across two chunks would otherwise decode as garbage.
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// What a brand-new screen may inherit from an existing one (seedFrom): taste,
// not plumbing. The albums and slide timing, the Sonos ROOM, and when the house
// goes dim / dark / wakes. Never sonos.apiBase (a per-host URL; the kitchen's
// stored value was a stale http://localhost:5005), never `command` (a one-shot
// dashboard action meant for the seed screen), never anything else.
const SEED_DISPLAY_KEYS = ['dimAt', 'offAt', 'wakeAt', 'wakeBrightness', 'eveningBrightness']

function seedSubset(cfg) {
  const out = {}
  if (!isDict(cfg)) return out
  if (isDict(cfg.slideshow)) out.slideshow = structuredClone(cfg.slideshow)
  if (isDict(cfg.sonos) && cfg.sonos.room !== undefined) out.sonos = { room: cfg.sonos.room }
  if (isDict(cfg.display)) {
    const d = {}
    for (const k of SEED_DISPLAY_KEYS) {
      if (cfg.display[k] !== undefined) d[k] = structuredClone(cfg.display[k])
    }
    if (Object.keys(d).length) out.display = d
  }
  return out
}

// Register (or look up) a device. A device that already exists is NEVER
// overwritten by its own registration - it just gets its stored config back.
// That is what makes registration self-seeding: the first run of a new build
// hands over whatever the device had locally, so live values survive the
// migration instead of being reset to code defaults. The kitchen is currently
// running drivingDepart 7:38 against a 7:42 default; resetting that would shift
// the family's morning timer by four minutes.
//
// seedFrom: a NEW screen can start from another screen's settings instead of
// its own code defaults (the family-room Echo seeds from the kitchen). Applied
// once, at creation; afterwards the two are independent.
function registerDevice({ id, name, kind, config, shared, seedFrom }) {
  const reg = readRegistry()
  const existing = reg.devices[id]
  let changed = false

  if (!existing) {
    const own = isDict(config) ? config : {}
    const seed = typeof seedFrom === 'string' && seedFrom !== id ? reg.devices[seedFrom] : null
    const entry = { name: name || id, kind: kind || 'unknown', createdAt: new Date().toISOString() }
    if (seed) {
      entry.seededFrom = seedFrom
      // The seed's values win over the new screen's defaults for the seeded
      // keys; its own keys (e.g. display.nightFace) survive.
      entry.config = deepMerge(own, seedSubset(seed.config))
    } else {
      entry.config = own
    }
    reg.devices[id] = entry
    changed = true
  } else if (name && existing.name !== name && kind == null && config == null) {
    // A rename from the dashboard reuses this route with only { id, name }.
    // A screen's own self-registration always carries kind and config and
    // sends name = its id, and must not undo a rename made on the dashboard
    // (it did, on every page load, until 2026-09-24).
    existing.name = name
    changed = true
  }

  // Seed house-wide settings from the first device that offers them, and only
  // while they are still empty. Later registrations must not clobber values the
  // dashboard or another screen has since edited.
  if (shared && typeof shared === 'object' && Object.keys(reg.shared).length === 0) {
    reg.shared = shared
    changed = true
  }

  if (changed) writeRegistry(reg)
  return reg
}

// When each screen last polled its config: the "which screen is down" glance
// for the dashboard. In memory only - writing it to devices.json would rewrite
// that file every few seconds - so it starts empty after a restart and fills
// within one poll interval (10 s web, 30 s TV).
const lastSeen = new Map()
const markSeen = (id) => lastSeen.set(id, new Date().toISOString())

// Each web screen's viewport in CSS pixels, from the ?screen=WxH its config
// poll carries: the layout editor draws that screen's canvas at this size
// (docs/designs/layout-editor.md). In memory only, like lastSeen, and for the
// same reason; it refills within one poll after a restart. A missing or
// malformed value leaves the last good one in place.
const screens = new Map()
function noteScreen(id, raw) {
  const m = /^(\d{1,4})x(\d{1,4})$/i.exec(String(raw ?? ''))
  if (!m) return
  const w = Number(m[1])
  const h = Number(m[2])
  if (w >= 1 && w <= 8192 && h >= 1 && h <= 8192) screens.set(id, { w, h })
}
const screenOf = (id) => screens.get(id) ?? null
const deviceView = (id, d, shared) => ({
  id, ...d, lastSeenAt: lastSeen.get(id) ?? null, screen: screenOf(id), shared,
})

// --- layout history --------------------------------------------------------------
// Every change to a screen's config.layouts (the layout editor's Save and
// Reset) keeps the PREVIOUS value here, ten per screen, so a bad save is one
// PATCH away from undone until the editor grows a history menu (step 3 of
// docs/designs/layout-editor.md):
//   GET /api/devices/<id>/layout-history -> [{ at, layouts }] newest first
//   PATCH /api/devices/<id>/config with { layouts: <entry.layouts> } restores.
const LAYOUT_HISTORY_FILE = join(ROOT, 'layout-history.json')
const LAYOUT_HISTORY_MAX = 10

function recordLayoutHistory(id, before, after) {
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return
  const all = readJsonFile(LAYOUT_HISTORY_FILE, {})
  const list = Array.isArray(all[id]) ? all[id] : []
  list.unshift({ at: new Date().toISOString(), layouts: before ?? null })
  all[id] = list.slice(0, LAYOUT_HISTORY_MAX)
  try {
    writeJsonFileAtomic(LAYOUT_HISTORY_FILE, all, true)
  } catch (e) {
    console.warn(`[layouts] could not write history: ${e.message}`)
  }
}

// --- house state, school data, flags -----------------------------------------

const cachedSchool = initSchoolData({ dir: ROOT })
const flags = createFlags(FLAGS_FILE)
// Screens' heartbeats and the power events they raise (lib/health.mjs).
const health = createHealth({ dir: ROOT })
const travel = createTravelDefault({ dir: ROOT, getShared: () => readRegistry().shared })

// --- Entry board: calendar, countdown art, air quality (docs/designs/entry-board.md)
const getShared = () => readRegistry().shared
const calendar = createGoogleCalendar({
  dir: ROOT,
  getShared,
  keyFile: CALENDAR_KEY_FILE,
  fixtureFile: CALENDAR_FIXTURE,
})
const art = createCountdownArt({
  dir: ART_DIR,
  getConfig: () => ({ url: process.env.IMMICH_URL, apiKey: process.env.IMMICH_API_KEY }),
})
const air = createAirQuality({ dir: ROOT, getShared })

// --- Plex second screen (lib/plex.mjs, lib/tmdb.mjs) ---------------------------
// A secret from the environment (or .env), else its file, re-read at most once
// a minute: adding or rotating one needs no restart. The value never leaves
// the process except in a request header or query to its own service.
function secretFrom(envName, file) {
  let readAt = 0
  let value = null
  return () => {
    const env = process.env[envName]
    if (typeof env === 'string' && env.trim()) return env.trim()
    if (Date.now() - readAt > 60_000) {
      readAt = Date.now()
      try {
        value = readFileSync(file, 'utf8').trim() || null
      } catch {
        value = null
      }
    }
    return value
  }
}
const tmdb = createTmdb({ getKey: secretFrom('TMDB_API_KEY', TMDB_KEY_FILE) })
const plex = createPlex({
  dir: ROOT,
  url: PLEX_URL,
  getToken: secretFrom('PLEX_TOKEN', PLEX_TOKEN_FILE),
  tmdb,
  fixtureFile: PLEX_FIXTURE,
})

// Everything derived from the shared settings refreshes as soon as its inputs
// move: location and departure hour (travel default, air quality), the
// calendar list (Google). Each is a string compare unless something changed.
function noteShared(shared) {
  travel.noteShared(shared)
  air.noteShared(shared)
  calendar.noteShared(shared)
}

// The one write path for shared settings: the dashboard's PATCH route below
// and lib/homeAssistant.mjs's one-time whitelist seed both go through this,
// so every writer re-notifies the same derived modules the same way.
function patchShared(partial) {
  const reg = readRegistry()
  reg.shared = deepMerge(reg.shared, partial)
  writeRegistry(reg)
  noteShared(reg.shared)
  return reg.shared
}

// --- Home Assistant (lib/homeAssistant.mjs): a whitelisted read/action layer ---
const ha = createHomeAssistant({ dir: ROOT, getShared, patchShared, log: (m) => console.log(m) })

// state.json holds ONLY { countdown } - the user's decisions. Everything else
// in /api/state is derived or owned elsewhere (registry, calendar, forecast).
function readStoredState() {
  const v = readJsonFile(STATE_FILE, {})
  return isDict(v) ? v : {}
}

function currentState(now = new Date()) {
  const registry = readRegistry()
  // Picks up a location / departure-hour / calendar edit made by any route (or
  // by hand) without every writer having to remember to poke each module.
  noteShared(registry.shared)
  const state = composeState({
    now,
    registry,
    stored: readStoredState(),
    calendar: getCachedSchoolCal(),
    travelDefault: travel.current(now),
  })
  // The Entry board's line, the same on every screen: headline.mjs over every
  // cached event (31 days back to 60 ahead; it needs today's and tomorrow's,
  // and reads nothing earlier), the hub's own
  // forecast (lib/hubWeather.mjs's adapter over lib/weather.mjs) and the
  // alerts NWS and WeatherKit both report, merged and deduped
  // (lib/weather.mjs's getWeather().alerts); the alerts in force, most severe
  // first, at most 3; and the air quality chip (null without a reading from
  // the last 6 hours).
  const forecast = getForecast(now)
  const alerts = getWeather(now).alerts
  state.headline = headlineFor({ now, events: calendar.snapshot(registry.shared).events, forecast, alerts })
  state.weatherAlerts = weatherAlertsFor(alerts, now)
  state.airQuality = air.current(now)
  // Home Assistant indicator states (garage, locks, modes, ...) folded into
  // house state so a screen polling here never needs a second poll for them.
  state.ha = ha.compact()
  return state
}

// GET /api/calendar?days=N&past=P (calendarQuery): `days` 1..60 ahead,
// default 3; `past` 0..31 back, default 0. The app asks for 6 and 0 (the
// agenda) unless a calendar view on screen wants more (hooks/useCalendar.js).
//
// Answers from the cache the 5-minute refresh keeps; never waits on Google.
// `events` is the window only, sorted by start; `from` and `to` are the local
// dates it covers (to exclusive); countdowns look at everything cached from
// today on (60 days ahead), whatever the window.
function calendarResponse(now, { days, past }) {
  const shared = readRegistry().shared
  calendar.noteShared(shared)
  const snap = calendar.snapshot(shared)
  return {
    connected: snap.connected,
    error: snap.error,
    fetchedAt: snap.fetchedAt,
    // The address to share each calendar with, for the dashboard; null
    // without a (readable) key file, or in fixture mode.
    serviceAccount: snap.serviceAccount,
    days,
    past,
    ...calendarRange(now, { days, past }),
    calendars: snap.calendars,
    events: eventsForDays(snap.events, { now, days, past }).map(publicEvent),
    countdowns: buildCountdowns(snap.events, {
      now,
      artIndex: art.items(),
      defaultLeadDays: snap.settings.countdownLeadDays,
      max: snap.settings.countdownMax,
    }),
  }
}

const loggedLegacyStateKeys = new Set()

// --- http --------------------------------------------------------------------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  // PATCH is what the screens send for settings writes (settings.js hubPatch);
  // without it here the browser's preflight fails and every write from a
  // screen is dropped silently, reverted by the next poll. Found 2026-09-04.
  // DELETE is the dashboard's "Remove screen".
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body))
  cors(res)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  })
  res.end(buf)
}

// Map a URL path onto a file inside `base`, or null when it cannot be one:
// a malformed escape, a NUL byte, or anything that resolves outside `base`.
// normalize() collapses ../ first, and the containment check (with the
// trailing separator, so a sibling like photos-old is not "inside" photos)
// catches whatever still escapes.
function resolveInside(base, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const rel = normalize(decoded).replace(/^([/\\])+/, '')
  const root = resolve(base)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) return null
  return { full, rel }
}

// Stream a stat()ed file. With `ranges`, a single `bytes=a-b` Range is
// honoured: Chromium loops an <audio> (the Echo's silent keep-alive) far more
// reliably from a seekable source.
function sendFile(req, res, full, st, headers, { ranges = false } = {}) {
  let start = 0
  let end = st.size - 1
  let status = 200
  if (ranges) {
    headers['Accept-Ranges'] = 'bytes'
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1])
        if (m[2]) end = Math.min(Number(m[2]), st.size - 1)
      } else {
        start = Math.max(0, st.size - Number(m[2])) // suffix: the last N bytes
      }
      if (start > end || start >= st.size) {
        cors(res)
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, 'Cache-Control': 'no-store' })
        return res.end()
      }
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`
    }
  }
  headers['Content-Length'] = Math.max(0, end - start + 1)
  cors(res)
  res.writeHead(status, headers)
  if (req.method === 'HEAD' || st.size === 0) return res.end()
  // A file replaced mid-read (a deploy, the nightly photo build) must drop
  // this one response, not crash the service on an unhandled stream error.
  const stream = createReadStream(full, { start, end })
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

async function statFile(full) {
  try {
    const st = await stat(full)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

async function serveFile(req, res, urlPath) {
  const hit = resolveInside(PHOTOS_DIR, urlPath)
  if (!hit) return json(res, 403, { error: 'forbidden' })
  const st = await statFile(hit.full)
  if (!st) return json(res, 404, { error: 'not found' })

  const isManifest = hit.full.endsWith('manifest.json')
  return sendFile(req, res, hit.full, st, {
    'Content-Type': MIME[extname(hit.full).toLowerCase()] || 'application/octet-stream',
    // The manifest is polled every 5 min and must never be stale. The JPEGs are
    // immutable per filename (asset id), so they can cache hard.
    'Cache-Control': isManifest ? 'no-store' : 'public, max-age=604800',
  })
}

// Countdown Art images. A file is named by its Immich asset id, which never
// changes meaning, so it caches for a week. Images only, top level only:
// index.json is served by /api/countdown-art.
async function serveArtFile(req, res, urlPath) {
  const hit = resolveInside(ART_DIR, urlPath)
  if (!hit) return json(res, 403, { error: 'forbidden' })
  const ext = extname(hit.full).toLowerCase()
  if (!ART_EXTS.has(ext) || /[\\/]/.test(hit.rel)) return json(res, 404, { error: 'not found' })
  const st = await statFile(hit.full)
  if (!st) return json(res, 404, { error: 'not found' })
  return sendFile(req, res, hit.full, st, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=604800',
  })
}

// --- the web app ---------------------------------------------------------------
// Silk on the family-room Echo Show cannot resolve nuc.local, so the Echo
// loads the app from here by IP (http://192.168.4.61:8095/?kiosk=echo). The
// marker tells code/src/lib/hub.js "whoever served this page is the hub", so
// every API call follows the page's own origin, whatever name or IP the
// screen typed.
const HUB_META = '<meta name="smart-display-hub" content="self">'

function appDeployed() {
  return existsSync(join(APP_DIR, 'index.html'))
}

function injectHubMeta(html) {
  const open = /<head(\s[^>]*)?>/i.exec(html)
  if (open) {
    const at = open.index + open[0].length
    return `${html.slice(0, at)}\n    ${HUB_META}${html.slice(at)}`
  }
  const close = /<\/head>/i.exec(html)
  if (close) return `${html.slice(0, close.index)}${HUB_META}\n${html.slice(close.index)}`
  return `${HUB_META}\n${html}`
}

// index.html, or editor.html for the layout editor at /editor/.
function serveAppIndex(req, res, file = 'index.html') {
  let html
  try {
    html = readFileSync(join(APP_DIR, file), 'utf8')
  } catch {
    return json(res, 404, { error: 'app not deployed', appDir: APP_DIR, file })
  }
  const buf = Buffer.from(injectHubMeta(html))
  cors(res)
  res.writeHead(200, {
    'Content-Type': MIME['.html'],
    'Content-Length': buf.length,
    // Never cached: it names the current content-hashed bundle, so a stale
    // copy would pin a screen to an old build.
    'Cache-Control': 'no-store',
  })
  return res.end(req.method === 'HEAD' ? undefined : buf)
}

async function serveAppFile(req, res, urlPath) {
  const hit = resolveInside(APP_DIR, urlPath)
  if (!hit) return json(res, 403, { error: 'forbidden' })

  // The first path segment must be an exact, real entry of APP_DIR, and never
  // stub-photos/: that folder is code/public/stub-photos riding along in a dev
  // build, and photos come from PHOTOS_DIR only (the /stub-photos/ route).
  // Matching real names byte for byte, rather than testing for the string
  // "stub-photos", also shuts out the Windows aliases of that folder:
  // STUB-PHOTOS (case-insensitive NTFS), "stub-photos." (trailing dot
  // dropped), STUB-P~1 (8.3 short name).
  const first = hit.rel.split(/[\\/]/)[0]
  let entries
  try {
    entries = readdirSync(APP_DIR)
  } catch {
    return json(res, 404, { error: 'not found' })
  }
  if (!first || first.toLowerCase() === 'stub-photos' || !entries.includes(first)) {
    return json(res, 404, { error: 'not found' })
  }

  const st = await statFile(hit.full)
  if (!st) return json(res, 404, { error: 'not found' })
  return sendFile(req, res, hit.full, st, {
    'Content-Type': MIME[extname(hit.full).toLowerCase()] || 'application/octet-stream',
    // Vite content-hashes every name under assets/, so a URL there never
    // changes meaning. Everything else must never cache: build.json is polled
    // to notice deploys, and the rest (favicon, icons, silence.wav) is tiny.
    'Cache-Control': first === 'assets' ? 'public, max-age=31536000, immutable' : 'no-store',
  }, { ranges: true })
}

// --- Sonos proxy -----------------------------------------------------------------
// Port of _proxy_sonos from pi/kiosk-server.py. Every screen polls through
// here every 1.5 s, so requests are not logged; an outage is logged when it
// starts, every 5 minutes while it lasts, and when it ends.
const SONOS_TIMEOUT_MS = 6000
let sonosDownSince = 0
let sonosLastLog = 0

async function proxySonos(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'GET only' })
  // The rest of the path and the query string as received, still
  // percent-encoded: /Main/favorite/My%20Station, /zones, /getaa?s=1&u=...
  const rest = url.pathname.slice('/api/sonos'.length) + url.search
  try {
    const { res: up, body } = await fetchWithTimeout(SONOS_UPSTREAM + (rest || '/'), {
      timeoutMs: SONOS_TIMEOUT_MS,
    })
    if (sonosDownSince) {
      console.log(`[sonos] upstream back after ${Math.round((Date.now() - sonosDownSince) / 1000)}s`)
      sonosDownSince = 0
    }
    cors(res)
    res.writeHead(up.status, {
      'Content-Type': up.headers.get('content-type') || 'application/json',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    })
    return res.end(body)
  } catch (e) {
    const now = Date.now()
    if (!sonosDownSince || now - sonosLastLog > 5 * 60_000) {
      console.warn(`[sonos] upstream ${SONOS_UPSTREAM} unreachable: ${e.message}`)
      sonosLastLog = now
    }
    if (!sonosDownSince) sonosDownSince = now
    return json(res, 502, { ok: false, error: String(e.message || e) })
  }
}

// --- routes ------------------------------------------------------------------------

async function handle(req, res) {
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    return json(res, 400, { error: 'bad request' })
  }
  const path = url.pathname

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end() }

  if (path === '/healthz') {
    const state = currentState()
    const cal = calendar.snapshot()
    const artStatus = art.status()
    return json(res, 200, {
      ok: true,
      service: 'FrameServer',
      photos: countPhotos(),
      photosDir: PHOTOS_DIR,
      refreshRunning: running,
      app: appDeployed(),
      sonosUpstream: SONOS_UPSTREAM,
      health: health.brief(),
      state: {
        timerActive: state.timer.active,
        travelDefault: state.travelDefault ? state.travelDefault.mode : null,
      },
      calendar: { connected: cal.connected, events: cal.events.length, fetchedAt: cal.fetchedAt, error: cal.error },
      countdownArt: { items: artStatus.items.length, syncedAt: artStatus.syncedAt },
      weather: weatherBrief(),
      alerts: alertsHealth(),
      airQuality: state.airQuality ? state.airQuality.label : null,
      plex: { ...plex.health(), tmdb: tmdb.configured() },
      ha: ha.brief(),
    })
  }

  if (path === '/api/photos/refresh/status') return json(res, 200, readStatus())

  // The album index only, so the dashboard's album picker does not have to pull
  // the whole 1.5 MB manifest to render a list of checkboxes.
  if (path === '/api/albums' && req.method === 'GET') {
    try {
      const m = JSON.parse(readFileSync(join(PHOTOS_DIR, 'manifest.json'), 'utf8'))
      return json(res, 200, { albums: m.albums || [] })
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) })
    }
  }

  // The dashboard. A single self-contained file rather than a second Vite
  // entry: the kiosk app is styled in viewport units for a fixed panel, which
  // is wrong for a desktop browser, so there was no stylesheet to reuse anyway.
  if (path === '/admin' || path === '/admin/') {
    try {
      const html = readFileSync(join(ROOT, 'admin.html'))
      cors(res)
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-store',
      })
      return res.end(html)
    } catch {
      return json(res, 404, { error: 'admin.html not deployed' })
    }
  }

  // --- device registry ---
  if (path === '/api/devices' && req.method === 'GET') {
    const reg = readRegistry()
    return json(res, 200, {
      devices: Object.entries(reg.devices).map(([id, d]) => ({
        id, ...d, lastSeenAt: lastSeen.get(id) ?? null, screen: screenOf(id),
        health: health.healthFor(id) ?? undefined,
      })),
      shared: reg.shared,
    })
  }

  if (path === '/api/devices/register' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      if (!isDict(body) || !body.id) return json(res, 400, { error: 'id required' })
      const reg = registerDevice(body)
      // A screen registers itself with its kind and config. The dashboard's
      // rename reuses this route with only {id, name}; that is not the screen
      // being seen, and must not make a dead screen look alive.
      if (body.kind != null || body.config != null) markSeen(body.id)
      noteShared(reg.shared)
      return json(res, 200, deviceView(body.id, reg.devices[body.id], reg.shared))
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) })
    }
  }

  if (path === '/api/settings/shared') {
    if (req.method === 'GET') return json(res, 200, readRegistry().shared)
    if (req.method === 'PATCH' || req.method === 'POST') {
      try {
        // Location, departure hour or the calendar list may have moved: the
        // calendar refetches at once when its ids change (patchShared calls
        // noteShared for every writer, this route included).
        return json(res, 200, patchShared(await readBody(req)))
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) })
      }
    }
    return json(res, 405, { error: 'GET or PATCH' })
  }

  const devDel = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})$/)
  if (devDel && req.method === 'DELETE') {
    const reg = readRegistry()
    if (!reg.devices[devDel[1]]) return json(res, 404, { error: 'unknown device' })
    delete reg.devices[devDel[1]]
    writeRegistry(reg)
    lastSeen.delete(devDel[1])
    screens.delete(devDel[1])
    // A deleted device that reconnects re-registers and seeds itself again from
    // whatever it still has cached locally, so this is recoverable, not fatal.
    return json(res, 200, { ok: true, removed: devDel[1] })
  }

  const devHist = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})\/layout-history$/)
  if (devHist && req.method === 'GET') {
    const all = readJsonFile(LAYOUT_HISTORY_FILE, {})
    return json(res, 200, Array.isArray(all[devHist[1]]) ? all[devHist[1]] : [])
  }

  // A screen's heartbeat (pi/kiosk-server.py, every minute) and what the hub
  // made of it; registered screens only, like /config. lib/health.mjs.
  const devHealth = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})\/health$/)
  if (devHealth) {
    const id = devHealth[1]
    if (!readRegistry().devices[id]) return json(res, 404, { error: `unknown device: ${id}` })
    if (req.method === 'GET') {
      const h = health.healthFor(id)
      return h ? json(res, 200, h) : json(res, 404, { error: `no heartbeat from ${id} yet` })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' })
    // A report is ~500 bytes. One that declares more than 1 KB is refused
    // unread; readBody still stops one that does not declare its size.
    if (Number(req.headers['content-length']) > MAX_REPORT_BYTES) {
      return json(res, 413, { ok: false, error: `a report is at most ${MAX_REPORT_BYTES} bytes` })
    }
    let body
    try {
      body = await readBody(req)
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message || e) })
    }
    const r = health.recordHealth(id, body)
    if (!r.ok) return json(res, r.status, { ok: false, error: r.error })
    cors(res)
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    return res.end()
  }

  if (path === '/api/health/events') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, health.events(url.searchParams.get('limit')))
  }

  const devCfg = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})\/config$/)
  if (devCfg) {
    const id = devCfg[1]
    const reg = readRegistry()
    if (!reg.devices[id]) return json(res, 404, { error: `unknown device: ${id}` })

    if (req.method === 'GET') {
      // The layout editor's preview iframe polls as the screen it is editing
      // (edit=1). That is a laptop, not the screen: it must not make a dead
      // screen look alive on the dashboard, nor overwrite the screen's real
      // viewport with the laptop's.
      if (url.searchParams.get('edit') !== '1') {
        markSeen(id)
        noteScreen(id, url.searchParams.get('screen'))
      }
      return json(res, 200, deviceView(id, reg.devices[id], reg.shared))
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      try {
        const body = await readBody(req)
        const before = reg.devices[id].config?.layouts
        reg.devices[id].config = deepMerge(reg.devices[id].config || {}, body)
        writeRegistry(reg)
        if (isDict(body) && 'layouts' in body) recordLayoutHistory(id, before, reg.devices[id].config?.layouts)
        return json(res, 200, deviceView(id, reg.devices[id], reg.shared))
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) })
      }
    }
    return json(res, 405, { error: 'GET or PATCH' })
  }

  if (path === '/api/photos/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
    const started = startRefresh('button')
    return started
      ? json(res, 200, { ok: true, started: true })
      : json(res, 409, { ok: false, running: true })
  }

  // --- house state ---
  // Every web screen polls this every 10 s and the Apple TV every 30 s. POST
  // stores the countdown decisions (last writer wins) and answers with the
  // same composed state as GET, so the poster can apply the result at once.
  if (path === '/api/state') {
    if (req.method === 'GET') return json(res, 200, currentState())
    if (req.method === 'POST') {
      let body
      try {
        body = await readBody(req)
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e.message || e) })
      }
      if (!isDict(body)) return json(res, 400, { ok: false, error: 'expected JSON object' })
      const now = new Date()
      const { countdown, ignored } = acceptStatePost(body, now)
      for (const k of ignored) {
        if (loggedLegacyStateKeys.has(k)) continue
        loggedLegacyStateKeys.add(k)
        console.log(`[state] ignoring POST key "${k}" (only "countdown" is stored; an old kitchen bundle?) - logged once per key`)
      }
      if (countdown) {
        try {
          writeJsonFileAtomic(STATE_FILE, { countdown })
        } catch (e) {
          return json(res, 500, { ok: false, error: String(e.message || e) })
        }
      }
      return json(res, 200, currentState(now))
    }
    return json(res, 405, { error: 'GET or POST' })
  }

  // The one weather feed (docs/designs/panels-and-controls.md): Apple
  // WeatherKit when configured, else Open-Meteo, with automatic fallback.
  // json() already sends Cache-Control: no-store.
  if (path === '/api/weather') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, getWeather())
  }

  // --- Entry board: calendar, countdown art ---
  if (path === '/api/calendar') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    const query = calendarQuery({ days: url.searchParams.get('days'), past: url.searchParams.get('past') })
    return json(res, 200, calendarResponse(new Date(), query))
  }

  if (path === '/api/countdown-art') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, art.status())
  }

  // Waits for the sync (seconds; a few small PNGs) and answers with the same
  // body as GET plus `ok`, so the dashboard can render the result at once.
  if (path === '/api/countdown-art/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
    if (art.running()) return json(res, 409, { ok: false, running: true, error: 'a sync is already running' })
    const s = await art.refresh('dashboard')
    return json(res, 200, { ok: !s.error, ...s })
  }

  // --- school data ---
  if (path === '/api/schoolcal') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    const r = await schoolCalResponse()
    return json(res, r.status, r.body)
  }

  if (path === '/api/lunch') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    const r = await lunchResponse(url.searchParams.get('school') || DEFAULT_SCHOOL_SLUG)
    return json(res, r.status, r.body)
  }

  // --- photo-location flags ---
  if (path === '/api/flags' || path === '/api/flags/resolve' || path === '/api/flags/import') {
    if (path === '/api/flags' && req.method === 'GET') {
      const u = url.searchParams.get('unresolved')
      return json(res, 200, flags.list(u === '1' || u === 'true'))
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
    try {
      const body = await readBody(req)
      const r = path === '/api/flags' ? flags.append(body)
        : path === '/api/flags/resolve' ? flags.resolve(body)
        : flags.import(body)
      return json(res, r.status, r.body)
    } catch (e) {
      const status = e instanceof SyntaxError || e.message === 'body too large' ? 400 : 500
      return json(res, status, { ok: false, error: String(e.message || e) })
    }
  }

  // --- Plex second screen (lib/plex.mjs) ---
  // The snapshot from the 5 s poll; never waits on Plex.
  if (path === '/api/plex/now') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, plex.now())
  }

  if (path === '/api/plex/players') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, plex.playersResponse())
  }

  // { machineId, action } -> { ok, status, error }. A refused command is
  // still a 200: the body says what happened (status is Plex's, or the
  // reason's), so a screen reads one shape. Malformed input is a 400.
  if (path === '/api/plex/command') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
    let body
    try {
      body = await readBody(req)
    } catch (e) {
      return json(res, 400, { ok: false, status: 400, error: String(e.message || e) })
    }
    const r = await plex.command(body)
    return json(res, r.status === 400 ? 400 : 200, { ok: r.ok, status: r.status, error: r.error })
  }

  if (path === '/api/plex/person') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    const q = url.searchParams
    const r = await plex.person({ tmdbId: q.get('tmdbId'), name: q.get('name'), exclude: q.get('exclude') })
    return json(res, r.status, r.body)
  }

  // Plex images need the token, so screens load them through here. The path
  // (a Plex /library/ or /photo/ path) names the image and its version, so a
  // day's cache is safe.
  if (path === '/api/plex/image') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' })
    const r = await plex.image(url.searchParams)
    if (r.json) return json(res, r.status, r.json)
    cors(res)
    res.writeHead(200, {
      'Content-Type': r.type,
      'Content-Length': r.body.length,
      'Cache-Control': 'public, max-age=86400',
    })
    return res.end(req.method === 'HEAD' ? undefined : r.body)
  }

  // --- Home Assistant (lib/homeAssistant.mjs) ---
  // The snapshot the dashboard card (and later, panels) read; never cached.
  if (path === '/api/ha/state') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, ha.snapshot())
  }

  // { actionId, screen, data? } -> { ok, status, error }. Only actionId is
  // required; a refused or failed call still answers 200 (the body says why),
  // like Plex's command route - except an unknown action (404) and a rate
  // limit (429) are real HTTP statuses, so a panel can tell those apart.
  if (path === '/api/ha/action') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' })
    let body
    try {
      body = await readBody(req)
    } catch (e) {
      return json(res, 400, { ok: false, status: 400, error: String(e.message || e) })
    }
    const r = await ha.runAction(body?.actionId, { screen: body?.screen, data: body?.data })
    return json(res, r.status, { ok: r.ok, status: r.status, error: r.error })
  }

  // Live HA entity search for the dashboard's "Add entity" box, capped at 30.
  if (path === '/api/ha/entities') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, await ha.searchEntities(url.searchParams.get('q'), 30))
  }

  if (path === '/api/ha/actions/log') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
    return json(res, 200, ha.actionsLog(url.searchParams.get('limit')))
  }

  // --- Sonos ---
  if (path === '/api/sonos' || path.startsWith('/api/sonos/')) return proxySonos(req, res, url)

  if (path.startsWith('/stub-photos/') && req.method === 'GET') {
    return serveFile(req, res, path.slice('/stub-photos'.length))
  }

  if (path.startsWith('/countdown-art/') && (req.method === 'GET' || req.method === 'HEAD')) {
    return serveArtFile(req, res, path.slice('/countdown-art'.length))
  }

  // --- the web app: last, so every route above keeps precedence ---
  if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api/')) {
    if (path === '/' || path === '/index.html') {
      // The hub must keep serving the TV and the kitchen with no app deployed.
      if (!appDeployed()) return json(res, 404, { error: 'app not deployed', appDir: APP_DIR })
      return serveAppIndex(req, res)
    }
    // The layout editor (docs/designs/layout-editor.md), the build's second
    // page, with the same hub marker so it talks to whoever served it.
    if (path === '/editor' || path === '/editor/' || path === '/editor/index.html' || path === '/editor.html') {
      return serveAppIndex(req, res, 'editor.html')
    }
    // Served at /editor/, the page's relative asset URLs (base './') arrive
    // as /editor/assets/...: the same build files as /assets/..., with the
    // same checks.
    if (path.startsWith('/editor/')) return serveAppFile(req, res, path.slice('/editor'.length))
    return serveAppFile(req, res, path)
  }

  return json(res, 404, { error: 'not found' })
}

const server = createServer((req, res) => {
  // A throw inside a handler (a malformed escape, a bad file) is an unhandled
  // rejection, and Node's default for those is to kill the process. Answer
  // 500 for that one request instead.
  handle(req, res).catch((e) => {
    console.error(`[http] ${req.method} ${req.url}: ${e && e.stack ? e.stack : e}`)
    if (!res.headersSent) json(res, 500, { error: 'internal error' })
    else res.destroy()
  })
})

// Before listen: restore this morning's travel default from disk and start
// its refresh cycle, so the first /api/state already has it.
const restoredTravel = travel.start()
const restoredCalendar = calendar.start()
const restoredArt = art.start()
// The headline's forecast and NWS alerts, for the air quality's location.
// getNwsAlerts lets lib/weather.mjs merge WeatherKit's own alerts with NWS's
// without importing lib/nwsAlerts.mjs itself (which imports lib/hubWeather.mjs
// for coordsOf, and lib/hubWeather.mjs now imports lib/weather.mjs - a cycle).
const getLocation = () => getShared().location
const restoredWeather = startWeatherRefresher(getLocation, { dir: ROOT, getNwsAlerts: getAlerts })
startAlertsRefresher(getLocation)
const restoredAir = air.start()
const restoredPlex = plex.start()
const restoredHa = ha.start()

function envSummary() {
  const file = ENV_FILE.found
    ? `.env set ${ENV_FILE.loaded.join(', ') || 'nothing'}` +
      (ENV_FILE.kept.length ? ` (environment kept ${ENV_FILE.kept.join(', ')})` : '')
    : ENV_FILE.error ? `.env unreadable (${ENV_FILE.error})` : 'no .env'
  return `${file}; ${ENV_KEYS.map((k) => `${k} ${process.env[k] ? 'yes' : 'no'}`).join(', ')}`
}

server.listen(PORT, BIND, () => {
  console.log(`FrameServer listening on http://${BIND}:${PORT}`)
  console.log(`  photos : ${PHOTOS_DIR} (${countPhotos() ?? '?'} in manifest)`)
  console.log(`  scripts: ${SCRIPTS_DIR}`)
  console.log(`  app    : ${APP_DIR} (${appDeployed() ? 'index.html present' : 'NOT DEPLOYED - GET / answers 404'})`)
  console.log(`  sonos  : ${SONOS_UPSTREAM} (proxied at /api/sonos/*)`)
  console.log(`  state  : ${STATE_FILE}`)
  console.log(`  flags  : ${FLAGS_FILE}`)
  console.log(`  env    : ${envSummary()}`)
  const calCount = calendarSettings(readRegistry().shared).calendars.length
  console.log(`  gcal   : ${CALENDAR_FIXTURE
    ? `FIXTURE ${CALENDAR_FIXTURE} (instead of Google); ${calCount} calendar(s) in shared.calendar`
    : `key ${CALENDAR_KEY_FILE} (${existsSync(CALENDAR_KEY_FILE) ? 'present' : 'MISSING: /api/calendar stays empty'}); ` +
      `${calCount} calendar(s) in shared.calendar; cache ${restoredCalendar.events} events` +
      (restoredCalendar.fetchedAt ? ` from ${restoredCalendar.fetchedAt}` : '')}`)
  console.log(`  art    : ${ART_DIR} (${restoredArt.items} image(s) in index.json` +
              `${restoredArt.syncedAt ? `, written ${restoredArt.syncedAt}` : ''}); Immich album "Countdown Art", hourly`)
  const weatherStartupBrief = weatherBrief()
  console.log(`  weather: ${weatherStartupBrief.weatherKit.configured ? 'WeatherKit configured' : 'WeatherKit not configured'} ` +
              `(WEATHER_SOURCE=${process.env.WEATHER_SOURCE || 'auto'}); ` +
              `${restoredWeather ? `restored ${restoredWeather.source} from ${restoredWeather.fetchedAt}` : 'no recent forecast'}`)
  console.log(`  air    : ${restoredAir ? `restored AQI ${restoredAir.aqi} (${restoredAir.label}) from ${restoredAir.fetchedAt}` : 'no recent reading'}`)
  console.log(`  plex   : ${PLEX_FIXTURE ? `FIXTURE ${PLEX_FIXTURE} (instead of /status/sessions)` : PLEX_URL}; ` +
              `token ${plex.configured() ? 'present' : `MISSING (${PLEX_TOKEN_FILE}): /api/plex/now reports it`}; ` +
              `${restoredPlex.players} known player(s); TMDB key ${tmdb.configured() ? 'present' : 'absent (cast from Plex)'}`)
  console.log(`  ha     : ${ha.configured() ? `configured (${restoredHa.entities} whitelisted entit${restoredHa.entities === 1 ? 'y' : 'ies'})` : 'NOT CONFIGURED (HA_URL / HA_TOKEN missing): /api/ha/state reports it'}` +
              `${restoredHa.seeded ? '; whitelist seeded from the built-in list' : ''}`)
  console.log(`  cached : schoolcal ${cachedSchool.calendar ?? 'none'} | lunch ${cachedSchool.lunch ?? 'none'} | ` +
              `travel ${restoredTravel ? `${restoredTravel.date} ${restoredTravel.mode}` : 'none'}`)
  if (!existsSync(PHOTOS_DIR)) console.warn(`  WARNING: photos dir does not exist`)

  // The calendar feeds noSchoolToday in /api/state, so fetch it now rather
  // than on the first screen's request, and look again daily (a no-op while
  // the 7-day cache is fresh).
  warmSchoolCal()
  setInterval(warmSchoolCal, 24 * 3600 * 1000)
})
