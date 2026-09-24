import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { fmtTime } from '../lib/format.js'
import './AgendaPanel.css'

// AgendaPanel - the family calendar as three day columns (today, tomorrow, the
// day after), the way the DAKboard by the front door showed it.
//
// days: [{ dateKey, label, events: [{ key, title, allDay, start, end, color,
// tint }] }], already bucketed and sorted by useTodayData (lib/agenda.js):
// all-day rows first, then by start. Every row carries its calendar's colour
// as a bar; an all-day row is also washed in it, so the two kinds read apart
// at a glance.
//
// The status props are optional and only change the empty and stale states:
//   connected  the hub's flag (null = not heard yet)
//   fetchedAt  age of the events (ms), error, stale  from hooks/useCalendar.js
// With no events and no connection the panel says so once, across all three
// columns, instead of three "Nothing scheduled" lines that would be a lie.

const MAX_ITEMS = 6

function isPast(item, nowMs) {
  if (item.allDay || nowMs == null) return false
  const endMs = item.end ? item.end.getTime() : item.start ? item.start.getTime() : null
  return endMs != null && endMs <= nowMs
}

// Up to MAX_ITEMS rows. When a day has more, rows that are already over give
// up their places first (earliest first): at 7 pm the evening matters more
// than the morning. "+N more" counts every row left out.
function visibleRows(events, nowMs) {
  const list = Array.isArray(events) ? events : []
  if (list.length <= MAX_ITEMS) return { shown: list, more: 0 }
  let toDrop = list.length - MAX_ITEMS
  const kept = []
  for (const ev of list) {
    if (toDrop > 0 && isPast(ev, nowMs)) {
      toDrop -= 1
      continue
    }
    kept.push(ev)
  }
  const shown = kept.slice(0, MAX_ITEMS)
  return { shown, more: list.length - shown.length }
}

function TimeCell({ item }) {
  if (item.allDay) {
    return <span className="tl-agenda__time tl-agenda__time--allday">All day</span>
  }
  const { hm, ampm } = fmtTime(item.start)
  return (
    <span className="tl-agenda__time tl-num">
      {hm}
      {ampm && <span className="tl-agenda__ampm">{ampm.toLowerCase()}</span>}
    </span>
  )
}

function Row({ item, past }) {
  const cls = [
    'tl-agenda__item',
    item.allDay ? 'tl-agenda__item--allday' : '',
    past ? 'tl-agenda__item--past' : '',
  ]
    .join(' ')
    .trim()
  // Colours are data (each calendar's own), so they arrive as custom
  // properties; the stylesheet decides where they are painted.
  const style = {}
  if (item.color) style['--tl-agenda-color'] = item.color
  if (item.tint) style['--tl-agenda-tint'] = item.tint
  return (
    <li className={cls} style={style}>
      <span className="tl-agenda__bar" aria-hidden="true" />
      <TimeCell item={item} />
      <span className="tl-agenda__title">{item.title}</span>
    </li>
  )
}

export default function AgendaPanel({ days, now, connected = null, fetchedAt = null, error = null, stale = false }) {
  const list = Array.isArray(days) ? days : []
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  const hasAny = list.some((d) => Array.isArray(d?.events) && d.events.length > 0)

  // Nothing to show AND no reason to believe the calendar is empty: say that
  // once. A hub that has not answered yet (connected null, no error) is just
  // loading and gets quiet columns rather than a message that would flash.
  const unreachable = !hasAny && connected !== true && (connected === false || !!error)
  // Events we hold but can no longer vouch for: shown, with their age.
  const showStamp = hasAny && (stale || connected === false)
  const lastIndex = list.length - 1

  return (
    <PanelFrame title={null} className="tl-agenda" bodyClassName="tl-agenda__body">
      <div className="tl-agenda__grid">
        {list.map((day, i) => (
          <header
            key={`h-${day.dateKey || i}`}
            className={`tl-agenda__head${i === 0 ? ' tl-agenda__head--today' : ''}`}
          >
            <span className="tl-agenda__label">{day.label}</span>
            {showStamp && i === lastIndex && (
              <span className="tl-agenda__stamp">
                <FreshnessStamp fetchedAt={fetchedAt} now={now} error={error || 'stale'} />
              </span>
            )}
          </header>
        ))}

        {unreachable ? (
          <div className="tl-agenda__message">Calendar not connected</div>
        ) : (
          list.map((day, i) => {
            const { shown, more } = visibleRows(day.events, nowMs)
            const loading = connected == null && !error && !hasAny
            return (
              <div key={`l-${day.dateKey || i}`} className="tl-agenda__list">
                {shown.length > 0 ? (
                  <ul className="tl-agenda__items">
                    {shown.map((item) => (
                      <Row key={item.key} item={item} past={isPast(item, nowMs)} />
                    ))}
                    {more > 0 && <li className="tl-agenda__more">+{more} more</li>}
                  </ul>
                ) : (
                  <div className="tl-agenda__items">
                    {!loading && <div className="tl-agenda__none">Nothing scheduled</div>}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </PanelFrame>
  )
}
