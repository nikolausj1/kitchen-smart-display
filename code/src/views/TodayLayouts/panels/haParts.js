// haParts.js - the pure parts of the Home Assistant panels
// (docs/designs/panels-and-controls.md, chunk 5): the status panel, the
// button, the chips and the picker. What an entity's state reads as and what
// colour it wears, which icon it gets, "since 4:12 pm", the hold's timing,
// what a refused press says, which action a picker runs, the chips' list,
// and the editor's live options (the whitelist as selects). No React, no
// DOM, no clock: every `now` is handed in. Tested from Node
// (haParts.test.mjs).
//
// The entities and actions are hooks/useHomeAssistant.js's snapshot
// (lib/haState.js mergeHa): entities { id: { id, state, label, kind,
// friendlyName, options, position, unit, deviceClass, lastChanged } },
// actions [{ id, label, entity, service, confirm, needs }], and a status
// ('loading' | 'ok' | 'offline' | 'hub').
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80. Plain ES2019.

import { fmtClock } from '../lib/format.js'

// The panel types, for SpecBoard (the snapshot is polled while one is shown).
export const HA_PANEL_TYPES = Object.freeze(['hastatus', 'habutton', 'hachips', 'hapicker'])

// Every word the panels say about the connection, the whitelist and a press.
export const HA_TEXT = Object.freeze({
  loading: 'Waiting for Home Assistant',
  hub: 'Hub unreachable',
  offline: 'Home Assistant offline',
  notListed: 'Not on the whitelist',
  chooseEntity: 'Choose an entity',
  chooseSelect: 'Choose a select',
  chooseAction: 'Choose an action',
  noEntities: 'No entities chosen',
  noOptions: 'No options to choose from',
  noAction: 'No action for this on the whitelist',
  actionsOff: 'Buttons are off on the dashboard',
  rateLimited: 'Try again in a moment',
  unreachable: 'Home Assistant unreachable',
  hold: 'Hold to confirm',
})

// A hold action: the press must last this long (a ring fills meanwhile); a
// release before it cancels.
export const HOLD_MS = 1200
// A refused press says why for this long.
export const ERROR_MS = 6000
// A press that went through shows its check for this long.
export const OK_MS = 1500
// A finger may wander this far outside the button and still be on it.
export const PRESS_SLOP_PX = 12

function has(o, k) {
  return o != null && Object.prototype.hasOwnProperty.call(o, k)
}

