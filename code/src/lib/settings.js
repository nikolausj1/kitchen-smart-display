import { useSyncExternalStore } from 'react'
import { HUB, hubUrl, SERVED_BY_HUB } from './hub.js'

// Settings store.
//
// FrameServer (the hub) is the source of truth; localStorage is a cache that
// keeps this screen working when the hub is unreachable. Before Phase 2 the
// kitchen's localStorage WAS the master and pushed a three-key subset to the
// Pi's /api/state - a model that could not express "the living room shows
// different albums than the kitchen", because every web client shared one blob.
//
// Two scopes now:
//   SHARED  one value for the family (location, school, timer colours)
//   DEVICE  per screen (albums, display mode, brightness, Sonos room)
//
// Nothing here writes /api/state any more. The hub composes that document from
// the registry itself (shared location + school, the kitchen's slideshow), and
// the live house state - the shared morning countdown - has its own store in
// lib/houseState.js. The old postSharedState / postTimerState /
// postSchoolDayState pushes to the Pi went with that move (2026-09-24).
//
// Where the hub is comes from lib/hub.js; every URL below goes through hubUrl().
//
// The SettingsView writes; every hook reads via useSettings().

const STORAGE_KEY = 'kitchenDisplaySettings'
const DEVICE_ID_KEY = 'kitchenDisplayDeviceId'
// Which device id wrote the settings cache. The cache belongs to the browser
// ORIGIN, the identity to the URL: switch ?device= on one origin and, without
// this tag, the old device's per-screen settings would ride into the new
// device's registry entry on its self-seeding registration (seen in testing:
// a dev Echo registered with the dev Mac's hardwareDim). On a mismatch only
// the house-wide keys are kept from the cache.
const STORAGE_DEVICE_KEY = 'kitchenDisplaySettingsDevice'
const LAST_COMMAND_KEY = 'kitchenDisplayLastCommandTs'

// House-wide vs per-screen. Anything not listed here stays local-only.
//
// layouts: the screen's layout specs from the layout editor (config.layouts
// .entry, views/TodayLayouts/layoutSpec.js), read on the normal poll. Only the
// editor writes them, straight to the hub, so they are left out of what a
// screen writes back (DEVICE_WRITE_SCOPE): a setting changed on a panel can
// then never push that panel's older copy over a layout just saved.
const SHARED_SCOPE = ['location', 'school', 'timerThresholds', 'weatherSlots']
const DEVICE_SCOPE = ['slideshow', 'display', 'sonos', 'layouts']
const DEVICE_WRITE_SCOPE = DEVICE_SCOPE.filter((k) => k !== 'layouts')

// Which kiosk surface this is, parsed directly from the URL (not via
// kioskMode.js) to avoid an import cycle.
const KIOSK =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('kiosk')
    : null
// The legacy web TV surface. It no longer implies read-only: every screen owns
// its own device config. It still may not flag photos (postPhotoFlag).
const IS_TV = KIOSK === 'tv'
// The family-room Echo Show in Silk: its own default identity, no panel of its
// own (see the display DEFAULTS), and a first registration seeded from the
// kitchen.
const IS_ECHO = KIOSK === 'echo'

// The layout editor's preview of a screen (?edit=1; lib/kioskMode.js
// EDIT_MODE, parsed here on its own for the same reason as KIOSK). It shows
// that screen's real settings and must never change them, so in this mode the
// store writes nothing anywhere: no settings PATCH, no Sonos heal, no photo
// flag, no one-shot hub commands, and nothing in this browser's storage (not
// even the remembered ?device=, or the Mac would wake up as the Echo it last
// edited). It reads its settings with a plain GET instead of registering, and
// still polls. Exported for the other stores (lib/houseState.js's countdown
// POST should check it too).
export const READ_ONLY =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('edit') === '1'

