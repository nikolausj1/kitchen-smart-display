// videoIndex.test.mjs - lib/videoIndex.mjs: the Music Videos collection index.
//
//   node --test frameserver/test/videoIndex.test.mjs
//
// Real files in temp dirs: `nas` stands in for MUSIC_VIDEOS_DIR, `local` for
// VIDEO_LOCAL_DIR. A NAS failure is made by replacing the NAS folder with a
// plain file, so every write into it fails.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVideoIndex, newEntry } from '../lib/videoIndex.mjs'

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'videoindex-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const nas = join(root, 'nas')
  const local = join(root, 'local')
  mkdirSync(nas, { recursive: true })
  let clock = 1_000_000
  const index = createVideoIndex({ dir: nas, localDir: local, now: () => clock })
  return { root, nas, local, index, tick: (ms = 1000) => (clock += ms), clock: () => clock }
}

const info = { artist: 'Fleetwood Mac', title: 'Dreams', album: 'Rumours', durationMs: 257_000 }
const KEY = 'fleetwood mac|dreams'

// A ready cache entry whose files exist in the NAS folder.
function addCached(s, key, { bytes = 100, lastPlayedAt = null, resolvedAt = 1, pinned = false, name } = {}) {
  const rel = `cache/A/${name || key.replace(/\W/g, '_')}.mp4`
  mkdirSync(join(s.nas, 'cache', 'A'), { recursive: true })
  writeFileSync(join(s.nas, ...rel.split('/')), Buffer.alloc(bytes))
  writeFileSync(join(s.nas, ...rel.replace('.mp4', '.jpg').split('/')), 'jpg')
  return s.index.set(key, {
    ...newEntry({ key, artist: 'A', title: key }),
    status: 'ready', source: 'cache', videoId: 'abcdefghijk', file: rel, thumb: rel.replace('.mp4', '.jpg'),
    bytes, lastPlayedAt, resolvedAt, pinned,
  })
}

describe('ensureLayout', () => {
  test('makes cache/ and overrides/, writes README.txt once, and the local scratch dir', async (t) => {
    const s = setup(t)
    assert.deepEqual(await s.index.ensureLayout(), { ok: true, error: null })
    assert.ok(existsSync(join(s.nas, 'cache')))
    assert.ok(existsSync(join(s.nas, 'overrides')))
    assert.ok(existsSync(join(s.local, 'tmp')))
    const readme = readFileSync(join(s.nas, 'README.txt'), 'utf8')
    assert.match(readme, /Artist - Title\.mp4/)
    // A hand-edited README is not overwritten.
    writeFileSync(join(s.nas, 'README.txt'), 'mine')
    await s.index.ensureLayout()
    assert.equal(readFileSync(join(s.nas, 'README.txt'), 'utf8'), 'mine')
  })

  test('an unreachable folder is reported, not thrown', async (t) => {
    const s = setup(t)
    rmSync(s.nas, { recursive: true })
    writeFileSync(s.nas, 'a file where the folder should be')
    const r = await s.index.ensureLayout()
    assert.equal(r.ok, false)
    assert.ok(r.error)
  })
})

