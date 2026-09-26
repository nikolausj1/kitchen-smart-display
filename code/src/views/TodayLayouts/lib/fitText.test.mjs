// Tests for fitText.js's search, on a model element whose size is its text
// times the fit factor. Run from code/: node --test src/views/TodayLayouts/lib/fitText.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_STEPS, MIN_FIT, fitElement, overflowRatio } from './fitText.js'

// A one-line element: natural width w at fit 1, height h; `inner` clips (an
// ellipsis) at the box's width, like the headline's text span.
function model(w, h, boxW) {
  const vars = {}
  const fit = () => (vars['--tl-el-fit'] == null ? 1 : Number(vars['--tl-el-fit']))
  const inner = {
    get clientWidth() { return Math.min(boxW, w * fit()) },
    get scrollWidth() { return w * fit() },
    clientHeight: 0,
    scrollHeight: 0,
  }
  const el = {
    writes: 0,
    style: {
      setProperty(k, v) { vars[k] = v; el.writes += 1 },
      removeProperty(k) { delete vars[k]; el.writes += 1 },
    },
    getBoundingClientRect() {
      const width = Math.min(boxW, w * fit())
      return { left: 0, top: 0, right: width, bottom: h * fit(), width, height: h * fit() }
    },
    querySelectorAll() { return [inner] },
    clientWidth: 0,
    clientHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
    fit,
  }
  return el
}

const box = (w, h) => ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h })

test('an element that fits is left at 1 after one measurement', () => {
  const el = model(500, 60, 800)
  assert.equal(overflowRatio(el, box(800, 100)), 1)
  assert.deepEqual(fitElement(el, box(800, 100)), { fit: 1, steps: 1 })
  assert.equal(el.fit(), 1)
})

test('a long line shrinks to within 1% of the largest size that fits', () => {
  const el = model(1600, 60, 800)
  const { fit, steps } = fitElement(el, box(800, 100))
  assert.ok(steps <= MAX_STEPS, `steps ${steps}`)
  assert.ok(fit <= 0.5 && fit >= 0.49, `fit ${fit}`)
  assert.equal(el.fit(), fit)
})

test('the height counts too, and the factor never goes under MIN_FIT', () => {
  const tall = model(200, 300, 800)
  const r = fitElement(tall, box(800, 100))
  assert.ok(r.fit <= 1 / 3 + 0.01 && r.fit >= 1 / 3 - 0.01, `fit ${r.fit}`)
  const hopeless = model(100000, 60, 800)
  const h = fitElement(hopeless, box(800, 100))
  assert.ok(h.fit >= MIN_FIT - 1e-9, `fit ${h.fit}`)
  assert.ok(h.steps <= MAX_STEPS)
})
