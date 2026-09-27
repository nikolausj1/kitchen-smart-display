// googleCalendar.test.mjs - the pure parts of the Google Calendar integration.
//
// Mostly the pure functions createGoogleCalendar() is built from: the
// settings reader, the fetch window and the route's query and range, the
// per-item normalizers (Google's raw shape and the test/fixture shape), the
// wire mapper, and the small pure helpers used to compose a snapshot. At the
// end, one pass of the factory itself against a local mock of Google (its
// `endpoints` option): the window it asks for, the cache it writes and reads
// back, and the snapshot's dedupe across calendars.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PAST_DAYS,
  WINDOW_DAYS,
  calendarQuery,
  calendarRange,
  calendarSettings,
  createGoogleCalendar,
  dedupe,
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
  it('spans local midnight `past` days back to local midnight `days` later', () => {
    const now = new Date(2026, 8, 24, 15, 30)
    const w = fetchWindow(now, 60, 0)
    assert.equal(w.timeMin, new Date(2026, 8, 24).toISOString())
    assert.equal(w.timeMax, new Date(2026, 8, 24 + 60).toISOString())
    const back = fetchWindow(now, 10, 5)
    assert.equal(back.timeMin, new Date(2026, 8, 19).toISOString())
    assert.equal(back.timeMax, new Date(2026, 9, 4).toISOString())
  })

  it('defaults to one window: 31 days back (the month grid) to 60 ahead (the countdowns)', () => {
    assert.equal(WINDOW_DAYS, 60)
    assert.equal(PAST_DAYS, 31)
    const now = new Date(2026, 8, 24, 15, 30)
    const w = fetchWindow(now)
    assert.equal(w.timeMin, new Date(2026, 7, 24).toISOString()) // Aug 24, 31 days before Sep 24
    assert.equal(w.timeMax, new Date(2026, 8, 24 + 60).toISOString())
  })

  it('counts calendar days, not 24-hour steps, across a DST change', () => {
    // US DST ends Sun 2026-11-01: still local midnights on both sides.
    const w = fetchWindow(new Date(2026, 10, 20, 9), 3, 31)
    const min = new Date(w.timeMin)
    assert.equal(min.getHours(), 0)
    assert.equal(min.getDate(), 20)
    assert.equal(min.getMonth(), 9)
  })
})

describe('calendarQuery', () => {
  it('reads days 1..60 (default 3) and past 0..31 (default 0) from the query strings', () => {
    assert.deepEqual(calendarQuery({}), { days: 3, past: 0 })
    assert.deepEqual(calendarQuery({ days: '6', past: null }), { days: 6, past: 0 })
    assert.deepEqual(calendarQuery({ days: '42', past: '31' }), { days: 42, past: 31 })
    assert.deepEqual(calendarQuery({ days: '14' }), { days: 14, past: 0 }) // the old cap no longer applies
  })

  it('clamps out-of-range values and ignores junk', () => {
    assert.deepEqual(calendarQuery({ days: '0', past: '-4' }), { days: 1, past: 0 })
    assert.deepEqual(calendarQuery({ days: '400', past: '90' }), { days: 60, past: 31 })
    assert.deepEqual(calendarQuery({ days: 'lots', past: '' }), { days: 3, past: 0 })
    assert.deepEqual(calendarQuery({ days: '7.9', past: '2x' }), { days: 7, past: 2 })
  })
})

describe('calendarRange', () => {
  it('names the local dates a query covers, to exclusive', () => {
    const now = new Date(2026, 8, 26, 23, 59)
    assert.deepEqual(calendarRange(now, { days: 6, past: 0 }), { from: '2026-09-26', to: '2026-10-02' })
    assert.deepEqual(calendarRange(now, { days: 42, past: 31 }), { from: '2026-08-26', to: '2026-11-07' })
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
      alsoOn: [],
    })
  })

  it('passes alsoOn through and drops internal bookkeeping', () => {
    const also = [{ calendarId: 'b@x', calendarLabel: 'B', color: '#4a90e2' }]
    const wire = publicEvent({ id: 'x', title: 'T', allDay: true, startDate: '2026-01-01', endDate: '2026-01-02', uid: 'u', recurringEventId: 'r', alsoOn: also })
    assert.deepEqual(wire.alsoOn, also)
    assert.equal('uid' in wire, false)
    assert.equal('recurringEventId' in wire, false)
  })
})

