import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSettings } from '../../../lib/settings.js'
import useWeather from '../../../hooks/useWeather.js'
import useTimer from '../../../hooks/useTimer.js'
import useSonosState from '../../../hooks/useSonosState.js'
import useImmichPhotos from '../../../hooks/useImmichPhotos.js'
import useLunch from '../../../hooks/useLunch.js'
import useSchoolCalendar from '../../../hooks/useSchoolCalendar.js'
import useCalendar from '../../../hooks/useCalendar.js'
import { useHouseState } from '../../../lib/houseState.js'
import { decideTravelMode } from '../../../lib/travelDefault.js'
import {
  dateKey,
  isNoSchoolToday,
  lunchEntreeForToday,
  grabForToday,
  activitiesForToday,
} from '../../../lib/schoolDay.js'
import { fmtDayShort, greetingFor } from '../lib/format.js'
import { moonPhase } from '../lib/sun.js'
import { decideWear } from '../lib/wear.js'
import { buildAgendaDays, countdownsFor } from '../lib/agenda.js'
import useDailyForecast from './useDailyForecast.js'
import { useDemoMode } from './demoMode.js'
import { wmoToIcon, wmoDescription } from './wmo.js'
import {
  DEMO_AIR_QUALITY,
  DEMO_FORCE_WEATHER,
  DEMO_HEADLINE,
  DEMO_MUSIC,
  DEMO_SCHOOL,
  DEMO_TIMER,
  DEMO_TIMER_MINUTES,
  demoCalendar,
  demoFeed,
  demoWeather,
} from './demo.js'

// useTodayData - the single data hook every new Today layout calls. Layouts
// call it once and hand slices to purely presentational panels, which is what
// lets the same panel render on the dark Board and the light Briefing page.
//
// Deliberately NOT here: posting any timer state. The countdown is shared
// through the hub now: useTimer writes only user decisions (lib/houseState.js),
// every screen derives the timer from them, and the hub derives the Apple TV's
// copy with the same code. No layout posts anything, so two layouts (or two
// screens) cannot fight over what the TV shows.
//
// Returns { now, demo, greeting, settings, weather, moon, school, timer, wear,
// music, photos, calendar, agendaDays, countdowns, headline, airQuality,
// weatherAlerts }. The Entry board's five (docs/designs/entry-board.md):
//   calendar    the hooks/useCalendar.js snapshot: { events, countdowns,
//               calendars, connected, fetchedAt, error, stale }
//   agendaDays  [{ dateKey, date, label: 'Today' | 'Tomorrow' | weekday,
//               events: [{ key, id, title, allDay, start, end, color, tint,
//               calendarLabel }] }] for today and the next AGENDA_DAYS_MAX - 1
//               days: the agenda's knobs (days 1..5 from today or tomorrow,
//               panels/schemas.js) pick their columns from these
//               (AgendaPanel.jsx sliceAgendaDays)
//   countdowns  calendar.countdowns with daysLeft recounted against today
//   headline    the hub's { text, kind, eventId, until }, or null when the hub
//               has not said so today (the layout decides the fallback)
//   airQuality  the hub's { pm25, aqi, label, fetchedAt }, or null
// and weatherAlerts: the hub's NWS alerts in force ([{ event, severity, until,
// headline }], /api/state), or null while the house state does not carry
// them (lib/houseState.js keeps only the keys it knows; the layouts then read
// an alert off the headline). The spec layouts' alertActive rule reads it.
//
// weather: what the weather card, the forecast and the sun arc have always
// read, { current, today, days, sunrise, sunset, forecastForHour, fetchedAt,
// stale, error }, and with it the hub's whole weather feed
// (hooks/useHubWeather.js, docs/designs/panels-and-controls.md chunk 2) for
// the weather panels: source ('weatherkit' | 'open-meteo', null with no
// weather), hourly, daily, nextHour, alerts, sun, moon, attribution (Apple's
// mark while WeatherKit's data is what is shown, else null). `current` gains
// the feed's readings (humidity, dewF, gustMph, windDir, pressureMb,
// visibilityMi, uv, cloudCover, ...) under the card's own keys. When the hooks
// fall back to Open-Meteo directly the feed keys are empty (source
// 'open-meteo'); in demo mode with no live weather they are data/demo.js's
// demoFeed.

// URL params, parsed ONCE at module load the way lib/kioskMode.js does.
// Reading window.location in a render body trips the React Compiler purity
// rule, and this flag never changes for the life of the page anyway. Demo mode
// is NOT here: ?demo=1 seeds a store (demoMode.js) the layout editor can flip.
function readFlags() {
  if (typeof window === 'undefined') return { forceNoSchool: false }
  const p = new URLSearchParams(window.location.search)
  return {
    forceNoSchool: p.get('noschool') === '1',
  }
}
const FLAGS = readFlags()

