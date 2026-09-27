import { useMemo } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { CalendarLegend } from './CalendarParts.jsx'
import { panelKnobs } from './schemas.js'
import { agendaColumns, agendaDayCount, agendaRowFit, clampInt, localDateKey } from './agendaDays.js'
import { fmtTime } from '../lib/format.js'
import { agendaItems, clockParts, hour24Of, legendOf, splitPaint } from '../lib/calendarViews.js'
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
// '24h', or 'auto': the screen's own, else 12-hour), showAllDayLabel,
// dimPast, columnGap, showColorBars. The layout hands in the days from today
// (enough for startDay + days) and the panel cuts them to the knobs; a list
// the layout already cut with sliceAgendaDays() is left as it is.
//
// The calendar views' shared options (docs/designs/panels-and-controls.md,
// chunk 3; lib/calendarViews.js), every one off by default, so the agenda at
// its defaults draws exactly what it always has: showLocation (the place
// under the title), showEndTime (the end under the start), showDescription
// (its first line), legend (calendars, given `calendars`), showEmptyDays (off:
// the layout hands in only days with events, lib/calendarViews.js
// daysWithEvents), futureOnly (finished events leave), consolidate (the same
// event on two calendars once, both colours on its bar), colorBy ('none':
// neutral bars and washes). screenHour24: the screen's 12 or 24 hour setting,
// for 'auto'.
//
// The row layouts and headers (knobs too, 2026-09-27), each at its default the
// agenda as it always was: rowLayout 'side' (the time in its column beside
// the title), 'stacked' (the time in small capitals on its own line over the
// title) or 'timeRight' (the time at the row's right edge, quieter);
// titleLines 1 or 2 (then an ellipsis); dayHeader 'caps', 'bold' (the day
// in its own words, bold) or 'compact' (smaller capitals, no rule); rowGap
// 0..2, the gap between rows. A knob off its default adds a class
// (AgendaPanel.css), so at the defaults the DOM and the styles are unchanged.

const MAX_ITEMS = 6

// The row layouts' classes; 'side' is the agenda's own and has none.
const ROW_LAYOUT_CLASS = { stacked: 'tl-agenda--stacked', timeRight: 'tl-agenda--time-right' }
const HEADER_CLASS = { bold: 'tl-agenda--head-bold', compact: 'tl-agenda--head-compact' }

