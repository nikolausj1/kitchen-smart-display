// Stage - the real app in an iframe at the screen's resolution, scaled to
// the window, with a transparent overlay on top that takes every pointer
// event (the app never sees a click).
//
// The overlay draws in stage pixels (canvas px x k): an outline per panel
// while the pointer is over the stage, the selection with eight handles, its
// label and an x, y, w, h readout in canvas px, and the grid. Boxes come from
// the draft while it is moving and from the app's own sd-edit:rects once it
// has been still for a moment, so at rest the handles sit on the real pixels.
//
// Gestures: press selects (the frontmost panel under the pointer); a drag
// past 3 px moves; a handle resizes (Shift keeps the aspect, Shift on a move
// keeps one axis); the grid snaps unless Option is held; Esc mid-drag puts
// it back. One drag is one undo step (coalesce key per gesture).

import { useEffect, useMemo, useRef, useState } from 'react'
import { HANDLES, HANDLE_AT, HANDLE_CURSOR, moveRect, resizeRect } from './geometry.js'
import { TYPE_LABELS, frontToBack, minPctFor, pctToPx, pctToPxRound, pxToPctKeeping } from './spec.js'

const FIT_PAD = 24 // stage px around the canvas
const DRAG_THRESHOLD = 3 // screen px before a press becomes a drag
const SETTLE_MS = 400 // draft unchanged this long: trust the app's rects
const HANDLE = 8

