// countdown.test.mjs - the shared morning-countdown derivation.
//
// docs/designs/sonos-and-state-to-the-hub.md describes the shared-decisions
// model this implements. Every `now` below is a local-time Date built with
// the multi-arg constructor (new Date(y, m, d, h, min)), never a UTC string,
// so these pass in any time zone.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateKey,
  isNoSchoolToday,
  decideTravelMode,
  EMPTY_DECISIONS,
  normalizeDecisions,
  departureTimeFor,
  colourBandForMinutes,
  resolveTravelMode,
  deriveCountdown,
  timerPayload,
  withCancel,
  withTravelToggle,
  withManualTarget,
  withManualTime,
  POST_EXPIRY_LIFETIME_MS,
} from '../lib/countdown.mjs'

// A full school settings block, reused across tests.
const SCHOOL = {
  schoolDays: [1, 2, 3, 4, 5],
  autoShowAt: { hour: 6, minute: 0 },
  walkingDepart: { hour: 7, minute: 32 },
  drivingDepart: { hour: 7, minute: 42 },
}

describe('dateKey', () => {
  it('formats local Y-M-D, zero-padded', () => {
    assert.equal(dateKey(new Date(2026, 8, 24, 7, 30)), '2026-09-24')
  })

  it('pads single-digit months and days', () => {
    assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
  })

  it('uses the local date regardless of the time of day', () => {
    assert.equal(dateKey(new Date(2026, 8, 24, 0, 0, 0)), '2026-09-24')
    assert.equal(dateKey(new Date(2026, 8, 24, 23, 59, 59)), '2026-09-24')
  })
})

describe('isNoSchoolToday', () => {
  const school = { schoolDays: [1, 2, 3, 4, 5] } // Mon-Fri

  it('is false on a plain school weekday with no calendar', () => {
    // Thursday
    assert.equal(isNoSchoolToday(school, null, new Date(2026, 8, 24)), false)
  })

  it('is true on a weekend (weekday not in schoolDays)', () => {
    // Saturday
    assert.equal(isNoSchoolToday(school, null, new Date(2026, 8, 26)), true)
  })

  it('is true on a manual noSchoolOverrides date', () => {
    const s = { ...school, noSchoolOverrides: ['2026-09-24'] }
    assert.equal(isNoSchoolToday(s, null, new Date(2026, 8, 24)), true)
  })

  it('is true inside a calendar no-school range', () => {
    const cal = { noSchoolRanges: [{ start: '2026-12-20', end: '2027-01-03' }] }
    assert.equal(isNoSchoolToday(school, cal, new Date(2026, 11, 25)), true)
  })

  it('is false inside session when firstDays/lastDays bound it', () => {
    const cal = { noSchoolRanges: [], firstDays: ['2026-09-01'], lastDays: ['2027-06-15'] }
    assert.equal(isNoSchoolToday(school, cal, new Date(2026, 8, 24)), false)
  })

  it('is true before the first day of the school year (summer)', () => {
    const cal = { noSchoolRanges: [], firstDays: ['2026-09-01'], lastDays: ['2027-06-15'] }
    assert.equal(isNoSchoolToday(school, cal, new Date(2026, 7, 15)), true)
  })

  it('is true after the last day of the school year', () => {
    const cal = { noSchoolRanges: [], firstDays: ['2026-09-01'], lastDays: ['2027-06-15'] }
    assert.equal(isNoSchoolToday(school, cal, new Date(2027, 6, 1)), true)
  })

  it('ignores calendar ranges when the calendar is null (feed unavailable)', () => {
    // Would be a no-school range if a calendar were supplied; without one,
    // only schoolDays + overrides apply, so a Thursday stays a school day.
    assert.equal(isNoSchoolToday(school, null, new Date(2026, 8, 24)), false)
  })

  it('malformed input: missing school settings defaults to no-school (empty schoolDays)', () => {
    assert.equal(isNoSchoolToday(undefined, null, new Date(2026, 8, 24)), true)
    assert.equal(isNoSchoolToday({}, null, new Date(2026, 8, 24)), true)
  })
})

