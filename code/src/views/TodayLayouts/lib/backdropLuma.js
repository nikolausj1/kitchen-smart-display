// backdropLuma.js - how bright the Entry board's backdrop photo is behind the
// board's text, and how dark the wash over it should be for that photo
// (docs/designs/entry-board.md, phase 1.5 "Backdrop legibility").
//
// Pure: no React, no DOM, no clock, importable from Node (backdropLuma.test.mjs
// beside it). The browser half, which draws a photo into a tiny canvas, is
// lumaSampler.js; PhotoPanel hands its result to the Entry backdrop.
//
// The pipeline, per photo:
//
//   1. lumaSampler draws the part of the photo the screen shows (object-fit:
//      cover, centred: coverRect) into a LUMA_COLS-wide canvas with the
//      screen's aspect (48 x 27 at 16:9), and lumaGrid() turns its pixels into
//      WCAG relative luminance per cell (linear light, 0 black .. 1 white).
//   2. backdropLuma() averages that grid over the whole frame and over the two
//      text columns of the layout being drawn (textColumns: every visible
//      panel that carries text, split by its centre into left and right of the
//      middle; on the default board clock, headline and agenda on the left,
//      weather, what to wear, air quality and countdowns on the right). Each
//      cell counts by how much of it the panels' boxes cover, so the gaps
//      between boxes and the margins do not.
//   3. The luma behind the text is the brighter of the two columns: one wash
//      covers the whole screen, so it has to serve the harder side.
//   4. adaptiveDim(): the screen's own darkness (display.entryDim) moved by
//      GAIN per unit of luma away from L_AVG, clamped to DIM_LIGHTER below it
//      and DIM_DARKER above it (and to 0 .. DIM_MAX):
//
//        dim = clamp(entryDim + GAIN * (lumaText - L_AVG),
//                    entryDim - DIM_LIGHTER, entryDim + DIM_DARKER)
//
// The constants were measured on 2026-09-25 on 240 photos drawn at random
// (seeded) from the 1,861 in the Echo Show 15's albums on the hub, each
// sampled exactly as the app samples it (this module and lumaSampler.js, 48 x
// 27, cover, the default board's text columns):
//
//   L_AVG  0.284  the mean luma behind the text over that sample, so a photo of
//                 average brightness gets exactly the screen's own entryDim.
//                 Median 0.279, 10th / 90th percentile 0.176 / 0.385, range
//                 0.063 (a dark bar) to 0.577; snow reaches 0.64.
//   GAIN   0.8    the slope that holds the perceived backdrop steady around an
//                 average photo at the default 50% wash. The wash scales linear
//                 light by about (1 - dim)^2.2, so keeping luma * (1 - dim)^2.2
//                 constant needs d(dim)/d(luma) = (1 - dim) / (2.2 * luma), 0.80
//                 at dim 0.5 and luma 0.284. That curve flattens for bright
//                 photos and steepens for dark ones; the clamps take the
//                 extremes, so a snow photo lands at +0.25, a sky photo near
//                 +0.18 and a night photo near -0.16.
//
// Runtime rule (layoutSpec.js): this runs on the Echo's Silk, as old as
// Chrome 80. Plain ES2019.

// The luma grid's width in cells. The height follows the screen's aspect
// (gridRows): 27 at 16:9, 30 at 16:10.
export const LUMA_COLS = 48

export const L_AVG = 0.284
export const GAIN = 0.8
// How far a photo may move the wash from the screen's own darkness.
export const DIM_LIGHTER = 0.2
export const DIM_DARKER = 0.25
// The wash never goes past this, whatever the setting (EntryLayout's own cap):
// a photo is never blacked out.
export const DIM_MAX = 0.9
export const DIM_DEFAULT = 0.5

// Panel types that are pictures, not text: a photo tile, an image block.
const NOT_TEXT = ['photo', 'image']

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function round(v, places) {
  const f = Math.pow(10, places)
  return Math.round(v * f) / f + 0
}

// --- Luminance -------------------------------------------------------------------

// An 8-bit sRGB channel in linear light (the sRGB transfer function).
const LINEAR = (function table() {
  const t = new Float64Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return t
})()

export function srgbToLinear(c8) {
  const i = Math.round(clamp(finite(c8) ? c8 : 0, 0, 255))
  return LINEAR[i]
}

// WCAG 2 relative luminance of an 8-bit sRGB colour: 0 black .. 1 white.
export function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

