import { useEffect, useRef, useState } from 'react'
import { KIOSK_ECHO } from '../lib/kioskMode.js'
import { SERVED_BY_HUB, hubUrl } from '../lib/hub.js'
import { logEvent } from './DebugLog.jsx'
import './EchoMode.css'

// EchoMode - keeps Silk on the family-room Echo Show parked on this page.
//
// The Echo loads the app from FrameServer as ?kiosk=echo (see
// docs/designs/echo-show-and-hub.md). Silk drops back to the Alexa home screen
// when a page sits idle unless it is playing media, and it refuses unmuted
// audio and fullscreen until the page has had a user gesture. So:
//
//   - A one-minute silent MP3 (public/silence.mp3) is started muted at mount,
//     as the reference keep-silk-open script does. (Stock Chromium only lets
//     muted VIDEO autoplay without a gesture, so before the tap this may not
//     play at all; it costs nothing to try, and the tap is what counts.) It
//     deliberately does NOT use `loop`: when it ends it is reloaded under a
//     fresh ?q= cache-buster, so Silk sees a new media load every minute,
//     which the reference credits for beating the inactivity timeout.
//   - Until the first tap a dark gate covers the page. That tap unmutes the
//     audio and asks for fullscreen. The gate closes at the end of that first
//     gesture even if the audio could not start (the chip then says so and the
//     next tap tries again): never more than one tap.
//   - Anything that pauses the audio gets a resume: the pause event, the page
//     becoming visible again, and a 15 s watchdog. If Silk ever takes the
//     permission back (play() fails with NotAllowedError) the gate returns.
//   - Leaving fullscreen cannot be undone without a gesture, so the next tap
//     anywhere asks for it again, once per tap.
//   - A soft reload in the same tab (a deploy, the dashboard's Reload) skips
//     the gate when unmuted play() works without a new gesture: Chromium
//     usually carries the earlier tap across a same-origin reload. If it does
//     not, the gate comes back.
//
// Renders nothing outside echo mode.

const ARMED_KEY = 'echoArmedAt'
const WATCHDOG_MS = 15 * 1000
// Gesture events closer together than this belong to the same tap, so each
// tap makes at most one audio attempt and one fullscreen request.
const ONE_TAP_MS = 1000
const GATE_FADE_MS = 250
// The arming tap normally ends in a click, which closes the gate and is
// absorbed by it. A long press has no click, so close the gate anyway after
// this long once the audio is up.
const GATE_FALLBACK_MS = 700
// While a fresh copy of the file is loading the element reports paused. That
// is not "audio off", so the chip ignores it for this long.
const RELOAD_GRACE_MS = 8 * 1000
// Soft reload: if the unmuted attempt has not settled by then, show the gate.
const CHECK_TIMEOUT_MS = 4 * 1000
// After a load error (the hub down, a bad file) no fresh load is attempted
// for this long; the watchdog retries after it. Without this, every failed
// load fired `pause`, every `pause` queued another resume, and a page whose
// server had gone away hammered it several times a second, growing (seen in
// the browser pane on 2026-09-24 when the local hub was stopped).
const ERROR_BACKOFF_MS = 10 * 1000

const FILES = { mp3: 'silence.mp3', wav: 'silence.wav' }

// Served next to index.html in both places the bundle lives (public/ is
// copied to the build root), so resolve against the page itself.
function fileUrl(name) {
  if (SERVED_BY_HUB) return hubUrl(`/${name}`)
  try {
    return new URL(name, window.location.href).href
  } catch {
    return name
  }
}

function readArmedAt() {
  try {
    return sessionStorage.getItem(ARMED_KEY)
  } catch {
    return null
  }
}

// --- user activation ---------------------------------------------------------
// Unmuted play() needs the page to have been activated at some point (sticky);
// requestFullscreen() needs a fresh activation (transient), and consumes it. A
// touch only activates on its way up (pointerup / touchend / click), never on
// pointerdown, so all of these are listened to and each attempt checks
// navigator.userActivation where it exists (Chromium 72+).
//
// Order matters: the audio goes first. Under Chromium's older "user gesture
// required" autoplay policy (still what some Android builds run) play() needs
// the transient activation too, and requestFullscreen() would already have
// used it up. A play() made inside a gesture also unlocks the element for
// good under that policy, which is what lets the per-minute reloads and the
// resumes play without a new tap. Found in headless Chrome run with
// --autoplay-policy=user-gesture-required: fullscreen came on, sound did not.
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown']
const ACTIVATING = new Set(['pointerup', 'touchend', 'mousedown', 'click', 'keydown'])

function transientActivation(e) {
  const ua = navigator.userActivation
  if (ua) return ua.isActive
  if (e.type === 'pointerdown') return e.pointerType === 'mouse'
  return ACTIVATING.has(e.type)
}

function stickyActivation(e) {
  const ua = navigator.userActivation
  if (ua) return ua.hasBeenActive
  return transientActivation(e)
}

