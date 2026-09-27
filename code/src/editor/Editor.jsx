// Editor - the layout editor page (docs/designs/layout-editor.md, Contracts
// v1 and v2): layers on the left, the live preview in the middle with the
// day-part tabs above it (Entry board), the inspector on the right, document
// and view controls on top.
//
// One document at a time: a screen and one of its layouts (?layout=entry or
// board; without it, the Today layout the screen shows when the editor can
// edit it, else entry). Nothing is written to the hub until Save, which sends
// ONE
//   PATCH /api/devices/<id>/config
//     { layouts: { <layoutId>: <spec> | null }, display: { entryBackdrop?, entryDim? } }
// with each half only when it changed; null when the draft is the built-in
// layout (Reset), so an untuned screen follows the code's default. The spec
// carries explicit nulls for whatever the stored copy has and the draft no
// longer does (a removed day part), because the hub deep-merges the PATCH
// (withRemovals in spec.js), including inside a panel (a removed rule is
// `when: null`, a removed element style `elements: { <key>: null }`); a panel
// the save does not change goes back exactly as stored. Copy layout to…
// writes another screen's layouts.<layoutId> with this screen's SAVED layout
// the same way.
//
// Chunk 1 of panels and controls (docs/designs/panels-and-controls.md):
// element styles (the inspector's Element section, the layers' element
// tree), the box v2 props, visibility rules ("Show when"), several panels
// selected at once (move, align, distribute, match), and copy and paste style.
//
// Chunk 4: the block types are the app's (schema.js, the type registry), so
// the shape is added (behind the selection or in front), edited, saved and
// removed like text and image. A panel of a type the app does not know is
// kept exactly as stored: not on the stage, not in any edit, dimmed in the
// layers; the one thing to do with it is to remove it.
//
// Blocks (Justin, 2026-09-27): in the UI everything on a layout is a block
// (the code, the spec and the messages keep "panel"). Delete (and Backspace,
// and the inspector's Delete) takes the selection off the layout, one undo
// step, whatever its type; the eye still hides. With a part of a block
// selected, Delete hides that part. Any type may be on a layout any number
// of times: Add block (AddMenu.jsx, catalog.js) lists every type the app
// knows, grouped and searchable, and a type already there comes in as a
// further instance, '<type>-<4 hex>', one grid step off the first; the
// layers number them ("Weather 2"; spec.js instanceNames).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Dayparts from './Dayparts.jsx'
import Inspector from './Inspector.jsx'
import Layers from './Layers.jsx'
import Stage from './Stage.jsx'
import TopBar, { StatusLine } from './TopBar.jsx'
import { Dialog } from './menus.jsx'
import useAppBridge, { readRuleMarks } from './useAppBridge.js'
import useEditorState from './useEditorState.js'
import { finalSpec, newBlock, newPanel, sameLayout, samePanel, withVariant, withoutVariant } from './appSpec.js'
import { buildCatalog } from './catalog.js'
import {
  addPanel,
  alignPanels,
  backmost,
  distributePanels,
  editGlobal,
  editPanels,
  followDayGlobal,
  insertBefore,
  insertBehind,
  mapPanel,
  mapPanels,
  matchPanels,
  movePanels,
  removePanel,
  removePanels,
  setEveningFrom,
  styleOf,
  unionPct,
  unionPx,
  withBox,
  withElementStyle,
  withFields,
  withProps,
  withPropPath,
  withStyle,
  withWhen,
  withoutElementStyle,
  withoutElementStyles,
} from './edits.js'
import { nudgeRect } from './geometry.js'
import {
  HUB,
  HUB_SOURCE,
  REQUESTED_DEVICE,
  REQUESTED_LAYOUT,
  appAsset,
  appFrame,
  editorUrlFor,
  fetchCountdownArt,
  fetchDevices,
  fetchLayoutHistory,
  isWebScreen,
  patchDeviceConfig,
} from './hub.js'
import {
  elementLabel,
  elementList,
  hasOwnProps,
  isBlockType,
  isFunctionalType,
  isKnownType,
  knobDefaultsFor,
  knobFields,
  registerFromReady,
  typeRegistry,
} from './schema.js'
import {
  DAYPART_LABELS,
  MAX_PANELS,
  VARIANT_PARTS,
  blockName,
  clamp,
  elementAncestors,
  elementStyleOf,
  hasPart,
  instanceNames,
  isDict,
  layoutMeta,
  makeBlock,
  makePanel,
  minPctFor,
  newBlockId,
  normalizeCanvas,
  normalizeColor,
  normalizeSrc,
  normalizeWhen,
  panelLabel,
  partPanels,
  partWhen,
  pctToPx,
  pctToPxRound,
  pxToPctKeeping,
  restack,
  round2,
  typeLabel,
  withRemovals,
} from './spec.js'
import { ago } from './util.js'

const PREFS_KEY = 'layoutEditorPrefs'
const DEFAULT_PREFS = { zoom: 'fit', grid: true, gridSize: 20, sample: false }
const REFRESH_MS = 15_000
const TOAST_MS = 6000

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

const clock = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const nameOf = (d, id) => d?.name || id
const storedLayout = (device, layoutId) => {
  const l = device?.config?.layouts
  return isDict(l) && l[layoutId] != null ? l[layoutId] : null
}

// Every block id in the spec, all day parts, so a new one is unique across
// the layout.
function allIds(spec) {
  const ids = new Set((spec?.panels || []).map((p) => p.id))
  for (const part of VARIANT_PARTS) for (const p of spec?.variants?.[part]?.panels || []) ids.add(p.id)
  return ids
}

// "7 blocks · Morning, Evening" for a stored layout, "Default layout" for none.
function describe(raw) {
  if (!isDict(raw) || !Array.isArray(raw.panels)) return 'Default layout'
  const n = raw.panels.length
  const parts = VARIANT_PARTS.filter((p) => isDict(raw.variants?.[p]) && Array.isArray(raw.variants[p].panels)).map((p) => DAYPART_LABELS[p])
  return `${n} block${n === 1 ? '' : 's'}${parts.length ? ` · ${parts.join(', ')}` : ''}`
}

