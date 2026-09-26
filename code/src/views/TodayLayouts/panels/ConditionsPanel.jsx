import { useRef } from 'react'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import useBoxSize from './useBoxSize.js'
import { knobDefaults, panelKnobs } from './schemas.js'
import { conditionRows, conditionsColumns } from '../lib/weatherPanels.js'
import './ConditionsPanel.css'

// ConditionsPanel - the numbers behind "now", picked row by row: feels like,
// humidity, wind, gusts, UV index, pressure, visibility, dew point, sunrise,
// sunset, cloud cover (docs/designs/panels-and-controls.md, chunk 2,
// "Conditions detail"), under a line with the sky's icon and its word.
//
// current: the weather card's current conditions with the hub feed's other
// readings under them (useTodayData d.weather.current); sunrise, sunset:
// today's, as Dates. A reading the source does not have shows '--' (the
// direct Open-Meteo fallback carries only the card's own few).
//
// knobs (panels/schemas.js 'conditions'): a show toggle per row (default:
// feels like, humidity, wind, UV, sunrise, sunset), showCondition (the icon
// line), layout 'auto' | 'one' | 'two' (auto: two columns when that gives the
// rows bigger type, which is when the box is wide), size.
//
// attribution: the Apple Weather mark while the feed is WeatherKit's.

export default function ConditionsPanel({ current, sunrise, sunset, knobs, attribution = null }) {
  const k = panelKnobs('conditions', knobs) || knobDefaults('conditions')
  const gridRef = useRef(null)
  const box = useBoxSize(gridRef)
  const rows = conditionRows(k, current, { sunrise, sunset })
  const cols = conditionsColumns(k.layout, box.w, box.h, rows.length)
  const perCol = Math.max(1, Math.ceil(rows.length / cols))
  const code = current && typeof current.code === 'number' ? current.code : null
  const showHead = !!k.showCondition && current != null && code != null

  return (
    <PanelFrame
      title="Conditions"
      className="tl-cond tl-knobs"
      bodyClassName="tl-cond__body"
      style={{ '--tl-cond-size': String(k.size), '--tl-cond-cols': String(cols), '--tl-cond-rows': String(perCol) }}
    >
      {showHead && (
        <div className="tl-cond__head">
          <div className="tl-cond__icon" data-edit="icon">
            <WeatherIcon name={current.iconName || 'overcast'} />
          </div>
          <div className="tl-cond__condition" data-edit="condition">
            {current.description || ''}
          </div>
        </div>
      )}
      <div className="tl-cond__area" ref={gridRef}>
        {current == null || rows.length === 0 ? (
          <div className="tl-cond__empty" data-edit="empty">
            {current == null ? 'No conditions yet' : 'No rows chosen'}
          </div>
        ) : (
          <div className="tl-cond__grid">
            {rows.map((r, i) => (
              <div
                className={`tl-cond__row${i % perCol === perCol - 1 || i === rows.length - 1 ? ' tl-cond__row--last' : ''}`}
                key={r.key}
                style={{ gridColumn: String(Math.floor(i / perCol) + 1), gridRow: String((i % perCol) + 1) }}
              >
                <span className="tl-cond__label" data-edit="label">
                  {r.label}
                </span>
                <span className="tl-cond__value tl-num" data-edit="value">
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <WeatherAttribution attribution={attribution} />
    </PanelFrame>
  )
}
