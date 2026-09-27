import { useMemo } from 'react'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { CalendarLegend, CalendarMessage, ColorBar } from './CalendarParts.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { addDaysKey, tintOf } from '../lib/agenda.js'
import {
  calendarState,
  coversAll,
  hour24Of,
  hourLabel,
  legendOf,
  rangeText,
  shortClock,
  viewEvents,
  weekGrid,
} from '../lib/calendarViews.js'
import './WeekGridPanel.css'

// WeekGridPanel - "Week grid" (docs/designs/panels-and-controls.md, chunk 3):
// a column per day, a row per hour, each timed event a block placed by its
// start and length in its calendar's colour; events that overlap stand side
// by side, three at most, the rest as "+n"; all-day and multi-day events as
// bars in a band across the top; a line at the time now on today. Every
// position is lib/calendarViews.js weekGrid's; this only draws it.
//
// events, calendars, connected, fetchedAt, error, stale, range: the calendar
// store's (hooks/useCalendar.js, through useTodayData's d.calendar). A week
// the store has not been told about (range) is never called empty.
//
// knobs (panels/schemas.js 'weekgrid'): startDay ('today' | 'monday' |
// 'sunday'), days (5..7), startHour (5..12) and endHour (17..24), showAllDay,
// hourLabels, compact (shorter rows: an event on one line, smaller type),
// size, and the shared calendar options showLocation, showEndTime, legend,
// futureOnly, dimPast, consolidate, timeFormat, colorBy. screenHour24: the
// screen's 12 or 24 hour setting for timeFormat 'auto' (none yet: 12-hour).

// A block shorter than this (in hours drawn) has room for one line: its time
// and title run together. Taller, the title gets the lines its height holds
// (about 2.1 lines an hour at the type the hours set, less the time's line),
// so a title never shows half a line at the block's foot.
const SHORT_HOURS = 0.84

function titleLines(hours) {
  return Math.max(1, Math.floor(hours * 2.1 - 0.9))
}

function pct(f) {
  return `${Math.round(f * 1000000) / 10000}%`
}

// A fraction as a length with `px` taken off each side (the gap between
// blocks that meet): 'calc(25% + 1px)' for a start, 'calc(25% - 2px)' for a
// size.
function inset(f, px) {
  return px ? `calc(${pct(f)} ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)` : pct(f)
}

// The words on a block: its start (or start and end), or, for the part of an
// event that began the day before, until when.
function blockTime(v, colKey, h24, showEnd) {
  if (v.startDate < colKey) return `until ${shortClock(v.end, h24)}`
  return showEnd ? rangeText(v.start, v.end, h24) : shortClock(v.start, h24)
}

