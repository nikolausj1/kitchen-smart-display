// useEditorState - the editor's document state: one screen, one layout.
//
//   deviceId, layoutId   the document ('entry' | 'board'; null until the
//             hub's first answer when the URL named none: then the Today
//             layout the screen shows, if the editor edits it, else entry)
//   saved     what the hub holds: { spec (null = built-in default), raw (the
//             stored value as is, for the PATCH's removals), backdrop }
//   defaults  the built-in layout, from the app's sd-edit:ready
//   draft     { spec, backdrop }: what is being edited. Starts as the saved
//             spec, or the defaults when the screen has none; exists once
//             both the hub read and (for an untuned screen) the app's ready
//             are in
//   daypart   the tab being edited: 'day' (the base) or a variant
//   past / future   undo and redo: { draft, part } entries, 100 each way,
//             one history per document (not per tab); part is the tab the
//             change was made in, and undo or redo goes back to that tab
//   coalesce  { key, at, windowMs } of the last change, so a drag, a slider
//             run or a burst of typing is one undo step, not a hundred
//   selectedId, selectedElement   a panel of the current part, and one of
//             its sub-elements (data-edit key) or null
//
// The backdrop (display.entryBackdrop / entryDim) is part of the draft and of
// the history but not of the spec: it is saved to the screen's display
// settings in the same PATCH (Entry only).

import { useMemo, useReducer } from 'react'
import { readSpec, sameLayout } from './appSpec.js'
import {
  DAYPARTS,
  DEFAULT_LAYOUT_ID,
  VARIANT_PARTS,
  isDict,
  isLayoutId,
  layoutMeta,
  normalizeCanvas,
  panelTypeInfo,
  partPanels,
  readBackdrop,
} from './spec.js'
import { deepEqual } from './util.js'

const HISTORY_MAX = 100
export const CANVAS_PRESETS = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 800 },
  { w: 960, h: 480 },
]

function initialState(deviceId, layoutId, picked = CANVAS_PRESETS[0]) {
  return {
    deviceId,
    layoutId: isLayoutId(layoutId) ? layoutId : null,
    loaded: false,
    saved: null,
    defaults: null,
    mins: {},
    labels: {},
    types: [],
    dayparts: DAYPARTS,
    draft: null,
    past: [],
    future: [],
    coalesce: null,
    selectedId: null,
    selectedElement: null,
    daypart: 'day',
    screen: null,
    picked,
  }
}

// The layout a screen opens on when the URL names none: the Today layout it
// shows when the editor can edit it, else the Entry board.
export function layoutForDevice(device) {
  const t = device?.config?.display?.todayLayout
  return isLayoutId(t) ? t : DEFAULT_LAYOUT_ID
}

function readDevice(device, layoutId) {
  const cfg = device?.config || {}
  const raw = isDict(cfg.layouts) && cfg.layouts[layoutId] != null ? cfg.layouts[layoutId] : null
  return {
    spec: readSpec(raw, layoutId),
    raw,
    backdrop: readBackdrop(cfg.display),
    screen: normalizeCanvas(device?.screen),
  }
}

// What this screen shows today: its saved spec, else the built-in default.
const effectiveSpec = (s) => (s.saved ? s.saved.spec ?? s.defaults : null)

function dirtyParts(s) {
  if (!s.draft || !s.saved) return { spec: false, backdrop: false }
  const eff = effectiveSpec(s)
  return {
    spec: !eff || !sameLayout(s.draft.spec, eff, s.layoutId),
    // The backdrop is the Entry board's; the Board has none to save.
    backdrop: layoutMeta(s.layoutId).backdrop && !deepEqual(s.draft.backdrop, s.saved.backdrop),
  }
}

const isDirty = (s) => {
  const d = dirtyParts(s)
  return d.spec || d.backdrop
}

// The selection must be a panel of the part on show.
function keepSelection(s) {
  if (s.selectedId == null || !s.draft) return s
  const panels = partPanels(s.draft.spec, s.daypart)
  if (panels && panels.some((p) => p.id === s.selectedId)) return s
  return { ...s, selectedId: null, selectedElement: null }
}

// Start the draft as soon as there is something to start it from.
function withDraft(s) {
  if (s.draft || !s.loaded) return s
  const spec = effectiveSpec(s)
  return spec ? { ...s, draft: { spec, backdrop: s.saved.backdrop } } : s
}

// A new draft. One history step, unless it continues the last change (same
// coalesce key, inside its window).
function commit(s, draft, { coalesce = null, windowMs = 1000, at = 0 } = {}) {
  if (!s.draft || draft === s.draft || deepEqual(draft, s.draft)) {
    return coalesce ? { ...s, coalesce: { key: coalesce, at, windowMs } } : s
  }
  const joins = !!coalesce && s.coalesce?.key === coalesce && at - s.coalesce.at <= s.coalesce.windowMs
  return keepSelection({
    ...s,
    draft,
    past: joins ? s.past : [...s.past, { draft: s.draft, part: s.daypart }].slice(-HISTORY_MAX),
    future: joins ? s.future : [],
    coalesce: coalesce ? { key: coalesce, at, windowMs } : null,
  })
}