// Days of agenda handed to the layouts: the agenda's widest setting, five
// columns starting tomorrow, needs six. Keep it in step with the days the
// calendar hook asks the hub for (hooks/useCalendar.js DAYS, also 6): a day
// past those would read "Nothing scheduled" whatever the calendar holds.
const AGENDA_DAYS_MAX = 6

// The feed keys when there is no feed: one frozen object each, so memos hold.
const NO_LIST = Object.freeze([])
const NO_SUN = Object.freeze({ sunrise: null, sunset: null })
const NO_MOON = Object.freeze({ phase: null, name: null })

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export default function useTodayData() {
  // Three clocks, one interval. `now` ticks every second for the display;
  // `hourNow` and `today` change only when they really do, so everything
  // memoised against them keeps its object identity between ticks.
  const [now, setNow] = useState(() => new Date())
  const [hourNow, setHourNow] = useState(() => new Date().getHours())
  const [today, setToday] = useState(() => startOfDay(new Date()))

  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date()
      setNow(d)
      setHourNow(d.getHours())
      setToday((prev) => (isSameDay(prev, d) ? prev : startOfDay(d)))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // Demo mode: ?demo=1, or the layout editor's "sample data" switch. Values
  // that depend on the clock are anchored to the moment it turned on (`since`,
  // set by the store, outside render), so the fixture does not slide forward
  // every second.
  const { on: demo, since: demoSince } = useDemoMode()
  const demoTarget = useMemo(
    () => (demo && demoSince != null ? new Date(demoSince + DEMO_TIMER_MINUTES * 60_000) : null),
    [demo, demoSince]
  )
  const demoFetchedAt = demo ? demoSince : null
  const demoCalendarData = useMemo(
    () => (demo && demoSince != null ? demoCalendar(startOfDay(new Date(demoSince))) : null),
    [demo, demoSince]
  )

  const settings = useSettings()
  const schoolSettings = settings.school

  const weather = useWeather()          // hourly block: forecastForHour + fallback
  const daily = useDailyForecast()      // daily + current block

  // Weather-based default travel mode, exactly as views/TodayView does it: read
  // the forecast at the walking departure hour and decide drive vs walk. Only a
  // fallback until the hub's shared travelDefault arrives; a manual toggle on
  // any screen wins for the rest of the day.
  const depHour = schoolSettings?.walkingDepart?.hour ?? 7
  const weatherDefaultMode = decideTravelMode(weather.forecastForHour?.(depHour))
  const timerState = useTimer({ weatherDefaultMode })

  const sonos = useSonosState()
  const photoData = useImmichPhotos()
  const lunch = useLunch()
  const calendar = useSchoolCalendar()
  const liveCalendar = useCalendar()
  const house = useHouseState()

  const todayKey = useMemo(() => dateKey(today), [today])

  // useWeather rebuilds forecastForHour on every render, which would churn the
  // weather object identity once a second. Hand consumers a stable wrapper over
  // the latest one instead (ref updated in an effect, read only when called).
  const forecastForHourRef = useRef(weather.forecastForHour)
  useEffect(() => {
    forecastForHourRef.current = weather.forecastForHour
  })
  const forecastForHour = useCallback((hour) => {
    const fn = forecastForHourRef.current
    return fn ? fn(hour) : null
  }, [])

  // This hour's reading from the hourly block, kept as scalars so it can be a
  // memo dependency. Used only when the daily+current call has nothing.
  const hourlyNow = weather.forecastForHour?.(hourNow) || null
  const hourlyNowTempF = hourlyNow?.tempF ?? null
  const hourlyNowCode = hourlyNow?.code ?? null

  const demoWeatherView = useMemo(() => (demo ? demoWeather(today) : null), [demo, today])
  const demoFeedData = useMemo(
    () => (demo && demoSince != null ? demoFeed(demoSince) : null),
    [demo, demoSince]
  )

  // The demo weather fixture is a last resort: real data always wins, so a demo
  // screenshot taken on the wall shows the real sky outside the window.
  // ?demoWeather=1 asks for the fixture anyway (data/demo.js demoFeed).
  const haveLiveForecast = !!(daily.current || daily.days.length)
  const usingDemoWeather = demo && (DEMO_FORCE_WEATHER || !haveLiveForecast)
  const source = usingDemoWeather ? demoWeatherView : daily

  const liveFetchedAt = daily.fetchedAt ?? weather.fetchedAt ?? null

  // The hub's feed behind what is shown: the live one when the daily view came
  // from it (not from the Open-Meteo fallback), the demo one with the demo
  // weather. Its keys go out beside the card's own.
  const feed = usingDemoWeather ? demoFeedData : daily.feed || null
  const feedCurrent = feed ? feed.current : null

  // Past days are dropped so days[0] really is today, which is what the panels
  // are told to assume. A cache written yesterday evening is still inside its
  // 12h window after midnight and would otherwise lead with a day that is over.
  const days = useMemo(
    () =>
      (source?.days || [])
        .filter((d) => d.dateKey >= todayKey)
        .map((d) => ({
          ...d,
          label: d.dateKey === todayKey ? 'Today' : fmtDayShort(d.date),
        })),
    [source, todayKey]
  )

  // Today's row from the daily block. Pulled out here rather than read back off
  // the weather object below, because the compiler's ref rule treats any object
  // carrying a `current` key as a ref and refuses property reads on it.
  const todayDay = useMemo(
    () => days.find((d) => d.dateKey === todayKey) || days[0] || null,
    [days, todayKey]
  )

  const currentOut = useMemo(() => {
    const live = source?.current || null
    if (live) return live
    // Fallback: same API, same location, just the other block. An hourly
    // forecast for the current hour is an honest stand-in for "now"; inventing
    // a number would not be.
    if (hourlyNowTempF == null && hourlyNowCode == null) return null
    return {
      tempF: hourlyNowTempF,
      feelsLikeF: null,
      code: hourlyNowCode,
      iconName: wmoToIcon(hourlyNowCode),
      description: wmoDescription(hourlyNowCode),
      windMph: null,
      isDay: null,
    }
  }, [source, hourlyNowTempF, hourlyNowCode])

  // The card's current conditions, with the feed's other readings under them.
  const currentMerged = useMemo(
    () => (currentOut && feedCurrent ? { ...feedCurrent, ...currentOut } : currentOut),
    [currentOut, feedCurrent]
  )

  const weatherOut = useMemo(
    () => ({
      current: currentMerged,
      today: todayDay
        ? {
            highF: todayDay.highF,
            lowF: todayDay.lowF,
            precipPct: todayDay.precipPct,
            code: todayDay.code,
            iconName: todayDay.iconName,
          }
        : null,
      days,
      sunrise: todayDay?.sunrise || source?.sunrise || null,
      sunset: todayDay?.sunset || source?.sunset || null,
      forecastForHour,
      fetchedAt: usingDemoWeather ? demoFetchedAt : liveFetchedAt,
      // The demo fixture is not stale and did not fail; a live error belongs to
      // data we are not showing right now.
      stale: usingDemoWeather ? false : !!daily.stale,
      error: usingDemoWeather ? null : daily.error ?? null,
      // The hub's feed, for the weather panels.
      source: feed ? feed.source : haveLiveForecast ? 'open-meteo' : null,
      hourly: feed ? feed.hourly : NO_LIST,
      daily: feed ? feed.daily : NO_LIST,
      nextHour: feed ? feed.nextHour : null,
      alerts: feed ? feed.alerts : NO_LIST,
      sun: feed ? feed.sun : NO_SUN,
      moon: feed ? feed.moon : NO_MOON,
      attribution: feed && feed.source === 'weatherkit' ? feed.attribution : null,
    }),
    [
      currentMerged,
      todayDay,
      days,
      source,
      forecastForHour,
      usingDemoWeather,
      demoFetchedAt,
      liveFetchedAt,
      daily.stale,
      daily.error,
      feed,
      haveLiveForecast,
    ]
  )

  // Taken at local midday so the label does not lead or lag by half a day at a
  // phase boundary. Only changes when the date does.
  const moon = useMemo(() => moonPhase(today.getTime() + 12 * 60 * 60 * 1000), [today])

  const schoolOut = useMemo(() => {
    // ?noschool=1 is an explicit request, so it wins even over the demo fixture.
    const noSchool = FLAGS.forceNoSchool
      ? true
      : demo
        ? DEMO_SCHOOL.noSchool
        : isNoSchoolToday(schoolSettings, calendar, today)

    return {
      noSchool,
      entree: demo ? DEMO_SCHOOL.entree : lunchEntreeForToday(lunch, today),
      grab: demo ? DEMO_SCHOOL.grab : grabForToday(lunch, today),
      activities: demo
        ? DEMO_SCHOOL.activities
        : activitiesForToday(schoolSettings, today),
      departTimes: {
        driving: schoolSettings?.drivingDepart ?? null,
        walking: schoolSettings?.walkingDepart ?? null,
      },
      morningEndsAt: schoolSettings?.morningEndsAt ?? null,
      // When the school-morning window opens (the Entry board swaps its
      // countdown tiles for the departure panel inside it).
      autoShowAt: schoolSettings?.autoShowAt ?? null,
    }
  }, [demo, schoolSettings, calendar, lunch, today])

  const wear = useMemo(
    () =>
      decideWear({
        highF: todayDay?.highF,
        lowF: todayDay?.lowF,
        precipPct: todayDay?.precipPct,
        code: todayDay?.code,
        hourNow,
      }),
    [todayDay, hourNow]
  )

  // actions is passed through untouched: the same five callbacks useTimer
  // handed us, so a panel button drives the real, house-shared countdown.
  const timer = useMemo(
    () =>
      demo
        ? { ...DEMO_TIMER, target: demoTarget, actions: timerState.actions }
        : {
            mode: timerState.mode,
            kind: timerState.kind,
            travelMode: timerState.travelMode,
            minutesLeft: timerState.minutesLeft,
            band: timerState.band,
            target: timerState.target,
            actions: timerState.actions,
          },
    [
      timerState.mode,
      timerState.kind,
      timerState.travelMode,
      timerState.minutesLeft,
      timerState.band,
      timerState.target,
      timerState.actions,
      demo,
      demoTarget,
    ]
  )

  const musicRoom = settings.sonos?.room || 'Main'
  const music = useMemo(() => {
    if (demo) {
      return { ...DEMO_MUSIC, room: musicRoom, fetchedAt: demoFetchedAt }
    }
    return {
      playing: !!sonos.playing,
      paused: !!sonos.paused,
      track: sonos.track || null,
      stationName: sonos.stationName || '',
      sourceLabel: sonos.sourceLabel || '',
      sourceKind: sonos.sourceKind || '',
      volume: sonos.volume ?? 0,
      room: musicRoom,
      fetchedAt: sonos.fetchedAt ?? null,
      error: sonos.error ?? null,
    }
  }, [
    sonos.playing,
    sonos.paused,
    sonos.track,
    sonos.stationName,
    sonos.sourceLabel,
    sonos.sourceKind,
    sonos.volume,
    sonos.fetchedAt,
    sonos.error,
    musicRoom,
    demo,
    demoFetchedAt,
  ])

  // Photos are always live - the slideshow is the one source that never needs
  // a fixture, and a demo screenshot should show the family's real pictures.
  const photos = useMemo(
    () => ({
      photos: photoData.photos || [],
      albums: photoData.albums || [],
      loading: !!photoData.loading,
      error: photoData.error ?? null,
      fetchedAt: photoData.fetchedAt ?? null,
    }),
    [
      photoData.photos,
      photoData.albums,
      photoData.loading,
      photoData.error,
      photoData.fetchedAt,
    ]
  )

  // --- Entry board --------------------------------------------------------
  //
  // The family calendar. The demo fixture always wins in demo mode (unlike the
  // weather): the headline fixture names one of its events, and a design shot
  // should not depend on, or publish, whatever the family has on this week.
  const calendarOut = useMemo(() => {
    if (!demo) return liveCalendar
    return {
      ...demoCalendarData,
      connected: true,
      fetchedAt: demoFetchedAt,
      error: null,
      stale: false,
    }
  }, [demo, liveCalendar, demoCalendarData, demoFetchedAt])

  const agendaDays = useMemo(
    () => buildAgendaDays(calendarOut.events, today, AGENDA_DAYS_MAX),
    [calendarOut.events, today]
  )
  const countdowns = useMemo(
    () => countdownsFor(calendarOut.countdowns, today),
    [calendarOut.countdowns, today]
  )

  // The hub's headline and air quality ride in /api/state. Only trusted once
  // the hub has confirmed them TODAY: yesterday's "Today: PJ day", carried
  // into this morning by a hub that went down overnight, would be wrong in a
  // way nobody would notice. Same guard useTimer puts on noSchoolToday.
  const houseToday = house.fetchedAt != null && dateKey(new Date(house.fetchedAt)) === todayKey
  const headline = demo ? DEMO_HEADLINE : houseToday ? house.headline : null
  // Air quality follows the weather's demo rule: a live reading wins.
  const liveAir = houseToday ? house.airQuality : null
  const airQuality = liveAir || (demo ? DEMO_AIR_QUALITY : null)
  const weatherAlerts = !demo && houseToday && Array.isArray(house.weatherAlerts) ? house.weatherAlerts : null

  return {
    now,
    demo,
    greeting: greetingFor(now),
    settings,
    weather: weatherOut,
    moon,
    school: schoolOut,
    timer,
    wear,
    music,
    photos,
    calendar: calendarOut,
    agendaDays,
    countdowns,
    headline,
    airQuality,
    weatherAlerts,
  }
}
