import PanelFrame from './PanelFrame.jsx'
import { fmtDateLong, fmtDayLong, fmtTime } from '../lib/format.js'
import './ClockPanel.css'

// ClockPanel - the anchor of the Board layout. The numerals are sized in
// container units against the panel body (a size container), so the very same
// component reads correctly in a 4-column cell and across a full-width hero
// without any layout passing it a font size.
//
// dateStyle: 'long' -> "Friday, August 14", 'day' -> "Friday", 'none' -> no date.
function dateLine(now, dateStyle) {
  if (dateStyle === 'none') return ''
  if (dateStyle === 'day') return fmtDayLong(now)
  return fmtDateLong(now)
}

export default function ClockPanel({
  now,
  greeting,
  showGreeting = true,
  showSeconds = false,
  dateStyle = 'long',
}) {
  // fmtTime returns '--:--' with no meridiem when `now` is missing, which is
  // the honest empty state here: the frame stays, the numbers admit they are
  // not there.
  const { hm, ampm } = fmtTime(now, { seconds: showSeconds })
  const date = dateLine(now, dateStyle)
  const bodyClass = `tl-clock__body${showSeconds ? ' tl-clock__body--seconds' : ''}`

  return (
    <PanelFrame
      title={showGreeting && greeting ? greeting : null}
      className="tl-clock"
      bodyClassName={bodyClass}
    >
      <div className="tl-clock__time">
        <span className="tl-clock__hm tl-num">{hm}</span>
        {ampm && <span className="tl-clock__ampm">{ampm}</span>}
      </div>
      {date && <div className="tl-clock__date">{date}</div>}
    </PanelFrame>
  )
}
