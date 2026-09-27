import { useEffect, useEffectEvent } from 'react'

// useLayoutSwipe - swipe left or right on a Today screen for the next or the
// previous Today layout. TodayLayoutSwitch.jsx owns what a swipe does (the
// slide, the pill, saving display.todayLayout); this file only decides
// whether a drag was a swipe, and which way.
//
// Pointer events, so a finger (Silk on the Echo Shows, Chromium on the Pi)
// and a mouse (a laptop) take one code path. The gesture:
//   - starts on a pointerdown inside the container: the main button of a
//     mouse, or the first finger (a second finger calls it off);
//   - never starts on a control, by the shell's tap rule (AppShell.jsx
//     isInsideInteractive: a button, a link, a form field, a listbox such as
//     the timer's scroll wheels, anything marked data-interactive), nor
//     inside anything that scrolls sideways;
//   - is called off as soon as vertical movement wins (whichever axis passes
//     AXIS_LOCK_PX first decides), or when the browser takes the pointer for
//     a scroll of its own (pointercancel);
//   - commits on release when |dx| >= SWIPE_MIN_PX, or on a flick (|dx| >=
//     FLICK_MIN_PX, moving faster than FLICK_MIN_SPEED px/ms over the last
//     VELOCITY_WINDOW_MS), and in both cases |dx| > AXIS_RATIO * |dy|. Left
//     is the next layout, right the previous.
// Nothing moves under the finger; the layout slides once the swipe commits.
//
// Nothing here calls preventDefault, so a tap without movement is untouched
// and its click reaches the shell as before (the menu pill, the departure
// toggle). A swipe's own click is swallowed: a mouse drag ends in a click on
// the common ancestor, which would summon the menu pill.
//
// The container needs touch-action: pan-y (TodayLayoutSwitch.css): the
// browser keeps vertical scrolling and hands sideways drags to the page as
// pointer events. Without it a touch drag is taken for a pan and cancelled.

export const SWIPE_MIN_PX = 80
export const FLICK_MIN_PX = 40
export const FLICK_MIN_SPEED = 0.6 // px per ms
export const AXIS_RATIO = 2
export const AXIS_LOCK_PX = 10
export const VELOCITY_WINDOW_MS = 100
// How long a swipe's click is waited for. A mouse sends it straight after the
// pointerup; a finger that moved this far sends none, and a real tap this
// soon after a swipe (the slide is still running) is not worth keeping.
const CLICK_SWALLOW_MS = 250
// Samples kept for the release velocity; far more than 100 ms of moves.
const MAX_SAMPLES = 24

// Which axis a drag belongs to once it has travelled `slop` px along either:
// 'x', 'y' (a tie goes to 'y'), or null while it is still inside the slop.
export function dragAxis(dx, dy, slop = AXIS_LOCK_PX) {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < slop && ay < slop) return null
  return ax > ay ? 'x' : 'y'
}

// The speed along x at release, px/ms: the travel over the last `windowMs`
// of samples [{ t, x }] (oldest first, the release point last). 0 when the
// samples span no time, as when the pointer sat still before it lifted.
export function releaseVelocity(samples, windowMs = VELOCITY_WINDOW_MS) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = last
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    if (last.t - samples[i].t > windowMs) break
    first = samples[i]
  }
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}

// Which way a finished drag goes: 'next' (a swipe to the left), 'prev' (to
// the right), or null when it was not a swipe. dx, dy: the travel from the
// pointerdown; vx: releaseVelocity().
export function swipeDirection({ dx, dy, vx = 0 }) {
  const ax = Math.abs(dx)
  if (!(ax > AXIS_RATIO * Math.abs(dy))) return null
  const far = ax >= SWIPE_MIN_PX
  const flick = ax >= FLICK_MIN_PX && Math.abs(vx) > FLICK_MIN_SPEED && vx * dx > 0
  if (!far && !flick) return null
  return dx < 0 ? 'next' : 'prev'
}

// The id after (dir 'next') or before ('prev') `id` in `ids`, wrapping at
// both ends. An id not in the list counts as the first.
export function stepLayout(ids, id, dir) {
  const n = Array.isArray(ids) ? ids.length : 0
  if (!n) return id
  const i = Math.max(0, ids.indexOf(id))
  return ids[(i + (dir === 'prev' ? n - 1 : 1)) % n]
}

// Does a gesture that starts on `target` belong to something else? True for
// a control (the shell's tap rule) or anything that scrolls sideways, on the
// way from target up to (not including) `root`. `styleOf` is
// getComputedStyle, a parameter for the tests.
export function startsOnControl(target, root, styleOf) {
  const style =
    styleOf || (typeof window !== 'undefined' ? (el) => window.getComputedStyle(el) : null)
  for (let el = target; el && el !== root; el = el.parentElement) {
    const tag = el.tagName
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true
    }
    if (el.dataset && el.dataset.interactive === 'true') return true
    if (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'listbox') return true
    if (style && el.scrollWidth > el.clientWidth + 1) {
      const ox = style(el).overflowX
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

// Attach the gesture to ref.current while `enabled`; onSwipe('next' | 'prev')
// runs on each swipe (it may ignore one, say mid-slide).
export default function useLayoutSwipe(ref, { enabled, onSwipe }) {
  const fireSwipe = useEffectEvent((dir) => {
    onSwipe(dir)
  })

  useEffect(() => {
    const root = ref.current
    if (!enabled || !root) return undefined

    let g = null // the drag in progress
    let swallowing = null // clears a pending click swallow

    function stopTracking() {
      g = null
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
    }

    function swallowNextClick() {
      if (swallowing) swallowing()
      let timer = null
      const swallow = (e) => {
        e.stopPropagation()
        e.preventDefault()
        stop()
      }
      const stop = () => {
        window.removeEventListener('click', swallow, true)
        clearTimeout(timer)
        swallowing = null
      }
      window.addEventListener('click', swallow, true)
      timer = setTimeout(stop, CLICK_SWALLOW_MS)
      swallowing = stop
    }

    function onDown(e) {
      // A second finger while one is down: a pinch or a palm, not a swipe.
      if (e.isPrimary === false) {
        if (g) stopTracking()
        return
      }
      if (g) stopTracking() // a drag whose pointerup never came
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (startsOnControl(e.target, root)) return
      g = {
        id: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        axis: null,
        samples: [{ t: e.timeStamp, x: e.clientX }],
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
    }

    function onMove(e) {
      if (!g || e.pointerId !== g.id) return
      g.samples.push({ t: e.timeStamp, x: e.clientX })
      if (g.samples.length > MAX_SAMPLES) g.samples.shift()
      if (!g.axis) {
        g.axis = dragAxis(e.clientX - g.x0, e.clientY - g.y0)
        if (g.axis === 'y') stopTracking() // vertical won: a scroll, not a swipe
      }
    }

    function onUp(e) {
      if (!g || e.pointerId !== g.id) return
      const { x0, y0, samples } = g
      samples.push({ t: e.timeStamp, x: e.clientX })
      stopTracking()
      const dir = swipeDirection({
        dx: e.clientX - x0,
        dy: e.clientY - y0,
        vx: releaseVelocity(samples),
      })
      if (!dir) return
      swallowNextClick()
      fireSwipe(dir)
    }

    function onCancel(e) {
      if (g && e.pointerId === g.id) stopTracking()
    }

    root.addEventListener('pointerdown', onDown, { capture: true, passive: true })
    return () => {
      root.removeEventListener('pointerdown', onDown, { capture: true })
      stopTracking()
      if (swallowing) swallowing()
    }
  }, [ref, enabled])
}