function isDict(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function domainOf(id) {
  const s = typeof id === 'string' ? id : ''
  const i = s.indexOf('.')
  return i > 0 ? s.slice(0, i) : ''
}

// 'not_home' -> 'Not home', 'idle' -> 'Idle'.
function sentence(s) {
  const t = String(s).split('_').join(' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''
}

const MISSING = ['unavailable', 'unknown', '']

function missing(e) {
  return !e || e.state == null || MISSING.indexOf(String(e.state)) >= 0
}

// --- What a state reads as ------------------------------------------------------------

const COVER_WORDS = { open: 'Open', closed: 'Closed', opening: 'Opening', closing: 'Closing', stopped: 'Stopped' }
const LOCK_WORDS = {
  locked: 'Locked',
  unlocked: 'Unlocked',
  locking: 'Locking',
  unlocking: 'Unlocking',
  jammed: 'Jammed',
  open: 'Open',
  opening: 'Opening',
}

// A binary sensor's two words by its device class (else On and Off).
const BINARY_WORDS = {
  door: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  motion: ['Detected', 'Clear'],
  occupancy: ['Detected', 'Clear'],
  presence: ['Home', 'Away'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Detected', 'Clear'],
  gas: ['Detected', 'Clear'],
  problem: ['Problem', 'OK'],
}

// 72.44 -> '72.4', 72 -> '72', 1016.25 -> '1016.3'.
function fmtNumber(n) {
  return String(Math.round(n * 10) / 10)
}

// A unit that hugs its number ('72°F', '41%'), else one after a space
// ('412 ppm').
function withUnit(n, unit) {
  if (!unit) return n
  return unit === '%' || unit.charAt(0) === '°' ? `${n}${unit}` : `${n} ${unit}`
}

function sensorWord(e) {
  const s = String(e.state)
  if (domainOf(e.id) === 'binary_sensor') {
    const pair = e.deviceClass && has(BINARY_WORDS, e.deviceClass) ? BINARY_WORDS[e.deviceClass] : ['On', 'Off']
    if (s === 'on') return pair[0]
    if (s === 'off') return pair[1]
    return sentence(s)
  }
  const n = s.trim() === '' ? NaN : Number(s)
  if (Number.isFinite(n)) return withUnit(fmtNumber(n), e.unit)
  return e.unit ? withUnit(s, e.unit) : sentence(s)
}

// haStateWord(entity) -> the state as a word: 'Closed', 'Open', 'Open 40%',
// 'Locked', 'Unlocked', 'Home', 'Away' (or the zone: 'Work'), 'On', 'Off',
// a select's option as written, a sensor's value with its unit ('72.4°F'),
// 'Unavailable', 'Unknown'; '--' with no state at all.
export function haStateWord(e) {
  if (!e || e.state == null || e.state === '') return '--'
  const s = String(e.state)
  if (s === 'unavailable') return 'Unavailable'
  if (s === 'unknown') return 'Unknown'
  switch (e.kind) {
    case 'cover': {
      const pos = finite(e.position)
      if (s === 'open' && pos != null && pos > 0 && pos < 100) return `Open ${Math.round(pos)}%`
      return has(COVER_WORDS, s) ? COVER_WORDS[s] : sentence(s)
    }
    case 'lock':
      return has(LOCK_WORDS, s) ? LOCK_WORDS[s] : sentence(s)
    case 'door':
      if (s === 'on' || s === 'open') return 'Open'
      if (s === 'off' || s === 'closed') return 'Closed'
      return sentence(s)
    case 'light':
    case 'switch':
    case 'mode':
      if (s === 'on') return 'On'
      if (s === 'off') return 'Off'
      return sentence(s)
    case 'select':
      return s
    case 'person':
      if (s === 'home') return 'Home'
      if (s === 'not_home') return 'Away'
      return s
    case 'sensor':
      return sensorWord(e)
    case 'todo': {
      const n = Number(s)
      if (Number.isFinite(n)) return n === 1 ? '1 item' : `${n} items`
      return sentence(s)
    }
    default:
      return sentence(s)
  }
}

// haTone(entity) -> 'calm' (the safe states: closed, locked, home, off),
// 'alert' (open, unlocked, away, on, and whatever is on its way between) or
// 'unknown' (no state, unavailable, unknown). A select's option, a sensor's
// value and anything else is calm.
export function haTone(e) {
  if (missing(e)) return 'unknown'
  const s = String(e.state)
  switch (e.kind) {
    case 'cover':
      return s === 'closed' ? 'calm' : 'alert'
    case 'lock':
      return s === 'locked' ? 'calm' : 'alert'
    case 'door':
      return s === 'on' || s === 'open' ? 'alert' : 'calm'
    case 'light':
    case 'switch':
    case 'mode':
      return s === 'on' ? 'alert' : 'calm'
    case 'person':
      return s === 'home' ? 'calm' : 'alert'
    case 'sensor':
      return domainOf(e.id) === 'binary_sensor' && s === 'on' ? 'alert' : 'calm'
    default:
      return 'calm'
  }
}

// haIconName(entity) -> the icon (panels/HaIcon.jsx): 'cover-open',
// 'cover-closed', 'lock-locked', 'lock-unlocked', 'door-open', 'door-closed',
// 'light-on', 'light-off', 'switch-on', 'switch-off', 'mode-on',
// 'mode-off', 'select', 'person-home', 'person-away', 'sensor', 'camera',
// 'todo', 'other'. With no state an entity wears its kind's resting icon.
export function haIconName(e) {
  const kind = e && typeof e.kind === 'string' ? e.kind : 'other'
  const s = missing(e) ? null : String(e.state)
  switch (kind) {
    case 'cover':
      return s && s !== 'closed' ? 'cover-open' : 'cover-closed'
    case 'lock':
      return s && s !== 'locked' && s !== 'locking' ? 'lock-unlocked' : 'lock-locked'
    case 'door':
      return s === 'on' || s === 'open' ? 'door-open' : 'door-closed'
    case 'light':
      return s === 'on' ? 'light-on' : 'light-off'
    case 'switch':
      return s === 'on' ? 'switch-on' : 'switch-off'
    case 'mode':
      return s === 'on' ? 'mode-on' : 'mode-off'
    case 'select':
      return 'select'
    case 'person':
      return s && s !== 'home' ? 'person-away' : 'person-home'
    case 'sensor': {
      const dc = e.deviceClass
      if (domainOf(e.id) === 'binary_sensor' && (dc === 'door' || dc === 'garage_door' || dc === 'window' || dc === 'opening')) {
        return s === 'on' ? 'door-open' : 'door-closed'
      }
      return 'sensor'
    }
    case 'camera':
    case 'todo':
      return kind
    default:
      return 'other'
  }
}

// haView(entity, status) -> { word, tone, icon }: the tone is grey
// ('unknown') whenever Home Assistant is not connected (status not 'ok'),
// whatever the last reading was.
export function haView(e, status) {
  return {
    word: haStateWord(e),
    tone: status === 'ok' ? haTone(e) : 'unknown',
    icon: haIconName(e),
  }
}

// The connection, as a note under a grey state: null while connected.
export function haStatusNote(status) {
  if (status === 'offline') return HA_TEXT.offline
  if (status === 'hub') return HA_TEXT.hub
  if (status === 'loading') return HA_TEXT.loading
  return null
}

// --- Since -------------------------------------------------------------------------------

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function midnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// fmtSince(lastChanged, now) -> 'since 4:12 pm' today, 'since Sat 9:40 pm'
// within the last six days, 'since Sep 12' before that; '' without a time.
// A stamp a little ahead of `now` (another clock) reads as today's.
export function fmtSince(lastChanged, now) {
  if (typeof lastChanged !== 'string' || !(now instanceof Date) || Number.isNaN(now.getTime())) return ''
  const t = Date.parse(lastChanged)
  if (Number.isNaN(t)) return ''
  const d = new Date(t)
  const days = Math.round((midnight(now) - midnight(d)) / 86400000)
  if (days <= 0) return `since ${fmtClock(d)}`
  if (days < 7) return `since ${DAY_SHORT[d.getDay()]} ${fmtClock(d)}`
  return `since ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`
}

// --- The press ------------------------------------------------------------------------------
//
// A press is { confirm: 'tap' | 'hold', downAt, fired }. Times are one clock's
// milliseconds (the panels use performance.now()). A tap fires on release,
// inside the button; a hold fires on its own once HOLD_MS have passed
// (fired: true), and a release before that cancels it.

// How long a hold that started at downAt still has to go at t (0: done).
export function holdRemaining(downAt, t) {
  const held = Math.max(0, t - downAt)
  return Math.max(0, HOLD_MS - held)
}

// How much of the ring is filled at t, 0 to 1.
export function holdProgress(downAt, t) {
  return Math.min(1, Math.max(0, (t - downAt) / HOLD_MS))
}

// What letting go at t means: 'fire', 'cancel' or 'none' (a hold that has
// already fired, or no press at all).
export function releaseOutcome(press, t, inside) {
  if (!press) return 'none'
  if (press.confirm === 'tap') return inside ? 'fire' : 'cancel'
  if (press.fired) return 'none'
  return inside && t - press.downAt >= HOLD_MS ? 'fire' : 'cancel'
}

// Is (x, y) on the rectangle, or within slop of it?
export function insideRect(rect, x, y, slop) {
  if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return false
  const m = Number.isFinite(slop) ? slop : 0
  return x >= rect.left - m && x <= rect.right + m && y >= rect.top - m && y <= rect.bottom + m
}

// A refused press, as the panel says it: 403 the dashboard's switch, 429 the
// hub's rate limit, 404 an action taken off the whitelist since the snapshot,
// anything else (Home Assistant refused it, or nobody answered) unreachable.
export function haErrorText(result) {
  const status = result ? finite(result.status) : null
  if (status === 403) return HA_TEXT.actionsOff
  if (status === 429) return HA_TEXT.rateLimited
  if (status === 404) return HA_TEXT.notListed
  return HA_TEXT.unreachable
}

// --- Looking things up -----------------------------------------------------------------------

// haEntityFor(ha, id) -> { entity, message }: the entity, or what to say
// instead (none chosen, still waiting, the hub unreachable, not on the
// whitelist).
export function haEntityFor(ha, id, chooseText) {
  if (!id) return { entity: null, message: chooseText || HA_TEXT.chooseEntity }
  if (!ha || !ha.loaded) return { entity: null, message: ha && ha.status === 'hub' ? HA_TEXT.hub : HA_TEXT.loading }
  const e = isDict(ha.entities) && has(ha.entities, id) ? ha.entities[id] : null
  return e ? { entity: e, message: null } : { entity: null, message: HA_TEXT.notListed }
}

// haActionFor(ha, id) -> { action, message }, as haEntityFor.
export function haActionFor(ha, id) {
  if (!id) return { action: null, message: HA_TEXT.chooseAction }
  if (!ha || !ha.actionsKnown) return { action: null, message: ha && ha.status === 'hub' ? HA_TEXT.hub : HA_TEXT.loading }
  const list = Array.isArray(ha.actions) ? ha.actions : []
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return { action: list[i], message: null }
  return { action: null, message: HA_TEXT.notListed }
}

// Why a press cannot go now, or null when it can: the hub or Home
// Assistant down, or the dashboard's switch off. Unknown (null) is not off:
// the hub still says no if it is.
export function haBlocked(ha) {
  if (!ha) return HA_TEXT.loading
  if (ha.status === 'hub') return HA_TEXT.hub
  if (ha.status === 'offline') return HA_TEXT.offline
  if (ha.actionsEnabled === false) return HA_TEXT.actionsOff
  return null
}

function needsOption(a) {
  return !!a && Array.isArray(a.needs) && a.needs.indexOf('option') >= 0
}

// pickerAction(actions, entityId, actionId) -> the action a picker runs: the
// one named when it targets that entity and takes an option, else (none
// named) the first on the whitelist that does; null when there is none.
export function pickerAction(actions, entityId, actionId) {
  const list = Array.isArray(actions) ? actions : []
  if (!entityId) return null
  if (actionId) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (a && a.id === actionId) return a.entity === entityId && needsOption(a) ? a : null
    }
    return null
  }
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].entity === entityId && needsOption(list[i])) return list[i]
  return null
}