function own(map, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
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

// The end under the start (showEndTime), quieter; nothing when there is none.
function EndTime({ item, h24 }) {
  if (!(item.end instanceof Date) || !(item.start instanceof Date) || item.end.getTime() <= item.start.getTime()) return null
  const { hm, ampm } = clockParts(item.end, h24)
  return (
    <span className="tl-agenda__end">
      {hm}
      {ampm && <span className="tl-agenda__ampm">{ampm}</span>}
    </span>
  )
}

function TimeCell({ item, h24, allDayLabel, showEnd = false }) {
  if (item.allDay) {
    // No label: the empty cell keeps the titles in line, and the wash still
    // says all day.
    if (!allDayLabel) return <span className="tl-agenda__time" />
    return <span className="tl-agenda__time tl-agenda__time--allday">All day</span>
  }
  if (h24) {
    return (
      <span className="tl-agenda__time tl-num">
        {fmtTime24(item.start)}
        {showEnd && <EndTime item={item} h24 />}
      </span>
    )
  }
  const { hm, ampm } = fmtTime(item.start)
  return (
    <span className="tl-agenda__time tl-num">
      {hm}
      {ampm && <span className="tl-agenda__ampm">{ampm.toLowerCase()}</span>}
      {showEnd && <EndTime item={item} h24={false} />}
    </span>
  )
}

// The title, and under it the place and the description's first line when
// those options are on (only then does the title get a wrapper).
function TitleCell({ item, opts }) {
  const place = opts && opts.showLocation ? item.place : null
  const description = opts && opts.showDescription ? item.description : null
  if (!place && !description) return <span className="tl-agenda__title">{item.title}</span>
  return (
    <span className="tl-agenda__main">
      <span className="tl-agenda__title">{item.title}</span>
      {place && (
        <span className="tl-agenda__loc" data-edit="location" data-edit-label="Location">
          {place}
        </span>
      )}
      {description && (
        <span className="tl-agenda__desc" data-edit="description" data-edit-label="Description">
          {description}
        </span>
      )}
    </span>
  )
}

function Row({ item, past, h24 = false, allDayLabel = true, opts = null }) {
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
  // An event on several calendars (consolidate): a stripe of each colour.
  const split = Array.isArray(item.colors) && item.colors.length > 1 ? splitPaint(item.colors) : null
  return (
    <li className={cls} style={style}>
      <span className="tl-agenda__bar" style={split ? { background: split } : undefined} aria-hidden="true" />
      <TimeCell item={item} h24={h24} allDayLabel={allDayLabel} showEnd={!!(opts && opts.showEndTime)} />
      <TitleCell item={item} opts={opts} />
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
  calendars = null,
  screenHour24 = null,
}) {
  const k = panelKnobs('agenda', knobs)
  const todayKey = localDateKey(now)
  const given = k ? agendaColumns(days, k, now) : Array.isArray(days) ? days : []
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  // The shared calendar options (chunk 3). At their defaults `opts` is null
  // and every day is the very list the layout handed in.
  const opts =
    k && (k.consolidate || k.colorBy === 'none' || k.showLocation || k.showDescription || k.showEndTime || k.futureOnly)
      ? {
          consolidate: !!k.consolidate,
          colorBy: k.colorBy,
          showLocation: !!k.showLocation,
          showDescription: !!k.showDescription,
          showEndTime: !!k.showEndTime,
          futureOnly: !!k.futureOnly,
        }
      : null
  const list = opts ? given.map((day) => withOptions(day, opts, nowMs)) : given
  const hasAny = list.some((d) => Array.isArray(d?.events) && d.events.length > 0)
  const maxRows = k ? clampInt(k.rowsPerDay, 2, 10, MAX_ITEMS) : MAX_ITEMS
  const h24 = !!k && hour24Of(k.timeFormat, screenHour24)
  const allDayLabel = k ? !!k.showAllDayLabel : true
  const dimPast = k ? !!k.dimPast : true
  const legendOn = !!k && !!k.legend && k.colorBy !== 'none'
  const legend = useMemo(() => (legendOn ? legendOf(calendars, allEvents(days)) : null), [legendOn, calendars, days])
  const extraLines = opts ? (opts.showLocation ? 1 : 0) + (opts.showDescription ? 1 : 0) : 0
  const layoutClass = k ? own(ROW_LAYOUT_CLASS, k.rowLayout) : null
  const headerClass = k ? own(HEADER_CLASS, k.dayHeader) : null
  const titleLines = k && Number(k.titleLines) === 1 ? 1 : 2
  const gapNum = k ? Number(k.rowGap) : NaN
  const rowGap = Number.isFinite(gapNum) ? Math.min(2, Math.max(0, gapNum)) : 1
  // The first column is marked as today only when it is today.
  const firstIsToday = !k || (todayKey != null ? list[0]?.dateKey === todayKey : k.startDay !== 'tomorrow')

  // Nothing to show AND no reason to believe the calendar is empty: say that
  // once. A hub that has not answered yet (connected null, no error) is just
  // loading and gets quiet columns rather than a message that would flash.
  const unreachable = !hasAny && connected !== true && (connected === false || !!error)
  // Events we hold but can no longer vouch for: shown, with their age.
  const showStamp = hasAny && (stale || connected === false)
  const lastIndex = list.length - 1

  const cls = [
    'tl-agenda',
    k ? 'tl-knobs' : '',
    k && !k.showColorBars ? 'tl-agenda--nobars' : '',
    layoutClass || '',
    titleLines === 1 ? 'tl-agenda--lines1' : '',
    headerClass || '',
    rowGap !== 1 ? 'tl-agenda--gap' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = k
    ? {
        '--tl-agenda-row': String(k.rowSize),
        '--tl-agenda-head': String(k.headerSize),
        '--tl-agenda-gap': String(k.columnGap),
        '--tl-agenda-fit': String(
          agendaRowFit({ rows: maxRows, extraLines, titleLines, rowGap, stacked: layoutClass === ROW_LAYOUT_CLASS.stacked })
        ),
      }
    : undefined
  if (style && rowGap !== 1) style['--tl-agenda-rowgap'] = String(rowGap)
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
          <div className="tl-agenda__message" data-edit="message" data-edit-label="Not connected">
            Calendar not connected
          </div>
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
                        opts={opts}
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
      {legend && <CalendarLegend entries={legend} />}
    </PanelFrame>
  )
}

// A day's events for the options: futureOnly drops the timed ones already
// over; the rest (consolidate, colorBy, the place, the description) is
// lib/calendarViews.js agendaItems.
function withOptions(day, opts, nowMs) {
  if (!day || !Array.isArray(day.events)) return day
  const kept = opts.futureOnly ? day.events.filter((item) => !isPast(item, nowMs)) : day.events
  const events = agendaItems(kept, {
    consolidate: opts.consolidate,
    colorBy: opts.colorBy,
    withPlace: opts.showLocation,
    withDescription: opts.showDescription,
  })
  return events === day.events ? day : { ...day, events }
}

// Every event the days hold, for a legend drawn from the events themselves
// (a hub that sends no calendar list).
function allEvents(days) {
  const out = []
  ;(Array.isArray(days) ? days : []).forEach((d) => {
    if (d && Array.isArray(d.events)) d.events.forEach((e) => out.push(e))
  })
  return out
}
