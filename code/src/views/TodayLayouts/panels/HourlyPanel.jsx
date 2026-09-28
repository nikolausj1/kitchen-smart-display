import { useRef } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import useBoxSize from './useBoxSize.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { wmoToIcon } from '../data/wmo.js'
import { RAIN_FLOOR, curveLevels, hourlyGrid, tempRange } from '../lib/weatherPanels.js'
import { hourlyMoments, nowLineRow } from '../lib/hourlyMoments.js'
import './HourlyPanel.css'

// HourlyPanel - the hourly forecast: a column per moment, its label ("Now",
// "3 PM", "Morning", "7:30 AM"), the sky, the temperature, and on request the
// rain chance, the feels-like and the wind (docs/designs/panels-and-controls.md,
// chunk 2, "Hourly strip", and "The hourly forecast's Show modes").
//
// Which moments, and the header, are lib/hourlyMoments.js's, by the Show knob
// (`mode`): Next hours (the strip as it always was: "Now", the current
// reading, so it agrees with the weather card beside it, then every `step`
// hours for `hours` or through `untilHour`, "Rest of day"), Now until, Whole
// day, Day parts or Set times. Each rolls to tomorrow after its end, the
// header then saying so ("Tomorrow", "Tonight and tomorrow"). A moment that
// is over is dimmed to the muted ink; the current one is drawn as "Now"
// always was (its label in full ink, its dot on the curve in the accent);
// Whole day draws a 2 px accent line where now falls.
//
// hourly, current, daily, moon: the hub's feed (useTodayData d.weather): its
// hours (each the hour STARTING at its time, from today's midnight), the
// current reading, the days (sunrise, sunset, the moon's phase) and today's
// moon. Each icon gets its moment's isDay and moonPhase, so a moment at night
// can draw the night sky.
//
// knobs (panels/schemas.js 'hourly'): mode and each mode's own (range, hours,
// untilHour, step; count, startHour, endHour; times), then for every mode
// columns 'auto' | 6 | 8 | 12 (moments past the columns wrap to another row;
// auto fits the box, in balanced rows), style 'columns' | 'curve' (a line
// through the temperatures behind the columns, in a band above the numbers),
// showRain (every moment's chance; from 20 % in the accent, muted below),
// showFeelsLike, showWind, size (the words and numbers; icons and the curve
// are art) and iconSize. At the defaults (Next hours, every hour, the next
// 12) the strip is what it always was, element for element.
//
// attribution: the Apple Weather mark while the feed is WeatherKit's.

// The narrowest a column may get before 'auto' wraps the moments: 3.4 % of
// the screen's width, never under 44 px, times the size knob.
const MIN_COL_VW = 0.034
const MIN_COL_PX = 44

