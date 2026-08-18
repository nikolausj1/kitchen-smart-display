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

export default function DimOverlay({
  actualMode, wakeBrightness, eveningBrightness, hardwareDim,
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

  const captureTouches = actualMode !== 'awake'

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        opacity,
        transition: 'opacity 800ms ease-in-out',
        pointerEvents: captureTouches ? 'auto' : 'none',
        zIndex: 9000,
      }}
    />
  )
}
