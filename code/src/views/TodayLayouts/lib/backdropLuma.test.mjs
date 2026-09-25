// Tests for backdropLuma.js, the pure half of the Entry board's adaptive
// darkness. Run from code/: node --test src/views/TodayLayouts/lib/backdropLuma.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIM_DARKER,
  DIM_LIGHTER,
  DIM_MAX,
  GAIN,
  L_AVG,
  LUMA_COLS,
  adaptiveDim,
  backdropLuma,
  baseDim,
  contrastRatio,
  coverRect,
  gridRows,
  hexLuminance,
  lumaGrid,
  regionLuma,
  relativeLuminance,
  srgbToLinear,
  textColumns,
  wholeLuma,
} from './backdropLuma.js'
import { DEFAULT_ENTRY_SPEC, visiblePanels } from '../layoutSpec.js'

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`)

// A grid whose every cell has the same luma.
const flat = (v, cols = LUMA_COLS, rows = 27) => new Float32Array(cols * rows).fill(v)

// A grid bright (1) on the left half and black (0) on the right.
function halves(cols = LUMA_COLS, rows = 27) {
  const g = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols / 2; c++) g[r * cols + c] = 1
  return g
}

test('relative luminance follows WCAG 2', () => {
  assert.equal(relativeLuminance(0, 0, 0), 0)
  near(relativeLuminance(255, 255, 255), 1)
  near(relativeLuminance(128, 128, 128), 0.2158)
  near(srgbToLinear(10), 10 / 255 / 12.92)
  near(hexLuminance('#f2f2f0'), 0.8867)
  near(hexLuminance('#fff'), 1)
  assert.equal(hexLuminance('not a colour'), null)
})

test('contrast ratio is WCAG 2 and symmetric', () => {
  near(contrastRatio(1, 0), 21)
  near(contrastRatio(0, 1), 21)
  near(contrastRatio(0.5, 0.5), 1)
  near(contrastRatio(hexLuminance('#f2f2f0'), 0.2158), 3.5242)
})

test('gridRows follows the aspect', () => {
  assert.equal(gridRows(48, 1920, 1080), 27)
  assert.equal(gridRows(48, 1280, 800), 30)
  assert.equal(gridRows(48, 960, 480), 24)
  assert.equal(gridRows(48, 0, 0), 27)
  assert.equal(gridRows(48, 10, 10000), 192)
})

test('coverRect is object-fit: cover, centred', () => {
  // 4:3 into 16:9: full width, the middle 75% of the height.
  assert.deepEqual(coverRect(1440, 1080, 1920, 1080), { sx: 0, sy: 135, sw: 1440, sh: 810 })
  // A portrait into 16:9: a band across the middle.
  const p = coverRect(1080, 1440, 1920, 1080)
  near(p.sw, 1080)
  near(p.sh, 607.5)
  near(p.sy, (1440 - 607.5) / 2)
  // Wider than the box: the middle of the width.
  assert.deepEqual(coverRect(2000, 500, 1000, 500), { sx: 500, sy: 0, sw: 1000, sh: 500 })
  // Same aspect: all of it.
  assert.deepEqual(coverRect(3840, 2160, 1920, 1080), { sx: 0, sy: 0, sw: 3840, sh: 2160 })
})

test('lumaGrid turns RGBA bytes into luma per cell', () => {
  const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 0, 255, 0, 10])
  const g = lumaGrid(data, 2, 2)
  near(g[0], 1)
  assert.equal(g[1], 0)
  near(g[2], 0.2158)
  near(g[3], 0.7152) // alpha ignored
  // Short data: a black grid, not a throw.
  assert.deepEqual(Array.from(lumaGrid(new Uint8ClampedArray(4), 2, 2)), [0, 0, 0, 0])
})

test('textColumns splits the default board by box centre', () => {
  const cols = textColumns(visiblePanels(DEFAULT_ENTRY_SPEC))
  assert.equal(cols.left.length, 3) // clock, headline, agenda
  assert.equal(cols.right.length, 4) // weather, wear, air quality, countdowns
  const ids = (list) => list.map((b) => `${b.x},${b.y}`)
  assert.ok(ids(cols.left).includes('2.4,3')) // the clock
  assert.ok(ids(cols.right).includes('58.08,3')) // the weather
})

test('textColumns leaves out pictures and hidden panels', () => {
  const cols = textColumns([
    { type: 'photo', x: 0, y: 0, w: 40, h: 40 },
    { type: 'image', x: 60, y: 0, w: 40, h: 40 },
    { type: 'clock', x: 0, y: 50, w: 40, h: 40, hidden: true },
    { type: 'text', x: 60, y: 50, w: 30, h: 10 },
    { type: 'headline', x: 0, y: 0, w: 0, h: 10 },
    null,
  ])
  assert.equal(cols.left.length, 0)
  assert.deepEqual(cols.right, [{ x: 60, y: 50, w: 30, h: 10 }])
  assert.deepEqual(textColumns(undefined), { left: [], right: [] })
})

test('regionLuma weights cells by how much the boxes cover', () => {
  const g = halves()
  near(regionLuma(g, LUMA_COLS, 27, [{ x: 0, y: 0, w: 50, h: 100 }]), 1)
  near(regionLuma(g, LUMA_COLS, 27, [{ x: 50, y: 0, w: 50, h: 100 }]), 0)
  near(regionLuma(g, LUMA_COLS, 27, [{ x: 25, y: 10, w: 50, h: 50 }]), 0.5)
  // A box straddling the middle by a sliver of a cell: area weighted.
  near(regionLuma(g, LUMA_COLS, 27, [{ x: 40, y: 0, w: 20, h: 100 }]), 0.5, 1e-3)
  // Overlapping boxes count a cell once.
  near(regionLuma(g, LUMA_COLS, 27, [{ x: 0, y: 0, w: 50, h: 100 }, { x: 0, y: 0, w: 50, h: 100 }, { x: 50, y: 0, w: 50, h: 100 }]), 0.5)
  // Off the canvas or empty: no region.
  assert.equal(regionLuma(g, LUMA_COLS, 27, [{ x: 100, y: 0, w: 10, h: 10 }]), null)
  assert.equal(regionLuma(g, LUMA_COLS, 27, []), null)
})

test('backdropLuma: the text luma is the brighter column', () => {
  const panels = visiblePanels(DEFAULT_ENTRY_SPEC)
  const l = backdropLuma({ grid: halves(), cols: LUMA_COLS, rows: 27 }, panels)
  near(l.whole, 0.5)
  // The left column runs from 2.4% to 56.98%: the part of it left of the
  // middle is bright.
  near(l.left, (50 - 2.4) / 54.58, 2e-3)
  assert.equal(l.right, 0)
  assert.equal(l.text, l.left)
  const f = backdropLuma({ grid: flat(0.3), cols: LUMA_COLS, rows: 27 }, panels)
  near(f.text, 0.3)
  near(f.whole, 0.3)
})

test('backdropLuma falls back to the whole frame, or to null', () => {
  const l = backdropLuma({ grid: halves(), cols: LUMA_COLS, rows: 27 }, [])
  assert.equal(l.left, null)
  assert.equal(l.right, null)
  near(l.text, 0.5)
  assert.equal(backdropLuma(null, []), null)
  assert.equal(backdropLuma({ grid: null, cols: 48, rows: 27 }, []), null)
  assert.equal(wholeLuma(new Float32Array(0)), null)
})

test('adaptiveDim: an average photo gets exactly the screen setting', () => {
  for (const base of [0, 0.2, 0.5, 0.8, 0.9]) assert.equal(adaptiveDim(base, L_AVG), base)
})

test('adaptiveDim: brighter is darker, darker is lighter, by GAIN', () => {
  near(adaptiveDim(0.5, L_AVG + 0.1), 0.5 + GAIN * 0.1, 1e-3)
  near(adaptiveDim(0.5, L_AVG - 0.1), 0.5 - GAIN * 0.1, 1e-3)
  let prev = -1
  for (let l = 0; l <= 1; l += 0.01) {
    const d = adaptiveDim(0.5, l)
    assert.ok(d >= prev, `not monotonic at ${l}`)
    prev = d
  }
})

test('adaptiveDim: clamped around the setting and to 0 .. DIM_MAX', () => {
  assert.equal(adaptiveDim(0.5, 1), 0.5 + DIM_DARKER)
  assert.equal(adaptiveDim(0.5, 0), 0.5 - DIM_LIGHTER)
  assert.equal(adaptiveDim(0.8, 1), DIM_MAX)
  assert.equal(adaptiveDim(0.1, 0), 0)
  assert.equal(adaptiveDim(0, 0), 0)
})

test('adaptiveDim: the verification photos at the default 50%', () => {
  assert.equal(adaptiveDim(0.5, 0.639), 0.75) // snow: clamped
  near(adaptiveDim(0.5, 0.513), 0.683, 1e-3) // sky
  near(adaptiveDim(0.5, 0.081), 0.338, 1e-3) // night
})

test('adaptiveDim: no luma, or a bad setting', () => {
  assert.equal(adaptiveDim(0.5, null), 0.5)
  assert.equal(adaptiveDim(0.5, NaN), 0.5)
  assert.equal(adaptiveDim(undefined, L_AVG), 0.5)
  assert.equal(adaptiveDim('0.7', L_AVG), 0.5)
  assert.equal(adaptiveDim(2, L_AVG), DIM_MAX)
  assert.equal(baseDim(-1), 0)
  assert.equal(baseDim(0.65), 0.65)
})
