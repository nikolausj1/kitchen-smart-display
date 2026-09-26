// homeAssistant.test.mjs - lib/homeAssistant.mjs: the hub's whitelisted
// Home Assistant layer.
//
//   node --test frameserver/test/homeAssistant.test.mjs
//
// No real socket and no real network to a real Home Assistant. The websocket
// auth/event handlers are driven through a fake WebSocket (the `createSocket`
// test knob): each test gets the exact FakeSocket instance the module
// created and delivers "server" messages to it with .server({...}), then
// reads back what the module sent and what snapshot()/brief() show. REST
// calls the module makes on its own (seeding, the REST fallback poll, the
// entity search) go through a stubbed globalThis.fetch, the same pattern
// plex.test.mjs and tmdb.test.mjs use. runAction's own tests instead prove
// the exact request against a real node:http server (startMockHa) - the
// same kind of mock used for the manual VERIFY pass against a stand-in HA.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KINDS, SEED_ACTIONS, SEED_ENTITIES, SERVICE_ALLOWLIST,
  createHomeAssistant, defaultKindForDomain, domainOf, pickAttributes,
} from '../lib/homeAssistant.mjs'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ha-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// A minimal stand-in for the registry's shared settings: enough of
// server.mjs's patchShared (read, shallow-merge the one top-level key this
// module ever writes, keep) for these tests, without pulling in server.mjs.
function sharedStore(initial = {}) {
  let shared = structuredClone(initial)
  return {
    get: () => shared,
    patch: (partial) => {
      shared = { ...shared, ...partial }
      return shared
    },
  }
}

