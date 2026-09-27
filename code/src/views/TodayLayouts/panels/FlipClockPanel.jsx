import { useRef } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FlipClock from '../Clock/FlipClock.jsx'
import useBoxSize from './useBoxSize.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { flipFit, flipFitPx } from '../lib/clocks.js'
import './FlipClockPanel.css'

// FlipClockPanel - the split-flap clock (Clock/FlipClock.jsx, the Flip clock
// layout's) in a box of a spec layout (docs/designs/panels-and-controls.md,
// chunk 4): as big as the box allows, centred in it.
//
// FlipClock sizes everything from one variable, --tl-flip-u (the card
// height). Here it is the fit, the largest u at which the clock, its case and
// its date fit the box (lib/clocks.js flipFit: the clock's extent in u, with
// and without its tab and date), times the scale knob and the box's text
// scale (--tl-knob-scale, tokens.css "Panel knobs"):
//   - where the engine has container units, FlipClockPanel.css works the fit
//     out from the box (a size container) with flipFit's numbers, handed in
//     as variables; nothing is measured and a resize costs no render
//   - where it has none (Silk on an older Echo may predate them), the box is
//     measured (useBoxSize, a ResizeObserver) and the fit handed in as px
//     (flipFitPx, the same numbers)
//
// knobs (panels/schemas.js 'flipclock'): hour24 (00 to 23, no tab),
// showMeridiem (the AM / PM tab of a 12-hour clock), showDate, scale (0.5 to
// 1.5; 1 fills the box, above it the box crops the clock).
//
// now: the layout's clock (useTodayData, 1 Hz). FlipClock's cards are
// memoised, so the tick re-renders none of them between flips.

// Container units, or a measured box.
const HAS_CQ =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('height', '1cqh')
// What useBoxSize observes where container units do the work: nothing.
const NO_BOX = { current: null }

export default function FlipClockPanel({ now, knobs }) {
  const k = panelKnobs('flipclock', knobs) || knobDefaults('flipclock')
  const tab = !k.hour24 && !!k.showMeridiem
  const date = !!k.showDate
  const fit = flipFit({ tab, date })
  const boxRef = useRef(null)
  const box = useBoxSize(HAS_CQ ? NO_BOX : boxRef)
  const measured = HAS_CQ ? 0 : flipFitPx(box.w, box.h, { tab, date })

  const style = {
    '--tl-flipclock-scale': String(k.scale),
    '--tl-fc-wu': String(fit.wu),
    '--tl-fc-hu': String(fit.hu),
    '--tl-fc-footu': String(fit.footU),
    '--tl-fc-floor': `${fit.floorPx}px`,
  }
  const boxStyle = measured > 0 ? { '--tl-flipclock-fit': `${Math.round(measured * 100) / 100}px` } : undefined

  return (
    <PanelFrame title={null} className="tl-flipclock tl-knobs" bodyClassName="tl-flipclock__body" style={style}>
      <div className="tl-flipclock__box" ref={boxRef} style={boxStyle}>
        <FlipClock now={now} hour24={!!k.hour24} showMeridiem={!!k.showMeridiem} showDate={date} />
      </div>
    </PanelFrame>
  )
}
