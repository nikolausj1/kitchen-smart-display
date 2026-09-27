import { useLayoutEffect } from 'react'

// useHaFit(ref, key, { self }) - keeps a Home Assistant panel's content inside
// its box (docs/designs/panels-and-controls.md: text that does not fit
// shrinks or wraps, never truncates). How much room a picker's options or a
// row of chips need depends on their words, which CSS cannot know, so this
// measures: while the box's content overflows it, --tl-ha-fit (a factor, 1
// at most, MIN_FIT at least) on the element steps down, and every size in
// the panel multiplies by it (the panels' stylesheets). The box is the
// element's parent (the panel's body), or with self the element itself (the
// button's face).
//
// It fits when it starts, when `key` changes (the words, the knobs: anything
// that changes what the content needs), when the box changes size and once
// the web fonts have loaded: a layout effect and a ResizeObserver, so an
// unfitted frame is never painted. Each fit starts again from 1, so content
// that got shorter grows back. A few forced layouts of one box, and nothing
// between fits.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80 (ResizeObserver
// is there; without it the fit still runs on every change of `key`).

const MIN_FIT = 0.5
const PASSES = 5

// How far the box's content overflows it, as a ratio (1 when it fits).
function overflow(box) {
  const h = box.clientHeight
  const w = box.clientWidth
  if (!h || !w) return 1
  return Math.max(box.scrollHeight / h, box.scrollWidth / w)
}

function fit(el, box) {
  el.style.setProperty('--tl-ha-fit', '1')
  let f = 1
  for (let i = 0; i < PASSES; i++) {
    const r = overflow(box)
    if (r <= 1.005) break
    f = Math.max(MIN_FIT, Math.floor((f / r) * 1000) / 1000)
    el.style.setProperty('--tl-ha-fit', String(f))
    if (f <= MIN_FIT) break
  }
}

export default function useHaFit(ref, key, options) {
  const self = !!(options && options.self)

  // One effect per content (`key`): fit now, then again whenever the box
  // changes size (the observer also reports once as it starts) and once the
  // web fonts are in. Re-made with the content, so an element that mounts
  // later (a status panel whose entity arrives) is observed too.
  useLayoutEffect(() => {
    const el = ref.current
    const box = el ? (self ? el : el.parentElement) : null
    if (!el || !box) return undefined
    let stopped = false
    const run = () => {
      if (!stopped) fit(el, box)
    }
    run()
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(run)
      ro.observe(box)
    }
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(run, () => {})
    }
    return () => {
      stopped = true
      if (ro) ro.disconnect()
    }
  }, [ref, self, key])
}
