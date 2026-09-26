import { Fragment } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import { panelKnobs } from './schemas.js'
import { bandScale, bandSpan } from '../lib/weatherPanels.js'
import './ForecastPanel.css'

// The next few days, today first. Every column shares one grid, so labels,
// icons, temperatures and rain chances line up across the row no matter which
// day is missing what.

// Rain chances below this are left blank rather than shown as a hopeful number.
const POP_FLOOR = 20

// knobs (a spec layout, panels/schemas.js 'forecast'): days (the count prop's
// place), size (the words and numbers; the icons are art), showHighLow (off:
// the high only), showIcons, style: 'rows' (the days side by side, as it has
// always been) or 'band' (a day per line: its icon at the left, then a bar
// from its low to its high placed on the whole period's range, the low and
// the high at the bar's two ends, as in a ten-day forecast).
//
// attribution: the Apple Weather mark while the hub's feed is WeatherKit's
// (WeatherAttribution.jsx), a line at the foot of the panel; null draws
// nothing, as before.

function temp(v) {
  return v == null ? '--' : Math.round(v)
}

function Rows({ list, showLow, showIcons }) {
  // The column count drives the type size: each column is 100cqw / n wide,
  // and the numerals are sized against that so four days and six days both
  // fit without a layout tuning anything. Without icons the temperatures take
  // the flexible row.
  const gridStyle = { '--tl-fc-n': String(list.length) }
  if (!showIcons) gridStyle.gridTemplateRows = 'auto minmax(0, 1fr) auto'
  return (
    <div className={`tl-fc__grid${showIcons ? '' : ' tl-fc__grid--noicons'}`} style={gridStyle}>
      {list.map((day, i) => {
        const pop = day?.precipPct
        const showPop = pop != null && pop >= POP_FLOOR
        return (
          // Four children per day, always (three without icons, over three
          // rows), each on its own row (ForecastPanel.css), so a day fills
          // one grid column; a missing rain chance still occupies its cell.
          <Fragment key={`${day?.label ?? 'day'}-${i}`}>
            <div className="tl-fc__day tl-label" data-edit="day">
              {day?.label || '--'}
            </div>
            {showIcons && (
              <div className="tl-fc__icon" data-edit="icon">
                {day?.iconName && <WeatherIcon name={day.iconName} />}
              </div>
            )}
            <div className="tl-fc__temps" data-edit="temps" data-edit-label="Temperatures">
              <span className="tl-fc__hi tl-num">
                {temp(day?.highF)}
                <span className="tl-fc__deg">&deg;</span>
              </span>
              {showLow && (
                <span className="tl-fc__lo tl-num">
                  {temp(day?.lowF)}
                  <span className="tl-fc__deg">&deg;</span>
                </span>
              )}
            </div>
            <div className="tl-fc__pop tl-num" data-edit="rain" data-edit-label="Rain chance">
              {showPop ? `${Math.round(pop)}%` : ''}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

// A day per line, every cell on its day's grid row and in its own column, so
// the columns line up down the panel and a hidden cell (an element style)
// leaves its column empty rather than shifting the line.
function Band({ list, showLow, showIcons }) {
  const scale = bandScale(list)
  return (
    <div className="tl-fc__band" style={{ '--tl-fc-n': String(list.length) }}>
      {list.map((day, i) => {
        const pop = day?.precipPct
        const showPop = pop != null && pop >= POP_FLOOR
        const span = bandSpan(day?.lowF, day?.highF, scale)
        const row = { gridRow: String(i + 1) }
        return (
          <Fragment key={`${day?.label ?? 'day'}-${i}`}>
            <div className="tl-fc__bday tl-label" data-edit="day" style={row}>
              {day?.label || '--'}
            </div>
            {showIcons && (
              <div className="tl-fc__bicon" data-edit="icon" style={row}>
                <div className="tl-fc__bicon-art">{day?.iconName && <WeatherIcon name={day.iconName} />}</div>
                {showPop && (
                  <div className="tl-fc__bpop tl-num" data-edit="rain" data-edit-label="Rain chance">
                    {`${Math.round(pop)}%`}
                  </div>
                )}
              </div>
            )}
            {!showIcons && (
              <div className="tl-fc__bpop tl-fc__bpop--alone tl-num" data-edit="rain" data-edit-label="Rain chance" style={row}>
                {showPop ? `${Math.round(pop)}%` : ''}
              </div>
            )}
            {showLow && (
              <div className="tl-fc__blo tl-num" data-edit="temps" data-edit-label="Low" style={row}>
                {temp(day?.lowF)}
                <span className="tl-fc__deg">&deg;</span>
              </div>
            )}
            <div className="tl-fc__track" data-edit="bar" data-edit-label="High-low bar" style={row}>
              {span && <span className="tl-fc__seg" style={{ left: `${span.left}%`, width: `${span.width}%` }} />}
            </div>
            <div className="tl-fc__bhi tl-num" data-edit="temps" data-edit-label="High" style={row}>
              {temp(day?.highF)}
              <span className="tl-fc__deg">&deg;</span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

export default function ForecastPanel({ days, fetchedAt, now, count = 4, error, knobs, attribution = null }) {
  const k = panelKnobs('forecast', knobs)
  const n = k ? Math.min(7, Math.max(1, Math.round(Number(k.days)) || count)) : count
  const list = Array.isArray(days) ? days.slice(0, n) : []
  const showLow = k ? !!k.showHighLow : true
  const showIcons = k ? !!k.showIcons : true
  const band = !!k && k.style === 'band'

  return (
    <PanelFrame
      title="Forecast"
      aside={<FreshnessStamp fetchedAt={fetchedAt} now={now} error={error} />}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={`tl-fc${k ? ' tl-knobs' : ''}${band ? ' tl-fc--band' : ''}`}
      bodyClassName="tl-fc__body"
      style={k ? { '--tl-fc-size': String(k.size) } : undefined}
    >
      {list.length === 0 ? (
        <div className="tl-fc__empty" data-edit="empty">
          No forecast yet
        </div>
      ) : band ? (
        <Band list={list} showLow={showLow} showIcons={showIcons} />
      ) : (
        <Rows list={list} showLow={showLow} showIcons={showIcons} />
      )}
      <WeatherAttribution attribution={attribution} />
    </PanelFrame>
  )
}
