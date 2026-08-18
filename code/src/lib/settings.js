import { useSyncExternalStore } from 'react'
import { PHOTOS } from '../config.js'

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
// The SettingsView writes; every hook reads via useSettings().

const STORAGE_KEY = 'kitchenDisplaySettings'
const DEVICE_ID_KEY = 'kitchenDisplayDeviceId'

const HUB = (PHOTOS.baseUrl || '').replace(/\/+$/, '')

// House-wide vs per-screen. Anything not listed here stays local-only.
const SHARED_SCOPE = ['location', 'school', 'timerThresholds', 'weatherSlots']
const DEVICE_SCOPE = ['slideshow', 'display', 'sonos']

// Identity comes from the kiosk URL (?device=living-room), extending the
// existing ?kiosk=tv pattern, and is remembered so a reload without the param
// keeps the same identity. The hub assigns nothing - devices name themselves,
// and the dashboard can re-point an existing config at a new device, so
// reflashing a Pi never loses its settings.
function resolveDeviceId() {
  if (typeof window === 'undefined') return 'kitchen'
  const q = new URLSearchParams(window.location.search).get('device')
  if (q) {
    try { localStorage.setItem(DEVICE_ID_KEY, q) } catch { /* storage disabled */ }
    return q
  }
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY)
    if (saved) return saved
  } catch { /* storage disabled */ }
  return IS_TV ? 'web-tv' : 'kitchen'
}

function pick(obj, keys) {
  const out = {}
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k]
  return out
}

// True when this instance is the secondary web TV surface. Parsed directly
// from the URL (not via kioskMode.js) to avoid an import cycle. It no longer
// implies read-only: every screen owns its own device config. It still gates
// the kitchen-authoritative pushes below (timer, no-school flag).
const IS_TV =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('kiosk') === 'tv'

// Resolved once at module load, after IS_TV exists.
const DEVICE_ID = resolveDeviceId()

// Settings keys mirrored to the Pi shared-state endpoint for secondary
// displays (the TV). The kitchen is the sole writer; the TV reads these.
// Must match SHARED_KEYS in hooks/useSharedState.js.
const SHARED_KEYS = ['location', 'school', 'slideshow']

// Best-effort push of the synced subset to the Pi. No-op on the TV (read-only)
// and silent on failure (the kitchen keeps working offline).
function postSharedState(next) {
  if (IS_TV) return
  if (typeof fetch === 'undefined') return
  const subset = {}
  for (const k of SHARED_KEYS) {
    if (next[k] !== undefined) subset[k] = next[k]
  }
  try {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subset),
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // best-effort
  }
}

// --- hub sync ----------------------------------------------------------------
// Writes are optimistic. updateSettings() has already applied the change and
// written the localStorage cache before any of this runs, so a failed PATCH
// costs nothing visible and the next poll reconciles. Failing silently is
// deliberate: a hub outage must never stop someone changing a setting on the
// panel in front of them.

let lastLocalWriteAt = 0
let patchTimer = null
let queuedDevice = {}
let queuedShared = {}

function hubPatch(path, body) {
  if (!HUB || typeof fetch === 'undefined') return
  fetch(`${HUB}${path}`, {
    method: 'PATCH',
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
  if (!HUB) return
  Object.assign(queuedDevice, pick(next, DEVICE_SCOPE))
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
const COMMAND_MAX_AGE_MS = 2 * 60 * 1000
let lastCommandTs = 0

function handleHubCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return
  const ts = Number(cmd.ts) || 0
  if (!ts || ts === lastCommandTs) return
  if (Date.now() - ts > COMMAND_MAX_AGE_MS) return   // stale; ignore
  lastCommandTs = ts
  if (cmd.action === 'sleep') {
    window.dispatchEvent(new CustomEvent('display-sleep-now'))
  } else if (cmd.action === 'wake') {
    window.dispatchEvent(new CustomEvent('display-wake-now'))
  }
}

// Apply a hub payload without echoing it straight back as a PATCH - otherwise
// every poll would rewrite what it just read.
function applyFromHub(payload) {
  if (!payload) return
  handleHubCommand(payload.config?.command)
  const patch = {
    ...pick(payload.shared || {}, SHARED_SCOPE),
    ...pick(payload.config || {}, DEVICE_SCOPE),
  }
  if (!Object.keys(patch).length) return
  currentValue = deepMerge(currentValue, patch)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentValue))
  } catch { /* storage disabled */ }
  listeners.forEach((fn) => fn())
}

