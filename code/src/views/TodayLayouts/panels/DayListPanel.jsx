import { useMemo } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { CalendarLegend, CalendarMessage, ColorBar } from './CalendarParts.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { dateKey } from '../../../lib/schoolDay.js'
import { addDaysKey } from '../lib/agenda.js'
import {
  allDayText,
  calendarState,
  clockParts,
  untilEnd,
  eventsOnDay,
  hour24Of,
  isOver,
  legendOf,
  longDate,
  viewEvents,
  visibleRows,
} from '../lib/calendarViews.js'
import './DayListPanel.css'

// DayListPanel - "Day list" (docs/designs/panels-and-controls.md, chunk 3):
// one day, today or tomorrow, as a vertical list under its date: the all-day
// events first, then the timed ones with their start (and end, on request),
// the place and the first line of the description when asked. The same day
// as the agenda's column for it (lib/calendarViews.js eventsOnDay: a timed
// event on the day it starts).
//
// events, calendars, connected, fetchedAt, error, stale: the calendar store's
// (hooks/useCalendar.js, through useTodayData's d.calendar).
//
// knobs (panels/schemas.js 'daylist'): day ('today' | 'tomorrow'), maxRows
// (3..14; finished events give up their places first, then "+n more"),
// rowSize, headerSize, and the shared calendar options showLocation,
// showEndTime, showDescription, legend, futureOnly, dimPast, consolidate,
// timeFormat, colorBy. screenHour24: the screen's 12 or 24 hour setting for
// timeFormat 'auto' (none exists yet: 12-hour).

// The time cell: 'All day' for an all-day event, and for a long one (a day
// or more) on the days after it starts; else the start, and the end under it
// with showEnd.
function Time({ v, h24, showEnd, dayKey }) {
  if (v.allDay || (v.long && v.startDate < dayKey)) {
    return (
      <span className="tl-daylist__time tl-daylist__time--allday" data-edit="time" data-edit-label="Time">
        All day
      </span>
    )
  }
  const a = clockParts(v.start, h24)
  const b = showEnd && v.end && v.end.getTime() > v.start.getTime() ? clockParts(v.end, h24) : null
  return (
    <span className="tl-daylist__time tl-num" data-edit="time" data-edit-label="Time">
      <span className="tl-daylist__start">
        {a.hm}
        {a.ampm && <span className="tl-daylist__ampm">{a.ampm}</span>}
      </span>
      {b && (
        <span className="tl-daylist__end">
          {b.hm}
          {b.ampm && <span className="tl-daylist__ampm">{b.ampm}</span>}
        </span>
      )}
    </span>
  )
}

// The line under a title for an event across days: 'through Mon' (all
// day), 'until Tue 6:00 pm' (a long timed one); none for one day.
function spanText(v, h24, todayKey, now) {
  if (v.allDay) {
    const t = allDayText(v, todayKey)
    return t === 'All day' ? null : t.replace('All day ', '')
  }
  return v.long ? untilEnd(v, now, h24) : null
}