const EMPTY_TEXT = {
  noTimes: 'No times set',
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function deg(v) {
  const t = num(v)
  return t == null ? '--' : Math.round(t)
}

// A cell's class: its own, and the muted ink when its moment is over.
function cellClass(base, m) {
  return m.past ? `${base} tl-hr__cell--past` : base
}

// The curve band: a line through the column centres, and a dot on each (the
// current moment's in the accent: `nowIndex`, -1 for a row without it; a past
// one's muted).
function Curve({ levels, cols, nowIndex, past }) {
  const pts = []
  levels.forEach((lv, i) => {
    if (lv != null) pts.push({ i, x: (i + 0.5) * 100, y: 14 + lv * 72 })
  })
  const d = pts.map((p, j) => `${j ? 'L' : 'M'}${p.x} ${p.y.toFixed(2)}`).join(' ')
  return (
    <div className="tl-hr__curve" data-edit="curve" data-edit-label="Temperature line">
      <svg className="tl-hr__curve-svg" viewBox={`0 0 ${cols * 100} 100`} preserveAspectRatio="none" aria-hidden="true">
        {pts.length > 1 && <path d={d} fill="none" vectorEffect="non-scaling-stroke" />}
      </svg>
      {pts.map((p) => (
        <span
          key={p.i}
          className={`tl-hr__dot${p.i === nowIndex ? ' tl-hr__dot--now' : ''}${past[p.i] ? ' tl-hr__dot--past' : ''}`}
          style={{ left: `${((p.i + 0.5) / cols) * 100}%`, top: `${p.y}%` }}
        />
      ))}
    </div>
  )
}

export default function HourlyPanel({ hourly, current, daily, moon, now, knobs, attribution = null }) {
  const k = panelKnobs('hourly', knobs) || knobDefaults('hourly')
  const curve = k.style === 'curve'
  const areaRef = useRef(null)
  const box = useBoxSize(areaRef)

  const view = hourlyMoments({ mode: k.mode, knobs: k, now, feed: { hourly, current, daily, moon } })
  const moments = view.moments

  const minCol = Math.max(MIN_COL_PX, (box.vw || 0) * MIN_COL_VW) * (num(k.size) || 1)
  const grid = hourlyGrid(moments.length, k.columns, box.w, minCol)
  const rows = []
  for (let r = 0; r < grid.rows; r++) rows.push(moments.slice(r * grid.cols, (r + 1) * grid.cols))
  const levels = curve ? curveLevels(moments.map((h) => h.tempF), tempRange(moments.map((h) => h.tempF))) : null
  const line = nowLineRow(view.nowLine, moments.length, grid.cols, grid.rows)

  const style = {
    '--tl-hr-size': String(k.size),
    '--tl-hr-icon': String(num(k.iconSize) || 1),
    '--tl-hr-cols': String(Math.max(1, grid.cols)),
    '--tl-hr-rows': String(Math.max(1, grid.rows)),
  }

  return (
    <PanelFrame
      title={view.header}
      className={`tl-hr tl-knobs${curve ? ' tl-hr--curve' : ''}`}
      bodyClassName="tl-hr__body"
      style={style}
    >
      <div className="tl-hr__area" ref={areaRef}>
        {moments.length === 0 ? (
          <div className="tl-hr__empty" data-edit="empty">
            {EMPTY_TEXT[view.empty] || 'No hourly forecast yet'}
          </div>
        ) : (
          rows.map((row, r) => (
            <div className={`tl-hr__row${line && line.row === r ? ' tl-hr__row--now' : ''}`} key={row[0].key}>
              {line && line.row === r && (
                <div
                  className="tl-hr__now"
                  data-edit="nowLine"
                  data-edit-label="Now line"
                  style={{ left: `${(line.x * 100).toFixed(2)}%` }}
                />
              )}
              {curve && (
                <Curve
                  levels={levels.slice(r * grid.cols, r * grid.cols + row.length)}
                  cols={grid.cols}
                  nowIndex={row.findIndex((h) => h.current)}
                  past={row.map((h) => h.past)}
                />
              )}
              {row.map((h, i) => {
                const col = { gridColumn: String(i + 1) }
                const wet = h.rain != null && h.rain >= RAIN_FLOOR
                return [
                  <div
                    key={`${h.key}-h`}
                    className={cellClass(`tl-hr__hour${h.current ? ' tl-hr__hour--now' : ''}`, h)}
                    data-edit="hour"
                    style={col}
                  >
                    {h.label}
                  </div>,
                  <div key={`${h.key}-i`} className={cellClass('tl-hr__icon', h)} data-edit="icon" style={col}>
                    {h.code != null && (
                      <WeatherIcon name={wmoToIcon(h.code)} code={h.code} isDay={h.isDay} moonPhase={h.moonPhase} />
                    )}
                  </div>,
                  <div
                    key={`${h.key}-t`}
                    className={cellClass('tl-hr__temp tl-num', h)}
                    data-edit="temp"
                    data-edit-label="Temperature"
                    style={col}
                  >
                    {h.tempWord ? <span className="tl-hr__temp-word">{h.tempWord} </span> : null}
                    {deg(h.tempF)}
                    <span className="tl-hr__deg">&deg;</span>
                  </div>,
                  k.showFeelsLike ? (
                    <div
                      key={`${h.key}-f`}
                      className={cellClass('tl-hr__feels tl-num', h)}
                      data-edit="feels"
                      data-edit-label="Feels like"
                      style={col}
                    >
                      <span className="tl-hr__feels-word">feels </span>
                      {deg(h.feelsF)}&deg;
                    </div>
                  ) : null,
                  k.showRain ? (
                    <div
                      key={`${h.key}-r`}
                      className={cellClass(`tl-hr__rain tl-num${wet ? ' tl-hr__rain--wet' : ''}`, h)}
                      data-edit="rain"
                      data-edit-label="Rain chance"
                      style={col}
                    >
                      {h.rain == null ? '' : `${h.rain}%`}
                    </div>
                  ) : null,
                  k.showWind ? (
                    <div
                      key={`${h.key}-w`}
                      className={cellClass('tl-hr__wind tl-num', h)}
                      data-edit="wind"
                      data-edit-label="Wind"
                      style={col}
                    >
                      {num(h.windMph) == null ? '--' : Math.round(h.windMph)}
                      <span className="tl-hr__unit"> mph</span>
                    </div>
                  ) : null,
                ]
              })}
            </div>
          ))
        )}
      </div>
      <WeatherAttribution attribution={attribution} />
    </PanelFrame>
  )
}