describe('entries', () => {
  test('set / get / update / list, with the full shape filled in', (t) => {
    const s = setup(t)
    s.index.set(KEY, { ...newEntry({ key: KEY, ...info }), status: 'ready', source: 'cache', bytes: 5 })
    const e = s.index.get(KEY)
    assert.equal(e.plays, 0)
    assert.deepEqual(e.denied, [])
    assert.equal(e.pinned, false)
    assert.equal(e.thumb, null)
    s.index.update(KEY, { channel: 'Fleetwood Mac' })
    assert.equal(s.index.get(KEY).channel, 'Fleetwood Mac')
    assert.equal(s.index.get(KEY).bytes, 5)
    assert.equal(s.index.list().length, 1)
    assert.equal(s.index.get('nope'), null)
    assert.equal(s.index.update('nope', { plays: 1 }), null)
  })

  test('markPlayed counts and stamps', (t) => {
    const s = setup(t)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    s.tick()
    s.index.markPlayed(KEY)
    s.index.markPlayed(KEY)
    assert.equal(s.index.get(KEY).plays, 2)
    assert.equal(s.index.get(KEY).lastPlayedAt, s.clock())
    assert.equal(s.index.markPlayed('nope'), null)
  })

  test('markMiss makes a none entry, keeping plays and the deny list', (t) => {
    const s = setup(t)
    addCached(s, KEY)
    s.index.deny(KEY, 'badbadbad00')
    s.index.markPlayed(KEY)
    s.tick()
    const e = s.index.markMiss(KEY)
    assert.equal(e.status, 'none')
    assert.equal(e.source, null)
    assert.equal(e.file, null)
    assert.equal(e.bytes, 0)
    assert.equal(e.missAt, s.clock())
    assert.deepEqual(e.denied, ['badbadbad00'])
    assert.equal(e.plays, 1)
  })

  test('markMiss creates the entry from info when the song is new', (t) => {
    const s = setup(t)
    const e = s.index.markMiss(KEY, info)
    assert.equal(e.artist, 'Fleetwood Mac')
    assert.equal(e.status, 'none')
    assert.ok(e.missAt)
  })

  test('deny remembers an id once, creating the entry if need be', (t) => {
    const s = setup(t)
    assert.equal(s.index.deny(KEY, 'abc'), null)
    s.index.deny(KEY, 'abc', info)
    s.index.deny(KEY, 'abc')
    s.index.deny(KEY, 'def')
    assert.deepEqual(s.index.get(KEY).denied, ['abc', 'def'])
  })

  test('remove deletes the entry and a cache entry\'s files, only under cache/', async (t) => {
    const s = setup(t)
    const e = addCached(s, KEY)
    const gone = await s.index.remove(KEY)
    assert.equal(gone.key, KEY)
    assert.equal(s.index.get(KEY), null)
    assert.equal(existsSync(join(s.nas, ...e.file.split('/'))), false)
    assert.equal(existsSync(join(s.nas, ...e.thumb.split('/'))), false)
    assert.equal(await s.index.remove(KEY), null)
  })

  test('remove never touches a file outside cache/ (hand-edited index, override)', async (t) => {
    const s = setup(t)
    writeFileSync(join(s.nas, 'precious.txt'), 'keep')
    s.index.set('a|b', { ...newEntry({ key: 'a|b' }), status: 'ready', source: 'cache', file: 'precious.txt', thumb: '../outside.jpg' })
    await s.index.remove('a|b')
    assert.ok(existsSync(join(s.nas, 'precious.txt')))
    mkdirSync(join(s.nas, 'overrides'), { recursive: true })
    writeFileSync(join(s.nas, 'overrides', 'A - B.mp4'), 'x')
    s.index.set('c|d', { ...newEntry({ key: 'c|d' }), status: 'ready', source: 'override', file: 'overrides/A - B.mp4' })
    await s.index.remove('c|d')
    assert.ok(existsSync(join(s.nas, 'overrides', 'A - B.mp4')))
  })

  test('absPath refuses a path that leaves the folder', (t) => {
    const s = setup(t)
    assert.ok(s.index.absPath('cache/A/x.mp4').startsWith(s.nas))
    assert.equal(s.index.absPath('../x'), null)
    assert.equal(s.index.absPath('cache/../../x'), null)
    assert.equal(s.index.absPath(''), null)
  })
})

