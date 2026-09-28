// moonGeometry.js - the moon's phase as geometry and words. Pure functions,
// no React, no DOM, no clock (every date is handed in), tested from Node
// (moonGeometry.test.mjs). Drawn by MoonGlyph.jsx (the moon on its own, and
// in the night skies of components/WeatherIcon) and by the sun and moon panel
// (views/TodayLayouts/panels/SunMoonPanel.jsx), whose moon this lit path has
// always been.
//
// The phase is the hub's scale (frameserver/lib/weatherKit.mjs,
// frameserver/lib/openMeteoWeather.mjs; GET /api/weather `moon.phase` and
// `daily[].moonPhase`): 0 new, 0.25 first quarter, 0.5 full, 0.75 last
// quarter, 1 new again. WeatherKit names eight phases and the hub turns each
// into the fraction it centres on (0.125 steps); Open-Meteo has none and the
// hub computes it.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80, so no
// Object.hasOwn, Array.prototype.at, structuredClone or String replaceAll.

// What a moon with no phase given is drawn as: a waxing crescent (WeatherKit's
// waxingCrescent, as the hub serves it).
export const DEFAULT_PHASE = 0.125

// A mean synodic month counted from a known new moon, 2000-01-06 18:14 UTC:
// the same model as views/TodayLayouts/lib/sun.js and the hub's Open-Meteo
// path. It drifts up to about half a day from the true phase, far below what
// a drawn moon or its name can show.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0)
const SYNODIC_MONTH_MS = 29.530588853 * 24 * 60 * 60 * 1000

// A phase to draw: a finite number held to 0..1 (below 0 reads as new, above 1
// as new again), or null for anything else. Not wrapped: a phase outside the
// scale is a fault in the data, and the nearest end of the scale is the
// honest reading of it.
export function clampPhase(phase) {
  if (typeof phase !== 'number' || !Number.isFinite(phase)) return null
  if (phase < 0) return 0
  if (phase > 1) return 1
  return phase
}

// The lit part of a moon of radius r centred on (cx, cy), as an SVG path: the
// limb, the outer half circle on the lit side (right while waxing, left while
// waning), then half of the terminator ellipse back to the top. The
// terminator's half width is |cos(2 pi phase)| of the radius: the whole
// radius at new and full, none at the quarters, where the lit part is half
// the disc. It bulges to the lit side for a crescent, to the dark side for a
// gibbous. New moon is an empty shape (the limb and the terminator are one
// arc); full moon the whole disc. null for a phase that is not a number.
//
// The string is formatted exactly as the sun and moon panel has always
// written it (the radius and the centre as given, the terminator's half width
// to three places), so its moon is the same bytes it was.
export function moonLitPath(phase, cx, cy, r) {
  const p = clampPhase(phase)
  if (p == null) return null
  const t = Math.cos(2 * Math.PI * p) // +1 at new, -1 at full
  const waxing = p < 0.5
  const rx = Math.abs(t) * r
  // Where the terminator crosses the horizontal diameter: on the lit side for
  // a crescent, on the dark side for a gibbous.
  const xm = cx + (waxing ? 1 : -1) * t * r
  const limbSweep = waxing ? 1 : 0
  const termSweep = xm > cx ? 0 : 1
  const top = `${cx} ${cy - r}`
  const bottom = `${cx} ${cy + r}`
  return `M${top} A${r} ${r} 0 0 ${limbSweep} ${bottom} A${rx.toFixed(3)} ${r} 0 0 ${termSweep} ${top} Z`
}

// The fraction of the disc that is lit, 0 at new, 1 at full; null for a phase
// that is not a number.
export function litFraction(phase) {
  const p = clampPhase(phase)
  return p == null ? null : (1 - Math.cos(2 * Math.PI * p)) / 2
}

// The phase's name, in the hub's eight equal buckets (openMeteoWeather.mjs
// moonPhaseName), so a drawn moon and the feed's `moon.name` agree: 'Waxing
// gibbous'. Sentence case; null for a phase that is not a number.
const NAMES = [
  [0.0625, 'New moon'],
  [0.1875, 'Waxing crescent'],
  [0.3125, 'First quarter'],
  [0.4375, 'Waxing gibbous'],
  [0.5625, 'Full moon'],
  [0.6875, 'Waning gibbous'],
  [0.8125, 'Last quarter'],
  [0.9375, 'Waning crescent'],
]

export function moonPhaseName(phase) {
  const p = clampPhase(phase)
  if (p == null) return null
  for (let i = 0; i < NAMES.length; i++) {
    if (p < NAMES[i][0]) return NAMES[i][1]
  }
  return 'New moon'
}

// The phase at an instant (a Date or ms epoch), worked out here: the mean
// synodic month from a known new moon. For when no source says (the screens'
// direct Open-Meteo fallback carries no moon). 0..1; null for a bad date.
export function synodicPhase(when) {
  const ms = when instanceof Date ? when.getTime() : when
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  let p = ((ms - NEW_MOON_EPOCH_MS) % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS
  if (p < 0) p += 1
  return p
}
