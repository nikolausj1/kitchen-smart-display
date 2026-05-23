import { useEffect, useState } from 'react'
import './DebugLog.css'

// Lightweight global event log + on-screen HUD for diagnosing the touch /
// click event flow on the kiosk. Drop calls to logEvent() at any interesting
// site (button clicks, menu open, navigation) and the last 8 events appear
// in the top-left corner of the screen.
//
// Intentionally module-level (singleton) so any component can publish
// without prop drilling. Remove the <DebugHud /> from AppShell when the
// kiosk is behaving and we no longer need it.

let listeners = []
let events = []

export function logEvent(msg) {
  const ev = { msg, t: new Date().toLocaleTimeString([], { hour12: false }) }
  events = [...events, ev].slice(-8)
  listeners.forEach((l) => l(events))
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
