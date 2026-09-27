import PanelFrame from './PanelFrame.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import './DayCountPanel.css'

// DayCountPanel - one number about the calendar, big, with a small label
// under it (docs/designs/panels-and-controls.md, chunk 4): the week of the
// year, the day of the year ("269, Day of 365"), the days left in it, or the
// school days left.
//
// count: lib/dates.js dayCount for the show knob, { value, label }, worked
// out by SpecBoard (once a day), or null when it cannot be counted: school
// days with no last day of school ahead (neither the dashboard's
// shared.school.lastDay nor the school calendar's). SpecBoard then drops the
// box on a screen, as it does the alert banner with no alert; in the layout
// editor (`editing`) the box says why instead, so it can be placed.
//
// knobs (panels/schemas.js 'daycount'): show, label (empty: the count's
// own, as "Week of the year"), size.

export default function DayCountPanel({ count, knobs, editing = false }) {
  const k = panelKnobs('daycount', knobs) || knobDefaults('daycount')
  const given = typeof k.label === 'string' ? k.label.trim() : ''
  const ok = count && Number.isFinite(count.value)

  return (
    <PanelFrame title={null} className="tl-daycount tl-knobs" bodyClassName="tl-daycount__body" style={{ '--tl-daycount-size': String(k.size) }}>
      {ok ? (
        <>
          <div className="tl-daycount__number tl-num" data-edit="number">
            {count.value}
          </div>
          <div className="tl-daycount__label" data-edit="label">
            {given || count.label}
          </div>
        </>
      ) : editing ? (
        <div className="tl-daycount__note" data-edit="label">
          No last day of school yet
        </div>
      ) : null}
    </PanelFrame>
  )
}
