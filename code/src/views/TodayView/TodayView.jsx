import { useEffect, useState } from 'react'
import TimeDatePanel from './TimeDatePanel.jsx'
import WeatherPanel from './WeatherPanel.jsx'
import TimerPanel from './TimerPanel.jsx'
import useWeather, { placeholderSlots } from '../../hooks/useWeather.js'
import useTimer from '../../hooks/useTimer.js'
import './TodayView.css'

// Dev-only visual override of the timer state. Lets us preview every Figma
// reference state without waiting for the real timer to tick into it. Use
// ?state=green|yellow|orange|red|noTimer|setTimer in the URL, or click the
// "state:" pill in the bottom-right to cycle. With no override (?state= unset)
// the real timer state machine drives the panel.
const DEV_STATES = ['off', 'green', 'yellow', 'orange', 'red', 'noTimer', 'setTimer']

function readDevState() {
  const params = new URLSearchParams(window.location.search)
  const requested = params.get('state')
  return DEV_STATES.includes(requested) ? requested : 'off'
}

function devOverrideProps(devState, realActions, realTravelMode) {
  // Return null when the dev cycler is off - real state machine takes over.
  if (devState === 'off') return null
  const base = { actions: realActions, travelMode: realTravelMode }
  switch (devState) {
    case 'noTimer':
      return { ...base, mode: 'no-timer' }
    case 'setTimer':
      return { ...base, mode: 'set-timer' }
    case 'green':
      return { ...base, mode: 'active', kind: 'default', minutesLeft: 18, band: 'green', travelMode: 'driving' }
    case 'yellow':
      return { ...base, mode: 'active', kind: 'default', minutesLeft: 5, band: 'yellow', travelMode: 'walking' }
    case 'orange':
      return { ...base, mode: 'active', kind: 'default', minutesLeft: 2, band: 'orange', travelMode: 'walking' }
    case 'red':
      return { ...base, mode: 'active', kind: 'default', minutesLeft: 0, band: 'red', travelMode: 'driving' }
    default:
      return null
  }
}

export default function TodayView() {
  const [devState, setDevState] = useState(readDevState)
  const weather = useWeather()
  const timer = useTimer()
  const slots = weather.slots || placeholderSlots()

  useEffect(() => {
    const onPop = () => setDevState(readDevState())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function cycleDevState() {
    const next = DEV_STATES[(DEV_STATES.indexOf(devState) + 1) % DEV_STATES.length]
    const url = new URL(window.location.href)
    if (next === 'off') url.searchParams.delete('state')
    else url.searchParams.set('state', next)
    window.history.replaceState(null, '', url)
    setDevState(next)
  }

  const override = devOverrideProps(devState, timer.actions, timer.travelMode)
  const timerProps = override || {
    mode: timer.mode,
    kind: timer.kind,
    travelMode: timer.travelMode,
    minutesLeft: timer.minutesLeft,
    band: timer.band,
    actions: timer.actions,
  }

  return (
    <div className="today-view">
      <div className="today-view__left">
        <TimeDatePanel />
        <WeatherPanel slots={slots} />
      </div>
      <div className="today-view__right">
        <TimerPanel {...timerProps} />
      </div>

      {/* Dev-only state cycler removed; URL param ?state=... still works. */}
    </div>
  )
}
