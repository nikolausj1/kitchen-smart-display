import { useMemo, useRef, useSyncExternalStore } from 'react'
import ClockPanel from '../panels/ClockPanel.jsx'
import WeatherNowPanel from '../panels/WeatherNowPanel.jsx'
import ForecastPanel from '../panels/ForecastPanel.jsx'
import SunMoonPanel from '../panels/SunMoonPanel.jsx'
import WhatToWearPanel from '../panels/WhatToWearPanel.jsx'
import AirQualityChip from '../panels/AirQualityChip.jsx'
import HeadlinePanel from '../panels/HeadlinePanel.jsx'
import AgendaPanel, { sliceAgendaDays } from '../panels/AgendaPanel.jsx'
import CountdownsPanel from '../panels/CountdownsPanel.jsx'
import DeparturePanel from '../panels/DeparturePanel.jsx'
import NowPlayingPanel from '../panels/NowPlayingPanel.jsx'
import PhotoPanel from '../panels/PhotoPanel.jsx'
import SchoolPanel from '../panels/SchoolPanel.jsx'
import TextBlock from '../panels/TextBlock.jsx'
import ImageBlock from '../panels/ImageBlock.jsx'
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
// The departure countdown. A layout with its own departure panel shows it
// there, always. Without one it borrows a box, as the two built-in boards
// always have: the countdowns box during a school morning (the Entry board's
// rule: the whole morning window, or a manual timer at any hour), else the
// now-playing box while a countdown actually runs (the Board's rule). One box
// at most.
//
// In the layout editor (?edit=1 inside its frame) editBridge.js reports where
// each box and each marked sub-element landed.

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

// Which box borrows the departure countdown: 'countdowns', 'nowplaying' or
// null (none, or the layout has its own departure panel).
function departureHost(panels, d) {
  const types = new Set(panels.map((p) => p.type))
  if (types.has('departure')) return null
  if (types.has('countdowns') && departureInCountdowns(d)) return 'countdowns'
  if (types.has('nowplaying') && departureInNowPlaying(d)) return 'nowplaying'
  return null
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
  const panels = useMemo(() => {
    if (!ruledOut) return shown
    const out = ruledOut.split(' ')
    return shown.filter((p) => out.indexOf(p.id) < 0)
  }, [shown, ruledOut])
  const joins = useMemo(() => cardJoins(panels), [panels])
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

  const agendaKnobs = knobs.agenda || null
  const agendaDays = useMemo(
    () => (agendaKnobs ? sliceAgendaDays(d.agendaDays, agendaKnobs) : d.agendaDays),
    [d.agendaDays, agendaKnobs]
  )

  const headline = d.headline || fallbackHeadline(d.greeting)
  const cal = d.calendar
  const host = departureHost(panels, d)
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
          />
        )
      case 'sunmoon':
        return (
          <SunMoonPanel
            now={d.now}
            sunrise={d.weather?.sunrise}
            sunset={d.weather?.sunset}
            moon={d.moon}
            knobs={k}
          />
        )
      case 'wear':
        return <WhatToWearPanel wear={d.wear} knobs={k} />
      case 'airquality':
        return <AirQualityChip airQuality={d.airQuality} knobs={k} />
      case 'agenda':
        return (
          <AgendaPanel
            days={agendaDays}
            now={d.now}
            connected={cal?.connected ?? null}
            fetchedAt={cal?.fetchedAt ?? null}
            error={cal?.error ?? null}
            stale={!!cal?.stale}
            knobs={k}
          />
        )
      case 'countdowns':
        return host === 'countdowns' ? departure(DEPARTURE_KNOBS) : <CountdownsPanel countdowns={d.countdowns} knobs={k} />
      case 'departure':
        return departure(k)
      case 'nowplaying':
        return host === 'nowplaying' ? departure(DEPARTURE_KNOBS) : <NowPlayingPanel music={d.music} now={d.now} knobs={k} />
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
            borrowed={host === p.type}
            rule={EDIT_MODE && !!p.when}
          >
            {content(p)}
          </SpecPanel>
        ))}
      </div>
    </div>
  )
}