// One event in a day's column: its colour's tint, a bar in the colour(s), the
// time over the title (short: on one line), the place on request.
function Block({ b, colKey, hourCount, k, h24, dimPast }) {
  const shownHours = b.height * hourCount
  const short = shownHours < SHORT_HOURS
  const cls = [
    'tl-week__block',
    short ? 'tl-week__block--short' : '',
    b.clipTop ? 'tl-week__block--cliptop' : '',
    b.clipBottom ? 'tl-week__block--clipbottom' : '',
    dimPast && b.past ? 'tl-week__block--past' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = {
    top: inset(b.top, 1),
    height: inset(b.height, -2),
    left: inset(b.lane / b.lanes, 1),
    width: inset(1 / b.lanes, -2),
    '--tl-week-tint': tintOf(b.v.color, 0.3) || undefined,
  }
  return (
    <div className={cls} style={style} data-edit="block" data-edit-label="Event">
      <ColorBar colors={b.v.colors} className="tl-week__bbar" />
      <div className="tl-week__btext">
        <span className="tl-week__btime tl-num">{blockTime(b.v, colKey, h24, !!k.showEndTime)}</span>{' '}
        <span className="tl-week__btitle" style={short || k.compact ? undefined : { WebkitLineClamp: titleLines(shownHours) }}>
          {b.v.title}
        </span>
        {k.showLocation && b.v.place && <span className="tl-week__bloc">{b.v.place}</span>}
      </div>
    </div>
  )
}

export default function WeekGridPanel({
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
  const k = panelKnobs('weekgrid', knobs) || knobDefaults('weekgrid')
  const consolidate = !!k.consolidate
  const colorBy = k.colorBy
  const list = useMemo(() => viewEvents(events, { consolidate, colorBy }), [events, consolidate, colorBy])
  const legend = useMemo(() => (k.legend && colorBy !== 'none' ? legendOf(calendars, events) : null), [k.legend, colorBy, calendars, events])
  const h24 = hour24Of(k.timeFormat, screenHour24)
  const valid = now instanceof Date && !Number.isNaN(now.getTime())
  // The grid moves with the minute, not the second.
  const minute = valid ? Math.floor(now.getTime() / 60000) : null
  const { startDay, days, startHour, endHour, futureOnly, compact } = k
  const grid = useMemo(
    () =>
      weekGrid(list, {
        now: minute == null ? null : new Date(minute * 60000),
        startDay,
        days,
        startHour,
        endHour,
        futureOnly: !!futureOnly,
        // Compact type is sized for a line an hour: a block needs most of one.
        minHours: compact ? 0.75 : 0.5,
      }),
    [list, minute, startDay, days, startHour, endHour, futureOnly, compact]
  )
  const cols = grid.columns
  const n = Math.max(1, cols.length)
  const hours = grid.hours
  const band = k.showAllDay ? grid.allDay : null
  const bandMore = band ? band.more.some((m) => m > 0) : false
  const bandRows = band ? band.rowCount + (bandMore ? 1 : 0) : 0
  const dimPast = !!k.dimPast

  const drawn = cols.some((c) => c.blocks.length || c.more.length) || (band && band.rows.length > 0)
  const state = calendarState({ connected, error, hasAny: list.length > 0 })
  const first = cols.length ? cols[0].key : null
  const known = first ? coversAll(range, first, addDaysKey(first, cols.length)) : false
  const showStamp = list.length > 0 && (stale || connected === false)

  let message = null
  if (state === 'unreachable') message = <CalendarMessage>Calendar not connected</CalendarMessage>
  else if (state === 'ok' && !drawn && known) message = <CalendarMessage quiet>Nothing this week</CalendarMessage>

  const title = k.startDay === 'today' ? `Next ${n} days` : 'This week'
  const cls = [
    'tl-week',
    'tl-knobs',
    k.compact ? 'tl-week--compact' : '',
    k.hourLabels ? '' : 'tl-week--nolabels',
    colorBy === 'none' ? 'tl-week--nocolor' : '',
    dimPast ? 'tl-week--dimpast' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = {
    '--tl-week-size': String(k.size),
    '--tl-week-days': String(n),
    '--tl-week-hours': String(Math.max(1, hours.length)),
    '--tl-week-band-rows': String(bandRows),
  }

  return (
    <PanelFrame
      title={title}
      aside={showStamp ? <FreshnessStamp fetchedAt={fetchedAt} now={now} error={error || 'stale'} /> : undefined}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={cls}
      bodyClassName="tl-week__body"
      style={style}
    >
      <div className="tl-week__grid">
        <div className="tl-week__line-row tl-week__heads">
          <div className="tl-week__gutter" />
          <div className="tl-week__days">
            {cols.map((c) => (
              <div
                key={c.key}
                className={`tl-week__head${c.isToday ? ' tl-week__head--today' : ''}${c.isPast ? ' tl-week__head--past' : ''}`}
                data-edit="dayHeader"
                data-edit-label="Day header"
              >
                <span className="tl-week__wd">{c.weekday}</span>
                <span className="tl-week__dn tl-num">{c.dayNum}</span>
              </div>
            ))}
          </div>
        </div>

        {band && bandRows > 0 && (
          <div className="tl-week__line-row tl-week__allday" data-edit="allday" data-edit-label="All-day band">
            <div className="tl-week__gutter" />
            <div className="tl-week__band">
              {band.rows.map((r) => (
                <div
                  key={`${r.v.key}-${r.row}`}
                  className={[
                    'tl-week__bar',
                    r.contLeft ? 'tl-week__bar--from' : '',
                    r.contRight ? 'tl-week__bar--on' : '',
                    dimPast && r.past ? 'tl-week__bar--past' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: inset(r.col / n, 1),
                    width: inset(r.span / n, -2),
                    top: `calc(var(--tl-week-bar-h) * ${r.row})`,
                    '--tl-week-tint': tintOf(r.v.color, 0.3) || undefined,
                  }}
                  data-edit="block"
                  data-edit-label="Event"
                >
                  <ColorBar colors={r.v.colors} className="tl-week__bbar" />
                  <span className="tl-week__bartitle">{r.v.title}</span>
                </div>
              ))}
              {band.more.map((m, i) =>
                m > 0 ? (
                  <div
                    key={`more-${cols[i].key}`}
                    className="tl-week__barmore"
                    style={{ left: pct(i / n), width: pct(1 / n), top: `calc(var(--tl-week-bar-h) * ${band.rowCount})` }}
                    data-edit="more"
                    data-edit-label="More"
                  >
                    +{m}
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        <div className="tl-week__line-row tl-week__area">
          <div className="tl-week__gutter tl-week__hours">
            {k.hourLabels &&
              hours.map((h, i) => (
                <div key={h} className="tl-week__hour tl-num" style={{ top: pct(i / hours.length) }} data-edit="hourLabel" data-edit-label="Hour labels">
                  {hourLabel(h, h24)}
                </div>
              ))}
          </div>
          <div className="tl-week__days tl-week__cols">
            {hours.map((h, i) =>
              i > 0 ? <div key={h} className="tl-week__rule" style={{ top: pct(i / hours.length) }} aria-hidden="true" /> : null
            )}
            {cols.map((c, ci) => (
              <div key={c.key} className={`tl-week__col${c.isToday ? ' tl-week__col--today' : ''}`}>
                {c.blocks.map((b) => (
                  <Block key={b.v.key} b={b} colKey={c.key} hourCount={hours.length} k={k} h24={h24} dimPast={dimPast} />
                ))}
                {c.more.map((m) => (
                  <div
                    key={`more-${m.top}`}
                    className="tl-week__more"
                    style={{ top: inset(m.top, 1), height: inset(m.height, -2), left: inset(m.lane / m.lanes, 1), width: inset(1 / m.lanes, -2) }}
                    data-edit="more"
                    data-edit-label="More"
                  >
                    +{m.count}
                  </div>
                ))}
                {grid.now && grid.now.col === ci && (
                  <div className="tl-week__now" style={{ top: pct(grid.now.top) }} data-edit="nowLine" data-edit-label="Now line" />
                )}
              </div>
            ))}
            {message && <div className="tl-week__message">{message}</div>}
          </div>
        </div>
      </div>
      {legend && <CalendarLegend entries={legend} />}
    </PanelFrame>
  )
}
