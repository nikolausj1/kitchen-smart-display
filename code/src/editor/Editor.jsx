// Editor - the layout editor page (docs/designs/layout-editor.md, Contract
// v1, steps 1 and 2): layers on the left, the live preview in the middle,
// the inspector on the right, document and view controls on top.
//
// Nothing is written to the hub until Save, which sends ONE
//   PATCH /api/devices/<id>/config
//     { layouts: { entry: <normalized spec> | null }, display: { entryBackdrop?, entryDim? } }
// with each half only when it changed; null when the draft is the built-in
// board (Reset), so an untuned screen follows the code's default.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Inspector from './Inspector.jsx'
import Layers from './Layers.jsx'
import Stage from './Stage.jsx'
import TopBar, { StatusLine } from './TopBar.jsx'
import useAppBridge from './useAppBridge.js'
import useEditorState from './useEditorState.js'
import { nudgeRect } from './geometry.js'
// The app's own normaliser runs LAST before Save, so what is stored is exactly
// what the board renders. The editor's spec.js keeps its own copy for
// editing-time clamps (it must write a valid spec whatever app build the
// iframe shows); this is the belt to that pair of braces.
import { normalizeSpec as appNormalizeSpec } from '../views/TodayLayouts/layoutSpec.js'
import {
  HUB,
  HUB_SOURCE,
  REQUESTED_DEVICE,
  appFrame,
  editorUrlFor,
  fetchCountdownArt,
  fetchDevices,
  isWebScreen,
  patchDeviceConfig,
} from './hub.js'
import {
  LAYOUT_ID,
  MAX_PANELS,
  TYPE_LABELS,
  clamp,
  makeBlock,
  minPctFor,
  newBlockId,
  normalizeCanvas,
  normalizeColor,
  normalizeSpec,
  normalizeSrc,
  pctToPx,
  pctToPxRound,
  pxToPctKeeping,
  restack,
  round2,
} from './spec.js'

const PREFS_KEY = 'layoutEditorPrefs'
const DEFAULT_PREFS = { zoom: 'fit', grid: true, gridSize: 20, sample: false }
const REFRESH_MS = 15_000

// Per-viewer conveniences only; the page works the same without storage.
function readPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS
    return {
      zoom: ['fit', 0.5, 1].includes(raw.zoom) ? raw.zoom : DEFAULT_PREFS.zoom,
      grid: typeof raw.grid === 'boolean' ? raw.grid : DEFAULT_PREFS.grid,
      gridSize: [10, 20, 40].includes(raw.gridSize) ? raw.gridSize : DEFAULT_PREFS.gridSize,
      sample: typeof raw.sample === 'boolean' ? raw.sample : DEFAULT_PREFS.sample,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // private window or storage off: the defaults next time
  }
}

// --- pure spec edits (recipes for actions.update) -------------------------

function mapPanel(spec, id, fn) {
  let changed = false
  const panels = spec.panels.map((p) => {
    if (p.id !== id) return p
    const n = fn(p)
    if (n !== p) changed = true
    return n
  })
  return changed ? { ...spec, panels } : spec
}

const same = (obj, patch) => Object.keys(patch).every((k) => obj[k] === patch[k])
const withBox = (box) => (p) => (same(p, box) ? p : { ...p, ...box })
const withFields = (patch) => (p) => (same(p, patch) ? p : { ...p, ...patch })
const withProps = (patch) => (p) => (same(p.props, patch) ? p : { ...p, props: { ...p.props, ...patch } })

