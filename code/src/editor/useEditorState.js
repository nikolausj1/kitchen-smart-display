// useEditorState - the editor's document state, one screen at a time.
//
//   saved     what the hub holds: { spec (null = built-in default), backdrop }
//   defaults  the built-in board, from the app's sd-edit:ready
//   draft     { spec, backdrop }: what is being edited. Starts as the saved
//             spec, or the defaults when the screen has none; exists once
//             both the hub read and (for an untuned screen) the app's ready
//             are in
//   past / future   undo and redo, whole drafts, 100 steps each way
//   coalesce  { key, at, windowMs } of the last change, so a drag, a slider
//             run or a burst of typing is one undo step, not a hundred
//
// The backdrop (display.entryBackdrop / entryDim) is part of the draft and of
// the history but not of the spec: it is saved to the screen's display
// settings in the same PATCH.

import { useMemo, useReducer } from 'react'
import {
  LAYOUT_ID,
  deepEqual,
  normalizeCanvas,
  normalizeSpec,
  panelTypeInfo,
  readBackdrop,
  sameLayout,
} from './spec.js'

const HISTORY_MAX = 100
export const CANVAS_PRESETS = [
  { w: 1920, h: 1080 },
  { w: 1280, h: 800 },
  { w: 960, h: 480 },
]

function initialState(deviceId, picked = CANVAS_PRESETS[0]) {
  return {
    deviceId,
    loaded: false,
    saved: null,
    defaults: null,
    mins: {},
    labels: {},
    draft: null,
    past: [],
    future: [],
    coalesce: null,
    selectedId: null,
    screen: null,
    picked,
  }
}

// What this screen shows today: its saved spec, else the built-in default.
const effectiveSpec = (s) => (s.saved ? s.saved.spec ?? s.defaults : null)

function readDevice(device) {
  const cfg = device?.config || {}
  return {
    spec: normalizeSpec(cfg.layouts?.[LAYOUT_ID]),
    backdrop: readBackdrop(cfg.display),
    screen: normalizeCanvas(device?.screen),
  }
}

function dirtyParts(s) {
  if (!s.draft || !s.saved) return { spec: false, backdrop: false }
  const eff = effectiveSpec(s)
  return {
    spec: !eff || !sameLayout(s.draft.spec, eff),
    backdrop: !deepEqual(s.draft.backdrop, s.saved.backdrop),
  }
}

const isDirty = (s) => {
  const d = dirtyParts(s)
  return d.spec || d.backdrop
}

function keepSelection(s) {
  if (s.selectedId == null || !s.draft) return s
  return s.draft.spec.panels.some((p) => p.id === s.selectedId) ? s : { ...s, selectedId: null }
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
    past: joins ? s.past : [...s.past, s.draft].slice(-HISTORY_MAX),
    future: joins ? s.future : [],
    coalesce: coalesce ? { key: coalesce, at, windowMs } : null,
  })
}

