import useTodayData from '../data/useTodayData.js'
import SpecBoard from './SpecBoard.jsx'
import EntryBackdrop from './EntryBackdrop.jsx'
import { ENTRY_LAYOUT_ID } from '../layoutSpec.js'
import { baseDim } from '../lib/backdropLuma.js'
import { useEditDisplay } from '../editBridge.js'
import './EntryLayout.css'

// EntryLayout - the front-door board (docs/designs/entry-board.md): what the
// family used to glance at on the DAKboard by the door, rebuilt from panels.
//
// Drawn from a layout spec (layoutSpec.js, docs/designs/layout-editor.md) by
// SpecBoard: every panel is a box at a percent position, so the same board
// fits the 1920x1080 Echo Show 15 and the 1280x800 Echo Show 10. The spec is
// this screen's own (config.layouts.entry on the hub) or, when it has none,
// DEFAULT_ENTRY_SPEC, which is the phase 1 board:
//
//   clock + long date          | weather now, what to wear, air quality
//   the headline               |
//   agenda: today, tomorrow,   | countdown tiles (the departure panel
//   the day after              |   instead during a school morning)
//
// A spec may carry day-part variants (morning, evening, weekend); SpecBoard
// draws the one the clock picks, or the one the layout editor previews.
//
// Behind it, per screen (display.entryBackdrop): the slideshow under a black
// wash plus Ambient's bottom scrim (EntryBackdrop), or plain black. The wash
// is display.entryDim, adapted to each photo unless display.entryAdaptive is
// false. The backdrop is a screen setting, not part of the spec; in the layout
// editor its draft backdrop and darkness win until saved. Bare text on the
// photo (the clock and the headline by default) also gets a scrim of its own:
// the spec's universal `scrim`, drawn by SpecBoard.
//
// Like every layout here, the only data access is the one useTodayData() call.

const SLIDESHOW_MIN_MS = 15_000
const SLIDESHOW_MAX_MS = 10 * 60_000
const PHOTO_COUNT = 24

// display.entryAdaptive: on unless the screen says false.
function entryAdaptive(v) {
  return v !== false
}

// The screen's own slideshow cadence, bounded as in Ambient: under 15 s a
// full-bleed crossfade never settles, over ten minutes it reads as frozen.
function slideshowIntervalMs(slideshow) {
  const raw = slideshow?.intervalMs
  return Math.min(
    SLIDESHOW_MAX_MS,
    Math.max(SLIDESHOW_MIN_MS, Number.isFinite(raw) ? raw : SLIDESHOW_MIN_MS)
  )
}

export default function EntryLayout() {
  const d = useTodayData()
  // The screen's backdrop settings; in the editor, its draft ones win.
  const display = d.settings?.display
  const displayDraft = useEditDisplay()
  const backdropSetting = displayDraft?.entryBackdrop ?? display?.entryBackdrop
  const backdrop = backdropSetting === 'black' ? 'black' : 'photos'
  const dim = baseDim(displayDraft?.entryDim ?? display?.entryDim)
  const adaptive = entryAdaptive(display?.entryAdaptive)
  const intervalMs = slideshowIntervalMs(d.settings?.slideshow)

  return (
    <SpecBoard d={d} layoutId={ENTRY_LAYOUT_ID} className={`tl-root tl-entry tl-entry--${backdrop}`}>
      {backdrop === 'photos' &&
        (({ panels }) => (
          <EntryBackdrop
            photos={d.photos.photos}
            intervalMs={intervalMs}
            count={PHOTO_COUNT}
            dim={dim}
            adaptive={adaptive}
            panels={panels}
          />
        ))}
    </SpecBoard>
  )
}
