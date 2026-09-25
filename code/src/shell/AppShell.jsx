import { useCallback, useEffect, useRef, useState } from 'react'
import TodayLayoutSwitch from '../views/TodayLayouts/TodayLayoutSwitch.jsx'
import PhotoSlideshow from '../views/PhotoSlideshow/PhotoSlideshow.jsx'
import NowPlaying from '../views/NowPlaying/NowPlaying.jsx'
import PlexView from '../views/Plex/PlexView.jsx'
import SettingsView from '../views/Settings/SettingsView.jsx'
import MenuPill from './MenuPill.jsx'
import { ViewProvider, useView } from './ViewContext.jsx'
import { DebugHud, logEvent } from './DebugLog.jsx'
import { getSettings, useSettings } from '../lib/settings.js'
import useDisplaySchedule from './useDisplaySchedule.js'
import DimOverlay from './DimOverlay.jsx'
import PixelShift from './PixelShift.jsx'
import EchoMode from './EchoMode.jsx'
import useReloadOnDeploy from './useReloadOnDeploy.js'
import { getHomeView } from './homeView.js'
import useSchoolCalendar, { getCachedCalendar } from '../hooks/useSchoolCalendar.js'
import {
  PLEX_OFF,
  effectivePlexFollow,
  getPlexNow,
  sessionForPlayer,
  subscribePlexNow,
} from '../hooks/usePlexNow.js'
import { isNoSchoolToday } from '../lib/schoolDay.js'
import { AUTO_MODE, EDIT_MODE, KIOSK_ECHO, KIOSK_TV, REQUESTED_VIEW } from '../lib/kioskMode.js'

// --- Boot-time view selection -----------------------------------------------
//
// Priority at page load (highest first):
//   1. Sonos is currently playing  -> 'music'   (decided async, post-mount)
//   2. School day AND 5:00 <= now < 8:00       -> 'today'
//   3. Default                                  -> the home view
//
// The home view is display.homeView (shell/homeView.js): 'photos' unless the
// screen rests on its Today board, as the front-door Echo Show 15 does.
//
// (1) requires an async Sonos /state fetch, so initial render uses the
// synchronous (2)/(3) answer; if Sonos comes back playing we bounce to
// 'music' once in a useEffect inside Shell.

// Earliest boot-time auto-show. Independent of school.autoShowAt - this is
// the "if you cold-boot the device at 5:30 AM the morning routine is
// already useful" safety net; autoShowAt is when the runtime watcher
// switches to Today on a kiosk that's already been running.
const MORNING_START_HOUR = 5

function computeInitialView(now = new Date()) {
  const { school } = getSettings()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const home = getHomeView()
  // No-school days (weekends, holidays/breaks, summer, manual overrides) never
  // boot to Today for the school morning; they boot to the home view (which is
  // Today anyway on a screen that rests there). Uses the cached SPS calendar;
  // falls back to schoolDays + overrides if the feed hasn't been fetched yet.
  if (isNoSchoolToday(school, getCachedCalendar(), now)) return home
  if (hour < MORNING_START_HOUR) return home
  // Compare minute precision against school.morningEndsAt so the boot
  // window matches the runtime auto-leave watcher exactly.
  const end = school?.morningEndsAt || { hour: 8, minute: 0 }
  const nowMin = hour * 60 + minute
  const endMin = (end.hour | 0) * 60 + (end.minute | 0)
  return nowMin < endMin ? 'today' : home
}

// Resolve the initial view at boot. An explicit ?view=today|photos|music|
// settings wins outright (deep-links, or the TV launching into a known view).
// Otherwise fall back to the time-of-day heuristic above (?view=auto / none).
// The layout editor's preview (?edit=1) is always Today: it is there to show
// a screen's board, and nothing in it may navigate away.
function resolveInitialView() {
  if (EDIT_MODE) return 'today'
  if (REQUESTED_VIEW) return REQUESTED_VIEW
  return computeInitialView()
}

