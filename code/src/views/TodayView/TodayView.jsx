import { useEffect, useState } from 'react'
import TimeDatePanel from './TimeDatePanel.jsx'
import WeatherPanel from './WeatherPanel.jsx'
import TimerPanel from './TimerPanel.jsx'
import useWeather, { placeholderSlots } from '../../hooks/useWeather.js'
import useTimer from '../../hooks/useTimer.js'
import { postTimerState } from '../../lib/settings.js'
import { useSettings } from '../../lib/settings.js'
import { decideTravelMode } from '../../lib/travelDefault.js'
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
  const { school } = useSettings()
  const weather = useWeather()
  const slots = weather.slots || placeholderSlots()

  // Weather-based default travel mode: read the forecast at the (walking)
  // departure hour and decide drive-vs-walk. The timer uses this as the default
  // when it auto-arms; a manual toggle on the kitchen overrides it for the day.
  const depHour = school?.walkingDepart?.hour ?? 7
  const weatherDefaultMode = decideTravelMode(weather.forecastForHour?.(depHour))
  const timer = useTimer({ weatherDefaultMode })

  useEffect(() => {
    const onPop = () => setDevState(readDevState())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Mirror the live timer to the Pi so the Apple TV can show the same
  // countdown. Push only on MEANINGFUL changes (active flag / target / travel
  // mode / kind) - not the 1Hz minutesLeft tick. The TV recomputes
  // minutesLeft + band itself from targetISO, so we don't need to post those.
  // No-op on the TV surface (postTimerState gates on IS_TV).
  const timerActive = timer.mode === 'active'
  const timerTargetISO =
    timer.mode === 'active' && timer.target instanceof Date && !Number.isNaN(timer.target.getTime())
      ? timer.target.toISOString()
      : null
  useEffect(() => {
    postTimerState({
      active: timerActive,
      travelMode: timer.travelMode,
      targetISO: timerTargetISO,
      kind: timer.kind || null,
    })
  }, [timerActive, timerTargetISO, timer.travelMode, timer.kind])

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
