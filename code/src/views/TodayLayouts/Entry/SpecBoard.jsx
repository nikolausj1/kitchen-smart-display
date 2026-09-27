import { useMemo, useRef, useSyncExternalStore } from 'react'
import ClockPanel from '../panels/ClockPanel.jsx'
import WeatherNowPanel from '../panels/WeatherNowPanel.jsx'
import ForecastPanel from '../panels/ForecastPanel.jsx'
// --- Weather panels (chunk 2) ---
import HourlyPanel from '../panels/HourlyPanel.jsx'
import ConditionsPanel from '../panels/ConditionsPanel.jsx'
import PrecipPanel from '../panels/PrecipPanel.jsx'
import AlertPanel from '../panels/AlertPanel.jsx'
import { pickAlert } from '../lib/weatherPanels.js'
// --- end weather panels ---
import SunMoonPanel from '../panels/SunMoonPanel.jsx'
import WhatToWearPanel from '../panels/WhatToWearPanel.jsx'
import AirQualityChip from '../panels/AirQualityChip.jsx'
import HeadlinePanel from '../panels/HeadlinePanel.jsx'
import AgendaPanel, { sliceAgendaDays } from '../panels/AgendaPanel.jsx'
// --- Calendar views (chunk 3) ---
import UpNextPanel from '../panels/UpNextPanel.jsx'
import DayListPanel from '../panels/DayListPanel.jsx'
import WeekGridPanel from '../panels/WeekGridPanel.jsx'
import MonthGridPanel from '../panels/MonthGridPanel.jsx'
import { useCalendarWindow } from '../../../hooks/useCalendar.js'
import { AGENDA_SCAN_DAYS, boardCalendarNeed, daysWithEvents } from '../lib/calendarViews.js'
import { buildAgendaDays, keyToDate } from '../lib/agenda.js'
import { dateKey } from '../../../lib/schoolDay.js'
// --- end calendar views ---
import CountdownsPanel from '../panels/CountdownsPanel.jsx'
import CountdownPanel from '../panels/CountdownPanel.jsx'
import DeparturePanel from '../panels/DeparturePanel.jsx'
import NowPlayingPanel from '../panels/NowPlayingPanel.jsx'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import SchoolPanel from '../panels/SchoolPanel.jsx'
import TextBlock from '../panels/TextBlock.jsx'
import ImageBlock from '../panels/ImageBlock.jsx'
// --- Blocks and clocks (chunk 4): the shape block, the flip clock, the
// analog clock, the second clock, the date and the day count. The clocks read
// d.now. The day count is worked out once a day (lib/dates.js dayCount, below),
// and a count that cannot be made (school days with no last day of school
// ahead) drops its box like the alert's, the editor keeping it with a note. ---
import ShapeBlock from '../panels/ShapeBlock.jsx'
import FlipClockPanel from '../panels/FlipClockPanel.jsx'
import AnalogClockPanel from '../panels/AnalogClockPanel.jsx'
import SecondClockPanel from '../panels/SecondClockPanel.jsx'
import DatePanel from '../panels/DatePanel.jsx'
import DayCountPanel from '../panels/DayCountPanel.jsx'
import { dayCount, dayFromKey } from '../lib/dates.js'
// --- end blocks and clocks ---
// --- Home Assistant (chunk 5): the status panel, the button, the chips and
// the picker read d.ha (hooks/useHomeAssistant.js's snapshot, or the demo's).
// The board keeps the snapshot polled while one of them is on it; a press
// goes through the store's runHaAction, the demo's demoHaAction (it only
// animates) under ?demo=1, and nowhere in the layout editor. ---
import HaStatusPanel from '../panels/HaStatusPanel.jsx'
import HaButtonPanel from '../panels/HaButtonPanel.jsx'
import HaChipsPanel from '../panels/HaChipsPanel.jsx'
import HaPickerPanel from '../panels/HaPickerPanel.jsx'
import { HA_PANEL_TYPES } from '../panels/haParts.js'
import { runHaAction, useHaPolling } from '../../../hooks/useHomeAssistant.js'
import { demoHaAction } from '../data/demo.js'
// --- end Home Assistant ---
import { knobDefaults } from '../panels/schemas.js'
import SpecPanel, { SpecScrims } from './SpecPanel.jsx'
import { hexChannels } from './specStyles.js'
import {
  cardJoins,
  clockDaypart,
  inSchoolMorning,
  isSchoolMorning,
  knobsOf,
  layoutTextScale,
  normalizeSpec,
  panelType,
  resolveDaypart,
  ruleKindsUsed,
  ruleMatches,
  variantPanels,
  visiblePanels,
} from '../layoutSpec.js'
import { fontStack } from '../lib/fonts.js'
import { useEditBridge, useEditDaypart, useEditDraft, useEditHover } from '../editBridge.js'
import { EDIT_MODE } from '../../../lib/kioskMode.js'
import { PLEX_OFF, effectivePlexFollow, getPlexNow, pickSession, subscribePlexNow } from '../../../hooks/usePlexNow.js'
// The families a spec's global.font and a box's font can pick (lib/fonts.js),
// and Inter 300, the Entry board's light clock and the clock's lightest weight
// knob: main.jsx only ships Inter 400/600/700. Latin subsets; a face costs
// nothing until a page uses it.
import '@fontsource/inter/latin-300.css'
import '@fontsource-variable/fraunces/full.css'
import '@fontsource/roboto/latin-400.css'
import '@fontsource/roboto/latin-500.css'
import '@fontsource/roboto/latin-700.css'
import '@fontsource/barlow-condensed/latin-400.css'
import '@fontsource/barlow-condensed/latin-500.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-700.css'
import '../tokens.css'
import './SpecPanel.css'

