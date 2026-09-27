import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { EDIT_MODE, REQUESTED_LAYOUT } from '../../lib/kioskMode.js'
import { getSettings, whenHubSettled } from '../../lib/settings.js'
import { setDemoMode } from './data/demoMode.js'
import { getHomeAssistant, subscribeHomeAssistant } from '../../hooks/useHomeAssistant.js'
import { haOptionsKey, withHaOptions } from './panels/haParts.js'
import {
  BOX_SCHEMA,
  DAYPARTS,
  ELEMENT_STYLE_SCHEMA,
  FONTS,
  GLOBAL_SCHEMA_COPY,
  PANEL_SCHEMA_TABLE,
  PANEL_TYPE_LIST,
  RULE_KINDS,
  SPEC_VERSION,
  defaultSpecFor,
  isSpecLayout,
  normalizeSpec,
  specEquals,
} from './layoutSpec.js'

// editBridge - the app's half of the layout editor's message channel
// (docs/designs/layout-editor.md, "Contract v1" and "Contract v2"). The editor
// page loads this app in an iframe at the screen's resolution with ?edit=1
// and &layout=<id>, and talks to it with window.postMessage, same origin both
// ways. The layout on screen (Entry or Board, both drawn by Entry/SpecBoard)
// is the one being edited: its id is `layoutId` below.
//
//   app -> editor  sd-edit:ready   { layoutId, canvas, savedSpec, defaultSpec,
//                                    panelTypes, schemas, globalSchema,
//                                    dayparts, specVersion,
//                                    elementStyleSchema, boxSchema, fonts,
//                                    ruleKinds }
//                                  (the last four: layoutSpec.js
//                                  ELEMENT_STYLE_SCHEMA, BOX_SCHEMA, FONTS,
//                                  RULE_KINDS; docs/designs/
//                                  panels-and-controls.md, chunk 1)
//                                  once the first hub answer is in (or 2 s
//                                  passed), whenever the saved spec changes on
//                                  the hub, whenever the Home Assistant
//                                  whitelist changes (below), and in reply to
//                                  a ping
//                  sd-edit:rects   { layoutId, daypart, canvas,
//                                    panels: [{ id, type, x, y, w, h }],
//                                    elements: [{ panelId, key, label,
//                                                 x, y, w, h }] }
//                                  every box's rectangle and every marked
//                                  sub-element's ([data-edit] inside a box) in
//                                  iframe pixels, after a render or a resize
//                                  that moved one, throttled to ~100 ms with a
//                                  trailing call
//   editor -> app  sd-edit:spec    { spec, layoutId? }  render this draft
//                                  (normalized for the layout on screen);
//                                  spec: null drops the draft and goes back to
//                                  the saved layout; a layoutId that is not
//                                  the one on screen is ignored
//                  sd-edit:hover   { id | null, element? }  outline that box,
//                                  and inside it every element whose data-edit
//                                  is `element` (data-edit-hover)
//                  sd-edit:daypart { daypart }  draw that day part's layout
//                                  ('day' | 'morning' | 'evening' | 'weekend';
//                                  a variant the spec lacks draws the base);
//                                  null follows the clock again
//                  sd-edit:sample  { on }  demo data on or off
//                  sd-edit:ping    reply with ready (and fresh rects)
//                  sd-edit:display { display: { entryBackdrop, entryDim } }
//                                  the editor's draft backdrop: previewed
//                                  until saved; null clears it
//
// Only active in edit mode AND inside a frame. Every message in is checked
// for this page's own origin and for coming from the frame's parent.
//
// Live options (docs/designs/panels-and-controls.md, chunk 5). The Home
// Assistant panels' entity and action knobs hold a whitelist id; schemas.js
// declares them as text (the normaliser cannot know the whitelist). In the
// ready's schemas (and each panelTypes entry's schema) they go out as
// selects of the live whitelist, id -> label, with a first option for none
// ('' ; 'Automatic' for the picker's action), and an id the saved layout
// holds that is no longer on the whitelist kept as a choice marked so
// (panels/haParts.js withHaOptions); while the whitelist is empty or not yet
// known they stay the text fields they are. The chips' ids stay text (the
// editor has no multi-select), their hint listing the whitelist's ids. The
// bridge keeps the whitelist polled (hooks/useHomeAssistant.js, an active
// subscription from import) and sends a fresh ready when the options change.

