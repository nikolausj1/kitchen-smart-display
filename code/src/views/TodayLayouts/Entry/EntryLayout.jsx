import useTodayData from '../data/useTodayData.js'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import SpecBoard from './SpecBoard.jsx'
import { ENTRY_LAYOUT_ID } from '../layoutSpec.js'
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
// Behind it, per screen (display.entryBackdrop): the slideshow darkened by a
// flat black wash at display.entryDim plus Ambient's bottom scrim, or plain
// black. The backdrop is a screen setting, not part of the spec; in the
// layout editor its draft backdrop wins until saved.
//
// Like every layout here, the only data access is the one useTodayData() call.

const SLIDESHOW_MIN_MS = 15_000
const SLIDESHOW_MAX_MS = 10 * 60_000
const PHOTO_COUNT = 24

const DIM_MAX = 0.9
const DIM_DEFAULT = 0.5

function entryDim(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DIM_DEFAULT
  return Math.min(DIM_MAX, Math.max(0, n))
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
  const dim = entryDim(displayDraft?.entryDim ?? display?.entryDim)
  const intervalMs = slideshowIntervalMs(d.settings?.slideshow)

  return (
    <SpecBoard d={d} layoutId={ENTRY_LAYOUT_ID} className={`tl-root tl-entry tl-entry--${backdrop}`}>
      {backdrop === 'photos' && (
        <>
          {/* d.photos.photos keeps its identity between ticks, which is what
            * lets PhotoPanel's memo hold through the 1 Hz re-render. */}
          <div className="tl-entry__photo">
            <PhotoPanel
              photos={d.photos.photos}
              intervalMs={intervalMs}
              count={PHOTO_COUNT}
              fit="cover"
              showCounter={false}
              showCaption={false}
            />
          </div>
          <div className="tl-entry__dim" style={{ opacity: dim }} aria-hidden="true" />
          <div className="tl-entry__scrim" aria-hidden="true" />
        </>
      )}
    </SpecBoard>
  )
}
