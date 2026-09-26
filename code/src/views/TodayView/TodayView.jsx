import { useEffect, useState } from 'react'
import TimeDatePanel from './TimeDatePanel.jsx'
import WeatherPanel from './WeatherPanel.jsx'
import TimerPanel from './TimerPanel.jsx'
import useWeather, { placeholderSlots } from '../../hooks/useWeather.js'
import useTimer from '../../hooks/useTimer.js'
import useLunch from '../../hooks/useLunch.js'
import useSchoolCalendar from '../../hooks/useSchoolCalendar.js'
import { useSettings } from '../../lib/settings.js'
import { decideTravelMode } from '../../lib/travelDefault.js'
import {
  isNoSchoolToday,
  lunchEntreeForToday,
  grabForToday,
  activitiesForToday,
} from '../../lib/schoolDay.js'
import './TodayView.css'

// Dev-only visual override of the timer state. Lets us preview every Figma
// reference state without waiting for the real timer to tick into it. Use
// ?state=green|yellow|orange|red|noTimer|setTimer in the URL. With no override
// (?state= unset) the real, house-shared countdown drives the panel.
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
  // departure hour and decide drive-vs-walk. Only a fallback now: the timer
  // follows the hub's house-wide travelDefault once the hub has answered, and
  // a manual toggle on any screen overrides both for the day.
  const depHour = school?.walkingDepart?.hour ?? 7
  const weatherDefaultMode = decideTravelMode(weather.forecastForHour?.(depHour))
  const timer = useTimer({ weatherDefaultMode })

  useEffect(() => {
    const onPop = () => setDevState(readDevState())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // (No timer mirroring here any more. The countdown is shared through the
  // hub: taps write decisions via useTimer, and the hub derives the timer the
  // Apple TV shows from the same decisions with the same code.)

  const override = devOverrideProps(devState, timer.actions, timer.travelMode)
  const timerProps = override || {
    mode: timer.mode,
    kind: timer.kind,
    travelMode: timer.travelMode,
    minutesLeft: timer.minutesLeft,
    band: timer.band,
    actions: timer.actions,
  }

  // School-schedule data. Dev params for previewing without the Pi endpoints:
  //   ?noschool=1  force the no-school full-width layout
  //   ?demo=1      inject a sample lunch + activities band
  const params = new URLSearchParams(window.location.search)
  const demo = params.get('demo') === '1'
  const forceNoSchool = params.get('noschool') === '1'

  const calendar = useSchoolCalendar()
  const lunch = useLunch()
  const now = new Date()
  const noSchool = forceNoSchool || isNoSchoolToday(school, calendar, now)

  const entree = demo ? "Chef's Choice" : lunchEntreeForToday(lunch, now)
  const grab = demo ? 'Turkey and Cheese Wrap' : grabForToday(lunch, now)
  const activities = demo
    ? [{ name: 'Vinny', label: 'Library' }, { name: 'Chase', label: 'Coding' }]
    : activitiesForToday(school, now)

  // Slim band segments, suppressed on no-school days.
  const band = noSchool
    ? []
    : [
        ...(entree ? [{ label: 'Lunch', value: entree }] : []),
        ...(grab ? [{ label: 'Grab & Go', value: grab }] : []),
        ...activities.map((a) => ({ label: a.name, value: a.label })),
      ]

  // No school: drop the timer column and let time + weather span full width
  // (no message), matching the Apple TV no-timer layout.
  if (noSchool) {
    return (
      <div className="today-view today-view--noschool">
        <div className="today-view__left">
          <TimeDatePanel />
          <WeatherPanel slots={slots} band={band} attribution={weather.attribution} />
        </div>
      </div>
    )
  }

  return (
    <div className="today-view">
      <div className="today-view__left">
        <TimeDatePanel />
        <WeatherPanel slots={slots} band={band} attribution={weather.attribution} />
      </div>
      <div className="today-view__right">
        <TimerPanel {...timerProps} />
      </div>

      {/* Dev-only state cycler removed; URL param ?state=... still works. */}
    </div>
  )
}