// Identity comes from the kiosk URL (?device=living-room), extending the
// existing ?kiosk=tv pattern, and is remembered so a reload without the param
// keeps the same identity. The hub assigns nothing - devices name themselves,
// and the dashboard can re-point an existing config at a new device, so
// reflashing a Pi never loses its settings.
//
// With no ?device and nothing remembered: ?kiosk=echo is 'family-room-echo',
// ?kiosk=tv is 'web-tv', anything else is 'kitchen'. Trap: that last default
// means a browser opening the app with no flags at all claims the kitchen's
// identity and edits its config, so a laptop should always pass ?device=.
function resolveDeviceId() {
  if (typeof window === 'undefined') return 'kitchen'
  const q = new URLSearchParams(window.location.search).get('device')
  if (q) {
    if (!READ_ONLY) {
      try { localStorage.setItem(DEVICE_ID_KEY, q) } catch { /* storage disabled */ }
    }
    return q
  }
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY)
    if (saved) return saved
  } catch { /* storage disabled */ }
  if (IS_ECHO) return 'family-room-echo'
  if (IS_TV) return 'web-tv'
  // A page FrameServer served with no identity at all is a laptop or a phone
  // having a look, not the kitchen. Give it a guest identity of its own rather
  // than the kitchen's: otherwise a casual open of http://nuc.local:8095/ would
  // adopt the kitchen's registry entry and any setting touched there would
  // change the kitchen panel. The kitchen itself is served by its Pi.
  if (SERVED_BY_HUB) return 'web-guest'
  return 'kitchen'
}

// Resolved once at module load, after the kiosk flags exist. Exported for
// lib/houseState.js, which stamps its countdown writes with it. houseState
// imports this module and never the reverse, so there is no import cycle.
export const DEVICE_ID = resolveDeviceId()

const DEVICE_KIND = IS_ECHO ? 'web-echo' : IS_TV ? 'web-tv' : 'web'

// Which existing device a NEW registry entry copies its starting settings from.
// The hub copies slideshow, sonos.room and the display schedule once, and never
// onto an entry that already exists, so this is safe to send on every
// registration. ?seed=<deviceId> names a source for any screen; the Echo
// defaults to the kitchen, so it starts with the family's albums and night
// schedule instead of code defaults. Never seed a device from itself.
function resolveSeedFrom() {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search).get('seed')
  // The Echo and a hub-served guest both start as a copy of the kitchen.
  const seed = q || (IS_ECHO || DEVICE_ID === 'web-guest' ? 'kitchen' : null)
  return seed && seed !== DEVICE_ID ? seed : null
}
const SEED_FROM = resolveSeedFrom()

// --- Sonos base --------------------------------------------------------------
// Every screen reaches node-sonos-http-api through the hub's proxy (GET only).
// Changing the default alone would have moved nobody: a stored value beats a
// default, and the registry still held the kitchen's 'http://localhost:5005'.
// On any screen but the kitchen Pi, "localhost" is the screen itself, and once
// the Pi's service goes that address is dead everywhere. So these stored values
// are stale and get replaced on read, from the cache and from the hub alike:
const HUB_SONOS_BASE = hubUrl('/api/sonos')
const STALE_SONOS_BASES = [
  /^https?:\/\/(localhost|127\.0\.0\.1):5005\/?$/i, // the Pi's own node-sonos-http-api
  /:8080\/api\/sonos\/?$/i,                          // the Pi's proxy (the old TV route)
]

// This page's own host name, and the host of a stored URL ('' if it is not
// one). An IP address is four dotted numbers, or IPv6 (bracketed in a URL).
const PAGE_HOST =
  typeof window !== 'undefined' && window.location ? String(window.location.hostname || '') : ''

