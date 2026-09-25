// Tests for lib/health.mjs:  node --test frameserver/test/health.test.mjs
//
// No dependencies, no network: each test gets its own temp dir for
// health-events.json and passes explicit clocks.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_EVENTS, MAX_REPORT_BYTES, STALE_AFTER_S, createHealth, decodeThrottled, parseReport,
} from '../lib/health.mjs'

const T0 = Date.parse('2026-09-24T07:00:00Z')
const at = (ms) => new Date(ms)
const MIN = 60_000

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'health-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A report as pi/kiosk-server.py builds it.
function report(uptimeS, raw = '0x0', extra = {}) {
  return {
    id: 'kitchen',
    at: '2026-09-24T07:00:00Z',
    uptimeS,
    throttled: raw == null ? null : { raw, ...decodeThrottled(raw) },
    tempC: 49.6,
    load1: 0.05,
    memFreeMb: 7128,
    diskFreeGb: 103.3,
    kernel: '6.12.75+rpt-rpi-2712',
    model: 'Raspberry Pi 5 Model B Rev 1.1',
    build: 'ce00a03 - 2026-09-24 21:56',
    underVoltageDips: 153,
    lastDipAgoS: 297,
    ...extra,
  }
}

// One report a minute for `minutes` minutes of one boot that started at
// bootMs; `raw(i)` picks each minute's register. Returns the events written.
function run(h, { bootMs, fromMin, minutes, raw, jitterMs = () => 0 }) {
  const added = []
  for (let i = fromMin; i < fromMin + minutes; i += 1) {
    const t = bootMs + 30_000 + i * MIN + jitterMs(i)
    const uptimeS = Math.floor((bootMs + 30_000 + i * MIN - bootMs) / 1000)
    const r = h.recordHealth('kitchen', report(uptimeS, raw(i)), at(t))
    assert.equal(r.ok, true, r.error)
    added.push(...r.events)
  }
  return added
}

test('decodeThrottled: the eight bits, and junk', () => {
  const d = decodeThrottled('0x50000')
  assert.deepEqual(Object.entries(d).filter(([, v]) => v === true).map(([k]) => k),
    ['underVoltageOccurred', 'throttledOccurred'])
  assert.equal(decodeThrottled('0X5').raw, '0x5')
  assert.equal(decodeThrottled('0x5').underVoltageNow, true)
  assert.equal(decodeThrottled('0x5').throttledNow, true)
  assert.equal(decodeThrottled('0x80000').softTempLimitOccurred, true)
  assert.equal(decodeThrottled('0x20000').armFreqCappedOccurred, true)
  for (const bad of ['', '50000', '0x', '0xZZ', '0x123456789', 327680, null, undefined, {}]) {
    assert.equal(decodeThrottled(bad), null, String(bad))
  }
})

test('one event per flag per boot, not one per minute', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  // The kitchen as measured: 0x50000 from the inrush, for two hours.
  const added = run(h, { bootMs: T0, fromMin: 0, minutes: 120, raw: () => '0x50000' })
  assert.deepEqual(added.map((e) => e.kind), ['undervoltage', 'throttled'])
  assert.equal(added[0].now, false)
  assert.equal(added[0].raw, '0x50000')
  assert.equal(added[0].uptimeS, 30)
  assert.equal(added[0].tempC, 49.6)
  assert.equal(added[0].at, new Date(T0 + 30_000).toISOString())

  // A sample then catches undervoltage in the act: one more event, now=true;
  // it staying set for ten minutes, then flickering, writes nothing more.
  const more = run(h, {
    bootMs: T0, fromMin: 120, minutes: 30, raw: (i) => (i < 130 || i % 3 === 0 ? '0x50005' : '0x50000'),
  })
  assert.deepEqual(more.map((e) => [e.kind, e.now]), [['undervoltage', true], ['throttled', true]])
  assert.equal(h.healthFor('kitchen', at(T0 + 151 * MIN)).events24h, 4)
})

test('freq and temp: their "occurred" flags only', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  const added = run(h, { bootMs: T0, fromMin: 0, minutes: 5, raw: (i) => (i === 0 ? '0xa0000' : '0xa000a') })
  assert.deepEqual(added.map((e) => [e.kind, e.now]), [['freq', false], ['temp', false]])
})

test('a new boot: uptime went down', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  assert.equal(run(h, { bootMs: T0, fromMin: 0, minutes: 60, raw: () => '0x50000' }).length, 2)
  // Reboot at T0 + 2 h: uptime starts again from 30 s.
  const again = run(h, { bootMs: T0 + 120 * MIN, fromMin: 0, minutes: 10, raw: () => '0x50000' })
  assert.deepEqual(again.map((e) => e.kind), ['undervoltage', 'throttled'])
  assert.equal(again[0].uptimeS, 30)
})

