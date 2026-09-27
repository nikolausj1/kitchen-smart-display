// Stage - the real app in an iframe at the screen's resolution, scaled to
// the window, with a transparent overlay on top that takes every pointer
// event (the app never sees a click).
//
// The overlay draws in stage pixels (canvas px x k): an outline per panel
// while the pointer is over the stage, the selection with eight handles, its
// label and an x, y, w, h readout in canvas px, the grid, the smart guides
// while dragging, and the selected panel's sub-elements. Boxes come from the
// draft while it is moving and from the app's own sd-edit:rects once it has
// been still for a moment, so at rest the handles sit on the real pixels.
//
// Gestures: press selects (the frontmost panel under the pointer); a click
// inside the panel that is already selected selects the sub-element under
// the pointer (the smallest, then the topmost), or the panel again where
// there is none; a drag past 3 px moves the panel, wherever it started; a
// handle resizes (Shift keeps the aspect, Shift on a move keeps one axis);
// the grid and the smart guides snap unless Option is held; Esc mid-drag puts
// it back. One drag is one undo step (coalesce key per gesture).
//
// Several panels: Shift-press adds the panel under the pointer to the
// selection or takes it out (no drag from that press). With several selected,
// dragging any of them moves them all, their bounds snapping as one box
// (locked ones stay); a click on one without a drag selects just that one.
//
// A panel the app marks as carrying a visibility rule (data-rule, reported
// in `ruleIds`) gets a small badge in its top right corner.
//
// readOnly: a day part with no layout of its own shows the Day layout, which
// is not edited from there.
//
// `panels` holds only the types the app knows (Editor.jsx): one it does not
// know is drawn by nobody, so it has no box to click, drag or snap to.

import { useEffect, useMemo, useRef, useState } from 'react'
import { unionPx } from './edits.js'
import { HANDLES, HANDLE_AT, HANDLE_CURSOR, guideLines, guideLinesFor, guideTargets, moveRect, resizeRect } from './geometry.js'
import { RuleIcon } from './icons.jsx'
import { isBlockType } from './schema.js'
import { frontToBack, minPctFor, pctToPx, pctToPxRound, pxToPctKeeping, typeLabel, whenSummary } from './spec.js'

const FIT_PAD = 24 // stage px around the canvas
const DRAG_THRESHOLD = 3 // screen px before a press becomes a drag
const SETTLE_MS = 400 // draft unchanged this long: trust the app's rects
const HANDLE = 8