// A fake browser-style WebSocket (the shape createHomeAssistant's
// `createSocket` needs): captures every frame sent, and lets a test deliver
// a "server" message with .server({...}) instead of a real socket.
class FakeSocket {
  constructor(url) {
    this.url = url
    this.sent = []
    this.closed = false
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
  }
  send(data) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
  server(msg) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

// A fresh HA instance wired to fakes, plus everything a test needs to drive
// it: the sockets it created (in order), the shared-settings store, and its
// log lines.
function makeHa(t, { shared = {}, ...opts } = {}) {
  const dir = tempDir(t)
  const store = sharedStore(shared)
  const sockets = []
  const createSocket = (url) => {
    const s = new FakeSocket(url)
    sockets.push(s)
    return s
  }
  const logs = []
  const ha = createHomeAssistant({
    dir,
    getShared: store.get,
    patchShared: store.patch,
    url: 'http://ha.local:8123',
    getToken: () => 'test-token',
    createSocket,
    log: (m) => logs.push(m),
    ...opts,
  })
  return { ha, dir, store, sockets, logs }
}

function authed(sockets) {
  const sock = sockets[sockets.length - 1]
  sock.server({ type: 'auth_required' })
  sock.server({ type: 'auth_ok' })
  return sock
}

// ---- pure helpers -----------------------------------------------------------

describe('domainOf / defaultKindForDomain', () => {
  test('splits on the first dot; an unrecognised domain defaults to other', () => {
    assert.equal(domainOf('light.downstairs'), 'light')
    assert.equal(domainOf('binary_sensor.front_door_contact_open'), 'binary_sensor')
    assert.equal(domainOf('not-an-entity-id'), '')
    assert.equal(domainOf(null), '')
    assert.equal(defaultKindForDomain('light.downstairs'), 'light')
    assert.equal(defaultKindForDomain('cover.garage_door_controller'), 'cover')
    assert.equal(defaultKindForDomain('lock.front_door'), 'lock')
    assert.equal(defaultKindForDomain('input_boolean.mode_away'), 'switch')
    assert.equal(defaultKindForDomain('input_select.day_part_override'), 'select')
    assert.equal(defaultKindForDomain('binary_sensor.front_door_contact_open'), 'sensor')
    assert.equal(defaultKindForDomain('person.justin'), 'person')
    assert.equal(defaultKindForDomain('scene.movie_night'), 'other')
  })
})

describe('pickAttributes', () => {
  test('keeps only the allowlisted keys that are present, drops the rest', () => {
    assert.deepEqual(
      pickAttributes({ friendly_name: 'Downstairs', brightness: 120, secret_internal: 'x' }),
      { friendly_name: 'Downstairs', brightness: 120 },
    )
    assert.deepEqual(pickAttributes({}), {})
    assert.deepEqual(pickAttributes(null), {})
    assert.deepEqual(pickAttributes(undefined), {})
    assert.deepEqual(pickAttributes({ options: ['a', 'b'] }, ['options']), { options: ['a', 'b'] })
  })
})

describe('SEED_ENTITIES / SEED_ACTIONS', () => {
  test('13 entities, 10 actions, every action targets a seeded entity with a real kind', () => {
    assert.equal(SEED_ENTITIES.length, 13)
    assert.equal(SEED_ACTIONS.length, 10)
    const ids = new Set(SEED_ENTITIES.map((e) => e.id))
    assert.equal(ids.size, 13, 'every seed entity id is unique')
    for (const e of SEED_ENTITIES) assert.ok(KINDS.includes(e.kind), `${e.id}: kind "${e.kind}"`)
    for (const a of SEED_ACTIONS) assert.ok(ids.has(a.entity), `${a.id} targets ${a.entity}, which is not seeded`)
  })
})

describe('SERVICE_ALLOWLIST', () => {
  test('every seed action\'s service ("domain.service") is allowed for its own domain', () => {
    for (const a of SEED_ACTIONS) {
      const [domain, bareService] = a.service.split('.')
      assert.equal(domain, domainOf(a.entity), `${a.id}: service domain should match its entity's domain`)
      assert.ok(SERVICE_ALLOWLIST[domain]?.includes(bareService), `${a.id}: ${a.service} not allowed`)
    }
  })
  test('read-only domains (todo) allow nothing; unlisted domains (sensor, person, camera) are absent', () => {
    assert.deepEqual(SERVICE_ALLOWLIST.todo, [])
    assert.equal(SERVICE_ALLOWLIST.sensor, undefined)
    assert.equal(SERVICE_ALLOWLIST.person, undefined)
    assert.equal(SERVICE_ALLOWLIST.camera, undefined)
  })
})

// ---- the websocket: auth, subscribe, get_states, events, the whitelist filter ----

describe('websocket message handling', () => {
  test('auth_required -> auth -> auth_ok -> subscribe_events + get_states; only whitelisted rows land', (t) => {
    const { ha, sockets } = makeHa(t, {
      shared: { ha: { entities: [
        { id: 'light.downstairs', label: 'Downstairs', kind: 'light' },
        { id: 'light.basement_basement', label: 'Basement', kind: 'light' },
      ], actions: [] } },
    })
    ha.start()
    assert.equal(sockets.length, 1)
    const sock = sockets[0]

    sock.server({ type: 'auth_required' })
    assert.deepEqual(sock.sent[0], { type: 'auth', access_token: 'test-token' })
    assert.equal(ha.snapshot().connected, false)

    sock.server({ type: 'auth_ok' })
    assert.equal(ha.snapshot().connected, true)
    assert.equal(sock.sent[1].type, 'subscribe_events')
    assert.equal(sock.sent[1].event_type, 'state_changed')
    assert.equal(sock.sent[2].type, 'get_states')
    const statesId = sock.sent[2].id

    // A result for a different id (e.g. the subscribe ack) must not be
    // mistaken for the states dump.
    sock.server({ id: sock.sent[1].id, type: 'result', success: true, result: null })
    assert.equal(ha.snapshot().fetchedAt, null)

    sock.server({
      id: statesId,
      type: 'result',
      success: true,
      result: [
        { entity_id: 'light.downstairs', state: 'on', attributes: { friendly_name: 'Downstairs', extra: 'drop-me' }, last_changed: '2026-09-26T10:00:00Z' },
        { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen' } }, // not whitelisted
      ],
    })
    const snap = ha.snapshot()
    assert.ok(snap.fetchedAt)
    assert.equal(snap.entities['light.downstairs'].state, 'on')
    assert.equal(snap.entities['light.downstairs'].attributes.friendly_name, 'Downstairs')
    assert.equal(snap.entities['light.downstairs'].attributes.extra, undefined, 'attributes outside the allowlist are dropped')
    assert.equal(snap.entities['light.downstairs'].lastChanged, '2026-09-26T10:00:00Z')
    assert.equal(snap.entities['light.basement_basement'].state, null, 'whitelisted but no data yet')
    assert.equal(Object.keys(snap.entities).includes('light.kitchen'), false, 'never whitelisted, never surfaced')
    ha.stop()
  })

  test('state_changed for a whitelisted entity updates it and lastEventAt; a non-whitelisted one is ignored', (t) => {
    const { ha, sockets } = makeHa(t, { shared: { ha: { entities: [{ id: 'light.downstairs', label: 'Downstairs', kind: 'light' }], actions: [] } } })
    ha.start()
    const sock = authed(sockets)
    assert.equal(ha.snapshot().lastEventAt, null)

    sock.server({ type: 'event', event: { event_type: 'state_changed', data: {
      entity_id: 'light.kitchen', new_state: { state: 'on', attributes: {} },
    } } })
    assert.equal(ha.snapshot().lastEventAt, null, 'a non-whitelisted entity never moves lastEventAt')

    sock.server({ type: 'event', event: { event_type: 'state_changed', data: {
      entity_id: 'light.downstairs', new_state: { state: 'off', attributes: { friendly_name: 'Downstairs' }, last_changed: '2026-09-26T11:00:00Z' },
    } } })
    const snap = ha.snapshot()
    assert.equal(snap.entities['light.downstairs'].state, 'off')
    assert.ok(snap.lastEventAt)

    // new_state: null (HA removed the entity) clears it from memory; it still
    // appears in the snapshot (still whitelisted) but with a null state again.
    sock.server({ type: 'event', event: { event_type: 'state_changed', data: { entity_id: 'light.downstairs', new_state: null } } })
    assert.equal(ha.snapshot().entities['light.downstairs'].state, null)
    ha.stop()
  })

  test('auth_invalid marks it disconnected with the error, and closes the socket', (t) => {
    const { ha, sockets } = makeHa(t, { shared: { ha: { entities: [], actions: [] } } })
    ha.start()
    const sock = sockets[0]
    sock.server({ type: 'auth_required' })
    sock.server({ type: 'auth_invalid', message: 'invalid access token' })
    const snap = ha.snapshot()
    assert.equal(snap.connected, false)
    assert.equal(snap.error, 'invalid access token')
    assert.equal(sock.closed, true)
    ha.stop()
  })

  test('a dropped connection schedules a reconnect', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { ha, sockets } = makeHa(t, { shared: { ha: { entities: [], actions: [] } } })
    ha.start()
    assert.equal(sockets.length, 1)
    authed(sockets).close()
    t.mock.timers.tick(5_000) // MIN_BACKOFF_MS
    assert.equal(sockets.length, 2, 'a new socket was opened after the backoff')
    ha.stop()
  })

  test('reconcile: removing a whitelisted id drops it from the snapshot within a few seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const { ha, sockets, store } = makeHa(t, {
      shared: { ha: { entities: [{ id: 'light.downstairs', label: 'Downstairs', kind: 'light' }], actions: [] } },
    })
    ha.start()
    const sock = authed(sockets)
    sock.server({ id: sock.sent[2].id, type: 'result', success: true, result: [
      { entity_id: 'light.downstairs', state: 'on', attributes: {} },
    ] })
    assert.equal(ha.snapshot().entities['light.downstairs'].state, 'on')

    store.patch({ ha: { entities: [], actions: [] } })
    t.mock.timers.tick(5_000) // RECONCILE_MS
    assert.deepEqual(ha.snapshot().entities, {})
    ha.stop()
  })
})

