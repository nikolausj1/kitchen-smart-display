import { Fragment } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import { panelKnobs } from './schemas.js'
import './ForecastPanel.css'

// The next few days, today first. Every column shares one grid, so labels,
// icons, temperatures and rain chances line up across the row no matter which
// day is missing what.

// Rain chances below this are left blank rather than shown as a hopeful number.
const POP_FLOOR = 20

// knobs (a spec layout, panels/schemas.js 'forecast'): days (the count prop's
// place), size (the words and numbers; the icons are art), showHighLow (off:
// the high only), showIcons.
export default function ForecastPanel({ days, fetchedAt, now, count = 4, error, knobs }) {
  const k = panelKnobs('forecast', knobs)
  const n = k ? Math.min(7, Math.max(1, Math.round(Number(k.days)) || count)) : count
  const list = Array.isArray(days) ? days.slice(0, n) : []
  const showLow = k ? !!k.showHighLow : true
  const showIcons = k ? !!k.showIcons : true

  // The column count drives the type size: each column is 100cqw / n wide,
  // and the numerals are sized against that so four days and six days both
  // fit without a layout tuning anything. Without icons the temperatures take
  // the flexible row.
  const gridStyle = { '--tl-fc-n': String(list.length) }
  if (!showIcons) gridStyle.gridTemplateRows = 'auto minmax(0, 1fr) auto'

  return (
    <PanelFrame
      title="Forecast"
      aside={<FreshnessStamp fetchedAt={fetchedAt} now={now} error={error} />}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={`tl-fc${k ? ' tl-knobs' : ''}`}
      bodyClassName="tl-fc__body"
      style={k ? { '--tl-fc-size': String(k.size) } : undefined}
    >
      {list.length === 0 ? (
        <div className="tl-fc__empty" data-edit="empty">
          No forecast yet
        </div>
      ) : (
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
                    {day?.highF == null ? '--' : Math.round(day.highF)}
                    <span className="tl-fc__deg">&deg;</span>
                  </span>
                  {showLow && (
                    <span className="tl-fc__lo tl-num">
                      {day?.lowF == null ? '--' : Math.round(day.lowF)}
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
      )}
    </PanelFrame>
  )
}
