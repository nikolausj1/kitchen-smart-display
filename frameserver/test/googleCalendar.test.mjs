// googleCalendar.test.mjs - the pure parts of the Google Calendar integration.
//
// createGoogleCalendar() itself (auth, HTTP fetch, disk cache, the refresh
// scheduler) is a stateful factory with real network and filesystem side
// effects; it is intentionally NOT exercised here. This file covers the pure
// functions it is built from: the settings reader, the fetch window, the
// per-item normalizers (Google's raw shape and the test/fixture shape), the
// wire mapper, and the small pure helpers used to compose a snapshot.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  calendarSettings,
  fetchWindow,
  normalizeGoogleEvent,
  normalizeFixtureEvent,
  publicEvent,
  sortEvents,
  eventsForDays,
  signJwt,
  readServiceAccount,
} from '../lib/googleCalendar.mjs'

describe('calendarSettings', () => {
  it('defaults to an empty list and the documented defaults', () => {
    assert.deepEqual(calendarSettings(undefined), { calendars: [], countdownLeadDays: 30, countdownMax: 3 })
  })

  it('dedupes by id, fills in a label default and a palette colour, and drops junk entries', () => {
    const out = calendarSettings({
      calendar: {
        calendars: [{ id: 'a@x', label: 'A' }, { id: 'b@x' }, { id: 'a@x', label: 'dup' }, 'junk', { label: 'no id' }],
        countdownLeadDays: 999,
        countdownMax: -5,
      },
    })
    assert.deepEqual(out.calendars, [
      { id: 'a@x', label: 'A', color: '#e0457b' },
      { id: 'b@x', label: 'b@x', color: '#4a90e2' },
    ])
  })

  it('clamps countdownLeadDays to 0..365 and countdownMax to 0..12', () => {
    const out = calendarSettings({ calendar: { calendars: [], countdownLeadDays: 999, countdownMax: -5 } })
    assert.equal(out.countdownLeadDays, 365)
    assert.equal(out.countdownMax, 0)
  })

  it('cycles the fixed colour palette past its length', () => {
    const calendars = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}` }))
    const out = calendarSettings({ calendar: { calendars } })
    assert.equal(out.calendars[0].color, out.calendars[6].color) // palette has 6 entries
  })
})

describe('fetchWindow', () => {
  it('spans local midnight today to local midnight `days` later', () => {
    const now = new Date(2026, 8, 24, 15, 30)
    const w = fetchWindow(now, 60)
    assert.equal(w.timeMin, new Date(2026, 8, 24).toISOString())
    assert.equal(w.timeMax, new Date(2026, 8, 24 + 60).toISOString())
  })

  it('defaults to the 60-day countdown window', () => {
    const now = new Date(2026, 8, 24, 15, 30)
    const w = fetchWindow(now)
    assert.equal(w.timeMax, new Date(2026, 8, 24 + 60).toISOString())
  })
})

describe('normalizeGoogleEvent', () => {
  it('drops cancelled events and Workspace working-location entries', () => {
    assert.equal(normalizeGoogleEvent({ status: 'cancelled' }, 'cal1'), null)
    assert.equal(normalizeGoogleEvent({ eventType: 'workingLocation' }, 'cal1'), null)
  })

  it('all-day: passes start/end date through, exclusive end from Google', () => {
    const e = normalizeGoogleEvent({ id: 'e1', summary: 'Trip', start: { date: '2026-10-01' }, end: { date: '2026-10-03' } }, 'cal1')
    assert.equal(e.allDay, true)
    assert.equal(e.start, null)
    assert.equal(e.startDate, '2026-10-01')
    assert.equal(e.endDate, '2026-10-03')
  })

  it('all-day: a missing/invalid end date defaults to start + 1 day', () => {
    const e = normalizeGoogleEvent({ id: 'e2', summary: 'Single day', start: { date: '2026-10-01' }, end: {} }, 'cal1')
    assert.equal(e.endDate, '2026-10-02')
  })

  it('timed: ISO start/end, startDate is the local date of start', () => {
    const e = normalizeGoogleEvent(
      { id: 'e3', summary: 'Meeting', start: { dateTime: '2026-10-01T09:00:00-07:00' }, end: { dateTime: '2026-10-01T10:00:00-07:00' } },
      'cal1',
    )
    assert.equal(e.allDay, false)
    assert.equal(e.startDate, '2026-10-01')
    assert.equal(e.endDate, '2026-10-02')
  })

  it('timed: an event touching two local days gets an endDate two days out', () => {
    const e = normalizeGoogleEvent(
      { id: 'e4', summary: 'Late', start: { dateTime: '2026-10-01T23:00:00-07:00' }, end: { dateTime: '2026-10-02T01:00:00-07:00' } },
      'cal1',
    )
    assert.equal(e.startDate, '2026-10-01')
    assert.equal(e.endDate, '2026-10-03')
  })

  it('timed: an event ending exactly at local midnight only touches the start day', () => {
    const e = normalizeGoogleEvent(
      { id: 'e5', summary: 'ToMidnight', start: { dateTime: '2026-10-01T22:00:00-07:00' }, end: { dateTime: '2026-10-02T00:00:00-07:00' } },
      'cal1',
    )
    assert.equal(e.startDate, '2026-10-01')
    assert.equal(e.endDate, '2026-10-02')
  })

  it('titles a missing summary "(No title)", or "Busy" when private', () => {
    const pub = normalizeGoogleEvent({ id: 'e6', start: { dateTime: '2026-10-01T09:00:00-07:00' } }, 'cal1')
    assert.equal(pub.title, '(No title)')
    const priv = normalizeGoogleEvent({ id: 'e7', visibility: 'private', start: { dateTime: '2026-10-01T09:00:00-07:00' } }, 'cal1')
    assert.equal(priv.title, 'Busy')
  })

  it('clamps an end before its start to the start', () => {
    const e = normalizeGoogleEvent(
      { id: 'e8', summary: 'Weird', start: { dateTime: '2026-10-01T09:00:00-07:00' }, end: { dateTime: '2026-10-01T08:00:00-07:00' } },
      'cal1',
    )
    assert.equal(e.end, e.start)
  })

  it('carries recurringEventId and iCalUID (as uid) through, assumed already expanded by Google', () => {
    const e = normalizeGoogleEvent(
      { id: 'e10', summary: 'Recur', recurringEventId: 'series1', iCalUID: 'uid1@google.com', start: { dateTime: '2026-10-01T09:00:00-07:00' } },
      'cal1',
    )
    assert.equal(e.recurringEventId, 'series1')
    assert.equal(e.uid, 'uid1@google.com')
  })

  it('malformed input: no start at all, or not a dict, returns null rather than throwing', () => {
    assert.equal(normalizeGoogleEvent({ id: 'e9', summary: 'Bad' }, 'cal1'), null)
    assert.equal(normalizeGoogleEvent(null, 'cal1'), null)
  })
})

describe('normalizeFixtureEvent', () => {
  it('routes a raw Google shape (start/end dicts) through the real normalizer', () => {
    const e = normalizeFixtureEvent({ start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, summary: 'Fixture raw', calendarId: 'cal9' }, 3)
    assert.equal(e.calendarId, 'cal9')
    assert.equal(e.allDay, true)
  })

  it('defaults a raw-shape id to fixture-<index> when missing', () => {
    const e = normalizeFixtureEvent({ start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }, 3)
    assert.equal(e.id, 'fixture-3')
  })

  it('accepts the normalized flat shape and derives endDate for all-day', () => {
    const e = normalizeFixtureEvent({ id: 'f1', allDay: true, startDate: '2026-10-01', title: 'Flat', calendarLabel: 'Lbl', color: '#fff' }, 0)
    assert.equal(e.endDate, '2026-10-02')
    assert.equal(e.calendarLabel, 'Lbl')
    assert.equal(e.color, '#fff')
  })

  it('accepts a flat timed shape and derives startDate/endDate', () => {
    const e = normalizeFixtureEvent({ id: 'f2', title: 'Timed flat', start: new Date(2026, 9, 1, 9, 0).toISOString(), end: new Date(2026, 9, 1, 10, 0).toISOString() }, 1)
    assert.equal(e.startDate, '2026-10-01')
    assert.equal(e.endDate, '2026-10-02')
  })

  it('drops a cancelled flat event', () => {
    assert.equal(normalizeFixtureEvent({ id: 'f3', status: 'cancelled', title: 'X' }, 2), null)
  })

  it('malformed input: an invalid startDate, no date info at all, or a non-dict returns null', () => {
    assert.equal(normalizeFixtureEvent({ id: 'f4', allDay: true, startDate: 'garbage', title: 'Bad' }, 4), null)
    assert.equal(normalizeFixtureEvent({ id: 'f5', title: 'nothing' }, 5), null)
    assert.equal(normalizeFixtureEvent('nope', 0), null)
    assert.equal(normalizeFixtureEvent(null, 0), null)
  })
})

describe('publicEvent', () => {
  it('maps to the documented wire shape with defaults for absent fields', () => {
    const wire = publicEvent({ id: 'x', title: 'T', allDay: true, startDate: '2026-01-01', endDate: '2026-01-02' })
    assert.deepEqual(wire, {
      id: 'x',
      calendarId: null,
      calendarLabel: null,
      color: null,
      title: 'T',
      description: null,
      location: null,
      allDay: true,
      start: null,
      end: null,
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      status: 'confirmed',
    })
  })
})

describe('sortEvents', () => {
  it('sorts by start time and does not mutate the input', () => {
    const list = [
      { title: 'B', allDay: false, start: new Date(2026, 8, 24, 10, 0).toISOString() },
      { title: 'A', allDay: true, startDate: '2026-09-24' },
      { title: 'C', allDay: false, start: new Date(2026, 8, 24, 9, 0).toISOString() },
    ]
    const sorted = sortEvents(list)
    assert.deepEqual(sorted.map((e) => e.title), ['A', 'C', 'B'])
    assert.deepEqual(list.map((e) => e.title), ['B', 'A', 'C'])
  })

  it('breaks a tied start time with all-day first, then title', () => {
    const list = [
      { title: 'Timed-at-midnight', allDay: false, start: new Date(2026, 8, 24, 0, 0, 0, 0).toISOString() },
      { title: 'AllDay', allDay: true, startDate: '2026-09-24' },
    ]
    assert.deepEqual(sortEvents(list).map((e) => e.title), ['AllDay', 'Timed-at-midnight'])
  })
})

describe('eventsForDays', () => {
  const events = [
    { id: 'before', startDate: '2026-09-20', endDate: '2026-09-21' },
    { id: 'straddle-start', startDate: '2026-09-23', endDate: '2026-09-25' },
    { id: 'inside', startDate: '2026-09-24', endDate: '2026-09-25' },
    { id: 'straddle-end', startDate: '2026-09-26', endDate: '2026-09-28' },
    { id: 'after', startDate: '2026-09-27', endDate: '2026-09-28' },
  ]

  it('keeps events overlapping [now, now+days), exclusive at both ends', () => {
    const ids = eventsForDays(events, { now: new Date(2026, 8, 24), days: 3 }).map((e) => e.id)
    assert.deepEqual(ids, ['straddle-start', 'inside', 'straddle-end'])
  })
})

describe('signJwt', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' })

  it('produces a JWT whose RS256 signature verifies against the matching public key', () => {
    const jwt = signJwt({ clientEmail: 'svc@example.iam.gserviceaccount.com', privateKey: pem, now: Date.parse('2026-09-24T12:00:00Z'), lifetimeSec: 3600 })
    const [h, c, s] = jwt.split('.')
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString())
    assert.equal(claims.iss, 'svc@example.iam.gserviceaccount.com')
    assert.equal(claims.exp - claims.iat, 3600)

    const verify = createVerify('RSA-SHA256')
    verify.update(`${h}.${c}`)
    assert.equal(verify.verify(publicKey, Buffer.from(s, 'base64url')), true)
  })

  it('raises a readable error for an unusable private key', () => {
    assert.throws(() => signJwt({ clientEmail: 'x', privateKey: 'not a real key', now: Date.now() }), /cannot sign/)
  })
})

describe('readServiceAccount', () => {
  let dir
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gcal-test-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a well-formed key file', async () => {
    const p = join(dir, 'good.json')
    await writeFile(p, JSON.stringify({ client_email: 'svc@example.com', private_key: 'KEY', private_key_id: 'kid1' }))
    assert.deepEqual(readServiceAccount(p), { clientEmail: 'svc@example.com', privateKey: 'KEY', privateKeyId: 'kid1' })
  })

  it('returns null (not an error) when the file does not exist', async () => {
    assert.equal(readServiceAccount(join(dir, 'missing.json')), null)
  })

  it('throws readably for invalid JSON', async () => {
    const p = join(dir, 'bad.json')
    await writeFile(p, '{not json')
    assert.throws(() => readServiceAccount(p), /not valid JSON/)
  })

  it('throws readably when required fields are missing', async () => {
    const p = join(dir, 'nofields.json')
    await writeFile(p, JSON.stringify({ foo: 'bar' }))
    assert.throws(() => readServiceAccount(p), /no client_email/)
  })

  it('throws readably when the path is a directory', async () => {
    const p = join(dir, 'adir')
    await mkdir(p)
    assert.throws(() => readServiceAccount(p))
  })
})
