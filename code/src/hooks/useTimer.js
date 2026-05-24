import { useCallback, useEffect, useRef, useState } from 'react'
import { SCHOOL, TIMER_THRESHOLDS } from '../config.js'
import { useView } from '../shell/ViewContext.jsx'

// Timer state machine for the Today view countdown panel.
//
// Three visible modes:
//   - 'active'    : counting down to a target time, colour-banded by minutes left
//   - 'no-timer'  : the dark "NO TIMER" / SET state
//   - 'set-timer' : the picker for manually entering a target time
//
// Two kinds of active timers:
//   - 'default' : auto-armed weekday morning timer, shows driving/walking toggle
//   - 'manual'  : set by the user via the picker, no travel toggle
//
// Auto-arm: on weekday mornings (Mon-Fri) between 6:00 AM and 15 minutes after
// the configured departure time, the default timer arms itself once per day.
// If the user cancels (X) the default timer, the day is marked dismissed and
// the timer will not re-arm until tomorrow.
//
// View handoffs (spec):
//   - Active timer + 15 min past expiry  -> navigate to Photo Slideshow
//   - No-timer state + 15 min no interaction -> navigate to Photo Slideshow
// User interactions inside the timer (cancel, toggle, picker) reset the
// no-timer idle clock by virtue of changing mode.

const POST_EXPIRY_LIFETIME_MS = 15 * 60 * 1000
const NO_TIMER_IDLE_MS = 15 * 60 * 1000

function isoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isSchoolDay(date) {
  return SCHOOL.schoolDays.includes(date.getDay())
}

function departureTimeFor(travelMode, baseDate) {
  const { hour, minute } =
    travelMode === 'walking' ? SCHOOL.walkingDepart : SCHOOL.drivingDepart
  const d = new Date(baseDate)
  d.setHours(hour, minute, 0, 0)
  return d
}

function colourBandForMinutes(minutesLeft) {
  if (minutesLeft <= TIMER_THRESHOLDS.orangeAbove) return 'red'
  if (minutesLeft <= TIMER_THRESHOLDS.yellowAbove) return 'orange'
  if (minutesLeft <= TIMER_THRESHOLDS.greenAbove) return 'yellow'
  return 'green'
}

export default function useTimer() {
  const { setView } = useView()

  // Persistent state across renders.
  const [state, setState] = useState({
    mode: 'no-timer',
    kind: null, // 'default' | 'manual' | null
    target: null, // Date | null
    travelMode: 'driving',
    dismissedDate: null,
    autoArmedDate: null,
    // Used to drive the 15-min idle handoff while in 'no-timer'.
    noTimerEnteredAt: Date.now(),
  })

  // Tick once a second so derived state (minutesLeft, expired flag, idle
  // check) updates without us having to wire individual setIntervals.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])

  // Auto-arm + view handoffs. Runs every tick.
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const now = new Date()
    const today = isoDate(now)
    const s = stateRef.current

    // Reset dismissedDate when the day rolls over so tomorrow can auto-arm.
    if (s.dismissedDate && s.dismissedDate !== today) {
      setState((prev) => ({ ...prev, dismissedDate: null, autoArmedDate: null }))
      return
    }

    // Auto-arm the default timer on weekday mornings.
    if (
      s.mode === 'no-timer' &&
      s.dismissedDate !== today &&
      s.autoArmedDate !== today &&
      isSchoolDay(now)
    ) {
      const autoShowStart = new Date(now)
      autoShowStart.setHours(SCHOOL.autoShowAt.hour, SCHOOL.autoShowAt.minute, 0, 0)
      const target = departureTimeFor(s.travelMode, now)
      const dropoff = new Date(target.getTime() + POST_EXPIRY_LIFETIME_MS)
      if (now >= autoShowStart && now <= dropoff) {
        setState((prev) => ({
          ...prev,
          mode: 'active',
          kind: 'default',
          target,
          autoArmedDate: today,
        }))
        return
      }
    }

    // Auto view handoffs disabled while we stabilize navigation. The state
    // machine still tracks expiry/idle internally; we just do not navigate.
    // Re-enable by uncommenting the setView calls below.
    if (s.mode === 'active' && s.target) {
      const past = now.getTime() - s.target.getTime()
      if (past > POST_EXPIRY_LIFETIME_MS) {
        setState((prev) => ({
          ...prev,
          mode: 'no-timer',
          kind: null,
          target: null,
          dismissedDate: prev.kind === 'default' ? today : prev.dismissedDate,
          noTimerEnteredAt: Date.now(),
        }))
        // setView('photos')
        return
      }
    }
    // if (s.mode === 'no-timer' && s.noTimerEnteredAt) {
    //   const idle = now.getTime() - s.noTimerEnteredAt
    //   if (idle > NO_TIMER_IDLE_MS) setView('photos')
    // }
    void NO_TIMER_IDLE_MS
    void setView
  })

  // --- Actions --------------------------------------------------------------
  // Any state-changing action resets noTimerEnteredAt when leaving no-timer,
  // and stamps it fresh when entering no-timer.

  const cancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      mode: 'no-timer',
      kind: null,
      target: null,
      dismissedDate: prev.kind === 'default' ? isoDate(new Date()) : prev.dismissedDate,
      noTimerEnteredAt: Date.now(),
    }))
  }, [])

  const enterSetTimer = useCallback(() => {
    setState((prev) => ({ ...prev, mode: 'set-timer' }))
  }, [])

  const exitSetTimer = useCallback(() => {
    setState((prev) => ({
      ...prev,
      mode: 'no-timer',
      noTimerEnteredAt: Date.now(),
    }))
  }, [])

  const confirmManualTimer = useCallback((hour12, minute, ampm) => {
    let hour24 = hour12 % 12
    if (ampm === 'PM') hour24 += 12
    const now = new Date()
    const target = new Date(now)
    target.setHours(hour24, minute, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    setState((prev) => ({
      ...prev,
      mode: 'active',
      kind: 'manual',
      target,
    }))
  }, [])

  const toggleTravel = useCallback(() => {
    setState((prev) => {
      const next = prev.travelMode === 'driving' ? 'walking' : 'driving'
      if (prev.mode === 'active' && prev.kind === 'default') {
        return {
          ...prev,
          travelMode: next,
          target: departureTimeFor(next, new Date()),
        }
      }
      return { ...prev, travelMode: next }
    })
  }, [])

  // --- Derived view-model --------------------------------------------------

  const now = new Date()
  let minutesLeft = null
  let band = null
  if (state.mode === 'active' && state.target) {
    const msLeft = state.target.getTime() - now.getTime()
    minutesLeft = Math.max(0, Math.ceil(msLeft / 60_000))
    band = colourBandForMinutes(minutesLeft)
  }

  return {
    mode: state.mode,
    kind: state.kind,
    travelMode: state.travelMode,
    minutesLeft,
    band,
    actions: {
      cancel,
      enterSetTimer,
      exitSetTimer,
      confirmManualTimer,
      toggleTravel,
    },
  }
}
