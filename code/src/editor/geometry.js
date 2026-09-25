// geometry.js - move and resize in whole canvas pixels. Pure, so the stage's
// pointer code stays small and these can be checked on their own.
//
// Boxes are { x, y, w, h } in canvas px. `start` is the box when the gesture
// began; dx, dy are the pointer's travel in canvas px since then.

import { clamp } from './spec.js'

const snapTo = (v, step) => (step ? Math.round(v / step) * step : v)

// Move. axisLock (Shift) keeps the axis the pointer travelled less; snap moves
// the top-left corner onto the grid. Never leaves the canvas.
export function moveRect(start, dx, dy, { snap = 0, axisLock = false, canvas }) {
  const lockY = axisLock && Math.abs(dx) >= Math.abs(dy)
  const lockX = axisLock && !lockY
  let x = lockX ? start.x : snapTo(start.x + dx, snap)
  let y = lockY ? start.y : snapTo(start.y + dy, snap)
  x = clamp(Math.round(x), 0, Math.max(0, canvas.w - start.w))
  y = clamp(Math.round(y), 0, Math.max(0, canvas.h - start.h))
  return { x, y, w: start.w, h: start.h }
}

// Resize from one of the eight handles: n, s, e, w, ne, nw, se, sw.
//   snap        moving edges land on the grid
//   keepAspect  (Shift) the start box's ratio; an edge handle grows the other
//               side away from the opposite corner (right, or down)
//   min         { w, h } canvas px, never smaller
export function resizeRect(start, handle, dx, dy, { snap = 0, keepAspect = false, min, canvas }) {
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
  if (W) l = snapTo(l + dx, snap)
  if (E) r = snapTo(r + dx, snap)
  if (N) t = snapTo(t + dy, snap)
  if (S) b = snapTo(b + dy, snap)

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