// SpecBoard - a Today layout drawn from a layout spec (layoutSpec.js,
// docs/designs/layout-editor.md): the Entry board and the Board. The layout
// hands in its one useTodayData() result, its id and its root's classes (and,
// for the Entry board, the backdrop layers as children: a node, or a function
// of { panels } for a backdrop that needs to know where the boxes are, as the
// Entry board's adaptive darkness does); this draws the rest:
//
//   - the spec: the editor's draft in the layout editor, else the screen's
//     saved one (config.layouts.<layoutId>), else the layout's built-in
//     default, all through normalizeSpec with that layout's defaults
//   - the day part: the editor's forced one, else resolveDaypart() on the
//     clock (weekend, school morning, evening, else day); variantPanels()
//     picks that variant's panels and global, or the base's
//   - spec.global as variables on the root (tokens.css "Spec layouts")
//   - every visible panel in its box (SpecPanel), each functional panel with
//     its knobs (props over the schema defaults, panels/schemas.js), and under
//     them the scrims of the boxes that have one (SpecScrims)
//   - visibility rules (a panel's `when`, layoutSpec.js ruleMatches): a panel
//     whose rule fails is not drawn, re-checked on every render (the board
//     ticks every second) against the clock and the live data: the school
//     morning, the weekend, the day part (clockDaypart, whatever variants the
//     spec has), music, Plex (polled only while a rule asks), a weather alert,
//     the countdowns. In the layout editor rules are not applied: every panel
//     is drawn, a ruled one marked data-rule for the editor.
//
// Any number of every type (layoutSpec.js, the instance scheme): everything
// below that is per type works per box, keyed by the box's id. Each box has
// its own knobs (so two agendas cut their own days, two day counts count
// their own thing), a box that cannot draw drops alone (an alert box, a day
// count), and every calendar box joins the one calendar window the board asks
// for. Each photo box keeps its own interval (its knob, else the screen's
// slideshow interval) and its own shuffle.
//
// The departure countdown. A layout with its own departure panel shows it
// there, always. Without one it borrows a box, as the two built-in boards
// always have: the countdowns box during a school morning (the Entry board's
// rule: the whole morning window, or a manual timer at any hour), else the
// now-playing box while a countdown actually runs (the Board's rule). One box
// at most: with several, the first countdowns (or now-playing) box in the
// spec's list, whatever the stacking.
//
// In the layout editor (?edit=1 inside its frame) editBridge.js reports where
// each box and each marked sub-element landed.
//
// The weather panels (docs/designs/panels-and-controls.md, chunk 2) read the
// hub's weather feed from d.weather, and every one that shows Apple's data
// carries its mark (d.weather.attribution). The alert banner's box is dropped
// while no alert is in force, as if a rule hid it; the editor keeps it, with
// a placeholder, so it can be placed.
//
// The Home Assistant panels (chunk 5) read d.ha. While one is on the board
// (and not in demo mode) the store polls the hub's snapshot of the whitelist
// (useHaPolling); nothing else on a board asks for it.
//
// The calendar views (chunk 3: Up next, Day list, Week grid, Month grid) read
// the calendar store (d.calendar). What they draw can reach past the six days
// the store asks the hub for by default (a week from Monday, a month grid),
// so the board wants the union of its calendar panels' windows
// (lib/calendarViews.js boardCalendarNeed, hooks/useCalendar.js); a board
// without them wants nothing and asks what it always has.

