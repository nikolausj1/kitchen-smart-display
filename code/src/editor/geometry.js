// geometry.js - move and resize in whole canvas pixels, with snapping to the
// grid and to smart guides. Pure, so the stage's pointer code stays small and
// these can be checked on their own.
//
// Boxes are { x, y, w, h } in canvas px. `start` is the box when the gesture
// began; dx, dy are the pointer's travel in canvas px since then.
//
// Smart guides (docs/designs/layout-editor.md, "The controls"): the dragged
// box's edges and centre line snap to the other visible panels' edges and
// centres, and to the canvas's, within GUIDE_SNAP canvas px; a guide wins
// over the grid, the grid applies when no guide is that close. guideLines
// then says which alignments the box ended up on, each with the gap to the
// nearest panel aligned there, for the stage to draw.

import { clamp } from './util.js'

export const GUIDE_SNAP = 6 // canvas px

const snapTo = (v, step) => (step ? Math.round(v / step) * step : v)

// Every line a box can snap to: the other panels' start, centre and end on
// each axis, and the canvas's. box is null for the canvas.
//   boxes  [{ x, y, w, h }] canvas px (the panels not being dragged)
//   ->     { x: [{ v, box }], y: [{ v, box }] }
export function guideTargets(boxes, canvas) {
  const x = [
    { v: 0, box: null },
    { v: canvas.w / 2, box: null },
    { v: canvas.w, box: null },
  ]
  const y = [
    { v: 0, box: null },
    { v: canvas.h / 2, box: null },
    { v: canvas.h, box: null },
  ]
  for (const b of boxes) {
    x.push({ v: b.x, box: b }, { v: b.x + b.w / 2, box: b }, { v: b.x + b.w, box: b })
    y.push({ v: b.y, box: b }, { v: b.y + b.h / 2, box: b }, { v: b.y + b.h, box: b })
  }
  return { x, y }
}

// The shift (target - line) that puts the closest of `lines` on the closest
// target, when that is within the threshold; else null.
function nearest(lines, targets, threshold) {
  let best = null
  for (const t of targets) {
    for (const l of lines) {
      const d = t.v - l
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d
    }
  }
  return best
}

// One axis of a move: a guide first (the box's start, centre or end line),
// else the grid (the start line).
function snapSpan(pos, size, targets, grid, threshold) {
  if (targets) {
    const d = nearest([pos, pos + size / 2, pos + size], targets, threshold)
    if (d !== null) return pos + d
  }
  return snapTo(pos, grid)
}

// One moving edge of a resize: a guide first, else the grid.
function snapEdge(pos, targets, grid, threshold) {
  if (targets) {
    const d = nearest([pos], targets, threshold)
    if (d !== null) return pos + d
  }
  return snapTo(pos, grid)
}

// Move. axisLock (Shift) keeps the axis the pointer travelled less; snap is
// the grid step (0: none); guides (guideTargets) pull an edge or the centre
// onto another panel's. Never leaves the canvas.
export function moveRect(start, dx, dy, { snap = 0, axisLock = false, canvas, guides = null, threshold = GUIDE_SNAP }) {
  const lockY = axisLock && Math.abs(dx) >= Math.abs(dy)
  const lockX = axisLock && !lockY
  let x = lockX ? start.x : snapSpan(start.x + dx, start.w, guides?.x, snap, threshold)
  let y = lockY ? start.y : snapSpan(start.y + dy, start.h, guides?.y, snap, threshold)
  x = clamp(Math.round(x), 0, Math.max(0, canvas.w - start.w))
  y = clamp(Math.round(y), 0, Math.max(0, canvas.h - start.h))
  return { x, y, w: start.w, h: start.h }
}

// Resize from one of the eight handles: n, s, e, w, ne, nw, se, sw.
//   snap        moving edges land on the grid (or a guide, which wins)
//   keepAspect  (Shift) the start box's ratio; an edge handle grows the other
//               side away from the opposite corner (right, or down)
//   min         { w, h } canvas px, never smaller
export function resizeRect(start, handle, dx, dy, { snap = 0, keepAspect = false, min, canvas, guides = null, threshold = GUIDE_SNAP }) {
  const W = handle.includes('w')
  const E = handle.includes('e')
  const N = handle.includes('n')
  const S = handle.includes('s')
  const minW = Math.min(canvas.w, Math.max(1, min?.w ?? 1))
  const minH = Math.min(canvas.h, Math.max(1, min?.h ?? 1))

  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h
  if (W) l = snapEdge(l + dx, guides?.x, snap, threshold)
  if (E) r = snapEdge(r + dx, guides?.x, snap, threshold)
  if (N) t = snapEdge(t + dy, guides?.y, snap, threshold)
  if (S) b = snapEdge(b + dy, guides?.y, snap, threshold)

  if (!keepAspect || start.w <= 0 || start.h <= 0) {
    l = Math.max(0, l)
    t = Math.max(0, t)
    r = Math.min(canvas.w, r)
    b = Math.min(canvas.h, b)
    if (r - l < minW) {
      if (W) l = r - minW
      else r = l + minW
    }
    if (b - t < minH) {
      if (N) t = b - minH
      else b = t + minH
    }
    // A minimum pushed off the canvas edge: slide back in.
    if (l < 0) { r -= l; l = 0 }
    if (t < 0) { b -= t; t = 0 }
    if (r > canvas.w) { l -= r - canvas.w; r = canvas.w }
    if (b > canvas.h) { t -= b - canvas.h; b = canvas.h }
    return finish(l, t, r - l, b - t)
  }

  // Aspect locked: size from the dominant axis, anchored at the corner
  // opposite the handle.
  const ratio = start.w / start.h
  let w = r - l
  let h = b - t
  const corner = (W || E) && (N || S)
  if (corner) {
    if (Math.abs(w / start.w - 1) >= Math.abs(h / start.h - 1)) h = w / ratio
    else w = h * ratio
  } else if (W || E) {
    h = w / ratio
  } else {
    w = h * ratio
  }
  const ax = W ? start.x + start.w : start.x // anchor
  const ay = N ? start.y + start.h : start.y
  const availW = W ? ax : canvas.w - ax
  const availH = N ? ay : canvas.h - ay
  const shrink = Math.min(1, availW / Math.max(w, 1e-6), availH / Math.max(h, 1e-6))
  w *= shrink
  h *= shrink
  const grow = Math.max(1, minW / Math.max(w, 1e-6), minH / Math.max(h, 1e-6))
  w = Math.min(availW, w * grow)
  h = Math.min(availH, h * grow)
  l = W ? ax - w : ax
  t = N ? ay - h : ay
  return finish(l, t, w, h)
}