const inside = (pt, b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h

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
  panels,
  readOnly,
  rects,
  ruleIds,
  selectedId,
  selectedIds,
  selectedElement,
  hoverId,
  labels,
  mins,
  appState,
  elementName,
  onSelect,
  onToggleSelect,
  onSelectElement,
  onHover,
  onGeometry,
  onGroupMove,
  onAbandon,
  onEditText,
}) {
  const scrollRef = useRef(null)
  const overlayRef = useRef(null)
  const gesture = useRef(null)
  const gestureSeq = useRef(0)
  const [viewport, setViewport] = useState(null)
  const [dragging, setDragging] = useState(null) // { id, kind }
  const [guides, setGuides] = useState(null) // { lines, gaps } while dragging
  const [pointerIn, setPointerIn] = useState(false)
  const [hoverEl, setHoverEl] = useState(null) // sub-element key under the pointer
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

  // iframe px -> canvas px (the same unless the app sees another size).
  const sx = rects?.canvas?.w ? canvas.w / rects.canvas.w : 1
  const sy = rects?.canvas?.h ? canvas.h / rects.canvas.h : 1

  // Every panel of the part on show, front to back, with its box in canvas px.
  const items = useMemo(() => {
    if (!panels) return []
    return frontToBack(panels).map((p) => {
      const r = settled && !p.hidden ? rects?.byId?.[p.id] : null
      const box = r ? { x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy } : pctToPx(p, canvas)
      return { p, box }
    })
  }, [panels, rects, settled, canvas, sx, sy])

  // The selected panel's sub-elements, canvas px. Only once settled: while a
  // drag or an edit is in flight the app has not drawn them there yet.
  const elements = useMemo(() => {
    if (!settled || !selectedId) return []
    const list = rects?.elements?.[selectedId] || []
    return list.map((el) => ({ key: el.key, label: el.label, box: { x: el.x * sx, y: el.y * sy, w: el.w * sx, h: el.h * sy } }))
  }, [settled, selectedId, rects, sx, sy])

  function hitTest(pt) {
    for (const it of items) {
      if (!it.p.hidden && inside(pt, it.box)) return it.p
    }
    return null
  }

  // The smallest sub-element under the point; a tie goes to the later one
  // (drawn on top).
  function elementAt(pt) {
    let best = null
    for (const el of elements) {
      if (!inside(pt, el.box)) continue
      const area = el.box.w * el.box.h
      if (!best || area <= best.area) best = { el, area }
    }
    return best ? best.el : null
  }

  function canvasPoint(e) {
    const r = overlayRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }
  }

  function minPx(type) {
    const m = minPctFor(type, mins)
    return { w: Math.ceil((m.w * canvas.w) / 100), h: Math.ceil((m.h * canvas.h) / 100) }
  }

  const multi = selectedIds.length > 1

  // A press on one of several selected panels: a drag moves them all, a
  // click selects that one alone.
  function startGroup(e, target) {
    overlayRef.current.focus({ preventScroll: true })
    e.preventDefault()
    overlayRef.current.setPointerCapture(e.pointerId)
    gestureSeq.current += 1
    const members = panels.filter((p) => selectedIds.includes(p.id) && !p.locked && !p.hidden)
    const start = Object.fromEntries(
      members.map((p) => [p.id, { pct: { x: p.x, y: p.y, w: p.w, h: p.h }, px: pctToPxRound(p, canvas) }])
    )
    const others = panels.filter((p) => !p.hidden && !selectedIds.includes(p.id)).map((p) => pctToPx(p, canvas))
    gesture.current = {
      group: true,
      id: target.id,
      kind: 'move',
      start,
      union: unionPx(Object.values(start).map((x) => x.px)),
      sx: e.clientX,
      sy: e.clientY,
      key: `gesture:${gestureSeq.current}`,
      moved: false,
      pointerId: e.pointerId,
      clickSingle: target.id,
      targets: guideTargets(others, canvas),
    }
    setDragging({ id: target.id, kind: 'move', group: true })
  }

  function onPointerDown(e) {
    if (e.button !== 0 || !panels || readOnly) return
    const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') : null
    const selected = multi ? null : panels.find((p) => p.id === selectedId)
    const pt = canvasPoint(e)
    if (e.shiftKey && !handle) {
      // In or out of the selection; nothing moves from this press.
      const hit = hitTest(pt)
      if (hit) onToggleSelect(hit.id)
      overlayRef.current.focus({ preventScroll: true })
      return
    }
    let target
    let kind = 'move'
    // A press inside the panel already selected may pick a sub-element (on
    // release, if it did not become a drag). undefined: it cannot.
    let clickEl
    if (handle && selected) {
      target = selected
      kind = handle
    } else {
      target = hitTest(pt)
      if (multi && target && selectedIds.includes(target.id)) return startGroup(e, target)
      if (target && target.id === selectedId) clickEl = elementAt(pt)?.key ?? null
      else onSelect(target ? target.id : null)
      if (!target) return
    }
    overlayRef.current.focus({ preventScroll: true })
    if (target.locked || target.hidden) {
      if (clickEl !== undefined) onSelectElement(clickEl)
      return
    }
    e.preventDefault()
    overlayRef.current.setPointerCapture(e.pointerId)
    gestureSeq.current += 1
    const others = panels.filter((p) => !p.hidden && p.id !== target.id).map((p) => pctToPx(p, canvas))
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
      clickEl,
      targets: guideTargets(others, canvas),
    }
    setDragging({ id: target.id, kind })
  }

  function onPointerMove(e) {
    const g = gesture.current
    if (!g) {
      if (!panels || readOnly) return
      const pt = canvasPoint(e)
      const hit = hitTest(pt)
      const id = hit ? hit.id : null
      if (id !== hoverId) onHover(id)
      const el = hit && hit.id === selectedId ? (elementAt(pt)?.key ?? null) : null
      if (el !== hoverEl) setHoverEl(el)
      return
    }
    const dxs = e.clientX - g.sx
    const dys = e.clientY - g.sy
    if (!g.moved) {
      if (Math.abs(dxs) < DRAG_THRESHOLD && Math.abs(dys) < DRAG_THRESHOLD) return
      g.moved = true
      setHoverEl(null)
    }
    // Option: no grid, no guides.
    const free = e.altKey
    const snap = grid && !free ? gridSize : 0
    const targets = free ? null : g.targets
    if (g.group) {
      // The selection's bounds snap as one box; every member follows.
      if (!g.union) return
      const box = moveRect(g.union, dxs / k, dys / k, { snap, axisLock: e.shiftKey, canvas, guides: targets })
      setGuides(targets ? guideLines(box, targets, guideLinesFor('move')) : null)
      onGroupMove(g.start, box.x - g.union.x, box.y - g.union.y, { coalesce: g.key, windowMs: Infinity })
      return
    }
    const rect =
      g.kind === 'move'
        ? moveRect(g.start, dxs / k, dys / k, { snap, axisLock: e.shiftKey, canvas, guides: targets })
        : resizeRect(g.start, g.kind, dxs / k, dys / k, { snap, keepAspect: e.shiftKey, min: minPx(g.type), canvas, guides: targets })
    setGuides(targets ? guideLines(rect, targets, guideLinesFor(g.kind)) : null)
    onGeometry(g.id, pxToPctKeeping(g.startPct, g.start, rect, canvas), { coalesce: g.key, windowMs: Infinity })
  }

  function endGesture(e) {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    try {
      overlayRef.current?.releasePointerCapture(g.pointerId)
    } catch {
      // capture already gone
    }
    setDragging(null)
    setGuides(null)
    if (e?.type !== 'pointerup' || g.moved) return
    if (g.group) onSelect(g.clickSingle)
    else if (g.clickEl !== undefined) onSelectElement(g.clickEl)
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
      setGuides(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging, onAbandon])

  function onDoubleClick(e) {
    if (!panels || readOnly) return
    const hit = hitTest(canvasPoint(e))
    if (hit && hit.type === 'text') onEditText(hit.id)
  }

  const sel = items.find((it) => it.p.id === selectedId) || null
  const group = multi ? items.filter((it) => selectedIds.includes(it.p.id)) : []
  const groupBox = group.length ? unionPx(group.map((it) => it.box)) : null
  const hovered = items.find((it) => it.p.id === hoverId) || null
  const showAll = (pointerIn || !!dragging) && !readOnly
  const cursor = readOnly
    ? 'default'
    : dragging
      ? dragging.kind === 'move'
        ? 'move'
        : HANDLE_CURSOR[dragging.kind]
      : hovered && !hovered.p.locked && pointerIn
        ? 'move'
        : 'default'

  let gridStep = gridSize * k
  while (gridStep < 6) gridStep *= 2

  const stagePx = (b) => ({ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k })
  // A key can mark several elements (every countdown tile, every agenda
  // row): the knobs are the same for all, so all of them are outlined.
  const selEls = selectedElement ? elements.filter((el) => el.key === selectedElement) : []
  const hovEls = hoverEl && hoverEl !== selectedElement && pointerIn && !dragging ? elements.filter((el) => el.key === hoverEl) : []

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
          {grid && !readOnly && (
            <div className="ed-gridlines" style={{ backgroundSize: `${gridStep}px ${gridStep}px` }} aria-hidden="true" />
          )}
          <div
            ref={overlayRef}
            className={`ed-overlay${readOnly ? ' is-readonly' : ''}`}
            tabIndex={0}
            aria-label="Layout canvas: click a panel to select it, click it again for a part of it, drag to move"
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={endGesture}
            onPointerEnter={() => setPointerIn(true)}
            onPointerLeave={() => {
              setPointerIn(false)
              setHoverEl(null)
              if (!gesture.current && hoverId) onHover(null)
            }}
            onDoubleClick={onDoubleClick}
          >
            {items.map(({ p, box }) => {
              if (p.hidden || p.id === selectedId || selectedIds.includes(p.id) || readOnly) return null
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
            {ruleIds &&
              items.map(({ p, box }) =>
                !p.hidden && ruleIds.has(p.id) ? (
                  <div
                    key={`r-${p.id}`}
                    className="ed-rulebadge"
                    style={{ left: (box.x + box.w) * k, top: box.y * k }}
                    title={whenSummary(p.when) || 'Shows only when its rule holds'}
                  >
                    <RuleIcon size={11} />
                  </div>
                ) : null
              )}
            {guides && <Guides guides={guides} k={k} canvas={canvas} />}
            {hovEls.map((el, i) => (
              <div key={`h${i}`} className="ed-el is-hover" style={stagePx(el.box)} />
            ))}
            {sel && (
              <Selection
                item={sel}
                k={k}
                canvas={canvas}
                label={
                  dragging
                    ? null
                    : `${selectionLabel(sel.p, labels)}${selEls.length ? ` › ${elementName?.(selectedElement) || selectedElement}` : ''}`
                }
                handles={!sel.p.locked && !sel.p.hidden}
                box={stagePx(sel.box)}
                dim={selEls.length > 0}
              />
            )}
            {selEls.map((el, i) => (
              <div key={`s${i}`} className="ed-el is-selected" style={stagePx(el.box)} />
            ))}
            {group.map((it) => (
              <div
                key={`m-${it.p.id}`}
                className={`ed-sel ed-sel--member${it.p.locked ? ' is-locked' : ''}${it.p.hidden ? ' is-hidden' : ''}${it.p.id === selectedIds[0] ? ' is-first' : ''}`}
                style={stagePx(it.box)}
              />
            ))}
            {groupBox && (
              <GroupBox box={stagePx(groupBox)} px={groupBox} count={group.length} dragging={!!dragging} canvas={canvas} k={k} />
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

// The bounds of several selected panels, with their count and size.
function GroupBox({ box, px, count, dragging, canvas, k }) {
  const readoutInside = box.top + box.height + 24 > canvas.h * k
  const r = { x: Math.round(px.x), y: Math.round(px.y), w: Math.round(px.w), h: Math.round(px.h) }
  return (
    <div className="ed-sel ed-sel--group" style={box}>
      {!dragging && <div className={`ed-sel__label${box.top < 22 ? ' is-inside' : ''}`}>{count} panels</div>}
      <div className={`ed-sel__readout${readoutInside ? ' is-inside' : ''}`}>
        X {r.x}  Y {r.y}  W {r.w}  H {r.h}
      </div>
    </div>
  )
}

function selectionLabel(p, labels) {
  const type = typeLabel(p.type, labels)
  const parts = [isBlockType(p.type) ? `${type} · ${p.id}` : type]
  if (p.locked) parts.push('locked')
  if (p.hidden) parts.push('hidden')
  return parts.join(' · ')
}

// The smart guides: every alignment as a line across the stage, and per axis
// the gap to the nearest aligned panel as a measured segment with its px.
function Guides({ guides, k, canvas }) {
  return (
    <div className="ed-guides" aria-hidden="true">
      {guides.lines.map((l) =>
        l.axis === 'x' ? (
          <div key={`x${l.v}`} className="ed-guide ed-guide--v" style={{ left: l.v * k, height: canvas.h * k }} />
        ) : (
          <div key={`y${l.v}`} className="ed-guide ed-guide--h" style={{ top: l.v * k, width: canvas.w * k }} />
        )
      )}
      {guides.gaps.map((g) =>
        g.axis === 'x' ? (
          <div key={`gx${g.v}`} className="ed-gap ed-gap--v" style={{ left: g.v * k, top: g.from * k, height: (g.to - g.from) * k }}>
            <span>{g.px}</span>
          </div>
        ) : (
          <div key={`gy${g.v}`} className="ed-gap ed-gap--h" style={{ top: g.v * k, left: g.from * k, width: (g.to - g.from) * k }}>
            <span>{g.px}</span>
          </div>
        )
      )}
    </div>
  )
}

// label: null while dragging, so the guides' distances have the room.
function Selection({ item, k, canvas, label, handles, box, dim }) {
  const px = pctToPxRound(item.p, canvas)
  // Below the box, unless that would fall off the bottom of the canvas.
  const readoutInside = box.top + box.height + 24 > canvas.h * k
  return (
    <div
      className={`ed-sel${item.p.locked ? ' is-locked' : ''}${item.p.hidden ? ' is-hidden' : ''}${dim ? ' is-parent' : ''}`}
      style={box}
    >
      {label && <div className={`ed-sel__label${box.top < 22 ? ' is-inside' : ''}`}>{label}</div>}
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
