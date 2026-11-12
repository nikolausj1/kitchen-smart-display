// Tests for lib/sonosWatchdog.mjs:  node --test frameserver/test/sonosWatchdog.test.mjs
//
// No network, no PowerShell: every watchdog gets an explicit clock and a
// recording restart function. restartSonosService itself is only checked to
// refuse off Windows.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COOLDOWN_MS, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS, classifyPath, createSonosWatchdog,
  restartSonosService,
} from '../lib/sonosWatchdog.mjs'

const MIN = 60_000
const T0 = Date.parse('2026-10-29T18:00:00Z')

function make(overrides = {}) {
  let t = T0
  const restarts = []
  const logs = []
  const wd = createSonosWatchdog({
    now: () => t,
    log: (m) => logs.push(m),
    restart: async () => { restarts.push(t); return 'Running' },
    ...overrides,
  })
  return { wd, restarts, logs, tick: (ms) => { t += ms }, at: () => t }
}

// n write timeouts to a room, spaced `gapMs` apart, each after a fresh read.
// Resolves true when one of them started a restart (and after it finished).
async function fail(h, room, n, gapMs = 1000) {
  let started = false
  for (let i = 0; i < n; i++) {
    h.wd.noteOk('/zones')
    const p = h.wd.noteTimeout(`/${encodeURIComponent(room)}/volume/20`)
    if (p) { started = true; await p }
    h.tick(gapMs)
  }
  return started
}

const microtask = () => new Promise((r) => setImmediate(r))

test('classifyPath: writes are /<room>/<action>; reads are /zones, /state, /favorites and one-segment paths', () => {
  assert.deepEqual(classifyPath('/Family%20Room/volume/20'), { room: 'Family Room', action: 'volume' })
  assert.deepEqual(classifyPath('/Main/favorite/My%20Station'), { room: 'Main', action: 'favorite' })
  assert.deepEqual(classifyPath('/Office/join/Main?x=1'), { room: 'Office', action: 'join' })
  assert.deepEqual(classifyPath('/Main/groupVolume/30'), { room: 'Main', action: 'groupvolume' })
  assert.equal(classifyPath('/zones'), null)
  assert.equal(classifyPath('/Main/state'), null)
  assert.equal(classifyPath('/Main/favorites'), null)
  assert.equal(classifyPath('/Main/favorites/detailed'), null)
  assert.equal(classifyPath('/getaa?s=1&u=x'), null)
  assert.equal(classifyPath('/'), null)
  assert.equal(classifyPath(''), null)
})

test('defaults: 5 timeouts in 10 minutes, one restart per 30 minutes', () => {
  assert.equal(DEFAULT_THRESHOLD, 5)
  assert.equal(DEFAULT_WINDOW_MS, 10 * MIN)
  assert.equal(DEFAULT_COOLDOWN_MS, 30 * MIN)
})

test('counts write timeouts per room and forgets them after the window', () => {
  const h = make()
  h.wd.noteTimeout('/Family%20Room/volume/20')
  h.wd.noteTimeout('/Family%20Room/volume/25')
  h.wd.noteTimeout('/Main/play')
  assert.deepEqual(h.wd.status().timeouts, { 'Family Room': 2, Main: 1 })
  h.tick(9 * MIN)
  h.wd.noteTimeout('/Main/pause')
  assert.deepEqual(h.wd.status().timeouts, { 'Family Room': 2, Main: 2 })
  h.tick(1 * MIN + 1)   // the first three are now 10 min old
  assert.deepEqual(h.wd.status().timeouts, { Main: 1 })
  assert.equal(h.restarts.length, 0)
})

test('read timeouts never count: an outage is not a stale player', () => {
  const h = make()
  for (let i = 0; i < 20; i++) {
    h.wd.noteTimeout('/zones')
    h.wd.noteTimeout('/Main/state')
    h.wd.noteTimeout('/Main/favorites/detailed')
  }
  assert.deepEqual(h.wd.status().timeouts, {})
  assert.equal(h.restarts.length, 0)
})

test('a write that succeeds clears its room: a slow player is not a stale one', () => {
  const h = make()
  for (let i = 0; i < 4; i++) h.wd.noteTimeout('/Family%20Room/volume/20')
  h.wd.noteTimeout('/Main/play')
  h.wd.noteOk('/Family%20Room/volume/22')
  assert.deepEqual(h.wd.status().timeouts, { Main: 1 })
})

test('restarts once the threshold is reached while reads succeed, and clears every count', async () => {
  const h = make()
  h.wd.noteTimeout('/Main/play')
  assert.equal(await fail(h, 'Family Room', 5), true, 'the fifth timeout started a restart')
  assert.equal(h.restarts.length, 1)
  const s = h.wd.status()
  assert.deepEqual(s.timeouts, {})
  assert.equal(s.restarts, 1)
  assert.equal(s.restarting, false)
  assert.equal(s.lastRestart.room, 'Family Room')
  assert.equal(s.lastRestart.timeouts, 5)
  assert.equal(s.lastRestart.ok, true)
  assert.equal(s.lastRestart.result, 'Running')
  assert.equal(s.lastRestart.error, null)
  assert.equal(s.holding, null)
  assert.ok(h.logs.some((m) => /restarting SmartDisplaySonosAPI/.test(m)), h.logs.join('\n'))
  assert.ok(h.logs.some((m) => /restarted \(Running\)/.test(m)), h.logs.join('\n'))
})

