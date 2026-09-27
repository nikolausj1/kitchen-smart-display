import { useMemo } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { CalendarLegend, ColorBar, ColorDot } from './CalendarParts.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { addDaysKey } from '../lib/agenda.js'
import {
  calendarState,
  covered,
  coversAll,
  hour24Of,
  isOver,
  legendOf,
  monthGrid,
  tinyClock,
  viewEvents,
} from '../lib/calendarViews.js'
import './MonthGridPanel.css'

// MonthGridPanel - "Month grid" (docs/designs/panels-and-controls.md, chunk
// 3): the current month (or the next) as six weeks of seven days, today
// marked, each day's events as dots in their calendars' colours or, on a
// screen with the room (the Echo Show 15), as titles, the first few and "+n"
// for the rest. The cells are lib/calendarViews.js monthGrid's.
//
// events, calendars, connected, fetchedAt, error, stale, range: the calendar
// store's (hooks/useCalendar.js, through useTodayData's d.calendar). A day
// outside the store's range is drawn with no marks and never counted as
// free: the hub keeps 31 days back and 60 ahead.
//
// knobs (panels/schemas.js 'monthgrid'): month ('current' | 'next'),
// weekStart ('sunday' | 'monday'), mode ('dots' | 'titles'), titlesPerDay
// (1..4), showOtherMonths (the days before and after, dimmed), size, and the
// shared calendar options legend, futureOnly, dimPast, consolidate,
// timeFormat, colorBy. screenHour24: the screen's 12 or 24 hour setting for
// timeFormat 'auto' (none yet: 12-hour).

const MAX_DOTS = 4

export default function MonthGridPanel({
  events,
  calendars,
  now,
  connected = null,
  fetchedAt = null,
  error = null,
  stale = false,
  range = null,
  knobs,
  screenHour24 = null,
}) {
  const k = panelKnobs('monthgrid', knobs) || knobDefaults('monthgrid')
  const consolidate = !!k.consolidate
  const colorBy = k.colorBy
  const list = useMemo(() => viewEvents(events, { consolidate, colorBy }), [events, consolidate, colorBy])
  const legend = useMemo(() => (k.legend && colorBy !== 'none' ? legendOf(calendars, events) : null), [k.legend, colorBy, calendars, events])
  const h24 = hour24Of(k.timeFormat, screenHour24)
  const valid = now instanceof Date && !Number.isNaN(now.getTime())
  const minute = valid ? Math.floor(now.getTime() / 60000) : null
  const { month, weekStart, futureOnly } = k
  const grid = useMemo(
    () => monthGrid(list, { now: minute == null ? null : new Date(minute * 60000), month, weekStart, futureOnly: !!futureOnly }),
    [list, minute, month, weekStart, futureOnly]
  )
  const titles = k.mode === 'titles'
  const perDay = Math.min(4, Math.max(1, Math.round(Number(k.titlesPerDay)) || 3))
  const dimPast = !!k.dimPast
  const nowForPast = minute == null ? null : new Date(minute * 60000)

  const inMonth = grid.cells.filter((c) => c.inMonth)
  const monthKnown = inMonth.length > 0 && coversAll(range, inMonth[0].key, addDaysKey(inMonth[inMonth.length - 1].key, 1))
  const anyInMonth = inMonth.some((c) => c.events.length > 0 && covered(range, c.key))
  const state = calendarState({ connected, error, hasAny: list.length > 0 })
  const showStamp = list.length > 0 && (stale || connected === false)

  let note = null
  if (state === 'unreachable') note = { text: 'Calendar not connected', quiet: false }
  else if (state === 'ok' && monthKnown && !anyInMonth) note = { text: 'No events this month', quiet: true }

  const cls = [
    'tl-month',
    'tl-knobs',
    titles ? 'tl-month--titles' : 'tl-month--dots',
    dimPast ? 'tl-month--dimpast' : '',
    colorBy === 'none' ? 'tl-month--nocolor' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = {
    '--tl-month-size': String(k.size),
    // A cell's lines: its date, its titles and a "+n" (MonthGridPanel.css).
    '--tl-month-lines': String(titles ? perDay * 1.3 + 2.4 : 3),
  }

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-month__body" style={style}>
      <div className="tl-month__head">
        <div className="tl-month__label" data-edit="monthLabel" data-edit-label="Month">
          {grid.label}
        </div>
        {note && (
          <div className={`tl-month__note${note.quiet ? ' tl-month__note--quiet' : ''}`} data-edit="empty" data-edit-label="Empty message">
            {note.text}
          </div>
        )}
        {showStamp && (
          <div className="tl-month__stamp" data-edit="updated" data-edit-label="Updated">
            <FreshnessStamp fetchedAt={fetchedAt} now={now} error={error || 'stale'} />
          </div>
        )}
      </div>
      <div className="tl-month__weekdays">
        {grid.weekdays.map((w) => (
          <div key={w} className="tl-month__wd" data-edit="weekday" data-edit-label="Weekdays">
            {w}
          </div>
        ))}
      </div>
      <div className="tl-month__grid">
        {grid.cells.map((c) => {
          if (!c.inMonth && !k.showOtherMonths) return <div key={c.key} className="tl-month__cell tl-month__cell--blank" />
          const evs = covered(range, c.key) ? c.events : []
          const cellCls = [
            'tl-month__cell',
            c.inMonth ? '' : 'tl-month__cell--other',
            c.isToday ? 'tl-month__cell--today' : '',
            c.isPast ? 'tl-month__cell--past' : '',
          ]
            .filter(Boolean)
            .join(' ')
          const shown = evs.slice(0, titles ? perDay : MAX_DOTS)
          const more = evs.length - shown.length
          return (
            <div key={c.key} className={cellCls} data-edit="day" data-edit-label="Day">
              <div className="tl-month__num tl-num" data-edit="dayNumber" data-edit-label="Date">
                {c.day}
              </div>
              {titles ? (
                <div className="tl-month__events">
                  {shown.map((v) => (
                    <div
                      key={v.key}
                      className={[
                        'tl-month__ev',
                        v.allDay || v.long ? 'tl-month__ev--allday' : '',
                        dimPast && isOver(v, nowForPast) ? 'tl-month__ev--past' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={(v.allDay || v.long) && v.tint ? { '--tl-month-tint': v.tint } : undefined}
                      data-edit="event"
                      data-edit-label="Event titles"
                    >
                      <ColorBar colors={v.colors} className="tl-month__evbar" />
                      {!(v.allDay || v.long) && <span className="tl-month__evtime tl-num">{tinyClock(v.start, h24)}</span>}
                      <span className="tl-month__evtitle">{v.title}</span>
                    </div>
                  ))}
                  {more > 0 && (
                    <div className="tl-month__more" data-edit="more" data-edit-label="More">
                      +{more}
                    </div>
                  )}
                </div>
              ) : (
                <div className="tl-month__dots">
                  {shown.map((v) => (
                    <ColorDot
                      key={v.key}
                      colors={v.colors}
                      className={`tl-month__dot${dimPast && isOver(v, nowForPast) ? ' tl-month__dot--past' : ''}`}
                      edit="dot"
                      editLabel="Dots"
                    />
                  ))}
                  {more > 0 && (
                    <span className="tl-month__more" data-edit="more" data-edit-label="More">
                      +{more}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {legend && <CalendarLegend entries={legend} />}
    </PanelFrame>
  )
}
