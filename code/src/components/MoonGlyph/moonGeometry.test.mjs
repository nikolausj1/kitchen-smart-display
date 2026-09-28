// Tests for components/MoonGlyph/moonGeometry.js: the moon's lit shape at a
// phase (new, the quarters, full, crescents and gibbous moons both ways, out
// of range held to the scale), its name in the hub's buckets, and the local
// phase for the screens' Open-Meteo fallback. The sun and moon panel has
// always drawn its moon with this lit path; a frozen copy of the panel's own
// function holds the shared one to the same bytes.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PHASE,
  clampPhase,
  litFraction,
  moonLitPath,
  moonPhaseName,
  synodicPhase,
} from './moonGeometry.js'
import { moonPhase as sunJsMoonPhase } from '../../views/TodayLayouts/lib/sun.js'
import { moonPhaseFraction, moonPhaseName as hubMoonPhaseName } from '../../../../frameserver/lib/openMeteoWeather.mjs'

// The path's two arcs, read back: where the limb and the terminator cross the
// horizontal diameter. The lit part at the moon's equator runs between them.
const PATH_RE =
  /^M(\S+) (\S+) A(\S+) (\S+) 0 0 ([01]) (\S+) (\S+) A(\S+) (\S+) 0 0 ([01]) (\S+) (\S+) Z$/

function readPath(d) {
  const m = PATH_RE.exec(d)
  assert.ok(m, `not a moon path: ${d}`)
  const [cx, top, r, ry, limbSweep, bx, bottom, rx, try_, termSweep, ex, end] = m.slice(1).map(Number)
  assert.equal(bx, cx)
  assert.equal(ex, cx)
  assert.equal(end, top)
  assert.equal(ry, r)
  assert.equal(try_, r)
  assert.equal(bottom - top, 2 * r)
  // From the top to the bottom, sweep 1 runs clockwise on screen: by the right.
  const limbX = cx + (limbSweep === 1 ? r : -r)
  // From the bottom back to the top, sweep 0 runs by the right.
  const termX = cx + (termSweep === 0 ? rx : -rx)
  return { cx, r, rx, limbX, termX, lo: Math.min(limbX, termX), hi: Math.max(limbX, termX) }
}

const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps

test('new moon: nothing lit, the limb and the terminator are one arc', () => {
  const g = readPath(moonLitPath(0, 50, 50, 40))
  assert.ok(near(g.hi - g.lo, 0), `lit width ${g.hi - g.lo}`)
  assert.equal(g.rx, 40)
  assert.equal(litFraction(0), 0)
})

test('first quarter: the right half, a straight terminator', () => {
  const d = moonLitPath(0.25, 12, 12, 10)
  assert.equal(d, 'M12 2 A10 10 0 0 1 12 22 A0.000 10 0 0 1 12 2 Z')
  const g = readPath(moonLitPath(0.25, 50, 50, 40))
  assert.equal(g.rx, 0)
  assert.ok(near(g.lo, 50) && near(g.hi, 90), `${g.lo}..${g.hi}`)
  assert.ok(near(litFraction(0.25), 0.5))
})

test('full moon: the whole disc', () => {
  const g = readPath(moonLitPath(0.5, 50, 50, 40))
  assert.equal(g.rx, 40)
  assert.ok(near(g.lo, 10) && near(g.hi, 90), `${g.lo}..${g.hi}`)
  assert.equal(litFraction(0.5), 1)
})

test('last quarter: the left half', () => {
  const g = readPath(moonLitPath(0.75, 50, 50, 40))
  assert.equal(g.rx, 0)
  assert.ok(near(g.lo, 10) && near(g.hi, 50), `${g.lo}..${g.hi}`)
  assert.ok(near(litFraction(0.75), 0.5))
})

test('crescents: waxing lit on the right, waning on the left, the terminator bulging to the lit side', () => {
  const k = Math.cos(Math.PI / 4) * 40 // the terminator's half width at 0.125 and 0.875
  const wax = readPath(moonLitPath(0.125, 50, 50, 40))
  assert.equal(wax.limbX, 90)
  assert.ok(near(wax.termX, 50 + k), `terminator at ${wax.termX}`)
  assert.ok(near(wax.hi - wax.lo, 40 - k))
  const wane = readPath(moonLitPath(0.875, 50, 50, 40))
  assert.equal(wane.limbX, 10)
  assert.ok(near(wane.termX, 50 - k), `terminator at ${wane.termX}`)
  assert.ok(near(wane.hi - wane.lo, 40 - k))
  assert.ok(near(litFraction(0.125), litFraction(0.875)))
  assert.ok(litFraction(0.125) > 0.14 && litFraction(0.125) < 0.15)
})

test('gibbous moons: more than half, the terminator bulging to the dark side', () => {
  const k = Math.cos(Math.PI / 4) * 40
  const wax = readPath(moonLitPath(0.375, 50, 50, 40))
  assert.equal(wax.limbX, 90)
  assert.ok(near(wax.termX, 50 - k))
  const wane = readPath(moonLitPath(0.625, 50, 50, 40))
  assert.equal(wane.limbX, 10)
  assert.ok(near(wane.termX, 50 + k))
  assert.ok(near(wane.hi - wane.lo, 40 + k))
})

test('the lit width at the equator follows the phase all the way round', () => {
  for (let i = 0; i <= 200; i++) {
    const p = i / 200
    const g = readPath(moonLitPath(p, 0, 0, 1))
    const t = Math.cos(2 * Math.PI * p)
    assert.ok(near(g.hi - g.lo, 1 - t, 1e-3), `phase ${p}: width ${g.hi - g.lo}`)
    // Lit on the right while waxing, on the left while waning.
    if (p > 0.001 && p < 0.499) assert.equal(g.hi, 1, `phase ${p}`)
    if (p > 0.501 && p < 0.999) assert.equal(g.lo, -1, `phase ${p}`)
  }
})

