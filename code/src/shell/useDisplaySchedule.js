import { useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import { KIOSK_TV } from '../lib/kioskMode.js'

// useDisplaySchedule - night-mode state machine for the kiosk.
//
// Two layers of mode:
//   scheduledMode = what the schedule says we SHOULD be in right now
//                   ('awake' | 'dim' | 'off'), derived from settings + clock.
//   actualMode    = what we ARE in. Equal to scheduledMode normally, but
//                   diverges to 'awake' when the user touches the screen
//                   during a dim or off window. The override holds until
//                   the NEXT scheduled transition fires (per user choice).
//
// On every scheduled transition we resync actualMode to scheduledMode.
// This makes "wake until next transition" trivially correct without needing
// to track a wake timestamp.
//
// 'off' powers the panel down for real (VCP D6 standby), verified 2026-08-18:
// touch still reaches /dev/input while the glass is dark, because D6 darkens the
// PANEL and leaves the Pi's output enabled - so the compositor keeps delivering
// events and the touch-to-wake path below works unchanged.
//
// Dimming drives the panel's REAL backlight over DDC/CI: each mode change
// POSTs a target to the Pi's /api/display/brightness, which shells out to
// `ddcutil setvcp 10`. The CSS overlay (DimOverlay) is now the FALLBACK - it
// re-engages only when DDC reports failure, so we never double-dim - plus the
// guaranteed-black layer for 'off'.
//
// Real DPMS off via /api/display/off is still rejected: wlroots stops
// delivering input events to clients when the output is fully disabled, which
// breaks touch-to-wake. `setvcp 10` only lowers the backlight and leaves the
// output enabled, which is exactly why it is safe here where DPMS was not.

// Convert {hour, minute} -> minutes since midnight.
function timeToMin(t) {
  if (!t) return 0
  return (t.hour | 0) * 60 + (t.minute | 0)
}

// Decide which scheduled mode a given clock minute should be in.
// The day is divided into three windows by dimAt, offAt, wakeAt.
// Handles wrap-around (offAt at midnight, wakeAt in the morning).
//
// Conceptually: walk the three transition events in chronological order
// starting from "right now," go backwards to find the most recent one, and
// that determines current mode.
function modeAtMinute(now, dim, off, wake) {
  // Build sorted list of (minute, modeAfter) events. modeAfter is what
  // mode we ENTER when this event fires.
  const events = [
    { at: dim, mode: 'dim' },
    { at: off, mode: 'off' },
    { at: wake, mode: 'awake' },
  ].sort((a, b) => a.at - b.at)

  // Find the latest event whose time is <= now.
  let mode = events[events.length - 1].mode // default = whichever wraps from yesterday
  for (const e of events) {
    if (e.at <= now) mode = e.mode
  }
  return mode
}

// Matches DDC_MIN_BRIGHTNESS in pi/kiosk-server.py. Never 0: 'off' is the
// overlay's job, and a backlight floored at 1 stays recoverable by touch.
const HW_MIN_BRIGHTNESS = 1

function backlightFor(mode, wakeBrightness, eveningBrightness) {
  const pct = (f) => Math.max(HW_MIN_BRIGHTNESS, Math.min(100, Math.round(f * 100)))
  if (mode === 'awake') return pct(wakeBrightness)
  if (mode === 'dim') return pct(eveningBrightness)
  return HW_MIN_BRIGHTNESS
}

export default function useDisplaySchedule() {
  const settings = useSettings()
  const dim = settings.display?.dimAt
  const off = settings.display?.offAt
  const wake = settings.display?.wakeAt
  const wakeBrightness = settings.display?.wakeBrightness ?? 0.9
  const eveningBrightness = settings.display?.eveningBrightness ?? 0.4
  // One-tap escape hatch back to overlay-only if the panel ever misbehaves.
  const hardwareDimEnabled = settings.display?.hardwareDim !== false
  const hardwarePowerOff = settings.display?.hardwarePowerOff !== false

  const dimMin = timeToMin(dim)
  const offMin = timeToMin(off)
  const wakeMin = timeToMin(wake)

  // Recompute scheduled mode every minute (and when settings change).
  // We also recompute right away on mount.
  const [scheduledMode, setScheduledMode] = useState(() => {
    const n = new Date()
    return modeAtMinute(n.getHours() * 60 + n.getMinutes(), dimMin, offMin, wakeMin)
  })

  useEffect(() => {
    function tick() {
      const n = new Date()
      const m = modeAtMinute(n.getHours() * 60 + n.getMinutes(), dimMin, offMin, wakeMin)
      setScheduledMode((prev) => (prev !== m ? m : prev))
    }
    tick()
    const id = setInterval(tick, 30 * 1000)
    return () => clearInterval(id)
  }, [dimMin, offMin, wakeMin])

  // actualMode tracks what the user actually sees. Equal to scheduled
  // unless overridden by a touch wake or a Sleep-now manual action.
  const [actualMode, setActualMode] = useState(scheduledMode)
  const lastScheduledRef = useRef(scheduledMode)

  // When the schedule transitions (e.g., dim -> off at midnight), resync
  // actual to scheduled. This is how "wake until next transition" works -
  // a manual wake holds, but the very next schedule event takes over.
  useEffect(() => {
    if (scheduledMode !== lastScheduledRef.current) {
      lastScheduledRef.current = scheduledMode
      setActualMode(scheduledMode)
    }
  }, [scheduledMode])

  // Touch wake: while in dim or off, the first user gesture wakes the
  // screen. Listen at the document level on the capture phase so we don't
  // care what child handlers do with the event. Only the WAKE behavior is
  // wired here - the underlying gesture (e.g., a button tap) still flows.
  useEffect(() => {
    if (actualMode === 'awake') return
    function onWake() {
      setActualMode('awake')
    }
    const evs = ['pointerdown', 'keydown']
    evs.forEach((e) =>
      document.addEventListener(e, onWake, { capture: true, passive: true })
    )
    return () => {
      evs.forEach((e) =>
        document.removeEventListener(e, onWake, { capture: true })
      )
    }
  }, [actualMode])

  // Imperative API for the "Sleep now" button in Settings. Triggered via
  // a window-level CustomEvent so SettingsView doesn't have to thread a
  // hook return through React context just for one button. SettingsView
  // dispatches 'display-sleep-now' and we react here.
  useEffect(() => {
    function onSleepNow() {
      setActualMode('off')
    }
    // Counterpart for the dashboard's wake button. The on-device path does not
    // need this - touching the screen already wakes it - but a remote caller
    // has no finger to offer.
    function onWakeNow() {
      setActualMode('awake')
    }
    window.addEventListener('display-sleep-now', onSleepNow)
    window.addEventListener('display-wake-now', onWakeNow)
    return () => {
      window.removeEventListener('display-sleep-now', onSleepNow)
      window.removeEventListener('display-wake-now', onWakeNow)
    }
  }, [])

  // Drive the real backlight on every mode change (and whenever the brightness
  // settings change). hardwareDim reports whether that actually worked, so the
  // overlay knows whether it still needs to do the dimming itself.
  const [hardwareDim, setHardwareDim] = useState(false)
  useEffect(() => {
    if (KIOSK_TV || !hardwareDimEnabled) {
      setHardwareDim(false)
      return undefined
    }
    let cancelled = false
    const value = backlightFor(actualMode, wakeBrightness, eveningBrightness)
    const wantOff = actualMode === 'off' && hardwarePowerOff

    // Relative URLs: the app bundle is still served by the Pi, so these reach
    // the same origin. (Photos moved to FrameServer; the app did not.)
    const post = (path, body) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !!(j && j.ok))
        .catch(() => false)

    ;(async () => {
      // Order matters. Waking first means the brightness write lands on a panel
      // that can actually show it; a write to a panel in standby is accepted
      // and invisible. On the way down, set the floor first, then cut power, so
      // the panel is already dark if the power write fails.
      if (!wantOff && hardwarePowerOff) await post('/api/display/power', { on: true })
      const ok = await post('/api/display/brightness', { value })
      if (wantOff) await post('/api/display/power', { on: false })
      if (!cancelled) setHardwareDim(ok)
    })()

    return () => { cancelled = true }
  }, [actualMode, wakeBrightness, eveningBrightness, hardwareDimEnabled, hardwarePowerOff])

  const api = useMemo(() => ({}), [])

  return {
    actualMode,
    scheduledMode,
    wakeBrightness,
    eveningBrightness,
    hardwareDim,
    ...api,
  }
}