// ---- seeding: shared.ha absent -> checked against a fake REST states list ----

describe('seeding the whitelist', () => {
  function stubExistence(missingIds) {
    const missing = new Set(missingIds)
    const seen = []
    globalThis.fetch = async (u) => {
      const m = /\/api\/states\/(.+)$/.exec(String(u))
      assert.ok(m, `unexpected seed-check URL: ${u}`)
      const id = decodeURIComponent(m[1])
      seen.push(id)
      return new Response('{}', { status: missing.has(id) ? 404 : 200 })
    }
    return seen
  }

  test('start() seeds once from SEED_ENTITIES/SEED_ACTIONS, dropping ids Home Assistant does not have', async (t) => {
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    const seen = stubExistence(['binary_sensor.front_door_contact_open', 'person.sheena'])
    const { ha, store } = makeHa(t, { shared: {} })

    const r = ha.start()
    assert.equal(r.seeded, true)
    for (let i = 0; i < 40 && !store.get().ha; i += 1) await new Promise((res) => setTimeout(res, 5))

    assert.equal(seen.length, 13, 'every seed entity was checked')
    const saved = store.get().ha
    assert.ok(saved, 'shared.ha was written')
    assert.equal(saved.entities.length, 11)
    assert.ok(!saved.entities.some((e) => e.id === 'binary_sensor.front_door_contact_open' || e.id === 'person.sheena'))
    // Neither dropped id had an action targeting it, so all 10 survive.
    assert.equal(saved.actions.length, 10)
    // The seed writes actions disabled: a whitelist can be built and
    // reviewed before any screen can actually trigger it.
    assert.equal(saved.actionsEnabled, false)
    assert.equal(ha.snapshot().actionsEnabled, false)
    assert.equal(ha.brief().actionsEnabled, false)
    ha.stop()
  })

  test('an action whose entity got dropped is dropped with it', async (t) => {
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    stubExistence(['cover.garage_door_controller']) // both garage actions should go
    const { ha, store } = makeHa(t, { shared: {} })
    ha.start()
    for (let i = 0; i < 40 && !store.get().ha; i += 1) await new Promise((res) => setTimeout(res, 5))
    const saved = store.get().ha
    assert.equal(saved.entities.length, 12)
    assert.ok(!saved.actions.some((a) => a.entity === 'cover.garage_door_controller'))
    assert.equal(saved.actions.length, 8)
    ha.stop()
  })

  test('does nothing when shared.ha already exists, even an empty one', async (t) => {
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    let fetched = false
    globalThis.fetch = async () => { fetched = true; return new Response('{}', { status: 200 }) }
    const { ha, store } = makeHa(t, { shared: { ha: { entities: [], actions: [] } } })
    const r = ha.start()
    assert.equal(r.seeded, false)
    await new Promise((res) => setTimeout(res, 20))
    assert.equal(fetched, false)
    assert.deepEqual(store.get().ha, { entities: [], actions: [] })
    ha.stop()
  })

  test('not configured (no url/token): seeding is skipped, nothing is fetched', async (t) => {
    let fetched = false
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    globalThis.fetch = async () => { fetched = true; return new Response('{}', { status: 200 }) }
    const { ha } = makeHa(t, { shared: {}, url: '', getToken: () => null })
    const r = ha.start()
    assert.equal(r.seeded, false)
    assert.equal(ha.configured(), false)
    await new Promise((res) => setTimeout(res, 10))
    assert.equal(fetched, false)
    ha.stop()
  })
})

