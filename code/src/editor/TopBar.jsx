// TopBar - document controls on the first row (screen, layout, undo and
// redo, revert, reset, save), view controls on the second (canvas size, zoom,
// grid, sample data, reload). StatusLine is the strip along the bottom.

import { useState } from 'react'
import { NumberField, Segmented, Toggle } from './fields.jsx'
import { RedoIcon, UndoIcon } from './icons.jsx'
import { kindLabel } from './hub.js'
import { CANVAS_PRESETS } from './useEditorState.js'

const ZOOMS = [
  ['fit', 'Fit', 'Fit the canvas to the window'],
  [0.5, '50%', 'Half size'],
  [1, '100%', 'Actual size'],
]
const GRID_SIZES = [10, 20, 40]

export default function TopBar({
  screens,
  deviceId,
  onSwitch,
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
                {d.name && d.name !== d.id ? `${d.name} (${d.id})` : d.id}
                {d.kind ? ` · ${kindLabel(d.kind)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="ed-field">
          <span>Layout</span>
          <select value="entry" disabled aria-label="Layout">
            <option value="entry">Entry board</option>
          </select>
        </label>

        <span className="ed-spacer" />

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
        <span className="ed-spacer" />
        <button type="button" className="ed-btn" onClick={onReload} title="Reload the app in the preview">
          Reload preview
        </button>
      </div>
    </header>
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