async function fetchSonosIsPlaying() {
  const { sonos } = getSettings()
  try {
    const res = await fetch(`${sonos.apiBase}/${sonos.room}/state`, {
      cache: 'no-store',
    })
    if (!res.ok) return false
    const raw = await res.json()
    return raw?.playbackState === 'PLAYING'
  } catch {
    return false
  }
}

// Fire-and-forget Sonos command via the Settings-configured base + room.
// sonos.apiBase is the hub's /api/sonos proxy on every screen, so these work
// from any view without node-sonos-http-api being exposed on the LAN.
function sonosCmd(path) {
  const { sonos } = getSettings()
  try {
    fetch(`${sonos.apiBase}/${sonos.room}${path}`, { cache: 'no-store' }).catch(() => {})
  } catch {
    // best-effort
  }
}

// AppShell - top-level chrome that owns view routing and menu pill state.
//
// Dead-area tap rule per spec: tapping the background of any view summons
// the menu pill. Tapping an interactive element does NOT. Interactive =
// <button>, <a>, <input>, <select>, <textarea>, anything with role=listbox,
// or anything with data-interactive="true".

function isInsideInteractive(target, stopNode) {
  let el = target
  while (el && el !== stopNode) {
    const tag = el.tagName
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true
    }
    if (el.dataset && el.dataset.interactive === 'true') return true
    if (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'listbox') {
      return true
    }
    el = el.parentElement
  }
  return false
}

function CurrentView() {
  const { view: chosen } = useView()
  const view = EDIT_MODE ? 'today' : chosen
  switch (view) {
    case 'today':
      return <TodayLayoutSwitch />
    case 'photos':
      return <PhotoSlideshow />
    case 'music':
      return <NowPlaying />
    case 'settings':
      return <SettingsView />
    case 'plex':
      return <PlexView />
    default:
      return <TodayLayoutSwitch />
  }
}

// --- Plex follow ---------------------------------------------------------------
// A screen whose display.plexFollow names a Plex player (the family-room Echo
// follows the living-room Apple TV) shows the Plex view while that player is
// watching something, and goes back when it stops:
//   - the player's session playing (or buffering) the same item for 10
//     continuous seconds -> the Plex view, unless someone is in Settings
//     (it idles home after a minute, and the rule fires then). The view it
//     came from is kept for the log.
//   - on the Plex view a pause keeps it (the view shows a Paused badge);
//     paused for more than 10 minutes -> the home view.
//   - the session gone (or stopped) for 30 s -> the home view.
//   - no answer from the hub, or none from Plex for over 15 s, for 2 minutes
//     -> the home view (a hub restart mid-film must not bounce the screen).
// Leaving the Plex view any other way (the menu, a dashboard nudge, the
// morning auto-show) suppresses re-entry until a different item plays or the
// session has ended: nobody wants the screen snatched back 10 s after they
// chose Photos. Its own exits do not count.
// It does not wake the screen: in the dim or off window the view changes
// under the night overlay, and a touch shows it (someone watching a film at
// 1 am has not asked for the family room to light up). Not mounted in edit
// mode or on the legacy web TV. Polls the hub only while following
// (hooks/usePlexNow.js); ?plexTest=<machineId> stands in for the setting in
// dev builds.
const PLEX_ENTER_MS = 10 * 1000
const PLEX_GONE_MS = 30 * 1000
const PLEX_PAUSED_MS = 10 * 60 * 1000
const PLEX_BLIND_MS = 2 * 60 * 1000

