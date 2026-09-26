// homeAssistant.mjs - the hub's whitelisted read/action layer over Home
// Assistant (docs/designs/panels-and-controls.md, chunk 5).
//
// Screens never talk to Home Assistant directly; the hub does, with a
// whitelist of entities it may read and actions it may call, both kept in the
// registry's shared settings (shared.ha) and edited on the dashboard
// (admin.html's "Home Assistant" card). This module owns that connection, the
// whitelist filtering, and the action relay. The panels that show this data
// on a screen come in a later package; this one ends at the data and the
// dashboard.
//
// Config: HA_URL (e.g. http://192.168.4.50:8123) and HA_TOKEN, or the file
// HA_TOKEN_FILE (default secrets/ha-token.txt, resolved against `dir`, copied
// by hand, never in git) - the same "env var, else a file re-read at most
// once a minute" policy server.mjs uses for Plex/TMDB (secretFrom). Read
// directly from process.env here so `createHomeAssistant({ getShared, dir,
// log })` is enough to run; `url` and `getToken` below are only for tests and
// for a caller that wants to resolve them itself. configured() is true once
// both a URL and a token resolve.
//
// Connection: a WebSocket to <HA_URL>/api/websocket (ws:// for http, wss://
// for https): auth_required -> { type: 'auth', access_token } -> auth_ok,
// then subscribe_events (state_changed) and an initial get_states. Only
// whitelisted entities are kept in memory, as { state, attributes (a small
// allowlist - see ATTR_ALLOWLIST), lastChanged }. A dropped socket
// reconnects with backoff (5 s doubling to 2 min, reset on auth_ok); while it
// is down, a REST GET /api/states poll every 60 s keeps the whitelist fresh
// instead. The whitelist itself is re-read every RECONCILE_MS, so an entity
// added or removed on the dashboard is reflected within a few seconds: a
// removed id is dropped from memory, and any addition triggers a fresh
// get_states (or is picked up by the next 60 s poll while offline) rather
// than waiting for that entity's next real change.
//
// Whitelist (shared.ha): { entities: [{ id, label, kind }], actions:
// [{ id, label, entity, service, confirm }] }, kind one of KINDS (derived
// from the entity's domain by default - see defaultKindForDomain - editable
// on the dashboard). Absent shared.ha seeds ONCE from SEED_ENTITIES /
// SEED_ACTIONS (Justin's list, 2026-09-26), after checking each entity id is
// real with a REST read; ids that do not answer are dropped (logged once),
// and any seed action naming a dropped entity goes with it. shared.ha is
// otherwise edited only through the existing PATCH /api/settings/shared path
// (deepMerge, arrays replace wholesale - the same policy the dashboard's
// calendar list uses), which is why this module needs `patchShared` (the
// same merge-and-persist function that route uses) only for that one-time
// seed write; every other read of the whitelist goes through `getShared`.
//
// Actions: runAction(actionId, { screen, data }) -> { ok, status, error }.
// Only a whitelisted action id, whose service must be in SERVICE_ALLOWLIST
// for its entity's domain (defence in depth against a hand-edited
// devices.json); `data` is merged into the HA call only for the keys
// DATA_KEYS_ALLOWED lists for that exact service (e.g. `option` for
// input_select.select_option). Rate limit: 12/min per screen, 60/min
// overall, checked before the HA call. The REST call is
// POST <HA_URL>/api/services/<domain>/<service> with
// { entity_id, ...data }. Every attempt whose action id resolved to a
// whitelist entry is appended to ha-actions.json (newest kept, capped at
// LOG_MAX): { time, screen, action, entity, result }. The returned `status`
// is always one of 400 (malformed - no actionId), 404 (unknown action), 429
// (rate limited) or 200 (a handled call - including one HA itself refused or
// could not be reached, which comes back as { ok: false, status: 200, error
// }, same as the Plex relay's "still answer 200" pattern): server.mjs's route
// answers with that status directly.
//
// snapshot() -> { connected, configured, fetchedAt, lastEventAt, error,
// entities: { [id]: { state, attributes, lastChanged, label, kind } },
// actions: [{ id, label, entity, service, confirm, needs }] } for
// GET /api/ha/state. brief() is the /healthz slice. compact() is the smaller
// view (state, and only friendly_name/options/current_position of
// attributes) folded into GET /api/state, so a screen polling house state
// sees indicator states without a second poll. searchEntities(q, limit) is a
// live REST /api/states search (id or friendly name), cached at most 60 s,
// for the dashboard's "Add entity" box.
//
// Test-only knobs (never set by server.mjs): `url` / `getToken` override the
// env resolution so tests can point at a mock HTTP server without touching
// process.env; `createSocket` swaps in a fake WebSocket so the auth and event
// handlers can be driven with fake messages instead of a real socket;
// `enforceRateLimit: false` turns the limiter off for tests that need many
// calls in a tight loop (the log cap, for one) without waiting on it.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const KINDS = Object.freeze([
  'cover', 'lock', 'door', 'light', 'switch', 'mode', 'select', 'person', 'sensor', 'camera', 'todo', 'other',
])