function isIpHost(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[[0-9a-f:.]+\]$/i.test(host) || host.indexOf(':') >= 0
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

// Is a stored Sonos base dead on this page? Pure, for the tests; the store
// calls it with this page's facts (isStaleSonosBase below).
export function sonosBaseIsStale(value, { servedByHub, hubSonosBase, pageHost }) {
  if (typeof value !== 'string' || !value.trim()) return true
  const v = value.trim()
  if (STALE_SONOS_BASES.some((re) => re.test(v))) return true
  // The Silk case, and only that. The Echo loads the app from the hub by IP
  // because Silk cannot resolve nuc.local, so on a page FrameServer served
  // from an IP a stored nuc.local /api/sonos is dead and moves to this origin.
  // Nothing else is judged stale: a page opened as http://nuc.local:8095/ (the
  // Mac, the layout editor) holding an Echo's IP-based value must leave it
  // alone, or it would write nuc.local back into the Echo's config and take
  // the Echo's music with it. (The price: if the hub's IP ever changed, an
  // Echo's stored old-IP value would need fixing by hand.)
  return !!(
    servedByHub &&
    /\/api\/sonos\/?$/i.test(v) &&
    v.replace(/\/+$/, '') !== hubSonosBase &&
    /\.local$/.test(hostOf(v)) &&
    isIpHost(String(pageHost || '').toLowerCase())
  )
}

function isStaleSonosBase(value) {
  return sonosBaseIsStale(value, {
    servedByHub: SERVED_BY_HUB,
    hubSonosBase: HUB_SONOS_BASE,
    pageHost: PAGE_HOST,
  })
}

// Returns the SAME object when nothing needed fixing, so callers can tell.
// Only an apiBase that is present is judged; a partial payload without one
// merges over the good value we already hold.
function normalizeSonos(sonos) {
  if (!sonos || typeof sonos !== 'object' || !('apiBase' in sonos)) return sonos
  if (!isStaleSonosBase(sonos.apiBase)) return sonos
  return { ...sonos, apiBase: HUB_SONOS_BASE }
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k]
  return out
}

// --- hub sync ----------------------------------------------------------------
// Writes are optimistic. updateSettings() has already applied the change and
// written the localStorage cache before any of this runs, so a failed PATCH
// costs nothing visible and the next poll reconciles. Failing silently is
// deliberate: a hub outage must never stop someone changing a setting on the
// panel in front of them.

// Settles once the first answer from the hub is in (registration or the first
// poll, success or failure), so a caller can wait for the hub's settings
// rather than act on the cache or the defaults: the layout editor's bridge
// announces the saved layout only then. Resolves at once without a hub.
let settleHub = () => {}
const hubSettled = new Promise((resolve) => {
  settleHub = resolve
})
export function whenHubSettled() {
  return hubSettled
}

let lastLocalWriteAt = 0
let patchTimer = null
let queuedDevice = {}
let queuedShared = {}

// POST, not PATCH, on purpose: the hub treats the two identically on these
// routes, but its CORS preflight only allowed GET/POST until 2026-09-04, so a
// browser-originated PATCH was dropped silently and reverted by the next poll.
// POST works against both the old and the fixed hub, so a screen keeps saving
// settings whichever half is deployed first.
function hubPatch(path, body) {
  if (!HUB || READ_ONLY || typeof fetch === 'undefined') return
  fetch(hubUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => {})
}

// Debounced so dragging a slider does not fire a PATCH per pixel.
function flushPatches() {
  patchTimer = null
  if (Object.keys(queuedDevice).length) {
    hubPatch(`/api/devices/${encodeURIComponent(DEVICE_ID)}/config`, queuedDevice)
    queuedDevice = {}
  }
  if (Object.keys(queuedShared).length) {
    hubPatch('/api/settings/shared', queuedShared)
    queuedShared = {}
  }
}

function syncToHub(next) {
  if (!HUB || READ_ONLY) return
  Object.assign(queuedDevice, pick(next, DEVICE_WRITE_SCOPE))
  Object.assign(queuedShared, pick(next, SHARED_SCOPE))
  lastLocalWriteAt = Date.now()
  if (patchTimer) clearTimeout(patchTimer)
  patchTimer = setTimeout(flushPatches, 400)
}

