// kioskMode - one-time parse of the URL params that select a kiosk surface.
//
// The kitchen display loads the app with no query params. The Apple TV loads
// it with `?view=auto&kiosk=tv`. This module reads those params once at import
// and exposes the resulting flags, plus applies the side effects that must
// happen before (or as) the React tree mounts:
//   1. set <body data-kiosk="tv"> so CSS can branch for the TV form factor
//   2. in TV mode, point Sonos at the Pi-side proxy (the TV cannot reach the
//      Pi's localhost:5005 directly; "localhost" on the Apple TV is itself)
//
// NOTE: settings.js intentionally does NOT import this module (it parses the
// kiosk flag itself) so there is no import cycle.

import { updateSettings } from './settings.js'

const VALID_VIEWS = ['today', 'photos', 'music', 'settings']

function parseParams() {
  if (typeof window === 'undefined') {
    return { rawView: null, view: null, kioskTv: false }
  }
  const p = new URLSearchParams(window.location.search)
  const rawView = p.get('view')
  return {
    rawView,
    view: VALID_VIEWS.includes(rawView) ? rawView : null,
    kioskTv: p.get('kiosk') === 'tv',
  }
}

const parsed = parseParams()

// An explicitly requested concrete view (today/photos/music/settings), or null.
export const REQUESTED_VIEW = parsed.view
// True when the URL asked for ?view=auto, or carried no view param (kitchen).
export const AUTO_MODE = parsed.rawView === 'auto' || parsed.rawView == null
// True when running as the Apple TV surface.
export const KIOSK_TV = parsed.kioskTv

// --- Side effects, applied once at import. ESM runs after DOM parse, so
// document.body is normally present; guard anyway for safety. -----------------
if (KIOSK_TV && typeof document !== 'undefined') {
  const applyBodyAttr = () => {
    if (document.body) document.body.setAttribute('data-kiosk', 'tv')
  }
  if (document.body) applyBodyAttr()
  else document.addEventListener('DOMContentLoaded', applyBodyAttr, { once: true })

  // Route Sonos through the Pi proxy on the same origin (port 8080) instead of
  // the kitchen's localhost:5005 default.
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    updateSettings({ sonos: { apiBase: `${window.location.origin}/api/sonos` } })
  }
}
