// houseState.test.mjs - GET/POST /api/state composition (pure; server.mjs
// does the actual IO). See docs/designs/sonos-and-state-to-the-hub.md for the
// shape and the reasoning behind "screens share only the decisions".

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pickSlideshow, composeState, acceptStatePost } from '../lib/houseState.mjs'

const SCHOOL = {
  schoolDays: [1, 2, 3, 4, 5],
  autoShowAt: { hour: 6, minute: 0 },
  walkingDepart: { hour: 7, minute: 32 },
  drivingDepart: { hour: 7, minute: 42 },
}

describe('pickSlideshow', () => {
  it("prefers the 'kitchen' device's slideshow config", () => {
    const registry = { devices: { kitchen: { config: { slideshow: { a: 1 } } } } }
    assert.deepEqual(pickSlideshow(registry), { a: 1 })
  })

  it('falls back to the first plain web device with a slideshow when there is no kitchen', () => {
    const registry = { devices: { echo: { kind: 'web', config: { slideshow: { b: 2 } } } } }
    assert.deepEqual(pickSlideshow(registry), { b: 2 })
  })

  it('ignores a non-web device (e.g. the Apple TV) as a fallback', () => {
    const registry = { devices: { livingRoom: { kind: 'tvos', config: { slideshow: { c: 3 } } } } }
    assert.equal(pickSlideshow(registry), undefined)
  })

  it('malformed input: no devices, or no registry at all, returns undefined', () => {
    assert.equal(pickSlideshow({ devices: {} }), undefined)
    assert.equal(pickSlideshow({}), undefined)
    assert.equal(pickSlideshow(undefined), undefined)
  })
})

describe('composeState', () => {
  const registry = {
    shared: { location: { lat: 1, lon: 2 }, school: SCHOOL },
    devices: { kitchen: { config: { slideshow: { interval: 10 } } } },
  }

  it('composes the documented keys, in the Pi-compatible order, with a derived timer', () => {
    const now = new Date(2026, 8, 24, 7, 0) // Thursday, in the school-morning window
    const out = composeState({ now, registry, stored: { countdown: null }, calendar: null, travelDefault: { date: '2026-09-24', mode: 'walking' } })
    assert.deepEqual(Object.keys(out), ['timer', 'location', 'school', 'slideshow', 'noSchoolToday', 'countdown', 'travelDefault', 'serverTime'])
    assert.equal(out.timer.active, true)
    assert.equal(out.timer.travelMode, 'walking')
    assert.deepEqual(out.location, { lat: 1, lon: 2 })
    assert.equal(out.noSchoolToday, false)
    assert.deepEqual(out.travelDefault, { date: '2026-09-24', mode: 'walking' })
    assert.equal(out.serverTime, now.toISOString())
  })

  it('omits the slideshow key entirely when there is none to publish', () => {
    const now = new Date(2026, 8, 26, 7, 0) // Saturday: also exercises noSchoolToday
    const out = composeState({ now, registry: { shared: {}, devices: {} }, stored: {} })
    assert.ok(!('slideshow' in out))
    assert.equal(out.noSchoolToday, true)
    assert.equal(out.timer.active, false)
    assert.equal(out.travelDefault, null)
  })

  it('normalizes stored decisions to today via countdown.mjs (stale decisions do not leak through)', () => {
    const now = new Date(2026, 8, 24, 7, 0)
    const out = composeState({ now, registry, stored: { countdown: { date: '2020-01-01', dismissed: true } } })
    assert.equal(out.countdown.date, null)
    assert.equal(out.countdown.dismissed, false)
  })
})

describe('acceptStatePost', () => {
  const now = new Date(2026, 8, 24, 7, 0)

  it('accepts only the countdown key, reporting the rest as ignored', () => {
    const out = acceptStatePost({ countdown: { date: '2026-09-24', dismissed: true }, timer: { x: 1 }, location: { y: 2 } }, now)
    assert.deepEqual(out.ignored, ['timer', 'location'])
    assert.equal(out.countdown.dismissed, true)
  })

  it('stamps updatedAt with `now` when the posted countdown omits it', () => {
    const out = acceptStatePost({ countdown: { date: '2026-09-24' } }, now)
    assert.equal(out.countdown.updatedAt, now.toISOString())
  })

  it('keeps an updatedAt the caller already supplied', () => {
    const out = acceptStatePost({ countdown: { date: '2026-09-24', updatedAt: '2020-01-01T00:00:00.000Z' } }, now)
    assert.equal(out.countdown.updatedAt, '2020-01-01T00:00:00.000Z')
  })

  it('a body with no countdown key at all yields countdown: null', () => {
    const out = acceptStatePost({ timer: { x: 1 } }, now)
    assert.equal(out.countdown, null)
    assert.deepEqual(out.ignored, ['timer'])
  })

  it('malformed input: a non-dict countdown value is ignored (null), and not listed as ignored', () => {
    const out = acceptStatePost({ countdown: 'not a dict' }, now)
    assert.equal(out.countdown, null)
    assert.deepEqual(out.ignored, [])
  })

  it('malformed input: an empty body yields no countdown and nothing ignored', () => {
    assert.deepEqual(acceptStatePost({}, now), { countdown: null, ignored: [] })
  })
})
