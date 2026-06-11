import WeatherIcon from '../../components/WeatherIcon/WeatherIcon.jsx'
import './WeatherPanel.css'

// `band` is an optional array of { label, value } segments shown as a slim
// row at the bottom of the weather panel (lunch entree, per-kid activities).
// Rendered only when it has content; absent on no-school/weekend/summer.
export default function WeatherPanel({ slots, band }) {
  const hasBand = Array.isArray(band) && band.length > 0
  return (
    <section className={`panel weather${hasBand ? ' weather--withband' : ''}`}>
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
    </section>
  )
}