describe('decideTravelMode', () => {
  it('defaults to driving when there is no forecast', () => {
    assert.equal(decideTravelMode(null), 'driving')
  })

  it('defaults to driving when the forecast has no code', () => {
    assert.equal(decideTravelMode({ code: null, tempF: 60 }), 'driving')
  })

  it('drives on a precipitation code even when warm', () => {
    assert.equal(decideTravelMode({ code: 61, tempF: 60 }), 'driving') // rain
  })

  it('drives when cold, even with a clear code', () => {
    assert.equal(decideTravelMode({ code: 0, tempF: 30 }), 'driving')
  })

  it('walks when dry and warm', () => {
    assert.equal(decideTravelMode({ code: 0, tempF: 60 }), 'walking')
  })

  it('does not treat fog as precipitation', () => {
    assert.equal(decideTravelMode({ code: 45, tempF: 60 }), 'walking')
  })

  it('honours a custom cold threshold', () => {
    assert.equal(decideTravelMode({ code: 0, tempF: 40 }, 45), 'driving')
    assert.equal(decideTravelMode({ code: 0, tempF: 50 }, 45), 'walking')
  })
})

describe('normalizeDecisions', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('returns EMPTY_DECISIONS-shaped output for undefined/null', () => {
    assert.deepEqual(normalizeDecisions(undefined, now), EMPTY_DECISIONS)
    assert.deepEqual(normalizeDecisions(null, now), EMPTY_DECISIONS)
  })

  it('malformed input: a string, a number or an array normalize like an empty object', () => {
    assert.deepEqual(normalizeDecisions('garbage', now), EMPTY_DECISIONS)
    assert.deepEqual(normalizeDecisions(42, now), EMPTY_DECISIONS)
    assert.deepEqual(normalizeDecisions([], now), EMPTY_DECISIONS)
  })

  it('keeps day-scoped fields when the stored date is today', () => {
    const raw = { date: '2026-09-24', dismissed: true, travelMode: 'walking', updatedAt: 'x', by: 'kitchen' }
    assert.deepEqual(normalizeDecisions(raw, now), {
      date: '2026-09-24',
      dismissed: true,
      travelMode: 'walking',
      manualTargetISO: null,
      updatedAt: 'x',
      by: 'kitchen',
    })
  })

  it('drops dismissed/travelMode when the stored date is stale', () => {
    const raw = { date: '2026-09-23', dismissed: true, travelMode: 'walking', updatedAt: 'y', by: 'echo' }
    const out = normalizeDecisions(raw, now)
    assert.equal(out.date, null)
    assert.equal(out.dismissed, false)
    assert.equal(out.travelMode, null)
  })

  it('rejects a travelMode that is not "driving" or "walking"', () => {
    const out = normalizeDecisions({ date: '2026-09-24', travelMode: 'fly' }, now)
    assert.equal(out.travelMode, null)
  })

  it('keeps updatedAt/by even when the date is stale (bookkeeping, not day-scoped)', () => {
    const raw = { date: '2026-09-23', updatedAt: 'y', by: 'echo' }
    const out = normalizeDecisions(raw, now)
    assert.equal(out.updatedAt, 'y')
    assert.equal(out.by, 'echo')
  })

  it('keeps a live manual target across midnight, carrying the stale date along', () => {
    const target = new Date(2026, 8, 24, 6, 55) // 5 min ago
    const raw = { date: '2026-09-23', dismissed: true, travelMode: 'driving', manualTargetISO: target.toISOString() }
    const out = normalizeDecisions(raw, now)
    assert.equal(out.manualTargetISO, target.toISOString())
    // sameDay is false, but a live manual target still counts as "date present"
    assert.equal(out.date, '2026-09-23')
    // dismissed/travelMode are still day-scoped and still drop
    assert.equal(out.dismissed, false)
    assert.equal(out.travelMode, null)
  })

  it('drops a manual target more than 15 minutes past its time', () => {
    const target = new Date(2026, 8, 24, 6, 44) // 16 min before `now`
    const raw = { date: '2026-09-24', manualTargetISO: target.toISOString() }
    const out = normalizeDecisions(raw, now)
    assert.equal(out.manualTargetISO, null)
  })

  it('keeps a manual target exactly at the expiry boundary', () => {
    const target = new Date(now.getTime() - POST_EXPIRY_LIFETIME_MS)
    const raw = { date: '2026-09-24', manualTargetISO: target.toISOString() }
    const out = normalizeDecisions(raw, now)
    assert.equal(out.manualTargetISO, target.toISOString())
  })

  it('treats an unparseable manualTargetISO as no manual timer', () => {
    const out = normalizeDecisions({ date: '2026-09-24', manualTargetISO: 'not-a-date' }, now)
    assert.equal(out.manualTargetISO, null)
  })
})

