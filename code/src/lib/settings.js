import { useSyncExternalStore } from 'react'

// Settings store - the single source of truth for runtime-configurable
// values. Reads/writes localStorage so changes survive reloads. The
// SettingsView writes; every hook reads via useSettings().

const STORAGE_KEY = 'kitchenDisplaySettings'

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
    schoolDays: [1, 2, 3, 4, 5], // 0=Sun, 1=Mon, ..., 6=Sat
  },
  timerThresholds: {
    greenAbove: 7,
    yellowAbove: 3,
    orangeAbove: 0,
  },
  weatherSlots: [8, 11, 14, 17, 20],
  sonos: {
    apiBase: 'http://localhost:5005',
    room: 'Main',
    pollIntervalMs: 1500,
  },
  slideshow: {
    intervalMs: 6000,
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

function readStored() {
  if (typeof localStorage === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? deepMerge(DEFAULTS, JSON.parse(raw)) : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

let currentValue = readStored()
const listeners = new Set()

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
