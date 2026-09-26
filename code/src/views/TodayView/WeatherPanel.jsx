import WeatherIcon from '../../components/WeatherIcon/WeatherIcon.jsx'
import WeatherAttribution from '../TodayLayouts/panels/WeatherAttribution.jsx'
import './WeatherPanel.css'

// `band` is an optional array of { label, value } segments shown as a slim
// row at the bottom of the weather panel (lunch entree, per-kid activities).
// Rendered only when it has content; absent on no-school/weekend/summer.
//
// `attribution`: the Apple Weather mark while the slots are WeatherKit's
// (hooks/useWeather.js), in the panel's bottom padding at its right edge, out
// of the layout; null (Open-Meteo) draws nothing, as before.
export default function WeatherPanel({ slots, band, attribution = null }) {
  const hasBand = Array.isArray(band) && band.length > 0
  return (
    <section className={`panel weather${hasBand ? ' weather--withband' : ''}${attribution ? ' tl-wx-host' : ''}`}>
      <div className="weather__row">
        {slots.map((slot) => (
          <div className="weather__cell" key={slot.label}>
            <div className="weather__label">{slot.label}</div>
            <div className="weather__icon">
              <WeatherIcon name={slot.iconName} />
            </div>
            <div className="weather__temp">
              {slot.tempF == null ? '--' : slot.tempF}&deg;
            </div>
          </div>
        ))}
      </div>
      {hasBand && (
        <div className="weather__band">
          {band.map((seg, i) => (
            <span className="weather__band-seg" key={`${seg.label}-${i}`}>
              {i > 0 && <span className="weather__band-dot">&bull;</span>}
              <b>{seg.label}</b> {seg.value}
            </span>
          ))}
        </div>
      )}
      <WeatherAttribution attribution={attribution} corner />
    </section>
  )
}
