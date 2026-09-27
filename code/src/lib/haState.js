// haState.js - the pure parts of Home Assistant on a screen
// (docs/designs/panels-and-controls.md, chunk 5): cleaning the house state's
// compact slice (GET /api/state `ha`, lib/houseState.js), cleaning the hub's
// full snapshot (GET /api/ha/state, hooks/useHomeAssistant.js), merging the
// two into what the panels read, and reading an action's answer. No React,
// no DOM, no clock: every time is handed in. Tested from Node
// (haState.test.mjs).
//
// The two sources (frameserver/lib/homeAssistant.mjs):
//   /api/state.ha      { connected, entities: { id: { state, attributes:
//                        { friendly_name?, options?, current_position? },
//                        lastChanged } } }, every 10 s with the house state
//   /api/ha/state      { connected, configured, fetchedAt, lastEventAt,
//                        error, actionsEnabled, entities: { id: { state,
//                        attributes, lastChanged, label, kind } }, actions:
//                        [{ id, label, entity, service, confirm: 'tap' |
//                        'hold', needs: ['option'] }] }, once a minute while
//                        a panel shows it, and every 3 s for 30 s after a
//                        press that went through
// Both list only the dashboard's whitelist, in its order, so an id missing
// from them is an id that is not on it.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80. Plain ES2019: no
// Object.hasOwn, Array.prototype.at, structuredClone, String replaceAll.

// The hub's kinds (homeAssistant.mjs KINDS), which the dashboard sets per
// entity; before the snapshot names one, the entity's domain decides
// (the hub's own defaultKindForDomain).
export const HA_KINDS = Object.freeze([
  'cover', 'lock', 'door', 'light', 'switch', 'mode', 'select', 'person', 'sensor', 'camera', 'todo', 'other',
])

const DOMAIN_KIND = {
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
}

// Past these a payload is not a house: the rest is dropped.
const MAX_ENTITIES = 200
const MAX_ACTIONS = 100
const MAX_OPTIONS = 40

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k)
}

function isDict(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// A trimmed string, at most `max` long, or null for anything else or empty.
function str(v, max) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return max && s.length > max ? s.slice(0, max) : s
}

// 'light.downstairs': a domain, a dot, an object id. Loose on purpose (the
// hub has already checked them against Home Assistant); this only keeps
// garbage keys out.
export function isEntityId(v) {
  return typeof v === 'string' && v.length <= 255 && /^[a-z0-9_]+\.[a-z0-9_]+$/.test(v)
}

// 'light.downstairs' -> 'light'; '' when it is not an entity id.
export function domainOf(id) {
  if (typeof id !== 'string') return ''
  const i = id.indexOf('.')
  return i > 0 ? id.slice(0, i) : ''
}

// The kind an entity has when nobody has chosen one: the hub's rule.
export function kindForId(id) {
  const d = domainOf(id)
  return has(DOMAIN_KIND, d) ? DOMAIN_KIND[d] : 'other'
}

// The attributes a screen ever reads. The compact slice carries the first
// three; the full snapshot adds the unit and the device class.
function cleanAttrs(a, full) {
  const out = {}
  if (!isDict(a)) return out
  const name = str(a.friendly_name, 120)
  if (name) out.friendly_name = name
  if (Array.isArray(a.options)) {
    const opts = a.options.filter((o) => typeof o === 'string' && o.trim()).slice(0, MAX_OPTIONS).map((o) => o.slice(0, 80))
    if (opts.length) out.options = opts
  }
  const pos = finite(a.current_position)
  if (pos != null) out.current_position = Math.max(0, Math.min(100, pos))
  if (full) {
    const unit = str(a.unit_of_measurement, 16)
    if (unit) out.unit_of_measurement = unit
    const dc = str(a.device_class, 40)
    if (dc) out.device_class = dc
  }
  return out
}

function cleanEntities(map, full) {
  const out = {}
  if (!isDict(map)) return out
  const ids = Object.keys(map)
  let n = 0
  for (let i = 0; i < ids.length && n < MAX_ENTITIES; i++) {
    const id = ids[i]
    const e = map[id]
    if (!isEntityId(id) || !isDict(e)) continue
    const entry = {
      state: e.state == null ? null : String(e.state).slice(0, 255),
      attributes: cleanAttrs(e.attributes, full),
      lastChanged: str(e.lastChanged, 64),
    }
    if (full) {
      entry.label = str(e.label, 80)
      entry.kind = HA_KINDS.indexOf(e.kind) >= 0 ? e.kind : null
    }
    out[id] = entry
    n += 1
  }
  return out
}

// GET /api/state `ha` -> { connected, entities: { id: { state, attributes:
// { friendly_name?, options?, current_position? }, lastChanged } } }, or null
// for anything that is not one. Only those three attributes survive.
export function cleanHouseHa(v) {
  if (!isDict(v)) return null
  return { connected: v.connected === true, entities: cleanEntities(v.entities, false) }
}

// One whitelisted action. `confirm` is 'tap' only when the hub says exactly
// that: anything else (a newer confirm this build does not know) is a hold,
// the careful reading.
function cleanAction(a) {
  if (!isDict(a)) return null
  const id = str(a.id, 64)
  if (!id || !isEntityId(a.entity)) return null
  return {
    id,
    label: str(a.label, 80) || id,
    entity: a.entity,
    service: str(a.service, 80) || '',
    confirm: a.confirm === 'tap' ? 'tap' : 'hold',
    needs: Array.isArray(a.needs) ? a.needs.filter((k) => typeof k === 'string' && k).slice(0, 8) : [],
  }
}