export default function Stage({
  frame,
  frameKey,
  iframeRef,
  onFrameLoad,
  canvas,
  zoom,
  grid,
  gridSize,
  spec,
  rects,
  selectedId,
  hoverId,
  labels,
  mins,
  appState,
  onSelect,
  onHover,
  onGeometry,
  onAbandon,
  onEditText,
}) {
  const scrollRef = useRef(null)
  const overlayRef = useRef(null)
  const gesture = useRef(null)
  const gestureSeq = useRef(0)
  const [viewport, setViewport] = useState(null)
  const [dragging, setDragging] = useState(null) // { id, kind }
  const [pointerIn, setPointerIn] = useState(false)
  const [settledSpec, setSettledSpec] = useState(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setViewport((v) => (v && v.w === r.width && v.h === r.height ? v : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const k =
    zoom === 'fit'
      ? viewport
        ? Math.max(0.05, Math.min((viewport.w - 2 * FIT_PAD) / canvas.w, (viewport.h - 2 * FIT_PAD) / canvas.h))
        : 0.25
      : Number(zoom) || 1

  useEffect(() => {
    const t = setTimeout(() => setSettledSpec(spec), SETTLE_MS)
    return () => clearTimeout(t)
  }, [spec])
  const settled = !!spec && settledSpec === spec && !dragging

  // Every panel, front to back, with its box in canvas px.
  const items = useMemo(() => {
    if (!spec) return []
    const sx = rects?.canvas?.w ? canvas.w / rects.canvas.w : 1
    const sy = rects?.canvas?.h ? canvas.h / rects.canvas.h : 1
    return frontToBack(spec.panels).map((p) => {
      const r = settled && !p.hidden ? rects?.byId?.[p.id] : null
      const box = r ? { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy } : pctToPx(p, canvas)
      return { p, box }
    })
  }, [spec, rects, settled, canvas])

  function hitTest(pt) {
    for (const it of items) {
      if (it.p.hidden) continue
      const b = it.box
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return it.p
    }
    return null
  }

  function canvasPoint(e) {
    const r = overlayRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }
  }

  function minPx(type) {
    const m = minPctFor(type, mins)
    return { w: Math.ceil((m.w * canvas.w) / 100), h: Math.ceil((m.h * canvas.h) / 100) }
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !spec) return
    const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') : null
    const selected = spec.panels.find((p) => p.id === selectedId)
    let target
    let kind = 'move'
    if (handle && selected) {
      target = selected
      kind = handle
    } else {
      target = hitTest(canvasPoint(e))
      onSelect(target ? target.id : null)
      if (!target) return
    }
    overlayRef.current.focus({ preventScroll: true })
    if (target.locked || target.hidden) return
    e.preventDefault()
    overlayRef.current.setPointerCapture(e.pointerId)
    gestureSeq.current += 1
    gesture.current = {
      id: target.id,
      type: target.type,
      kind,
      startPct: { x: target.x, y: target.y, w: target.w, h: target.h },
      start: pctToPxRound(target, canvas),
      sx: e.clientX,
      sy: e.clientY,
      key: `gesture:${gestureSeq.current}`,
      moved: false,
      pointerId: e.pointerId,
    }
    setDragging({ id: target.id, kind })
  }

  function onPointerMove(e) {
    const g = gesture.current
    if (!g) {
      if (!spec) return
      const hit = hitTest(canvasPoint(e))
      const id = hit ? hit.id : null
      if (id !== hoverId) onHover(id)
      return
    }
    const dxs = e.clientX - g.sx
    const dys = e.clientY - g.sy
    if (!g.moved) {
      if (Math.abs(dxs) < DRAG_THRESHOLD && Math.abs(dys) < DRAG_THRESHOLD) return
      g.moved = true
    }
    const snap = grid && !e.altKey ? gridSize : 0
    const rect =
      g.kind === 'move'
        ? moveRect(g.start, dxs / k, dys / k, { snap, axisLock: e.shiftKey, canvas })
        : resizeRect(g.start, g.kind, dxs / k, dys / k, { snap, keepAspect: e.shiftKey, min: minPx(g.type), canvas })
    onGeometry(g.id, pxToPctKeeping(g.startPct, g.start, rect, canvas), { coalesce: g.key, windowMs: Infinity })
  }

  function endGesture() {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    try {
      overlayRef.current?.releasePointerCapture(g.pointerId)
    } catch {
      // capture already gone
    }
    setDragging(null)
  }

  // Esc during a drag: undo just that drag, and keep the Esc from also
  // clearing the selection.
  useEffect(() => {
    if (!dragging) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      const g = gesture.current
      gesture.current = null
      if (g) onAbandon(g.key)
      setDragging(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging, onAbandon])

  function onDoubleClick(e) {
    if (!spec) return
    const hit = hitTest(canvasPoint(e))
    if (hit && hit.type === 'text') onEditText(hit.id)
  }

  const sel = items.find((it) => it.p.id === selectedId) || null
  const hovered = items.find((it) => it.p.id === hoverId) || null
  const showAll = pointerIn || !!dragging
  const cursor = dragging
    ? dragging.kind === 'move'
      ? 'move'
      : HANDLE_CURSOR[dragging.kind]
    : hovered && !hovered.p.locked && pointerIn
      ? 'move'
      : 'default'

  let gridStep = gridSize * k
  while (gridStep < 6) gridStep *= 2

  const stagePx = (b) => ({ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k })

  return (
    <div className="ed-stage" ref={scrollRef}>
      <div className="ed-stage__pad" style={{ padding: FIT_PAD }}>
        <div className="ed-canvas" style={{ width: canvas.w * k, height: canvas.h * k }}>
          <iframe
            key={frameKey}
            ref={iframeRef}
            className="ed-frame"
            src={frame.src}
            title="Preview of the screen"
            tabIndex={-1}
            onLoad={onFrameLoad}
            style={{ width: canvas.w, height: canvas.h, transform: `scale(${k})` }}
          />
          {grid && <div className="ed-gridlines" style={{ backgroundSize: `${gridStep}px ${gridStep}px` }} aria-hidden="true" />}
          <div
            ref={overlayRef}
            className="ed-overlay"
            tabIndex={0}
            aria-label="Layout canvas: click a panel to select it, drag to move"
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            onPointerEnter={() => setPointerIn(true)}
            onPointerLeave={() => {
              setPointerIn(false)
              if (!gesture.current && hoverId) onHover(null)
            }}
            onDoubleClick={onDoubleClick}
          >
            {items.map(({ p, box }) => {
              if (p.hidden || p.id === selectedId) return null
              const isHover = p.id === hoverId
              const emptyImage = p.type === 'image' && !p.props.src
              if (!showAll && !isHover && !emptyImage) return null
              return (
                <div
                  key={p.id}
                  className={`ed-outline${isHover ? ' is-hover' : ''}${emptyImage ? ' is-empty' : ''}`}
                  style={stagePx(box)}
                >
                  {emptyImage && <span>No image</span>}
                </div>
              )
            })}
            {sel && (
              <Selection
                item={sel}
                k={k}
                canvas={canvas}
                label={selectionLabel(sel.p, labels)}
                handles={!sel.p.locked && !sel.p.hidden}
                box={stagePx(sel.box)}
              />
            )}
          </div>
          {appState !== 'ready' && (
            <div className="ed-stage__wait" role="status">
              {appState === 'gave-up' ? 'The app did not answer. Reload preview to try again.' : 'Waiting for the app…'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function selectionLabel(p, labels) {
  const type = labels?.[p.type] || TYPE_LABELS[p.type] || p.type
  const parts = [p.type === 'text' || p.type === 'image' ? `${type} · ${p.id}` : type]
  if (p.locked) parts.push('locked')
  if (p.hidden) parts.push('hidden')
  return parts.join(' · ')
}

function Selection({ item, k, canvas, label, handles, box }) {
  const px = pctToPxRound(item.p, canvas)
  // Below the box, unless that would fall off the bottom of the canvas.
  const readoutInside = box.top + box.height + 24 > canvas.h * k
  return (
    <div
      className={`ed-sel${item.p.locked ? ' is-locked' : ''}${item.p.hidden ? ' is-hidden' : ''}`}
      style={box}
    >
      <div className={`ed-sel__label${box.top < 22 ? ' is-inside' : ''}`}>{label}</div>
      {item.p.type === 'image' && !item.p.props.src && <span className="ed-sel__empty">No image</span>}
      {handles &&
        HANDLES.map((h) => (
          <div
            key={h}
            className="ed-handle"
            data-handle={h}
            style={{
              left: HANDLE_AT[h][0] * box.width - HANDLE / 2,
              top: HANDLE_AT[h][1] * box.height - HANDLE / 2,
              cursor: HANDLE_CURSOR[h],
            }}
          />
        ))}
      <div className={`ed-sel__readout${readoutInside ? ' is-inside' : ''}`}>
        X {px.x}  Y {px.y}  W {px.w}  H {px.h}
      </div>
    </div>
  )
}