// Which services runAction will ever call, per entity domain. A domain not
// listed here (sensor, binary_sensor, person, camera - all read-only) can
// never be the target of an action.
export const SERVICE_ALLOWLIST = Object.freeze({
  cover: ['open_cover', 'close_cover', 'stop_cover', 'toggle'],
  lock: ['lock', 'unlock'],
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  input_boolean: ['turn_on', 'turn_off', 'toggle'],
  input_select: ['select_option'],
  scene: ['turn_on'],
  script: ['turn_on'],
  todo: [],
})

// Which keys of a runAction() `data` argument are ever forwarded to HA, per
// "domain.service". Anything else in `data` is silently dropped.
const DATA_KEYS_ALLOWED = Object.freeze({
  'input_select.select_option': ['option'],
  'light.turn_on': ['brightness_pct'],
})

// Which of those keys the caller MUST supply at call time (the snapshot's
// actions[].needs, so a panel knows to prompt rather than just calling it).
const NEEDS_MAP = Object.freeze({
  'input_select.select_option': ['option'],
})

// A small, deliberate allowlist: whatever else HA hangs off an entity's
// attributes (friendly names aside) never reaches memory or a screen.
const ATTR_ALLOWLIST = Object.freeze([
  'friendly_name', 'icon', 'device_class', 'unit_of_measurement',
  'options', 'current_position', 'brightness', 'battery_level',
])

// The house-state view (compact()) trims even that down to what a screen
// needs for an indicator without asking HA anything: the label, the garage's
// position, the day-part select's options.
const COMPACT_ATTRS = Object.freeze(['friendly_name', 'options', 'current_position'])

const DOMAIN_KIND = Object.freeze({
  light: 'light',
  switch: 'switch',
  cover: 'cover',
  lock: 'lock',
  input_boolean: 'switch',
  input_select: 'select',
  select: 'select',
  person: 'person',
  sensor: 'sensor',
  binary_sensor: 'sensor',
  camera: 'camera',
  todo: 'todo',
})

const DEFAULT_TOKEN_FILE = join('secrets', 'ha-token.txt')
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 120_000
const POLL_MS = 60_000        // REST fallback while the socket is down
const RECONCILE_MS = 5_000    // how often a whitelist edit reaches memory
const REST_TIMEOUT_MS = 8_000
const ACTION_TIMEOUT_MS = 8_000
const SEARCH_TTL_MS = 60_000
const LOG_MAX = 200
const LOG_REPEAT_MS = 10 * 60 * 1000
const RATE_PER_SCREEN = 12
const RATE_OVERALL = 60
const RATE_WINDOW_MS = 60_000

// entity_id -> its domain ("light.downstairs" -> "light"), '' if malformed.
export function domainOf(entityId) {
  const s = String(entityId ?? '')
  const i = s.indexOf('.')
  return i === -1 ? '' : s.slice(0, i)
}

// An action's service, "domain.service" (e.g. "input_select.select_option",
// matching HA's own call convention), split for the allowlist check and the
// REST path - not necessarily the same domain as the target entity's (every
// seed action's happens to match, but the two are independent fields).
function splitService(service) {
  const s = String(service ?? '')
  const i = s.indexOf('.')
  return i === -1 ? ['', s] : [s.slice(0, i), s.slice(i + 1)]
}

export function defaultKindForDomain(entityId) {
  return DOMAIN_KIND[domainOf(entityId)] || 'other'
}

// HA's own attributes object -> only the allowlisted keys that are present.
export function pickAttributes(attrs, allow = ATTR_ALLOWLIST) {
  const out = {}
  if (!isDict(attrs)) return out
  for (const k of allow) if (attrs[k] !== undefined) out[k] = attrs[k]
  return out
}

