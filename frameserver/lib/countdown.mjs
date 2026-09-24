// countdown.mjs - the ONE morning-countdown derivation, shared by every screen.
//
// Runs in three places from this single file:
//   - FrameServer (server.mjs imports ./lib/countdown.mjs) to publish the
//     derived `timer` in GET /api/state for the Apple TV, plus noSchoolToday
//     and the weather-based travel default.
//   - The React app (code/src/lib/countdown.js re-exports this file) so the
//     kitchen and the Echo derive the same countdown locally at 1 Hz.
//
// The model, decided 2026-09-24: screens share only USER DECISIONS, never the
// derived timer. Decisions are a tiny object in /api/state (last writer wins):
//
//   countdown: {
//     date:            'YYYY-MM-DD'  local date the day-scoped fields belong to
//     dismissed:       bool          the default timer was cancelled today
//     travelMode:      'driving' | 'walking' | null   manual override for today
//                                    (null = follow travelDefault)
//     manualTargetISO: string | null a manual timer's target (self-dating; it
//                                    survives midnight until it expires)
//     updatedAt, by:   bookkeeping
//   }
//
// Every screen then runs deriveCountdown() over the same inputs - decisions,
// the shared school settings, the hub's travelDefault and noSchoolToday - so
// two screens can never disagree about whether a timer is running. Mirrors
// the state machine that lived in code/src/hooks/useTimer.js until 2026-09-24.
//
// Pure ESM, no Node or browser APIs, no imports. Local time throughout: the
// hub runs in the house timezone (verified Pacific on the NUC), and every
// screen is in the house.

export const POST_EXPIRY_LIFETIME_MS = 15 * 60 * 1000

// Local 'YYYY-MM-DD' for a Date (NOT toISOString, which is UTC and can be a day
// off). ISO date strings compare lexicographically == chronologically.
export function dateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Is `date` a no-school day? True if any of:
//   - the weekday is not in school.schoolDays (weekend / non-school weekday)
//   - the date is in school.noSchoolOverrides (manual: snow days, Lawton-only)
//   - the date falls in a "No School ..." range from the SPS calendar feed
//   - the calendar has session bounds and the date is outside them (summer /
//     before the year starts)
// The calendar arg is the /api/schoolcal payload (may be null if unavailable -
// in which case only schoolDays + overrides apply, so we never falsely suppress
// just because the feed failed).
export function isNoSchoolToday(school, calendar, date = new Date()) {
  const key = dateKey(date)

  const schoolDays = school?.schoolDays || []
  if (!schoolDays.includes(date.getDay())) return true

  const overrides = school?.noSchoolOverrides || []
  if (overrides.includes(key)) return true

  if (calendar) {
    const ranges = calendar.noSchoolRanges || []
    if (ranges.some((r) => key >= r.start && key <= r.end)) return true

    const firsts = calendar.firstDays || []
    const lasts = calendar.lastDays || []
    if (firsts.length && lasts.length) {
      const inSession = firsts.some((f, i) => {
        const l = lasts[i]
        return l && key >= f && key <= l
      })
      if (!inSession) return true
    }
  }

  return false
}

// --- Travel default (walk vs drive from the departure-hour forecast) ---------

// Below this temperature (Fahrenheit) we default to driving even if it's dry.
export const COLD_THRESHOLD_F = 35

// WMO weather codes that count as precipitation (drizzle, freezing rain, rain,
// snow, showers, thunderstorm). Fog (45/48) and clear/cloudy (0-3) are NOT precip.
export const PRECIP_CODES = new Set([
  51, 53, 55,             // drizzle
  56, 57, 66, 67,         // freezing rain
  61, 63, 65, 80, 81, 82, // rain / rain showers
  71, 73, 75, 77, 85, 86, // snow / snow showers
  95, 96, 99,             // thunderstorm
])

// Decide travel mode from a single hour's forecast.
//   forecast: { code: Number|null, tempF: Number|null } | null
// Returns 'driving' when there's precipitation OR it's cold (or the forecast is
// unavailable - safe default); otherwise 'walking'.
export function decideTravelMode(forecast, coldThresholdF = COLD_THRESHOLD_F) {
  if (!forecast) return 'driving'
  const { code, tempF } = forecast
  if (code == null) return 'driving'
  const precip = PRECIP_CODES.has(code)
  const cold = tempF != null && tempF < coldThresholdF
  return precip || cold ? 'driving' : 'walking'
}