test('a new boot: missed reboot, uptime already past the old one', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  // Up 5 minutes, then silent (the hub could not hear it), rebooted at
  // +10 min, heard again at +30 min with 20 min of uptime: more than before.
  assert.equal(run(h, { bootMs: T0, fromMin: 0, minutes: 5, raw: () => '0x50000' }).length, 2)
  const again = run(h, { bootMs: T0 + 10 * MIN, fromMin: 20, minutes: 3, raw: () => '0x50000' })
  assert.equal(again.length, 2)
})

test('the same boot survives latency jitter and a week of clock drift', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  // Receive times wobble by up to 6 s (request latency) ...
  const first = run(h, {
    bootMs: T0, fromMin: 0, minutes: 60, raw: () => '0x50000', jitterMs: (i) => ((i * 7919) % 12_000) - 6_000,
  })
  assert.equal(first.length, 2)
  // ... and after a week of silence the Pi's uptime clock has drifted 40 s
  // against the hub's (66 ppm): still the same boot.
  const week = 7 * 24 * 60
  const r = h.recordHealth('kitchen', report(30 + week * 60 - 40, '0x50000'), at(T0 + 30_000 + week * MIN))
  assert.deepEqual(r.events, [])
})

test('a hub restart does not log the same boot twice', (t) => {
  const dir = tempDir(t)
  const a = createHealth({ dir })
  assert.equal(run(a, { bootMs: T0, fromMin: 0, minutes: 10, raw: () => '0x50000' }).length, 2)
  // A deploy restarts the hub three hours later; the Pi has not rebooted.
  const b = createHealth({ dir })
  assert.deepEqual(run(b, { bootMs: T0, fromMin: 180, minutes: 5, raw: () => '0x50000' }), [])
  // But a live catch it has not logged yet is still news.
  assert.deepEqual(run(b, { bootMs: T0, fromMin: 185, minutes: 1, raw: () => '0x50005' }).map((e) => e.kind),
    ['undervoltage', 'throttled'])
  // And after the restart, a real reboot logs again.
  const c = createHealth({ dir })
  assert.equal(run(c, { bootMs: T0 + 300 * MIN, fromMin: 0, minutes: 2, raw: () => '0x50000' }).length, 2)
  assert.equal(JSON.parse(readFileSync(join(dir, 'health-events.json'), 'utf8')).length, 6)
})

test('stale after 180 s without a report', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  assert.equal(h.healthFor('kitchen'), null)
  h.recordHealth('kitchen', report(600, '0x0'), at(T0))
  const fresh = h.healthFor('kitchen', at(T0 + STALE_AFTER_S * 1000))
  assert.equal(fresh.stale, false)
  assert.equal(fresh.ageS, 180)
  assert.equal(fresh.receivedAt, at(T0).toISOString())
  assert.equal(fresh.latest.uptimeS, 600)
  assert.equal(fresh.events24h, 0)
  assert.equal(fresh.lastEvent, null)
  const stale = h.healthFor('kitchen', at(T0 + (STALE_AFTER_S + 1) * 1000))
  assert.equal(stale.stale, true)
  assert.deepEqual(h.brief(at(T0 + 181_000)), { devices: 1, stale: ['kitchen'] })
  assert.deepEqual(h.brief(at(T0 + 60_000)), { devices: 1, stale: [] })
})

test('after a restart, a screen with events on file but no report yet shows as stale', (t) => {
  const dir = tempDir(t)
  run(createHealth({ dir }), { bootMs: T0, fromMin: 0, minutes: 2, raw: () => '0x50000' })
  const h = createHealth({ dir })
  const f = h.healthFor('kitchen', at(T0 + 10 * MIN))
  assert.equal(f.latest, null)
  assert.equal(f.ageS, null)
  assert.equal(f.stale, true)
  assert.equal(f.events24h, 2)
  assert.equal(f.lastEvent.kind, 'throttled')
  assert.equal(typeof f.hubStartedAt, 'string')
  assert.deepEqual(Object.keys(h.healthSummary(at(T0 + 10 * MIN))), ['kitchen'])
  // A week and a day later it has dropped out of the summary.
  assert.deepEqual(Object.keys(h.healthSummary(at(T0 + 8 * 24 * 60 * MIN))), [])
})

test('events24h counts the last day only; lastEvent is the newest', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  run(h, { bootMs: T0, fromMin: 0, minutes: 1, raw: () => '0x10000' })
  run(h, { bootMs: T0 + 25 * 60 * MIN, fromMin: 0, minutes: 1, raw: () => '0x50000' })
  const f = h.healthFor('kitchen', at(T0 + 26 * 60 * MIN))
  assert.equal(f.events24h, 2)
  assert.equal(f.lastEvent.kind, 'throttled')
})

