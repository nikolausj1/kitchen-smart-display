import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './NightClock.css'

// NightClock - the faint night face (display.nightFace === 'clock').
//
// DimOverlay renders it while the schedule is in its 'off' window. The goal is
// a clock you can read from bed in a dark room that does not light the room:
// #3a3a3a on black is visible in the dark and effectively invisible from across
// a lit room. Every minute, with the new time, the block drifts to a random
// spot in the central 60% of the screen (2 s ease) so nothing sits still long
// enough to mark the panel.
//
// Purely visual: aria-hidden and pointer-events none. The overlay it sits in
// still catches the wake tap.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Short months on purpose. At half the time's size, "Wednesday, September 30"
// is about 85% of a 1280 px screen: it dwarfs the time and leaves the drift
// almost no room. "Wednesday, Sep 30" keeps the block near the time's width.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The block's center lands in the central DRIFT_SPAN of each axis, then the
// block is clamped to stay on screen with a small margin.
const DRIFT_SPAN = 0.6
const EDGE_MARGIN = 0.03

function format(d) {
  const h = d.getHours()
  return {
    time: `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`,
    ampm: h < 12 ? 'am' : 'pm',
    date: `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`,
  }
}

function pickCenter() {
  const lo = (1 - DRIFT_SPAN) / 2
  return { fx: lo + Math.random() * DRIFT_SPAN, fy: lo + Math.random() * DRIFT_SPAN }
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi))

// Translate the block so its center sits at `center` (fractions of the
// screen), kept fully on screen. `animate` false jumps without the 2 s glide.
function position(el, center, animate) {
  const box = el.parentElement
  const vw = box ? box.clientWidth : window.innerWidth
  const vh = box ? box.clientHeight : window.innerHeight
  const bw = el.offsetWidth
  const bh = el.offsetHeight
  const m = Math.min(vw, vh) * EDGE_MARGIN
  const x = Math.round(clamp(vw * center.fx - bw / 2, m, vw - bw - m))
  const y = Math.round(clamp(vh * center.fy - bh / 2, m, vh - bh - m))
  const transform = `translate(${x}px, ${y}px)`
  if (animate) {
    el.style.transform = transform
    return
  }
  el.style.transition = 'none'
  el.style.transform = transform
  void el.offsetWidth // commit the jump before the transition comes back
  el.style.transition = ''
}

export default function NightClock() {
  const [now, setNow] = useState(() => new Date())
  const blockRef = useRef(null)
  const centerRef = useRef(null)
  const placedMinuteRef = useRef(null)

  // Tick on the minute boundary, re-aimed each time so it never drifts.
  useEffect(() => {
    let id
    const schedule = () => {
      const d = new Date()
      const ms = 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 30
      id = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, ms)
    }
    schedule()
    return () => clearTimeout(id)
  }, [])

  const minute = Math.floor(now.getTime() / 60000)

  // Every new minute: a new spot. The first placement is centered and jumps;
  // later ones glide. A re-run for a minute already placed (StrictMode in dev)
  // only re-measures.
  useLayoutEffect(() => {
    const el = blockRef.current
    if (!el) return
    if (placedMinuteRef.current === minute && centerRef.current) {
      position(el, centerRef.current, false)
      return
    }
    const first = centerRef.current == null
    placedMinuteRef.current = minute
    centerRef.current = first ? { fx: 0.5, fy: 0.5 } : pickCenter()
    position(el, centerRef.current, !first)
  }, [minute])

  // Re-clamp the current spot when the block or the screen changes size: the
  // first measure can happen before Inter has loaded.
  useEffect(() => {
    let alive = true
    const again = () => {
      if (alive && blockRef.current && centerRef.current) {
        position(blockRef.current, centerRef.current, false)
      }
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(again).catch(() => {})
    window.addEventListener('resize', again)
    return () => {
      alive = false
      window.removeEventListener('resize', again)
    }
  }, [])

  const { time, ampm, date } = format(now)

  return (
    <div className="night-clock" aria-hidden="true">
      <div ref={blockRef} className="night-clock__block">
        <div className="night-clock__time">
          <span>{time}</span>
          <span className="night-clock__ampm">{ampm}</span>
        </div>
        <div className="night-clock__date">{date}</div>
      </div>
    </div>
  )
}