export const EDIT_BRIDGE_ACTIVE =
  EDIT_MODE && typeof window !== 'undefined' && window.parent && window.parent !== window

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
const RECTS_MS = 100
const READY_FALLBACK_MS = 2000
// Sub-elements per rects message: a board has a few dozen; these caps only
// stop a runaway panel (an agenda of a hundred rows) flooding the channel.
const MAX_ELEMENTS = 400
const MAX_ELEMENTS_PER_PANEL = 60

// --- The draft, hover and day-part store (read by the spec layouts) ---------

let state = {
  draftRaw: null,
  draftLayoutId: null,
  hoverId: null,
  hoverElement: null,
  display: null,
  daypart: null,
}
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getDraftRaw = () => state.draftRaw
const getDraftLayoutId = () => state.draftLayoutId
const getNull = () => null

// The editor's draft spec for `layoutId`, normalized with that layout's
// defaults, or null until one has arrived (or when the draft was sent for
// another layout).
export function useEditDraft(layoutId) {
  const raw = useSyncExternalStore(subscribe, getDraftRaw, getNull)
  const forId = useSyncExternalStore(subscribe, getDraftLayoutId, getNull)
  return useMemo(() => {
    if (raw == null || (forId != null && forId !== layoutId)) return null
    return normalizeSpec(raw, { layoutId })
  }, [raw, forId, layoutId])
}

// The id of the box the editor is pointing at, or null.
export function useEditHover() {
  return useSyncExternalStore(subscribe, () => state.hoverId, getNull)
}

// The day part the editor is previewing ('day', 'morning', ...), or null to
// follow the clock.
export function useEditDaypart() {
  return useSyncExternalStore(subscribe, () => state.daypart, getNull)
}

// The editor's draft backdrop settings ({ entryBackdrop?, entryDim? }, only
// the valid ones), or null: they win over the screen's saved display settings.
export function useEditDisplay() {
  return useSyncExternalStore(subscribe, () => state.display, getNull)
}

function displayDraft(d) {
  if (!d || typeof d !== 'object') return null
  const out = {}
  if (d.entryBackdrop === 'photos' || d.entryBackdrop === 'black') out.entryBackdrop = d.entryBackdrop
  if (typeof d.entryDim === 'number' && Number.isFinite(d.entryDim)) out.entryDim = d.entryDim
  return Object.keys(out).length ? out : null
}

// --- Which layout is being edited -------------------------------------------------

// Set by the mounted spec layout (useEditBridge); until one mounts, the layout
// this page was asked for (?layout=) or the screen's own choice.
let activeLayoutId = null
// The day part the mounted layout last drew (for rects).
let drawnDaypart = null

function currentLayoutId() {
  if (activeLayoutId) return activeLayoutId
  const id = REQUESTED_LAYOUT || getSettings()?.display?.todayLayout || null
  return isSpecLayout(id) ? id : null
}

// --- Out -------------------------------------------------------------------

function post(msg) {
  try {
    window.parent.postMessage(msg, ORIGIN)
  } catch {
    // parent gone, or a message that cannot be cloned: nothing to do
  }
}

function canvasSize() {
  return { w: window.innerWidth, h: window.innerHeight }
}

function savedSpecOf(layoutId) {
  const raw = getSettings()?.layouts?.[layoutId] ?? null
  return normalizeSpec(raw, { defaultSpec: null, layoutId })
}

// The layout and saved spec last announced (normalized; null = the built-in
// default), and whether any ready has gone out yet.
let announced = false
let announcedLayoutId = null
let announcedSaved = null
let announcedHaKey = null

// The schemas as the editor gets them: the Home Assistant knobs made selects
// of the live whitelist (see the header), in both places a ready carries a
// schema. Every other type's is the table's own.
function liveSchemas(savedSpec) {
  const schemas = withHaOptions(PANEL_SCHEMA_TABLE, getHomeAssistant(), savedSpec)
  const panelTypes = PANEL_TYPE_LIST.map((t) =>
    t.schema && schemas[t.type] && schemas[t.type] !== PANEL_SCHEMA_TABLE[t.type] ? { ...t, schema: schemas[t.type] } : t
  )
  return { schemas, panelTypes }
}