function Row({ v, past, h24, k, todayKey, dayKey, now }) {
  const cls = ['tl-daylist__row', v.allDay || v.long ? 'tl-daylist__row--allday' : '', past ? 'tl-daylist__row--past' : '']
    .filter(Boolean)
    .join(' ')
  const span = spanText(v, h24, todayKey, now)
  return (
    <div className={cls} style={(v.allDay || v.long) && v.tint ? { '--tl-daylist-tint': v.tint } : undefined} data-edit="row" data-edit-label="Event">
      <ColorBar colors={v.colors} className="tl-daylist__bar" />
      <Time v={v} h24={h24} showEnd={!!k.showEndTime} dayKey={dayKey} />
      <div className="tl-daylist__main">
        <div className="tl-daylist__title">{v.title}</div>
        {span && (
          <div className="tl-daylist__span" data-edit="time" data-edit-label="Time">
            {span}
          </div>
        )}
        {k.showLocation && v.place && (
          <div className="tl-daylist__loc" data-edit="location" data-edit-label="Location">
            {v.place}
          </div>
        )}
        {k.showDescription && v.description && (
          <div className="tl-daylist__desc" data-edit="description" data-edit-label="Description">
            {v.description}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DayListPanel({
  events,
  calendars,
  now,
  connected = null,
  fetchedAt = null,
  error = null,
  stale = false,
  knobs,
  screenHour24 = null,
}) {
  const k = panelKnobs('daylist', knobs) || knobDefaults('daylist')
  const consolidate = !!k.consolidate
  const colorBy = k.colorBy
  const list = useMemo(() => viewEvents(events, { consolidate, colorBy }), [events, consolidate, colorBy])
  const legend = useMemo(() => (k.legend && colorBy !== 'none' ? legendOf(calendars, events) : null), [k.legend, colorBy, calendars, events])
  const valid = now instanceof Date && !Number.isNaN(now.getTime())
  const todayKey = valid ? dateKey(now) : null
  const tomorrow = k.day === 'tomorrow'
  const key = todayKey ? (tomorrow ? addDaysKey(todayKey, 1) : todayKey) : null
  const h24 = hour24Of(k.timeFormat, screenHour24)
  const maxRows = Math.min(14, Math.max(3, Math.round(Number(k.maxRows)) || 8))

  const day = key ? eventsOnDay(list, key, now, !!k.futureOnly) : []
  const { shown, more } = visibleRows(day, now, maxRows)
  const allDay = shown.filter((v) => v.allDay || v.long)
  const timed = shown.filter((v) => !(v.allDay || v.long))
  const state = calendarState({ connected, error, hasAny: list.length > 0 })
  const showStamp = list.length > 0 && (stale || connected === false)

  // The rows' type fits the rows shown (DayListPanel.css): each a line and a
  // half, and a line more for each extra line it carries; never sized for
  // fewer than four rows (one event would read as a headline) nor more than
  // maxRows.
  const perRow = 1.55 + (k.showLocation ? 1.05 : 0) + (k.showDescription ? 1.05 : 0) + (k.showEndTime ? 0.3 : 0)
  const budgetRows = Math.min(maxRows, Math.max(4, shown.length))
  const lines = budgetRows * perRow + (more > 0 ? 1.3 : 0) + (allDay.length > 0 ? 0.35 : 0)
  const style = {
    '--tl-daylist-row': String(k.rowSize),
    '--tl-daylist-head': String(k.headerSize),
    '--tl-daylist-lines': String(Math.round(lines * 100) / 100),
  }

  let body
  if (state === 'unreachable') body = <CalendarMessage>Calendar not connected</CalendarMessage>
  else if (!shown.length) body = state === 'loading' ? null : <CalendarMessage quiet>{tomorrow ? 'Nothing tomorrow' : 'Nothing today'}</CalendarMessage>
  else {
    const rowProps = { h24, k, todayKey, dayKey: key, now }
    body = (
      <div className="tl-daylist__rows" data-edit="rows" data-edit-label="Events">
        <div className="tl-daylist__list">
          {allDay.length > 0 && (
            <div className="tl-daylist__allday" data-edit="allday" data-edit-label="All-day events">
              {allDay.map((v) => (
                <Row key={v.key} v={v} past={false} {...rowProps} />
              ))}
            </div>
          )}
          {timed.map((v) => (
            <Row key={v.key} v={v} past={!!k.dimPast && isOver(v, now)} {...rowProps} />
          ))}
          {more > 0 && <div className="tl-daylist__more">+{more} more</div>}
        </div>
      </div>
    )
  }

  return (
    <PanelFrame
      title={tomorrow ? 'Tomorrow' : 'Today'}
      aside={showStamp ? <FreshnessStamp fetchedAt={fetchedAt} now={now} error={error || 'stale'} /> : undefined}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={`tl-daylist tl-knobs${k.showEndTime ? ' tl-daylist--ends' : ''}${h24 ? ' tl-daylist--h24' : ''}${k.colorBy === 'none' ? ' tl-daylist--nocolor' : ''}`}
      bodyClassName="tl-daylist__body"
      style={style}
    >
      {key && (
        <div className="tl-daylist__header" data-edit="header" data-edit-label="Date">
          {longDate(key)}
        </div>
      )}
      {body}
      {legend && <CalendarLegend entries={legend} />}
    </PanelFrame>
  )
}