test('the file keeps the newest 200 events; /api/health/events is newest first', (t) => {
  const dir = tempDir(t)
  const h = createHealth({ dir })
  for (let b = 0; b < 125; b += 1) {
    run(h, { bootMs: T0 + b * 10 * MIN, fromMin: 0, minutes: 1, raw: () => '0x50000' })
  }
  const onFile = JSON.parse(readFileSync(join(dir, 'health-events.json'), 'utf8'))
  assert.equal(onFile.length, MAX_EVENTS)
  // 250 were written; the oldest 50 (the first 25 boots) are gone.
  assert.equal(onFile[0].at, new Date(T0 + 25 * 10 * MIN + 30_000).toISOString())
  const newest = h.events(3)
  assert.equal(newest.length, 3)
  assert.equal(newest[0].at, new Date(T0 + 124 * 10 * MIN + 30_000).toISOString())
  assert.ok(Date.parse(newest[0].at) >= Date.parse(newest[2].at))
  assert.equal(h.events().length, 50)
  assert.equal(h.events('10').length, 10)
  assert.equal(h.events('abc').length, 50)
  assert.equal(h.events('0').length, 1)
  assert.equal(h.events('5000').length, MAX_EVENTS)
  // A restart reads the same 200 back.
  assert.equal(createHealth({ dir }).events(500).length, MAX_EVENTS)
})

test('malformed reports are refused and store nothing', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  const cases = [
    [null, 400], [[], 400], ['0x50000', 400], [42, 400],
    [report(10, '0x0', { id: 'living-room-tv' }), 400],
    [report(10, '0x0', { uptimeS: -1 }), 400],
    [report(10, '0x0', { uptimeS: '10' }), 400],
    [report(10, '0x0', { tempC: '49.6' }), 400],
    [report(10, '0x0', { tempC: 900 }), 400],
    [report(10, '0x0', { underVoltageDips: 1.5 }), 400],
    [report(10, '0x0', { at: 'yesterday' }), 400],
    [report(10, '0x0', { model: 'x'.repeat(121) }), 400],
    [report(10, '0x0', { throttled: { raw: 'throttled=0x50000' } }), 400],
    [report(10, '0x0', { throttled: { raw: 327680 } }), 400],
    [report(10, '0x0', { throttled: '0x50000' }), 400],
    [report(10, '0x0', { throttled: { raw: '0x5', underVoltageNow: 'yes' } }), 400],
    [report(10, '0x0', { build: 'b'.repeat(100), kernel: 'k'.repeat(100), model: 'm'.repeat(100),
      padding: 'p'.repeat(MAX_REPORT_BYTES) }), 413],
  ]
  for (const [body, status] of cases) {
    const r = h.recordHealth('kitchen', body, at(T0))
    assert.equal(r.ok, false, JSON.stringify(body)?.slice(0, 80))
    assert.equal(r.status, status, `${JSON.stringify(body)?.slice(0, 80)}: ${r.error}`)
    assert.equal(typeof r.error, 'string')
  }
  assert.equal(h.healthFor('kitchen', at(T0)), null)
  assert.deepEqual(h.events(), [])
})

test('what is stored: known fields only, flags from raw, nulls allowed', (t) => {
  const h = createHealth({ dir: tempDir(t) })
  // A lying flag loses to the register; an unknown field is dropped.
  const r = h.recordHealth('kitchen', report(60, '0x1', {
    throttled: { raw: '0x1', underVoltageNow: false }, surprise: 1,
  }), at(T0))
  assert.equal(r.ok, true)
  const f = h.healthFor('kitchen', at(T0))
  assert.equal(f.latest.throttled.underVoltageNow, true)
  assert.equal('surprise' in f.latest, false)
  assert.deepEqual(Object.keys(f.latest), ['id', 'at', 'uptimeS', 'throttled', 'tempC', 'load1',
    'memFreeMb', 'diskFreeGb', 'kernel', 'model', 'build', 'underVoltageDips', 'lastDipAgoS'])
  // A report from a machine without vcgencmd (the Mac's nulls): stored, no events.
  const mac = { id: 'kitchen', at: '2026-09-25T06:42:00Z', uptimeS: null, throttled: null, tempC: null,
    load1: 17.57, memFreeMb: null, diskFreeGb: 8.9, kernel: '25.6.0', model: null, build: null,
    underVoltageDips: null, lastDipAgoS: null }
  const m = h.recordHealth('kitchen', mac, at(T0 + MIN))
  assert.deepEqual([m.ok, m.events], [true, []])
  assert.equal(h.healthFor('kitchen', at(T0 + MIN)).latest.throttled, null)
  // parseReport is the same check, standalone.
  assert.equal(parseReport('kitchen', { id: 'kitchen' }).report.uptimeS, null)
})

test('a corrupt events file starts empty instead of failing', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'health-events.json'), '{not json')
  const h = createHealth({ dir })
  assert.deepEqual(h.events(), [])
  writeFileSync(join(dir, 'health-events.json'), JSON.stringify([{ junk: true }, 7,
    { id: 'kitchen', at: '2026-09-24T07:00:30.000Z', kind: 'undervoltage', now: false, raw: '0x50000', tempC: 49, uptimeS: 30 }]))
  assert.equal(createHealth({ dir }).events().length, 1)
})