describe('dedupe', () => {
  const at9 = new Date(2026, 8, 24, 9).toISOString()
  const ev = (calendarId, extra = {}) => ({
    id: `${calendarId}-e`, uid: 'inv@google.com', calendarId, calendarLabel: calendarId.toUpperCase(), color: `#${calendarId}${calendarId}${calendarId}`,
    title: 'Dinner', allDay: false, start: at9, startDate: '2026-09-24', endDate: '2026-09-25', ...extra,
  })

  it('keeps the first copy of an invitation and notes the other calendars on it, in order', () => {
    const list = [ev('a'), ev('b'), ev('c')]
    const out = dedupe(list)
    assert.equal(out.length, 1)
    assert.equal(out[0].calendarId, 'a')
    assert.deepEqual(out[0].alsoOn, [
      { calendarId: 'b', calendarLabel: 'B', color: '#bbb' },
      { calendarId: 'c', calendarLabel: 'C', color: '#ccc' },
    ])
    // The cached copies are not touched.
    assert.equal(list[0].alsoOn, undefined)
  })

  it('does not note a repeat from the same calendar, and keeps different starts apart', () => {
    const out = dedupe([ev('a'), ev('a', { id: 'again' }), ev('b', { start: new Date(2026, 8, 25, 9).toISOString() })])
    assert.equal(out.length, 2)
    assert.equal(out[0].alsoOn, undefined)
  })

  it('keeps events without any id', () => {
    assert.equal(dedupe([{ title: 'x' }, { title: 'x' }]).length, 2)
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

  it('reaches `past` days back as well', () => {
    const ids = eventsForDays(events, { now: new Date(2026, 8, 24, 18), days: 1, past: 4 }).map((e) => e.id)
    assert.deepEqual(ids, ['before', 'straddle-start', 'inside'])
    const none = eventsForDays(events, { now: new Date(2026, 8, 24), days: 1, past: 3 }).map((e) => e.id)
    assert.deepEqual(none, ['straddle-start', 'inside'])
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

// --- The past days reach no one who did not ask ---------------------------------

describe('the window back (past days) and the other readers of the cache', () => {
  // Saturday 2026-09-26, 3 pm. The cache now holds a month back: last
  // Saturday's party, a birthday marked as a countdown that is over, a long
  // trip that ended yesterday.
  const now = new Date(2026, 8, 26, 15, 0)
  const iso = (d, h, m = 0) => new Date(2026, 8, d, h, m).toISOString()
  const past = [
    { id: 'p1', title: 'Party', allDay: false, start: iso(19, 17), end: iso(19, 19), startDate: '2026-09-19', endDate: '2026-09-20', description: null },
    { id: 'p2', title: 'Birthday', allDay: true, start: null, end: null, startDate: '2026-09-12', endDate: '2026-09-13', description: 'countdown 30' },
    { id: 'p3', title: 'Trip', allDay: true, start: null, end: null, startDate: '2026-09-20', endDate: '2026-09-26', description: null },
  ]
  const today = [{ id: 't1', title: 'Soccer', allDay: false, start: iso(26, 17), end: iso(26, 18), startDate: '2026-09-26', endDate: '2026-09-27', description: null }]

  it('the headline reads only today and tomorrow', async () => {
    const { headlineFor } = await import('../lib/headline.mjs')
    assert.deepEqual(headlineFor({ now, events: past.concat(today) }), headlineFor({ now, events: today }))
    assert.equal(headlineFor({ now, events: past }).kind, 'daypart')
  })

  it('the countdowns skip what is over', async () => {
    const { buildCountdowns } = await import('../lib/countdowns.mjs')
    assert.deepEqual(buildCountdowns(past, { now }), [])
  })

  it('the route leaves them out unless asked', () => {
    assert.deepEqual(eventsForDays(past.concat(today), { now, days: 6 }).map((e) => e.id), ['t1'])
    assert.deepEqual(eventsForDays(past.concat(today), { now, days: 6, past: 31 }).map((e) => e.id), ['p1', 'p2', 'p3', 't1'])
  })
})

// --- The factory against a local mock of Google ------------------------------------

describe('createGoogleCalendar (mock Google)', () => {
  let dir
  let server
  let base
  const requests = []
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const now = new Date()
  const day = (n, h = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, h).toISOString()
  // Two calendars. The invitation is on both (one iCalUID); b also has an
  // event from three weeks ago, which only the past days bring in.
  const items = {
    'a@x': [{ id: 'inv-a', iCalUID: 'inv@google.com', summary: 'Dinner', start: { dateTime: day(1, 18) }, end: { dateTime: day(1, 20) } }],
    'b@x': [
      { id: 'inv-b', iCalUID: 'inv@google.com', summary: 'Dinner', start: { dateTime: day(1, 18) }, end: { dateTime: day(1, 20) } },
      { id: 'old', summary: 'Three weeks ago', start: { dateTime: day(-21) }, end: { dateTime: day(-21, 10) } },
    ],
  }

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gcal-mock-'))
    await writeFile(join(dir, 'key.json'), JSON.stringify({
      client_email: 'svc@example.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      private_key_id: 'k1',
    }))
    server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1')
      requests.push(u)
      res.setHeader('Content-Type', 'application/json')
      if (u.pathname === '/token') return res.end(JSON.stringify({ access_token: 'tok', expires_in: 3600 }))
      const cal = decodeURIComponent(u.pathname.split('/')[2] || '')
      return res.end(JSON.stringify({ items: items[cal] || [] }))
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${server.address().port}`
  })

  after(async () => {
    await new Promise((r) => server.close(r))
    await rm(dir, { recursive: true, force: true })
  })

  const shared = { calendar: { calendars: [{ id: 'a@x', label: 'A', color: '#e0457b' }, { id: 'b@x', label: 'B', color: '#4a90e2' }] } }

  it('asks Google for one window, 31 days back to 60 ahead, caches it, and dedupes across calendars', async () => {
    const cal = createGoogleCalendar({
      dir,
      getShared: () => shared,
      keyFile: join(dir, 'key.json'),
      log: () => {},
      endpoints: { token: `${base}/token`, events: `${base}/calendars` },
    })
    cal.start()
    await cal.refresh('test')
    cal.stop()

    const listCalls = requests.filter((u) => u.pathname.endsWith('/events'))
    assert.equal(listCalls.length, 2)
    const w = fetchWindow(now)
    for (const u of listCalls) {
      assert.equal(u.searchParams.get('timeMin'), w.timeMin)
      assert.equal(u.searchParams.get('timeMax'), w.timeMax)
      assert.equal(u.searchParams.get('singleEvents'), 'true')
    }

    const snap = cal.snapshot(shared)
    assert.equal(snap.connected, true)
    const titles = snap.events.map((e) => e.title)
    assert.deepEqual(titles, ['Three weeks ago', 'Dinner'])
    const dinner = snap.events[1]
    assert.equal(dinner.calendarId, 'a@x')
    assert.deepEqual(dinner.alsoOn, [{ calendarId: 'b@x', calendarLabel: 'B', color: '#4a90e2' }])
    // The route's windows: the default leaves the past out, past=31 brings it in.
    assert.deepEqual(eventsForDays(snap.events, { now, days: 6 }).map((e) => e.title), ['Dinner'])
    assert.deepEqual(eventsForDays(snap.events, { now, days: 6, past: 31 }).map((e) => e.title), ['Three weeks ago', 'Dinner'])

    const file = JSON.parse(readFileSync(join(dir, 'calendar-cache.json'), 'utf8'))
    assert.deepEqual(file.window, w)
    assert.equal(file.calendars['b@x'].events.length, 2)
  })

  it('restores a cache written before the window had past days (no `window` key)', async () => {
    const old = { savedAt: now.toISOString(), calendars: { 'a@x': { ok: true, fetchedAt: now.toISOString(), error: null, events: [
      { id: 'e1', calendarId: 'a@x', title: 'Soccer', allDay: false, start: day(0, 17), end: day(0, 18), startDate: calendarRange(now).from, endDate: calendarRange(now, { days: 1 }).to },
    ] } } }
    const cacheDir = await mkdtemp(join(tmpdir(), 'gcal-old-'))
    await writeFile(join(cacheDir, 'calendar-cache.json'), JSON.stringify(old))
    const cal = createGoogleCalendar({
      dir: cacheDir,
      getShared: () => shared,
      keyFile: join(cacheDir, 'no-key.json'),
      log: () => {},
    })
    const restored = cal.start()
    cal.stop()
    assert.equal(restored.events, 1)
    assert.equal(restored.fetchedAt, now.toISOString())
    await rm(cacheDir, { recursive: true, force: true })
  })
})
