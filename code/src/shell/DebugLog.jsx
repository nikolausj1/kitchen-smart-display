import { useEffect, useState } from 'react'
import './DebugLog.css'

// Lightweight global event log + on-screen HUD for diagnosing the touch /
// click event flow on the kiosk. Drop calls to logEvent() at interesting
// sites and the most recent events appear in the top-left corner.

let listeners = []
let events = []

export function logEvent(msg) {
  const ev = { msg, t: new Date().toLocaleTimeString([], { hour12: false }) }
  events = [...events, ev].slice(-14)
  listeners.forEach((l) => l(events))
}

// Document-level capture-phase pointerdown listener. Fires for EVERY touch
// on the page before React handlers, regardless of stopPropagation or
// component logic. Gives us ground truth on what the user actually tapped.
if (typeof window !== 'undefined' && !window.__debugPointerInstalled) {
  window.__debugPointerInstalled = true

  function describe(t) {
    const tag = t.tagName || '?'
    let cls = ''
    if (t.className) {
      if (typeof t.className === 'string') cls = t.className
      else if (t.className.baseVal) cls = t.className.baseVal
    }
    cls = String(cls).split(/\s+/).filter(Boolean).slice(0, 2).join('.')
    return tag + (cls ? '.' + cls : '')
  }

  // Capture-phase click listener so we can see if a real click ever
  // reaches the page (useful for distinguishing native clicks from our
  // synthetic ones below).
  window.addEventListener('click', (e) => {
    logEvent(`CLK  ${describe(e.target)}`)
  }, { capture: true })

  // Swipe detection. Track touchstart, compare to touchend; if the move
  // was a meaningful horizontal sweep, dispatch a custom 'app-swipe' event
  // with direction. Consumers (e.g. PhotoSlideshow) listen on window.
  // Chromium handles taps natively now, so no synthetic click needed.
  const SWIPE_MIN_DX = 90
  const SWIPE_AXIS_RATIO = 1.5
  let __tStart = null
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0]
    if (t) __tStart = { x: t.clientX, y: t.clientY, time: Date.now() }
  }, { capture: true, passive: true })
  window.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0]
    const start = __tStart
    __tStart = null
    if (!t || !start) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (
      Math.abs(dx) >= SWIPE_MIN_DX &&
      Math.abs(dx) > Math.abs(dy) * SWIPE_AXIS_RATIO
    ) {
      window.dispatchEvent(
        new CustomEvent('app-swipe', {
          detail: { direction: dx < 0 ? 'left' : 'right', dx, dy },
        })
      )
    }
  }, { capture: true, passive: true })
  void describe
}

function useDebugEvents() {
  const [list, setList] = useState(events)
  useEffect(() => {
    listeners.push(setList)
    return () => {
      listeners = listeners.filter((x) => x !== setList)
    }
  }, [])
  return list
}

// HUD hidden in production. Flip RENDER_HUD to true to bring it back.
const RENDER_HUD = false

export function DebugHud() {
  const list = useDebugEvents()
  if (!RENDER_HUD) return null
  return (
    <div className="debug-hud" aria-hidden="true">
      <div className="debug-hud__title">DEBUG</div>
      {list.map((ev, i) => (
        <div key={i} className="debug-hud__row">
          [{ev.t}] {ev.msg}
        </div>
      ))}
      {list.length === 0 && (
        <div className="debug-hud__row debug-hud__row--muted">no events yet</div>
      )}
    </div>
  )
}