test('four timeouts do not restart; the fifth outside the window does not either', async () => {
  const h = make()
  await fail(h, 'Family Room', 4)
  assert.equal(h.restarts.length, 0)
  h.tick(10 * MIN)
  h.wd.noteOk('/zones')
  assert.equal(h.wd.noteTimeout('/Family%20Room/volume/20'), null)
  assert.equal(h.restarts.length, 0)
  assert.deepEqual(h.wd.status().timeouts, { 'Family Room': 1 })
})

test('holds when reads have not succeeded recently: during an outage a restart fixes nothing', async () => {
  const h = make()
  for (let i = 0; i < 6; i++) h.wd.noteTimeout('/Family%20Room/volume/20')
  assert.equal(h.restarts.length, 0)
  const s = h.wd.status()
  assert.equal(s.timeouts['Family Room'], 6)
  assert.match(s.holding, /reads are failing/)
  // Logged once for the same reason, not on every further timeout.
  assert.equal(h.logs.filter((m) => /not restarting/.test(m)).length, 1)

  // A read 2 minutes ago is stale too (readFreshMs defaults to 60 s).
  const h2 = make()
  h2.wd.noteOk('/zones')
  h2.tick(2 * MIN)
  for (let i = 0; i < 5; i++) h2.wd.noteTimeout('/Family%20Room/volume/20')
  assert.equal(h2.restarts.length, 0)

  // Once reads work again the next timeout over the threshold restarts.
  h2.wd.noteOk('/zones')
  await h2.wd.noteTimeout('/Family%20Room/volume/20')
  assert.equal(h2.restarts.length, 1)
})

test('rate limit: no second restart inside the cooldown, then one more after it', async () => {
  const h = make()
  await fail(h, 'Family Room', 5)
  assert.equal(h.restarts.length, 1)

  h.tick(5 * MIN)
  await fail(h, 'Family Room', 7)
  assert.equal(h.restarts.length, 1, 'held during the cooldown')
  const held = h.wd.status()
  assert.equal(held.timeouts['Family Room'], 7, 'the counts keep building while held')
  assert.match(held.holding, /cooldown 30 min/)

  h.tick(30 * MIN)
  await fail(h, 'Family Room', 5)
  assert.equal(h.restarts.length, 2)
  assert.equal(h.wd.status().restarts, 2)
  assert.equal(h.wd.status().holding, null)
})

test('a failed restart is recorded with its error and still starts the cooldown', async () => {
  const h = make({ restart: async () => { throw new Error('Access is denied') } })
  await fail(h, 'Family Room', 5)
  const s = h.wd.status()
  assert.equal(s.lastRestart.ok, false)
  assert.equal(s.lastRestart.error, 'Access is denied')
  assert.equal(s.restarts, 1)
  assert.ok(h.logs.some((m) => /restart of SmartDisplaySonosAPI failed: Access is denied/.test(m)))
  await fail(h, 'Family Room', 5)
  assert.equal(s.restarts, 1, 'the failure does not retry inside the cooldown')
})

test('only one restart runs at a time', async () => {
  let release
  let started = 0
  const h = make({ restart: () => new Promise((r) => { started += 1; release = r }) })
  for (let i = 0; i < 5; i++) { h.wd.noteOk('/zones'); h.wd.noteTimeout('/Family%20Room/volume/20') }
  await microtask()
  assert.equal(started, 1)
  assert.equal(h.wd.status().restarting, true)
  for (let i = 0; i < 5; i++) { h.wd.noteOk('/zones'); h.wd.noteTimeout('/Main/volume/20') }
  await microtask()
  assert.equal(started, 1)
  assert.match(h.wd.status().holding, /already running/)
  release('Running')
  await microtask()
  assert.equal(h.wd.status().restarting, false)
})

test('status() is JSON-safe and dates are ISO strings', async () => {
  const h = make()
  h.wd.noteOk('/zones')
  await fail(h, 'Family Room', 5)
  const s = JSON.parse(JSON.stringify(h.wd.status()))
  assert.equal(s.service, 'SmartDisplaySonosAPI')
  assert.equal(s.lastReadOkAt, new Date(h.at() - 1000).toISOString())
  assert.equal(s.lastRestart.at, new Date(h.at() - 1000).toISOString())
  assert.equal(s.threshold, 5)
  assert.equal(s.windowMs, 10 * MIN)
  assert.equal(s.cooldownMs, 30 * MIN)
})

test('restartSonosService refuses off Windows without running anything', async () => {
  await assert.rejects(restartSonosService({ platform: 'darwin' }), /not on Windows/)
})