// --- Decisions ---------------------------------------------------------------

export const EMPTY_DECISIONS = Object.freeze({
  date: null,
  dismissed: false,
  travelMode: null,
  manualTargetISO: null,
  updatedAt: null,
  by: null,
})

function parseISO(iso) {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

// Return a manual target Date only while that timer is still worth showing:
// up to POST_EXPIRY_LIFETIME_MS after it fires, exactly like the old state
// machine's post-expiry revert to no-timer.
function liveManualTarget(decisions, now) {
  const t = parseISO(decisions?.manualTargetISO)
  if (!t) return null
  return now.getTime() - t.getTime() > POST_EXPIRY_LIFETIME_MS ? null : t
}

// Bring a raw decisions object (from the hub, the cache, or a stale poster)
// into today's terms. Day-scoped fields (dismissed, travelMode) are dropped
// when they belong to another date; the manual target is kept while live.
// Always returns a fresh plain object with every key present.
export function normalizeDecisions(raw, now = new Date()) {
  const today = dateKey(now)
  const d = raw && typeof raw === 'object' ? raw : {}
  const sameDay = d.date === today
  const manual = liveManualTarget(d, now)
  return {
    date: sameDay || manual ? (sameDay ? today : d.date || null) : null,
    dismissed: sameDay ? !!d.dismissed : false,
    travelMode:
      sameDay && (d.travelMode === 'driving' || d.travelMode === 'walking')
        ? d.travelMode
        : null,
    manualTargetISO: manual ? manual.toISOString() : null,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
    by: typeof d.by === 'string' ? d.by : null,
  }
}

// --- Derivation --------------------------------------------------------------

// Departure Date for `travelMode` on the same calendar day as baseDate.
export function departureTimeFor(school, travelMode, baseDate) {
  const src = travelMode === 'walking' ? school?.walkingDepart : school?.drivingDepart
  const hour = src?.hour ?? (travelMode === 'walking' ? 7 : 7)
  const minute = src?.minute ?? (travelMode === 'walking' ? 32 : 42)
  const d = new Date(baseDate)
  d.setHours(hour, minute, 0, 0)
  return d
}

export function colourBandForMinutes(minutesLeft, t) {
  const th = t || { greenAbove: 7, yellowAbove: 4, orangeAbove: 0 }
  if (minutesLeft <= th.orangeAbove) return 'red'
  if (minutesLeft <= th.yellowAbove) return 'orange'
  if (minutesLeft <= th.greenAbove) return 'yellow'
  return 'green'
}

// The effective travel mode for today: the user's manual override wins, then
// the hub's weather default (only if it was computed for today), then driving.
export function resolveTravelMode(decisions, travelDefault, now = new Date()) {
  if (decisions?.travelMode === 'driving' || decisions?.travelMode === 'walking') {
    return decisions.travelMode
  }
  const today = dateKey(now)
  if (
    travelDefault &&
    (travelDefault.date == null || travelDefault.date === today) &&
    (travelDefault.mode === 'driving' || travelDefault.mode === 'walking')
  ) {
    return travelDefault.mode
  }
  return 'driving'
}

// deriveCountdown - the whole timer in one pure function.
//
//   now             Date
//   school          shared school settings (drivingDepart, walkingDepart,
//                   autoShowAt, schoolDays, ...)
//   decisions       raw or normalized decisions (normalized again here)
//   travelDefault   { date, mode } | null  (hub-computed; a screen may pass
//                   its own local weather decision as a fallback)
//   noSchoolToday   bool (hub-computed; local fallback allowed)
//   thresholds      timer colour thresholds (optional)
//
// Returns:
//   { mode: 'active' | 'no-timer', kind: 'default' | 'manual' | null,
//     travelMode, target: Date | null, minutesLeft, band, decisions }
//
// Rules (same as the old per-screen state machine, minus the per-screen
// memory that let screens drift apart):
//   1. A live manual timer always wins: active 'manual' until 15 min past its
//      target, regardless of school day. Travel mode still resolves as usual.
//   2. Otherwise the default timer arms on a school day (schoolDays includes
//      the weekday AND not noSchoolToday) from autoShowAt until 15 min past
//      the departure time for the resolved travel mode, unless dismissed today.
//   3. Otherwise no timer.
export function deriveCountdown({
  now = new Date(),
  school,
  decisions,
  travelDefault = null,
  noSchoolToday = false,
  thresholds = null,
} = {}) {
  const d = normalizeDecisions(decisions, now)
  const travelMode = resolveTravelMode(d, travelDefault, now)

  let mode = 'no-timer'
  let kind = null
  let target = null

  const manual = liveManualTarget(d, now)
  if (manual) {
    mode = 'active'
    kind = 'manual'
    target = manual
  } else if (
    !noSchoolToday &&
    !d.dismissed &&
    Array.isArray(school?.schoolDays) &&
    school.schoolDays.includes(now.getDay())
  ) {
    const autoShow = new Date(now)
    autoShow.setHours(school?.autoShowAt?.hour ?? 6, school?.autoShowAt?.minute ?? 0, 0, 0)
    const depart = departureTimeFor(school, travelMode, now)
    const dropoff = depart.getTime() + POST_EXPIRY_LIFETIME_MS
    if (now.getTime() >= autoShow.getTime() && now.getTime() <= dropoff) {
      mode = 'active'
      kind = 'default'
      target = depart
    }
  }

  let minutesLeft = null
  let band = null
  if (mode === 'active' && target) {
    minutesLeft = Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 60_000))
    band = colourBandForMinutes(minutesLeft, thresholds)
  }

  return { mode, kind, travelMode, target, minutesLeft, band, decisions: d }
}