function finish(l, t, w, h) {
  const x = Math.round(l)
  const y = Math.round(t)
  return { x, y, w: Math.max(1, Math.round(l + w) - x), h: Math.max(1, Math.round(t + h) - y) }
}

// Arrow-key nudge by (dx, dy) canvas px, inside the canvas.
export function nudgeRect(start, dx, dy, canvas) {
  return {
    x: clamp(start.x + dx, 0, Math.max(0, canvas.w - start.w)),
    y: clamp(start.y + dy, 0, Math.max(0, canvas.h - start.h)),
    w: start.w,
    h: start.h,
  }
}

// Which of the box's lines a gesture moves, so only those show guides: a
// move moves all of them, a handle only its edges.
export function guideLinesFor(kind) {
  if (kind === 'move') return { x: ['start', 'centre', 'end'], y: ['start', 'centre', 'end'] }
  return {
    x: [kind.includes('w') && 'start', kind.includes('e') && 'end'].filter(Boolean),
    y: [kind.includes('n') && 'start', kind.includes('s') && 'end'].filter(Boolean),
  }
}

// Along a vertical guide (axis 'x') the gap that matters is vertical: to the
// nearest aligned panel above or below that does not overlap the box. Along
// a horizontal guide, horizontal. -> { from, to, px } canvas px, or null.
function gapAlong(rect, boxes, axis) {
  let best = null
  for (const b of boxes) {
    let from
    let to
    if (axis === 'x') {
      if (b.y + b.h <= rect.y) [from, to] = [b.y + b.h, rect.y]
      else if (b.y >= rect.y + rect.h) [from, to] = [rect.y + rect.h, b.y]
      else continue
    } else if (b.x + b.w <= rect.x) [from, to] = [b.x + b.w, rect.x]
    else if (b.x >= rect.x + rect.w) [from, to] = [rect.x + rect.w, b.x]
    else continue
    if (!best || to - from < best.to - best.from) best = { from, to }
  }
  return best ? { ...best, px: Math.round(best.to - best.from) } : null
}

// The guides a box sits on, and one distance per axis.
//   lines  one per target line that one of the box's (moving) lines is on,
//          within half a pixel (the box is in whole pixels, the panels'
//          edges need not be): { axis: 'x' | 'y', v }. axis 'x' is a
//          vertical line at x = v, 'y' a horizontal one at y = v.
//   gaps   per axis at most one: the gap to the nearest panel aligned with
//          the box on that axis, drawn along the line it was measured on
//          (the one closest to the box's centre when several tie):
//          { axis, v, from, to, px }
export function guideLines(rect, targets, which = guideLinesFor('move')) {
  const at = {
    x: { start: rect.x, centre: rect.x + rect.w / 2, end: rect.x + rect.w },
    y: { start: rect.y, centre: rect.y + rect.h / 2, end: rect.y + rect.h },
  }
  const lines = []
  const gaps = []
  for (const axis of ['x', 'y']) {
    const found = new Map()
    for (const k of which[axis] || []) {
      const l = at[axis][k]
      for (const t of targets[axis]) {
        if (Math.abs(t.v - l) > 0.51) continue
        const key = Math.round(t.v * 2) / 2
        let e = found.get(key)
        if (!e) {
          e = { v: t.v, boxes: [] }
          found.set(key, e)
        }
        if (t.box && !e.boxes.includes(t.box)) e.boxes.push(t.box)
      }
    }
    let best = null
    for (const e of found.values()) {
      lines.push({ axis, v: e.v })
      const g = gapAlong(rect, e.boxes, axis)
      if (!g) continue
      const off = Math.abs(e.v - at[axis].centre)
      if (!best || g.px < best.px || (g.px === best.px && off < best.off)) best = { axis, v: e.v, ...g, off }
    }
    if (best) gaps.push({ axis, v: best.v, from: best.from, to: best.to, px: best.px })
  }
  return { lines, gaps }
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const HANDLE_CURSOR = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

// Where each handle sits on a box, as fractions of its width and height.
export const HANDLE_AT = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
}
