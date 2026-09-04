import { useEffect, useState } from 'react'
import './PixelShift.css'

// PixelShift - burn-in care. Moves the whole view by a pixel or two on an
// irregular timer with an eased transition, so a clock face or a panel edge
// never sits on the same pixels all evening. Irregular timing on purpose: a
// fixed interval settles into its own pattern.
//
// Off (the default): children render bare, so the existing views are
// unaffected byte for byte until the setting is turned on.
const MAX_PX = 2
const MIN_MS = 60_000
const MAX_MS = 180_000

function randomOffset() {
  return Math.round((Math.random() * 2 - 1) * MAX_PX)
}

export default function PixelShift({ enabled, children }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    let cancelled = false
    function schedule() {
      const delay = MIN_MS + Math.random() * (MAX_MS - MIN_MS)
      timer = setTimeout(() => {
        if (cancelled) return
        setOffset({ x: randomOffset(), y: randomOffset() })
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled])

  if (!enabled) return children
  return (
    <div
      className="pixel-shift"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {children}
    </div>
  )
}