function sendReady() {
  const layoutId = currentLayoutId()
  // No spec layout on screen (Framed, Briefing...): nothing to edit, no ready.
  if (!layoutId) return
  const savedSpec = savedSpecOf(layoutId)
  announced = true
  announcedLayoutId = layoutId
  announcedSaved = savedSpec
  announcedHaKey = haOptionsKey(getHomeAssistant())
  const live = liveSchemas(savedSpec)
  post({
    type: 'sd-edit:ready',
    layoutId,
    canvas: canvasSize(),
    savedSpec,
    defaultSpec: defaultSpecFor(layoutId),
    panelTypes: live.panelTypes,
    schemas: live.schemas,
    globalSchema: GLOBAL_SCHEMA_COPY,
    dayparts: DAYPARTS,
    specVersion: SPEC_VERSION,
    elementStyleSchema: ELEMENT_STYLE_SCHEMA,
    boxSchema: BOX_SCHEMA,
    fonts: FONTS,
    ruleKinds: RULE_KINDS,
  })
}

// The whitelist's entities or actions changed (or first arrived): the editor
// hears the new options, once a ready has gone out at all. The minute poll
// of an unchanged whitelist says nothing.
function onHomeAssistant() {
  if (!announced || haOptionsKey(getHomeAssistant()) === announcedHaKey) return
  sendReady()
}

// Only when the layout or its saved spec really changed: a hub poll that
// changed some other setting hands the store a new, equal layouts object.
function sendReadyIfSavedChanged() {
  const layoutId = currentLayoutId()
  if (!layoutId) return
  if (announced && layoutId === announcedLayoutId && specEquals(savedSpecOf(layoutId), announcedSaved)) return
  sendReady()
}

// Rectangles. Measured when the timer fires, so a burst of renders costs one
// measurement of the final layout. Unchanged rectangles are not re-sent (the
// clock re-renders the board every second) unless forced: after a spec from
// the editor, a day part, a ping, a resize or a mount, the editor always
// hears back.
let rootEl = null
let rectTimer = null
let lastRectsAt = -Infinity
let lastRectsJson = ''
let forceRects = false

function r2(n) {
  return Math.round(n * 100) / 100
}

// A box's marked sub-elements: drawn (a zero rectangle is display: none, e.g.
// a box showing "Too small") and at least partly inside the box.
function elementsOf(box, id, boxRect, out) {
  let n = 0
  const els = box.querySelectorAll('[data-edit]')
  for (let i = 0; i < els.length; i++) {
    if (n >= MAX_ELEMENTS_PER_PANEL || out.length >= MAX_ELEMENTS) return
    const el = els[i]
    const key = el.getAttribute('data-edit')
    if (!key) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (r.right <= boxRect.left || r.left >= boxRect.right || r.bottom <= boxRect.top || r.top >= boxRect.bottom) continue
    out.push({
      panelId: id,
      key,
      label: el.getAttribute('data-edit-label') || key,
      x: r2(r.left),
      y: r2(r.top),
      w: r2(r.width),
      h: r2(r.height),
    })
    n += 1
  }
}

function flushRects() {
  rectTimer = null
  lastRectsAt = Date.now()
  if (!rootEl) return
  const panels = []
  const elements = []
  rootEl.querySelectorAll('[data-panel-id]').forEach((box) => {
    const r = box.getBoundingClientRect()
    const id = box.getAttribute('data-panel-id')
    panels.push({
      id,
      type: box.getAttribute('data-panel-type'),
      x: r2(r.left),
      y: r2(r.top),
      w: r2(r.width),
      h: r2(r.height),
    })
    if (elements.length < MAX_ELEMENTS) elementsOf(box, id, r, elements)
  })
  const msg = {
    type: 'sd-edit:rects',
    layoutId: activeLayoutId,
    daypart: drawnDaypart,
    canvas: canvasSize(),
    panels,
    elements,
  }
  const json = JSON.stringify(msg)
  if (json === lastRectsJson && !forceRects) return
  lastRectsJson = json
  forceRects = false
  post(msg)
}

function scheduleRects(force) {
  if (!EDIT_BRIDGE_ACTIVE) return
  if (force) forceRects = true
  if (rectTimer) return // the pending call is the trailing one
  const wait = Math.max(0, RECTS_MS - (Date.now() - lastRectsAt))
  rectTimer = setTimeout(flushRects, wait)
}