// One-shot commands from the dashboard (e.g. "turn off screen"). Deliberately
// NOT part of DEVICE_SCOPE: a command is an action, not a setting, so it must
// never merge into the settings store or ride back out on the next PATCH.
//
// Identified by timestamp rather than cleared after running. Clearing would
// race with the dashboard writing a new one, and tracking the last-run ts is
// idempotent for free. The freshness window matters: without it, a page reload
// would replay whatever command was last written and put the screen to sleep
// for no reason.
//
// The last-run ts is persisted, not just held in memory, because of 'reload':
// the fresh page would otherwise meet the same command, still inside its
// freshness window, and reload again - a two-minute reload loop.
const COMMAND_MAX_AGE_MS = 2 * 60 * 1000

function readLastCommandTs() {
  if (typeof localStorage === 'undefined') return 0
  try {
    return Number(localStorage.getItem(LAST_COMMAND_KEY)) || 0
  } catch {
    return 0
  }
}
let lastCommandTs = readLastCommandTs()

function handleHubCommand(cmd) {
  // The editor's preview is not the screen the command was meant for.
  if (READ_ONLY) return
  if (!cmd || typeof cmd !== 'object') return
  const ts = Number(cmd.ts) || 0
  if (!ts || ts === lastCommandTs) return
  if (Date.now() - ts > COMMAND_MAX_AGE_MS) return   // stale; ignore
  lastCommandTs = ts
  try { localStorage.setItem(LAST_COMMAND_KEY, String(ts)) } catch { /* storage disabled */ }
  if (cmd.action === 'sleep') {
    window.dispatchEvent(new CustomEvent('display-sleep-now'))
  } else if (cmd.action === 'wake') {
    window.dispatchEvent(new CustomEvent('display-wake-now'))
  } else if (cmd.action === 'reload') {
    // The dashboard's Reload button: pick up a new bundle, or clear a wedged
    // page on a screen nobody can reach with a keyboard (the Echo).
    window.location.reload()
  } else if (cmd.action === 'view') {
    // The dashboard's Show Photos / Today / Now Playing buttons: a one-time
    // nudge, exactly as if someone had tapped the menu on the screen. The
    // schedule watchers and idle rules carry on afterwards; nothing is pinned.
    // AppShell owns the view state, so it listens for this and switches.
    const VIEWS = ['photos', 'today', 'music', 'settings', 'plex']
    if (VIEWS.includes(cmd.view)) {
      window.dispatchEvent(new CustomEvent('hub-show-view', { detail: { view: cmd.view } }))
    }
  }
}

// Heal a stale Sonos base in the registry once per page load, not per poll: if
// the write-back fails, the next page load tries again.
let sonosHealQueued = false

// Apply a hub payload without echoing it straight back as a PATCH - otherwise
// every poll would rewrite what it just read.
function applyFromHub(payload) {
  if (!payload) return
  handleHubCommand(payload.config?.command)
  const patch = {
    ...pick(payload.shared || {}, SHARED_SCOPE),
    ...pick(payload.config || {}, DEVICE_SCOPE),
  }
  // A stale Sonos base from the registry is corrected BEFORE it merges over
  // our good value, then written back so the registry heals itself (the
  // dashboard, and this screen after a cache wipe, then see the proxy too).
  let healSonos = false
  if (patch.sonos) {
    const fixed = normalizeSonos(patch.sonos)
    if (fixed !== patch.sonos) {
      patch.sonos = fixed
      healSonos = true
    }
  }
  if (!Object.keys(patch).length) return
  const next = deepMerge(currentValue, patch)
  // Almost every poll returns exactly what we already hold. Publishing it
  // anyway still hands every consumer brand-new object and array identities
  // six times a minute, and anything keyed on those identities restarts.
  // That silently broke the slideshow: its advance timer was torn down and
  // rebuilt on each poll, so any photo duration longer than HUB_POLL_MS
  // could never elapse and the photo never changed.
  if (!deepEqual(next, currentValue)) {
    currentValue = next
    writeCache(currentValue)
    listeners.forEach((fn) => fn())
  }
  // Checked even when nothing changed locally: our cached value may already be
  // right while the registry still holds the stale one.
  if (healSonos && !sonosHealQueued && !READ_ONLY) {
    sonosHealQueued = true
    syncToHub({ sonos: currentValue.sonos })   // device scope only
  }
}