describe('departureTimeFor', () => {
  const base = new Date(2026, 8, 24, 3, 3) // any time; only the date part matters

  it('uses the school walking departure time', () => {
    const d = departureTimeFor(SCHOOL, 'walking', base)
    assert.equal(d.getHours(), 7)
    assert.equal(d.getMinutes(), 32)
    assert.equal(dateKey(d), '2026-09-24')
  })

  it('uses the school driving departure time', () => {
    const d = departureTimeFor(SCHOOL, 'driving', base)
    assert.equal(d.getHours(), 7)
    assert.equal(d.getMinutes(), 42)
  })

  it('falls back to 7:32/7:42 when school settings are missing', () => {
    assert.equal(departureTimeFor({}, 'walking', base).getMinutes(), 32)
    assert.equal(departureTimeFor({}, 'driving', base).getMinutes(), 42)
    assert.equal(departureTimeFor(undefined, 'driving', base).getHours(), 7)
  })

  it('malformed input: an unrecognized travel mode falls to the driving default', () => {
    const d = departureTimeFor({}, 'teleport', base)
    assert.equal(d.getHours(), 7)
    assert.equal(d.getMinutes(), 42)
  })
})

describe('colourBandForMinutes', () => {
  it('follows the default thresholds (green>7, yellow 5-7, orange 1-4, red<=0)', () => {
    assert.equal(colourBandForMinutes(-1), 'red')
    assert.equal(colourBandForMinutes(0), 'red')
    assert.equal(colourBandForMinutes(1), 'orange')
    assert.equal(colourBandForMinutes(4), 'orange')
    assert.equal(colourBandForMinutes(5), 'yellow')
    assert.equal(colourBandForMinutes(7), 'yellow')
    assert.equal(colourBandForMinutes(8), 'green')
    assert.equal(colourBandForMinutes(20), 'green')
  })

  it('honours custom thresholds', () => {
    assert.equal(colourBandForMinutes(10, { greenAbove: 20, yellowAbove: 15, orangeAbove: 5 }), 'orange')
  })
})

describe('resolveTravelMode', () => {
  const now = new Date(2026, 8, 24)

  it("the user's manual override wins over the weather default", () => {
    assert.equal(resolveTravelMode({ travelMode: 'walking' }, { date: '2026-09-24', mode: 'driving' }, now), 'walking')
  })

  it("falls back to today's weather default", () => {
    assert.equal(resolveTravelMode({}, { date: '2026-09-24', mode: 'walking' }, now), 'walking')
  })

  it('ignores a stale (not-today) weather default', () => {
    assert.equal(resolveTravelMode({}, { date: '2026-09-23', mode: 'walking' }, now), 'driving')
  })

  it('accepts a weather default with no date as always valid', () => {
    assert.equal(resolveTravelMode({}, { date: null, mode: 'walking' }, now), 'walking')
  })

  it('defaults to driving with no override and no weather default', () => {
    assert.equal(resolveTravelMode({}, null, now), 'driving')
  })
})

