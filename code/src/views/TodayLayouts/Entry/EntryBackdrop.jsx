import { useMemo, useState } from 'react'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import { adaptiveDim, backdropLuma } from '../lib/backdropLuma.js'

// EntryBackdrop - what sits behind the Entry board when it has photos
// (display.entryBackdrop 'photos', EntryLayout.jsx), bottom to top: the
// slideshow, full bleed; a black wash; Ambient's scrim across the lower third.
// docs/designs/entry-board.md, phase 1.5 "Backdrop legibility".
//
// The wash is the screen's darkness (display.entryDim, 0..0.9). With
// display.entryAdaptive on (the default) it follows each photo: PhotoPanel
// measures the photo as it comes on (onLuma, lib/lumaSampler.js), and the wash
// moves around the screen's darkness by how bright that photo is behind the
// board's two text columns, which come from the boxes actually drawn (panels:
// the day part's visible panels, handed down by SpecBoard; lib/backdropLuma.js
// has the rule and its constants). The change eases over the photo crossfade's
// own 1.2 s (EntryLayout.css), so the two move together and nothing jumps.
// Adaptive off, or a photo that could not be measured: the screen's darkness,
// exactly as in phase 1.
//
// While adaptive, the wash carries what it measured and chose (data-dim,
// data-luma: the text columns' luma, and data-luma-left / -right / -whole), for
// a look from the console or the verification harness.

export default function EntryBackdrop({ photos, intervalMs, count, dim, adaptive, panels }) {
  const [sample, setSample] = useState(null)
  const luma = useMemo(() => (adaptive ? backdropLuma(sample, panels) : null), [adaptive, sample, panels])
  const shownDim = luma ? adaptiveDim(dim, luma.text) : dim

  return (
    <>
      <div className="tl-entry__photo">
        {/* photos keeps its identity between ticks, which is what lets
          * PhotoPanel's memo hold through the 1 Hz re-render; setSample is
          * stable too. */}
        <PhotoPanel
          photos={photos}
          intervalMs={intervalMs}
          count={count}
          fit="cover"
          showCounter={false}
          showCaption={false}
          onLuma={adaptive ? setSample : undefined}
        />
      </div>
      <div
        className={`tl-entry__dim${adaptive ? ' tl-entry__dim--adaptive' : ''}`}
        style={{ opacity: shownDim }}
        aria-hidden="true"
        data-dim={luma ? shownDim : undefined}
        data-luma={luma ? luma.text : undefined}
        data-luma-left={luma && luma.left != null ? luma.left : undefined}
        data-luma-right={luma && luma.right != null ? luma.right : undefined}
        data-luma-whole={luma ? luma.whole : undefined}
      />
      <div className="tl-entry__scrim" aria-hidden="true" />
    </>
  )
}