// Self-seeding registration. The hub NEVER overwrites a device that already
// exists, so handing it our current merged settings on first contact is what
// carries live values across the migration instead of resetting them to code
// defaults. This screen is running drivingDepart 7:38 against a 7:42 default;
// silently shifting the family's morning timer by four minutes is exactly the
// kind of small wrongness that makes people stop trusting the display.
//
// seedFrom (see resolveSeedFrom) asks the hub to start a NEW entry from another
// device's slideshow, Sonos room and display schedule instead.
async function registerWithHub() {
  if (!HUB || READ_ONLY || typeof fetch === 'undefined') return
  try {
    const res = await fetch(hubUrl('/api/devices/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: DEVICE_ID,
        name: DEVICE_ID,
        kind: DEVICE_KIND,
        config: pick(currentValue, DEVICE_SCOPE),
        shared: pick(currentValue, SHARED_SCOPE),
        ...(SEED_FROM ? { seedFrom: SEED_FROM } : {}),
      }),
      cache: 'no-store',
    })
    if (res.ok) applyFromHub(await res.json())
  } catch {
    // Hub unreachable: keep running on the localStorage cache.
  } finally {
    settleHub()
  }
}

// Poll so a change made from the dashboard reaches this screen. Skipped right
// after a local edit, or a poll in flight during a change would revert it.
// 10s, not 30s. Settings changes could tolerate a slow poll, but a dashboard
// button that takes half a minute to do anything reads as broken. The payload is
// a few hundred bytes on a LAN.
const HUB_POLL_MS = 10 * 1000

// The config poll's query. A screen sends ?screen=WxH, its viewport in CSS
// pixels, which the hub keeps in memory (like lastSeenAt) so the layout editor
// can draw at the screen's real size. The editor's preview sends ?edit=1
// instead: the hub then leaves lastSeenAt alone (an open editor must not make
// a dead screen look alive), and there is no size to report, because that
// frame is sized FROM this number and echoing it back would let a guessed
// size overwrite the real one. A hub that predates both ignores the query.
function pollQuery() {
  if (typeof window === 'undefined') return ''
  if (READ_ONLY) return '?edit=1'
  const w = Math.round(window.innerWidth || 0)
  const h = Math.round(window.innerHeight || 0)
  return w > 0 && h > 0 ? `?screen=${w}x${h}` : ''
}

async function pollHub() {
  if (!HUB || typeof fetch === 'undefined') return
  if (Date.now() - lastLocalWriteAt < 5000) return
  try {
    const res = await fetch(
      hubUrl(`/api/devices/${encodeURIComponent(DEVICE_ID)}/config${pollQuery()}`),
      { cache: 'no-store' }
    )
    if (res.ok) applyFromHub(await res.json())
    // The device was removed: re-seed it. Not from the editor's preview, which
    // must not create a device by looking at it.
    else if (res.status === 404 && !READ_ONLY) registerWithHub()
  } catch {
    // Hub unreachable: keep the cache.
  } finally {
    settleHub()
  }
}

// Flag the on-screen photo's location caption as wrong (long-press). Best-effort
// POST to the hub's flag queue, which stores the assetId + caption for triage by
// flags-review.mjs / flags-apply.mjs. Any screen may flag except the legacy web
// TV surface - the Echo included. Silent on failure.
export function postPhotoFlag(assetId, wrongCaption) {
  if (IS_TV || READ_ONLY) return
  if (typeof fetch === 'undefined') return
  if (!assetId) return
  try {
    fetch(hubUrl('/api/flags'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetId,
        wrongCaption: wrongCaption || '',
        ts: new Date().toISOString(),
      }),
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // best-effort
  }
}