describe('persistence: local copy wins, NAS copy is write-through', () => {
  test('every mutation writes both copies', async (t) => {
    const s = setup(t)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    await s.index.flush()
    const local = JSON.parse(readFileSync(join(s.local, 'index.json'), 'utf8'))
    const nas = JSON.parse(readFileSync(join(s.nas, 'index.json'), 'utf8'))
    assert.equal(local.version, 1)
    assert.ok(local.entries[KEY])
    assert.deepEqual(nas, local)
    assert.equal(s.index.lastWriteError, null)
    assert.equal(existsSync(join(s.nas, 'index.json.tmp')), false)
  })

  test('load reads the local copy', async (t) => {
    const s = setup(t)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    await s.index.flush()
    const again = createVideoIndex({ dir: s.nas, localDir: s.local })
    assert.equal(await again.load(), 1)
    assert.equal(again.get(KEY).title, 'Dreams')
  })

  test('the local copy beats a different NAS copy', async (t) => {
    const s = setup(t)
    s.index.set(KEY, { ...newEntry({ key: KEY, ...info }), videoTitle: 'local' })
    await s.index.flush()
    const nas = JSON.parse(readFileSync(join(s.nas, 'index.json'), 'utf8'))
    nas.entries[KEY].videoTitle = 'nas'
    writeFileSync(join(s.nas, 'index.json'), JSON.stringify(nas))
    const again = createVideoIndex({ dir: s.nas, localDir: s.local })
    await again.load()
    assert.equal(again.get(KEY).videoTitle, 'local')
  })

  test('the NAS copy is read when the local one is missing, and copied down', async (t) => {
    const s = setup(t)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    await s.index.flush()
    rmSync(s.local, { recursive: true })
    const again = createVideoIndex({ dir: s.nas, localDir: s.local })
    assert.equal(await again.load(), 1)
    assert.ok(existsSync(join(s.local, 'index.json')))
  })

  test('neither copy: empty, no throw; a corrupt local copy falls back to the NAS one', async (t) => {
    const s = setup(t)
    assert.equal(await s.index.load(), 0)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    await s.index.flush()
    writeFileSync(join(s.local, 'index.json'), '{ not json')
    const again = createVideoIndex({ dir: s.nas, localDir: s.local })
    assert.equal(await again.load(), 1)
  })

  test('a NAS failure is recorded, never thrown, and the local copy still lands', async (t) => {
    const s = setup(t)
    rmSync(s.nas, { recursive: true })
    writeFileSync(s.nas, 'not a folder')
    assert.doesNotThrow(() => s.index.set(KEY, newEntry({ key: KEY, ...info })))
    await s.index.flush()
    assert.ok(s.index.lastWriteError)
    assert.ok(JSON.parse(readFileSync(join(s.local, 'index.json'), 'utf8')).entries[KEY])
    // The share comes back: the next change clears the error.
    rmSync(s.nas)
    mkdirSync(s.nas)
    s.index.update(KEY, { plays: 1 })
    await s.index.flush()
    assert.equal(s.index.lastWriteError, null)
    assert.equal(JSON.parse(readFileSync(join(s.nas, 'index.json'), 'utf8')).entries[KEY].plays, 1)
  })

  test('a burst of changes is coalesced but the last one always lands', async (t) => {
    const s = setup(t)
    s.index.set(KEY, newEntry({ key: KEY, ...info }))
    for (let i = 0; i < 20; i++) s.index.markPlayed(KEY)
    await s.index.flush()
    assert.equal(JSON.parse(readFileSync(join(s.nas, 'index.json'), 'utf8')).entries[KEY].plays, 20)
  })

  test('without a NAS folder it is local only', async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'videoindex-local-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const index = createVideoIndex({ dir: null, localDir: join(root, 'local') })
    index.set(KEY, newEntry({ key: KEY }))
    await index.flush()
    assert.equal(index.lastWriteError, null)
    assert.ok(existsSync(join(root, 'local', 'index.json')))
  })
})