// The editor's sub-element hover: data-edit-hover on every element of the
// hovered box whose data-edit is the hovered key, and on nothing else. Set on
// the DOM directly (the panels are not told), so it is re-applied after every
// commit of the layout, which may have replaced a marked element.
function applyElementHover() {
  if (!rootEl) return
  const id = state.hoverId
  const key = state.hoverElement
  rootEl.querySelectorAll('[data-edit-hover]').forEach((el) => {
    const box = el.closest('[data-panel-id]')
    const keep = !!key && !!box && box.getAttribute('data-panel-id') === id && el.getAttribute('data-edit') === key
    if (!keep) el.removeAttribute('data-edit-hover')
  })
  if (!id || !key) return
  rootEl.querySelectorAll('[data-panel-id]').forEach((box) => {
    if (box.getAttribute('data-panel-id') !== id) return
    box.querySelectorAll('[data-edit]').forEach((el) => {
      if (el.getAttribute('data-edit') === key && !el.hasAttribute('data-edit-hover')) {
        el.setAttribute('data-edit-hover', '')
      }
    })
  })
}

// --- In ----------------------------------------------------------------------

function onMessage(event) {
  if (event.origin !== ORIGIN) return
  if (event.source !== window.parent) return
  const data = event.data
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
  switch (data.type) {
    case 'sd-edit:spec': {
      const raw = data.spec == null || typeof data.spec !== 'object' ? null : data.spec
      const forId = typeof data.layoutId === 'string' && data.layoutId ? data.layoutId : null
      // A drag sends the same spec many times; only a real change re-renders.
      if (!specEquals(raw, state.draftRaw) || forId !== state.draftLayoutId) {
        setState({ draftRaw: raw, draftLayoutId: forId })
      }
      scheduleRects(true)
      break
    }
    case 'sd-edit:hover': {
      const id = typeof data.id === 'string' && data.id ? data.id : null
      const element = id && typeof data.element === 'string' && data.element ? data.element : null
      if (id !== state.hoverId || element !== state.hoverElement) {
        setState({ hoverId: id, hoverElement: element })
        applyElementHover()
      }
      break
    }
    case 'sd-edit:daypart': {
      const d = DAYPARTS.indexOf(data.daypart) >= 0 ? data.daypart : null
      if (d !== state.daypart) setState({ daypart: d })
      scheduleRects(true)
      break
    }
    case 'sd-edit:sample':
      setDemoMode(!!data.on)
      break
    case 'sd-edit:display': {
      const next = displayDraft(data.display)
      if (!specEquals(next, state.display)) setState({ display: next })
      break
    }
    case 'sd-edit:ping':
      sendReady()
      scheduleRects(true)
      break
    default:
      break
  }
}

// Listening from import, not from mount: a message that arrives while the
// board is still mounting is kept (the draft waits in the store).
if (EDIT_BRIDGE_ACTIVE) {
  window.addEventListener('message', onMessage)
  subscribeHomeAssistant(onHomeAssistant, { active: true })
}

// --- The hook ------------------------------------------------------------------

// useEditBridge(rootRef, savedRaw, layoutId, daypart) - called once by the
// spec layout on screen (Entry/SpecBoard.jsx) with its root element, the saved
// spec as the settings store holds it, its layout id and the day part it
// drew. A no-op outside edit mode.
export function useEditBridge(rootRef, savedRaw, layoutId, daypart) {
  // Ready once the first hub answer is in (so savedSpec is the hub's, not a
  // guess), then again whenever the saved spec (or the layout) changes.
  useEffect(() => {
    if (!EDIT_BRIDGE_ACTIVE) return undefined
    let cancelled = false
    const fallback = new Promise((resolve) => setTimeout(resolve, READY_FALLBACK_MS))
    Promise.race([whenHubSettled(), fallback]).then(() => {
      if (!cancelled) sendReadyIfSavedChanged()
    })
    return () => {
      cancelled = true
    }
  }, [savedRaw, layoutId])

  // The root and the layout it draws, and anything that resizes it.
  useEffect(() => {
    if (!EDIT_BRIDGE_ACTIVE) return undefined
    const el = rootRef.current
    rootEl = el
    activeLayoutId = isSpecLayout(layoutId) ? layoutId : null
    const onResize = () => scheduleRects(true)
    window.addEventListener('resize', onResize)
    let ro = null
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => scheduleRects(true))
      ro.observe(el)
    }
    scheduleRects(true)
    return () => {
      window.removeEventListener('resize', onResize)
      if (ro) ro.disconnect()
      if (rootEl === el) {
        rootEl = null
        activeLayoutId = null
      }
    }
  }, [rootRef, layoutId])

  // After every commit: a new draft, a hover, a day part, a panel swapping
  // content.
  useEffect(() => {
    if (!EDIT_BRIDGE_ACTIVE) return
    drawnDaypart = daypart || null
    applyElementHover()
    scheduleRects(false)
  })
}