// ---- searchEntities: the dashboard's "Add entity" box ----------------------

describe('searchEntities', () => {
  test('filters the live /api/states by id or friendly name, cached for 60s', async (t) => {
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response(JSON.stringify([
        { entity_id: 'light.basement_basement', state: 'off', attributes: { friendly_name: 'Basement' } },
        { entity_id: 'light.basement_light_switch', state: 'off', attributes: { friendly_name: 'Basement Switch' } },
        { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen' } },
      ]), { status: 200 })
    }
    const { ha } = makeHa(t, { shared: {} })
    const results = await ha.searchEntities('basement', 30)
    assert.deepEqual(results.map((r) => r.id).sort(), ['light.basement_basement', 'light.basement_light_switch'])
    assert.equal(results[0].label, 'Basement')
    assert.equal(calls, 1)
    await ha.searchEntities('kitchen', 30)
    assert.equal(calls, 1, 'answered from the 60s cache, not refetched')
  })

  test('caps at `limit`, an empty query short-circuits, an unconfigured hub fetches nothing', async (t) => {
    let called = false
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    globalThis.fetch = async () => {
      called = true
      return new Response(JSON.stringify(
        Array.from({ length: 10 }, (_, i) => ({ entity_id: `light.room_${i}`, attributes: {} })),
      ), { status: 200 })
    }
    const { ha } = makeHa(t, { shared: {} })
    assert.deepEqual(await ha.searchEntities(''), [])
    assert.equal(called, false)
    assert.equal((await ha.searchEntities('room', 3)).length, 3)

    const { ha: unconfigured } = makeHa(t, { shared: {}, url: '', getToken: () => null })
    assert.deepEqual(await unconfigured.searchEntities('room'), [])
  })

  test('a known-kind domain (light) sorts ahead of a device\'s diagnostic entities sharing the same name', async (t) => {
    // A real house: dozens of Z-Wave config/diagnostic rows can share a
    // dimmer's name with the light itself. None of that noise should be able
    // to push the actual light out of a capped result list.
    const realFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = realFetch })
    globalThis.fetch = async () => new Response(JSON.stringify([
      ...Array.from({ length: 40 }, (_, i) => ({
        entity_id: `number.basement_light_switch_diagnostic_${i}`,
        attributes: { friendly_name: `Basement Light Switch Diagnostic ${i}` },
      })),
      { entity_id: 'light.basement_basement', attributes: { friendly_name: 'Basement' } },
      { entity_id: 'light.basement_light_switch', attributes: { friendly_name: 'Basement Light Switch' } },
    ]), { status: 200 })
    const { ha } = makeHa(t, { shared: {} })
    const top10 = await ha.searchEntities('basement', 10)
    // Both lights (the only two tier-0 matches) win the first two slots; the
    // remaining eight of this capped page come from the diagnostic tier -
    // that part filling in is correct, it just must never come first.
    assert.equal(top10.length, 10)
    assert.deepEqual(top10.slice(0, 2).map((r) => r.id).sort(), ['light.basement_basement', 'light.basement_light_switch'])
    assert.ok(top10.slice(2).every((r) => r.id.startsWith('number.')))
  })
})

