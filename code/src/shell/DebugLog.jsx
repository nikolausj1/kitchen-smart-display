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
  window.addEventListener(
    'pointerdown',
    (e) => {
      const t = e.target
      const tag = t.tagName || '?'
      let cls = ''
      if (t.className) {
        if (typeof t.className === 'string') cls = t.className
        else if (t.className.baseVal) cls = t.className.baseVal // SVGAnimatedString
      }
      cls = String(cls).split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      const interactive = !!(t.closest && t.closest('button, a, [data-interactive="true"]'))
      logEvent(`PTR ${tag}${cls ? '.' + cls : ''} ${e.clientX | 0},${e.clientY | 0} int=${interactive}`)
    },
    { capture: true, passive: true }
  )
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

export function DebugHud() {
  const list = useDebugEvents()
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
