// DimOverlay - full-screen black layer that implements all three display
// modes via opacity. 'off' is full opaque, 'dim' is partial, 'awake' is
// the user-tunable wake brightness (still partial-opacity if the user has
// dialed wakeBrightness below 100%).
//
// pointerEvents:
//   - awake -> 'none' so the overlay (even if visible as a tint) lets
//     touches pass through to the underlying view normally.
//   - dim/off -> 'auto' so the wake-tap is absorbed by the overlay
//     rather than punching through to whatever's underneath (which would
//     cause an accidental button press / menu pop on wake). The
//     document-level capture-phase listener in useDisplaySchedule fires
//     BEFORE the overlay swallows the event, so wake still works.

export default function DimOverlay({ actualMode, wakeBrightness, eveningBrightness }) {
  let opacity = 0
  if (actualMode === 'awake') {
    opacity = Math.max(0, Math.min(1, 1 - wakeBrightness))
  } else if (actualMode === 'dim') {
    opacity = Math.max(0, Math.min(1, 1 - eveningBrightness))
  } else if (actualMode === 'off') {
    opacity = 1
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