// Justin's first list (docs/designs/panels-and-controls.md, chunk 5;
// received 2026-09-26). Seeded into shared.ha once, after an existence check.
export const SEED_ENTITIES = Object.freeze([
  { id: 'cover.garage_door_controller', label: 'Garage', kind: 'cover' },
  { id: 'lock.front_door_smart_code_with_home_connect_technology', label: 'Front door', kind: 'lock' },
  { id: 'binary_sensor.front_door_contact_open', label: 'Front door open', kind: 'door' },
  { id: 'input_boolean.mode_away', label: 'Away', kind: 'mode' },
  { id: 'input_boolean.mode_guest', label: 'Guest', kind: 'mode' },
  { id: 'input_boolean.mode_outside', label: 'Outside', kind: 'mode' },
  { id: 'input_boolean.mode_vacation', label: 'Vacation', kind: 'mode' },
  { id: 'input_boolean.mode_working_late', label: 'Working late', kind: 'mode' },
  { id: 'input_select.day_part_override', label: 'Day part', kind: 'select' },
  { id: 'light.downstairs', label: 'Downstairs lights', kind: 'light' },
  { id: 'light.basement_basement', label: 'Basement', kind: 'light' },
  { id: 'person.justin', label: 'Justin', kind: 'person' },
  { id: 'person.sheena', label: 'Sheena', kind: 'person' },
].map((e) => Object.freeze({ ...e })))

export const SEED_ACTIONS = Object.freeze([
  { id: 'downstairs-off', label: 'Turn off downstairs', entity: 'light.downstairs', service: 'light.turn_off', confirm: 'tap' },
  { id: 'garage-toggle', label: 'Garage', entity: 'cover.garage_door_controller', service: 'cover.toggle', confirm: 'hold' },
  { id: 'garage-close', label: 'Close garage', entity: 'cover.garage_door_controller', service: 'cover.close_cover', confirm: 'hold' },
  { id: 'door-lock', label: 'Lock front door', entity: 'lock.front_door_smart_code_with_home_connect_technology', service: 'lock.lock', confirm: 'tap' },
  { id: 'door-unlock', label: 'Unlock front door', entity: 'lock.front_door_smart_code_with_home_connect_technology', service: 'lock.unlock', confirm: 'hold' },
  { id: 'away-on', label: 'Leaving', entity: 'input_boolean.mode_away', service: 'input_boolean.turn_on', confirm: 'tap' },
  { id: 'away-off', label: 'Home', entity: 'input_boolean.mode_away', service: 'input_boolean.turn_off', confirm: 'tap' },
  { id: 'guest-toggle', label: 'Guest mode', entity: 'input_boolean.mode_guest', service: 'input_boolean.toggle', confirm: 'tap' },
  { id: 'basement-toggle', label: 'Basement light', entity: 'light.basement_basement', service: 'light.toggle', confirm: 'tap' },
  { id: 'daypart-set', label: 'Day part', entity: 'input_select.day_part_override', service: 'input_select.select_option', confirm: 'tap' },
].map((a) => Object.freeze({ ...a })))