// The wire shape the Apple TV already decodes from /api/state (see
// SharedStatePayload.TimerLenient in tvos/Sources/AppConfig.swift).
export function timerPayload(derived) {
  return {
    active: derived.mode === 'active',
    travelMode: derived.travelMode,
    targetISO: derived.target ? derived.target.toISOString() : null,
    kind: derived.kind,
  }
}

// --- Decision writers ----------------------------------------------------------
// Each returns the NEXT decisions object to POST (and apply optimistically).
// Callers add `by`. All are pure.

function stamped(next, now) {
  return { ...next, date: dateKey(now), updatedAt: now.toISOString() }
}

// Cancel whatever is running: a default timer is dismissed for the day, a
// manual timer is simply cleared. Cancelling with nothing running is a no-op
// that still refreshes the stamp (harmless).
export function withCancel(decisions, derived, now = new Date()) {
  const d = normalizeDecisions(decisions, now)
  if (derived?.mode === 'active' && derived.kind === 'manual') {
    return stamped({ ...d, manualTargetISO: null }, now)
  }
  if (derived?.mode === 'active' && derived.kind === 'default') {
    return stamped({ ...d, dismissed: true }, now)
  }
  return stamped(d, now)
}

// Flip walking <-> driving for the rest of today. Recorded as an explicit
// override so the weather default stops fighting the user's choice.
export function withTravelToggle(decisions, derived, now = new Date()) {
  const d = normalizeDecisions(decisions, now)
  const current = derived?.travelMode || resolveTravelMode(d, null, now)
  return stamped({ ...d, travelMode: current === 'driving' ? 'walking' : 'driving' }, now)
}

// Arm a manual timer. `target` is a Date; a time earlier than now rolls to
// tomorrow, exactly as the old picker did.
export function withManualTarget(decisions, target, now = new Date()) {
  const d = normalizeDecisions(decisions, now)
  const t = new Date(target)
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1)
  return stamped({ ...d, manualTargetISO: t.toISOString() }, now)
}

// Manual timer from the kitchen's 12-hour picker (hour12, minute, 'AM'|'PM').
export function withManualTime(decisions, hour12, minute, ampm, now = new Date()) {
  let hour24 = hour12 % 12
  if (ampm === 'PM') hour24 += 12
  const t = new Date(now)
  t.setHours(hour24, minute, 0, 0)
  return withManualTarget(decisions, t, now)
}