// "Weather", "Weather and Clock", "Weather, Clock and Text".
function joinAnd(list) {
  if (list.length < 2) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

// One above the highest z of a list (never past 999).
const frontZ = (list) => Math.min(999, list.reduce((m, x) => Math.max(m, Number.isFinite(x.z) ? x.z : 0), 0) + 1)

export default function Editor() {
  const [devices, setDevices] = useState(null)
  const [devicesError, setDevicesError] = useState(null)
  const ed = useEditorState(REQUESTED_DEVICE, REQUESTED_LAYOUT)
  const { state, canvas, actions } = ed
  const deviceId = state.deviceId
  const layoutId = state.layoutId
  const meta = layoutMeta(layoutId)
  const [prefs, setPrefsState] = useState(readPrefs)
  const [frameKey, setFrameKey] = useState(0)
  const [rects, setRects] = useState(null)
  const [hover, setHover] = useState(null) // { id, element } | null
  const [notice, setNotice] = useState(null)
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [art, setArt] = useState(null)
  const [focusText, setFocusText] = useState(null) // { id }: focus that text block's text
  const [history, setHistory] = useState(null) // { deviceId, items, loading, error }
  const [copyAsk, setCopyAsk] = useState(null) // { targetId }
  const [copying, setCopying] = useState(false)
  const [styleClip, setStyleClip] = useState(null) // styleOf() + { label }: Copy style
  const iframeRef = useRef(null)
  // Bumped around every save, so a background refresh that started before
  // the save cannot land after it with the old copy.
  const saveEpoch = useRef(0)

  const frame = useMemo(() => appFrame(deviceId || '', layoutId || meta.id), [deviceId, layoutId, meta.id])
  const spec = state.draft?.spec ?? null
  // The Board has no day parts.
  const part = meta.variants ? state.daypart : 'day'
  const panels = partPanels(spec, part)
  const hasVariant = !spec || !!panels
  const selected = panels?.find((p) => p.id === state.selectedId) ?? null
  // Every block's name on this part: "Weather", "Weather 2".
  const names = useMemo(() => instanceNames(panels, state.labels), [panels, state.labels])
  // The app's types: which it knows changes when its ready arrives.
  const types = typeRegistry()
  // Several selected, in the order they were picked; never a type the app
  // does not know (nothing may move or restyle it).
  const group = useMemo(
    () =>
      panels && state.selectedIds.length > 1
        ? state.selectedIds.map((id) => panels.find((p) => p.id === id)).filter((p) => p && types.known.has(p.type))
        : [],
    [panels, state.selectedIds, types]
  )
  // What the stage draws and edits: the types the app knows.
  const stagePanels = useMemo(() => (panels ? panels.filter((p) => types.known.has(p.type)) : panels), [panels, types])
  const editable = (p) => !!p && isKnownType(p.type)
  const device = devices?.find((d) => d.id === deviceId) ?? null
  const screens = useMemo(() => (devices || []).filter(isWebScreen), [devices])
  const copyTargets = useMemo(() => screens.filter((d) => d.id !== deviceId), [screens, deviceId])
  const effectiveSaved = state.saved ? state.saved.spec ?? state.defaults : null

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
            if (first) actions.switchTo(first.id, REQUESTED_LAYOUT)
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

  // The address bar names the document, so a reload opens the same one.
  useEffect(() => {
    if (!deviceId || !layoutId) return
    const url = editorUrlFor(deviceId, layoutId)
    if (url !== window.location.href) window.history.replaceState(null, '', url)
  }, [deviceId, layoutId])

  const loadArt = useCallback(() => {
    fetchCountdownArt()
      .then((d) => setArt({ items: Array.isArray(d?.items) ? d.items : [], error: null }))
      .catch((e) => setArt({ items: [], error: e.message }))
  }, [])
  useEffect(() => {
    loadArt()
  }, [loadArt])

  const loadHistory = useCallback(() => {
    if (!deviceId) return
    setHistory((h) => ({ deviceId, items: h?.deviceId === deviceId ? h.items : null, loading: true, error: null }))
    fetchLayoutHistory(deviceId)
      .then((list) => setHistory({ deviceId, items: Array.isArray(list) ? list : [], loading: false, error: null }))
      .catch((e) => setHistory((h) => ({ deviceId, items: h?.deviceId === deviceId ? h.items : null, loading: false, error: e.message })))
  }, [deviceId])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  // --- the app in the iframe ------------------------------------------------------
  const onReady = useCallback(
    (m) => {
      // Schemas and types (which are blocks, which the app knows) first: the
      // reducer normalises with them.
      registerFromReady(m)
      actions.appReady(m)
    },
    [actions]
  )
  const onRects = useCallback((m, key) => {
    const byId = {}
    for (const r of Array.isArray(m.panels) ? m.panels : []) {
      if (r && typeof r.id === 'string' && [r.x, r.y, r.w, r.h].every(Number.isFinite)) {
        byId[r.id] = { x: r.x, y: r.y, w: r.w, h: r.h }
      }
    }
    const elements = {}
    for (const el of Array.isArray(m.elements) ? m.elements : []) {
      if (!isDict(el) || typeof el.panelId !== 'string' || typeof el.key !== 'string' || !el.key) continue
      if (![el.x, el.y, el.w, el.h].every(Number.isFinite) || el.w <= 0 || el.h <= 0) continue
      ;(elements[el.panelId] ||= []).push({
        key: el.key,
        label: typeof el.label === 'string' && el.label ? el.label : null,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
      })
    }
    // The boxes the app marks as carrying a rule: its own `rule` flags when
    // the rects have them, else data-rule read from the preview (same origin).
    const list = Array.isArray(m.panels) ? m.panels : []
    const flagged = list.some((r) => isDict(r) && 'rule' in r)
    const rules = flagged
      ? new Set(list.filter((r) => isDict(r) && r.rule && typeof r.id === 'string').map((r) => r.id))
      : readRuleMarks(iframeRef.current)
    setRects({
      key,
      canvas: normalizeCanvas(m.canvas),
      byId,
      elements,
      rules,
      // What the app drew them for (v2 rects say; older ones do not).
      layoutId: typeof m.layoutId === 'string' ? m.layoutId : null,
      daypart: typeof m.daypart === 'string' ? m.daypart : null,
    })
  }, [])
  const bridge = useAppBridge({
    iframeRef,
    frame,
    frameKey,
    layoutId: layoutId || meta.id,
    spec,
    canvas,
    sample: prefs.sample,
    hover,
    daypart: part,
    display: meta.backdrop ? state.draft?.backdrop ?? null : null,
    onReady,
    onRects,
  })
  const appState = bridge.ready ? 'ready' : bridge.gaveUp ? 'gave-up' : 'waiting'
  // Rects from this iframe load, for this layout and the day part it draws
  // now (a part with no layout of its own draws Day): right after a tab
  // switch the last ones are the old part's.
  const drawnPart = panels ? part : 'day'
  const liveRects =
    rects &&
    rects.key === frameKey &&
    (rects.layoutId == null || rects.layoutId === layoutId) &&
    (rects.daypart == null || rects.daypart === drawnPart)
      ? rects
      : null

  // What the app calls the selected panel's sub-elements (data-edit-label):
  // a key's label when all its instances share one that is not just the key.
  const reportedLabels = useMemo(() => {
    const seen = {}
    for (const el of liveRects?.elements?.[state.selectedId] || []) {
      if (el.label && el.label !== el.key) (seen[el.key] ||= new Set()).add(el.label)
    }
    const out = {}
    for (const [k, set] of Object.entries(seen)) if (set.size === 1) out[k] = [...set][0]
    return out
  }, [liveRects, state.selectedId])

  // The selected element with the elements it sits in, outermost first:
  // ['tile', 'title'] for Countdowns › Tile › Title.
  const elementPath = useMemo(() => {
    if (!selected || !state.selectedElement) return []
    return [...elementAncestors(selected.type, state.selectedElement, liveRects?.elements?.[selected.id]), state.selectedElement]
  }, [selected, state.selectedElement, liveRects])

  // --- edits ------------------------------------------------------------------------
  // Every recipe is (spec, part) => spec: the reducer applies it to the day
  // part it holds.
  const onGeometry = useCallback(
    (id, box, opts) => actions.update((s, p) => mapPanel(s, p, id, withBox(box)), opts),
    [actions]
  )

  // A typed X, Y, W or H (canvas px). Only that field changes.
  function onBoxField(id, key, value) {
    actions.update((s, p) =>
      mapPanel(s, p, id, (panel) => {
        const cur = pctToPx(panel, canvas)
        const min = minPctFor(panel.type, state.mins)
        const minW = Math.ceil((min.w * canvas.w) / 100)
        const minH = Math.ceil((min.h * canvas.h) / 100)
        const box = { x: panel.x, y: panel.y, w: panel.w, h: panel.h }
        if (key === 'x') box.x = round2((clamp(value, 0, canvas.w - cur.w) / canvas.w) * 100)
        if (key === 'y') box.y = round2((clamp(value, 0, canvas.h - cur.h) / canvas.h) * 100)
        if (key === 'w') box.w = round2((clamp(value, minW, canvas.w - cur.x) / canvas.w) * 100)
        if (key === 'h') box.h = round2((clamp(value, minH, canvas.h - cur.y) / canvas.h) * 100)
        return withBox(box)(panel)
      })
    )
  }

  // Props, universal or knobs. `field`: coalesce a stream of changes to it
  // (a slider run, typing) into one undo step.
  function onProps(id, patch, field) {
    const panel = panels?.find((x) => x.id === id)
    if (!panel) return
    const fields = knobFields(panel.type)
    const clean = { ...patch }
    for (const k of Object.keys(clean)) {
      const f = fields.find((x) => x.key === k)
      if (f?.type === 'color' || (panel.type === 'text' && k === 'color')) {
        const c = normalizeColor(clean[k], null)
        if (!c) return setNotice({ kind: 'warn', text: 'Colours are hex: #rgb or #rrggbb.' })
        clean[k] = c
      }
    }
    if (panel.type === 'image' && 'src' in clean) {
      const src = normalizeSrc(clean.src)
      if (String(clean.src || '').trim() && !src) {
        return setNotice({ kind: 'warn', text: 'An image is a Countdown Art picture or an http(s) URL.' })
      }
      clean.src = src
    }
    const opts = field ? { coalesce: `props:${part}:${id}:${field}`, windowMs: field === 'text' ? 2000 : 1000 } : {}
    actions.update((s, p) => mapPanel(s, p, id, withProps(clean)), opts)
  }

  function onResetKnobs(id) {
    const panel = panels?.find((x) => x.id === id)
    if (!panel) return
    const defaults = knobDefaultsFor(panel.type)
    if (!Object.keys(defaults).length) return
    actions.update((s, p) => mapPanel(s, p, id, withProps(defaults)))
    setNotice({ kind: 'info', text: `${typeLabel(panel.type, state.labels)}: every setting back to its default.` })
  }

  const onPanel = (id, patch) => actions.update((s, p) => mapPanel(s, p, id, withFields(patch)))
  const onToggle = (id, key) => {
    const panel = panels?.find((x) => x.id === id)
    if (editable(panel)) onPanel(id, { [key]: !panel[key] })
  }
  // Delete: the block off the layout, whatever its type, one undo step. A
  // functional type the layout's default has (the Entry board's clock) comes
  // back with Add block, in its default box.
  function onRemove(id) {
    const panel = panels?.find((x) => x.id === id)
    if (!panel) return
    const name = blockName(panel, state.labels, names)
    actions.update((s, p) => removePanel(s, p, id), { label: 'delete' })
    if (!isKnownType(panel.type)) {
      const kind = typeLabel(panel.type, state.labels).toLowerCase()
      setNotice({ kind: 'info', text: `Removed ${panel.id}, a ${kind} this app does not support (undo with ⌘Z)`, undoable: true })
    } else {
      setNotice({ kind: 'info', text: `Removed ${name} (undo with ⌘Z)`, undoable: true })
    }
  }

  // Delete with several selected: all of them, one undo step.
  function onRemoveGroup() {
    const ids = group.map((p) => p.id)
    if (!ids.length) return
    const list = group.map((p) => blockName(p, state.labels, names))
    actions.update((s, p) => removePanels(s, p, ids), { group: true, label: 'delete several' })
    setNotice({ kind: 'info', text: `Removed ${list.length <= 3 ? joinAnd(list) : `${list.length} blocks`} (undo with ⌘Z)`, undoable: true })
  }

  // Undo and redo, from the keys or the top bar. A "Removed ... (undo with
  // ⌘Z)" notice goes once it has been acted on.
  const onUndo = () => {
    actions.undo()
    setNotice((n) => (n?.undoable ? null : n))
  }
  const onRedo = () => {
    actions.redo()
    setNotice((n) => (n?.undoable ? null : n))
  }
  // --- element styles, box v2, rules --------------------------------------------------
  const colorOk = (v) => v === null || v === undefined || !!normalizeColor(v, null)
  const badColor = () => setNotice({ kind: 'warn', text: 'Colours are hex: #rgb or #rrggbb.' })

  function onElementStyle(id, key, patch, field) {
    const clean = { ...patch }
    if ('color' in clean) {
      if (!colorOk(clean.color)) return badColor()
      if (clean.color != null) clean.color = normalizeColor(clean.color, null)
    }
    const opts = field ? { coalesce: `el:${part}:${id}:${key}:${field}`, windowMs: 1000 } : {}
    actions.update((s, p) => mapPanel(s, p, id, withElementStyle(key, clean)), { ...opts, label: 'element style' })
  }

  const onToggleElement = (id, key) => {
    const panel = panels?.find((x) => x.id === id)
    if (!panel) return
    const hidden = elementStyleOf(panel, key).hidden === true
    actions.update((s, p) => mapPanel(s, p, id, withElementStyle(key, { hidden: !hidden })), { label: 'element eye' })
  }

  const onResetElement = (id, key) => actions.update((s, p) => mapPanel(s, p, id, withoutElementStyle(key)), { label: 'reset element' })

  function onResetElements(id) {
    actions.update((s, p) => mapPanel(s, p, id, withoutElementStyles()), { label: 'reset element styles' })
    setNotice({ kind: 'info', text: 'Every element style of the block removed.' })
  }

  function onBoxProp(id, path, value, field, run) {
    let v = value
    if (field?.type === 'color') {
      if (!colorOk(v)) return badColor()
      if (v != null) v = normalizeColor(v, null)
    }
    const opts = run ? { coalesce: `box:${part}:${id}:${path.join('.')}`, windowMs: field?.type === 'text' ? 2000 : 1000 } : {}
    actions.update((s, p) => mapPanel(s, p, id, withPropPath(path, v, field)), { ...opts, label: 'box' })
  }

  // A rule, validated against the rule registry; null or an empty one: always.
  function onWhen(id, when, coalesce) {
    const clean = normalizeWhen(when)
    const opts = coalesce ? { coalesce, windowMs: 1000 } : {}
    actions.update((s, p) => mapPanel(s, p, id, withWhen(clean)), { ...opts, label: 'rule' })
  }

  // --- copy and paste style --------------------------------------------------------------
  function onCopyStyle() {
    if (!editable(selected)) return
    const label = `${blockName(selected, state.labels, names)}${part !== 'day' ? ` (${DAYPART_LABELS[part]})` : ''}`
    setStyleClip({ ...styleOf(selected), label, part })
    setNotice({ kind: 'info', text: `Copied ${label}'s style. Paste style (⌥⌘V) puts it on another block.` })
  }

  function onPasteStyle() {
    const targets = group.length > 1 ? group : editable(selected) ? [selected] : []
    // Never onto the panel it came from (the same id in the same day part).
    const ids = targets.map((p) => p.id).filter((id) => !(id === styleClip?.id && part === styleClip?.part))
    if (!styleClip || !ids.length) return
    actions.update((s, p) => mapPanels(s, p, ids, withStyle(styleClip)), { group: true, label: 'paste style' })
    const one = ids.length === 1 ? targets.find((t) => t.id === ids[0]) : null
    setNotice({
      kind: 'info',
      text: `Pasted ${styleClip.label}'s style onto ${one ? blockName(one, state.labels, names) : `${ids.length} blocks`}. Undo takes it back.`,
    })
  }

  // --- several panels -----------------------------------------------------------------------
  const groupIds = group.map((p) => p.id)
  const minPx = (type) => {
    const m = minPctFor(type, state.mins)
    return { w: Math.ceil((m.w * canvas.w) / 100), h: Math.ceil((m.h * canvas.h) / 100) }
  }
  const onGroupMove = useCallback(
    (start, dx, dy, opts) => actions.update((s, p) => movePanels(s, p, start, dx, dy, canvas), { ...opts, group: true, label: 'move several' }),
    [actions, canvas]
  )
  const onAlign = (kind) => actions.update((s, p) => alignPanels(s, p, groupIds, kind, canvas), { group: true, label: `align ${kind}` })
  const onDistribute = (axis) =>
    actions.update((s, p) => distributePanels(s, p, groupIds, axis, canvas), { group: true, label: `distribute ${axis}` })
  const onMatch = (dim) =>
    actions.update((s, p) => matchPanels(s, p, groupIds, groupIds[0], dim, canvas, minPx), { group: true, label: `match ${dim}` })

  function nudgeGroup(dx, dy) {
    const ids = groupIds
    actions.update(
      (s, p) => {
        const members = (partPanels(s, p) || []).filter((x) => ids.includes(x.id) && !x.locked && !x.hidden)
        if (!members.length) return s
        const start = Object.fromEntries(members.map((x) => [x.id, { pct: { x: x.x, y: x.y, w: x.w, h: x.h }, px: pctToPxRound(x, canvas) }]))
        const u = unionPx(Object.values(start).map((x) => x.px))
        const to = nudgeRect(u, dx, dy, canvas)
        return movePanels(s, p, start, to.x - u.x, to.y - u.y, canvas)
      },
      { coalesce: `nudge:${part}:${ids.join(',')}`, windowMs: 1000, group: true, label: 'nudge several' }
    )
  }

  // Shift-click: in or out of the selection, which never mixes in a type the
  // app does not know (that one is selected alone).
  const isUnknownId = (id) => {
    const p = panels?.find((x) => x.id === id)
    return !!p && !isKnownType(p.type)
  }
  const onToggleSelect = (id) =>
    isUnknownId(id) || state.selectedIds.some(isUnknownId) ? actions.select(id) : actions.toggleSelect(id)
  const onLayerSelect = (id, toggle) => (toggle ? onToggleSelect(id) : actions.select(id))
  const onLayerHover = useCallback((id, element) => setHover(id ? { id, element: element || null } : null), [])

  const onReorder = (frontFirstIds) => actions.update((s, p) => editPanels(s, p, (list) => restack(list, frontFirstIds)))
  const onBackdrop = (patch, field) => actions.backdrop(patch, field ? { coalesce: `backdrop:${field}`, windowMs: 1000 } : {})
  const onGlobal = (patch, field) =>
    actions.update((s, p) => editGlobal(s, p, patch), field ? { coalesce: `global:${part}:${field}`, windowMs: 1000 } : {})
  // Day: the layout's own global (font, colours, sizes); a variant: Day's.
  const onResetGlobal = () =>
    actions.update((s, p) =>
      p === 'day' ? { ...s, global: state.defaults ? { ...state.defaults.global } : { textScale: 1 } } : followDayGlobal(s, p)
    )
  const onFollowDay = () => actions.update((s, p) => followDayGlobal(s, p))
  const onEveningFrom = (hour) => actions.update((s) => setEveningFrom(s, hour))

  // A new block of one of the app's block types. where: 'front', in front of
  // everything, or 'behind': just behind the selection and over its area (the
  // card behind a group), or behind everything when nothing is selected.
  // Text and image are made as they always were (makeBlock: centred, their
  // own size); any other type as the app's newBlock makes it (a shape: its
  // starting box and props), else a bare box (makeBlock). Made here, not in
  // the recipe: the app's ids are random, and a recipe may run twice.
  function onAdd(type, where = 'front') {
    if (!panels || panels.length >= MAX_PANELS || !isBlockType(type)) return
    const taken = allIds(spec)
    const sel = group.length > 1 ? group : editable(selected) ? [selected] : []
    let behind = null
    let place = {}
    if (where === 'behind') {
      behind = backmost(panels, (sel.length ? sel : stagePanels).map((p) => p.id))
      place = { z: behind ? behind.z : 0 }
      if (sel.length) place.box = unionPct(sel)
    } else if (!hasOwnProps(type)) {
      place = { z: Math.min(999, panels.reduce((m, x) => Math.max(m, Number.isFinite(x.z) ? x.z : 0), 0) + 1) }
    }
    const overrides = { ...(place.box || {}), ...(place.z != null ? { z: place.z } : {}) }
    const fromApp = hasOwnProps(type) ? null : newBlock(type, overrides, taken)
    const made = fromApp || makeBlock(type, panels, newBlockId(type, taken), place)
    actions.update((s, p) => (behind ? insertBehind(s, p, made, behind.id) : addPanel(s, p, made)))
    actions.select(made.id)
    if (type === 'text') setFocusText({ id: made.id })
    const name = typeLabel(type, state.labels).toLowerCase()
    let text = `Added ${name} block ${made.id}.`
    if (where === 'behind') {
      text = sel.length
        ? `Added ${name} ${made.id} behind ${sel.map((p) => panelLabel(p, state.labels, names)).join(', ')}, over their area.`
        : `Added ${name} ${made.id} at the back.`
    } else if (!hasOwnProps(type)) {
      text = `Added ${name} ${made.id} in front.`
    }
    setNotice({ kind: 'info', text })
  }

  // The Add block menu: every type the app knows, grouped, with how many of
  // each this part has (catalog.js).
  const hasSelection = group.length > 1 || editable(selected)
  const counts = useMemo(() => {
    const c = {}
    for (const p of panels || []) c[p.type] = (c[p.type] || 0) + 1
    return c
  }, [panels])
  const catalog = useMemo(
    () => buildCatalog({ known: types.known, counts, labels: state.labels, hasSelection, resolve: appAsset }),
    [types, counts, state.labels, hasSelection]
  )

  const onAddType = (type, where) => (isBlockType(type) ? onAdd(type, where) : onAddPanel(type))

  // Where a further instance of a type goes: the first one's size, k grid
  // steps right and down of it (k: how many there are already), on the
  // canvas (a step left or up instead where there is no room).
  function besideBox(first, k) {
    const r = pctToPxRound(first, canvas)
    const step = prefs.gridSize * k
    const x = r.x + step + r.w <= canvas.w ? r.x + step : Math.max(0, r.x - step)
    const y = r.y + step + r.h <= canvas.h ? r.y + step : Math.max(0, r.y - step)
    return pxToPctKeeping(first, r, { x, y, w: r.w, h: r.h }, canvas)
  }

  // A functional type from Add block. The first on the part goes where the
  // layout's own default has it, with its default look, else where the type
  // starts (the app's newPanel); a further instance, id '<type>-<4 hex>',
  // comes in one grid step off the first. Either way in front, and selected.
  // Made here, not in the recipe: the id may be random.
  function onAddPanel(type) {
    if (!panels || panels.length >= MAX_PANELS || !isFunctionalType(type)) return
    const same = panels.filter((p) => p.type === type)
    const first = panels.find((p) => p.id === type) || same[0] || null
    // The bare id when the part has no block with it (the first instance).
    const bare = !panels.some((p) => p.id === type)
    const taken = allIds(spec)
    const place = first ? { box: besideBox(first, same.length), z: frontZ(panels) } : { z: frontZ(panels) }
    const got = newPanel(type, layoutId, { ...(place.box || {}), z: place.z }, taken, { bare })
    const made = got?.panel || makePanel(type, panels, state.mins, bare ? type : newBlockId(type, taken), place)
    // The bare id back while further instances are there: before them.
    const before = bare && same.length ? same[0].id : null
    actions.update((s, p) => (before ? insertBefore(s, p, made, before) : addPanel(s, p, made)), {
      label: `add block (id from ${got?.idFrom || 'editor'})`,
    })
    actions.select(made.id)
    const list = before ? panels.flatMap((x) => (x.id === before ? [made, x] : [x])) : [...panels, made]
    const name = instanceNames(list, state.labels).get(made.id)
    setNotice({ kind: 'info', text: first ? `Added ${name}, next to ${blockName(first, state.labels, names)}.` : `Added ${name}.` })
  }

  // Delete, Backspace: the selection off the layout (one undo step). With a
  // part of a block selected, that part hides (an element cannot leave its
  // block; its eye in the list shows it again).
  function deleteSelected() {
    if (group.length > 1) return onRemoveGroup()
    if (!selected) return
    const key = state.selectedElement
    if (key && isKnownType(selected.type)) {
      const label = elementLabel(selected.type, key, reportedLabels)
      const name = blockName(selected, state.labels, names)
      if (!elementList(selected.type).some((e) => e.key === key)) {
        setNotice({ kind: 'warn', text: `${label} cannot be hidden on its own. Esc selects ${name}; Delete then removes it.` })
        return
      }
      if (elementStyleOf(selected, key).hidden === true) return
      actions.update((s, p) => mapPanel(s, p, selected.id, withElementStyle(key, { hidden: true })), { label: 'hide element' })
      setNotice({ kind: 'info', text: `Hid ${label} in ${name} (undo with ⌘Z)`, undoable: true })
      return
    }
    onRemove(selected.id)
  }

  function nudge(dx, dy) {
    if (group.length > 1) return nudgeGroup(dx, dy)
    if (!editable(selected) || selected.locked || selected.hidden) return
    const id = selected.id
    actions.update(
      (s, p) =>
        mapPanel(s, p, id, (panel) => {
          const start = pctToPxRound(panel, canvas)
          return withBox(pxToPctKeeping(panel, start, nudgeRect(start, dx, dy, canvas), canvas))(panel)
        }),
      { coalesce: `nudge:${part}:${id}`, windowMs: 1000 }
    )
  }

  // --- day parts --------------------------------------------------------------------
  function onCreatePart() {
    if (part === 'day' || hasPart(spec, part)) return
    actions.update((s, p) => withVariant(s, p))
    setNotice({
      kind: 'info',
      text: `${DAYPART_LABELS[part]} is its own layout now, a copy of Day. The screen shows it ${partWhen(part, spec?.eveningFrom)}.`,
    })
  }

  function onRemovePart() {
    if (part === 'day' || !hasPart(spec, part)) return
    actions.update((s, p) => withoutVariant(s, p))
    setNotice({ kind: 'info', text: `Removed ${DAYPART_LABELS[part]}: the screen shows Day then. Undo brings it back.` })
  }

  // --- document -----------------------------------------------------------------------
  // The stored copy of a screen's layout as the hub has it now (for the
  // PATCH's removals), else what the last read said.
  async function freshStored(id, fallback) {
    try {
      const data = await fetchDevices()
      const list = Array.isArray(data?.devices) ? data.devices : []
      setDevices(list)
      const dev = list.find((d) => d.id === id)
      return dev ? storedLayout(dev, layoutId) : fallback
    } catch {
      return fallback
    }
  }

  async function save() {
    if (!state.draft || !ed.dirty || saving || !deviceId || !state.saved || !layoutId) return
    const submitted = state.draft
    setSaving(true)
    saveEpoch.current += 1
    try {
      const body = {}
      if (ed.specDirty) {
        if (ed.isDefault) {
          body.layouts = { [layoutId]: null }
        } else {
          const stored = await freshStored(deviceId, state.saved.raw)
          const spec2 = finalSpec({ ...submitted.spec, canvas: { w: canvas.w, h: canvas.h } }, layoutId)
          body.layouts = { [layoutId]: withRemovals(stored, spec2, { samePanel: (a, b) => samePanel(a, b, layoutId) }) }
        }
      }
      if (ed.backdropDirty) {
        const d = {}
        if (submitted.backdrop.entryBackdrop !== state.saved.backdrop.entryBackdrop) d.entryBackdrop = submitted.backdrop.entryBackdrop
        if (submitted.backdrop.entryDim !== state.saved.backdrop.entryDim) d.entryDim = submitted.backdrop.entryDim
        body.display = d
      }
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
        text: `${body.layouts && body.layouts[layoutId] === null ? 'Saved as the default layout' : 'Saved'} at ${clock()}. ${nameOf(
          device,
          deviceId
        )} picks it up within about 10 seconds.`,
      })
      loadHistory()
    } catch (e) {
      setNotice({ kind: 'error', text: `Save failed: ${e.message}` })
    } finally {
      saveEpoch.current += 1
      setSaving(false)
    }
  }

  // Another screen gets this screen's SAVED layout (not the draft).
  async function copyTo() {
    const target = devices?.find((d) => d.id === copyAsk?.targetId)
    if (!target || !state.saved || !layoutId || copying) return
    setCopying(true)
    try {
      const source = state.saved.spec
      let value = null
      if (source) {
        const stored = await freshStored(target.id, storedLayout(target, layoutId))
        value = withRemovals(stored, finalSpec(source, layoutId), { samePanel: (a, b) => samePanel(a, b, layoutId) })
      }
      await patchDeviceConfig(target.id, { layouts: { [layoutId]: value } })
      setToast({
        kind: 'ok',
        text: `Copied to ${nameOf(target, target.id)}: its ${meta.label} is now ${nameOf(device, deviceId)}'s${
          source ? '' : ' (the default)'
        }. It picks it up within about 10 seconds.`,
      })
      fetchDevices()
        .then((data) => setDevices(Array.isArray(data?.devices) ? data.devices : []))
        .catch(() => {})
    } catch (e) {
      setToast({ kind: 'error', text: `Copy to ${nameOf(target, target.id)} failed: ${e.message}` })
    } finally {
      setCopying(false)
      setCopyAsk(null)
    }
  }

  // History rows for this layout: the stored copy before each save, newest
  // first, one row per distinct copy in a row (a save of another layout
  // leaves this one's unchanged).
  const historyRows = useMemo(() => {
    if (!history || history.deviceId !== deviceId || !history.items) return null
    const rows = []
    let prev
    history.items.forEach((it, i) => {
      if (!isDict(it)) return
      const raw = isDict(it.layouts) && it.layouts[layoutId] != null ? it.layouts[layoutId] : null
      const key = JSON.stringify(raw)
      if (key === prev) return
      prev = key
      const t = Date.parse(it.at)
      const asSpec = raw ?? state.defaults
      rows.push({
        key: `${i}:${it.at}`,
        raw,
        when: ago(it.at),
        whenTitle: Number.isFinite(t) ? `Replaced ${new Date(t).toLocaleString()}` : '',
        detail: describe(raw),
        current: !!asSpec && !!effectiveSaved && sameLayout(asSpec, effectiveSaved, layoutId),
      })
    })
    return rows
  }, [history, deviceId, layoutId, state.defaults, effectiveSaved])

  function onLoadHistory(row) {
    if (row.raw == null && !state.defaults) return
    actions.load(row.raw)
    setNotice({
      kind: 'info',
      text: `Loaded ${row.raw == null ? 'the default layout' : 'the layout'} from before the save ${row.when} as a draft. Save puts it back; Undo drops it.`,
    })
  }

  function confirmDiscard() {
    return !ed.dirty || window.confirm('Discard the unsaved changes to this layout?')
  }

  function openDocument(id, layout) {
    actions.switchTo(id, layout)
    const dev = devices?.find((d) => d.id === id)
    if (dev) actions.hubLoaded(dev)
    setFrameKey((n) => n + 1)
    setRects(null)
    setHover(null)
    setNotice(null)
  }

  function onSwitch(id) {
    if (!id || id === deviceId || !confirmDiscard()) return
    openDocument(id, layoutId)
  }

  function onLayout(id) {
    if (!id || id === layoutId || !confirmDiscard()) return
    openDocument(deviceId, id)
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
    setNotice({ kind: 'info', text: `The built-in ${meta.label}. Save stores it as "use the default".` })
  }

  function onReload() {
    setFrameKey((n) => n + 1)
    setRects(null)
  }

  const onTextFocused = useCallback(() => setFocusText(null), [])
  const onStageHover = useCallback((id) => setHover(id ? { id, element: null } : null), [])

  // --- keyboard -------------------------------------------------------------------------
  function onKeyDown(e) {
    if (copyAsk) return // the dialog has the keys
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
    // Option-Command-C / V: copy and paste style (e.code: Option changes e.key).
    if (mod && e.altKey && (e.code === 'KeyC' || e.code === 'KeyV')) {
      e.preventDefault()
      if (e.code === 'KeyC') onCopyStyle()
      else onPasteStyle()
      return
    }
    if (mod && (key === 'z' || key === 'Z')) {
      e.preventDefault()
      if (e.shiftKey) onRedo()
      else onUndo()
      return
    }
    if (mod && (key === 'y' || key === 'Y')) {
      e.preventDefault()
      onRedo()
      return
    }
    if (mod || e.altKey) return
    if (key === 'Escape') {
      // Up one level: the part of a block, the block, nothing.
      if (state.selectedElement) {
        e.preventDefault()
        actions.selectElement(null)
      } else if (state.selectedIds.length) {
        e.preventDefault()
        actions.select(null)
      }
      return
    }
    if (!selected && group.length < 2) return
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
      return
    }
    if (key === 'Enter' && selected?.type === 'text') {
      e.preventDefault()
      setFocusText({ id: selected.id })
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

  const elName = selected && state.selectedElement ? elementPath.map((k) => elementLabel(selected.type, k, reportedLabels)).join(' › ') : null
  const selPx = selected ? pctToPxRound(selected, canvas) : null
  const partText = part !== 'day' ? `${DAYPART_LABELS[part]} · ` : ''
  const selectionText = selected
    ? `${partText}${selected.id}${elName ? ` › ${elName}` : ''}: ${selPx.x}, ${selPx.y}, ${selPx.w} x ${selPx.h} px`
    : group.length > 1
      ? `${partText}${group.length} blocks: ${groupIds.join(', ')}`
      : null
  const has = Object.fromEntries(VARIANT_PARTS.map((p) => [p, hasPart(spec, p)]))
  const copyTarget = copyAsk ? devices?.find((d) => d.id === copyAsk.targetId) : null

  return (
    <div className="ed-app">
      <TopBar
        screens={screens}
        deviceId={deviceId}
        onSwitch={onSwitch}
        layoutId={layoutId}
        onLayout={onLayout}
        history={historyRows ? { rows: historyRows, loading: history?.loading, error: history?.error } : history}
        onOpenHistory={loadHistory}
        onLoadHistory={onLoadHistory}
        copyTargets={copyTargets}
        onCopy={(id) => setCopyAsk({ targetId: id })}
        canvas={canvas}
        onPickCanvas={actions.pickCanvas}
        prefs={prefs}
        onPrefs={onPrefs}
        canUndo={ed.canUndo}
        canRedo={ed.canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
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
        arrange={
          group.length > 1 && !(spec && !panels)
            ? { count: group.length, first: blockName(group[0], state.labels, names), onAlign, onDistribute, onMatch }
            : null
        }
      />
      <Layers
        panels={panels}
        selectedIds={state.selectedIds}
        selectedId={state.selectedId}
        selectedElement={state.selectedElement}
        hoverId={hover?.id ?? null}
        labels={state.labels}
        names={names}
        disabled={!panels}
        readOnlyNote={
          spec && !panels
            ? `${DAYPART_LABELS[part]} shows the Day layout. Create ${DAYPART_LABELS[part]} from Day to change it.`
            : null
        }
        canAdd={!!panels && panels.length < MAX_PANELS}
        catalog={catalog}
        onSelect={onLayerSelect}
        onSelectElement={actions.selectPath}
        onHover={onLayerHover}
        onToggle={onToggle}
        onToggleElement={onToggleElement}
        onReorder={onReorder}
        onAdd={onAddType}
      />
      <main className="ed-main">
        {meta.variants && spec && !problem && (
          <Dayparts
            parts={state.dayparts}
            active={part}
            has={has}
            eveningFrom={spec.eveningFrom}
            onPick={actions.daypart}
            onCreate={onCreatePart}
            onRemove={onRemovePart}
          />
        )}
        <div className="ed-stagewrap">
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
              panels={stagePanels}
              readOnly={!!spec && !panels}
              rects={liveRects}
              ruleIds={liveRects?.rules ?? null}
              selectedId={state.selectedId}
              selectedIds={state.selectedIds}
              selectedElement={state.selectedElement}
              hoverId={hover?.id ?? null}
              labels={state.labels}
              names={names}
              mins={state.mins}
              appState={appState}
              elementName={(key) => (selected ? (key === state.selectedElement && elName) || elementLabel(selected.type, key, reportedLabels) : key)}
              onSelect={actions.select}
              onToggleSelect={onToggleSelect}
              onSelectElement={actions.selectElement}
              onHover={onStageHover}
              onGeometry={onGeometry}
              onGroupMove={onGroupMove}
              onAbandon={actions.abandon}
              onEditText={(id) => {
                actions.select(id)
                setFocusText({ id })
              }}
            />
          ) : (
            <div className="ed-problem">{deviceId ? 'Reading the screen from the hub…' : 'Loading the screens…'}</div>
          )}
          {toast && (
            <div className={`ed-toast is-${toast.kind}`} role="status">
              <span>{toast.text}</span>
              <button type="button" className="ed-icon" aria-label="Dismiss" onClick={() => setToast(null)}>
                ×
              </button>
            </div>
          )}
        </div>
      </main>
      <Inspector
        draft={state.draft}
        spec={spec}
        part={part}
        layoutId={layoutId || meta.id}
        hasVariant={hasVariant}
        panel={selected}
        group={group}
        canvas={canvas}
        labels={state.labels}
        names={names}
        mins={state.mins}
        art={art}
        onRefreshArt={loadArt}
        onBox={onBoxField}
        onProps={onProps}
        onPanel={onPanel}
        onRemove={onRemove}
        onRemoveGroup={onRemoveGroup}
        onResetKnobs={onResetKnobs}
        onBackdrop={onBackdrop}
        onGlobal={onGlobal}
        onResetGlobal={onResetGlobal}
        onFollowDay={onFollowDay}
        onEveningFrom={onEveningFrom}
        onCreatePart={onCreatePart}
        defaultGlobal={state.defaults?.global ?? null}
        focusTextFor={focusText?.id ?? null}
        onTextFocused={onTextFocused}
        selectedElement={state.selectedElement}
        elementPath={elementPath}
        onSelectElement={actions.selectElement}
        onSelect={actions.select}
        reportedLabels={reportedLabels}
        onFieldHover={setHover}
        onElementStyle={onElementStyle}
        onResetElement={onResetElement}
        onResetElements={onResetElements}
        onBoxProp={onBoxProp}
        onWhen={onWhen}
        styleClip={styleClip}
        onCopyStyle={onCopyStyle}
        onPasteStyle={onPasteStyle}
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
      {copyAsk && copyTarget && (
        <Dialog
          title={`Replace ${nameOf(copyTarget, copyTarget.id)}'s ${meta.label} with this layout?`}
          confirmLabel="Replace"
          danger
          busy={copying}
          onConfirm={copyTo}
          onCancel={() => !copying && setCopyAsk(null)}
        >
          <p>
            {nameOf(copyTarget, copyTarget.id)} gets the {meta.label} saved on {nameOf(device, deviceId)} (
            {state.saved?.spec ? describe(state.saved.spec).toLowerCase() : 'the default layout'}). What it has now stays in
            its history, so it can be put back from there.
          </p>
          {ed.specDirty && (
            <p className="ed-dialog__warn">
              This copies the layout as last saved, not your unsaved changes. Save first to include them.
            </p>
          )}
          {meta.backdrop && <p className="ed-note">The backdrop (photos, darkening) stays each screen's own.</p>}
        </Dialog>
      )}
    </div>
  )
}
