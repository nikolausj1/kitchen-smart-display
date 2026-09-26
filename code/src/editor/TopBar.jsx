// TopBar - document controls on the first row (screen, layout, history,
// copy to another screen, undo and redo, revert, reset, save), view controls
// on the second (canvas size, zoom, grid, sample data, reload), and, while two
// or more panels are selected, the arrange tools there too (align, distribute,
// match width and height). StatusLine is the strip along the bottom.

import { useState } from 'react'
import { NumberField, Segmented, Toggle } from './fields.jsx'
import { AlignIcon, RedoIcon, UndoIcon } from './icons.jsx'
import { kindLabel } from './hub.js'
import { Menu, MenuItem, MenuNote } from './menus.jsx'
import { LAYOUTS } from './spec.js'
import { CANVAS_PRESETS } from './useEditorState.js'

const ZOOMS = [
  ['fit', 'Fit', 'Fit the canvas to the window'],
  [0.5, '50%', 'Half size'],
  [1, '100%', 'Actual size'],
]
const GRID_SIZES = [10, 20, 40]

const screenName = (d) => (d.name && d.name !== d.id ? `${d.name} (${d.id})` : d.id)

export default function TopBar({
  screens,
  deviceId,
  onSwitch,
  layoutId,
  onLayout,
  history,
  onOpenHistory,
  onLoadHistory,
  copyTargets,
  onCopy,
  canvas,
  onPickCanvas,
  prefs,
  onPrefs,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canRevert,
  onRevert,
  canReset,
  onReset,
  onReload,
  onSave,
  dirty,
  saving,
  canSave,
  hasDraft,
  arrange,
}) {
  const known = screens.some((d) => d.id === deviceId)
  return (
    <header className="ed-top">
      <div className="ed-top__row">
        <span className="ed-brand">Layout editor</span>
        <label className="ed-field">
          <span>Screen</span>
          <select value={deviceId || ''} onChange={(e) => onSwitch(e.target.value)} aria-label="Screen">
            {!known && <option value={deviceId || ''}>{deviceId ? `${deviceId} (not on the hub)` : 'Choose a screen'}</option>}
            {screens.map((d) => (
              <option key={d.id} value={d.id}>
                {screenName(d)}
                {d.kind ? ` · ${kindLabel(d.kind)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <span>Layout</span>
          <select value={layoutId || ''} onChange={(e) => onLayout(e.target.value)} disabled={!layoutId} aria-label="Layout">
            {!layoutId && <option value="">…</option>}
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <span className="ed-spacer" />

        <div className="ed-group">
          <Menu
            label="History"
            title="This screen's layout before each of its last ten saves"
            disabled={!hasDraft}
            align="end"
            onOpen={onOpenHistory}
          >
            {(close) => <HistoryItems history={history} close={close} onLoad={onLoadHistory} />}
          </Menu>
          <Menu label="Copy layout to…" title="Put this screen's saved layout on another screen" disabled={!canSave} align="end">
            {(close) =>
              copyTargets.length ? (
                <>
                  <MenuNote>The saved layout, onto:</MenuNote>
                  {copyTargets.map((d) => (
                    <MenuItem key={d.id} close={close} onSelect={() => onCopy(d.id)}>
                      {screenName(d)}
                    </MenuItem>
                  ))}
                </>
              ) : (
                <MenuNote>No other web screens on the hub.</MenuNote>
              )
            }
          </Menu>
        </div>

        <div className="ed-group">
          <button type="button" className="ed-btn ed-btn--icon" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
            <UndoIcon />
          </button>
          <button type="button" className="ed-btn ed-btn--icon" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
            <RedoIcon />
          </button>
        </div>
        <div className="ed-group">
          <button type="button" className="ed-btn" onClick={onRevert} disabled={!canRevert} title="Back to what the screen has saved">
            Revert to saved
          </button>
          <button type="button" className="ed-btn" onClick={onReset} disabled={!canReset} title="The built-in board; Save stores it as the default">
            Reset to default
          </button>
        </div>
        <div className="ed-group ed-save">
          <span className={`ed-save__state${dirty ? ' is-dirty' : ''}`} aria-live="polite">
            {saving ? 'Saving…' : !hasDraft ? '' : dirty ? 'Unsaved changes' : 'Saved'}
          </span>
          <button type="button" className="ed-btn ed-btn--primary" onClick={onSave} disabled={!dirty || saving || !canSave} title="Save to the screen (⌘S)">
            Save
          </button>
        </div>
      </div>

      <div className="ed-top__row ed-top__row--view">
        <CanvasSize canvas={canvas} onPick={onPickCanvas} />
        <label className="ed-field">
          <span>Zoom</span>
          <Segmented ariaLabel="Zoom" options={ZOOMS} value={prefs.zoom} onChange={(v) => onPrefs({ zoom: v })} />
        </label>
        <div className="ed-field">
          <Toggle label="Grid" checked={prefs.grid} onChange={(on) => onPrefs({ grid: on })} title="Show the grid and snap to it" />
          <select
            value={prefs.gridSize}
            onChange={(e) => onPrefs({ gridSize: Number(e.target.value) })}
            aria-label="Grid spacing"
            title="Grid spacing, canvas pixels"
          >
            {GRID_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </div>
        <Toggle
          label="Sample data"
          checked={prefs.sample}
          onChange={(on) => onPrefs({ sample: on })}
          title="Fill empty panels with made-up data so there is something to lay out"
        />
        {arrange && <Arrange {...arrange} />}
        <span className="ed-spacer" />
        <button type="button" className="ed-btn" onClick={onReload} title="Reload the app in the preview">
          Reload preview
        </button>
      </div>
    </header>
  )
}

// Two or more panels selected: align them to their bounds, spread them out
// with equal gaps (three or more), or give them the first one's width or
// height. Each is one undo step; locked panels stay put.
const ALIGNS = [
  ['left', 'Align left edges'],
  ['centre', 'Align centres (horizontally)'],
  ['right', 'Align right edges'],
  ['top', 'Align top edges'],
  ['middle', 'Align middles (vertically)'],
  ['bottom', 'Align bottom edges'],
]
function Arrange({ count, first, onAlign, onDistribute, onMatch }) {
  const tool = (kind, title, onClick, disabled) => (
    <button key={kind} type="button" className="ed-btn ed-btn--icon ed-btn--tool" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      <AlignIcon kind={kind} />
    </button>
  )
  return (
    <div className="ed-arrange" role="toolbar" aria-label="Arrange the selected panels">
      <span className="ed-arrange__count">{count} selected</span>
      <span className="ed-arrange__group">{ALIGNS.slice(0, 3).map(([k, t]) => tool(k, t, () => onAlign(k)))}</span>
      <span className="ed-arrange__group">{ALIGNS.slice(3).map(([k, t]) => tool(k, t, () => onAlign(k)))}</span>
      <span className="ed-arrange__group">
        {tool('distributeX', count < 3 ? 'Distribute horizontally (three or more)' : 'Distribute horizontally: equal gaps', () => onDistribute('x'), count < 3)}
        {tool('distributeY', count < 3 ? 'Distribute vertically (three or more)' : 'Distribute vertically: equal gaps', () => onDistribute('y'), count < 3)}
      </span>
      <span className="ed-arrange__group">
        {tool('matchW', `Match width: ${first}'s`, () => onMatch('w'))}
        {tool('matchH', `Match height: ${first}'s`, () => onMatch('h'))}
      </span>
    </div>
  )
}

// history: { loading, error, rows: [{ key, when, whenTitle, detail, current }] }
function HistoryItems({ history, close, onLoad }) {
  if (!history || (history.loading && !history.rows)) return <MenuNote>Loading…</MenuNote>
  if (history.error && !history.rows) return <MenuNote>Could not read the history: {history.error}</MenuNote>
  if (!history.rows.length) return <MenuNote>No saves yet. Each save keeps the layout it replaced here.</MenuNote>
  return (
    <>
      <MenuNote>The layout as it was before each save. Choosing one loads it as a draft; Save puts it back.</MenuNote>
      {history.rows.map((r) => (
        <MenuItem key={r.key} close={close} title={r.whenTitle} onSelect={() => onLoad(r)}>
          <span className="ed-hist__when">{r.when}</span>
          <span className="ed-hist__what">
            {r.detail}
            {r.current ? ' · as saved now' : ''}
          </span>
        </MenuItem>
      ))}
    </>
  )
}

function CanvasSize({ canvas, onPick }) {
  const [custom, setCustom] = useState(false)
  if (canvas.source === 'screen' || canvas.source === 'saved') {
    return (
      <span className="ed-field ed-canvas-size" title={canvas.source === 'screen' ? 'Reported by the screen itself' : 'What the saved layout was drawn on'}>
        <span>Canvas</span>
        <strong>
          {canvas.w} x {canvas.h}
        </strong>
        <em>{canvas.source === 'screen' ? 'from the screen' : 'from the saved layout'}</em>
      </span>
    )
  }
  const preset = CANVAS_PRESETS.find((p) => p.w === canvas.w && p.h === canvas.h)
  const showCustom = custom || !preset
  return (
    <span className="ed-field ed-canvas-size" title="The screen has not reported its size yet">
      <span>Canvas</span>
      <select
        aria-label="Canvas size"
        value={showCustom ? 'custom' : `${canvas.w}x${canvas.h}`}
        onChange={(e) => {
          if (e.target.value === 'custom') return setCustom(true)
          setCustom(false)
          const [w, h] = e.target.value.split('x').map(Number)
          onPick(w, h)
        }}
      >
        {CANVAS_PRESETS.map((p) => (
          <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
            {p.w} x {p.h}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {showCustom && (
        <>
          <NumberField ariaLabel="Canvas width" value={canvas.w} min={320} max={8192} onCommit={(w) => onPick(w, canvas.h)} />
          <span className="ed-x">x</span>
          <NumberField ariaLabel="Canvas height" value={canvas.h} min={240} max={8192} onCommit={(h) => onPick(canvas.w, h)} />
        </>
      )}
    </span>
  )
}

export function StatusLine({ hub, hubSource, frame, appState, appCanvas, canvas, notice, selection }) {
  const appText =
    appState === 'ready'
      ? `App ready${appCanvas && (appCanvas.w !== canvas.w || appCanvas.h !== canvas.h) ? ` (it sees ${appCanvas.w} x ${appCanvas.h})` : ''}`
      : appState === 'gave-up'
        ? 'The app did not answer: is edit mode in the build it serves? Reload preview to try again.'
        : 'Waiting for the app…'
  return (
    <footer className="ed-status" role="status">
      <span className={`ed-dot ed-dot--${appState}`} aria-hidden="true" />
      <span className="ed-status__item">{appText}</span>
      <span className="ed-status__item ed-status__muted" title={frame.src}>
        Hub {hub.replace(/^https?:\/\//, '')}
        {hubSource === 'param' ? ' (?hub=)' : hubSource === 'config' ? ' (default)' : ''}
        {frame.overridden ? ' · app from ?app=' : ''}
      </span>
      {selection && <span className="ed-status__item ed-status__muted">{selection}</span>}
      <span className="ed-spacer" />
      {notice && <span className={`ed-status__item ed-status__notice is-${notice.kind}`}>{notice.text}</span>}
    </footer>
  )
}