// env var (checked fresh every call) else a file, re-read at most once a
// minute - the same policy as server.mjs's secretFrom() for Plex/TMDB,
// duplicated here (rather than imported) because it is the module's own
// default when a caller does not supply `getToken`.
function defaultGetToken(dir) {
  const file = resolve(dir || '.', process.env.HA_TOKEN_FILE || DEFAULT_TOKEN_FILE)
  let readAt = 0
  let value = null
  return () => {
    const env = process.env.HA_TOKEN
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

function defaultUrl() {
  return String(process.env.HA_URL || '').trim().replace(/\/+$/, '')
}

/**
 * dir: where ha-actions.json lives (the service root, like plex-players.json
 *   and health-events.json).
 * getShared / patchShared: the registry's shared settings - read fresh on
 *   every access, written (deepMerge, via server.mjs's own writer) only for
 *   the one-time seed.
 * url / getToken: override the env resolution (tests; a real caller omits
 *   both and gets HA_URL / HA_TOKEN(_FILE) from the environment).
 * createSocket: swaps in a fake WebSocket for tests. Defaults to the global
 *   WebSocket client (Node 22, no dependency needed).
 * enforceRateLimit: false disables the 12/min-60/min limiter (tests only).
 */
export function createHomeAssistant({
  getShared,
  patchShared = () => { throw new Error('homeAssistant: patchShared is required to seed the whitelist') },
  dir,
  url = defaultUrl(),
  getToken = defaultGetToken(dir),
  log = (msg) => console.log(msg),
  createSocket = (u) => new WebSocket(u),
  enforceRateLimit = true,
} = {}) {
  const haUrl = String(url || '').trim().replace(/\/+$/, '')
  const configuredNow = () => !!(haUrl && getToken())
  const wsUrl = () => haUrl.replace(/^http/i, 'ws') + '/api/websocket'
  const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, Accept: 'application/json' })

  const LOG_FILE = join(dir, 'ha-actions.json')
  let actionLog = readJsonFile(LOG_FILE, [])
  if (!Array.isArray(actionLog)) actionLog = []

  const store = new Map() // entity_id -> { state, attributes, lastChanged }
  let connected = false
  let lastError = null
  let lastEventAt = null
  let fetchedAt = null
  let ws = null
  let msgSeq = 0
  let pendingStatesId = null
  let backoff = MIN_BACKOFF_MS
  let reconnectTimer = null
  let fallbackTimer = null
  let reconcileTimer = null
  let lastWhitelistSig = null
  let destroyed = false
  const screenHits = new Map() // screen -> [timestamps]
  let overallHits = []
  let allStatesCache = { at: 0, rows: [] }
  const lastLog = { msg: null, at: 0 }

  function logRepeat(msg) {
    const now = Date.now()
    if (msg === lastLog.msg && now - lastLog.at < LOG_REPEAT_MS) return
    lastLog.msg = msg
    lastLog.at = now
    log(msg)
  }

  // --- the whitelist, read fresh every time (shared.ha is user-editable) ---

  function currentEntities() {
    const arr = getShared?.()?.ha?.entities
    return (Array.isArray(arr) ? arr : [])
      .filter((e) => isDict(e) && typeof e.id === 'string' && e.id)
  }

  function currentActions() {
    const arr = getShared?.()?.ha?.actions
    return (Array.isArray(arr) ? arr : [])
      .filter((a) => isDict(a) && typeof a.id === 'string' && a.id &&
        typeof a.entity === 'string' && a.entity && typeof a.service === 'string' && a.service)
  }

  const whitelistIds = () => currentEntities().map((e) => e.id)

  // The dashboard's kill switch, off by default: an absent key (a pre-existing
  // shared.ha, or one hand-edited without it) reads as false, same as an
  // explicit false. Only a literal true turns it on.
  const actionsEnabled = () => getShared?.()?.ha?.actionsEnabled === true

  // --- REST ---

  async function restGetStates() {
    const { res, body } = await fetchWithTimeout(`${haUrl}/api/states`, {
      timeoutMs: REST_TIMEOUT_MS, headers: authHeaders(),
    })
    if (!res.ok) throw new Error(`Home Assistant answered HTTP ${res.status}`)
    const parsed = JSON.parse(body.toString('utf8') || '[]')
    return Array.isArray(parsed) ? parsed : []
  }

  async function entityExists(id) {
    try {
      const { res } = await fetchWithTimeout(`${haUrl}/api/states/${encodeURIComponent(id)}`, {
        timeoutMs: REST_TIMEOUT_MS, headers: authHeaders(),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function cachedAllStates() {
    if (Date.now() - allStatesCache.at < SEARCH_TTL_MS) return allStatesCache.rows
    const rows = await restGetStates()
    allStatesCache = { at: Date.now(), rows }
    return rows
  }

  // --- applying state into the in-memory store (whitelisted ids only) ---

  function applyStateRow(row) {
    const id = row?.entity_id
    if (typeof id !== 'string' || !whitelistIds().includes(id)) return
    store.set(id, {
      state: row.state === undefined ? null : row.state,
      attributes: pickAttributes(row.attributes),
      lastChanged: row.last_changed || row.last_updated || null,
    })
  }

  function applyStateChangedEvent(data) {
    const id = data?.entity_id
    if (typeof id !== 'string' || !whitelistIds().includes(id)) return
    lastEventAt = new Date().toISOString()
    if (!data.new_state) {
      store.delete(id)
      return
    }
    applyStateRow({ entity_id: id, ...data.new_state })
  }

  // --- the websocket ---

  const nextId = () => (msgSeq += 1)

  function handleMessage(socket, msg) {
    if (!isDict(msg)) return
    switch (msg.type) {
      case 'auth_required':
        socket.send(JSON.stringify({ type: 'auth', access_token: getToken() }))
        break
      case 'auth_ok':
        connected = true
        lastError = null
        backoff = MIN_BACKOFF_MS
        socket.send(JSON.stringify({ id: nextId(), type: 'subscribe_events', event_type: 'state_changed' }))
        pendingStatesId = nextId()
        socket.send(JSON.stringify({ id: pendingStatesId, type: 'get_states' }))
        log('[ha] connected to Home Assistant')
        break
      case 'auth_invalid':
        lastError = msg.message || 'Home Assistant refused the token'
        connected = false
        try { socket.close() } catch { /* already closing */ }
        break
      case 'result':
        if (msg.id === pendingStatesId) {
          if (msg.success && Array.isArray(msg.result)) {
            for (const row of msg.result) applyStateRow(row)
            fetchedAt = new Date().toISOString()
          }
          pendingStatesId = null
        }
        break
      case 'event':
        if (msg.event?.event_type === 'state_changed') applyStateChangedEvent(msg.event.data)
        break
      default:
        break // pong, and anything newer than this module knows about
    }
  }

  function scheduleReconnect() {
    if (destroyed) return
    connected = false
    clearTimeout(reconnectTimer)
    const delay = backoff
    backoff = Math.min(MAX_BACKOFF_MS, backoff * 2)
    reconnectTimer = setTimeout(connect, delay)
    reconnectTimer.unref?.()
  }

  function connect() {
    if (destroyed) return
    clearTimeout(reconnectTimer)
    if (!configuredNow()) {
      lastError = 'not configured (HA_URL or the token is missing)'
      scheduleReconnect()
      return
    }
    let socket
    try {
      socket = createSocket(wsUrl())
    } catch (e) {
      logRepeat(`[ha] websocket: ${e.message}`)
      lastError = e.message
      scheduleReconnect()
      return
    }
    ws = socket
    socket.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(typeof ev?.data === 'string' ? ev.data : String(ev?.data))
      } catch {
        return
      }
      handleMessage(socket, msg)
    }
    socket.onerror = (ev) => {
      logRepeat(`[ha] websocket error: ${ev?.message || ev?.error?.message || 'error'}`)
    }
    socket.onclose = () => {
      if (ws === socket) ws = null
      logRepeat('[ha] websocket closed; reconnecting')
      scheduleReconnect()
    }
  }

  // A whitelist edit reaches memory within RECONCILE_MS: entries no longer
  // listed are dropped at once, and a changed id set nudges a fresh
  // get_states (connected) so a newly added entity is not left showing a null
  // state until it happens to change (the 60 s REST poll covers it offline).
  function reconcileWhitelist() {
    const ids = whitelistIds()
    const sig = ids.slice().sort().join(',')
    if (sig === lastWhitelistSig) return
    lastWhitelistSig = sig
    for (const id of [...store.keys()]) if (!ids.includes(id)) store.delete(id)
    if (connected && ws) {
      try {
        pendingStatesId = nextId()
        ws.send(JSON.stringify({ id: pendingStatesId, type: 'get_states' }))
      } catch { /* the next reconcile tick, or the next poll, will retry */ }
    }
  }

  async function pollFallback() {
    if (connected || !configuredNow()) return
    try {
      const rows = await restGetStates()
      for (const row of rows) applyStateRow(row)
      fetchedAt = new Date().toISOString()
      lastError = null
    } catch (e) {
      lastError = e.message
      logRepeat(`[ha] REST fallback poll: ${e.message}`)
    }
  }

  // --- seeding (once, when shared.ha is absent) ---

  async function seedWhitelist() {
    const checks = await Promise.all(SEED_ENTITIES.map(async (e) => ({ e, ok: await entityExists(e.id) })))
    const kept = checks.filter((c) => c.ok).map((c) => ({ ...c.e }))
    const droppedIds = checks.filter((c) => !c.ok).map((c) => c.e.id)
    const keptIds = new Set(kept.map((e) => e.id))
    const actions = SEED_ACTIONS.filter((a) => keptIds.has(a.entity)).map((a) => ({ ...a }))
    // Actions start disabled: seeding fills the whitelist, it does not turn
    // the house over to it. Justin flips this on from the dashboard.
    patchShared({ ha: { entities: kept, actions, actionsEnabled: false } })
    if (droppedIds.length) {
      log(`[ha] seed: ${droppedIds.length} entity id(s) not found in Home Assistant, dropped: ${droppedIds.join(', ')}`)
    }
    log(`[ha] seeded the whitelist: ${kept.length} entit${kept.length === 1 ? 'y' : 'ies'}, ${actions.length} action(s)`)
    return { entities: kept.length, actions: actions.length, dropped: droppedIds }
  }

  // --- rate limiting (12/min/screen, 60/min overall) ---

  function pruneOld(arr, now) {
    let i = 0
    while (i < arr.length && now - arr[i] > RATE_WINDOW_MS) i += 1
    if (i > 0) arr.splice(0, i)
  }

  // true = blocked. Records the hit when allowed, so check-and-record is one
  // call (no separate step could race with itself).
  function rateLimited(screenId, now = Date.now()) {
    if (!enforceRateLimit) return false
    const arr = screenHits.get(screenId) || []
    pruneOld(arr, now)
    pruneOld(overallHits, now)
    if (arr.length >= RATE_PER_SCREEN || overallHits.length >= RATE_OVERALL) return true
    arr.push(now)
    overallHits.push(now)
    screenHits.set(screenId, arr)
    return false
  }

  // --- the action log (ha-actions.json, newest 200) ---

  function appendLog(entry) {
    actionLog = actionLog.concat(entry).slice(-LOG_MAX)
    try {
      writeJsonFileAtomic(LOG_FILE, actionLog)
    } catch (e) {
      log(`[ha] could not write ${LOG_FILE}: ${e.message}`)
    }
  }

  function actionsLog(limit) {
    const n = Number.parseInt(limit ?? '', 10)
    const k = Number.isFinite(n) ? Math.min(LOG_MAX, Math.max(1, n)) : 50
    return actionLog.slice(-k).reverse()
  }

  // --- running an action ---

  async function runAction(actionId, { screen, data } = {}) {
    if (typeof actionId !== 'string' || !actionId.trim()) {
      return { ok: false, status: 400, error: 'actionId required' }
    }
    const time = new Date().toISOString()
    const screenId = typeof screen === 'string' && screen.trim() ? screen.trim().slice(0, 64) : 'unknown'
    const action = currentActions().find((a) => a.id === actionId)
    if (!action) {
      const result = { ok: false, status: 404, error: 'unknown action' }
      appendLog({ time, screen: screenId, action: actionId, entity: null, result })
      return result
    }
    // The dashboard's kill switch: off by default (seeded false, and an
    // existing shared.ha without the key reads as false too), so a whitelist
    // can be built and reviewed before any screen can actually trigger it.
    // Checked before the allowlist and the rate limit, and before anything
    // that would reach Home Assistant.
    if (!actionsEnabled()) {
      const result = { ok: false, status: 403, error: 'actions are disabled on the dashboard' }
      appendLog({ time, screen: screenId, action: actionId, entity: action.entity, result })
      return result
    }
    const [domain, bareService] = splitService(action.service)
    const allowedServices = SERVICE_ALLOWLIST[domain] || []
    if (!allowedServices.includes(bareService)) {
      const result = { ok: false, status: 400, error: `service not allowed for ${domain || 'this entity'}` }
      appendLog({ time, screen: screenId, action: actionId, entity: action.entity, result })
      return result
    }
    if (rateLimited(screenId)) {
      const result = { ok: false, status: 429, error: 'rate limited' }
      appendLog({ time, screen: screenId, action: actionId, entity: action.entity, result })
      return result
    }

    const allowedDataKeys = DATA_KEYS_ALLOWED[action.service] || []
    const merged = {}
    if (isDict(data)) for (const k of allowedDataKeys) if (data[k] !== undefined) merged[k] = data[k]

    let result
    if (!configuredNow()) {
      result = { ok: false, status: 200, error: 'Home Assistant is not configured' }
    } else {
      try {
        const { res } = await fetchWithTimeout(`${haUrl}/api/services/${domain}/${bareService}`, {
          method: 'POST',
          timeoutMs: ACTION_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ entity_id: action.entity, ...merged }),
        })
        if (res.ok) result = { ok: true, status: 200, error: null }
        else if (res.status === 401) result = { ok: false, status: 200, error: 'Home Assistant refused the token (HTTP 401)' }
        else result = { ok: false, status: 200, error: `Home Assistant answered HTTP ${res.status}` }
      } catch (e) {
        result = { ok: false, status: 200, error: e.message }
      }
    }
    appendLog({ time, screen: screenId, action: actionId, entity: action.entity, result })
    log(`[ha] action ${actionId} -> ${action.entity}: ${result.ok ? 'ok' : result.error}`)
    return result
  }

  // --- the search box (dashboard "Add entity") ---

  async function searchEntities(q, limit = 30) {
    const needle = String(q ?? '').trim().toLowerCase()
    if (!needle || !configuredNow()) return []
    let rows
    try {
      rows = await cachedAllStates()
    } catch (e) {
      logRepeat(`[ha] entity search: ${e.message}`)
      return []
    }
    const matches = []
    for (const row of rows) {
      const id = String(row?.entity_id || '')
      const friendly = String(row?.attributes?.friendly_name || '')
      if (id.toLowerCase().includes(needle) || friendly.toLowerCase().includes(needle)) {
        matches.push({ id, label: friendly || id })
      }
    }
    // A real house can have hundreds of entities behind one device (a
    // dimmer's ramp-rate and LED-behaviour parameters, all named after the
    // same room). An id in a domain this whitelist can actually classify (a
    // light, a lock, a person, ...) sorts first, so those never get buried
    // under a device's diagnostics before `limit` is reached; alphabetical
    // within that split keeps the order stable and predictable.
    matches.sort((a, b) => {
      const ka = DOMAIN_KIND[domainOf(a.id)] ? 0 : 1
      const kb = DOMAIN_KIND[domainOf(b.id)] ? 0 : 1
      return ka - kb || a.id.localeCompare(b.id)
    })
    return matches.slice(0, limit)
  }

  // --- public views ---

  function snapshot() {
    const entities = {}
    for (const e of currentEntities()) {
      const live = store.get(e.id)
      entities[e.id] = {
        state: live ? live.state : null,
        attributes: live ? live.attributes : {},
        lastChanged: live ? live.lastChanged : null,
        label: e.label || e.id,
        kind: KINDS.includes(e.kind) ? e.kind : defaultKindForDomain(e.id),
      }
    }
    const actions = currentActions().map((a) => ({
      id: a.id,
      label: a.label || a.id,
      entity: a.entity,
      service: a.service,
      confirm: a.confirm === 'hold' ? 'hold' : 'tap',
      needs: NEEDS_MAP[a.service] || [],
    }))
    return {
      connected, configured: configuredNow(), fetchedAt, lastEventAt, error: lastError,
      actionsEnabled: actionsEnabled(), entities, actions,
    }
  }

  function brief() {
    return {
      configured: configuredNow(),
      connected,
      actionsEnabled: actionsEnabled(),
      entities: currentEntities().length,
      lastEventAt,
      error: lastError,
    }
  }

  // The GET /api/state slice: state plus only what a house-wide indicator
  // needs from attributes, never the full snapshot.
  function compact() {
    const full = snapshot()
    const entities = {}
    for (const [id, e] of Object.entries(full.entities)) {
      entities[id] = { state: e.state, attributes: pickAttributes(e.attributes, COMPACT_ATTRS), lastChanged: e.lastChanged }
    }
    return { connected: full.connected, entities }
  }

  return {
    start() {
      const already = isDict(getShared?.()?.ha)
      const seeded = !already && configuredNow()
      // The common case (shared.ha already exists) connects at once, not on
      // a later microtask: tests and callers alike can assume a socket was
      // opened by the time start() returns. Only the very first boot, when
      // seeding must finish first, defers the first connect.
      if (seeded) {
        seedWhitelist().catch((e) => {
          log(`[ha] seed failed, starting with an empty whitelist: ${e.message}`)
          return null
        }).finally(() => connect())
      } else {
        connect()
      }
      fallbackTimer = setInterval(pollFallback, POLL_MS)
      fallbackTimer.unref?.()
      reconcileTimer = setInterval(reconcileWhitelist, RECONCILE_MS)
      reconcileTimer.unref?.()
      return { configured: configuredNow(), seeded, entities: currentEntities().length }
    },
    stop() {
      destroyed = true
      clearTimeout(reconnectTimer)
      clearInterval(fallbackTimer)
      clearInterval(reconcileTimer)
      if (ws) {
        try {
          ws.onclose = null
          ws.close()
        } catch { /* already closed */ }
        ws = null
      }
    },
    snapshot,
    brief,
    compact,
    runAction,
    searchEntities,
    actionsLog,
    configured: configuredNow,
  }
}
