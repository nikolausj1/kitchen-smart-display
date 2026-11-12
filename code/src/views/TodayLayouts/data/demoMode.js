import { useSyncExternalStore } from 'react'
import { RECORD } from '../../../lib/recordMode.js'

// demoMode - whether the Today layouts show the demo fixtures (data/demo.js).
//
// ?demo=1 seeds it at load, as before. The layout editor flips it at runtime
// (sd-edit:sample, editBridge.js) so an empty screen has something to lay out,
// which is why this is a store rather than a flag parsed once.
//
// `since` is when demo mode last turned on. useTodayData anchors the fixtures
// that depend on the clock to it (the countdown target, the "fetched" time,
// the calendar's days), so they are frozen from that moment instead of sliding
// with every tick, and a render never has to read the clock to build them.

function readInitial() {
  if (typeof window === 'undefined') return { on: false, since: null }
  // ?record=1 (lib/recordMode.js) is demo mode plus a fixture clock and no network.
  const on = RECORD || new URLSearchParams(window.location.search).get('demo') === '1'
  return { on, since: on ? Date.now() : null }
}

let state = readInitial()
const listeners = new Set()

const SERVER_SNAPSHOT = { on: false, since: null }

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return state
}

export function getDemoMode() {
  return state
}

export function setDemoMode(on) {
  const next = !!on
  if (next === state.on) return
  state = { on: next, since: next ? Date.now() : state.since }
  listeners.forEach((fn) => fn())
}

// { on, since }. The object only changes when demo mode does.
export function useDemoMode() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}
