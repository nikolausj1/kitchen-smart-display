// fitText.js - "shrink to fit" for the element styles (props.elements, fit:
// 'shrink'; layoutSpec.js ELEMENT_STYLE_SCHEMA). Framework-free: SpecPanel
// starts one fitter per box that has a shrinking element (Entry/useFitText.js).
//
// How it shrinks: through the element's text scale, never a font size of its
// own. The fitter writes --tl-el-fit (a factor of 1 or less) inline on the
// element, over its stylesheet rule, and the element's text scale multiplies
// it (Entry/specStyles.js, tokens.css "Panel knobs"), so every size inside the
// element steps down together, a panel's own size knobs included, and em
// sizes follow.
//
// When it runs: at start and when asked (the spec changed: SpecPanel's layout
// effect, before the browser paints); when the box changes size (from the
// ResizeObserver, which reports after layout and before paint); when the text
// inside a shrinking element changes (from the MutationObserver, right after
// React's commit); and in the next animation frame after web fonts finish
// loading. So no unfitted frame is ever painted. An element whose text and
// room are what they were at its last fit is skipped (the clock re-renders
// the board every second, and a resize callback also comes once at start). A
// pass is a few forced layouts of one box, and nothing runs between passes: no
// timer, no animation, no work during the photo crossfade.
//
// Fitting one element: at 1, measure how far it overflows; jump to the linear
// estimate and step down until it fits; probe a little above the fit (the
// estimate is nearly exact for one line of text), then bisect between the
// last fit and the last miss. At most MAX_STEPS layouts, never under MIN_FIT (past that the
// element overflows as it would have, into its ellipsis or its clip). It fits
// when it lies inside the box's content area and neither it nor anything it
// clips (an ellipsis, a line clamp) holds more than it shows.
//
// window.__sdFitStats { runs, fits, lastMs, maxMs, lastSteps } records the
// passes, for a look from the console or the verification harness.

export const MIN_FIT = 0.3
export const MAX_STEPS = 8
export const FIT_VAR = '--tl-el-fit'

// Sub-pixel slack, and how many nodes inside an element are checked for a
// clip (an agenda column has dozens; the first ones tell).
const EPS = 0.5
const MAX_SCAN = 40
const SAFE_KEY = /^[A-Za-z0-9_-]+$/

const stats = { runs: 0, fits: 0, lastMs: 0, maxMs: 0, lastSteps: 0 }
if (typeof window !== 'undefined') window.__sdFitStats = stats

function clock() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}