describe('totalBytes and evictToCap', () => {
  test('totalBytes counts ready cache entries only', (t) => {
    const s = setup(t)
    addCached(s, 'a|1', { bytes: 100 })
    addCached(s, 'a|2', { bytes: 50 })
    s.index.markMiss('a|3', info)
    s.index.set('a|4', { ...newEntry({ key: 'a|4' }), status: 'ready', source: 'override', bytes: 9999, file: 'overrides/x.mp4' })
    assert.equal(s.index.totalBytes(), 150)
    assert.equal(s.index.cacheCount(), 2)
  })

  test('evicts the least recently played first until under the cap, deleting the files', async (t) => {
    const s = setup(t)
    const old = addCached(s, 'a|old', { bytes: 100, lastPlayedAt: 10 })
    addCached(s, 'a|mid', { bytes: 100, lastPlayedAt: 20 })
    addCached(s, 'a|new', { bytes: 100, lastPlayedAt: 30 })
    const removed = await s.index.evictToCap(250)
    assert.deepEqual(removed.map((e) => e.key), ['a|old'])
    assert.equal(s.index.totalBytes(), 200)
    assert.equal(existsSync(join(s.nas, ...old.file.split('/'))), false)
    const more = await s.index.evictToCap(100)
    assert.deepEqual(more.map((e) => e.key), ['a|mid'])
    assert.equal(s.index.get('a|new').status, 'ready')
  })

  test('a never-played entry counts from when it was fetched, not as the oldest', async (t) => {
    const s = setup(t)
    addCached(s, 'a|played-long-ago', { bytes: 100, lastPlayedAt: 5, resolvedAt: 1 })
    addCached(s, 'a|fresh-prefetch', { bytes: 100, lastPlayedAt: null, resolvedAt: 900 })
    const removed = await s.index.evictToCap(100)
    assert.deepEqual(removed.map((e) => e.key), ['a|played-long-ago'])
  })

  test('never evicts pinned entries, overrides, or protected keys', async (t) => {
    const s = setup(t)
    addCached(s, 'a|pinned', { bytes: 100, lastPlayedAt: 1, pinned: true })
    addCached(s, 'a|playing', { bytes: 100, lastPlayedAt: 2 })
    addCached(s, 'a|spare', { bytes: 100, lastPlayedAt: 3 })
    s.index.set('a|ovr', { ...newEntry({ key: 'a|ovr' }), status: 'ready', source: 'override', bytes: 10_000, file: 'overrides/x.mp4' })
    const removed = await s.index.evictToCap(0, { protect: new Set(['a|playing']) })
    assert.deepEqual(removed.map((e) => e.key), ['a|spare'])
    assert.ok(s.index.get('a|pinned'))
    assert.ok(s.index.get('a|playing'))
    assert.ok(s.index.get('a|ovr'))
  })

  test('under the cap removes nothing', async (t) => {
    const s = setup(t)
    addCached(s, 'a|1', { bytes: 100 })
    assert.deepEqual(await s.index.evictToCap(100), [])
    assert.deepEqual(await s.index.evictToCap(1_000_000), [])
  })
})