function PlexFollow() {
  const { view, setView } = useView()
  const follow = effectivePlexFollow(useSettings().display?.plexFollow)
  const following = follow !== PLEX_OFF
  const viewRef = useRef(view)
  const prevViewRef = useRef(view)
  const track = useRef({
    playingSince: 0,
    playingItem: null,
    pausedSince: 0,
    goneSince: 0,
    blindSince: 0,
    suppressed: null,
    lastItem: null,
    exiting: false,
    cameFrom: null,
  })

  // Every way off the Plex view that is not our own exit is someone choosing
  // something else.
  useEffect(() => {
    const prev = prevViewRef.current
    prevViewRef.current = view
    viewRef.current = view
    const t = track.current
    if (prev !== 'plex' || view === 'plex') return
    if (t.exiting) {
      t.exiting = false
      return
    }
    if (!following) return
    t.suppressed = t.lastItem || '*'
    logEvent(`plex follow: left for ${view} by hand; no re-entry until a new item`)
  }, [view, following])

  useEffect(() => {
    if (!following) return undefined
    const t = track.current
    // A newly followed player starts clean.
    Object.assign(t, {
      playingSince: 0,
      playingItem: null,
      pausedSince: 0,
      goneSince: 0,
      blindSince: 0,
      suppressed: null,
      lastItem: null,
    })

    function evaluate() {
      const snap = getPlexNow()
      const nowMs = Date.now()
      const blind = !snap.loaded || (!!snap.hubError && snap.stale) || snap.plexDown
      const session = blind ? null : sessionForPlayer(follow, snap)
      const state = blind ? 'blind' : session ? session.player.state : 'gone'
      const item = session ? session.media.ratingKey || session.key : null
      const since = (key, on) => {
        if (!on) t[key] = 0
        else if (!t[key]) t[key] = nowMs
      }
      // The streak is per item: a new one (the next episode) starts again.
      if (state !== 'playing' && state !== 'buffering') {
        t.playingSince = 0
        t.playingItem = null
      } else if (!t.playingSince || t.playingItem !== item) {
        t.playingSince = nowMs
        t.playingItem = item
      }
      since('pausedSince', state === 'paused')
      since('goneSince', state === 'gone' || state === 'stopped')
      since('blindSince', state === 'blind')
      if (item) t.lastItem = item
      if (t.suppressed != null) {
        const newItem = item && t.suppressed !== '*' && item !== t.suppressed
        const ended = t.goneSince && nowMs - t.goneSince >= PLEX_GONE_MS
        if (newItem || ended) t.suppressed = null
      }

      if (viewRef.current !== 'plex') {
        if (viewRef.current === 'settings') return
        if (t.suppressed == null && t.playingSince && nowMs - t.playingSince >= PLEX_ENTER_MS) {
          t.cameFrom = viewRef.current
          logEvent(`plex follow: ${session.player.name} playing -> plex (from ${t.cameFrom})`)
          setView('plex')
        }
        return
      }
      let why = null
      if (t.goneSince && nowMs - t.goneSince >= PLEX_GONE_MS) why = 'the session ended'
      else if (t.pausedSince && nowMs - t.pausedSince >= PLEX_PAUSED_MS) why = 'paused 10 minutes'
      else if (t.blindSince && nowMs - t.blindSince >= PLEX_BLIND_MS) why = 'no answer from the hub'
      if (!why) return
      const home = getHomeView()
      t.exiting = true
      logEvent(`plex follow: ${why} -> ${home} (came from ${t.cameFrom || 'unknown'})`)
      setView(home)
    }

    const unsubscribe = subscribePlexNow(evaluate)
    const id = setInterval(evaluate, 1000)
    evaluate()
    return () => {
      unsubscribe()
      clearInterval(id)
    }
  }, [following, follow, setView])

  return null
}

// The deploy watcher as a component, so edit mode can simply not mount it.
function ReloadOnDeploy() {
  useReloadOnDeploy()
  return null
}

// The night-mode schedule (dim, off, wake; the Pi's real backlight over DDC/CI
// where there is a panel) and its overlay. A component for the same reason:
// the editor's preview is always awake and must never drive a panel. The
// legacy web TV runs the schedule but draws no overlay, as before.
function NightMode({ showOverlay, nightFace }) {
  const display = useDisplaySchedule()
  if (!showOverlay) return null
  // The kitchen and the Echo. On the Echo there is no panel, so this is the
  // only dimmer, and 'off' shows the night face (the faint clock).
  return (
    <DimOverlay
      actualMode={display.actualMode}
      hardwareDim={display.hardwareDim}
      wakeBrightness={display.wakeBrightness}
      eveningBrightness={display.eveningBrightness}
      nightFace={nightFace}
    />
  )
}