// The Board's tile ran twelve photos; so does any photo panel.
const PHOTO_COUNT = 12

// A photo panel's interval knob of 0 ("Screen setting", the default) is this
// screen's own slideshow interval, handed in as the panel's intervalMs prop and
// bounded as the Board's tile always was: the device default (6 s) is right
// for the full-screen slideshow and far too twitchy beside a clock, and past
// ten minutes a tile reads as frozen.
const TILE_MIN_MS = 15_000
const TILE_MAX_MS = 600_000
const TILE_FALLBACK_MS = 20_000

function tileIntervalMs(slideshow) {
  const raw = Number(slideshow?.intervalMs)
  if (!Number.isFinite(raw) || raw <= 0) return TILE_FALLBACK_MS
  return Math.min(TILE_MAX_MS, Math.max(TILE_MIN_MS, raw))
}

// The departure panel in a borrowed box has no knobs of its own.
const DEPARTURE_KNOBS = knobDefaults('departure')

// --- Calendar views (chunk 3): each type's panel. ---
const CALENDAR_VIEWS = {
  upnext: UpNextPanel,
  daylist: DayListPanel,
  weekgrid: WeekGridPanel,
  monthgrid: MonthGridPanel,
}
// --- end calendar views ---

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

// spec.global -> the root's variables (tokens.css "Spec layouts"). The text
// scale is per box (SpecPanel), global x panel. The font is the display font
// (the big type): its family's stack from lib/fonts.js.
function globalStyle(global) {
  const g = global || {}
  const style = {}
  const display = typeof g.font === 'string' ? fontStack(g.font) : null
  if (display) style['--tl-font-display'] = display
  if (typeof g.accent === 'string' && HEX_RE.test(g.accent)) style['--tl-accent'] = g.accent
  const rgb = hexChannels(g.text)
  if (rgb) {
    style['--tl-fg'] = g.text
    style['--tl-fg-rgb'] = rgb
  }
  if (Number.isFinite(g.surfaceOpacity)) style['--tl-surface-alpha'] = String(g.surfaceOpacity)
  if (Number.isFinite(g.radius)) style['--tl-radius-scale'] = String(g.radius)
  return style
}

// The Entry board's rule: the departure panel during the school-morning window
// on a school day, or whenever a manual timer runs ("leave at 4:40" set on any
// screen). The default timer only ever runs inside the window; keying on the
// window rather than on "timer active" is also what lets ?demo=1 (whose timer
// is always active) show the tiles outside the morning.
function departureInCountdowns(d) {
  const school = d.school
  if (!school || school.noSchool) return false
  if (inSchoolMorning(d.now, school)) return true
  return d.timer?.mode === 'active' && d.timer?.kind === 'manual'
}

// The Board's rule: while a departure countdown actually runs.
function departureInNowPlaying(d) {
  return d.timer?.mode === 'active' && !d.school?.noSchool
}

