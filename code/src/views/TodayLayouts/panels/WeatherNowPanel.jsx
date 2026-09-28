import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import WeatherAttribution from './WeatherAttribution.jsx'
import { panelKnobs } from './schemas.js'
import { skyFor } from '../data/wmo.js'
import './WeatherNowPanel.css'

// Right now, outside: one big temperature, the icon, what it is doing, and a
// single compact line of the numbers you would otherwise squint for.
//
// knobs (a spec layout, panels/schemas.js 'weather'): tempSize, iconSize,
// layout ('horizontal': temperature and icon beside the words, the Entry
// board's wide card; 'stacked': the words under them, the Board's tile),
// showHighLow, showRain, showDescription. Without knobs the layout's own CSS
// decides the arrangement, exactly as before.
//
// attribution: the Apple Weather mark while the hub's feed is WeatherKit's
// (useTodayData d.weather.attribution), pinned to the panel's bottom-right
// corner (WeatherAttribution.jsx); null draws nothing, as before.
//
// Night: the current reading's own isDay and moonPhase (the feed's; on the
// Open-Meteo fallback is_day and the moon worked out for `now`: data/wmo.js
// skyFor), so a clear or partly cloudy night draws the moon at tonight's
// phase. An icon from today's forecast, with no current reading, stays a day
// icon.

// Precipitation under 20% is noise on a Seattle display, so it is left off the
// meta line entirely rather than shown as a reassuring "10%".
const POP_FLOOR = 20
// Feels-like only earns a slot when it disagrees with the thermometer.
const FEELS_DELTA = 5

function metaSegments(current, today, showHighLow = true, showRain = true) {
  const segs = []
  if (showHighLow && today?.highF != null) segs.push(`H ${Math.round(today.highF)}`)
  if (showHighLow && today?.lowF != null) segs.push(`L ${Math.round(today.lowF)}`)
  const pop = today?.precipPct
  if (showRain && pop != null && pop >= POP_FLOOR) segs.push(`${Math.round(pop)}% rain`)
  const t = current?.tempF
  const f = current?.feelsLikeF
  if (t != null && f != null && Math.abs(f - t) >= FEELS_DELTA) {
    segs.push(`Feels like ${Math.round(f)}`)
  }
  return segs
}

export default function WeatherNowPanel({ current, today, fetchedAt, now, error, knobs, attribution = null }) {
  const k = panelKnobs('weather', knobs)
  const segs = k ? metaSegments(current, today, k.showHighLow, k.showRain) : metaSegments(current, today)
  // WeatherIcon falls back to the overcast art for an unknown name, so only
  // ask it for an icon when we actually have one.
  const iconName = current?.iconName || today?.iconName || null
  const sky = current?.iconName ? skyFor(current, now) : null
  const hasAnything = current != null || today != null
  const showDescription = k ? k.showDescription : true
  const base = k ? `tl-wnow tl-knobs tl-wnow--${k.layout === 'stacked' ? 'stacked' : 'horizontal'}` : 'tl-wnow'
  const cls = attribution ? `${base} tl-wx-host` : base

  return (
    <PanelFrame
      title="Weather"
      aside={<FreshnessStamp fetchedAt={fetchedAt} now={now} error={error} />}
      asideEdit="updated"
      asideEditLabel="Updated"
      className={cls}
      bodyClassName="tl-wnow__body"
      style={k ? { '--tl-wnow-temp': String(k.tempSize), '--tl-wnow-icon': String(k.iconSize) } : undefined}
    >
      {!hasAnything ? (
        <div className="tl-wnow__empty" data-edit="empty">
          No weather yet
        </div>
      ) : (
        <>
          <div className="tl-wnow__top">
            <div className="tl-wnow__temp tl-num" data-edit="temp" data-edit-label="Temperature">
              {current?.tempF == null ? '--' : Math.round(current.tempF)}
              <span className="tl-wnow__deg">&deg;</span>
            </div>
            {iconName && (
              <div className="tl-wnow__icon" data-edit="icon">
                <WeatherIcon name={iconName} isDay={sky?.isDay} moonPhase={sky?.moonPhase} />
              </div>
            )}
          </div>
          {showDescription && current?.description && (
            <div className="tl-wnow__desc" data-edit="description">
              {current.description}
            </div>
          )}
          {segs.length > 0 && (
            <div className="tl-wnow__meta tl-num" data-edit="range" data-edit-label="High and low">
              {segs.map((seg, i) => (
                <span key={seg}>
                  {i > 0 && <span className="tl-wnow__sep">&middot;</span>}
                  {seg}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <WeatherAttribution attribution={attribution} corner />
    </PanelFrame>
  )
}