// The box's content area in viewport pixels (inside its padding).
function contentRect(box) {
  const r = box.getBoundingClientRect()
  const cs = window.getComputedStyle(box)
  const left = r.left + (parseFloat(cs.paddingLeft) || 0)
  const top = r.top + (parseFloat(cs.paddingTop) || 0)
  const right = r.right - (parseFloat(cs.paddingRight) || 0)
  const bottom = r.bottom - (parseFloat(cs.paddingBottom) || 0)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

// How far an element overflows, as a ratio: 1 when it fits.
export function overflowRatio(el, limit) {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return 1
  let ratio = 1
  if (r.right > limit.right + EPS) ratio = Math.max(ratio, r.width / Math.max(1, limit.right - r.left))
  if (r.bottom > limit.bottom + EPS) ratio = Math.max(ratio, r.height / Math.max(1, limit.bottom - r.top))
  const inside = el.querySelectorAll('*')
  const n = Math.min(inside.length, MAX_SCAN)
  for (let i = -1; i < n; i++) {
    const node = i < 0 ? el : inside[i]
    const cw = node.clientWidth
    const ch = node.clientHeight
    if (cw > 0 && node.scrollWidth > cw + 1) ratio = Math.max(ratio, node.scrollWidth / cw)
    if (ch > 0 && node.scrollHeight > ch + 1) ratio = Math.max(ratio, node.scrollHeight / ch)
  }
  return ratio
}

function setFit(el, f) {
  if (f >= 1) el.style.removeProperty(FIT_VAR)
  else el.style.setProperty(FIT_VAR, String(Math.round(f * 10000) / 10000))
}

// fitElement(el, limit) -> { fit, steps }: the largest factor (to about 1%)
// at which el fits `limit`, written on el.
export function fitElement(el, limit) {
  setFit(el, 1)
  let ratio = overflowRatio(el, limit)
  let steps = 1
  if (ratio <= 1) return { fit: 1, steps }
  let miss = 1
  let hit = 0
  let f = Math.max(MIN_FIT, Math.min(0.99, 0.99 / ratio))
  while (steps < MAX_STEPS) {
    setFit(el, f)
    ratio = overflowRatio(el, limit)
    steps += 1
    if (ratio <= 1) {
      hit = f
      break
    }
    miss = f
    if (f <= MIN_FIT) break
    f = Math.max(MIN_FIT, f * Math.min(0.94, 0.99 / ratio))
  }
  // Never fitted: left at the smallest factor tried.
  if (!hit) return { fit: miss, steps }
  // The estimate is usually within a few percent: look just above it first,
  // so the bisection starts from a narrow gap rather than from 1.
  const probe = Math.min(miss, hit * 1.04)
  if (steps < MAX_STEPS && probe - hit > 0.005) {
    setFit(el, probe)
    if (overflowRatio(el, limit) <= 1) hit = probe
    else miss = probe
    steps += 1
  }
  while (steps < MAX_STEPS && miss - hit > 0.01) {
    const mid = (hit + miss) / 2
    setFit(el, mid)
    if (overflowRatio(el, limit) <= 1) hit = mid
    else miss = mid
    steps += 1
  }
  setFit(el, hit)
  return { fit: hit, steps }
}

// createFitter(box, keys) -> { flush(all), schedule(all), stop() }: keeps
// every element of `box` whose data-edit is one of `keys` fitted until
// stopped. flush fits now (all: every element, even one that looks
// unchanged), schedule in the next animation frame; stop() takes the factors
// off again.
export function createFitter(box, keys) {
  const wanted = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && SAFE_KEY.test(k))
  const selector = wanted.map((k) => `[data-edit="${k}"]`).join(',')
  if (!box || !selector || typeof window === 'undefined') return { flush() {}, schedule() {}, stop() {} }

  let frame = 0
  let stopped = false
  let force = true
  // What each element's text and its box's room were at its last fit.
  const fittedAs = new WeakMap()

  function run() {
    frame = 0
    if (stopped) return
    const t0 = clock()
    const els = box.querySelectorAll(selector)
    let limit = null
    let steps = 0
    let fitted = 0
    for (let i = 0; i < els.length; i++) {
      const el = els[i]
      if (!limit) limit = contentRect(box)
      const sig = `${Math.round(limit.width)}x${Math.round(limit.height)}|${el.textContent}`
      if (!force && fittedAs.get(el) === sig) continue
      steps += fitElement(el, limit).steps
      fittedAs.set(el, sig)
      fitted += 1
    }
    force = false
    if (!fitted) return
    const ms = clock() - t0
    stats.runs += 1
    stats.fits += fitted
    stats.lastMs = Math.round(ms * 1000) / 1000
    stats.maxMs = Math.max(stats.maxMs, stats.lastMs)
    stats.lastSteps = steps
  }

  function schedule(all) {
    if (stopped) return
    if (all) force = true
    if (!frame) frame = window.requestAnimationFrame(run)
  }

  function flush(all) {
    if (stopped) return
    if (all) force = true
    if (frame) window.cancelAnimationFrame(frame)
    run()
  }

  // Text changed inside a shrinking element, or one was added.
  function relevant(records) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      const t = rec.target && rec.target.nodeType === 1 ? rec.target : rec.target && rec.target.parentElement
      if (t && t.closest && t.closest(selector)) return true
      const added = rec.addedNodes || []
      for (let j = 0; j < added.length; j++) {
        const n = added[j]
        if (n.nodeType === 1 && (n.matches(selector) || n.querySelector(selector))) return true
      }
    }
    return false
  }

  // A new size changes every element's signature, so the resize itself needs
  // no force (and its first report, on observe, finds nothing to do).
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => flush(false)) : null
  if (ro) ro.observe(box)
  const mo =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver((records) => {
          if (relevant(records)) flush(false)
        })
      : null
  if (mo) mo.observe(box, { childList: true, characterData: true, subtree: true })
  const fonts = typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener ? document.fonts : null
  const onFonts = () => schedule(true)
  if (fonts) fonts.addEventListener('loadingdone', onFonts)
  flush(true)

  return {
    flush,
    schedule,
    stop() {
      stopped = true
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      if (ro) ro.disconnect()
      if (mo) mo.disconnect()
      if (fonts) fonts.removeEventListener('loadingdone', onFonts)
      const els = box.querySelectorAll(selector)
      for (let i = 0; i < els.length; i++) els[i].style.removeProperty(FIT_VAR)
    },
  }
}
