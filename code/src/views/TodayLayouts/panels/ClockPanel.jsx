import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
import { fmtDateLong, fmtDayLong, fmtDayShort, fmtTime } from '../lib/format.js'
import './ClockPanel.css'

// ClockPanel - the anchor of the Board layout. The numerals are sized in
// container units against the panel body (a size container), so the very same
// component reads correctly in a 4-column cell and across a full-width hero
// without any layout passing it a font size.
//
// dateStyle: 'long' -> "Friday, August 14", 'short' -> "Fri, Aug 14",
// 'day' -> "Friday", 'none' -> no date.
//
// knobs (a spec layout, panels/schemas.js 'clock'): timeSize, dateSize,
// weight (of the time), showDate, dateStyle, showSeconds, showGreeting. They
// win over the props of the same name; without knobs the props rule, exactly
// as before. The greeting shows only when the layout hands one in.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'Fri, Aug 14'
function fmtDateShort(date) {
  const day = fmtDayShort(date)
  return day ? `${day}, ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}` : ''
}

function dateLine(now, dateStyle) {
  if (dateStyle === 'none') return ''
  if (dateStyle === 'day') return fmtDayLong(now)
  if (dateStyle === 'short') return fmtDateShort(now)
  return fmtDateLong(now)
}

export default function ClockPanel({
  now,
  greeting,
  showGreeting = true,
  showSeconds = false,
  dateStyle = 'long',
  knobs,
}) {
  const k = panelKnobs('clock', knobs)
  const greet = k ? k.showGreeting : showGreeting
  const seconds = k ? !!k.showSeconds : showSeconds
  const style = k ? (k.showDate ? k.dateStyle : 'none') : dateStyle

  // fmtTime returns '--:--' with no meridiem when `now` is missing, which is
  // the honest empty state here: the frame stays, the numbers admit they are
  // not there.
  const { hm, ampm } = fmtTime(now, { seconds })
  const date = dateLine(now, style)
  const bodyClass = `tl-clock__body${seconds ? ' tl-clock__body--seconds' : ''}`

  return (
    <PanelFrame
      title={greet && greeting ? greeting : null}
      className={`tl-clock${k ? ' tl-knobs' : ''}`}
      bodyClassName={bodyClass}
      style={k ? { '--tl-clock-time': String(k.timeSize), '--tl-clock-date': String(k.dateSize) } : undefined}
      titleEdit="greeting"
      titleEditLabel="Greeting"
    >
      <div className="tl-clock__time" data-edit="time" style={k ? { fontWeight: k.weight } : undefined}>
        <span className="tl-clock__hm tl-num">{hm}</span>
        {ampm && <span className="tl-clock__ampm">{ampm}</span>}
      </div>
      {date && (
        <div className="tl-clock__date" data-edit="date">
          {date}
        </div>
      )}
    </PanelFrame>
  )
}