describe('deriveCountdown', () => {
  it('is active/default within the school-morning window', () => {
    const now = new Date(2026, 8, 24, 7, 0) // Thursday, after 6am autoShow, before 7:42 drive
    const d = deriveCountdown({ now, school: SCHOOL, decisions: null, travelDefault: { date: '2026-09-24', mode: 'walking' }, noSchoolToday: false })
    assert.equal(d.mode, 'active')
    assert.equal(d.kind, 'default')
    assert.equal(d.travelMode, 'walking')
    assert.equal(d.target.getHours(), 7)
    assert.equal(d.target.getMinutes(), 32)
    assert.equal(d.minutesLeft, 32)
    assert.equal(d.band, 'green')
  })

  it('has no timer before autoShowAt', () => {
    const now = new Date(2026, 8, 24, 5, 59)
    const d = deriveCountdown({ now, school: SCHOOL, decisions: null })
    assert.equal(d.mode, 'no-timer')
    assert.equal(d.kind, null)
    assert.equal(d.target, null)
    assert.equal(d.minutesLeft, null)
    assert.equal(d.band, null)
  })

  it('has no timer after the post-expiry dropoff', () => {
    // driving departs 7:42; +15 min dropoff is 7:57
    const now = new Date(2026, 8, 24, 7, 58)
    const d = deriveCountdown({ now, school: SCHOOL, decisions: null })
    assert.equal(d.mode, 'no-timer')
  })

  it('has no timer on a no-school day even during the window', () => {
    const now = new Date(2026, 8, 24, 7, 0)
    const d = deriveCountdown({ now, school: SCHOOL, decisions: null, noSchoolToday: true })
    assert.equal(d.mode, 'no-timer')
  })

  it('has no timer once dismissed for the day', () => {
    const now = new Date(2026, 8, 24, 7, 0)
    const d = deriveCountdown({ now, school: SCHOOL, decisions: { date: '2026-09-24', dismissed: true } })
    assert.equal(d.mode, 'no-timer')
  })

  it('a live manual timer wins over dismissed AND a no-school day', () => {
    const now = new Date(2026, 8, 24, 7, 0)
    const manualISO = new Date(2026, 8, 24, 8, 0).toISOString()
    const d = deriveCountdown({
      now,
      school: SCHOOL,
      decisions: { date: '2026-09-24', dismissed: true, manualTargetISO: manualISO },
      noSchoolToday: true,
    })
    assert.equal(d.mode, 'active')
    assert.equal(d.kind, 'manual')
    assert.equal(d.target.toISOString(), manualISO)
    assert.equal(d.minutesLeft, 60)
  })

  it('malformed input: missing school settings never throws and yields no-timer', () => {
    const now = new Date(2026, 8, 24, 7, 0)
    const d = deriveCountdown({ now, school: undefined, decisions: null })
    assert.equal(d.mode, 'no-timer')
    assert.equal(d.travelMode, 'driving')
  })

  it('malformed input: an empty call uses "now" and still returns a well-shaped result', () => {
    const d = deriveCountdown()
    assert.ok(d.mode === 'active' || d.mode === 'no-timer')
    assert.ok('travelMode' in d && 'decisions' in d)
  })
})

describe('timerPayload', () => {
  it('shapes an active timer for the wire (Apple TV SharedStatePayload.TimerLenient)', () => {
    const target = new Date(2026, 8, 24, 7, 32)
    const payload = timerPayload({ mode: 'active', kind: 'default', travelMode: 'walking', target })
    assert.deepEqual(payload, { active: true, travelMode: 'walking', targetISO: target.toISOString(), kind: 'default' })
  })

  it('shapes a no-timer result with a null target', () => {
    const payload = timerPayload({ mode: 'no-timer', kind: null, travelMode: 'driving', target: null })
    assert.deepEqual(payload, { active: false, travelMode: 'driving', targetISO: null, kind: null })
  })
})

