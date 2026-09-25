import { useEffect, useSyncExternalStore } from 'react'
import { EDIT_MODE } from '../../lib/kioskMode.js'
import { getSettings, whenHubSettled } from '../../lib/settings.js'
import { setDemoMode } from './data/demoMode.js'
import {
  DEFAULT_ENTRY_SPEC,
  ENTRY_LAYOUT_ID,
  PANEL_TYPE_LIST,
  normalizeSpec,
  specEquals,
} from './layoutSpec.js'

// editBridge - the app's half of the layout editor's message channel
// (docs/designs/layout-editor.md, "Contract v1"). The editor page loads this
// app in an iframe at the screen's resolution with ?edit=1 and talks to it
// with window.postMessage, same origin both ways.
//
//   app -> editor  sd-edit:ready   { layoutId, canvas, savedSpec, defaultSpec,
//                                    panelTypes }
//                                  once the first hub answer is in (or 2 s
//                                  passed), whenever the saved spec changes on
//                                  the hub, and in reply to a ping
//                  sd-edit:rects   { canvas, panels: [{ id, type, x, y, w, h }] }
//                                  every box's rectangle in iframe pixels,
//                                  after a render or a resize that moved one,
//                                  throttled to ~100 ms with a trailing call
//   editor -> app  sd-edit:spec    { spec }  render this draft (normalized on
//                                  receipt); spec: null drops the draft and
//                                  goes back to the saved layout
//                  sd-edit:hover   { id | null }  outline that box
//                  sd-edit:sample  { on }  demo data on or off
//                  sd-edit:ping    reply with ready (and fresh rects)
//                  sd-edit:display { display: { entryBackdrop, entryDim } }
//                                  the editor's draft backdrop (an addition
//                                  to the v1 table, proposed by the editor):
//                                  previewed until saved; null clears it
//
// Only active in edit mode AND inside a frame. Every message in is checked
// for this page's own origin and for coming from the frame's parent.

export const EDIT_BRIDGE_ACTIVE =
  EDIT_MODE && typeof window !== 'undefined' && window.parent && window.parent !== window

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
const RECTS_MS = 100
const READY_FALLBACK_MS = 2000

// --- The draft and hover store (read by the Entry layout) --------------------

let state = { draft: null, hoverId: null, display: null }
const listeners = new Set()

function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// The editor's draft spec (normalized), or null until one has arrived.
export function useEditDraft() {
  return useSyncExternalStore(subscribe, () => state.draft, () => null)
}

// The id of the box the editor is pointing at, or null.
export function useEditHover() {
  return useSyncExternalStore(subscribe, () => state.hoverId, () => null)
}

// The editor's draft backdrop settings ({ entryBackdrop?, entryDim? }, only
// the valid ones), or null: they win over the screen's saved display settings.
export function useEditDisplay() {
  return useSyncExternalStore(subscribe, () => state.display, () => null)
}

function displayDraft(d) {
  if (!d || typeof d !== 'object') return null
  const out = {}
  if (d.entryBackdrop === 'photos' || d.entryBackdrop === 'black') out.entryBackdrop = d.entryBackdrop
  if (typeof d.entryDim === 'number' && Number.isFinite(d.entryDim)) out.entryDim = d.entryDim
  return Object.keys(out).length ? out : null
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

// The saved spec last announced (normalized; null = the built-in default),
// and whether any ready has gone out yet.
let announced = false
let announcedSaved = null

function sendReady() {
  const raw = getSettings()?.layouts?.entry ?? null
  const savedSpec = normalizeSpec(raw, { defaultSpec: null })
  announced = true
  announcedSaved = savedSpec
  post({
    type: 'sd-edit:ready',
    layoutId: ENTRY_LAYOUT_ID,
    canvas: canvasSize(),
    savedSpec,
    defaultSpec: DEFAULT_ENTRY_SPEC,
    panelTypes: PANEL_TYPE_LIST,
  })
}

// Only when the saved spec really changed: a hub poll that changed some other
// setting hands the store a new, equal layouts object.
function sendReadyIfSavedChanged() {
  const raw = getSettings()?.layouts?.entry ?? null
  if (announced && specEquals(normalizeSpec(raw, { defaultSpec: null }), announcedSaved)) return
  sendReady()
}

// Rectangles. Measured when the timer fires, so a burst of renders costs one
// measurement of the final layout. Unchanged rectangles are not re-sent (the
// clock re-renders the board every second) unless forced: after a spec from
// the editor, a ping, a resize or a mount, the editor always hears back.
let rootEl = null
let rectTimer = null
let lastRectsAt = -Infinity
let lastRectsJson = ''
let forceRects = false

function r2(n) {
  return Math.round(n * 100) / 100
}

function flushRects() {
  rectTimer = null
  lastRectsAt = Date.now()
  if (!rootEl) return
  const panels = []
  rootEl.querySelectorAll('[data-panel-id]').forEach((el) => {
    const r = el.getBoundingClientRect()
    panels.push({
      id: el.getAttribute('data-panel-id'),
      type: el.getAttribute('data-panel-type'),
      x: r2(r.left),
      y: r2(r.top),
      w: r2(r.width),
      h: r2(r.height),
    })
  })
  const msg = { type: 'sd-edit:rects', canvas: canvasSize(), panels }
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

// --- In ----------------------------------------------------------------------

function onMessage(event) {
  if (event.origin !== ORIGIN) return
  if (event.source !== window.parent) return
  const data = event.data
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
  switch (data.type) {
    case 'sd-edit:spec': {
      const next = data.spec == null ? null : normalizeSpec(data.spec)
      // A drag sends the same spec many times; only a real change re-renders.
      if (!specEquals(next, state.draft)) setState({ draft: next })
      scheduleRects(true)
      break
    }
    case 'sd-edit:hover': {
      const id = typeof data.id === 'string' && data.id ? data.id : null
      if (id !== state.hoverId) setState({ hoverId: id })
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
}

// --- The hook ------------------------------------------------------------------

// useEditBridge(rootRef, savedRaw) - called once by the Entry layout with its
// root element and the saved spec as the settings store holds it. A no-op
// outside edit mode.
export function useEditBridge(rootRef, savedRaw) {
  // Ready once the first hub answer is in (so savedSpec is the hub's, not a
  // guess), then again whenever the saved spec changes.
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
  }, [savedRaw])

  // The root, and anything that resizes it.
  useEffect(() => {
    if (!EDIT_BRIDGE_ACTIVE) return undefined
    const el = rootRef.current
    rootEl = el
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
      if (rootEl === el) rootEl = null
    }
  }, [rootRef])

  // After every commit: a new draft, a hover, a panel swapping content.
  useEffect(() => {
    if (EDIT_BRIDGE_ACTIVE) scheduleRects(false)
  })
}
