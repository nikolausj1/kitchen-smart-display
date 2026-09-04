import { Fragment } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import './ForecastPanel.css'

// The next few days, today first. Every column shares one grid, so labels,
// icons, temperatures and rain chances line up across the row no matter which
// day is missing what.

// Rain chances below this are left blank rather than shown as a hopeful number.
const POP_FLOOR = 20

export default function ForecastPanel({ days, fetchedAt, now, count = 4, error }) {
  const list = Array.isArray(days) ? days.slice(0, count) : []

  return (
    <PanelFrame
      title="Forecast"
      aside={<FreshnessStamp fetchedAt={fetchedAt} now={now} error={error} />}
      className="tl-fc"
      bodyClassName="tl-fc__body"
    >
      {list.length === 0 ? (
        <div className="tl-fc__empty">No forecast yet</div>
      ) : (
        <div
          className="tl-fc__grid"
          // The column count drives the type size: each column is
          // 100cqw / n wide, and the numerals are sized against that so four
          // days and six days both fit without a layout tuning anything.
          style={{ '--tl-fc-n': String(list.length) }}
        >
          {list.map((day, i) => {
            const pop = day?.precipPct
            const showPop = pop != null && pop >= POP_FLOOR
            return (
              // Four children per day, always. They auto-place down one grid
              // column, so a missing rain chance still has to occupy its cell
              // or the next day would shift up into it.
              <Fragment key={`${day?.label ?? 'day'}-${i}`}>
                <div className="tl-fc__day tl-label">{day?.label || '--'}</div>
                <div className="tl-fc__icon">
                  {day?.iconName && <WeatherIcon name={day.iconName} />}
                </div>
                <div className="tl-fc__temps">
                  <span className="tl-fc__hi tl-num">
                    {day?.highF == null ? '--' : Math.round(day.highF)}
                    <span className="tl-fc__deg">&deg;</span>
                  </span>
                  <span className="tl-fc__lo tl-num">
                    {day?.lowF == null ? '--' : Math.round(day.lowF)}
                    <span className="tl-fc__deg">&deg;</span>
                  </span>
                </div>
                <div className="tl-fc__pop tl-num">{showPop ? `${Math.round(pop)}%` : ''}</div>
              </Fragment>
            )
          })}
        </div>
      )}
    </PanelFrame>
  )
}
