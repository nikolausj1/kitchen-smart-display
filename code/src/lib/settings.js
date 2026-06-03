import { useSyncExternalStore } from 'react'

// Settings store - the single source of truth for runtime-configurable
// values. Reads/writes localStorage so changes survive reloads. The
// SettingsView writes; every hook reads via useSettings().

const STORAGE_KEY = 'kitchenDisplaySettings'

// True when this instance is the read-only Apple TV surface. Parsed directly
// from the URL (not via kioskMode.js) to avoid an import cycle.
const IS_TV =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('kiosk') === 'tv'

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
  // Brightness values are "fraction of native panel brightness." We have no
  // hardware backlight control on this HDMI panel, so brightness is
  // implemented as a CSS overlay (opacity = 1 - brightness). 1.0 means no
  // overlay; 0.1 means heavy overlay.
  display: {
    dimAt: { hour: 21, minute: 0 },  // 9:00 PM
    offAt: { hour: 0, minute: 0 },   // midnight
    wakeAt: { hour: 6, minute: 0 },  // 6:00 AM
    wakeBrightness: 0.9,             // 0..1, daytime brightness
    eveningBrightness: 0.4,          // 0..1, brightness during dim window
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
  postSharedState(next)
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
