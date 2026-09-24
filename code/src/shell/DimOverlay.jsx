// DimOverlay - full-screen black layer.
//
// Since hardware dimming landed this is a FALLBACK, not the primary dimmer.
// When `hardwareDim` is true the Pi already lowered the real backlight over
// DDC/CI, so the overlay stays fully transparent - painting it as well would
// double-dim. When DDC is unavailable or disabled it reverts to the original
// behavior: opacity = 1 - brightness.
//
// 'off' is opaque black regardless. The backlight is floored rather than zeroed
// (see DDC_MIN_BRIGHTNESS), so the overlay is what guarantees a black screen -
// belt and braces, and it stays recoverable by touch.
//
// pointerEvents:
//   - awake -> 'none' so the overlay (even if visible as a tint) lets
//     touches pass through to the underlying view normally.
//   - dim/off -> 'auto' so the wake-tap is absorbed by the overlay
//     rather than punching through to whatever's underneath (which would
//     cause an accidental button press / menu pop on wake). The
//     document-level capture-phase listener in useDisplaySchedule fires
//     BEFORE the overlay swallows the event, so wake still works.
//   - just woken -> still 'auto' until the waking tap's click lands here
//     (1 s at most). useDisplaySchedule flips to 'awake' on pointerdown, so
//     without this hold the overlay let go mid-tap and the tap's pointerup
//     and click reached the app anyway: the menu pill popped on every wake
//     (verified 2026-09-24). The held click also stops here instead of
//     bubbling to .app-shell.
//
// nightFace ('black' | 'clock', default 'black') picks what 'off' shows. The
// kitchen stays black. The Echo defaults to 'clock': with no panel to power
// down, it keeps the page alive all night and shows a faint drifting clock
// (NightClock) inside this same opaque layer, so the wake tap still lands here.
//
// Offsets are spelled out rather than `inset: 0`: inline styles are not
// lowered by the build, and Silk on the Echo may be older than Chrome 87,
// where `inset` is simply ignored and this layer would cover nothing.

import { useEffect, useState } from 'react'
import NightClock from './NightClock.jsx'

// Longest a wake gesture can take to finish with a click (a drag or a long
// press never sends one).
const WAKE_HOLD_MS = 1000

export default function DimOverlay({
  actualMode, wakeBrightness, eveningBrightness, hardwareDim, nightFace = 'black',
}) {
  let opacity = 0
  if (actualMode === 'off') {
    opacity = 1                       // always, DDC or not
  } else if (hardwareDim) {
    opacity = 0                       // the backlight already did it
  } else if (actualMode === 'awake') {
    opacity = Math.max(0, Math.min(1, 1 - wakeBrightness))
  } else if (actualMode === 'dim') {
    opacity = Math.max(0, Math.min(1, 1 - eveningBrightness))
  }

  // Leaving dim/off: the tap that woke us is still in progress, so keep
  // catching it until its click arrives (adjust-state-on-prop-change pattern).
  const [prevMode, setPrevMode] = useState(actualMode)
  const [holdWake, setHoldWake] = useState(false)
  if (prevMode !== actualMode) {
    setPrevMode(actualMode)
    setHoldWake(prevMode !== 'awake' && actualMode === 'awake')
  }
  useEffect(() => {
    if (!holdWake) return undefined
    const id = setTimeout(() => setHoldWake(false), WAKE_HOLD_MS)
    return () => clearTimeout(id)
  }, [holdWake])

  function onClick(e) {
    if (!holdWake) return
    e.stopPropagation()
    setHoldWake(false)
  }

  const captureTouches = actualMode !== 'awake' || holdWake
  const showClock = actualMode === 'off' && nightFace === 'clock'

  return (
    <div
      aria-hidden="true"
      onClick={onClick}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        background: '#000',
        opacity,
        transition: 'opacity 800ms ease-in-out',
        pointerEvents: captureTouches ? 'auto' : 'none',
        zIndex: 9000,
      }}
    >
      {showClock && <NightClock />}
    </div>
  )
}