// ---- runAction against a real HTTP server: exact URL, headers, body -------

function startMockHa() {
  const requests = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      let body = null
      const raw = Buffer.concat(chunks).toString('utf8')
      try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
      requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolvePromise({ server, requests, url: `http://127.0.0.1:${port}` })
    })
  })
}

describe('runAction: the exact request, against a real mock HA server', () => {
  // Actions enabled by default here: this whole describe block is about
  // whitelisting, data merging and rate limiting, not the kill switch below
  // (its own describe block sets actionsEnabled explicitly on every case).
  async function haAgainstMock(t, { shared, ...opts } = {}) {
    const { server, requests, url } = await startMockHa()
    t.after(() => server.close())
    const { ha, dir } = makeHa(t, {
      shared: shared ?? { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: true } },
      url,
      getToken: () => 'secret-token',
      ...opts,
    })
    return { ha, dir, requests, url }
  }

  test('a whitelisted action posts entity_id, the token and JSON content-type, to /api/services/<domain>/<service>', async (t) => {
    const { ha, requests } = await haAgainstMock(t)
    const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.deepEqual(r, { ok: true, status: 200, error: null })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'POST')
    assert.equal(requests[0].url, '/api/services/light/turn_off')
    assert.equal(requests[0].headers.authorization, 'Bearer secret-token')
    assert.equal(requests[0].headers['content-type'], 'application/json')
    assert.deepEqual(requests[0].body, { entity_id: 'light.downstairs' })
  })

  test('data is merged only for the keys the service allows (option), everything else is dropped', async (t) => {
    const { ha, requests } = await haAgainstMock(t)
    const r = await ha.runAction('daypart-set', { screen: 'kitchen', data: { option: 'Morning', evil: 'drop-me' } })
    assert.equal(r.ok, true)
    assert.deepEqual(requests[0].body, { entity_id: 'input_select.day_part_override', option: 'Morning' })
  })

  test('an unknown action id is a 404 and never reaches the server', async (t) => {
    const { ha, requests } = await haAgainstMock(t)
    const r = await ha.runAction('not-a-real-action', { screen: 'kitchen' })
    assert.deepEqual(r, { ok: false, status: 404, error: 'unknown action' })
    assert.equal(requests.length, 0)
  })

  test('a service outside its domain\'s allowlist is a 400 and never reaches the server', async (t) => {
    const { ha, requests } = await haAgainstMock(t, {
      shared: { ha: {
        entities: SEED_ENTITIES,
        actions: [{ id: 'evil', label: 'Evil', entity: 'light.downstairs', service: 'light.explode', confirm: 'tap' }],
        actionsEnabled: true,
      } },
    })
    const r = await ha.runAction('evil', { screen: 'kitchen' })
    assert.equal(r.ok, false)
    assert.equal(r.status, 400)
    assert.equal(requests.length, 0)
  })

  test('a missing actionId is a 400 and is never logged', async (t) => {
    const { ha } = await haAgainstMock(t)
    const r = await ha.runAction(undefined, { screen: 'kitchen' })
    assert.deepEqual(r, { ok: false, status: 400, error: 'actionId required' })
    assert.equal(ha.actionsLog(10).length, 0)
  })

  test('an HA-side failure (e.g. 401) is still a 200 with ok:false, and is logged', async (t) => {
    const { server, requests: _r, url } = await startMockHa()
    server.close() // close it at once: connections to this port now fail
    await new Promise((res) => setTimeout(res, 20))
    const { ha } = makeHa(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: true } }, url, getToken: () => 'x',
    })
    const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.equal(r.ok, false)
    assert.equal(r.status, 200)
    assert.ok(r.error)
    const log = ha.actionsLog(1)
    assert.equal(log[0].action, 'downstairs-off')
    assert.equal(log[0].result.ok, false)
  })

  test('rate limit: a 13th call for one screen inside a minute is refused before it reaches the server', async (t) => {
    const { ha, requests } = await haAgainstMock(t)
    for (let i = 0; i < 12; i += 1) {
      const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
      assert.equal(r.ok, true, `call ${i}`)
    }
    assert.equal(requests.length, 12)
    const r13 = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.deepEqual(r13, { ok: false, status: 429, error: 'rate limited' })
    assert.equal(requests.length, 12, 'the 13th never reached the server')
    // A different screen has its own, unaffected budget.
    const other = await ha.runAction('downstairs-off', { screen: 'den' })
    assert.equal(other.ok, true)
  })

  test('rate limit: the overall 60/min budget blocks a fresh screen once it is spent', async (t) => {
    const { ha, requests } = await haAgainstMock(t)
    for (let s = 0; s < 5; s += 1) {
      for (let i = 0; i < 12; i += 1) {
        const r = await ha.runAction('downstairs-off', { screen: `screen-${s}` })
        assert.equal(r.ok, true, `screen ${s} call ${i}`)
      }
    }
    assert.equal(requests.length, 60)
    const r = await ha.runAction('downstairs-off', { screen: 'screen-5' })
    assert.deepEqual(r, { ok: false, status: 429, error: 'rate limited' })
    assert.equal(requests.length, 60)
  })

  test('the action log caps at 200, newest kept, actionsLog() answers newest first', async (t) => {
    const { ha, dir, requests } = await haAgainstMock(t, { enforceRateLimit: false })
    for (let i = 0; i < 205; i += 1) await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.equal(requests.length, 205)
    const full = ha.actionsLog(500)
    assert.equal(full.length, 200)
    const onDisk = JSON.parse(readFileSync(join(dir, 'ha-actions.json'), 'utf8'))
    assert.equal(onDisk.length, 200)
    // actionsLog() reverses to newest first; the file itself keeps oldest-first.
    assert.equal(full[0].time, onDisk[onDisk.length - 1].time)
    assert.equal(ha.actionsLog(5).length, 5)
  })
})

