// Sun and moon math for the Today layouts. Pure functions, no React, no IO, so
// they are trivially testable and safe to call from a useMemo.

// A known new moon: 2000-01-06 18:14 UTC. Everything else is counted forward
// from there in synodic months. This is the simple mean-phase model - it drifts
// a few hours against the true phase, which is far below what a drawn glyph or
// a "Waxing gibbous" label can show.
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0)
const SYNODIC_MONTH_DAYS = 29.530588853
const SYNODIC_MONTH_MS = SYNODIC_MONTH_DAYS * 24 * 60 * 60 * 1000

// Date or ms timestamp in, ms or null out. Deliberately strict: Number(null)
// is 0, so a loose coercion would turn a missing sunset into 1970 and hand the
// caller a confident, wrong answer instead of null.
function toMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

// Name for a 0..1 phase. The four exact phases get a narrow window (roughly a
// day and a half each) so "Full moon" means it actually looks full.
export function moonLabel(phase) {
  const p = ((Number(phase) % 1) + 1) % 1
  if (!Number.isFinite(p)) return 'New moon'
  if (p < 0.03 || p >= 0.97) return 'New moon'
  if (p < 0.22) return 'Waxing crescent'
  if (p < 0.28) return 'First quarter'
  if (p < 0.47) return 'Waxing gibbous'
  if (p < 0.53) return 'Full moon'
  if (p < 0.72) return 'Waning gibbous'
  if (p < 0.78) return 'Last quarter'
  return 'Waning crescent'
}

// moonPhase(date) -> { phase, illumination, label }
//   phase        0..1, 0 = new, 0.25 = first quarter, 0.5 = full
//   illumination 0..1, fraction of the disc lit
//   label        'Waxing gibbous' etc.
// Accepts a Date or a ms timestamp. Never throws: bad input reads as new moon.
export function moonPhase(date = new Date()) {
  const ms = toMs(date)
  if (ms == null) return { phase: 0, illumination: 0, label: 'New moon' }
  let phase = ((ms - NEW_MOON_EPOCH_MS) % SYNODIC_MONTH_MS) / SYNODIC_MONTH_MS
  if (phase < 0) phase += 1
  // The terminator sweeps the disc as a cosine, so the lit fraction is 0 at
  // new (phase 0) and 1 at full (phase 0.5).
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2
  return { phase, illumination, label: moonLabel(phase) }
}

// sunProgress(now, sunrise, sunset) -> 0..1, or null.
// Fraction of the daylight window elapsed. null before sunrise, after sunset,
// or when any of the three times is missing - the caller decides how to draw
// "the sun is not up", rather than being handed a clamped 0 or 1 that looks
// like real data.
export function sunProgress(now, sunrise, sunset) {
  const n = toMs(now)
  const rise = toMs(sunrise)
  const set = toMs(sunset)
  if (n == null || rise == null || set == null) return null
  if (set <= rise) return null
  if (n < rise || n > set) return null
  return (n - rise) / (set - rise)
}
