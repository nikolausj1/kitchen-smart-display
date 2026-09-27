// Tests for the Today layout swipe's pure parts (useLayoutSwipe.js): which
// axis a drag belongs to, the release speed, whether a drag was a swipe and
// which way, the step through the layouts, and where a swipe may not start.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AXIS_LOCK_PX,
  FLICK_MIN_PX,
  SWIPE_MIN_PX,
  dragAxis,
  releaseVelocity,
  startsOnControl,
  stepLayout,
  swipeDirection,
} from './useLayoutSwipe.js'
import { LAYOUT_IDS } from './registry.js'

test('the thresholds are the ones asked for', () => {
  assert.equal(SWIPE_MIN_PX, 80)
  assert.equal(FLICK_MIN_PX, 40)
  assert.equal(AXIS_LOCK_PX, 10)
})

test('dragAxis: undecided inside the slop, then whichever axis leads', () => {
  assert.equal(dragAxis(0, 0), null)
  assert.equal(dragAxis(9, -9), null)
  assert.equal(dragAxis(-10, 3), 'x')
  assert.equal(dragAxis(12, 11), 'x')
  assert.equal(dragAxis(3, 10), 'y')
  assert.equal(dragAxis(-11, -12), 'y')
  assert.equal(dragAxis(10, -10), 'y', 'a tie goes to vertical')
  assert.equal(dragAxis(5, 2, 4), 'x', 'the slop is a parameter')
})

test('releaseVelocity: the travel over the last 100 ms', () => {
  assert.equal(releaseVelocity([]), 0)
  assert.equal(releaseVelocity([{ t: 0, x: 0 }]), 0)
  assert.equal(releaseVelocity(null), 0)
  // A steady 1 px/ms to the left.
  const steady = Array.from({ length: 11 }, (_, i) => ({ t: i * 16, x: 500 - i * 16 }))
  assert.equal(releaseVelocity(steady), -1)
  // Slow for a while, then fast at the end: only the last 100 ms count.
  const late = [
    { t: 0, x: 0 },
    { t: 200, x: 20 },
    { t: 300, x: 30 },
    { t: 350, x: 60 },
    { t: 400, x: 110 },
  ]
  assert.equal(releaseVelocity(late), (110 - 30) / 100)
  // Moved, then held still before lifting: no speed at release.
  const held = [
    { t: 0, x: 0 },
    { t: 50, x: -90 },
    { t: 300, x: -90 },
  ]
  assert.equal(releaseVelocity(held), 0)
  // Every sample at one instant: no time to measure over.
  assert.equal(releaseVelocity([{ t: 5, x: 0 }, { t: 5, x: 40 }]), 0)
})

test('swipeDirection: far enough and flat enough', () => {
  assert.equal(swipeDirection({ dx: -80, dy: 0 }), 'next', 'left is next')
  assert.equal(swipeDirection({ dx: 80, dy: 0 }), 'prev', 'right is previous')
  assert.equal(swipeDirection({ dx: -79, dy: 0 }), null, 'short and slow')
  assert.equal(swipeDirection({ dx: -300, dy: 20 }), 'next')
  assert.equal(swipeDirection({ dx: -100, dy: 49 }), 'next')
  assert.equal(swipeDirection({ dx: -100, dy: 50 }), null, '|dx| must be MORE than twice |dy|')
  assert.equal(swipeDirection({ dx: 100, dy: -60 }), null, 'too steep')
  assert.equal(swipeDirection({ dx: 0, dy: 200 }), null, 'a vertical drag')
  assert.equal(swipeDirection({ dx: 0, dy: 0 }), null, 'a tap')
})

test('swipeDirection: a flick needs 40 px and more than 0.6 px/ms the same way', () => {
  assert.equal(swipeDirection({ dx: -40, dy: 0, vx: -0.7 }), 'next')
  assert.equal(swipeDirection({ dx: 45, dy: 10, vx: 1.2 }), 'prev')
  assert.equal(swipeDirection({ dx: -39, dy: 0, vx: -2 }), null, 'too short even when fast')
  assert.equal(swipeDirection({ dx: -60, dy: 0, vx: -0.6 }), null, 'exactly 0.6 is not above it')
  assert.equal(swipeDirection({ dx: -60, dy: 0, vx: 0.9 }), null, 'moving back the other way at release')
  assert.equal(swipeDirection({ dx: -60, dy: 35, vx: -2 }), null, 'a fast flick still has to be flat')
})

