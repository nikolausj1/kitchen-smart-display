import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import { useView } from '../shell/ViewContext.jsx'

// Timer state machine for the Today view countdown panel.
// See Smart Displays.md "Today view interactions / Timer states" for the
// full behavior contract. All tunable values come from Settings.

const POST_EXPIRY_LIFETIME_MS = 15 * 60 * 1000

function isoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function departureTimeFor(school, travelMode, baseDate) {
  const { hour, minute } =
    travelMode === 'walking' ? school.walkingDepart : school.drivingDepart
  const d = new Date(baseDate)
  d.setHours(hour, minute, 0, 0)
  return d
}

function colourBandForMinutes(minutesLeft, t) {
  if (minutesLeft <= t.orangeAbove) return 'red'
  if (minutesLeft <= t.yellowAbove) return 'orange'
  if (minutesLeft <= t.greenAbove) return 'yellow'
  return 'green'
}

export default function useTimer() {
  const { school, timerThresholds } = useSettings()
  const { setView } = useView()

  const [state, setState] = useState({
    mode: 'no-timer',
    kind: null,
    target: null,
    travelMode: 'driving',
    dismissedDate: null,
    autoArmedDate: null,
    noTimerEnteredAt: Date.now(),
  })

  // Tick once a second.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])

  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const now = new Date()
    const today = isoDate(now)
    const s = stateRef.current

    if (s.dismissedDate && s.dismissedDate !== today) {
      setState((prev) => ({ ...prev, dismissedDate: null, autoArmedDate: null }))
      return
    }

    // Auto-arm default timer on weekday mornings.
    if (
      s.mode === 'no-timer' &&
      s.dismissedDate !== today &&
      s.autoArmedDate !== today &&
      school.schoolDays.includes(now.getDay())
    ) {
      const autoShowStart = new Date(now)
      autoShowStart.setHours(school.autoShowAt.hour, school.autoShowAt.minute, 0, 0)
      const target = departureTimeFor(school, s.travelMode, now)
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

    // Post-expiry: revert to no-timer (Photos handoff disabled for now).
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
    void setView
  })

  // --- Actions ---

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
          target: departureTimeFor(school, next, new Date()),
        }
      }
      return { ...prev, travelMode: next }
    })
  }, [school])

  // --- Derived view-model ---

  const now = new Date()
  let minutesLeft = null
  let band = null
  if (state.mode === 'active' && state.target) {
    const msLeft = state.target.getTime() - now.getTime()
    minutesLeft = Math.max(0, Math.ceil(msLeft / 60_000))
    band = colourBandForMinutes(minutesLeft, timerThresholds)
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