// --- fullscreen ----------------------------------------------------------------
function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function fullscreenSupported() {
  const el = document.documentElement
  if (!el || !(el.requestFullscreen || el.webkitRequestFullscreen)) return false
  const enabled = document.fullscreenEnabled ?? document.webkitFullscreenEnabled
  return enabled !== false
}

function requestFullscreen(onFail) {
  const el = document.documentElement
  try {
    const p = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: 'hide' })
      : el.webkitRequestFullscreen()
    if (p && typeof p.catch === 'function') p.catch(() => onFail())
  } catch {
    onFail() // not allowed right now
  }
}

function currentStatus() {
  return { audio: false, fullscreen: fullscreenSupported() ? !!fullscreenElement() : null }
}

function stopPropagation(e) {
  // The gate may sit inside .app-shell, whose click handler opens the menu
  // pill. The tap that dismisses the gate must not also do that.
  e.stopPropagation()
}

export default function EchoMode() {
  if (!KIOSK_ECHO) return null
  return <EchoKeepAlive />
}

function EchoKeepAlive() {
  const audioRef = useRef(null)
  // 'checking' (soft reload, trying unmuted) | 'shown' | 'closing' | 'hidden'
  const [gate, setGateState] = useState(() => (readArmedAt() ? 'checking' : 'shown'))
  const gateRef = useRef(gate)
  const [status, setStatus] = useState(currentStatus)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined

    let disposed = false
    let armed = false
    let reloadingSince = 0
    let retryAfter = 0        // no fresh loads before this time (after an error)
    let resumeQueued = false  // at most one pending resume from `pause`
    let lastAttemptAt = 0
    let lastFullscreenAt = 0
    let lastTime = -1
    const timers = new Set()

    // MP3 first. A format that has played once is kept; one that fails before
    // it ever played hands over to the other file.
    let format = audio.canPlayType && audio.canPlayType('audio/mpeg') ? 'mp3' : 'wav'
    const played = { mp3: false, wav: false }

    const later = (fn, ms) => {
      const id = setTimeout(() => {
        timers.delete(id)
        if (!disposed) fn()
      }, ms)
      timers.add(id)
    }

    function setGate(next) {
      if (gateRef.current === next) return
      gateRef.current = next
      setGateState(next)
    }

    function refresh() {
      if (disposed) return
      const reloading = reloadingSince > 0 && Date.now() - reloadingSince < RELOAD_GRACE_MS
      const next = {
        audio: armed && !audio.muted && (!audio.paused || reloading),
        fullscreen: fullscreenSupported() ? !!fullscreenElement() : null,
      }
      setStatus((prev) =>
        prev.audio === next.audio && prev.fullscreen === next.fullscreen ? prev : next)
    }

    function play() {
      try {
        const p = audio.play()
        return p && typeof p.then === 'function' ? p : Promise.resolve()
      } catch (err) {
        return Promise.reject(err)
      }
    }

    // A fresh copy under a new URL, from the top, so Silk sees a new media load.
    function freshLoad() {
      reloadingSince = Date.now()
      audio.src = `${fileUrl(FILES[format])}?q=${Date.now()}`
      audio.currentTime = 0
      return play()
    }

    function closeGate() {
      const g = gateRef.current
      if (g === 'checking') {
        setGate('hidden')
        return
      }
      if (g !== 'shown') return
      setGate('closing')
      later(() => {
        if (gateRef.current === 'closing') setGate('hidden')
      }, GATE_FADE_MS)
    }

    function markArmed() {
      if (armed || disposed) return
      armed = true
      try {
        sessionStorage.setItem(ARMED_KEY, String(Date.now()))
      } catch {
        // storage disabled: a reload will simply show the gate again
      }
      logEvent('echo: armed, audio unmuted')
      if (gateRef.current === 'checking') setGate('hidden')
      else later(closeGate, GATE_FALLBACK_MS)
      refresh()
    }

    // Silk took the permission back: mute, keep the file going if it will
    // play muted, and ask for a tap again.
    function disarm() {
      if (!armed) return
      armed = false
      try {
        sessionStorage.removeItem(ARMED_KEY)
      } catch {
        // storage disabled
      }
      logEvent('echo: audio permission lost, showing the gate')
      audio.muted = true
      play().catch(() => {})
      setGate('shown')
      refresh()
    }

    function onPlayError(err) {
      if (disposed || !err) return
      if (err.name === 'NotAllowedError' && armed) disarm()
      // AbortError: a newer load replaced this one. Anything else (the file
      // did not load): the watchdog retries.
    }

    function resume() {
      if (disposed || !audio.paused) return
      if (audio.error || audio.ended || !audio.currentSrc) {
        if (Date.now() < retryAfter) return // backing off; the watchdog returns here
        freshLoad().catch(onPlayError)
      } else {
        play().catch(onPlayError)
      }
    }

    // Unmute and start a fresh copy. Called from a gesture that carries
    // activation, or once at mount after a soft reload. onFail runs when the
    // audio could not start with sound.
    function tryUnmuted(onFail) {
      audio.muted = false
      freshLoad()
        .then(() => {
          if (!audio.muted) markArmed()
        })
        .catch((err) => {
          if (disposed || armed) return
          if (err && err.name === 'AbortError') return // superseded; that load reports
          lastAttemptAt = 0 // a later event of the same tap may carry what this one lacked
          audio.muted = true
          play().catch(() => {})
          if (onFail) onFail(err)
          refresh()
        })
    }

    function onGesture(e) {
      if (disposed || e.isTrusted === false) return
      const now = Date.now()
      // Audio before fullscreen: see the note above transientActivation().
      if (!armed && stickyActivation(e) && now - lastAttemptAt > ONE_TAP_MS) {
        lastAttemptAt = now
        tryUnmuted()
      }
      if (
        fullscreenSupported() && !fullscreenElement() &&
        transientActivation(e) && now - lastFullscreenAt > ONE_TAP_MS
      ) {
        lastFullscreenAt = now
        requestFullscreen(() => {
          lastFullscreenAt = 0 // refused: a later event of the same tap may try
        })
      }
      // The end of the first gesture always opens the page.
      if (e.type === 'click' || e.type === 'keydown') closeGate()
    }

    function onPlaying() {
      reloadingSince = 0
      played[format] = true
      if (!audio.muted) markArmed()
      refresh()
    }

    function onPause() {
      // Reaching the end pauses first; onEnded reloads the file. A load error
      // pauses too; onError sets the backoff and the watchdog retries.
      if (audio.ended || audio.error) return
      // Let an unmute or a src swap settle before deciding it needs help. One
      // pending resume at a time: each swap fires its own `pause`, and stacking
      // a timer per event is what turned a dead server into a request storm.
      if (!resumeQueued) {
        resumeQueued = true
        later(() => {
          resumeQueued = false
          resume()
        }, 400)
      }
      later(refresh, 1500)
    }

    function onEnded() {
      freshLoad().catch(onPlayError)
    }

    function onError() {
      const code = audio.error ? audio.error.code : 0
      // 3 = decode, 4 = unsupported (also how a 404 looks). Swap files only if
      // this one never played; a file that played before is a network blip.
      if ((code === 3 || code === 4) && !played[format]) format = format === 'mp3' ? 'wav' : 'mp3'
      reloadingSince = 0
      retryAfter = Date.now() + ERROR_BACKOFF_MS
      logEvent(`echo: audio error ${code}, retrying in ${ERROR_BACKOFF_MS / 1000}s`)
      refresh()
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') resume()
      refresh()
    }

    function onFullscreenChange() {
      logEvent(`echo: fullscreen ${fullscreenElement() ? 'on' : 'off'}`)
      refresh()
    }

    const watchdog = setInterval(() => {
      if (disposed) return
      if (audio.paused) {
        resume()
      } else if (
        audio.currentTime === lastTime &&
        Date.now() - reloadingSince > WATCHDOG_MS &&
        Date.now() >= retryAfter
      ) {
        // Playing on paper but not moving: a stalled load. Start a fresh one.
        freshLoad().catch(onPlayError)
      }
      lastTime = audio.currentTime
      refresh()
    }, WATCHDOG_MS)

    const capture = { capture: true, passive: true }
    GESTURE_EVENTS.forEach((t) => document.addEventListener(t, onGesture, capture))
    document.addEventListener('visibilitychange', onVisibility)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', onFullscreenChange)
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.addEventListener('volumechange', refresh)

    audio.defaultMuted = true
    audio.muted = true
    audio.autoplay = true
    audio.preload = 'auto'

    if (gateRef.current === 'checking') {
      tryUnmuted(() => {
        logEvent('echo: reload needs a tap, showing the gate')
        setGate('shown')
      })
      later(() => {
        if (!armed && gateRef.current === 'checking') setGate('shown')
      }, CHECK_TIMEOUT_MS)
    } else {
      freshLoad().catch(() => {})
    }

    return () => {
      disposed = true
      clearInterval(watchdog)
      timers.forEach((id) => clearTimeout(id))
      GESTURE_EVENTS.forEach((t) => document.removeEventListener(t, onGesture, capture))
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('volumechange', refresh)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [])

  const fullscreenText = status.fullscreen == null ? 'n/a' : status.fullscreen ? 'on' : 'off'
  // Hidden once everything is on. Fullscreen that Silk does not offer at all
  // is not held against it.
  const chipHidden = status.audio && status.fullscreen !== false

  return (
    <>
      <audio ref={audioRef} preload="auto" playsInline aria-hidden="true" />
      {!chipHidden && (
        <div className="echo-chip" aria-hidden="true">
          echo · audio {status.audio ? 'on' : 'off'} · fullscreen {fullscreenText}
        </div>
      )}
      {(gate === 'shown' || gate === 'closing') && (
        <div
          className={`echo-gate${gate === 'closing' ? ' echo-gate--closing' : ''}`}
          role="button"
          aria-label="Tap to start"
          data-interactive="true"
          onClick={stopPropagation}
        >
          <div className="echo-gate__pill">Tap to start</div>
          <div className="echo-gate__hint">keeps the screen awake and goes fullscreen</div>
        </div>
      )}
    </>
  )
}
