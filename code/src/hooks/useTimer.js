import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import { getHouseState, postCountdown, useHouseState } from '../lib/houseState.js'
import {
  dateKey,
  deriveCountdown,
  isNoSchoolToday,
  withCancel,
  withManualTime,
  withTravelToggle,
} from '../lib/countdown.js'
import { getCachedCalendar } from './useSchoolCalendar.js'

// useTimer - the Today view's morning countdown, shared by every screen.
//
// Since 2026-09-24 this is a view over the HOUSE countdown, not a per-screen
// state machine. Screens share only the user's decisions (lib/houseState.js:
// dismissed today, walk/drive override, manual target), and every screen
// derives the timer from them with the same pure function the hub runs for the
// Apple TV (deriveCountdown, frameserver/lib/countdown.mjs). Set, cancel or
// flip walk/drive on any screen and it applies everywhere within a poll. The
// old machine kept its own auto-arm and dismissed-date memory per screen, which
// is exactly what would have let the kitchen and the Echo disagree.
//
// Only the picker (set-timer) is local: opening it on one screen must not open
// it on another, and nothing is shared until DONE.
//
// Public shape unchanged: { mode, kind, travelMode, target, minutesLeft, band,
// actions: { cancel, enterSetTimer, exitSetTimer, confirmManualTimer,
// toggleTravel } }. See PRD - Smart Displays.md "Today view interactions /
// Timer states" for the behaviour contract.
//
// weatherDefaultMode is this screen's own walk/drive guess from its forecast.
// It is only a fallback now; the hub's travelDefault wins once it has answered.

export default function useTimer({ weatherDefaultMode } = {}) {
  const { school, timerThresholds } = useSettings()
  const house = useHouseState()
  const [pickerOpen, setPickerOpen] = useState(false)

  // Tick once a second. `now` lives in state rather than being read in the
  // render body, which keeps the render pure.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const today = dateKey(now)

  // Inputs. Once the hub has answered TODAY, its values win, even if that
  // answer is a few minutes old: every screen then derives from the same
  // inputs, and consistency beats freshness. Before that (first boot, or an
  // outage that began yesterday) use what this screen can work out alone: its
  // own forecast and the cached school calendar. "Today" matters because
  // noSchoolToday is a bare boolean - Sunday's answer, carried into Monday by a
  // hub that went down overnight, would silently suppress the school-day timer.
  const hubToday = house.fetchedAt != null && dateKey(new Date(house.fetchedAt)) === today
  const localTravelDefault = useMemo(
    () => (weatherDefaultMode ? { date: today, mode: weatherDefaultMode } : null),
    [today, weatherDefaultMode]
  )
  const travelDefault = hubToday ? house.travelDefault : localTravelDefault
  const noSchoolToday =
    hubToday && typeof house.noSchoolToday === 'boolean'
      ? house.noSchoolToday
      : isNoSchoolToday(school, getCachedCalendar(), now)

  const derived = deriveCountdown({
    now,
    school,
    decisions: house.countdown,
    travelDefault,
    noSchoolToday,
    thresholds: timerThresholds,
  })

  const mode = pickerOpen ? 'set-timer' : derived.mode

  // deriveCountdown builds a fresh Date every call. Hand out the same object
  // for as long as the target time is unchanged, so consumers memoising on it
  // (useTodayData) and the storage mirror below do not churn once a second.
  const targetMs = derived.target ? derived.target.getTime() : null
  const target = useMemo(() => (targetMs == null ? null : new Date(targetMs)), [targetMs])

  // --- Actions ---
  // Built from the LATEST decisions (getHouseState()), not the `house` this
  // render captured: a second tap before the re-render must build on the first
  // tap's optimistic write, not quietly undo it.
  const deriveAt = useCallback(
    (at) =>
      deriveCountdown({
        now: at,
        school,
        decisions: getHouseState().countdown,
        travelDefault,
        noSchoolToday,
        thresholds: timerThresholds,
      }),
    [school, travelDefault, noSchoolToday, timerThresholds]
  )

  // A default timer is dismissed for the day; a manual one is cleared.
  const cancel = useCallback(() => {
    const at = new Date()
    postCountdown(withCancel(getHouseState().countdown, deriveAt(at), at))
  }, [deriveAt])

  // Recorded as today's explicit override, so the weather default stops
  // fighting the choice for the rest of the day, on every screen.
  const toggleTravel = useCallback(() => {
    const at = new Date()
    postCountdown(withTravelToggle(getHouseState().countdown, deriveAt(at), at))
  }, [deriveAt])

  const enterSetTimer = useCallback(() => setPickerOpen(true), [])
  const exitSetTimer = useCallback(() => setPickerOpen(false), [])

  // A time earlier than now rolls to tomorrow (withManualTime).
  const confirmManualTimer = useCallback((hour12, minute, ampm) => {
    const at = new Date()
    postCountdown(withManualTime(getHouseState().countdown, hour12, minute, ampm, at))
    setPickerOpen(false)
  }, [])

  const actions = useMemo(
    () => ({ cancel, enterSetTimer, exitSetTimer, confirmManualTimer, toggleTravel }),
    [cancel, enterSetTimer, exitSetTimer, confirmManualTimer, toggleTravel]
  )

  // Mirror the current timer mode + target to localStorage so other parts
  // of the app (specifically the morning-end auto-leave watcher in
  // AppShell) can tell whether a timer is in flight when Today isn't
  // mounted. Updated on every change.
  useEffect(() => {
    try {
      localStorage.setItem('kioskTimerMode', mode || 'no-timer')
      if (target) {
        localStorage.setItem('kioskTimerTarget', target.toISOString())
      } else {
        localStorage.removeItem('kioskTimerTarget')
      }
    } catch {
      // no-op if storage unavailable
    }
  }, [mode, target])

  return {
    mode,
    kind: derived.kind,
    travelMode: derived.travelMode,
    target,   // absolute departure Date (or null)
    minutesLeft: derived.minutesLeft,
    band: derived.band,
    actions,
  }
}