function reducer(s, a) {
  switch (a.type) {
    case 'switch':
      return initialState(a.deviceId, a.layoutId, s.picked)

    // The hub's copy of this screen: first read, or a later refresh.
    case 'hubLoaded': {
      if (a.device?.id !== s.deviceId) return s
      const layoutId = s.layoutId || layoutForDevice(a.device)
      const got = readDevice(a.device, layoutId)
      const saved = { spec: got.spec, raw: got.raw, backdrop: got.backdrop }
      // The hub keeps screen sizes in memory only: right after a hub restart
      // it knows none for a poll or two. Keep the last one meanwhile.
      const screen = !got.screen ? s.screen : deepEqual(got.screen, s.screen) ? s.screen : got.screen
      if (!s.loaded) return withDraft({ ...s, layoutId, loaded: true, saved, screen })
      const same = sameLayout(saved.spec, s.saved.spec, layoutId) && deepEqual(saved.backdrop, s.saved.backdrop)
      if (same) {
        // Keep the stored value current (the next PATCH's removals are
        // worked out from it) without touching the draft.
        const rawSame = deepEqual(saved.raw, s.saved.raw)
        if (rawSame && screen === s.screen) return s
        return { ...s, screen, saved: rawSame ? s.saved : { ...s.saved, raw: saved.raw } }
      }
      // Saved elsewhere since we read it. A clean draft follows; a dirty one
      // is kept, and Revert now goes to the newer copy.
      if (isDirty(s) || !s.draft) return withDraft({ ...s, saved, screen })
      const next = { ...s, saved, screen }
      const spec = effectiveSpec(next)
      return keepSelection(spec ? { ...next, draft: { spec, backdrop: saved.backdrop }, coalesce: null } : next)
    }

    // After our own PATCH: the hub's copy is the saved one. The draft becomes
    // it too, unless it moved on while the save was in flight.
    case 'saved': {
      if (a.device?.id !== s.deviceId) return s
      const got = readDevice(a.device, s.layoutId)
      const next = {
        ...s,
        saved: { spec: got.spec, raw: got.raw, backdrop: got.backdrop },
        screen: got.screen ?? s.screen,
      }
      if (s.draft !== a.submitted) return next
      const spec = effectiveSpec(next)
      return keepSelection(spec ? { ...next, draft: { spec, backdrop: got.backdrop }, coalesce: null } : next)
    }

    case 'appReady': {
      const defaults = readSpec(a.defaultSpec, s.layoutId)
      const { mins, labels, types } = panelTypeInfo(a.panelTypes)
      const parts = Array.isArray(a.dayparts) ? DAYPARTS.filter((p) => p === 'day' || a.dayparts.includes(p)) : s.dayparts
      return withDraft({ ...s, defaults: defaults ?? s.defaults, mins, labels, types, dayparts: parts })
    }

    case 'update': {
      if (!s.draft) return s
      const spec = a.recipe(s.draft.spec, s.daypart)
      if (!spec || spec === s.draft.spec) return s
      return commit(s, { ...s.draft, spec }, a)
    }

    case 'backdrop': {
      if (!s.draft) return s
      return commit(s, { ...s.draft, backdrop: { ...s.draft.backdrop, ...a.patch } }, a)
    }

    // A history entry (or any stored copy) as the draft: one undo step.
    // null is the built-in layout.
    case 'load': {
      if (!s.draft) return s
      const spec = a.spec == null ? s.defaults : readSpec(a.spec, s.layoutId)
      if (!spec) return s
      return commit(s, { ...s.draft, spec })
    }

    // Esc mid-drag: drop the step that drag pushed.
    case 'abandon': {
      if (!s.draft || s.coalesce?.key !== a.key || !s.past.length) return s
      return keepSelection({ ...s, draft: s.past[s.past.length - 1].draft, past: s.past.slice(0, -1), coalesce: null })
    }

    case 'undo': {
      if (!s.past.length) return s
      const step = s.past[s.past.length - 1]
      return keepSelection({
        ...s,
        draft: step.draft,
        daypart: step.part,
        past: s.past.slice(0, -1),
        future: [{ draft: s.draft, part: step.part }, ...s.future].slice(0, HISTORY_MAX),
        coalesce: null,
      })
    }

    case 'redo': {
      if (!s.future.length) return s
      const step = s.future[0]
      return keepSelection({
        ...s,
        draft: step.draft,
        daypart: step.part,
        past: [...s.past, { draft: s.draft, part: step.part }].slice(-HISTORY_MAX),
        future: s.future.slice(1),
        coalesce: null,
      })
    }

    case 'revert': {
      const spec = effectiveSpec(s)
      if (!s.draft || !spec) return s
      return commit(s, { spec, backdrop: s.saved.backdrop })
    }

    case 'reset': {
      if (!s.draft || !s.defaults) return s
      return commit(s, { ...s.draft, spec: s.defaults })
    }

    case 'select':
      return s.selectedId === a.id && s.selectedElement == null ? s : { ...s, selectedId: a.id, selectedElement: null }

    case 'selectElement':
      if (s.selectedId == null || s.selectedElement === a.key) return s
      return { ...s, selectedElement: a.key ?? null }

    case 'daypart':
      return s.daypart === a.part ? s : keepSelection({ ...s, daypart: a.part, selectedElement: null, coalesce: null })

    case 'pick':
      return { ...s, picked: { w: a.w, h: a.h } }

    default:
      return s
  }
}