// Which box borrows the departure countdown: the id of a countdowns box or a
// now-playing box, or null (none, or the layout has a departure panel of its
// own). panels: the boxes drawn; order: the spec's panel list (view.panels),
// which decides the first of several, whatever their stacking.
function departureHost(panels, order, d) {
  if (panels.some((p) => p.type === 'departure')) return null
  const drawn = new Set(panels.map((p) => p.id))
  const first = (type) => {
    for (let i = 0; i < order.length; i++) {
      const p = order[i]
      if (p && p.type === type && drawn.has(p.id)) return p.id
    }
    return null
  }
  const countdowns = departureInCountdowns(d) ? first('countdowns') : null
  if (countdowns) return countdowns
  return departureInNowPlaying(d) ? first('nowplaying') : null
}

// Until the hub publishes a headline (or when it has not confirmed one today)
// the line is the local greeting, which is what the hub itself says with no
// calendar to read. A greeting is not data, so nothing is being invented.
function fallbackHeadline(greeting) {
  return greeting ? { text: `${greeting}.`, kind: 'daypart', eventId: null, until: null } : null
}

// In the editor the board is a picture of the screen, not the screen: the
// travel toggle stays visible (it is part of the layout) but writes nothing.
function noop() {}

// Plex, for the plexPlaying rule: an active subscription (the store polls the
// hub every 5 s while one is open) only while a rule on screen asks about it,
// else none at all.
const subscribePlexActive = (fn) => subscribePlexNow(fn, { active: true })
const subscribeNothing = () => noop
const getNothing = () => null

// Is Plex playing, as the rule means it: the player this screen follows
// (display.plexFollow), or when it follows none, any player.
function plexPlaying(snap, followSetting) {
  if (!snap || !Array.isArray(snap.sessions)) return false
  const follow = effectivePlexFollow(followSetting)
  const s = pickSession(snap, follow === PLEX_OFF ? null : follow)
  return !!s && s.player?.state === 'playing'
}

// A weather alert in force: the hub's list of NWS alerts when the house state
// carries it (useTodayData weatherAlerts), else the headline, which leads
// with an alert whenever one outranks everything else.
function alertActive(d) {
  if (Array.isArray(d.weatherAlerts)) return d.weatherAlerts.length > 0
  return d.headline?.kind === 'alert'
}

// What the rules are judged against (layoutSpec.js ruleMatches).
function ruleContext(d, spec, plexSnap) {
  const now = d.now
  const school = d.settings?.school
  const noSchoolToday = !!d.school?.noSchool
  const day = now instanceof Date ? now.getDay() : null
  return {
    now,
    schoolMorning: isSchoolMorning({ now, school, noSchoolToday }),
    weekend: day === 0 || day === 6,
    daypart: clockDaypart({ now, school, noSchoolToday, eveningFrom: spec?.eveningFrom }),
    musicPlaying: !!d.music?.playing,
    plexPlaying: plexPlaying(plexSnap, d.settings?.display?.plexFollow),
    alertActive: alertActive(d),
    countdownDaysLeft: (Array.isArray(d.countdowns) ? d.countdowns : []).map((c) => c?.daysLeft),
  }
}

