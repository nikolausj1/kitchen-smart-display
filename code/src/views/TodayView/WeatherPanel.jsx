import WeatherIcon from '../../components/WeatherIcon/WeatherIcon.jsx'
import './WeatherPanel.css'

export default function WeatherPanel({ slots }) {
  return (
    <section className="panel weather">
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
    </section>
  )
}