// The layout editor's preview (?edit=1, lib/kioskMode.js EDIT_MODE) is a
// picture of a screen, not a screen. It runs none of the kiosk behaviour
// below: no menu pill, no dim overlay (always awake), no Echo keep-alive, no
// reload on deploy, no pixel shift, no boot Sonos override, no schedule
// watchers, no remote-control hooks, and the view stays Today. Hub commands
// never reach it (settings.js drops them in edit mode).
function Shell({ initialView }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { view, setView } = useView()
  // Only these two display flags are read here; the schedule (<NightMode />
  // below) owns the rest of the display behaviour.
  const displaySettings = useSettings().display
  const pixelShift = displaySettings?.pixelShift === true
  const nightFace = displaySettings?.nightFace || 'black'

  // Reload when a new bundle is deployed (polls the hub's /build.json): the
  // <ReloadOnDeploy /> below, not mounted in edit mode.

  // Keep the school-calendar cache warm. Nothing here reads the result, but
  // getCachedCalendar() does - the boot view, the morning watchers below and
  // useTimer's offline fallback - and without a mounted consumer the cache
  // would only refresh on days Today happens to open, then expire mid-break.
  useSchoolCalendar()

  // Gating for boot/runtime auto behaviors. The Echo (KIOSK_ECHO) behaves like
  // the kitchen in all of these; only the legacy web TV opts out:
  //  - On the TV, a school-morning Today must win over a playing Sonos (the
  //    kitchen lets Sonos override). So suppress the Sonos boot override when
  //    the TV resolved to Today.
  //  - The TV never runs the kitchen's runtime schedule watchers; once it is
  //    launched into a view it stays there (PRD 5.4).
  // A screen that rests on its Today board (the front-door Echo Show 15)
  // never boots into Now Playing just because the Sonos is on: the board is
  // its job, the same way a school-morning Today wins on the TV.
  const sonosBootOverrideAllowed =
    !EDIT_MODE && AUTO_MODE && !(KIOSK_TV && initialView === 'today') && getHomeView() !== 'today'
  const runScheduleWatchers = !EDIT_MODE && AUTO_MODE && !KIOSK_TV

  // Imperative navigation for the tvOS shell (and any external driver).
  // Accepts a concrete view id, or 'next'/'prev' to cycle the TV-reachable
  // views. Kept on a ref so the cycler always sees the current view without
  // re-registering the handler on every navigation. The ref is written after
  // commit, not during render (a render may be thrown away); the handlers
  // only read it on a remote press, long after.
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  }, [view])
  useEffect(() => {
    if (EDIT_MODE) return undefined
    const ORDER = ['today', 'photos', 'music']
    window.appNav = (target) => {
      if (target === 'next' || target === 'prev') {
        const cur = viewRef.current
        let i = ORDER.indexOf(cur)
        if (i < 0) i = 0
        const delta = target === 'next' ? 1 : -1
        setView(ORDER[(i + delta + ORDER.length) % ORDER.length])
        return
      }
      if (['today', 'photos', 'music', 'settings', 'plex'].includes(target)) {
        setView(target)
      }
    }

    // Unified Siri Remote router. The web app owns the routing because it
    // knows the current view: left/right is "previous/next photo" in Photos
    // and "previous/next track" in Now Playing. volume-* are callable but
    // tvOS does not deliver the physical volume buttons to apps (reserved for
    // a future on-screen affordance).
    window.tvAction = (action) => {
      const cur = viewRef.current
      switch (action) {
        case 'view-next':
          window.appNav('next')
          break
        case 'view-prev':
          window.appNav('prev')
          break
        case 'ctx-left':
          if (cur === 'photos') window.photoNav && window.photoNav('prev')
          else if (cur === 'music') sonosCmd('/previous')
          break
        case 'ctx-right':
          if (cur === 'photos') window.photoNav && window.photoNav('next')
          else if (cur === 'music') sonosCmd('/next')
          break
        case 'playpause':
          sonosCmd('/playpause')
          break
        case 'volume-up':
          sonosCmd('/volume/+5')
          break
        case 'volume-down':
          sonosCmd('/volume/-5')
          break
        default:
          break
      }
    }

    return () => {
      if (window.appNav) delete window.appNav
      if (window.tvAction) delete window.tvAction
    }
  }, [setView])

  // A dashboard nudge ("Show Photos" on the hub's admin page). Arrives through
  // the settings poll as a one-shot command (settings.js handleHubCommand),
  // so it lands within about 10 s. It also wakes a dimmed or dark screen,
  // because a person asking to see a view expects to see it, the same as if
  // they had touched the panel.
  useEffect(() => {
    if (EDIT_MODE) return undefined
    function onShowView(e) {
      const target = e?.detail?.view
      if (!['today', 'photos', 'music', 'settings', 'plex'].includes(target)) return
      logEvent(`hub: show ${target}`)
      window.dispatchEvent(new CustomEvent('display-wake-now'))
      setView(target)
    }
    window.addEventListener('hub-show-view', onShowView)
    return () => window.removeEventListener('hub-show-view', onShowView)
  }, [setView])

  // One-shot Sonos check at app boot. If music is playing, bounce to the
  // Music view (overrides the synchronous Today/Photos initial choice).
  // Fires exactly once per page load; afterwards normal navigation rules
  // apply. A brief flash of Today/Photos is possible while the fetch is
  // outstanding; acceptable on a local-network Sonos API.
  useEffect(() => {
    if (!sonosBootOverrideAllowed) return undefined
    let cancelled = false
    fetchSonosIsPlaying().then((playing) => {
      if (cancelled) return
      if (playing) {
        logEvent('boot: sonos playing -> music view')
        setView('music')
      }
    })
    return () => {
      cancelled = true
    }
  }, [setView, sonosBootOverrideAllowed])

  // Runtime morning auto-show. The kiosk runs 24/7, so the boot-time logic
  // in computeInitialView() only catches mornings where the page reloads
  // between 5 AM and 8 AM (e.g., after a deploy). On a typical morning the
  // page has been open all night - we need a clock watcher to switch to
  // Today at school.autoShowAt.
  //
  // Fires once per calendar day. Uses localStorage as the "already-fired"
  // marker so that a page reload after autoShowAt doesn't re-trigger and
  // yank the user back to Today if they had navigated away.
  useEffect(() => {
    if (!runScheduleWatchers) return undefined
    const FIRED_KEY = 'kioskAutoShowFiredFor'
    function todayKey(now) {
      return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    }
    function check() {
      const settings = getSettings()
      const now = new Date()
      if (isNoSchoolToday(settings.school, getCachedCalendar(), now)) return
      const target = settings.school?.autoShowAt
      if (!target) return
      const targetMin = (target.hour | 0) * 60 + (target.minute | 0)
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (nowMin < targetMin) return
      const key = todayKey(now)
      if (localStorage.getItem(FIRED_KEY) === key) return
      localStorage.setItem(FIRED_KEY, key)
      // Only switch INSIDE the morning window. A page that first loads after
      // morningEndsAt with no marker for today (a fresh browser profile: the
      // Echo's first run, a laptop) used to jump to Today at 10 AM and stay
      // there, because the morning-end watcher had already marked the day.
      const end = settings.school?.morningEndsAt || { hour: 8, minute: 0 }
      const endMin = (end.hour | 0) * 60 + (end.minute | 0)
      if (nowMin >= endMin) return
      logEvent(`auto-show: today screen at ${target.hour}:${String(target.minute).padStart(2, '0')}`)
      setView('today')
    }
    check()
    const id = setInterval(check, 30 * 1000)
    return () => clearInterval(id)
  }, [setView, runScheduleWatchers])

  // Runtime morning-end watcher. Mirrors the auto-show watcher above, but
  // switches Today -> the home view at school.morningEndsAt instead of Photos
  // -> Today at autoShowAt. A screen whose home view is Today stays put.
  //
  // Marker semantics:
  //   - If view isn't Today  : set marker, don't switch (nothing to do).
  //   - If a timer is active : DON'T set marker yet, don't switch. The
  //     watcher will re-check on its next 30s tick, so the auto-leave
  //     fires as soon as the user dismisses the timer or it expires past
  //     the morning-end window.
  //   - Otherwise            : set marker AND switch to the home view.
  function isTimerActive(now) {
    const mode = localStorage.getItem('kioskTimerMode') || 'no-timer'
    if (mode === 'set-timer') return true
    if (mode === 'active') {
      const tStr = localStorage.getItem('kioskTimerTarget')
      if (tStr) {
        const t = new Date(tStr)
        if (!Number.isNaN(t.getTime()) && t.getTime() > now.getTime()) return true
      }
    }
    return false
  }
  useEffect(() => {
    if (!runScheduleWatchers) return undefined
    const FIRED_KEY = 'kioskMorningEndFiredFor'
    function todayKey(now) {
      return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
    }
    function check() {
      const settings = getSettings()
      const now = new Date()
      if (isNoSchoolToday(settings.school, getCachedCalendar(), now)) return
      const target = settings.school?.morningEndsAt
      if (!target) return
      const targetMin = (target.hour | 0) * 60 + (target.minute | 0)
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (nowMin < targetMin) return
      const key = todayKey(now)
      if (localStorage.getItem(FIRED_KEY) === key) return
      // Defer if a timer is in flight - watcher will catch it on the
      // next tick after the timer is cleared.
      if (isTimerActive(now)) return
      // Past the time, no timer in the way - mark the day as handled.
      localStorage.setItem(FIRED_KEY, key)
      if (view !== 'today') return
      const home = getHomeView()
      if (home === 'today') return
      logEvent(`auto-leave: today -> ${home} at ${target.hour}:${String(target.minute).padStart(2, '0')}`)
      setView(home)
    }
    check()
    const id = setInterval(check, 30 * 1000)
    return () => clearInterval(id)
  }, [view, setView, runScheduleWatchers])

  // (No no-school push here any more. The hub derives noSchoolToday itself,
  // from the shared school settings and its own calendar, for every screen and
  // the Apple TV; the kitchen used to POST its own answer to the Pi.)

  function onShellClick(e) {
    if (EDIT_MODE) return
    const tag = e.target.tagName
    const cls = (e.target.className && typeof e.target.className === 'string')
      ? e.target.className.split(/\s+/).slice(0, 2).join('.')
      : ''
    const interactive = isInsideInteractive(e.target, e.currentTarget)
    logEvent(`shell click: ${tag}.${cls} interactive=${interactive} menuOpen=${menuOpen}`)
    if (menuOpen) return
    if (interactive) return
    setMenuOpen(true)
  }

  // Stable so MenuPill's useEffect deps do not change every render (which
  // would keep clearing and re-arming the autofade timer forever).
  const closeMenu = useCallback(() => {
    logEvent('menu close')
    setMenuOpen(false)
  }, [])

  return (
    <div className="app-shell" onClick={onShellClick}>
      <PixelShift enabled={pixelShift && !EDIT_MODE}>
        <CurrentView />
      </PixelShift>
      {!EDIT_MODE && <MenuPill open={menuOpen} onClose={closeMenu} />}
      {!EDIT_MODE && <NightMode showOverlay={!KIOSK_TV} nightFace={nightFace} />}
      {/* Keep-alive audio, fullscreen and the tap-to-start overlay for Silk. */}
      {KIOSK_ECHO && !EDIT_MODE && <EchoMode />}
      {!EDIT_MODE && <ReloadOnDeploy />}
      {/* Show the Plex view while the followed player plays (display.plexFollow). */}
      {!EDIT_MODE && !KIOSK_TV && <PlexFollow />}
      <DebugHud />
    </div>
  )
}

export default function AppShell() {
  const initialView = resolveInitialView()
  return (
    <ViewProvider initialView={initialView}>
      <Shell initialView={initialView} />
    </ViewProvider>
  )
}