const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function Editor() {
  const [deviceId, setDeviceId] = useState(REQUESTED_DEVICE)
  const [devices, setDevices] = useState(null)
  const [devicesError, setDevicesError] = useState(null)
  const ed = useEditorState(deviceId)
  const { state, canvas, actions } = ed
  const [prefs, setPrefsState] = useState(readPrefs)
  const [frameKey, setFrameKey] = useState(0)
  const [rects, setRects] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState(false)
  const [art, setArt] = useState(null)
  const [focusTextSeq, setFocusTextSeq] = useState(0)
  const iframeRef = useRef(null)
  // Bumped around every save, so a background refresh that started before
  // the save cannot land after it with the old copy.
  const saveEpoch = useRef(0)

  const frame = useMemo(() => appFrame(deviceId || ''), [deviceId])
  const spec = state.draft?.spec ?? null
  const selected = spec?.panels.find((p) => p.id === state.selectedId) ?? null
  const device = devices?.find((d) => d.id === deviceId) ?? null
  const screens = useMemo(() => (devices || []).filter(isWebScreen), [devices])

  // --- the hub: screens, this screen's saved copy and size ---------------------
  useEffect(() => {
    let alive = true
    function load() {
      const epoch = saveEpoch.current
      fetchDevices()
        .then((data) => {
          if (!alive) return
          const list = Array.isArray(data?.devices) ? data.devices : []
          setDevices(list)
          setDevicesError(null)
          if (!deviceId) {
            // No ?device=: the first web screen.
            const first = list.find(isWebScreen)
            if (first) {
              window.history.replaceState(null, '', editorUrlFor(first.id))
              actions.switchDevice(first.id)
              setDeviceId(first.id)
            }
            return
          }
          const dev = list.find((d) => d.id === deviceId)
          if (dev && epoch === saveEpoch.current) actions.hubLoaded(dev)
        })
        .catch((e) => {
          if (alive) setDevicesError(e.message)
        })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [deviceId, actions])

  const loadArt = useCallback(() => {
    fetchCountdownArt()
      .then((d) => setArt({ items: Array.isArray(d?.items) ? d.items : [], error: null }))
      .catch((e) => setArt({ items: [], error: e.message }))
  }, [])
  useEffect(() => {
    loadArt()
  }, [loadArt])

  // --- the app in the iframe ------------------------------------------------------
  const onReady = useCallback((m) => actions.appReady(m), [actions])
  const onRects = useCallback((m, key) => {
    const byId = {}
    for (const r of Array.isArray(m.panels) ? m.panels : []) {
      if (r && typeof r.id === 'string' && [r.x, r.y, r.w, r.h].every(Number.isFinite)) {
        byId[r.id] = { x: r.x, y: r.y, w: r.w, h: r.h }
      }
    }
    setRects({ key, canvas: normalizeCanvas(m.canvas), byId })
  }, [])
  const bridge = useAppBridge({
    iframeRef,
    frame,
    frameKey,
    spec,
    canvas,
    sample: prefs.sample,
    hoverId,
    display: state.draft?.backdrop ?? null,
    onReady,
    onRects,
  })
  const appState = bridge.ready ? 'ready' : bridge.gaveUp ? 'gave-up' : 'waiting'
  const liveRects = rects && rects.key === frameKey ? rects : null

  // --- edits ------------------------------------------------------------------------
  const onGeometry = useCallback((id, box, opts) => actions.update((s) => mapPanel(s, id, withBox(box)), opts), [actions])

  // A typed X, Y, W or H (canvas px). Only that field changes.
  function onBoxField(id, key, value) {
    actions.update((s) =>
      mapPanel(s, id, (p) => {
        const cur = pctToPx(p, canvas)
        const min = minPctFor(p.type, state.mins)
        const minW = Math.ceil((min.w * canvas.w) / 100)
        const minH = Math.ceil((min.h * canvas.h) / 100)
        const box = { x: p.x, y: p.y, w: p.w, h: p.h }
        if (key === 'x') box.x = round2((clamp(value, 0, canvas.w - cur.w) / canvas.w) * 100)
        if (key === 'y') box.y = round2((clamp(value, 0, canvas.h - cur.h) / canvas.h) * 100)
        if (key === 'w') box.w = round2((clamp(value, minW, canvas.w - cur.x) / canvas.w) * 100)
        if (key === 'h') box.h = round2((clamp(value, minH, canvas.h - cur.y) / canvas.h) * 100)
        return withBox(box)(p)
      })
    )
  }

  function onProps(id, patch, field) {
    const clean = { ...patch }
    if ('color' in clean) {
      const c = normalizeColor(clean.color, null)
      if (!c) return setNotice({ kind: 'warn', text: 'Colours are hex: #rgb or #rrggbb.' })
      clean.color = c
    }
    if ('src' in clean) {
      const src = normalizeSrc(clean.src)
      if (String(clean.src || '').trim() && !src) {
        return setNotice({ kind: 'warn', text: 'An image is a Countdown Art picture or an http(s) URL.' })
      }
      clean.src = src
    }
    const opts = field ? { coalesce: `props:${id}:${field}`, windowMs: field === 'text' ? 2000 : 1000 } : {}
    actions.update((s) => mapPanel(s, id, withProps(clean)), opts)
  }

  const onPanel = (id, patch) => actions.update((s) => mapPanel(s, id, withFields(patch)))
  const onToggle = (id, key) => {
    const p = spec?.panels.find((x) => x.id === id)
    if (p) onPanel(id, { [key]: !p[key] })
  }
  const onRemove = (id) => actions.update((s) => ({ ...s, panels: s.panels.filter((p) => p.id !== id) }))
  const onReorder = (frontFirstIds) => actions.update((s) => ({ ...s, panels: restack(s.panels, frontFirstIds) }))
  const onBackdrop = (patch, field) => actions.backdrop(patch, field ? { coalesce: `backdrop:${field}`, windowMs: 1000 } : {})
  const onGlobal = (patch, field) =>
    actions.update((s) => ({ ...s, global: { ...s.global, ...patch } }), { coalesce: `global:${field}`, windowMs: 1000 })

  function onAdd(type) {
    if (!spec || spec.panels.length >= MAX_PANELS) return
    const id = newBlockId(type, new Set(spec.panels.map((p) => p.id)))
    actions.update((s) => ({ ...s, panels: [...s.panels, makeBlock(type, s, id)] }))
    actions.select(id)
    if (type === 'text') setFocusTextSeq((n) => n + 1)
    setNotice({ kind: 'info', text: `Added ${TYPE_LABELS[type].toLowerCase()} block ${id}.` })
  }

  function deleteSelected() {
    if (!selected) return
    if (selected.type === 'text' || selected.type === 'image') onRemove(selected.id)
    else onPanel(selected.id, { hidden: true })
  }

  function nudge(dx, dy) {
    if (!selected || selected.locked || selected.hidden) return
    actions.update(
      (s) =>
        mapPanel(s, selected.id, (p) => {
          const start = pctToPxRound(p, canvas)
          return withBox(pxToPctKeeping(p, start, nudgeRect(start, dx, dy, canvas), canvas))(p)
        }),
      { coalesce: `nudge:${selected.id}`, windowMs: 1000 }
    )
  }

  // --- document -----------------------------------------------------------------------
  async function save() {
    if (!state.draft || !ed.dirty || saving || !deviceId || !state.saved) return
    const submitted = state.draft
    const body = {}
    if (ed.specDirty) {
      body.layouts = {
        [LAYOUT_ID]: ed.isDefault
          ? null
          : appNormalizeSpec(
              normalizeSpec({ ...submitted.spec, canvas: { w: canvas.w, h: canvas.h } }),
              { defaultSpec: null },
            ),
      }
    }
    if (ed.backdropDirty) {
      const d = {}
      if (submitted.backdrop.entryBackdrop !== state.saved.backdrop.entryBackdrop) d.entryBackdrop = submitted.backdrop.entryBackdrop
      if (submitted.backdrop.entryDim !== state.saved.backdrop.entryDim) d.entryDim = submitted.backdrop.entryDim
      body.display = d
    }
    setSaving(true)
    saveEpoch.current += 1
    try {
      const patched = await patchDeviceConfig(deviceId, body)
      // The saved copy, read back. The list rather than the config GET: see
      // fetchDevices in hub.js. The PATCH answer is the same copy if that fails.
      let dev = patched
      try {
        const data = await fetchDevices()
        const list = Array.isArray(data?.devices) ? data.devices : []
        setDevices(list)
        dev = list.find((d) => d.id === deviceId) || patched
      } catch {
        // keep the PATCH answer
      }
      actions.saved(dev, submitted)
      setNotice({
        kind: 'ok',
        text: `${body.layouts && body.layouts[LAYOUT_ID] === null ? 'Saved as the default layout' : 'Saved'} at ${clock()}. ${
          device?.name || deviceId
        } picks it up within about 10 seconds.`,
      })
    } catch (e) {
      setNotice({ kind: 'error', text: `Save failed: ${e.message}` })
    } finally {
      saveEpoch.current += 1
      setSaving(false)
    }
  }

  function onSwitch(id) {
    if (!id || id === deviceId) return
    if (ed.dirty && !window.confirm('Discard the unsaved changes to this screen?')) return
    window.history.replaceState(null, '', editorUrlFor(id))
    actions.switchDevice(id)
    const dev = devices?.find((d) => d.id === id)
    if (dev) actions.hubLoaded(dev)
    setDeviceId(id)
    setFrameKey((n) => n + 1)
    setRects(null)
    setHoverId(null)
    setNotice(null)
  }

  function onPrefs(patch) {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    writePrefs(next)
  }

  function onRevert() {
    actions.revert()
    setNotice({ kind: 'info', text: 'Back to the saved layout.' })
  }

  function onReset() {
    actions.reset()
    setNotice({ kind: 'info', text: 'The built-in board. Save stores it as "use the default".' })
  }

  function onReload() {
    setFrameKey((n) => n + 1)
    setRects(null)
  }

  // --- keyboard -------------------------------------------------------------------------
  function onKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey
    const key = e.key
    if (mod && (key === 's' || key === 'S')) {
      e.preventDefault()
      // Let a focused field commit what was typed, then save.
      const a = document.activeElement
      if (a && a !== document.body && typeof a.blur === 'function') a.blur()
      setTimeout(() => latest.current.save(), 0)
      return
    }
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) actions.redo()
      else actions.undo()
      return
    }
    if (mod && (key === 'y' || key === 'Y')) {
      e.preventDefault()
      actions.redo()
      return
    }
    if (mod || e.altKey) return
    if (key === 'Escape') {
      if (state.selectedId) {
        e.preventDefault()
        actions.select(null)
      }
      return
    }
    if (!selected) return
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
      return
    }
    if (key === 'Enter' && selected.type === 'text') {
      e.preventDefault()
      setFocusTextSeq((n) => n + 1)
      return
    }
    const step = e.shiftKey ? 10 : 1
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[key]) {
      e.preventDefault()
      nudge(...moves[key])
    }
  }

  const latest = useRef({ save, onKeyDown })
  useLayoutEffect(() => {
    latest.current = { save, onKeyDown }
  })
  useEffect(() => {
    const fn = (e) => latest.current.onKeyDown(e)
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!ed.dirty) return undefined
    const fn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', fn)
    return () => window.removeEventListener('beforeunload', fn)
  }, [ed.dirty])

  // --- render ----------------------------------------------------------------------------
  let problem = null
  if (devicesError && !devices) problem = `The hub did not answer (${devicesError}).`
  else if (devices && !deviceId) problem = 'No web screens on the hub yet.'
  else if (devices && deviceId && !device) problem = `No screen called "${deviceId}" on the hub.`
  else if (device && !isWebScreen(device)) problem = `${device.name || deviceId} is not a web screen; the editor lays out the web app's boards.`

  const selPx = selected ? pctToPxRound(selected, canvas) : null
  const selectionText = selected
    ? `${selected.id}: ${selPx.x}, ${selPx.y}, ${selPx.w} x ${selPx.h} px`
    : null

  return (
    <div className="ed-app">
      <TopBar
        screens={screens}
        deviceId={deviceId}
        onSwitch={onSwitch}
        canvas={canvas}
        onPickCanvas={actions.pickCanvas}
        prefs={prefs}
        onPrefs={onPrefs}
        canUndo={ed.canUndo}
        canRedo={ed.canRedo}
        onUndo={actions.undo}
        onRedo={actions.redo}
        canRevert={ed.dirty}
        onRevert={onRevert}
        canReset={!!state.draft && !!state.defaults && !ed.isDefault}
        onReset={onReset}
        onReload={onReload}
        onSave={save}
        dirty={ed.dirty}
        saving={saving}
        canSave={!!state.saved}
        hasDraft={!!state.draft}
      />
      <Layers
        panels={spec?.panels}
        selectedId={state.selectedId}
        hoverId={hoverId}
        labels={state.labels}
        disabled={!spec}
        canAdd={!!spec && spec.panels.length < MAX_PANELS}
        onSelect={actions.select}
        onHover={setHoverId}
        onToggle={onToggle}
        onReorder={onReorder}
        onAdd={onAdd}
      />
      <main className="ed-main">
        {problem ? (
          <div className="ed-problem" role="alert">
            {problem}
          </div>
        ) : deviceId && state.loaded ? (
          // Mounted once the hub has answered, so the app loads at the
          // screen's size rather than at a guess and then resizes.
          <Stage
            frame={frame}
            frameKey={frameKey}
            iframeRef={iframeRef}
            onFrameLoad={bridge.ping}
            canvas={canvas}
            zoom={prefs.zoom}
            grid={prefs.grid}
            gridSize={prefs.gridSize}
            spec={spec}
            rects={liveRects}
            selectedId={state.selectedId}
            hoverId={hoverId}
            labels={state.labels}
            mins={state.mins}
            appState={appState}
            onSelect={actions.select}
            onHover={setHoverId}
            onGeometry={onGeometry}
            onAbandon={actions.abandon}
            onEditText={(id) => {
              actions.select(id)
              setFocusTextSeq((n) => n + 1)
            }}
          />
        ) : (
          <div className="ed-problem">{deviceId ? 'Reading the screen from the hub…' : 'Loading the screens…'}</div>
        )}
      </main>
      <Inspector
        draft={state.draft}
        panel={selected}
        canvas={canvas}
        labels={state.labels}
        mins={state.mins}
        art={art}
        onRefreshArt={loadArt}
        onBox={onBoxField}
        onProps={onProps}
        onPanel={onPanel}
        onRemove={onRemove}
        onBackdrop={onBackdrop}
        onGlobal={onGlobal}
        focusTextSeq={focusTextSeq}
      />
      <StatusLine
        hub={HUB}
        hubSource={HUB_SOURCE}
        frame={frame}
        appState={appState}
        appCanvas={liveRects?.canvas ?? bridge.appCanvas}
        canvas={canvas}
        notice={devicesError && devices ? { kind: 'warn', text: `Hub refresh failed: ${devicesError}` } : notice}
        selection={selectionText}
      />
    </div>
  )
}
