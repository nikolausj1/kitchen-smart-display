import PanelFrame from './PanelFrame.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { secondClock } from '../lib/clocks.js'
import './SecondClockPanel.css'

// SecondClockPanel - the time somewhere else (docs/designs/
// panels-and-controls.md, chunk 4): a label (the zone's city unless one is
// given), the time there, and under it the date there and how far ahead or
// behind this screen it is ("Sun, Sep 27 · +8h").
//
// knobs (panels/schemas.js 'clock2'): timezone (an IANA zone, checked with
// Intl.DateTimeFormat: one this engine does not know shows this screen's own
// time, with a muted "?" after the label and no offset), label, hour24,
// showDate, showOffset, size.
//
// now: the layout's clock (useTodayData, 1 Hz); the reading is
// lib/clocks.js secondClock.

export default function SecondClockPanel({ now, knobs }) {
  const k = panelKnobs('clock2', knobs) || knobDefaults('clock2')
  const c = secondClock(now, k)
  const date = k.showDate && c.date ? c.date : ''
  const offset = k.showOffset && c.offset ? c.offset : ''

  return (
    <PanelFrame title={null} className="tl-clock2 tl-knobs" bodyClassName="tl-clock2__body" style={{ '--tl-clock2-size': String(k.size) }}>
      <div className="tl-clock2__label" data-edit="label">
        {c.label}
        {!c.valid && (
          <span className="tl-clock2__unknown" title="Not a time zone this screen knows: its own time shown">
            ?
          </span>
        )}
      </div>
      <div className="tl-clock2__time" data-edit="time">
        <span className="tl-clock2__hm tl-num">{c.hm}</span>
        {c.meridiem && <span className="tl-clock2__ampm">{c.meridiem}</span>}
      </div>
      {(date || offset) && (
        <div className="tl-clock2__meta">
          {date && (
            <span className="tl-clock2__date" data-edit="date">
              {date}
            </span>
          )}
          {date && offset && <span className="tl-clock2__sep"> · </span>}
          {offset && (
            <span className="tl-clock2__offset tl-num" data-edit="offset">
              {offset}
            </span>
          )}
        </div>
      )}
    </PanelFrame>
  )
}