test('out of range is held to the scale; not a number draws nothing', () => {
  assert.equal(clampPhase(-0.3), 0)
  assert.equal(clampPhase(1.7), 1)
  assert.equal(clampPhase(0.4), 0.4)
  assert.equal(moonLitPath(-0.3, 50, 50, 40), moonLitPath(0, 50, 50, 40))
  assert.equal(moonLitPath(1.7, 50, 50, 40), moonLitPath(1, 50, 50, 40))
  // 1 is new again: nothing lit.
  const g = readPath(moonLitPath(1, 50, 50, 40))
  assert.ok(near(g.hi - g.lo, 0))
  for (const bad of [NaN, Infinity, undefined, null, '0.5', {}]) {
    assert.equal(clampPhase(bad), null, String(bad))
    assert.equal(moonLitPath(bad, 12, 12, 10), null, String(bad))
    assert.equal(litFraction(bad), null, String(bad))
    assert.equal(moonPhaseName(bad), null, String(bad))
  }
  assert.equal(moonPhaseName(-2), 'New moon')
  assert.equal(moonPhaseName(3), 'New moon')
})

test('the default is a waxing crescent', () => {
  assert.equal(moonPhaseName(DEFAULT_PHASE), 'Waxing crescent')
  assert.equal(readPath(moonLitPath(DEFAULT_PHASE, 0, 0, 1)).hi, 1)
})

// The sun and moon panel's own function, as it stood before the move
// (SunMoonPanel.jsx at bf35ecb), frozen here.
function panelMoonLitPath(phase, cx, cy, r) {
  if (!Number.isFinite(phase)) return null
  const p = ((phase % 1) + 1) % 1
  const t = Math.cos(2 * Math.PI * p)
  const waxing = p < 0.5
  const rx = Math.abs(t) * r
  const xm = cx + (waxing ? 1 : -1) * t * r
  const limbSweep = waxing ? 1 : 0
  const termSweep = xm > cx ? 0 : 1
  const top = `${cx} ${cy - r}`
  const bottom = `${cx} ${cy + r}`
  return `M${top} A${r} ${r} 0 0 ${limbSweep} ${bottom} A${rx.toFixed(3)} ${r} 0 0 ${termSweep} ${top} Z`
}

test('the sun and moon panel: the same bytes for every phase it is handed', () => {
  // The panel draws lib/sun.js moonPhase(...).phase, always in [0, 1), at 12, 12, 10.
  for (let i = 0; i < 20000; i++) {
    const p = i / 20000
    assert.equal(moonLitPath(p, 12, 12, 10), panelMoonLitPath(p, 12, 12, 10), `phase ${p}`)
  }
  const start = Date.UTC(2026, 0, 1, 20)
  for (let day = 0; day < 800; day++) {
    const p = sunJsMoonPhase(start + day * 86400000).phase
    assert.equal(moonLitPath(p, 12, 12, 10), panelMoonLitPath(p, 12, 12, 10), `day ${day}`)
  }
  assert.equal(moonLitPath(NaN, 12, 12, 10), panelMoonLitPath(NaN, 12, 12, 10))
})

test('names: the hub\'s eight buckets, the same words as the feed\'s moon.name', () => {
  const cases = [
    [0, 'New moon'],
    [0.06, 'New moon'],
    [0.0625, 'Waxing crescent'],
    [0.125, 'Waxing crescent'],
    [0.25, 'First quarter'],
    [0.375, 'Waxing gibbous'],
    [0.5, 'Full moon'],
    [0.625, 'Waning gibbous'],
    [0.75, 'Last quarter'],
    [0.875, 'Waning crescent'],
    [0.95, 'New moon'],
    [1, 'New moon'],
  ]
  for (const [p, name] of cases) assert.equal(moonPhaseName(p), name, String(p))
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000
    assert.equal(moonPhaseName(p).toLowerCase(), hubMoonPhaseName(p).toLowerCase(), String(p))
  }
})

test('synodicPhase: the mean month from a known new moon, as lib/sun.js and the hub count it', () => {
  // The total solar eclipse, 2024-04-08 18:21 UTC, was a new moon; 2024-04-23
  // 23:49 UTC a full one. The mean model is within a day of both.
  const nm = synodicPhase(Date.UTC(2024, 3, 8, 18, 21))
  assert.ok(nm < 0.03 || nm > 0.97, `new moon read ${nm}`)
  const fm = synodicPhase(new Date(Date.UTC(2024, 3, 23, 23, 49)))
  assert.ok(Math.abs(fm - 0.5) < 0.03, `full moon read ${fm}`)
  for (let day = 0; day < 400; day++) {
    const ms = Date.UTC(2026, 0, 1, 19) + day * 86400000
    const p = synodicPhase(ms)
    assert.ok(p >= 0 && p < 1)
    assert.ok(Math.abs(p - sunJsMoonPhase(ms).phase) < 1e-9, `day ${day}`)
    const hub = moonPhaseFraction(new Date(ms))
    assert.ok(Math.min(Math.abs(p - hub), 1 - Math.abs(p - hub)) < 1e-5, `day ${day}: ${p} vs the hub's ${hub}`)
  }
  // Before the epoch too.
  const old = synodicPhase(Date.UTC(1999, 0, 1))
  assert.ok(old >= 0 && old < 1)
  assert.equal(synodicPhase(NaN), null)
  assert.equal(synodicPhase(new Date('nope')), null)
  assert.equal(synodicPhase('2026-09-28'), null)
})