// --- The chips' entities ------------------------------------------------------------------------

export const ENTITY_LIST_MAX = 16

const ENTITY_ID_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/

// parseEntityList(v) -> [id]: entity ids from a comma- (or space-) separated
// text, or an array: lower-cased, only what looks like an entity id, each
// once, at most ENTITY_LIST_MAX. The layout spec keeps the knob in this form
// (layoutSpec.js entityIdList).
export function parseEntityList(v) {
  const raw = Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(',') : typeof v === 'string' ? v : ''
  const out = []
  raw
    .toLowerCase()
    .split(/[\s,;]+/)
    .forEach((s) => {
      if (s && ENTITY_ID_RE.test(s) && out.indexOf(s) < 0 && out.length < ENTITY_LIST_MAX) out.push(s)
    })
  return out
}

// The chips to draw: the ids given, else every mode on the whitelist (the
// house's modes are what the chips are for).
export function chipIds(list, ha) {
  const ids = parseEntityList(list)
  if (ids.length) return ids
  const ents = ha && isDict(ha.entities) ? ha.entities : {}
  return Object.keys(ents).filter((id) => ents[id] && ents[id].kind === 'mode')
}

// --- The editor's live options ------------------------------------------------------------------
//
// panels/schemas.js marks the knobs that hold a whitelist id with `ha`:
//   'entity'        any entity           (HA status)
//   'selectEntity'  a select             (HA picker)
//   'action'        any action           (HA button)
//   'optionAction'  an action that takes a select's option ('' = automatic)
//   'entityList'    the chips' ids, a text field whose hint lists them
// They are declared as text, which the spec's normaliser keeps whatever the
// whitelist holds; the layout editor gets them as selects of the live
// whitelist (id -> label) in sd-edit:ready (editBridge.js), and as the text
// fields they are while the whitelist is empty or unknown.

