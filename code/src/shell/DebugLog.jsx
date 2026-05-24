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

  // Workaround for Chromium + labwc + wl_touch on this Pi: the browser
  // delivers touch events but does NOT synthesize a normal click chain.
  // We dispatch the click ourselves on touchend.
  //
  // The SiS touch controller fires several touchend events per single
  // finger contact (~14 in ~700 ms observed). They all share the same
  // touch.identifier because it's still the same touch session, so we
  // deduplicate by identifier rather than by a global time window. That
  // way two separate quick taps (different identifiers) both register.
  // No synthetic click dispatch here - now that the touch device produces
  // clean events, Chromium handles touchstart -> click natively. The CLK
  // listener above will log them so we can verify.
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
