import { useMemo } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { CalendarLegend, CalendarMessage, ColorBar } from './CalendarParts.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { dateKey } from '../../../lib/schoolDay.js'
import {
  calendarState,
  clockParts,
  dayWord,
  hour24Of,
  legendOf,
  rangeText,
  timeText,
  untilText,
  upNext,
  viewEvents,
} from '../lib/calendarViews.js'
import './UpNextPanel.css'

// UpNextPanel - "Up next" (docs/designs/panels-and-controls.md, chunk 3): the
// next event large, with how long until it starts ("in 40 min", "Tomorrow"),
// its time and, on request, its place and the first line of its
// description; then the events after it, by day. The picking is
// lib/calendarViews.js upNext: the first timed event that has not ended (one
// running now says "Now" and until when), else the first all-day one.
//
// events, calendars, connected, fetchedAt, error, stale: the calendar store's
// (hooks/useCalendar.js, through useTodayData's d.calendar).
//
// knobs (panels/schemas.js 'upnext'): count (rows after the next, 0..6),
// hoursAhead (12..72), nextSize and rowSize, and the shared calendar options
// showLocation, showEndTime, showDescription, legend, consolidate,
// timeFormat, colorBy. screenHour24: the screen's own 12 or 24 hour setting,
// for timeFormat 'auto' (none exists yet: 12-hour).

// A row's time: 'All day'; else the start as the agenda writes it ('5:00' and
// a small 'pm'), or start and end with showEnd.
function RowTime({ v, h24, showEnd }) {
  if (v.allDay) return 'All day'
  if (showEnd) return rangeText(v.start, v.end, h24)
  const { hm, ampm } = clockParts(v.start, h24)
  return (
    <>
      {hm}
      {ampm && <span className="tl-upnext__ampm">{ampm}</span>}
    </>
  )
}

// The rows under the day they fall on (an all-day event under way, today).
function byDay(rows, todayKey) {
  const groups = []
  rows.forEach((v) => {
    const key = v.allDay ? (v.startDate < todayKey ? todayKey : v.startDate) : dateKey(v.start)
    let g = groups.length ? groups[groups.length - 1] : null
    if (!g || g.key !== key) {
      g = { key, label: dayWord(key, todayKey), rows: [] }
      groups.push(g)
    }
    g.rows.push(v)
  })
  return groups
}

export default function UpNextPanel({
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
  const k = panelKnobs('upnext', knobs) || knobDefaults('upnext')
  const consolidate = !!k.consolidate
  const colorBy = k.colorBy
  const list = useMemo(() => viewEvents(events, { consolidate, colorBy }), [events, consolidate, colorBy])
  const legend = useMemo(() => (k.legend && colorBy !== 'none' ? legendOf(calendars, events) : null), [k.legend, colorBy, calendars, events])
  const valid = now instanceof Date && !Number.isNaN(now.getTime())
  const todayKey = valid ? dateKey(now) : null
  const h24 = hour24Of(k.timeFormat, screenHour24)
  const { next, rows, more } = upNext(list, now, { hoursAhead: k.hoursAhead, count: k.count })
  const groups = todayKey ? byDay(rows, todayKey) : []
  const state = calendarState({ connected, error, hasAny: list.length > 0 })
  const showStamp = list.length > 0 && (stale || connected === false)

  // The list's type is sized so its rows fit (UpNextPanel.css): a line per
  // row and per day label, and one for "+n more".
  const lines = rows.length * 1.5 + groups.length * 1.3 + (more > 0 ? 1.3 : 0)
  const style = {
    '--tl-upnext-next': String(k.nextSize),
    '--tl-upnext-row': String(k.rowSize),
    '--tl-upnext-lines': String(Math.max(4, Math.round(lines * 100) / 100)),
  }

  let body
  if (state === 'unreachable') body = <CalendarMessage>Calendar not connected</CalendarMessage>
  else if (!next) body = state === 'loading' ? null : <CalendarMessage quiet>Nothing coming up</CalendarMessage>
  else {
    const when = untilText(next, now)
    const time = timeText(next, now, h24, !!k.showEndTime)
    body = (
      <>
        <div className={`tl-upnext__next${next.allDay ? ' tl-upnext__next--allday' : ''}`} data-edit="next" data-edit-label="Next event">
          <ColorBar colors={next.colors} className="tl-upnext__bar" />
          <div className="tl-upnext__main">
            <div className="tl-upnext__title">{next.title}</div>
            <div className="tl-upnext__when">
              <span className={`tl-upnext__in${when === 'Now' ? ' tl-upnext__in--now' : ''}`} data-edit="nextIn" data-edit-label="Starts in">
                {when}
              </span>
              <span className="tl-upnext__sep" aria-hidden="true">
                {' · '}
              </span>
              <span className="tl-upnext__time tl-num" data-edit="nextTime" data-edit-label="Time">
                {time}
              </span>
            </div>
            {k.showLocation && next.place && (
              <div className="tl-upnext__loc" data-edit="nextLocation" data-edit-label="Location">
                {next.place}
              </div>
            )}
            {k.showDescription && next.description && (
              <div className="tl-upnext__desc" data-edit="description" data-edit-label="Description">
                {next.description}
              </div>
            )}
          </div>
        </div>
        {groups.length > 0 && (
          <div className="tl-upnext__rows" data-edit="rows" data-edit-label="Following events">
            <div className="tl-upnext__list">
              {groups.map((g) => (
                <div key={g.key} className="tl-upnext__group">
                  <div className="tl-upnext__day" data-edit="day" data-edit-label="Day">
                    {g.label}
                  </div>
                  {g.rows.map((v) => (
                    <div
                      key={v.key}
                      className={`tl-upnext__row${v.allDay ? ' tl-upnext__row--allday' : ''}`}
                      style={v.allDay && v.tint ? { '--tl-upnext-tint': v.tint } : undefined}
                      data-edit="row"
                      data-edit-label="Event"
                    >
                      <ColorBar colors={v.colors} className="tl-upnext__rbar" />
                      <span className="tl-upnext__rtime tl-num" data-edit="time" data-edit-label="Event time">
                        <RowTime v={v} h24={h24} showEnd={!!k.showEndTime} />
                      </span>
                      <span className="tl-upnext__rtitle">{v.title}</span>
                    </div>
                  ))}
                </div>
              ))}
              {more > 0 && <div className="tl-upnext__more">+{more} more</div>}
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <PanelFrame
      title="Up next"
      aside={showStamp ? <FreshnessStamp fetchedAt={fetchedAt} now={now} error={error || 'stale'} /> : undefined}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={`tl-upnext tl-knobs${k.showEndTime ? ' tl-upnext--ends' : ''}${h24 ? ' tl-upnext--h24' : ''}`}
      bodyClassName="tl-upnext__body"
      style={style}
    >
      {body}
      {legend && <CalendarLegend entries={legend} />}
    </PanelFrame>
  )
}