const NONE_LABELS = { entity: 'None', selectEntity: 'None', action: 'None', optionAction: 'Automatic' }

function isSelectEntity(id, e) {
  const d = domainOf(id)
  return (e && e.kind === 'select') || d === 'input_select' || d === 'select'
}

// [[value, label]], a label shared by two options carrying its id too.
function labelled(pairs) {
  const count = {}
  pairs.forEach((p) => {
    count[p[1]] = (count[p[1]] || 0) + 1
  })
  return pairs.map((p) => (count[p[1]] > 1 ? [p[0], `${p[1]} (${p[0]})`] : p))
}

// The options for one kind of knob, from the snapshot: [] when it has none
// to give (not loaded, nothing of that sort on the whitelist).
export function haKnobOptions(kind, ha) {
  if (!ha) return []
  if (kind === 'entity' || kind === 'selectEntity') {
    if (!ha.loaded || !isDict(ha.entities)) return []
    const ids = Object.keys(ha.entities).filter((id) => kind === 'entity' || isSelectEntity(id, ha.entities[id]))
    return labelled(ids.map((id) => [id, ha.entities[id].label || id]))
  }
  if (kind === 'action' || kind === 'optionAction') {
    if (!ha.actionsKnown || !Array.isArray(ha.actions)) return []
    const list = ha.actions.filter((a) => a && (kind === 'action' || needsOption(a)))
    return labelled(list.map((a) => [a.id, a.confirm === 'hold' ? `${a.label} (hold)` : a.label]))
  }
  return []
}