export const DEFAULTS = {
  location: {
    lat: 47.6610608,
    lon: -122.3999576,
    timezone: 'auto',
  },
  school: {
    drivingDepart: { hour: 7, minute: 42 },
    walkingDepart: { hour: 7, minute: 32 },
    autoShowAt: { hour: 6, minute: 0 },
    // After this time on school days the Today view auto-switches back to
    // Photos (and the boot-time view selector also stops choosing Today).
    morningEndsAt: { hour: 8, minute: 0 },
    schoolDays: [1, 2, 3, 4, 5], // 0=Sun, 1=Mon, ..., 6=Sat
    // Lunch menu (MealViewer, fetched via the hub's /api/lunch proxy). schoolSlug
    // is the school name in the MealViewer URL (schools.mealviewer.com/school/<slug>).
    lunch: { enabled: true, schoolSlug: 'Lawton' },
    // Manual no-school dates layered on top of the SPS calendar feed: snow days
    // or Lawton-specific closures the district feed won't have. Array of
    // 'YYYY-MM-DD' strings.
    noSchoolOverrides: [],
    // Per-kid recurring activities surfaced on Today (e.g. Library day so books
    // go in the bag). Each kid: { id, name, activities: [{ id, label, weekdays }] }
    // where weekdays is an array of 0=Sun..6=Sat.
    kids: [],
  },
  timerThresholds: {
    greenAbove: 7,
    yellowAbove: 4,  // 4 min and below is orange
    orangeAbove: 0,
  },
  weatherSlots: [8, 11, 14, 17, 20],
  sonos: {
    // The hub's proxy in front of node-sonos-http-api on the NUC. Stale stored
    // values (the Pi's localhost:5005, its :8080 proxy) are moved here on read;
    // see normalizeSonos().
    apiBase: HUB_SONOS_BASE,
    room: 'Main',
    pollIntervalMs: 1500,
  },
  // Night-mode schedule. Three transitions per day:
  //   dimAt  -> screen drops to eveningBrightness (CSS overlay)
  //   offAt  -> screen fully off (CSS overlay at full opacity)
  //   wakeAt -> back to wakeBrightness
  // Any touch during dim/off wakes; manual wake holds until the next
  // scheduled transition fires.
  //
  // Brightness values are "fraction of native panel brightness." On a Pi with
  // its own panel (HAS_PANEL in lib/hub.js) these drive the REAL backlight over
  // DDC/CI (ddcutil setvcp 10) via the Pi's /api/display/brightness endpoint.
  // The CSS overlay (opacity = 1 - brightness) remains as the fallback when DDC
  // is unavailable or hardwareDim is off, and is the only dimmer on the Echo.
  //
  // The Echo's hardware defaults are off: it has no panel to drive, so the
  // Settings rows should not claim otherwise. Decided per surface HERE, before
  // readStored() runs, so a value the Echo or the dashboard has saved still wins
  // and the kitchen's defaults are untouched.
  display: {
    dimAt: { hour: 21, minute: 0 },  // 9:00 PM
    offAt: { hour: 0, minute: 0 },   // midnight
    wakeAt: { hour: 6, minute: 0 },  // 6:00 AM
    wakeBrightness: 0.9,             // 0..1, daytime brightness
    eveningBrightness: 0.4,          // 0..1, brightness during dim window
    // Drive the panel's real backlight over DDC/CI instead of painting a black
    // overlay over a full-brightness screen. Off = overlay-only (the old
    // behavior), which is the escape hatch if the panel ever misbehaves.
    hardwareDim: !IS_ECHO,
    // Power the panel down over DDC/CI (VCP D6) for 'off', instead of only
    // painting an opaque overlay over a lit screen. Kept SEPARATE from
    // hardwareDim because the risk profiles differ: a failed dim just looks
    // wrong, while a panel left in standby is dark until something wakes it.
    // The server wakes the panel on startup so a reboot always self-heals.
    hardwarePowerOff: !IS_ECHO,
    // What the screen shows in its 'off' window: 'black', or 'clock' - a faint
    // drifting clock on black. The Echo defaults to the clock: Silk keeps the
    // page alive all night anyway (there is no panel to power down), and a
    // living-room screen that tells the time beats a black rectangle.
    nightFace: IS_ECHO ? 'clock' : 'black',
    // Which Today layout this screen shows. 'framed' is the original Today
    // view; the others live in views/TodayLayouts/ and are chosen per screen
    // (DEVICE scope). Preview any of them with ?layout=<id> without saving.
    todayLayout: 'framed',
    // What this screen rests on: 'photos' (the slideshow) or 'today' (its
    // Today layout). Every "go home" path lands here: boot outside the school
    // morning, the morning-end watcher, and the idle returns from Settings and
    // Now Playing (shell/homeView.js). The Echo Show 15 by the front door is
    // the screen that wants 'today' (docs/designs/entry-board.md).
    homeView: 'photos',
    // Entry board only. 'photos' puts the slideshow, darkened, behind the
    // board; 'black' is the plain DAKboard look.
    entryBackdrop: 'photos',
    // Entry board only. Opacity of the black wash over the photos, 0..0.9
    // (clamped by the layout, so a hand-edited 1 cannot black the photo out).
    entryDim: 0.5,
    // Burn-in care: nudge the whole view a pixel or two on an irregular timer.
    // Off by default. The Framed views drift on their own; a static panel grid
    // does not, so the Board layout wants this on.
    pixelShift: false,
    // The Plex player this screen follows: 'off', or a player's
    // machineIdentifier (the hub's /api/plex/players lists them). While that
    // player plays for 10 s the screen shows the Plex view (what is on, the
    // cast); it goes home 30 s after the session ends or after 10 minutes
    // paused (shell/AppShell.jsx PlexFollow, frameserver/lib/plex.mjs).
    plexFollow: 'off',
    // Entry board only. Move the wash with each photo, around entryDim: darker
    // behind a bright one, lighter behind a night one
    // (views/TodayLayouts/lib/backdropLuma.js). false keeps it flat at
    // entryDim, the phase 1 look.
    entryAdaptive: true,
    // Entry board only. Blur the photos behind the board, 0..20 px (clamped by
    // the layout, like entryDim). 0 = sharp.
    entryBlur: 0,
  },
  slideshow: {
    intervalMs: 6000,
    // 'random' | 'date-taken' | 'date-added'
    sortOrder: 'random',
    // 'fill' | 'fit' | 'smart' - how each photo fills the screen.
    // smart picks per-photo: fill when crop loss is mild, fit otherwise.
    displayMode: 'smart',
    smartCropLossThreshold: 0.15,
    // When true, EXIF caption fades out exifVisibleSeconds after each photo
    // change. When false, EXIF caption stays visible for the full photo.
    autoDismissExif: true,
    exifVisibleSeconds: 5,
    // Which Immich albums feed the slideshow. null = use all albums in the
    // manifest. An array of album IDs = filter to just those. Empty array =
    // nothing (slideshow shows a "no albums selected" placeholder).
    selectedAlbumIds: null,
    // When true, use Immich face bounding boxes to shift cover-crop
    // position so faces stay in frame, and allow up to 40% crop-loss
    // (instead of the default 15%) when faces fit safely. When faces
    // don't fit, fall back to Fit with blur backdrop.
    smartFaces: true,
  },
}

