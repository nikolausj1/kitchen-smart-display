// hub.js - the ONE place that knows where FrameServer (the hub) is.
//
// Every screen in the house reads photos, settings, house state, lunch, the
// school calendar, the photo-flag queue and Sonos through the hub. Before
// 2026-09-24 those were split between the hub and the kitchen Pi, and the app
// found the hub through PHOTOS.baseUrl alone. Now:
//
//   1. ?hub=http://host:port   explicit override, remembered in localStorage
//                              (?hub=clear forgets it). For laptops and tests.
//   2. <meta name="smart-display-hub" content="self">
//                              injected by FrameServer into index.html when it
//                              serves the app itself. Same-origin is the hub,
//                              whatever name or IP the screen typed. This is
//                              what makes the Echo work: Silk on Fire OS cannot
//                              resolve nuc.local, so it loads the app by IP,
//                              and everything else follows that origin.
//   3. PHOTOS.baseUrl          the compiled default (nuc.local:8095), used by
//                              the kitchen Pi, whose Chromium resolves mDNS.
//   4. ''                      same-origin, relative URLs: samplePhotos dev
//                              mode and any pre-migration rollback.
//
// Parsed once at import. Deliberately dependency-free apart from config.js so
// settings.js, the hooks and the shell can all import it without a cycle.

import { PHOTOS } from '../config.js'

const HUB_OVERRIDE_KEY = 'kitchenDisplayHub'

function strip(u) {
  return String(u || '').trim().replace(/\/+$/, '')
}

function readMetaHub() {
  if (typeof document === 'undefined') return null
  const meta = document.querySelector('meta[name="smart-display-hub"]')
  if (!meta) return null
  const content = strip(meta.getAttribute('content'))
  if (!content || content === 'self' || content === 'same-origin') {
    return typeof window !== 'undefined' && window.location ? strip(window.location.origin) : ''
  }
  return content
}

function resolve() {
  if (typeof window === 'undefined') {
    return { hub: strip(PHOTOS.baseUrl), servedByHub: false, source: 'config' }
  }
  const params = new URLSearchParams(window.location.search)
  const q = params.get('hub')
  if (q) {
    if (q === 'clear') {
      try { localStorage.removeItem(HUB_OVERRIDE_KEY) } catch { /* storage disabled */ }
    } else {
      try { localStorage.setItem(HUB_OVERRIDE_KEY, strip(q)) } catch { /* storage disabled */ }
      return { hub: strip(q), servedByHub: false, source: 'param' }
    }
  }
  try {
    const saved = localStorage.getItem(HUB_OVERRIDE_KEY)
    if (saved) return { hub: strip(saved), servedByHub: false, source: 'saved' }
  } catch { /* storage disabled */ }

  const meta = readMetaHub()
  if (meta != null) return { hub: meta, servedByHub: true, source: 'meta' }

  return { hub: strip(PHOTOS.baseUrl), servedByHub: false, source: 'config' }
}

const resolved = resolve()

// '' (same-origin) or 'http://host:port' with no trailing slash.
export const HUB = resolved.hub
// True when FrameServer served this page (the meta marker was present).
export const SERVED_BY_HUB = resolved.servedByHub
// Where HUB came from: 'param' | 'saved' | 'meta' | 'config'. For the debug HUD.
export const HUB_SOURCE = resolved.source

export function hubUrl(path) {
  return `${HUB}${path.startsWith('/') ? path : `/${path}`}`
}

// Which kiosk surface this is, parsed here (not via kioskMode.js) so this
// module stays import-cycle free. Mirrors settings.js.
const KIOSK =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('kiosk')
    : null

// Only a Pi with its own panel exposes the DDC/CI endpoints
// (/api/display/*), and it exposes them on the SAME origin as the bundle it
// serves. A screen that got the app from the hub (the Echo, a laptop hitting
// the NUC) has no panel to drive, and must never POST to /api/display/* -
// on the hub that is a 404, but before this rule existed a stray tab could
// hit the kitchen Pi and drive the kitchen's backlight.
export const HAS_PANEL = !SERVED_BY_HUB && KIOSK !== 'tv' && KIOSK !== 'echo'