// GET /api/ha/state -> { connected, configured, actionsEnabled, error,
// entities: { id: { state, attributes, lastChanged, label, kind } }, actions },
// or null. actionsEnabled is true only for a literal true, as on the hub.
export function cleanHaSnapshot(v) {
  if (!isDict(v)) return null
  const actions = []
  if (Array.isArray(v.actions)) {
    const seen = {}
    v.actions.slice(0, MAX_ACTIONS).forEach((raw) => {
      const a = cleanAction(raw)
      if (a && !has(seen, a.id)) {
        seen[a.id] = true
        actions.push(a)
      }
    })
  }
  return {
    connected: v.connected === true,
    configured: v.configured === true,
    actionsEnabled: v.actionsEnabled === true,
    error: str(v.error, 200),
    entities: cleanEntities(v.entities, true),
    actions,
  }
}

function timeOf(s) {
  if (typeof s !== 'string') return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

// The fresher of the two readings of one entity: the one Home Assistant
// changed later, else (the same change, or no stamp) the source that
// arrived later, the snapshot on a tie.
function fresher(h, n, snapNewer) {
  if (!h) return n
  if (!n) return h
  const th = timeOf(h.lastChanged)
  const tn = timeOf(n.lastChanged)
  if (th != null && tn != null && th !== tn) return th > tn ? h : n
  return snapNewer ? n : h
}

// mergeHa({ house, houseAt, snap, snapAt, hubDown, error }) -> what the
// panels read:
//
//   { status: 'loading' | 'ok' | 'offline' | 'hub',
//     loaded, connected,
//     entities: { id: { id, state, label, kind, friendlyName, options,
//                       position, unit, deviceClass, lastChanged } },
//     actions: [...], actionsKnown, actionsEnabled: true | false | null,
//     fetchedAt, error }
//
//   house    cleanHouseHa's result (or null), received at houseAt (ms)
//   snap     cleanHaSnapshot's result (or null), received at snapAt (ms)
//   hubDown  the hub itself cannot be reached (the caller's judgement)
//
// status: 'hub' when the hub cannot be reached, 'loading' until either
// source has answered, else 'ok' or 'offline' as the newer source says Home
// Assistant is connected or not. The entities are the newer source's (the
// whitelist as it stands), each reading the fresher of the two; label, kind,
// unit and device class come from the snapshot (the dashboard's), else the
// friendly name and the domain. The actions and whether they are switched on
// are the snapshot's alone: until it answers, actionsKnown is false and
// actionsEnabled null (unknown, and the hub still decides).
export function mergeHa(src) {
  const s = isDict(src) ? src : {}
  const house = isDict(s.house) ? s.house : null
  const snap = isDict(s.snap) ? s.snap : null
  const houseAt = finite(s.houseAt)
  const snapAt = finite(s.snapAt)
  const snapNewer = !!snap && (!house || (snapAt != null && (houseAt == null || snapAt > houseAt)))
  const base = snapNewer ? snap : house

  const entities = {}
  const baseEntities = base && isDict(base.entities) ? base.entities : {}
  Object.keys(baseEntities).forEach((id) => {
    const h = house && isDict(house.entities) && has(house.entities, id) ? house.entities[id] : null
    const n = snap && isDict(snap.entities) && has(snap.entities, id) ? snap.entities[id] : null
    const r = fresher(h, n, snapNewer)
    const attrs = r && isDict(r.attributes) ? r.attributes : {}
    const meta = n && isDict(n.attributes) ? n.attributes : {}
    const friendlyName = attrs.friendly_name || meta.friendly_name || null
    entities[id] = {
      id,
      state: r ? r.state : null,
      label: (n && n.label) || friendlyName || id,
      kind: (n && n.kind) || kindForId(id),
      friendlyName,
      options: attrs.options || meta.options || null,
      position: finite(attrs.current_position),
      unit: meta.unit_of_measurement || null,
      deviceClass: meta.device_class || null,
      lastChanged: r ? r.lastChanged : null,
    }
  })

  let status
  if (s.hubDown === true) status = 'hub'
  else if (!base) status = 'loading'
  else status = base.connected ? 'ok' : 'offline'

  const times = [houseAt, snapAt].filter((t) => t != null)
  return {
    status,
    loaded: !!base,
    connected: status === 'ok',
    entities,
    actions: snap ? snap.actions : [],
    actionsKnown: !!snap,
    actionsEnabled: snap ? snap.actionsEnabled : null,
    fetchedAt: times.length ? Math.max.apply(null, times) : null,
    error: str(s.error, 200),
  }
}

// POST /api/ha/action's answer -> { ok, status, error }. The hub answers
// { ok, status, error } with that status as its HTTP status (400, 403, 404,
// 429), or 200 with ok false when Home Assistant itself refused or could not
// be reached; anything else (a proxy's page, an old hub) is read from the
// HTTP status alone. ok needs both the body's ok and a 2xx.
export function readActionResult(httpStatus, body) {
  const code = finite(httpStatus) != null ? httpStatus : 0
  if (isDict(body) && typeof body.ok === 'boolean') {
    const ok = body.ok === true && code >= 200 && code < 300
    const status = finite(body.status) != null ? body.status : code
    return { ok, status, error: ok ? null : str(body.error, 200) || `HTTP ${code}` }
  }
  return { ok: false, status: code, error: `HTTP ${code}` }
}