// '#f2f2f0' -> its relative luminance, or null.
export function hexLuminance(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return null
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return relativeLuminance((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

// WCAG 2 contrast ratio between two relative luminances, 1 .. 21.
export function contrastRatio(la, lb) {
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// --- The grid ---------------------------------------------------------------------

// The grid's height for a box of w x h: the box's aspect, at least one row.
export function gridRows(cols, w, h) {
  const c = Math.max(1, Math.round(finite(cols) ? cols : LUMA_COLS))
  if (!(w > 0) || !(h > 0)) return Math.max(1, Math.round((c * 9) / 16))
  return clamp(Math.round((c * h) / w), 1, c * 4)
}

// The part of an image an object-fit: cover box of boxW x boxH shows (centred,
// object-position 50% 50%), as a source rectangle in image pixels.
export function coverRect(imgW, imgH, boxW, boxH) {
  if (!(imgW > 0) || !(imgH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 }
  if (!(boxW > 0) || !(boxH > 0)) return { sx: 0, sy: 0, sw: imgW, sh: imgH }
  const s = Math.max(boxW / imgW, boxH / imgH)
  const sw = Math.min(imgW, boxW / s)
  const sh = Math.min(imgH, boxH / s)
  return { sx: (imgW - sw) / 2, sy: (imgH - sh) / 2, sw, sh }
}

// RGBA bytes of a cols x rows image (a canvas's getImageData().data) -> the
// relative luminance of every cell, row by row. Alpha is ignored: the photos
// are opaque JPEGs.
export function lumaGrid(data, cols, rows) {
  const n = cols * rows
  const out = new Float32Array(n)
  if (!data || data.length < n * 4) return out
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = relativeLuminance(data[p], data[p + 1], data[p + 2])
  return out
}

// --- Regions ------------------------------------------------------------------------

function box(p) {
  return {
    x: finite(p.x) ? p.x : 0,
    y: finite(p.y) ? p.y : 0,
    w: finite(p.w) ? p.w : 0,
    h: finite(p.h) ? p.h : 0,
  }
}

// The layout's two text columns, as lists of percent boxes: every visible panel
// that carries text (not a photo tile, not an image block), on the left when
// its centre is left of the middle of the canvas, else on the right. `panels`
// are a layout spec's panels (layoutSpec.js: x, y, w, h in percent).
export function textColumns(panels) {
  const left = []
  const right = []
  const list = Array.isArray(panels) ? panels : []
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p || p.hidden || NOT_TEXT.indexOf(p.type) >= 0) continue
    const b = box(p)
    if (!(b.w > 0) || !(b.h > 0)) continue
    if (b.x + b.w / 2 < 50) left.push(b)
    else right.push(b)
  }
  return { left, right }
}

// The mean of a luma grid over a set of percent boxes, each cell weighted by
// the share of it the boxes cover (overlapping boxes count a cell once, at
// most whole). null when the boxes cover no cell.
export function regionLuma(grid, cols, rows, boxes) {
  if (!grid || !(cols > 0) || !(rows > 0) || !Array.isArray(boxes) || !boxes.length) return null
  const cover = new Float32Array(cols * rows)
  const cw = 100 / cols
  const ch = 100 / rows
  for (let k = 0; k < boxes.length; k++) {
    const b = boxes[k]
    const x0 = clamp(b.x, 0, 100)
    const y0 = clamp(b.y, 0, 100)
    const x1 = clamp(b.x + b.w, 0, 100)
    const y1 = clamp(b.y + b.h, 0, 100)
    if (x1 <= x0 || y1 <= y0) continue
    const c0 = Math.floor(x0 / cw)
    const c1 = Math.min(cols - 1, Math.ceil(x1 / cw) - 1)
    const r0 = Math.floor(y0 / ch)
    const r1 = Math.min(rows - 1, Math.ceil(y1 / ch) - 1)
    for (let r = r0; r <= r1; r++) {
      const oy = Math.min(y1, (r + 1) * ch) - Math.max(y0, r * ch)
      if (oy <= 0) continue
      for (let c = c0; c <= c1; c++) {
        const ox = Math.min(x1, (c + 1) * cw) - Math.max(x0, c * cw)
        if (ox > 0) cover[r * cols + c] += (ox * oy) / (cw * ch)
      }
    }
  }
  let sum = 0
  let weight = 0
  for (let i = 0; i < cover.length; i++) {
    const w = Math.min(1, cover[i])
    if (w > 0) {
      sum += grid[i] * w
      weight += w
    }
  }
  return weight > 0 ? sum / weight : null
}

// The mean of the whole grid, or null for an empty one.
export function wholeLuma(grid) {
  if (!grid || !grid.length) return null
  let sum = 0
  for (let i = 0; i < grid.length; i++) sum += grid[i]
  return sum / grid.length
}

// backdropLuma(sample, panels) -> { whole, left, right, text } in relative
// luminance (4 decimals), or null without a sample. sample is lumaSampler's
// { grid, cols, rows }; panels the layout's visible panels. text is the
// brighter column (the one the wash has to serve), or the whole frame when the
// layout has no text panel at all.
export function backdropLuma(sample, panels) {
  if (!sample || !sample.grid || !(sample.cols > 0) || !(sample.rows > 0)) return null
  const { grid, cols, rows } = sample
  const whole = wholeLuma(grid)
  if (whole == null) return null
  const columns = textColumns(panels)
  const left = regionLuma(grid, cols, rows, columns.left)
  const right = regionLuma(grid, cols, rows, columns.right)
  let text = whole
  if (left != null && right != null) text = Math.max(left, right)
  else if (left != null) text = left
  else if (right != null) text = right
  const r4 = (v) => (v == null ? null : round(v, 4))
  return { whole: r4(whole), left: r4(left), right: r4(right), text: r4(text) }
}

// --- The wash -----------------------------------------------------------------------

// The screen's own darkness as the Entry board uses it: 0 .. DIM_MAX, the
// default for anything that is not a number.
export function baseDim(v) {
  return clamp(finite(v) ? v : DIM_DEFAULT, 0, DIM_MAX)
}

// The wash for a photo whose text columns average lumaText: the screen's own
// darkness moved by GAIN per unit of luma away from L_AVG, never more than
// DIM_LIGHTER lighter or DIM_DARKER darker than it, and inside 0 .. DIM_MAX.
// A lumaText that is not a number (no sample yet, a failed one) gives the
// screen's own darkness unchanged. 3 decimals.
export function adaptiveDim(base, lumaText) {
  const b = baseDim(base)
  if (!finite(lumaText)) return b
  const lo = Math.max(0, b - DIM_LIGHTER)
  const hi = Math.min(DIM_MAX, b + DIM_DARKER)
  return round(clamp(b + GAIN * (lumaText - L_AVG), lo, hi), 3)
}