describe('overrides', () => {
  function writeOverride(s, rel, bytes = 7) {
    const full = join(s.nas, 'overrides', ...rel.split('/'))
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, Buffer.alloc(bytes))
  }

  test('scanOverrides keys flat and nested files by "Artist - Title", .mp4 .mov .m4v only', async (t) => {
    const s = setup(t)
    writeOverride(s, 'Fleetwood Mac - Dreams.mp4')
    writeOverride(s, 'Daft Punk/Daft Punk - Get Lucky (feat. Pharrell).mov')
    writeOverride(s, 'deep/er/Beyoncé - Halo.m4v')
    writeOverride(s, 'notes.txt')
    writeOverride(s, 'No Dash Here.mp4')
    writeOverride(s, 'Thumbs.db')
    const found = await s.index.scanOverrides()
    assert.deepEqual(found.map((e) => e.key).sort(), ['beyonce|halo', 'daft punk|get lucky', 'fleetwood mac|dreams'])
    const dreams = found.find((e) => e.key === 'fleetwood mac|dreams')
    assert.equal(dreams.source, 'override')
    assert.equal(dreams.status, 'ready')
    assert.equal(dreams.file, 'overrides/Fleetwood Mac - Dreams.mp4')
    assert.equal(dreams.bytes, 7)
    assert.equal(dreams.artist, 'Fleetwood Mac')
    assert.equal(dreams.title, 'Dreams')
    const halo = found.find((e) => e.key === 'beyonce|halo')
    assert.equal(halo.file, 'overrides/deep/er/Beyoncé - Halo.m4v')
  })

  test('scanOverrides throws when the folder is unreadable (empty is not the same)', async (t) => {
    const s = setup(t)
    await assert.rejects(s.index.scanOverrides())
    mkdirSync(join(s.nas, 'overrides'))
    assert.deepEqual(await s.index.scanOverrides(), [])
  })

  test('syncOverrides adds new files and drops entries whose file vanished, keeping plays', async (t) => {
    const s = setup(t)
    writeOverride(s, 'Fleetwood Mac - Dreams.mp4')
    assert.deepEqual(await s.index.syncOverrides(), { added: 1, removed: 0, replaced: 0, error: null })
    s.index.markPlayed(KEY)
    // Unchanged: nothing happens, plays survive.
    assert.deepEqual(await s.index.syncOverrides(), { added: 0, removed: 0, replaced: 0, error: null })
    assert.equal(s.index.get(KEY).plays, 1)
    rmSync(join(s.nas, 'overrides', 'Fleetwood Mac - Dreams.mp4'))
    assert.deepEqual(await s.index.syncOverrides(), { added: 0, removed: 1, replaced: 0, error: null })
    assert.equal(s.index.get(KEY), null)
  })

  test('an override replaces a cached copy of the same song and its files', async (t) => {
    const s = setup(t)
    const cached = addCached(s, KEY, { bytes: 500 })
    s.index.deny(KEY, 'badbadbad00')
    s.index.markPlayed(KEY)
    writeOverride(s, 'Fleetwood Mac - Dreams.mp4')
    const r = await s.index.syncOverrides()
    assert.equal(r.replaced, 1)
    const e = s.index.get(KEY)
    assert.equal(e.source, 'override')
    assert.equal(e.plays, 1)
    assert.deepEqual(e.denied, ['badbadbad00'])
    assert.equal(existsSync(join(s.nas, ...cached.file.split('/'))), false)
    assert.equal(s.index.totalBytes(), 0)
  })

  test('an unreadable overrides folder removes nothing', async (t) => {
    const s = setup(t)
    s.index.set(KEY, { ...newEntry({ key: KEY }), status: 'ready', source: 'override', file: 'overrides/x.mp4' })
    const r = await s.index.syncOverrides()
    assert.ok(r.error)
    assert.ok(s.index.get(KEY))
  })
})

describe('clearCache and place', () => {
  test('clearCache removes cache entries and files, keeps overrides, README and deny lists', async (t) => {
    const s = setup(t)
    await s.index.ensureLayout()
    const keep = addCached(s, 'a|denied', { bytes: 10 })
    s.index.deny('a|denied', 'badbadbad00')
    addCached(s, 'a|plain', { bytes: 10 })
    s.index.markMiss('a|miss', info)
    writeFileSync(join(s.nas, 'overrides', 'A - B.mp4'), 'x')
    s.index.set('a|b', { ...newEntry({ key: 'a|b' }), status: 'ready', source: 'override', file: 'overrides/A - B.mp4' })
    const n = await s.index.clearCache()
    assert.equal(n, 2)
    assert.equal(existsSync(join(s.nas, ...keep.file.split('/'))), false)
    assert.ok(existsSync(join(s.nas, 'cache')))
    assert.ok(existsSync(join(s.nas, 'README.txt')))
    assert.ok(existsSync(join(s.nas, 'overrides', 'A - B.mp4')))
    assert.equal(s.index.get('a|plain'), null)
    assert.equal(s.index.get('a|miss'), null)
    assert.equal(s.index.get('a|denied').status, 'none')
    assert.deepEqual(s.index.get('a|denied').denied, ['badbadbad00'])
    assert.equal(s.index.get('a|b').source, 'override')
  })

  test('place copies into the folder via .part and removes the source', async (t) => {
    const s = setup(t)
    const src = join(s.root, 'dl.mp4')
    writeFileSync(src, 'video bytes')
    const dest = await s.index.place(src, 'cache/Fleetwood Mac/Fleetwood Mac - Dreams [abc].mp4')
    assert.equal(readFileSync(dest, 'utf8'), 'video bytes')
    assert.equal(existsSync(`${dest}.part`), false)
    assert.equal(existsSync(src), false)
    await assert.rejects(s.index.place(src, '../escape.mp4'))
  })
})
