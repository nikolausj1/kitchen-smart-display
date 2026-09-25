import { useEffect, useState } from 'react'
import FlipClock from './FlipClock.jsx'
import '../tokens.css'
import './ClockLayout.css'

// ClockLayout - the flip clock Today: a split-flap clock and the date, centred
// on near-black, and nothing else. Built for the office Echo Show 5 (960x480)
// and good at 1280x800 and 1920x1080. A bright daytime view: no seconds, no
// drift (the night face is a different screen).
//
// The one departure from the other layouts: no useTodayData(). That hook runs
// every data source the Today screens have (weather, Sonos, the photo
// manifest, lunch, calendars, house state), and a clock needs none of them; on
// an Echo Show 5 that is real polling and parsing for nothing. The clock here
// wakes once a minute, a hair after the boundary, so a flip lands on the
// minute rather than up to a second late, and the tree renders once a minute
// instead of 60 times. FlipClock itself only takes `now`, so a layout that
// does call useTodayData() can hand it d.now just the same.

const MINUTE_MS = 60_000
// Wake just after the boundary, never on it: a timer that fired a moment early
// would read the old minute and the flip would wait a whole extra minute.
const WAKE_SLACK_MS = 30

function msToNextMinute(d) {
  return MINUTE_MS - (d.getTime() % MINUTE_MS) + WAKE_SLACK_MS
}

// A Date that changes at each minute boundary. new Date() only in the state
// initialiser and the effect, never in render (the React Compiler purity rule).
// Re-reads the clock when the page comes back into view, since a hidden page's
// timers are throttled and a screen woken from sleep should not show a stale
// minute until the next wake.
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer = 0
    const tick = () => {
      const d = new Date()
      setNow(d)
      clearTimeout(timer)
      timer = setTimeout(tick, msToNextMinute(d))
    }
    timer = setTimeout(tick, msToNextMinute(new Date()))

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}

export default function ClockLayout() {
  const now = useMinuteClock()

  return (
    <div className="tl-root tl-clock">
      <FlipClock now={now} />
    </div>
  )
}
