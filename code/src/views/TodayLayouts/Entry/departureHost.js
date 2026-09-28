import { inSchoolMorning, knobsOf } from '../layoutSpec.js'

// Which box of a spec board borrows the school departure countdown, when the
// layout has no Departure block of its own (Entry/SpecBoard.jsx). Pure, so it
// is tested on its own (departureHost.test.mjs).
//
// Two rules, as the built-in boards had them:
//   - a countdowns box, during the school-morning window on a school day or
//     while a manual timer runs ("leave at 4:40" set on any screen), but only
//     when that box's School departure switch is on (`schoolDeparture`, off by
//     default since 2026-09-28: Justin wants the countdown block to show the
//     calendar countdowns only);
//   - else a now-playing box while a departure countdown actually runs (the
//     Board's rule).
// With several eligible boxes, the first in the spec's list wins, whatever
// the stacking.

// The Entry board's window: the school-morning window on a school day, or a
// manual timer at any hour. Keying on the window rather than on "timer
// active" is what lets ?demo=1 (whose timer always runs) show the tiles
// outside the morning.
export function departureInCountdowns(d) {
  const school = d && d.school
  if (!school || school.noSchool) return false
  if (inSchoolMorning(d.now, school)) return true
  return d.timer?.mode === 'active' && d.timer?.kind === 'manual'
}

// The Board's rule: while a departure countdown actually runs.
export function departureInNowPlaying(d) {
  return d?.timer?.mode === 'active' && !d?.school?.noSchool
}

// panels: the boxes drawn; order: the spec's panel list (view.panels), which
// decides the first of several. Returns a box id or null.
export function departureHost(panels, order, d) {
  const list = Array.isArray(panels) ? panels : []
  if (list.some((p) => p && p.type === 'departure')) return null
  const drawn = new Set(list.map((p) => p && p.id))
  const seq = Array.isArray(order) ? order : []
  const first = (type, allow) => {
    for (let i = 0; i < seq.length; i++) {
      const p = seq[i]
      if (p && p.type === type && drawn.has(p.id) && (!allow || allow(p))) return p.id
    }
    return null
  }
  const countdowns = departureInCountdowns(d) ? first('countdowns', (p) => knobsOf(p).schoolDeparture === true) : null
  if (countdowns) return countdowns
  return departureInNowPlaying(d) ? first('nowplaying') : null
}