test('stepLayout: through the registry order, wrapping at both ends', () => {
  assert.deepEqual(LAYOUT_IDS, ['framed', 'board', 'briefing', 'ambient', 'entry', 'clock'])
  assert.equal(stepLayout(LAYOUT_IDS, 'clock', 'next'), 'framed')
  assert.equal(stepLayout(LAYOUT_IDS, 'framed', 'prev'), 'clock')
  assert.equal(stepLayout(LAYOUT_IDS, 'clock', 'prev'), 'entry')
  assert.equal(stepLayout(LAYOUT_IDS, 'entry', 'next'), 'clock')
  assert.equal(stepLayout(LAYOUT_IDS, 'board', 'next'), 'briefing')
  assert.equal(stepLayout(LAYOUT_IDS, 'board', 'prev'), 'framed')
  // Once round the ring either way comes home.
  let id = 'ambient'
  for (let i = 0; i < LAYOUT_IDS.length; i += 1) id = stepLayout(LAYOUT_IDS, id, 'next')
  assert.equal(id, 'ambient')
  for (let i = 0; i < LAYOUT_IDS.length; i += 1) id = stepLayout(LAYOUT_IDS, id, 'prev')
  assert.equal(id, 'ambient')
  // An unknown id counts as the first; an empty list changes nothing.
  assert.equal(stepLayout(LAYOUT_IDS, 'nope', 'next'), 'board')
  assert.equal(stepLayout([], 'clock', 'next'), 'clock')
})

// A tiny stand-in for the DOM: enough of an element for startsOnControl.
function el(tag, { parent = null, data = {}, role = null, scrollWidth = 0, clientWidth = 0, overflowX = 'visible' } = {}) {
  return {
    tagName: tag,
    parentElement: parent,
    dataset: data,
    getAttribute: (name) => (name === 'role' ? role : null),
    scrollWidth,
    clientWidth,
    overflowX,
  }
}
const styleOf = (e) => ({ overflowX: e.overflowX })

test('startsOnControl: the shell tap rule and sideways scrollers', () => {
  const root = el('DIV')
  const layout = el('DIV', { parent: root })
  const panel = el('DIV', { parent: layout })
  const text = el('SPAN', { parent: panel })
  assert.equal(startsOnControl(text, root, styleOf), false, 'plain content')
  assert.equal(startsOnControl(root, root, styleOf), false, 'the container itself')

  const button = el('BUTTON', { parent: panel })
  const icon = el('svg', { parent: button })
  assert.equal(startsOnControl(icon, root, styleOf), true, 'inside a button')
  for (const tag of ['A', 'INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(startsOnControl(el(tag, { parent: panel }), root, styleOf), true, tag)
  }

  const marked = el('DIV', { parent: panel, data: { interactive: 'true' } })
  assert.equal(startsOnControl(el('SPAN', { parent: marked }), root, styleOf), true, 'data-interactive')
  const listbox = el('DIV', { parent: panel, role: 'listbox' })
  assert.equal(startsOnControl(el('DIV', { parent: listbox }), root, styleOf), true, 'a listbox (the timer wheels)')

  const strip = el('DIV', { parent: panel, scrollWidth: 900, clientWidth: 400, overflowX: 'auto' })
  assert.equal(startsOnControl(el('DIV', { parent: strip }), root, styleOf), true, 'scrolls sideways')
  const clipped = el('DIV', { parent: panel, scrollWidth: 900, clientWidth: 400, overflowX: 'hidden' })
  assert.equal(startsOnControl(el('DIV', { parent: clipped }), root, styleOf), false, 'overflow hidden does not scroll')
  const fits = el('DIV', { parent: panel, scrollWidth: 401, clientWidth: 400, overflowX: 'auto' })
  assert.equal(startsOnControl(el('DIV', { parent: fits }), root, styleOf), false, 'a scroller with nothing to scroll')

  // The walk stops at the container: controls above it do not count.
  const outerButton = el('BUTTON')
  const inner = el('DIV', { parent: outerButton })
  const leaf = el('DIV', { parent: inner })
  assert.equal(startsOnControl(leaf, inner, styleOf), false)
})