function panelLists(spec) {
  if (!isDict(spec)) return []
  const lists = [Array.isArray(spec.panels) ? spec.panels : []]
  if (isDict(spec.variants)) {
    Object.keys(spec.variants).forEach((k) => {
      const v = spec.variants[k]
      if (isDict(v) && Array.isArray(v.panels)) lists.push(v.panels)
    })
  }
  return lists
}

// The ids a saved layout holds in each whitelist knob ('hastatus.entity' ->
// ['cover.garage_door_controller']), so one no longer on the whitelist stays
// a choice (marked so) rather than silently becoming none in the editor.
function usedValues(table, saved) {
  const out = {}
  panelLists(saved).forEach((list) => {
    list.forEach((p) => {
      if (!isDict(p) || typeof p.type !== 'string' || !has(table, p.type)) return
      const s = table[p.type]
      const props = isDict(p.props) ? p.props : {}
      ;(s && Array.isArray(s.fields) ? s.fields : []).forEach((f) => {
        if (!f || !f.ha || f.ha === 'entityList') return
        const v = props[f.key]
        if (typeof v !== 'string' || !v) return
        const k = `${p.type}.${f.key}`
        out[k] = out[k] || []
        if (out[k].indexOf(v) < 0) out[k].push(v)
      })
    })
  })
  return out
}

function liveField(f, ha, keep) {
  if (f.ha === 'entityList') {
    const ids = ha && ha.loaded && isDict(ha.entities) ? Object.keys(ha.entities) : []
    return ids.length ? { ...f, hint: `${f.hint || ''} On the whitelist: ${ids.join(', ')}`.trim() } : f
  }
  const opts = haKnobOptions(f.ha, ha)
  if (!opts.length) return f
  const known = {}
  opts.forEach((o) => {
    known[o[0]] = true
  })
  const stale = (keep || []).filter((v) => !has(known, v)).map((v) => [v, `${v} (not on the whitelist)`])
  const none = has(NONE_LABELS, f.ha) ? NONE_LABELS[f.ha] : 'None'
  return { ...f, type: 'select', options: [['', none]].concat(opts, stale) }
}

// withHaOptions(table, ha, savedSpec) -> the schema table (PANEL_SCHEMA_TABLE
// shape: { type: { fields, elements } }) with each `ha` knob made live: a
// select of the whitelist when the snapshot has one to offer, else the text
// field as declared. Types without such knobs are the same objects.
export function withHaOptions(table, ha, saved) {
  const src = isDict(table) ? table : {}
  const used = usedValues(src, saved)
  const out = {}
  Object.keys(src).forEach((type) => {
    const s = src[type]
    const fields = s && Array.isArray(s.fields) ? s.fields : null
    if (!fields || !fields.some((f) => f && f.ha)) {
      out[type] = s
      return
    }
    out[type] = { ...s, fields: fields.map((f) => (f && f.ha ? liveField(f, ha, used[`${type}.${f.key}`]) : f)) }
  })
  return out
}

// What the live options are made of, as a string: a new one means the
// editor should hear a new ready.
export function haOptionsKey(ha) {
  if (!ha) return ''
  const ents = ha.loaded && isDict(ha.entities) ? ha.entities : {}
  const acts = ha.actionsKnown && Array.isArray(ha.actions) ? ha.actions : []
  return JSON.stringify([
    !!ha.loaded,
    Object.keys(ents).map((id) => [id, ents[id].label, ents[id].kind]),
    !!ha.actionsKnown,
    acts.map((a) => [a.id, a.label, a.entity, a.confirm, a.needs]),
  ])
}