export default function SpecBoard({ d, layoutId, className, children }) {
  const rootRef = useRef(null)

  // This screen's layout: the editor's draft while one is open, else the saved
  // spec, else the built-in board (normalizeSpec's default for null).
  const savedRaw = d.settings?.layouts?.[layoutId] ?? null
  const savedSpec = useMemo(() => normalizeSpec(savedRaw, { layoutId }), [savedRaw, layoutId])
  const draft = useEditDraft(layoutId)
  const spec = draft || savedSpec

  // The day part: forced by the editor, else by the clock (a string, so the
  // variant below is only re-picked when it changes, at most once a minute).
  const forcedDaypart = useEditDaypart()
  const drawnDaypart = resolveDaypart({
    now: d.now,
    school: d.settings?.school,
    noSchoolToday: !!d.school?.noSchool,
    spec,
  })
  const view = useMemo(() => variantPanels(spec, forcedDaypart || drawnDaypart), [spec, forcedDaypart, drawnDaypart])
  useEditBridge(rootRef, savedRaw, layoutId, view.daypart)
  const hoverId = useEditHover()

  const shown = useMemo(() => visiblePanels(view), [view])

  // Visibility rules, off in the editor. Judged on every render; the panel
  // list only changes identity when which panels pass does.
  const ruleKinds = useMemo(() => (EDIT_MODE ? new Set() : ruleKindsUsed(shown)), [shown])
  const needsPlex = ruleKinds.has('plexPlaying')
  const plexSnap = useSyncExternalStore(
    needsPlex ? subscribePlexActive : subscribeNothing,
    needsPlex ? getPlexNow : getNothing,
    getNothing
  )
  let ruledOut = ''
  if (ruleKinds.size) {
    const ctx = ruleContext(d, spec, plexSnap)
    ruledOut = shown
      .filter((p) => p.when && !ruleMatches(p.when, ctx))
      .map((p) => p.id)
      .join(' ')
  }
  // --- Weather panels (chunk 2): no alert in force, no banner: every alert
  // box is dropped. ---
  if (!EDIT_MODE && shown.some((p) => p.type === 'alert') && !pickAlert(d.weather?.alerts, d.now)) {
    shown.forEach((p) => {
      if (p.type === 'alert') ruledOut = ruledOut ? `${ruledOut} ${p.id}` : p.id
    })
  }
  // --- end weather panels ---
  // --- Blocks and clocks (chunk 4): the day counts, keyed on the day, one
  // per kind of count the board's day-count boxes show; a box whose count
  // cannot be made is dropped (the editor keeps it, with a note). ---
  const dayCountShows = []
  shown.forEach((p) => {
    if (p.type !== 'daycount') return
    const show = knobsOf(p).show
    if (dayCountShows.indexOf(show) < 0) dayCountShows.push(show)
  })
  const dayCountShowsKey = dayCountShows.length ? JSON.stringify(dayCountShows) : ''
  const dayCountKey = d.now instanceof Date && !Number.isNaN(d.now.getTime()) ? dateKey(d.now) : ''
  const schoolSettings = d.settings?.school
  const schoolCalendar = d.schoolCalendar
  const dayCounts = useMemo(() => {
    if (!dayCountShowsKey) return null
    const out = {}
    JSON.parse(dayCountShowsKey).forEach((show) => {
      out[show] = dayCount(show, { now: dayFromKey(dayCountKey), school: schoolSettings, calendar: schoolCalendar })
    })
    return out
  }, [dayCountShowsKey, dayCountKey, schoolSettings, schoolCalendar])
  if (!EDIT_MODE && dayCounts) {
    shown.forEach((p) => {
      if (p.type === 'daycount' && !dayCounts[knobsOf(p).show]) ruledOut = ruledOut ? `${ruledOut} ${p.id}` : p.id
    })
  }
  // --- end blocks and clocks ---
  const panels = useMemo(() => {
    if (!ruledOut) return shown
    const out = ruledOut.split(' ')
    return shown.filter((p) => out.indexOf(p.id) < 0)
  }, [shown, ruledOut])
  const joins = useMemo(() => cardJoins(panels), [panels])
  // --- Home Assistant (chunk 5) ---
  useHaPolling(!d.demo && panels.some((p) => HA_PANEL_TYPES.indexOf(p.type) >= 0))
  const haRun = EDIT_MODE ? null : d.demo ? demoHaAction : runHaAction
  // --- end Home Assistant ---
  const style = useMemo(() => globalStyle(view.global), [view.global])
  // One knobs object per panel, rebuilt only with the panels, so a memoised
  // panel (PhotoPanel) is not handed a new one every second.
  const knobs = useMemo(() => {
    const out = {}
    panels.forEach((p) => {
      const t = panelType(p.type)
      if (t && t.kind === 'panel') out[p.id] = knobsOf(p)
    })
    return out
  }, [panels])

  const agendas = useMemo(() => panels.filter((p) => p.type === 'agenda'), [panels])
  // --- Calendar views (chunk 3): the window the board's calendar panels
  // need (the union of every calendar box's), and, for an agenda that skips
  // the empty days, two weeks of days to find its own in. ---
  useCalendarWindow(boardCalendarNeed(panels, knobs, d.now))
  const nowOk = d.now instanceof Date && !Number.isNaN(d.now.getTime())
  const todayKey = nowOk ? dateKey(d.now) : null
  // A day's events that are over leave it (futureOnly) by the minute.
  const minute = nowOk ? Math.floor(d.now.getTime() / 60000) : null
  const skipEmpty = agendas.some((p) => knobs[p.id] && knobs[p.id].showEmptyDays === false)
  const calEvents = d.calendar?.events
  const scanDays = useMemo(
    () => (skipEmpty && todayKey ? buildAgendaDays(calEvents, keyToDate(todayKey), AGENDA_SCAN_DAYS) : null),
    [skipEmpty, calEvents, todayKey]
  )
  // --- end calendar views ---
  // Each agenda box's days, by id: its knobs' cut of the days from today.
  const agendaDays = useMemo(() => {
    const out = {}
    agendas.forEach((p) => {
      const k = knobs[p.id]
      if (!k) out[p.id] = d.agendaDays
      // --- Calendar views (chunk 3) ---
      else if (scanDays && k.showEmptyDays === false) {
        out[p.id] = daysWithEvents(scanDays, k, minute == null ? null : new Date(minute * 60000))
      }
      // --- end calendar views ---
      else out[p.id] = sliceAgendaDays(d.agendaDays, k)
    })
    return out
  }, [agendas, knobs, d.agendaDays, scanDays, minute])

  const headline = d.headline || fallbackHeadline(d.greeting)
  const cal = d.calendar
  const host = departureHost(panels, view.panels, d)
  const toggleTravel = EDIT_MODE ? noop : d.timer?.actions?.toggleTravel

  function departure(k) {
    return (
      <DeparturePanel
        timer={d.timer}
        school={d.school}
        now={d.now}
        onToggleTravel={k && k.showToggle === false ? undefined : toggleTravel}
        knobs={k}
      />
    )
  }

  function content(p) {
    const k = knobs[p.id]
    switch (p.type) {
      case 'clock':
        return (
          <ClockPanel
            now={d.now}
            greeting={d.greeting}
            showGreeting={k.showGreeting}
            showSeconds={k.showSeconds}
            dateStyle={k.showDate === false ? 'none' : k.dateStyle}
            knobs={k}
          />
        )
      // --- Blocks and clocks (chunk 4) ---
      case 'flipclock':
        return <FlipClockPanel now={d.now} knobs={k} />
      case 'analog':
        return <AnalogClockPanel now={d.now} knobs={k} align={p.props.align} valign={p.props.valign} />
      case 'clock2':
        return <SecondClockPanel now={d.now} knobs={k} />
      case 'date':
        return <DatePanel now={d.now} knobs={k} />
      case 'daycount':
        return <DayCountPanel count={dayCounts ? dayCounts[k.show] || null : null} knobs={k} editing={EDIT_MODE} />
      case 'shape':
        return <ShapeBlock props={p.props} />
      // --- end blocks and clocks ---
      case 'headline':
        return <HeadlinePanel headline={headline} now={d.now} knobs={k} />
      case 'weather':
        return (
          <WeatherNowPanel
            current={d.weather?.current}
            today={d.weather?.today}
            fetchedAt={d.weather?.fetchedAt}
            now={d.now}
            error={d.weather?.error}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      case 'forecast':
        return (
          <ForecastPanel
            days={d.weather?.days}
            fetchedAt={d.weather?.fetchedAt}
            now={d.now}
            count={k.days}
            error={d.weather?.error}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      // --- Weather panels (chunk 2) ---
      case 'hourly':
        return (
          <HourlyPanel
            hourly={d.weather?.hourly}
            current={d.weather?.current}
            now={d.now}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      case 'conditions':
        return (
          <ConditionsPanel
            current={d.weather?.current}
            sunrise={d.weather?.sunrise}
            sunset={d.weather?.sunset}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      case 'precip':
        return (
          <PrecipPanel
            hourly={d.weather?.hourly}
            nextHour={d.weather?.nextHour}
            now={d.now}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      case 'alert':
        return (
          <AlertPanel
            alerts={d.weather?.alerts}
            now={d.now}
            knobs={k}
            editing={EDIT_MODE}
            attribution={d.weather?.attribution}
          />
        )
      // --- end weather panels ---
      case 'sunmoon':
        return (
          <SunMoonPanel
            now={d.now}
            sunrise={d.weather?.sunrise}
            sunset={d.weather?.sunset}
            moon={d.moon}
            knobs={k}
            attribution={d.weather?.attribution}
          />
        )
      case 'wear':
        return <WhatToWearPanel wear={d.wear} knobs={k} attribution={d.weather?.attribution} />
      case 'airquality':
        return <AirQualityChip airQuality={d.airQuality} knobs={k} />
      case 'agenda':
        return (
          <AgendaPanel
            days={agendaDays[p.id]}
            now={d.now}
            connected={cal?.connected ?? null}
            fetchedAt={cal?.fetchedAt ?? null}
            error={cal?.error ?? null}
            stale={!!cal?.stale}
            knobs={k}
            calendars={cal?.calendars ?? null}
          />
        )
      // --- Calendar views (chunk 3) ---
      case 'upnext':
      case 'daylist':
      case 'weekgrid':
      case 'monthgrid': {
        const View = CALENDAR_VIEWS[p.type]
        return (
          <View
            events={cal?.events}
            calendars={cal?.calendars ?? null}
            now={d.now}
            connected={cal?.connected ?? null}
            fetchedAt={cal?.fetchedAt ?? null}
            error={cal?.error ?? null}
            stale={!!cal?.stale}
            range={cal?.range ?? null}
            knobs={k}
          />
        )
      }
      // --- end calendar views ---
      case 'countdowns':
        return host === p.id ? departure(DEPARTURE_KNOBS) : <CountdownsPanel countdowns={d.countdowns} knobs={k} />
      case 'countdown':
        return <CountdownPanel countdowns={d.countdowns} knobs={k} />
      case 'departure':
        return departure(k)
      case 'nowplaying':
        return host === p.id ? departure(DEPARTURE_KNOBS) : <NowPlayingPanel music={d.music} now={d.now} knobs={k} />
      case 'photo':
        // d.photos.photos keeps its identity between ticks, which is what
        // lets PhotoPanel's memo hold through the 1 Hz re-render.
        return (
          <PhotoPanel
            photos={d.photos?.photos}
            intervalMs={tileIntervalMs(d.settings?.slideshow)}
            count={PHOTO_COUNT}
            fit={k.fit}
            showCaption={k.showCaption}
            showCounter={k.showCounter}
            knobs={k}
          />
        )
      case 'school':
        return <SchoolPanel school={d.school} knobs={k} />
      // --- Home Assistant (chunk 5) ---
      case 'hastatus':
        return <HaStatusPanel ha={d.ha} now={d.now} knobs={k} />
      case 'habutton':
        return <HaButtonPanel ha={d.ha} knobs={k} run={haRun} />
      case 'hachips':
        return <HaChipsPanel ha={d.ha} knobs={k} />
      case 'hapicker':
        return <HaPickerPanel ha={d.ha} knobs={k} run={haRun} demo={!!d.demo} />
      // --- end Home Assistant ---
      case 'text':
        return (
          <TextBlock
            text={p.props.text}
            size={p.props.size}
            weight={p.props.weight}
            color={p.props.color}
            align={p.props.align}
            lineHeight={p.props.lineHeight}
          />
        )
      case 'image':
        return <ImageBlock src={p.props.src} fit={p.props.fit} />
      default:
        return null
    }
  }

  return (
    <div
      ref={rootRef}
      className={className}
      style={style}
      data-layout={layoutId}
      data-daypart={view.daypart}
    >
      {typeof children === 'function' ? children({ panels }) : children}
      <div className="tl-spec-canvas">
        <SpecScrims panels={panels} />
        {panels.map((p) => (
          <SpecPanel
            key={p.id}
            panel={p}
            textScale={layoutTextScale(view, p)}
            join={joins[p.id] || null}
            hover={hoverId === p.id}
            borrowed={host === p.id}
            rule={EDIT_MODE && !!p.when}
          >
            {content(p)}
          </SpecPanel>
        ))}
      </div>
    </div>
  )
}
