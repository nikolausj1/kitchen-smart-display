import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import PanelFrame from './PanelFrame.jsx'
import FreshnessStamp from './FreshnessStamp.jsx'
import './WeatherNowPanel.css'

// Right now, outside: one big temperature, the icon, what it is doing, and a
// single compact line of the numbers you would otherwise squint for.

// Precipitation under 20% is noise on a Seattle display, so it is left off the
// meta line entirely rather than shown as a reassuring "10%".
const POP_FLOOR = 20
// Feels-like only earns a slot when it disagrees with the thermometer.
const FEELS_DELTA = 5

function metaSegments(current, today) {
  const segs = []
  if (today?.highF != null) segs.push(`H ${Math.round(today.highF)}`)
  if (today?.lowF != null) segs.push(`L ${Math.round(today.lowF)}`)
  const pop = today?.precipPct
  if (pop != null && pop >= POP_FLOOR) segs.push(`${Math.round(pop)}% rain`)
  const t = current?.tempF
  const f = current?.feelsLikeF
  if (t != null && f != null && Math.abs(f - t) >= FEELS_DELTA) {
    segs.push(`Feels like ${Math.round(f)}`)
  }
  return segs
}

export default function WeatherNowPanel({ current, today, fetchedAt, now, error }) {
  const segs = metaSegments(current, today)
  // WeatherIcon falls back to the overcast art for an unknown name, so only
  // ask it for an icon when we actually have one.
  const iconName = current?.iconName || today?.iconName || null
  const hasAnything = current != null || today != null

  return (
    <PanelFrame
      title="Weather"
      aside={<FreshnessStamp fetchedAt={fetchedAt} now={now} error={error} />}
      className="tl-wnow"
      bodyClassName="tl-wnow__body"
    >
      {!hasAnything ? (
        <div className="tl-wnow__empty">No weather yet</div>
      ) : (
        <>
          <div className="tl-wnow__top">
            <div className="tl-wnow__temp tl-num">
              {current?.tempF == null ? '--' : Math.round(current.tempF)}
              <span className="tl-wnow__deg">&deg;</span>
            </div>
            {iconName && (
              <div className="tl-wnow__icon">
                <WeatherIcon name={iconName} />
              </div>
            )}
          </div>
          {current?.description && <div className="tl-wnow__desc">{current.description}</div>}
          {segs.length > 0 && (
            <div className="tl-wnow__meta tl-num">
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
    </PanelFrame>
  )
}