// ---- actionsEnabled: the dashboard's kill switch on runAction --------------

describe('actionsEnabled: refused before the allowlist and rate limit, before ever touching HA', () => {
  async function haWithMock(t, { shared, ...opts } = {}) {
    const { server, requests, url } = await startMockHa()
    t.after(() => server.close())
    const { ha, store } = makeHa(t, { shared, url, getToken: () => 'secret-token', ...opts })
    return { ha, store, requests }
  }

  test('off (the explicit default) refuses with 403 and never reaches the server', async (t) => {
    const { ha, requests } = await haWithMock(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: false } },
    })
    const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.deepEqual(r, { ok: false, status: 403, error: 'actions are disabled on the dashboard' })
    assert.equal(requests.length, 0)
  })

  test('an existing shared.ha with no actionsEnabled key at all reads as off, same as false', async (t) => {
    const { ha, requests } = await haWithMock(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS } }, // no actionsEnabled key
    })
    assert.equal(ha.snapshot().actionsEnabled, false)
    const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.equal(r.status, 403)
    assert.equal(requests.length, 0)
  })

  test('checked before the allowlist and the rate limit: neither refusal reason is reachable while off', async (t) => {
    // A disallowed service and a spent rate-limit budget would each refuse
    // this call on their own; with actions off, 403 wins over both.
    const { ha, requests } = await haWithMock(t, {
      shared: { ha: {
        entities: SEED_ENTITIES,
        actions: [{ id: 'evil', label: 'Evil', entity: 'light.downstairs', service: 'light.explode', confirm: 'tap' }],
        actionsEnabled: false,
      } },
    })
    const r = await ha.runAction('evil', { screen: 'kitchen' })
    assert.deepEqual(r, { ok: false, status: 403, error: 'actions are disabled on the dashboard' })
    assert.equal(requests.length, 0)
  })

  test('a refusal while off is still logged, with the entity resolved', async (t) => {
    const { ha } = await haWithMock(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: false } },
    })
    await ha.runAction('downstairs-off', { screen: 'kitchen' })
    const [entry] = ha.actionsLog(1)
    assert.equal(entry.action, 'downstairs-off')
    assert.equal(entry.screen, 'kitchen')
    assert.equal(entry.entity, 'light.downstairs')
    assert.deepEqual(entry.result, { ok: false, status: 403, error: 'actions are disabled on the dashboard' })
  })

  test('on: the call proceeds as normal and reaches the server', async (t) => {
    const { ha, requests } = await haWithMock(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: true } },
    })
    const r = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.deepEqual(r, { ok: true, status: 200, error: null })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/api/services/light/turn_off')
    const [entry] = ha.actionsLog(1)
    assert.deepEqual(entry.result, { ok: true, status: 200, error: null })
  })

  test('flipping it off between calls refuses the very next one, no restart needed', async (t) => {
    const { ha, store, requests } = await haWithMock(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: true } },
    })
    const first = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.equal(first.ok, true)
    assert.equal(requests.length, 1)
    // shared.ha is read fresh on every call (like the dashboard's own PATCH
    // path), so flipping the flag takes effect on the very next call.
    store.patch({ ha: { ...store.get().ha, actionsEnabled: false } })
    const second = await ha.runAction('downstairs-off', { screen: 'kitchen' })
    assert.deepEqual(second, { ok: false, status: 403, error: 'actions are disabled on the dashboard' })
    assert.equal(requests.length, 1, 'no second request reached the server')
  })
})