// Diagnostics. Every action that changed the draft is kept in a ring buffer at
// window.__sdEditorLog (the last 200) with each panel's geometry before and
// after (variant panels as '<part>:<id>'), and an action that moves more than
// one panel's box at once is called out on the console: a nudge, a drag or a
// typed field only ever touches the selected panel, so more than one changing
// is the signature of the bug seen once on 2026-09-24 (six panels rearranged
// during a clock nudge; not reproduced since). If it happens again, this log
// says which action did it.
const LOG_MAX = 200
function geometryOf(spec) {
  const out = {}
  const add = (prefix, panels) => {
    for (const p of Array.isArray(panels) ? panels : []) out[`${prefix}${p.id}`] = `${p.x},${p.y},${p.w},${p.h}`
  }
  add('', spec?.panels)
  for (const part of VARIANT_PARTS) add(`${part}:`, spec?.variants?.[part]?.panels)
  return out
}

function logAction(before, after, a) {
  if (typeof window === 'undefined') return
  if (before?.draft?.spec === after?.draft?.spec) return
  const g0 = geometryOf(before?.draft?.spec)
  const g1 = geometryOf(after?.draft?.spec)
  const moved = Object.keys(g1).filter((id) => g0[id] !== undefined && g0[id] !== g1[id])
  const entry = {
    at: new Date().toISOString(),
    type: a.type,
    coalesce: a.coalesce ?? null,
    layout: after?.layoutId ?? null,
    part: after?.daypart ?? null,
    moved,
    before: g0,
    after: g1,
  }
  const log = (window.__sdEditorLog ||= [])
  log.push(entry)
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
  if (a.type === 'update' && moved.length > 1) {
    console.warn('[layout editor] one action moved several panels', entry)
  }
}

// StrictMode (dev) runs a reducer twice per action: log each action once.
const loggedActions = new WeakSet()
function loggedReducer(s, a) {
  const next = reducer(s, a)
  if (next !== s && !loggedActions.has(a)) {
    loggedActions.add(a)
    logAction(s, next, a)
  }
  return next
}

export default function useEditorState(deviceId, layoutId) {
  const [state, dispatch] = useReducer(loggedReducer, null, () => initialState(deviceId, layoutId))

  // The canvas: the screen's own viewport when the hub knows it, else what
  // the saved spec was drawn on, else the picker.
  const canvas = useMemo(() => {
    if (state.screen) return { ...state.screen, source: 'screen' }
    const c = state.saved?.spec?.canvas
    if (c) return { w: c.w, h: c.h, source: 'saved' }
    return { ...state.picked, source: 'picker' }
  }, [state.screen, state.saved, state.picked])

  const flags = useMemo(() => {
    const d = dirtyParts(state)
    return {
      specDirty: d.spec,
      backdropDirty: d.backdrop,
      dirty: d.spec || d.backdrop,
      // An untouched default is stored as null ("use the built-in layout"),
      // so a screen that was never tuned follows the code's default.
      isDefault: !!state.draft && !!state.defaults && sameLayout(state.draft.spec, state.defaults, state.layoutId),
    }
  }, [state])

  const actions = useMemo(
    () => ({
      switchTo: (id, layout) => dispatch({ type: 'switch', deviceId: id, layoutId: layout }),
      hubLoaded: (device) => dispatch({ type: 'hubLoaded', device }),
      saved: (device, submitted) => dispatch({ type: 'saved', device, submitted }),
      appReady: (msg) =>
        dispatch({ type: 'appReady', defaultSpec: msg.defaultSpec, panelTypes: msg.panelTypes, dayparts: msg.dayparts }),
      // recipe: (spec, part) => spec (pure). opts: { coalesce, windowMs }.
      update: (recipe, opts = {}) => dispatch({ type: 'update', recipe, ...opts, at: performance.now() }),
      backdrop: (patch, opts = {}) => dispatch({ type: 'backdrop', patch, ...opts, at: performance.now() }),
      load: (spec) => dispatch({ type: 'load', spec }),
      abandon: (key) => dispatch({ type: 'abandon', key }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      revert: () => dispatch({ type: 'revert' }),
      reset: () => dispatch({ type: 'reset' }),
      select: (id) => dispatch({ type: 'select', id }),
      selectElement: (key) => dispatch({ type: 'selectElement', key }),
      daypart: (part) => dispatch({ type: 'daypart', part }),
      pickCanvas: (w, h) => dispatch({ type: 'pick', w, h }),
    }),
    []
  )

  return {
    state,
    canvas,
    ...flags,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    actions,
  }
}