// Self-seeding registration. The hub NEVER overwrites a device that already
// exists, so handing it our current merged settings on first contact is what
// carries live values across the migration instead of resetting them to code
// defaults. This screen is running drivingDepart 7:38 against a 7:42 default;
// silently shifting the family's morning timer by four minutes is exactly the
// kind of small wrongness that makes people stop trusting the display.
async function registerWithHub() {
  if (!HUB || typeof fetch === 'undefined') return
  try {
    const res = await fetch(`${HUB}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: DEVICE_ID,
        name: DEVICE_ID,
        kind: IS_TV ? 'web-tv' : 'web',
        config: pick(currentValue, DEVICE_SCOPE),
        shared: pick(currentValue, SHARED_SCOPE),
      }),
      cache: 'no-store',
    })
    if (res.ok) applyFromHub(await res.json())
  } catch {
    // Hub unreachable: keep running on the localStorage cache.
  }
}

// Poll so a change made from the dashboard reaches this screen. Skipped right
// after a local edit, or a poll in flight during a change would revert it.
// 10s, not 30s. Settings changes could tolerate a slow poll, but a dashboard
// button that takes half a minute to do anything reads as broken. The payload is
// a few hundred bytes on a LAN.
const HUB_POLL_MS = 10 * 1000
async function pollHub() {
  if (!HUB || typeof fetch === 'undefined') return
  if (Date.now() - lastLocalWriteAt < 5000) return
  try {
    const res = await fetch(`${HUB}/api/devices/${encodeURIComponent(DEVICE_ID)}/config`, {
      cache: 'no-store',
    })
    if (res.ok) applyFromHub(await res.json())
    else if (res.status === 404) registerWithHub() // device was removed; re-seed
  } catch {
    // Hub unreachable: keep the cache.
  }
}

// Push the live Today-timer state to the Pi so the Apple TV can mirror the
// kitchen's countdown. Same best-effort + TV-gated semantics as
// postSharedState. `timer` is a small plain object (see TodayView). Posted
// under the `timer` key, which the Pi merges into /api/state alongside the
// settings subset.
export function postTimerState(timer) {
  if (IS_TV) return
  if (typeof fetch === 'undefined') return
  try {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timer }),
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // best-effort
  }
}

// Push the derived "is today a no-school day" flag to the Pi so the Apple TV
// mirrors the kitchen's suppression (its boot picker + Today view read it).
// Derived daily state, not a setting, so it is posted on its own like the timer.
export function postSchoolDayState(noSchoolToday) {
  if (IS_TV) return
  if (typeof fetch === 'undefined') return
  try {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noSchoolToday: !!noSchoolToday }),
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // best-effort
  }
}

// Flag the on-screen photo's location caption as wrong (long-press on the
// kitchen). Best-effort POST to the Pi, which stores the assetId + caption for
// later triage. No-op on the TV (read-only) and silent on failure.
export function postPhotoFlag(assetId, wrongCaption) {
  if (IS_TV) return
  if (typeof fetch === 'undefined') return
  if (!assetId) return
  try {
    fetch('/api/flags', {
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
    // Lunch menu (MealViewer, fetched via the Pi /api/lunch proxy). schoolSlug
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
    apiBase: 'http://localhost:5005',
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
  // Brightness values are "fraction of native panel brightness." These now
  // drive the REAL backlight over DDC/CI (ddcutil setvcp 10) via the Pi's
  // /api/display/brightness endpoint. The CSS overlay (opacity = 1 - brightness)
  // remains as the fallback when DDC is unavailable or hardwareDim is off.
  display: {
    dimAt: { hour: 21, minute: 0 },  // 9:00 PM
    offAt: { hour: 0, minute: 0 },   // midnight
    wakeAt: { hour: 6, minute: 0 },  // 6:00 AM
    wakeBrightness: 0.9,             // 0..1, daytime brightness
    eveningBrightness: 0.4,          // 0..1, brightness during dim window
    // Drive the panel's real backlight over DDC/CI instead of painting a black
    // overlay over a full-brightness screen. Off = overlay-only (the old
    // behavior), which is the escape hatch if the panel ever misbehaves.
    hardwareDim: true,
    // Power the panel down over DDC/CI (VCP D6) for 'off', instead of only
    // painting an opaque overlay over a lit screen. Kept SEPARATE from
    // hardwareDim because the risk profiles differ: a failed dim just looks
    // wrong, while a panel left in standby is dark until something wakes it.
    // The server wakes the panel on startup so a reboot always self-heals.
    hardwarePowerOff: true,
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

  return merged
}

function readStored() {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const merged = raw ? deepMerge(DEFAULTS, JSON.parse(raw)) : DEFAULTS
    return migrateLegacy(merged)
  } catch {
    return DEFAULTS
  }
}

let currentValue = readStored()
const listeners = new Set()

// Push the kitchen's current full settings to the Pi once on boot, so the
// shared state the TV reads always reflects real (merged-with-defaults)
// kitchen values - not just deltas from later changes. Without this, a fresh
// /api/state (or one left with stale data) would only get populated if/when
// the user happens to change a setting. No-op on the TV (read-only).
postSharedState(currentValue)

// Register with the hub and start polling for dashboard-side changes. Both are
// no-ops without a hub URL, which keeps samplePhotos dev mode and the rollback
// path working unchanged.
if (HUB && typeof window !== 'undefined') {
  registerWithHub()
  setInterval(pollHub, HUB_POLL_MS)
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // no-op if storage is full / disabled
  }
  // Dual-write during the transition: the hub is the new source of truth, but
  // the native Apple TV still reads settings from the Pi's /api/state. Drop the
  // postSharedState call once tvOS reads its config from the hub instead.
  postSharedState(next)
  syncToHub(next)
  listeners.forEach((fn) => fn())
}

export function resetSettings() {
  currentValue = DEFAULTS
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
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