// ---- snapshot() / brief() / compact(): shape -------------------------------

describe('snapshot / brief / compact shape', () => {
  test('snapshot(): keys, defaulted kind, defaulted confirm, needs for select_option', (t) => {
    const { ha } = makeHa(t, {
      shared: { ha: {
        entities: [{ id: 'input_select.day_part_override', label: 'Day part' }], // no kind: defaulted
        actions: [{ id: 'daypart-set', label: 'Day part', entity: 'input_select.day_part_override', service: 'input_select.select_option' }], // no confirm: defaulted
      } },
      url: '', getToken: () => null,
    })
    const snap = ha.snapshot()
    assert.deepEqual(Object.keys(snap).sort(),
      ['actions', 'actionsEnabled', 'configured', 'connected', 'entities', 'error', 'fetchedAt', 'lastEventAt'].sort())
    assert.equal(snap.configured, false)
    assert.equal(snap.connected, false)
    assert.equal(snap.actionsEnabled, false, 'absent from shared.ha: reads as false')
    assert.equal(snap.entities['input_select.day_part_override'].kind, 'select')
    assert.equal(snap.entities['input_select.day_part_override'].state, null)
    assert.equal(snap.actions[0].confirm, 'tap')
    assert.deepEqual(snap.actions[0].needs, ['option'])
  })

  test('brief(): the /healthz slice', (t) => {
    const { ha } = makeHa(t, {
      shared: { ha: { entities: SEED_ENTITIES, actions: SEED_ACTIONS, actionsEnabled: true } }, url: '', getToken: () => null,
    })
    const b = ha.brief()
    assert.deepEqual(Object.keys(b).sort(), ['actionsEnabled', 'configured', 'connected', 'entities', 'error', 'lastEventAt'].sort())
    assert.equal(b.configured, false)
    assert.equal(b.entities, 13)
    assert.equal(b.actionsEnabled, true)
  })

  test('compact(): state plus only friendly_name/options/current_position of attributes', (t) => {
    const { ha } = makeHa(t, {
      shared: { ha: { entities: [{ id: 'cover.garage_door_controller', label: 'Garage', kind: 'cover' }], actions: [] } },
      url: '', getToken: () => null,
    })
    assert.deepEqual(ha.compact(), {
      connected: false,
      entities: { 'cover.garage_door_controller': { state: null, attributes: {}, lastChanged: null } },
    })
  })
})
