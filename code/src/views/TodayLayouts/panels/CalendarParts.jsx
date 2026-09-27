import { splitPaint } from '../lib/calendarViews.js'
import './CalendarParts.css'

// CalendarParts - what the calendar panels share (docs/designs/panels-and-
// controls.md, chunk 3; UpNextPanel, DayListPanel, WeekGridPanel,
// MonthGridPanel, and the agenda's legend): an event's colour bar, split into
// a stripe per calendar for an event on several (consolidate); the calendar
// legend; and the one line a panel says instead of events. The logic is
// lib/calendarViews.js's; these only draw it.

// A bar in the event's colour(s). No colour (colorBy 'none', or a colour
// that is not one) leaves the stylesheet's neutral ink.
export function ColorBar({ colors, className = '' }) {
  const paint = splitPaint(colors, 'to bottom')
  return <span className={`tl-cal-bar ${className}`.trim()} style={paint ? { background: paint } : undefined} aria-hidden="true" />
}

// A dot in the event's colour(s), split left to right. edit / editLabel: its
// data-edit key, when the dot is a panel's element (the month grid's 'dot').
export function ColorDot({ colors, className = '', edit, editLabel }) {
  const paint = splitPaint(colors, 'to right')
  return (
    <span
      className={`tl-cal-dot ${className}`.trim()}
      style={paint ? { background: paint } : undefined}
      data-edit={edit || undefined}
      data-edit-label={editLabel || undefined}
      aria-hidden="true"
    />
  )
}

// The legend: each calendar's colour and name, on a line at the foot of the
// panel (wrapping when there are many). entries: lib/calendarViews.js
// legendOf. Nothing at all without entries.
export function CalendarLegend({ entries }) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return null
  return (
    <div className="tl-cal-legend" data-edit="legend" data-edit-label="Legend">
      {list.map((c) => (
        <span key={c.id} className="tl-cal-legend__item">
          <span className="tl-cal-legend__dot" style={{ background: c.color }} aria-hidden="true" />
          <span className="tl-cal-legend__label">{c.label}</span>
        </span>
      ))}
    </div>
  )
}

// The one line a panel says instead of its events: "Calendar not connected",
// or quietly "Nothing today". Marked as the panel's `empty` element.
export function CalendarMessage({ children, quiet = false }) {
  return (
    <div className={`tl-cal-message${quiet ? ' tl-cal-message--quiet' : ''}`} data-edit="empty" data-edit-label="Empty message">
      {children}
    </div>
  )
}