describe('withCancel', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('clears a live manual timer', () => {
    const decisions = { date: '2026-09-24', manualTargetISO: new Date(2026, 8, 24, 8, 0).toISOString() }
    const out = withCancel(decisions, { mode: 'active', kind: 'manual' }, now)
    assert.equal(out.manualTargetISO, null)
    assert.equal(out.updatedAt, now.toISOString())
  })

  it('dismisses a running default timer for the day', () => {
    const out = withCancel({ date: '2026-09-24' }, { mode: 'active', kind: 'default' }, now)
    assert.equal(out.dismissed, true)
  })

  it('is a harmless no-op (still stamped) when nothing is running', () => {
    const out = withCancel(null, { mode: 'no-timer', kind: null }, now)
    assert.equal(out.dismissed, false)
    assert.equal(out.manualTargetISO, null)
    assert.equal(out.date, '2026-09-24')
  })

  it('malformed input: a null derived value is treated as nothing running', () => {
    const out = withCancel({ date: '2026-09-24' }, null, now)
    assert.equal(out.dismissed, false)
  })
})

describe('withTravelToggle', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('flips driving to walking', () => {
    const out = withTravelToggle({ date: '2026-09-24' }, { mode: 'active', kind: 'default', travelMode: 'driving' }, now)
    assert.equal(out.travelMode, 'walking')
  })

  it('flips walking to driving', () => {
    const out = withTravelToggle({ date: '2026-09-24' }, { mode: 'active', kind: 'default', travelMode: 'walking' }, now)
    assert.equal(out.travelMode, 'driving')
  })

  it('malformed input: with no derived timer, resolves the current mode itself before flipping', () => {
    // resolveTravelMode({}, null, now) -> 'driving', so the toggle lands on 'walking'
    const out = withTravelToggle({}, null, now)
    assert.equal(out.travelMode, 'walking')
  })
})

describe('withManualTarget', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('arms a future time today as-is', () => {
    const target = new Date(2026, 8, 24, 9, 0)
    const out = withManualTarget({}, target, now)
    assert.equal(out.manualTargetISO, target.toISOString())
  })

  it('rolls a time earlier than now to tomorrow', () => {
    const target = new Date(2026, 8, 24, 6, 0) // an hour before `now`
    const out = withManualTarget({}, target, now)
    const got = new Date(out.manualTargetISO)
    assert.equal(dateKey(got), '2026-09-25')
    assert.equal(got.getHours(), 6)
  })
})

describe('withManualTime', () => {
  const now = new Date(2026, 8, 24, 6, 0)

  it('12-hour AM/PM converts to 24-hour correctly', () => {
    const cases = [
      [7, 45, 'AM', 7, 45],
      [12, 0, 'AM', 0, 0], // midnight
      [12, 0, 'PM', 12, 0], // noon
      [3, 15, 'PM', 15, 15],
    ]
    for (const [hour12, minute, ampm, hour24, min24] of cases) {
      const out = withManualTime({}, hour12, minute, ampm, now)
      const got = new Date(out.manualTargetISO)
      // Midnight (0,0) is earlier than `now` (6:00) so it rolls to tomorrow.
      const expectDate = hour24 === 0 && min24 === 0 ? '2026-09-25' : '2026-09-24'
      assert.equal(dateKey(got), expectDate, `date for ${hour12}:${minute} ${ampm}`)
      assert.equal(got.getHours(), hour24, `hour for ${hour12}:${minute} ${ampm}`)
      assert.equal(got.getMinutes(), min24, `minute for ${hour12}:${minute} ${ampm}`)
    }
  })
})
