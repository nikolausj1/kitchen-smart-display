import { getSettings } from '../lib/settings.js'

// homeView - the view a screen rests on: display.homeView, 'photos' unless a
// screen's job is its Today board (the Echo Show 15 by the front door runs
// the Entry board all day; docs/designs/entry-board.md).
//
// Every automatic "go home" asks here at the moment it fires: boot outside the
// school morning (AppShell computeInitialView), the morning-end watcher, and
// the idle returns from Settings and Now Playing. Read then, not captured at
// mount, so a change made on the dashboard applies to the very next return.

export function normalizeHomeView(v) {
  return v === 'today' ? 'today' : 'photos'
}

export function getHomeView() {
  return normalizeHomeView(getSettings()?.display?.homeView)
}
