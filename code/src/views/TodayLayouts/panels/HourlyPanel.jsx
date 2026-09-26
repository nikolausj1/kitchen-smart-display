import { useRef } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import useBoxSize from './useBoxSize.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { wmoToIcon } from '../data/wmo.js'
import {
  RAIN_FLOOR,
  curveLevels,
  fmtHour,
  hourlyGrid,
  hoursFrom,
  localHourKey,
  pctOf,
  tempRange,
} from '../lib/weatherPanels.js'
import './HourlyPanel.css'

// HourlyPanel - the next hours, one column each: the hour ("Now" first), the
// sky, the temperature, and on request the rain chance, the feels-like and
// the wind (docs/designs/panels-and-controls.md, chunk 2, "Hourly strip").
//
// hourly: the hub's feed hours (useTodayData d.weather.hourly), each the hour
// STARTING at its time; the strip starts at the hour `now` is in. The first
// column, when it is this hour, shows the current reading (d.weather.current)
// so it agrees with the weather card beside it.
//
// knobs (panels/schemas.js 'hourly'): hours 6..24, columns 'auto' | 6 | 8 |
// 12 (hours past the columns wrap to another row; auto fits the box, in
// balanced rows), style 'columns' | 'curve' (a line through the temperatures
// behind the columns, in a band above the numbers), showRain (every hour's
// chance; from 20 % in the accent, muted below), showFeelsLike, showWind,
// size (the words and numbers; icons and the curve are art).
//
// attribution: the Apple Weather mark while the feed is WeatherKit's.

// The narrowest a column may get before 'auto' wraps the hours: 3.4 % of the
// screen's width, never under 44 px, times the size knob.
const MIN_COL_VW = 0.034
const MIN_COL_PX = 44

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function deg(v) {
  const t = num(v)
  return t == null ? '--' : Math.round(t)
}

// The curve band: a line through the column centres, and a dot on each (the
// current hour's in the accent: `nowIndex`, -1 for a row without it).
function Curve({ levels, cols, nowIndex }) {
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
          className={`tl-hr__dot${p.i === nowIndex ? ' tl-hr__dot--now' : ''}`}
          style={{ left: `${((p.i + 0.5) / cols) * 100}%`, top: `${p.y}%` }}
        />
      ))}
    </div>
  )
}

export default function HourlyPanel({ hourly, current, now, knobs, attribution = null }) {
  const k = panelKnobs('hourly', knobs) || knobDefaults('hourly')
  const n = Math.min(24, Math.max(6, Math.round(Number(k.hours)) || 12))
  const curve = k.style === 'curve'
  const areaRef = useRef(null)
  const box = useBoxSize(areaRef)

  const list = hoursFrom(hourly, now, n)
  const nowKey = now instanceof Date && !Number.isNaN(now.getTime()) ? localHourKey(now) : null
  const cur = current || null
  const hours = list.map((e, i) => {
    const isNow = i === 0 && nowKey != null && String(e.time).slice(0, 13) === nowKey
    const live = isNow && cur ? cur : null
    const pick = (a, b) => (live && num(a) != null ? a : b)
    return {
      key: e.time,
      label: isNow ? 'Now' : fmtHour(e.time),
      isNow,
      tempF: pick(live && live.tempF, e.tempF),
      code: live && typeof live.code === 'number' ? live.code : e.code,
      feelsF: pick(live && (num(live.feelsLikeF) != null ? live.feelsLikeF : live.feelsF), e.feelsF),
      rain: pctOf(e.precipProb),
      windMph: pick(live && live.windMph, e.windMph),
    }
  })

  const minCol = Math.max(MIN_COL_PX, (box.vw || 0) * MIN_COL_VW) * (num(k.size) || 1)
  const grid = hourlyGrid(hours.length, k.columns, box.w, minCol)
  const rows = []
  for (let r = 0; r < grid.rows; r++) rows.push(hours.slice(r * grid.cols, (r + 1) * grid.cols))
  const levels = curve ? curveLevels(hours.map((h) => h.tempF), tempRange(hours.map((h) => h.tempF))) : null

  const style = {
    '--tl-hr-size': String(k.size),
    '--tl-hr-cols': String(Math.max(1, grid.cols)),
    '--tl-hr-rows': String(Math.max(1, grid.rows)),
  }

  return (
    <PanelFrame
      title="Hourly"
      className={`tl-hr tl-knobs${curve ? ' tl-hr--curve' : ''}`}
      bodyClassName="tl-hr__body"
      style={style}
    >
      <div className="tl-hr__area" ref={areaRef}>
        {hours.length === 0 ? (
          <div className="tl-hr__empty" data-edit="empty">
            No hourly forecast yet
          </div>
        ) : (
          rows.map((row, r) => (
            <div className="tl-hr__row" key={row[0].key}>
              {curve && (
                <Curve
                  levels={levels.slice(r * grid.cols, r * grid.cols + row.length)}
                  cols={grid.cols}
                  nowIndex={r === 0 && row[0].isNow ? 0 : -1}
                />
              )}
              {row.map((h, i) => {
                const col = { gridColumn: String(i + 1) }
                const wet = h.rain != null && h.rain >= RAIN_FLOOR
                return [
                  <div
                    key={`${h.key}-h`}
                    className={`tl-hr__hour${h.isNow ? ' tl-hr__hour--now' : ''}`}
                    data-edit="hour"
                    style={col}
                  >
                    {h.label}
                  </div>,
                  <div key={`${h.key}-i`} className="tl-hr__icon" data-edit="icon" style={col}>
                    {h.code != null && <WeatherIcon name={wmoToIcon(h.code)} />}
                  </div>,
                  <div key={`${h.key}-t`} className="tl-hr__temp tl-num" data-edit="temp" data-edit-label="Temperature" style={col}>
                    {deg(h.tempF)}
                    <span className="tl-hr__deg">&deg;</span>
                  </div>,
                  k.showFeelsLike ? (
                    <div key={`${h.key}-f`} className="tl-hr__feels tl-num" data-edit="feels" data-edit-label="Feels like" style={col}>
                      <span className="tl-hr__feels-word">feels </span>
                      {deg(h.feelsF)}&deg;
                    </div>
                  ) : null,
                  k.showRain ? (
                    <div
                      key={`${h.key}-r`}
                      className={`tl-hr__rain tl-num${wet ? ' tl-hr__rain--wet' : ''}`}
                      data-edit="rain"
                      data-edit-label="Rain chance"
                      style={col}
                    >
                      {h.rain == null ? '' : `${h.rain}%`}
                    </div>
                  ) : null,
                  k.showWind ? (
                    <div key={`${h.key}-w`} className="tl-hr__wind tl-num" data-edit="wind" data-edit-label="Wind" style={col}>
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
