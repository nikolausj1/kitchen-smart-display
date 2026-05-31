import { useCallback, useEffect, useRef, useState } from 'react'
import TodayView from '../views/TodayView/TodayView.jsx'
import PhotoSlideshow from '../views/PhotoSlideshow/PhotoSlideshow.jsx'
import NowPlaying from '../views/NowPlaying/NowPlaying.jsx'
import SettingsView from '../views/Settings/SettingsView.jsx'
import ComingSoonView from '../views/ComingSoon/ComingSoonView.jsx'
import MenuPill from './MenuPill.jsx'
import { ViewProvider, useView } from './ViewContext.jsx'
import { DebugHud, logEvent } from './DebugLog.jsx'
import { getSettings } from '../lib/settings.js'
import useDisplaySchedule from './useDisplaySchedule.js'
import DimOverlay from './DimOverlay.jsx'
import useSharedState from '../hooks/useSharedState.js'
import { AUTO_MODE, KIOSK_TV, REQUESTED_VIEW } from '../lib/kioskMode.js'

// --- Boot-time view selection -----------------------------------------------
//
// Priority at page load (highest first):
//   1. Sonos is currently playing  -> 'music'   (decided async, post-mount)
//   2. School day AND 5:00 <= now < 8:00       -> 'today'
//   3. Default                                  -> 'photos'
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
  const day = now.getDay()
  const hour = now.getHours()
  const minute = now.getMinutes()
  const isSchoolDay = school?.schoolDays?.includes(day)
  if (!isSchoolDay) return 'photos'
  if (hour < MORNING_START_HOUR) return 'photos'
  // Compare minute precision against school.morningEndsAt so the boot
  // window matches the runtime auto-leave watcher exactly.
  const end = school?.morningEndsAt || { hour: 8, minute: 0 }
  const nowMin = hour * 60 + minute
  const endMin = (end.hour | 0) * 60 + (end.minute | 0)
  return nowMin < endMin ? 'today' : 'photos'
}

// Resolve the initial view at boot. An explicit ?view=today|photos|music|
// settings wins outright (deep-links, or the TV launching into a known view).
// Otherwise fall back to the time-of-day heuristic above (?view=auto / none).
function resolveInitialView() {
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
// On the TV, sonos.apiBase points at the Pi /api/sonos proxy, so these work
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
  const { view } = useView()
  switch (view) {
    case 'today':
      return <TodayView />
    case 'photos':
      return <PhotoSlideshow />
    case 'music':
      return <NowPlaying />
    case 'settings':
      return <SettingsView />
    default:
      return <TodayView />
  }
}

function Shell({ initialView }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { view, setView } = useView()
  const display = useDisplaySchedule()

  // Keep the TV's synced settings fresh from the Pi (no-op on the kitchen).
  useSharedState()

  // Gating for boot/runtime auto behaviors:
  //  - On the TV, a school-morning Today must win over a playing Sonos (the
  //    kitchen lets Sonos override). So suppress the Sonos boot override when
  //    the TV resolved to Today.
  //  - The TV never runs the kitchen's runtime schedule watchers; once it is
  //    launched into a view it stays there (PRD 5.4).
  const sonosBootOverrideAllowed =
    AUTO_MODE && !(KIOSK_TV && initialView === 'today')
  const runScheduleWatchers = AUTO_MODE && !KIOSK_TV

  // Imperative navigation for the tvOS shell (and any external driver).
  // Accepts a concrete view id, or 'next'/'prev' to cycle the TV-reachable
  // views. Kept on a ref so the cycler always sees the current view without
  // re-registering the handler on every navigation.
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
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
      if (['today', 'photos', 'music', 'settings'].includes(target)) {
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
      const day = now.getDay()
      const isSchoolDay = settings.school?.schoolDays?.includes(day)
      if (!isSchoolDay) return
      const target = settings.school?.autoShowAt
      if (!target) return
      const targetMin = (target.hour | 0) * 60 + (target.minute | 0)
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (nowMin < targetMin) return
      const key = todayKey(now)
      if (localStorage.getItem(FIRED_KEY) === key) return
      localStorage.setItem(FIRED_KEY, key)
      logEvent(`auto-show: today screen at ${target.hour}:${String(target.minute).padStart(2, '0')}`)
      setView('today')
    }
    check()
    const id = setInterval(check, 30 * 1000)
    return () => clearInterval(id)
  }, [setView, runScheduleWatchers])

  // Runtime morning-end watcher. Mirrors the auto-show watcher above, but
  // switches Today -> Photos at school.morningEndsAt instead of Photos ->
  // Today at autoShowAt.
  //
  // Marker semantics:
  //   - If view isn't Today  : set marker, don't switch (nothing to do).
  //   - If a timer is active : DON'T set marker yet, don't switch. The
  //     watcher will re-check on its next 30s tick, so the auto-leave
  //     fires as soon as the user dismisses the timer or it expires past
  //     the morning-end window.
  //   - Otherwise            : set marker AND switch to Photos.
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
      const day = now.getDay()
      const isSchoolDay = settings.school?.schoolDays?.includes(day)
      if (!isSchoolDay) return
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
      logEvent(`auto-leave: today -> photos at ${target.hour}:${String(target.minute).padStart(2, '0')}`)
      setView('photos')
    }
    check()
    const id = setInterval(check, 30 * 1000)
    return () => clearInterval(id)
  }, [view, setView, runScheduleWatchers])

  function onShellClick(e) {
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
      <CurrentView />
      <MenuPill open={menuOpen} onClose={closeMenu} />
      {!KIOSK_TV && (
        <DimOverlay
          actualMode={display.actualMode}
          wakeBrightness={display.wakeBrightness}
          eveningBrightness={display.eveningBrightness}
        />
      )}
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
