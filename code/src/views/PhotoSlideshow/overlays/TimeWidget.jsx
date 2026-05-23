import { useEffect, useState } from 'react'
import useWeather, { placeholderSlots } from '../../../hooks/useWeather.js'
import WeatherIcon from '../../../components/WeatherIcon/WeatherIcon.jsx'
import './TimeWidget.css'

// Time widget overlay - bottom-left of the Photo Slideshow.
// Tap to cycle: time -> time+date -> time+date+weather -> time.
// The widget itself is interactive so it does not bubble to the dead-area
// tap that summons the menu pill (the parent slideshow stops menu-pill
// triggering when the event target has [data-interactive="true"]).

const MODES = ['time', 'time-date', 'time-date-weather']

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
]

function format(now) {
  const hour12 = now.getHours() % 12 || 12
  const minute = String(now.getMinutes()).padStart(2, '0')
  return {
    time: `${hour12}:${minute}`,
    date: `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}`,
  }
}

export default function TimeWidget() {
  const [mode, setMode] = useState('time')
  const [now, setNow] = useState(new Date())
  const weather = useWeather()
  const slots = weather.slots || placeholderSlots()

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  function cycle() {
    setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length])
  }

  const { time, date } = format(now)

  return (
    <button
      type="button"
      className="time-widget"
      onClick={cycle}
      data-interactive="true"
      aria-label="Cycle time display"
    >
      <div className="time-widget__time">{time}</div>
      {(mode === 'time-date' || mode === 'time-date-weather') && (
        <div className="time-widget__date">{date}</div>
      )}
      {mode === 'time-date-weather' && (
        <div className="time-widget__weather">
          {slots.map((s) => (
            <div className="time-widget__slot" key={s.label}>
              <div className="time-widget__slot-label">{s.label}</div>
              <div className="time-widget__slot-icon">
                <WeatherIcon name={s.iconName} />
              </div>
              <div className="time-widget__slot-temp">
                {s.tempF == null ? '--' : s.tempF}&deg;
              </div>
            </div>
          ))}
        </div>
      )}
    </button>
  )
}