// Structural equality for settings blobs (plain objects, arrays, primitives).
// Lets an unchanged hub poll be dropped instead of republished - see
// applyFromHub. Exported for lib/houseState.js, which drops identical polls of
// /api/state for the same reason.
export function deepEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  const aArr = Array.isArray(a)
  if (aArr !== Array.isArray(b)) return false
  if (aArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual(a[k], b[k])) return false
  }
  return true
}

// --- Deep merge that respects nested objects but replaces arrays wholesale.
function deepMerge(base, override) {
  if (override == null || typeof override !== 'object') return base
  if (Array.isArray(override)) return override
  const out = { ...base }
  for (const k of Object.keys(override)) {
    const b = base?.[k]
    const o = override[k]
    if (
      b && o && typeof b === 'object' && typeof o === 'object' &&
      !Array.isArray(b) && !Array.isArray(o)
    ) {
      out[k] = deepMerge(b, o)
    } else {
      out[k] = o
    }
  }
  return out
}

// One-time migrations for stored settings. Each block converts an older
// stored representation into the current one so users who upgrade don't
// keep the old defaults stuck in localStorage.
function migrateLegacy(merged) {
  // dim level fraction (darkness) -> brightness fraction
  const d = merged?.display
  if (d && typeof d.dimLevel === 'number' && d.eveningBrightness === undefined) {
    d.eveningBrightness = Math.max(0, Math.min(1, 1 - d.dimLevel))
  }
  if (d && 'dimLevel' in d) delete d.dimLevel

  // Timer thresholds: yellowAbove was 3 (orange band 1-3, yellow 4-7).
  // Updated default is 4 (orange band 1-4, yellow 5-7). Migrate only if
  // the user is still on the prior default value - leave custom tunings.
  const t = merged?.timerThresholds
  if (t && t.yellowAbove === 3 && t.greenAbove === 7 && t.orangeAbove === 0) {
    t.yellowAbove = 4
  }

  // Sonos: a cached base from before the hub proxy (the Pi's localhost:5005
  // or :8080 proxy, or blank) moves to the hub. Replaced, never mutated, so a
  // merge that shares its sonos object with DEFAULTS cannot touch DEFAULTS.
  if (merged?.sonos) {
    const s = normalizeSonos(merged.sonos)
    if (s !== merged.sonos) merged.sonos = s
  }

  return merged
}

