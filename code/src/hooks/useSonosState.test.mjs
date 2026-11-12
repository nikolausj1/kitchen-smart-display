// Tests for hooks/useSonosState.js: sendSonosCommand, the one fire-and-forget
// Sonos command behind useSonosActions. It runs against a stubbed fetch, never
// a socket: what is under test is the abort after SONOS_ACTION_TIMEOUT_MS
// (one console.warn, no rejection) that keeps a stuck player from piling hung
// requests into the browser's connection pool and stalling the /zones poll
// (the 2026-10-29 stale Playbar address).
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SONOS_ACTION_TIMEOUT_MS, sendSonosCommand } from './useSonosState.js'

// A fetch that never answers until its signal aborts, like a write to a player
// whose address is stale.
function hangingFetch(calls) {
  return (url, init) => new Promise((_, reject) => {
    calls.push({ url, init })
    init.signal.addEventListener('abort', () => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      reject(e)
    })
  })
}

function captureWarns(t) {
  const warns = []
  const orig = console.warn
  console.warn = (...args) => { warns.push(args) }
  t.after(() => { console.warn = orig })
  return warns
}

test('the default timeout is 3 s', () => {
  assert.equal(SONOS_ACTION_TIMEOUT_MS, 3000)
})

test('a hung command is aborted after the timeout, with one warning and no rejection', async (t) => {
  const warns = captureWarns(t)
  const calls = []
  const started = Date.now()
  await sendSonosCommand('http://hub/api/sonos/Family%20Room/volume/20', {
    timeoutMs: 40, fetchImpl: hangingFetch(calls),
  })
  const took = Date.now() - started
  assert.ok(took >= 30 && took < 1000, `took ${took} ms`)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.cache, 'no-store')
  assert.ok(calls[0].init.signal.aborted, 'the request signal was aborted')
  assert.equal(warns.length, 1)
  assert.match(String(warns[0][0]), /timed out after 0\.04s/)
  assert.equal(warns[0][1], 'http://hub/api/sonos/Family%20Room/volume/20')
})

test('a prompt answer resolves without warning and clears the timer', async (t) => {
  const warns = captureWarns(t)
  let signal
  await sendSonosCommand('http://hub/api/sonos/Main/play', {
    timeoutMs: 40,
    fetchImpl: async (_url, init) => { signal = init.signal; return { ok: true, status: 200 } },
  })
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(warns.length, 0)
  assert.equal(signal.aborted, false, 'the timer was cleared, so nothing aborted after the answer')
})

test('a network failure is one warning, not a rejection', async (t) => {
  const warns = captureWarns(t)
  await sendSonosCommand('http://hub/api/sonos/Main/pause', {
    timeoutMs: 40,
    fetchImpl: async () => { throw new TypeError('fetch failed') },
  })
  assert.equal(warns.length, 1)
  assert.equal(warns[0][0], 'sonos action failed')
})

test('ten hung commands each give up on their own: nothing waits on the others', async (t) => {
  captureWarns(t)
  const calls = []
  const started = Date.now()
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    sendSonosCommand(`http://hub/api/sonos/Family%20Room/volume/${i}`, {
      timeoutMs: 40, fetchImpl: hangingFetch(calls),
    })))
  assert.equal(calls.length, 10)
  assert.ok(Date.now() - started < 1000)
})
