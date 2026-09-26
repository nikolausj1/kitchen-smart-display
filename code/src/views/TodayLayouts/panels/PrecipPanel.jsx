import PanelFrame from './PanelFrame.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { RAIN_LINE, hoursFrom, nextHourStrip, pctOf, rainLabels, rainLevel, rainStep } from '../lib/weatherPanels.js'
import './PrecipPanel.css'

// PrecipPanel - the chance of rain hour by hour, as bars, for the next N
// hours (docs/designs/panels-and-controls.md, chunk 2, "Precipitation
// chart"): an hour label every 3 hours (every 6 past a day), a dashed line at
// 50 %, a bar drawn full strength from there. Above it, when the hub's feed
// has WeatherKit's next-hour minutes and any minute ahead reaches 10 %, a
// "next hour" strip: the minute-by-minute chance and what it adds up to.
//
// hourly: the hub's feed hours (useTodayData d.weather.hourly), each the hour
// STARTING at its time; nextHour: d.weather.nextHour (null for Open-Meteo).
//
// knobs (panels/schemas.js 'precip'): hours 12..48, size (the words; the
// bars are art).
//
// attribution: the Apple Weather mark while the feed is WeatherKit's.

export default function PrecipPanel({ hourly, nextHour, now, knobs, attribution = null }) {
  const k = panelKnobs('precip', knobs) || knobDefaults('precip')
  const n = Math.min(48, Math.max(12, Math.round(Number(k.hours)) || 24))
  const list = hoursFrom(hourly, now, n)
  const strip = nextHourStrip(nextHour, now)
  const labels = rainLabels(list, rainStep(n))
  const last = list.length - 1

  return (
    <PanelFrame
      title="Rain chance"
      className="tl-rain tl-knobs"
      bodyClassName="tl-rain__body"
      style={{ '--tl-rain-size': String(k.size), '--tl-rain-n': String(Math.max(1, list.length)) }}
    >
      {strip && (
        <div className="tl-rain__next" data-edit="nextHour" data-edit-label="Next hour">
          <div className="tl-rain__next-head">
            <span className="tl-rain__next-title">Next hour</span>
            <span className="tl-rain__next-text">{strip.text}</span>
          </div>
          <div className="tl-rain__minutes" aria-hidden="true">
            {strip.chances.map((c, i) => (
              <span key={i} className={`tl-rain__minute${c >= RAIN_LINE ? ' tl-rain__minute--likely' : ''}`} style={{ height: `${c}%` }} />
            ))}
          </div>
          <div className="tl-rain__ticks">
            <span className="tl-rain__tick" data-edit="label">
              Now
            </span>
            <span className="tl-rain__tick" data-edit="label">
              {`${strip.chances.length} min`}
            </span>
          </div>
        </div>
      )}
      {list.length === 0 ? (
        <div className="tl-rain__empty" data-edit="empty">
          No rain forecast yet
        </div>
      ) : (
        <div className="tl-rain__chart">
          <div className="tl-rain__plot">
            <div className="tl-rain__line" aria-hidden="true" />
            <span className="tl-rain__line-label" data-edit="label">
              {`${RAIN_LINE}%`}
            </span>
            {list.map((e) => {
              const p = pctOf(e.precipProb)
              return (
                <div className="tl-rain__slot" key={e.time}>
                  <div
                    className={`tl-rain__bar tl-rain__bar--${rainLevel(p)}`}
                    data-edit="bar"
                    data-edit-label="Bars"
                    style={{ height: `${p == null ? 0 : p}%` }}
                  />
                </div>
              )
            })}
          </div>
          <div className="tl-rain__labels">
            {labels.map((l) => {
              // Centred under its bar; the first and last aligned inward so
              // they never leave the chart.
              const end = l.index === 0 ? 'first' : l.index === last ? 'last' : null
              const pos = end === 'first' ? { left: '0' } : end === 'last' ? { right: '0' } : { left: `${((l.index + 0.5) / list.length) * 100}%` }
              return (
                <span key={l.index} className={`tl-rain__label${end ? ` tl-rain__label--${end}` : ''}`} data-edit="label" style={pos}>
                  {l.text}
                </span>
              )
            })}
          </div>
        </div>
      )}
      <WeatherAttribution attribution={attribution} />
    </PanelFrame>
  )
}
