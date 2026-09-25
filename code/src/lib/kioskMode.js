// kioskMode - one-time parse of the URL params that select a kiosk surface.
//
// The kitchen display loads the app with no query params. The legacy web TV
// surface loads it with `?view=auto&kiosk=tv`. The family-room Echo Show loads
// it from FrameServer with `?kiosk=echo`. This module reads those params once
// at import and exposes the resulting flags, plus sets <body data-kiosk="...">
// so CSS can branch per form factor before the React tree mounts.
//
// Sonos routing used to be rewritten here for the TV; every surface now goes
// through the hub proxy (lib/hub.js), so there is nothing to rewrite.
//
// ?edit=1 is the layout editor's preview of a screen (docs/designs/
// layout-editor.md): the editor page loads the app in an iframe with it. No
// kiosk ever carries it.
//
// NOTE: settings.js and hub.js intentionally do NOT import this module (they
// parse the kiosk flag themselves) so there is no import cycle.

const VALID_VIEWS = ['today', 'photos', 'music', 'settings']
// Mirrors views/TodayLayouts/registry.js (not imported: keep this module
// dependency-free so it can run before the tree mounts).
const VALID_LAYOUTS = ['framed', 'board', 'briefing', 'ambient', 'entry']

function parseParams() {
  if (typeof window === 'undefined') {
    return { rawView: null, view: null, kioskTv: false, kioskEcho: false, layout: null, edit: false }
  }
  const p = new URLSearchParams(window.location.search)
  const rawView = p.get('view')
  const rawLayout = p.get('layout')
  return {
    rawView,
    view: VALID_VIEWS.includes(rawView) ? rawView : null,
    kioskTv: p.get('kiosk') === 'tv',
    kioskEcho: p.get('kiosk') === 'echo',
    layout: VALID_LAYOUTS.includes(rawLayout) ? rawLayout : null,
    edit: p.get('edit') === '1',
  }
}

const parsed = parseParams()

// An explicitly requested concrete view (today/photos/music/settings), or null.
export const REQUESTED_VIEW = parsed.view
// True when the URL asked for ?view=auto, or carried no view param (kitchen).
export const AUTO_MODE = parsed.rawView === 'auto' || parsed.rawView == null
// True when running as the legacy web TV surface (?kiosk=tv).
export const KIOSK_TV = parsed.kioskTv
// True when running on the family-room Echo Show in Silk (?kiosk=echo). Behaves
// like the kitchen (watchers, dim schedule, night face) minus anything that
// needs a Pi panel, plus the keep-alive and fullscreen dance in shell/EchoMode.
export const KIOSK_ECHO = parsed.kioskEcho
// A Today layout requested for this page load only (?layout=board). Wins over
// the saved display.todayLayout setting without changing it, so a laptop can
// preview a layout while the kitchen keeps its own.
export const REQUESTED_LAYOUT = parsed.layout
// The layout editor's preview (?edit=1): a picture of a screen, not a screen.
// The shell runs no kiosk behaviour (no menu, no dimming, no Echo keep-alive,
// no reload on deploy, no schedule or Sonos view switching; the view stays
// Today), the settings store writes nothing (settings.js READ_ONLY, parsed
// there on its own to keep that module free of this one), and the Entry board
// talks to the editor (views/TodayLayouts/editBridge.js).
export const EDIT_MODE = parsed.edit

// --- Side effects, applied once at import. ESM runs after DOM parse, so
// document.body is normally present; guard anyway for safety. -----------------
const KIOSK_KIND = KIOSK_TV ? 'tv' : KIOSK_ECHO ? 'echo' : null
if (KIOSK_KIND && typeof document !== 'undefined') {
  const applyBodyAttr = () => {
    if (document.body) document.body.setAttribute('data-kiosk', KIOSK_KIND)
  }
  if (document.body) applyBodyAttr()
  else document.addEventListener('DOMContentLoaded', applyBodyAttr, { once: true })
}
