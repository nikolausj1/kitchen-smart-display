import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { panelKnobs } from './schemas.js'
import { agendaColumns, agendaDayCount, clampInt, localDateKey } from './agendaDays.js'
import { fmtTime } from '../lib/format.js'
import './AgendaPanel.css'

// For the layouts: cut useTodayData's agendaDays to the knobs (agendaDays.js).
// eslint-disable-next-line react-refresh/only-export-components
export { sliceAgendaDays } from './agendaDays.js'

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
//
// knobs (a spec layout, panels/schemas.js 'agenda'): days (columns, 1..5) and
// startDay ('today' | 'tomorrow'), rowsPerDay (the type steps down so that
// many two-line rows still fit), rowSize, headerSize, timeFormat ('12h' |
// '24h'), showAllDayLabel, dimPast, columnGap, showColorBars. The layout hands
// in the days from today (enough for startDay + days) and the panel cuts them
// to the knobs; a list the layout already cut with sliceAgendaDays() is left
// as it is.

const MAX_ITEMS = 6

// The row budget (AgendaPanel.css): N two-line rows and the "+N more" line
// take N x 3.06em + 1.2em, and six of them are what the 4.9cqh cap on the row
// size was set for. Other row counts scale that cap by this, so the worst day
// still fits; six is exactly 1.
function rowsFit(rows) {
  return Math.round((((MAX_ITEMS * 3.06 + 1.2) / (rows * 3.06 + 1.2)) * 10000)) / 10000
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isPast(item, nowMs) {
  if (item.allDay || nowMs == null) return false
  const endMs = item.end ? item.end.getTime() : item.start ? item.start.getTime() : null
  return endMs != null && endMs <= nowMs
}

// Up to `max` rows. When a day has more, rows that are already over give up
// their places first (earliest first): at 7 pm the evening matters more than
// the morning. "+N more" counts every row left out.
function visibleRows(events, nowMs, max = MAX_ITEMS) {
  const list = Array.isArray(events) ? events : []
  if (list.length <= max) return { shown: list, more: 0 }
  let toDrop = list.length - max
  const kept = []
  for (const ev of list) {
    if (toDrop > 0 && isPast(ev, nowMs)) {
      toDrop -= 1
      continue
    }
    kept.push(ev)
  }
  const shown = kept.slice(0, max)
  return { shown, more: list.length - shown.length }
}

// '13:30', '07:05'
function fmtTime24(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--'
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function TimeCell({ item, h24, allDayLabel }) {
  if (item.allDay) {
    // No label: the empty cell keeps the titles in line, and the wash still
    // says all day.
    if (!allDayLabel) return <span className="tl-agenda__time" />
    return <span className="tl-agenda__time tl-agenda__time--allday">All day</span>
  }
  if (h24) return <span className="tl-agenda__time tl-num">{fmtTime24(item.start)}</span>
  const { hm, ampm } = fmtTime(item.start)
  return (
    <span className="tl-agenda__time tl-num">
      {hm}
      {ampm && <span className="tl-agenda__ampm">{ampm.toLowerCase()}</span>}
    </span>
  )
}

function Row({ item, past, h24 = false, allDayLabel = true }) {
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
      <TimeCell item={item} h24={h24} allDayLabel={allDayLabel} />
      <span className="tl-agenda__title">{item.title}</span>
    </li>
  )
}

export default function AgendaPanel({
  days,
  now,
  connected = null,
  fetchedAt = null,
  error = null,
  stale = false,
  knobs,
}) {
  const k = panelKnobs('agenda', knobs)
  const todayKey = localDateKey(now)
  const list = k ? agendaColumns(days, k, now) : Array.isArray(days) ? days : []
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  const hasAny = list.some((d) => Array.isArray(d?.events) && d.events.length > 0)
  const maxRows = k ? clampInt(k.rowsPerDay, 2, 10, MAX_ITEMS) : MAX_ITEMS
  const h24 = !!k && k.timeFormat === '24h'
  const allDayLabel = k ? !!k.showAllDayLabel : true
  const dimPast = k ? !!k.dimPast : true
  // The first column is marked as today only when it is today.
  const firstIsToday = !k || (todayKey != null ? list[0]?.dateKey === todayKey : k.startDay !== 'tomorrow')

  // Nothing to show AND no reason to believe the calendar is empty: say that
  // once. A hub that has not answered yet (connected null, no error) is just
  // loading and gets quiet columns rather than a message that would flash.
  const unreachable = !hasAny && connected !== true && (connected === false || !!error)
  // Events we hold but can no longer vouch for: shown, with their age.
  const showStamp = hasAny && (stale || connected === false)
  const lastIndex = list.length - 1

  const cls = ['tl-agenda', k ? 'tl-knobs' : '', k && !k.showColorBars ? 'tl-agenda--nobars' : '']
    .filter(Boolean)
    .join(' ')
  const style = k
    ? {
        '--tl-agenda-row': String(k.rowSize),
        '--tl-agenda-head': String(k.headerSize),
        '--tl-agenda-gap': String(k.columnGap),
        '--tl-agenda-fit': String(rowsFit(maxRows)),
      }
    : undefined
  // One column per day the knobs ask for, filled or not, so the board keeps
  // its shape while the calendar loads.
  const gridStyle = k ? { gridTemplateColumns: `repeat(${agendaDayCount(k)}, minmax(0, 1fr))` } : undefined

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-agenda__body" style={style}>
      <div className="tl-agenda__grid" style={gridStyle}>
        {list.map((day, i) => (
          <header
            key={`h-${day.dateKey || i}`}
            className={`tl-agenda__head${i === 0 && firstIsToday ? ' tl-agenda__head--today' : ''}`}
            data-edit="header"
            data-edit-label="Day header"
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
            const { shown, more } = visibleRows(day.events, nowMs, maxRows)
            const loading = connected == null && !error && !hasAny
            return (
              <div
                key={`l-${day.dateKey || i}`}
                className="tl-agenda__list"
                data-edit="rows"
                data-edit-label="Events"
              >
                {shown.length > 0 ? (
                  <ul className="tl-agenda__items">
                    {shown.map((item) => (
                      <Row
                        key={item.key}
                        item={item}
                        past={dimPast && isPast(item, nowMs)}
                        h24={h24}
                        allDayLabel={allDayLabel}
                      />
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
