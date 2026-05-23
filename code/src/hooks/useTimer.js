import { useCallback, useEffect, useRef, useState } from 'react'
import { SCHOOL, TIMER_THRESHOLDS } from '../config.js'

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
// Expiry handoff to Photo Slideshow is deferred (Photos view does not exist
// yet) - for Phase 1, an expired timer auto-resets to no-timer after 15
// minutes so the screen does not get stuck on LEAVE NOW indefinitely.

const POST_EXPIRY_LIFETIME_MS = 15 * 60 * 1000

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
  // Persistent state across renders.
  const [state, setState] = useState({
    mode: 'no-timer',
    kind: null, // 'default' | 'manual' | null
    target: null, // Date | null
    travelMode: 'driving', // tracked even outside default timer for next morning
    dismissedDate: null, // ISO date string the user cancelled today's default
    autoArmedDate: null, // ISO date we already auto-armed today
  })

  // Tick - used to recompute minutesLeft and drive the auto-arm check.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])

  // Auto-arm + post-expiry handoff. Runs every tick (cheap).
  // Use a ref to read the latest state without re-creating the effect.
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

    // Post-expiry handoff for active timers: 15 min after target, fall back to
    // no-timer (Photo Slideshow will replace this once it exists).
    if (s.mode === 'active' && s.target) {
      const past = now.getTime() - s.target.getTime()
      if (past > POST_EXPIRY_LIFETIME_MS) {
        setState((prev) => ({
          ...prev,
          mode: 'no-timer',
          kind: null,
          target: null,
          // Default timers count as "dismissed" so we do not immediately re-arm.
          dismissedDate: prev.kind === 'default' ? today : prev.dismissedDate,
        }))
      }
    }
  })

  // --- Actions --------------------------------------------------------------

  const cancel = useCallback(() => {
    setState((prev) => ({
      ...prev,
      mode: 'no-timer',
      kind: null,
      target: null,
      // If they cancel a default timer, mark today dismissed.
      dismissedDate: prev.kind === 'default' ? isoDate(new Date()) : prev.dismissedDate,
    }))
  }, [])

  const enterSetTimer = useCallback(() => {
    setState((prev) => ({ ...prev, mode: 'set-timer' }))
  }, [])

  const exitSetTimer = useCallback(() => {
    setState((prev) => ({ ...prev, mode: 'no-timer' }))
  }, [])

  const confirmManualTimer = useCallback((hour12, minute, ampm) => {
    let hour24 = hour12 % 12
    if (ampm === 'PM') hour24 += 12
    const now = new Date()
    const target = new Date(now)
    target.setHours(hour24, minute, 0, 0)
    // If selected time is in the past, treat it as tomorrow's same time.
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
      // If the default timer is active, also recompute its target.
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
    // Ceil so "1 second left" still reads as "1 MIN", not "0 MIN".
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