function reducer(s, a) {
  switch (a.type) {
    case 'switch':
      return initialState(a.deviceId, s.picked)

    // The hub's copy of this screen: first read, or a later refresh.
    case 'hubLoaded': {
      if (a.device?.id !== s.deviceId) return s
      const got = readDevice(a.device)
      const saved = { spec: got.spec, backdrop: got.backdrop }
      // The hub keeps screen sizes in memory only: right after a hub restart
      // it knows none for a poll or two. Keep the last one meanwhile.
      const screen = !got.screen ? s.screen : deepEqual(got.screen, s.screen) ? s.screen : got.screen
      if (!s.loaded) return withDraft({ ...s, loaded: true, saved, screen })
      const same = sameLayout(saved.spec, s.saved.spec) && deepEqual(saved.backdrop, s.saved.backdrop)
      if (same) return screen === s.screen ? s : { ...s, screen }
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
      const got = readDevice(a.device)
      const next = { ...s, saved: { spec: got.spec, backdrop: got.backdrop }, screen: got.screen ?? s.screen }
      if (s.draft !== a.submitted) return next
      const spec = effectiveSpec(next)
      return keepSelection(spec ? { ...next, draft: { spec, backdrop: got.backdrop }, coalesce: null } : next)
    }

    case 'appReady': {
      const defaults = normalizeSpec(a.defaultSpec)
      const { mins, labels } = panelTypeInfo(a.panelTypes)
      return withDraft({ ...s, defaults: defaults ?? s.defaults, mins, labels })
    }

    case 'update': {
      if (!s.draft) return s
      const spec = a.recipe(s.draft.spec)
      if (!spec || spec === s.draft.spec) return s
      return commit(s, { ...s.draft, spec }, a)
    }

    case 'backdrop': {
      if (!s.draft) return s
      return commit(s, { ...s.draft, backdrop: { ...s.draft.backdrop, ...a.patch } }, a)
    }

    // Esc mid-drag: drop the step that drag pushed.
    case 'abandon': {
      if (!s.draft || s.coalesce?.key !== a.key || !s.past.length) return s
      return keepSelection({ ...s, draft: s.past[s.past.length - 1], past: s.past.slice(0, -1), coalesce: null })
    }

    case 'undo': {
      if (!s.past.length) return s
      return keepSelection({
        ...s,
        draft: s.past[s.past.length - 1],
        past: s.past.slice(0, -1),
        future: [s.draft, ...s.future].slice(0, HISTORY_MAX),
        coalesce: null,
      })
    }

    case 'redo': {
      if (!s.future.length) return s
      return keepSelection({
        ...s,
        draft: s.future[0],
        past: [...s.past, s.draft].slice(-HISTORY_MAX),
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
      return s.selectedId === a.id ? s : { ...s, selectedId: a.id }

    case 'pick':
      return { ...s, picked: { w: a.w, h: a.h } }

    default:
      return s
  }
}

// Diagnostics. Every action that changed the draft is kept in a ring buffer at
// window.__sdEditorLog (the last 200) with each panel's geometry before and
// after, and an action that moves more than one panel's box at once is called
// out on the console: a nudge, a drag or a typed field only ever touches the
// selected panel, so more than one changing is the signature of the bug seen
// once on 2026-09-24 (six panels rearranged during a clock nudge; not
// reproduced since). If it happens again, this log says which action did it.
const LOG_MAX = 200
const geometryOf = (spec) =>
  Object.fromEntries((spec?.panels || []).map((p) => [p.id, `${p.x},${p.y},${p.w},${p.h}`]))

function logAction(before, after, a) {
  if (typeof window === 'undefined') return
  if (before?.draft?.spec === after?.draft?.spec) return
  const g0 = geometryOf(before?.draft?.spec)
  const g1 = geometryOf(after?.draft?.spec)
  const moved = Object.keys(g1).filter((id) => g0[id] !== undefined && g0[id] !== g1[id])
  const entry = { at: new Date().toISOString(), type: a.type, coalesce: a.coalesce ?? null, moved, before: g0, after: g1 }
  const log = (window.__sdEditorLog ||= [])
  log.push(entry)
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
  if (a.type === 'update' && moved.length > 1) {
    console.warn('[layout editor] one action moved several panels', entry)
  }
}

function loggedReducer(s, a) {
  const next = reducer(s, a)
  if (next !== s) logAction(s, next, a)
  return next
}

export default function useEditorState(deviceId) {
  const [state, dispatch] = useReducer(loggedReducer, deviceId, (id) => initialState(id))

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
      // An untouched default is stored as null ("use the built-in board"),
      // so a screen that was never tuned follows the code's default.
      isDefault: !!state.draft && !!state.defaults && sameLayout(state.draft.spec, state.defaults),
    }
  }, [state])

  const actions = useMemo(
    () => ({
      switchDevice: (id) => dispatch({ type: 'switch', deviceId: id }),
      hubLoaded: (device) => dispatch({ type: 'hubLoaded', device }),
      saved: (device, submitted) => dispatch({ type: 'saved', device, submitted }),
      appReady: (msg) => dispatch({ type: 'appReady', defaultSpec: msg.defaultSpec, panelTypes: msg.panelTypes }),
      // recipe: spec => spec (pure). opts: { coalesce, windowMs }.
      update: (recipe, opts = {}) => dispatch({ type: 'update', recipe, ...opts, at: performance.now() }),
      backdrop: (patch, opts = {}) => dispatch({ type: 'backdrop', patch, ...opts, at: performance.now() }),
      abandon: (key) => dispatch({ type: 'abandon', key }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      revert: () => dispatch({ type: 'revert' }),
      reset: () => dispatch({ type: 'reset' }),
      select: (id) => dispatch({ type: 'select', id }),
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