function readStored() {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    let stored = raw ? JSON.parse(raw) : null
    if (stored && localStorage.getItem(STORAGE_DEVICE_KEY) !== DEVICE_ID) {
      stored = pick(stored, SHARED_SCOPE)   // another device's cache: shared keys only
    }
    const merged = stored ? deepMerge(DEFAULTS, stored) : DEFAULTS
    return migrateLegacy(merged)
  } catch {
    return DEFAULTS
  }
}

function writeCache(value) {
  if (READ_ONLY) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    localStorage.setItem(STORAGE_DEVICE_KEY, DEVICE_ID)
  } catch { /* storage full or disabled */ }
}

let currentValue = readStored()
const listeners = new Set()

// Register with the hub and start polling for dashboard-side changes. Both are
// no-ops without a hub URL, which keeps samplePhotos dev mode and the rollback
// path working unchanged. The editor's preview reads instead of registering:
// registration can write (it renames the entry to the id, and creates one that
// is missing), while a GET of the config returns the same payload and cannot.
if (HUB && typeof window !== 'undefined') {
  if (READ_ONLY) pollHub()
  else registerWithHub()
  setInterval(pollHub, HUB_POLL_MS)
} else {
  settleHub()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return currentValue
}

// Replace settings (merged with current). Pass either a partial object or a
// function that receives current and returns the new full settings.
export function updateSettings(updater) {
  const next =
    typeof updater === 'function'
      ? updater(currentValue)
      : deepMerge(currentValue, updater)
  currentValue = next
  writeCache(next)
  syncToHub(next)
  listeners.forEach((fn) => fn())
}

export function resetSettings() {
  currentValue = DEFAULTS
  if (!READ_ONLY) {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // no-op
    }
  }
  listeners.forEach((fn) => fn())
}

export function useSettings() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS)
}

// Synchronous one-shot read for code that runs outside React (boot logic,
// imperative effects). Returns the current merged settings.
export function getSettings() {
  return currentValue
}
