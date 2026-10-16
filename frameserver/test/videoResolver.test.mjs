// videoResolver.test.mjs - lib/videoResolver.mjs: Sonos track -> official video.
//
//   node --test frameserver/test/videoResolver.test.mjs
//
// No yt-dlp, no ffmpeg, no Sonos, no network. `exec` is a fake runner that
// answers the way yt-dlp does (search JSON lines from fixtures/video/, a
// googlevideo-shaped URL for -g, a file written to the -o path for a
// download); globalThis.fetch is stubbed with a /zones fixture (swapped back
// after each test). MUSIC_VIDEOS_DIR and VIDEO_LOCAL_DIR are temp dirs and the
// clock is a variable, so the 60 s demand window, the 60 s error back-off and
// the 7 day miss retry run without waiting.

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVideoResolver, parseYouTubeId, streamExpiry } from '../lib/videoResolver.mjs'
import { newEntry } from '../lib/videoIndex.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'video')
const readFix = (n) => readFileSync(join(FIX, n), 'utf8')
const DREAMS_LINES = readFix('search-dreams.jsonl').split('\n').filter(Boolean)
const KEY = 'fleetwood mac|dreams'
const NEXT_KEY = 'eagles|hotel california'
const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 16, 20, 0, 0)

const result = (id, title, channel, duration, views = 1000) => JSON.stringify({
  _type: 'url', ie_key: 'Youtube', id, url: `https://www.youtube.com/watch?v=${id}`, title, channel, uploader: channel, duration, view_count: views,
})
const EAGLES_LINES = [
  result('EaglesVid01', 'Eagles - Hotel California (Official Video) [Remastered]', 'Eagles', 391, 700_000_000),
  result('EaglesLyr02', 'Eagles - Hotel California (Lyrics)', 'Lyrics Guy', 390, 9_000_000),
]
const OTHER_DREAMS = result('OtherDream1', 'Fleetwood Mac - Dreams (Official Video) HD', 'FleetwoodMacVEVO', 258, 2_000_000)

// What yt-dlp would print for a search query.
function defaultSearch(q) {
  if (/Fleetwood Mac/i.test(q)) return DREAMS_LINES
  if (/Eagles/i.test(q)) return EAGLES_LINES
  return []
}

function zonesWith(edit = {}) {
  const zones = JSON.parse(readFix('zones-main-playing.json'))
  const st = zones[0].coordinator.state
  if (edit.track) Object.assign(st.currentTrack, edit.track)
  if (edit.next === null) st.nextTrack = { artist: '', title: '', album: '', duration: 0, uri: '' }
  else if (edit.next) Object.assign(st.nextTrack, edit.next)
  if (edit.state) st.playbackState = edit.state
  if (edit.elapsed != null) st.elapsedTime = edit.elapsed
  if ('uri' in edit) zones[0].coordinator.avTransportUri = edit.uri
  if ('meta' in edit) zones[0].coordinator.avTransportUriMetadata = edit.meta
  return zones
}

function setup(t, { shared = {}, env = {}, search = defaultSearch, downloadBytes = 1000, noThumb = false, configured = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'videoresolver-test-'))
  const nas = join(root, 'nas')
  const local = join(root, 'local')
  mkdirSync(nas, { recursive: true })
  const ctx = {
    root, nas, local, shared, clock: T0, zones: zonesWith(), zonesFail: false,
    calls: [], fetches: [], hold: null, failYtdlp: false, failMatch: null, downloadBytes, search, running: 0, maxRunning: 0,
  }
  const cmdLine = (c) => c.args.join(' ')

  ctx.exec = async (cmd, args) => {
    ctx.calls.push({ cmd, args })
    const joined = args.join(' ')
    if (cmd === 'ffmpeg-fake') {
      if (args.includes('-version')) return { code: 0, stdout: 'ffmpeg version 7', stderr: '' }
      writeFileSync(args[args.length - 1], 'jpg-from-ffmpeg')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args.includes('--version')) return { code: 0, stdout: '2026.10.01\n', stderr: '' }
    if (ctx.failYtdlp || (ctx.failMatch && joined.includes(ctx.failMatch))) {
      return { code: 1, stdout: '', stderr: 'WARNING: No supported JavaScript runtime could be found\nERROR: unable to fetch https://www.youtube.com/watch?v=secret HTTP Error 429', error: 'exit 1' }
    }
    if (!args.includes('--no-warnings') || !args.includes('--no-playlist')) throw new Error(`missing common flags: ${joined}`)
    const q = args.find((a) => a.startsWith('ytsearch8:'))
    if (q) {
      ctx.running++
      ctx.maxRunning = Math.max(ctx.maxRunning, ctx.running)
      await new Promise((r) => setImmediate(r))
      ctx.running--
      return { code: 0, stdout: `${ctx.search(q).join('\n')}\n`, stderr: 'WARNING: noise' }
    }
    const url = args[args.length - 1]
    const id = (/v=([\w-]{11})/.exec(url) || [])[1]
    if (args.includes('-g')) {
      const expire = Math.floor((ctx.clock + 6 * 60 * 60 * 1000) / 1000)
      return { code: 0, stdout: `https://rr3---sn-test.googlevideo.com/videoplayback?expire=${expire}&id=${id}&itag=136\n`, stderr: 'WARNING: noise' }
    }
    if (args.includes('--dump-json')) {
      return { code: 0, stdout: `${JSON.stringify({ id, title: `Picked ${id}`, channel: 'Chosen Channel', duration: 250, view_count: 5 })}\n`, stderr: '' }
    }
    if (args.includes('-o')) {
      if (ctx.hold) await ctx.hold
      const tpl = args[args.indexOf('-o') + 1]
      writeFileSync(tpl.replace('%(ext)s', 'mp4'), Buffer.alloc(ctx.downloadBytes, 1))
      if (!noThumb) writeFileSync(tpl.replace('%(ext)s', 'jpg'), 'jpg-from-ytdlp')
      return { code: 0, stdout: '', stderr: 'WARNING: noise' }
    }
    throw new Error(`unexpected exec ${cmd} ${joined}`)
  }
  ctx.searches = () => ctx.calls.filter((c) => c.args.some((a) => a.startsWith('ytsearch8:')))
  ctx.streamCalls = () => ctx.calls.filter((c) => c.args.includes('-g'))
  ctx.downloads = () => ctx.calls.filter((c) => c.args.includes('-o'))
  ctx.cmdLine = cmdLine

  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    const u = String(url)
    ctx.fetches.push(u)
    if (ctx.zonesFail) throw Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:5005') })
    if (u.endsWith('/zones')) return new Response(JSON.stringify(ctx.zones), { status: 200 })
    if (u.includes('/favorites/detailed')) return new Response(readFix('favorites-detailed.json'), { status: 200 })
    return new Response('{}', { status: 404 })
  }
  t.after(() => {
    globalThis.fetch = realFetch
    ctx.releaseHold?.()
    ctx.resolver?.stop()
    rmSync(root, { recursive: true, force: true })
  })

  ctx.make = (over = {}) => {
    ctx.resolver?.stop()
    ctx.resolver = createVideoResolver({
      env: configured
        ? { MUSIC_VIDEOS_DIR: nas, VIDEO_LOCAL_DIR: local, YTDLP_PATH: 'yt-dlp-fake', FFMPEG_PATH: 'ffmpeg-fake', ...env }
        : { ...env },
      root,
      getShared: () => ({ video: ctx.shared }),
      sonosUpstream: 'http://sonos.test:5005/',
      exec: ctx.exec,
      now: () => ctx.clock,
      autoPoll: false,
      ...over,
    })
    return ctx.resolver
  }
  ctx.make()
  return ctx
}

// One /now: poll, then wait for everything it started.
async function settled(ctx, room) {
  const r = ctx.resolver
  await r.now(room)
  await r.whenIdle()
  return r.now(room)
}

describe('parseYouTubeId and streamExpiry', () => {
  test('an 11-character id or any common link form', () => {
    assert.equal(parseYouTubeId('h5EofwRzit0'), 'h5EofwRzit0')
    assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=h5EofwRzit0&t=30s'), 'h5EofwRzit0')
    assert.equal(parseYouTubeId('https://youtu.be/h5EofwRzit0?si=abc'), 'h5EofwRzit0')
    assert.equal(parseYouTubeId('https://m.youtube.com/shorts/h5EofwRzit0'), 'h5EofwRzit0')
    assert.equal(parseYouTubeId('https://www.youtube.com/embed/h5EofwRzit0'), 'h5EofwRzit0')
    assert.equal(parseYouTubeId('music.youtube.com/watch?v=h5EofwRzit0'), 'h5EofwRzit0')
  })
  test('anything else is null', () => {
    assert.equal(parseYouTubeId('https://example.com/watch?v=h5EofwRzit0'), null)
    assert.equal(parseYouTubeId('short'), null)
    assert.equal(parseYouTubeId(''), null)
    assert.equal(parseYouTubeId(null), null)
    assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=tooshort'), null)
  })
  test('stream expiry: expire minus five minutes, never past five hours', () => {
    const t = 1_000_000_000_000
    assert.equal(streamExpiry(`https://x/y?expire=${(t + 6 * 3600_000) / 1000}`, t), t + 5 * 3600_000)
    assert.equal(streamExpiry(`https://x/y?expire=${(t + 3600_000) / 1000}`, t), t + 3600_000 - 300_000)
    assert.equal(streamExpiry('https://x/y', t), t + 5 * 3600_000)
    assert.equal(streamExpiry('not a url', t), t + 5 * 3600_000)
  })
})

describe('not configured', () => {
  test('answers everywhere, polls nothing, runs nothing', async (t) => {
    const ctx = setup(t, { configured: false })
    const r = ctx.resolver
    assert.deepEqual(r.start(), { configured: false, dir: null })
    const now = await r.now('Main')
    assert.equal(now.configured, false)
    assert.equal(now.track, null)
    assert.equal(now.next, null)
    assert.deepEqual(now.video, { status: 'none', reason: 'not configured' })
    assert.equal(await r.play(KEY), null)
    assert.equal(r.thumb(KEY), null)
    assert.equal((await r.wrong(KEY)).ok, false)
    assert.equal((await r.pick(KEY, 'h5EofwRzit0')).ok, false)
    assert.equal((await r.remove(KEY)).ok, false)
    const coll = await r.collection()
    assert.equal(coll.configured, false)
    assert.deepEqual(coll.entries, [])
    const h = r.health()
    assert.equal(h.configured, false)
    assert.equal(h.dir, null)
    assert.equal(h.reachable, false)
    assert.equal(h.polling, false)
    assert.deepEqual(h.queue, { resolving: 0, downloading: 0 })
    await r.whenIdle()
    assert.equal(ctx.calls.length, 0, 'no yt-dlp or ffmpeg')
    assert.equal(ctx.fetches.length, 0, 'no Sonos read')
  })
})

describe('now(): the track and the first resolve', () => {
  test('reads the playing track from /zones and goes resolving -> ready via the stream, download in the background', async (t) => {
    const ctx = setup(t)
    let release
    ctx.hold = new Promise((r) => { release = r })
    ctx.releaseHold = release
    const first = await ctx.resolver.now('Main')
    assert.equal(first.configured, true)
    assert.equal(first.room, 'Main')
    assert.equal(first.video.status, 'resolving')
    assert.deepEqual(
      { ...first.track, elapsedAt: undefined },
      {
        key: KEY, artist: 'Fleetwood Mac', title: 'Dreams (2004 Remaster)', album: 'Rumours (Super Deluxe)',
        station: 'Classic Rock Party', favoriteName: 'Classic Rock Party', favoriteAllowed: true,
        durationMs: 257_000, elapsedMs: 41_000, elapsedAt: undefined,
        albumArtUrl: 'http://192.168.4.41:1400/getaa?s=1&u=x-sonos-spotify%3aspotify%253atrack%253a0ofHAoxe9vBkTCp2UQIavz%3fsid%3d9%26flags%3d8232%26sn%3d3',
        isAd: false, playing: true,
      },
    )
    assert.equal(first.track.elapsedAt, T0)
    assert.equal(ctx.fetches[0], 'http://sonos.test:5005/zones', 'the upstream slash is trimmed')

    // The stream lands while the download is still held.
    for (let i = 0; i < 100 && (await ctx.resolver.now()).video.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 5))
    const live = await ctx.resolver.now()
    assert.equal(live.video.status, 'ready')
    assert.equal(live.video.source, 'stream')
    assert.equal(live.video.url, `/api/video/play/${encodeURIComponent(KEY)}`)
    assert.equal(live.video.videoId, 'mrZRURcb1cM')
    assert.equal(live.video.channel, 'Fleetwood Mac')
    assert.equal(live.video.videoDurationMs, 257_000)
    const p = await ctx.resolver.play(KEY)
    assert.equal(p.kind, 'stream')
    assert.match(p.url, /googlevideo\.com\/videoplayback\?expire=/)
    assert.ok(ctx.resolver.health().queue.downloading >= 1)

    release()
    await ctx.resolver.whenIdle()
    const e = ctx.resolver.index.get(KEY)
    assert.equal(e.status, 'ready')
    assert.equal(e.source, 'cache')
    assert.equal(e.videoId, 'mrZRURcb1cM')
    assert.equal(e.file, 'cache/Fleetwood Mac/Fleetwood Mac - Dreams (2004 Remaster) [mrZRURcb1cM].mp4')
    assert.equal(e.thumb, 'cache/Fleetwood Mac/Fleetwood Mac - Dreams (2004 Remaster) [mrZRURcb1cM].jpg')
    assert.equal(e.bytes, 1000)
    assert.equal(e.plays, 1)
    assert.ok(existsSync(join(ctx.nas, ...e.file.split('/'))))
    assert.equal(existsSync(join(ctx.local, 'tmp', 'mrZRURcb1cM.mp4')), false, 'scratch file moved, not copied')

    // The TV is mid-stream: the same track keeps the stream (byte offsets differ from the file).
    const same = await ctx.resolver.now()
    assert.equal(same.video.source, 'stream')
    assert.equal((await ctx.resolver.play(KEY)).kind, 'stream')
  })

  test('the yt-dlp calls: flat search, -g with the stream format, download with the merge flags', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    const search = ctx.searches()[0].args
    assert.deepEqual(search.slice(0, 4), ['--no-warnings', '--no-playlist', '--flat-playlist', '--dump-json'])
    assert.equal(search[4], 'ytsearch8:Fleetwood Mac Dreams official video')
    const stream = ctx.streamCalls()[0].args
    assert.equal(stream[stream.indexOf('-f') + 1], 'bv*[height<=720][ext=mp4][vcodec^=avc1]/b[height<=720][ext=mp4]')
    assert.equal(stream.at(-1), 'https://www.youtube.com/watch?v=mrZRURcb1cM')
    const dl = ctx.downloads()[0].args
    assert.equal(dl[dl.indexOf('--merge-output-format') + 1], 'mp4')
    assert.ok(dl.includes('--write-thumbnail'))
    assert.equal(dl[dl.indexOf('--ffmpeg-location') + 1], 'ffmpeg-fake')
    assert.ok(dl[dl.indexOf('-o') + 1].startsWith(join(ctx.local, 'tmp')))
    assert.equal(ctx.calls.every((c) => c.cmd === 'yt-dlp-fake' || c.cmd === 'ffmpeg-fake'), true)
  })

  test('the stream URL is fetched once per video id (cached until its expiry)', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    ctx.resolver.streamFailed(KEY)
    await ctx.resolver.whenIdle()
    assert.equal(ctx.streamCalls().length, 2, 'streamFailed forgets the URL and fetches a new one')
    const before = ctx.streamCalls().length
    // Back to the same song with the job still holding a good URL: no new call.
    await ctx.resolver.now()
    assert.equal(ctx.streamCalls().length, before)
  })

  test('track fields for a paused Pandora-style track; elapsed comes from Sonos', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({
      state: 'PAUSED_PLAYBACK', elapsed: 90,
      uri: 'x-sonosapi-radio:ST%3a8873310021?sid=236&flags=8300&sn=5', meta: '',
      track: { stationName: 'Daft Punk Radio (My Station)', absoluteAlbumArtUri: '', albumArtUri: '/getaa?s=1&u=abc' },
    })
    const n = await settled(ctx)
    assert.equal(n.track.playing, false)
    assert.equal(n.track.elapsedMs, 90_000)
    assert.equal(n.track.favoriteName, 'Daft Punk Radio (My Station)')
    assert.equal(n.track.station, 'Daft Punk Radio')
    assert.equal(n.track.albumArtUrl, '/api/sonos/getaa?s=1&u=abc', 'a relative art path goes through the hub\'s Sonos proxy')
    assert.notEqual(n.video.status, 'idle', 'paused still shows its video')
  })

  test('nothing playing is idle with no track', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({ state: 'STOPPED' })
    const n = await settled(ctx)
    assert.equal(n.track, null)
    assert.equal(n.video.status, 'idle')
    assert.equal(n.next, null)
    assert.equal(ctx.calls.length, 0)
  })

  test('another room, or a room not in zones, is idle with a reason', async (t) => {
    const ctx = setup(t)
    const other = await ctx.resolver.now('Kitchen')
    assert.equal(other.video.status, 'idle')
    assert.match(other.video.reason, /not followed/)
    ctx.make({ env: { MUSIC_VIDEOS_DIR: ctx.nas, VIDEO_LOCAL_DIR: ctx.local, VIDEO_ROOM: 'Garage', YTDLP_PATH: 'yt-dlp-fake' } })
    const n = await ctx.resolver.now()
    assert.equal(n.video.status, 'idle')
    assert.match(n.video.reason, /Garage/)
  })

  test('Sonos unreachable: an error status with the reason, not a throw', async (t) => {
    const ctx = setup(t)
    ctx.zonesFail = true
    await ctx.resolver.now()
    ctx.clock += 60_000
    const n = await ctx.resolver.now()
    assert.equal(n.track, null)
    assert.equal(n.video.status, 'error')
    assert.match(n.video.reason, /ECONNREFUSED/)
    ctx.zonesFail = false
    ctx.clock += 10_000
    assert.notEqual((await ctx.resolver.now()).video.status, 'error')
  })

  test('the Sonos read is reused while fresh and refreshed when stale', async (t) => {
    const ctx = setup(t)
    await ctx.resolver.now()
    await ctx.resolver.now()
    assert.equal(ctx.fetches.filter((u) => u.endsWith('/zones')).length, 1)
    ctx.clock += 10_000
    await ctx.resolver.now()
    assert.equal(ctx.fetches.filter((u) => u.endsWith('/zones')).length, 2)
  })
})

describe('cache hits, overrides, gates', () => {
  test('a second play comes from the collection: no search, no stream, a file', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    ctx.resolver.stop()
    const before = ctx.calls.length
    ctx.make() // a restarted hub: index.json on disk, nothing in memory
    ctx.clock += 5 * 60_000
    const n = await settled(ctx)
    assert.equal(n.video.status, 'ready')
    assert.equal(n.video.source, 'cache')
    assert.equal(n.video.videoId, 'mrZRURcb1cM')
    assert.match(n.video.thumbUrl, /^\/api\/video\/thumb\//)
    assert.equal(ctx.calls.length, before, 'no yt-dlp at all')
    const p = await ctx.resolver.play(KEY)
    assert.equal(p.kind, 'file')
    assert.ok(existsSync(p.path))
    assert.ok(p.path.startsWith(ctx.nas))
    assert.equal(ctx.resolver.thumb(KEY).endsWith('[mrZRURcb1cM].jpg'), true)
    assert.equal(ctx.resolver.index.get(KEY).plays, 2)
    assert.equal(ctx.resolver.index.get(KEY).lastPlayedAt, ctx.clock)
  })

  test('a cached file that vanished is fetched again', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    const e = ctx.resolver.index.get(KEY)
    ctx.resolver.stop()
    rmSync(join(ctx.nas, ...e.file.split('/')))
    ctx.make()
    await settled(ctx)
    const again = ctx.resolver.index.get(KEY)
    assert.equal(again.status, 'ready')
    assert.ok(existsSync(join(ctx.nas, ...again.file.split('/'))))
    assert.equal(ctx.searches().length, 3, 'two the first time, then the gone file searched again')
  })

  test('play() drops an entry whose file went missing and answers null', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({ state: 'STOPPED' })
    await settled(ctx)
    ctx.resolver.index.set(KEY, { ...newEntry({ key: KEY, artist: 'Fleetwood Mac', title: 'Dreams' }), status: 'ready', source: 'cache', file: 'cache/x/gone.mp4' })
    assert.equal(await ctx.resolver.play(KEY), null)
    assert.equal(ctx.resolver.index.get(KEY).status, 'none')
  })

  test('an override wins before any search and is never downloaded over', async (t) => {
    const ctx = setup(t)
    mkdirSync(join(ctx.nas, 'overrides', 'Fleetwood Mac'), { recursive: true })
    const file = join(ctx.nas, 'overrides', 'Fleetwood Mac', 'Fleetwood Mac - Dreams.mp4')
    writeFileSync(file, 'my own cut')
    ctx.zones = zonesWith({ next: null })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'ready')
    assert.equal(n.video.source, 'override')
    assert.equal(ctx.calls.length, 0)
    assert.deepEqual(await ctx.resolver.play(KEY), { kind: 'file', path: file })
    assert.equal(ctx.resolver.index.get(KEY).plays, 1)
    assert.equal((await ctx.resolver.wrong(KEY)).ok, false)
    assert.equal((await ctx.resolver.remove(KEY)).ok, false)
    assert.ok(existsSync(file))
  })

  test('a favorite set to no is denied without searching, and flips back live', async (t) => {
    const ctx = setup(t, { shared: { favorites: { 'Classic Rock Party': 'no' } } })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'denied')
    assert.equal(n.track.favoriteName, 'Classic Rock Party')
    assert.equal(n.track.favoriteAllowed, false)
    assert.equal(n.next.status, 'denied', 'the prefetch is gated too')
    assert.equal(ctx.calls.length, 0)
    ctx.shared.favorites['Classic Rock Party'] = 'yes'
    ctx.clock += 10_000
    const after = await settled(ctx)
    assert.equal(after.track.favoriteAllowed, true)
    assert.equal(after.video.status, 'ready')
  })

  test('the morning instrumental station (a Pandora favorite) is denied by name', async (t) => {
    const ctx = setup(t, { shared: { favorites: { 'Morning Instrumentals (My Station)': 'no' } } })
    ctx.zones = zonesWith({ uri: 'x-sonosapi-radio:ST%3a2349834912384?sid=236&flags=8300&sn=5', meta: '' })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'denied')
    assert.equal(n.track.station, 'Morning Instrumentals')
    assert.equal(ctx.calls.length, 0)
  })

  test('a Pandora ad is an ad: no search', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({ track: { artist: '', title: 'Advertisement', album: '', duration: 30 }, next: null })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'ad')
    assert.equal(n.track.isAd, true)
    assert.equal(ctx.calls.length, 0)
  })
})

describe('prefetch', () => {
  test('nextTrack is searched and downloaded ahead, without a stream', async (t) => {
    const ctx = setup(t)
    const n = await settled(ctx)
    assert.deepEqual({ ...n.next }, { key: NEXT_KEY, artist: 'Eagles', title: 'Hotel California (2013 Remaster)', status: 'ready' })
    const e = ctx.resolver.index.get(NEXT_KEY)
    assert.equal(e.status, 'ready')
    assert.equal(e.videoId, 'EaglesVid01')
    assert.equal(e.plays, 0, 'prefetching is not playing')
    assert.equal(ctx.streamCalls().length, 1, 'only the playing song got a stream URL')
    assert.ok(ctx.streamCalls()[0].args.at(-1).endsWith('mrZRURcb1cM'))
  })

  test('the playing song is searched before the prefetch', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    const queries = ctx.searches().map((c) => c.args.find((a) => a.startsWith('ytsearch8:')))
    assert.match(queries[0], /Fleetwood Mac/)
    assert.match(queries[1], /Eagles/)
  })

  test('when the next track plays, it is a cache hit and counts a play', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    const searches = ctx.searches().length
    ctx.zones = zonesWith({ track: { artist: 'Eagles', title: 'Hotel California (2013 Remaster)', album: 'Hotel California', duration: 391 }, next: null, elapsed: 2 })
    ctx.clock += 3 * 60_000
    const n = await settled(ctx)
    assert.equal(n.track.key, NEXT_KEY)
    assert.equal(n.video.status, 'ready')
    assert.equal(n.video.source, 'cache')
    assert.equal(ctx.searches().length, searches)
    assert.equal(ctx.resolver.index.get(NEXT_KEY).plays, 1)
    assert.equal((await ctx.resolver.play(NEXT_KEY)).kind, 'file')
  })

  test('a stream session ends with the track: replaying the song serves the file', async (t) => {
    const ctx = setup(t)
    let release
    ctx.hold = new Promise((r) => { release = r })
    ctx.releaseHold = release
    await ctx.resolver.now()
    for (let i = 0; i < 100 && (await ctx.resolver.now()).video.source !== 'stream'; i++) await new Promise((r) => setTimeout(r, 5))
    release()
    await ctx.resolver.whenIdle()
    assert.equal((await ctx.resolver.now()).video.source, 'stream')
    ctx.zones = zonesWith({ track: { artist: 'Eagles', title: 'Hotel California (2013 Remaster)', duration: 391 }, next: null })
    ctx.clock += 60_000
    await settled(ctx)
    ctx.zones = zonesWith({ next: null })
    ctx.clock += 60_000
    const back = await settled(ctx)
    assert.equal(back.video.source, 'cache')
    assert.equal((await ctx.resolver.play(KEY)).kind, 'file')
  })
})

describe('misses and failures', () => {
  test('no acceptable video: none, remembered, retried after 7 days', async (t) => {
    const ctx = setup(t, { search: () => [DREAMS_LINES[1], DREAMS_LINES[2], DREAMS_LINES[3]] })
    ctx.zones = zonesWith({ next: null })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'none')
    assert.equal(n.video.reason, 'no official video found')
    assert.equal(ctx.resolver.index.get(KEY).status, 'none')
    assert.equal(ctx.streamCalls().length, 0)
    assert.equal(ctx.downloads().length, 0)

    ctx.clock += 2 * DAY
    await settled(ctx)
    assert.equal(ctx.searches().length, 1, 'not searched again within the week')

    ctx.clock += 6 * DAY
    ctx.search = defaultSearch
    ctx.resolver.stop()
    const again = await settled(ctx)
    assert.equal(ctx.searches().length, 2, 'retried after 7 days')
    assert.equal(again.video.status, 'ready')
  })

  test('yt-dlp failing is an error status with a backoff, counted in health, scrubbed of URLs', async (t) => {
    const ctx = setup(t)
    ctx.failYtdlp = true
    ctx.zones = zonesWith({ next: null })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'error')
    assert.match(n.video.reason, /HTTP Error 429/)
    assert.doesNotMatch(n.video.reason, /youtube\.com|secret|https/)
    const h = ctx.resolver.health()
    assert.equal(h.ytdlp.consecutiveFailures, 1)
    assert.match(h.ytdlp.lastError, /429/)
    assert.equal(h.ytdlp.lastOkAt, null)
    assert.equal(ctx.resolver.index.get(KEY), null, 'a failure is not a miss')

    // Within the minute: no new attempt.
    ctx.clock += 20_000
    await settled(ctx)
    assert.equal(ctx.searches().length, 1)
    // After it: tries again, recovers, and the failure count resets.
    ctx.failYtdlp = false
    ctx.clock += 60_000
    const ok = await settled(ctx)
    assert.equal(ok.video.status, 'ready')
    const h2 = ctx.resolver.health()
    assert.equal(h2.ytdlp.consecutiveFailures, 0)
    assert.equal(h2.ytdlp.lastOkAt, ctx.clock)
  })

  test('a download that fails still leaves the stream playing', async (t) => {
    const ctx = setup(t)
    ctx.failMatch = '-o'
    ctx.zones = zonesWith({ next: null })
    const n = await settled(ctx)
    assert.equal(n.video.status, 'ready')
    assert.equal(n.video.source, 'stream')
    assert.equal(ctx.resolver.index.get(KEY), null)
    assert.equal(ctx.resolver.health().ytdlp.consecutiveFailures, 1)
  })

  test('with ffmpeg\'s help when yt-dlp leaves no thumbnail', async (t) => {
    const ctx = setup(t, { noThumb: true })
    ctx.zones = zonesWith({ next: null })
    await settled(ctx)
    const e = ctx.resolver.index.get(KEY)
    assert.ok(e.thumb)
    assert.equal(readFileSync(join(ctx.nas, ...e.thumb.split('/')), 'utf8'), 'jpg-from-ffmpeg')
  })

  test('one search at a time', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    assert.equal(ctx.searches().length, 2)
    assert.equal(ctx.maxRunning, 1)
  })
})

describe('wrong() and pick()', () => {
  const twoCandidates = () => [...DREAMS_LINES, OTHER_DREAMS]

  test('wrong denies the video, deletes its file and re-resolves to the next candidate', async (t) => {
    const ctx = setup(t, { search: (q) => (/Fleetwood/.test(q) ? twoCandidates() : EAGLES_LINES) })
    await settled(ctx)
    const first = ctx.resolver.index.get(KEY)
    assert.equal(first.videoId, 'mrZRURcb1cM')
    const firstFile = join(ctx.nas, ...first.file.split('/'))
    assert.ok(existsSync(firstFile))

    const r = await ctx.resolver.wrong(KEY)
    assert.equal(r.ok, true)
    await ctx.resolver.whenIdle()
    const e = ctx.resolver.index.get(KEY)
    assert.equal(e.videoId, 'OtherDream1')
    assert.deepEqual(e.denied, ['mrZRURcb1cM'])
    assert.equal(e.plays, 1, 'the play count survives a re-match')
    assert.equal(existsSync(firstFile), false)
    assert.ok(existsSync(join(ctx.nas, ...e.file.split('/'))))
    const n = await ctx.resolver.now()
    assert.equal(n.video.status, 'ready')
    assert.equal(n.video.videoId, 'OtherDream1')

    // Wrong again: nothing else acceptable, so a miss. The first id never comes back.
    const r2 = await ctx.resolver.wrong(KEY)
    assert.equal(r2.ok, true)
    assert.equal(r2.video.status, 'none')
    assert.deepEqual(ctx.resolver.index.get(KEY).denied, ['mrZRURcb1cM', 'OtherDream1'])
  })

  test('wrong on a song that is only streaming so far denies the candidate', async (t) => {
    const ctx = setup(t, { search: (q) => (/Fleetwood/.test(q) ? twoCandidates() : []) })
    let release
    ctx.hold = new Promise((r) => { release = r })
    ctx.releaseHold = release
    ctx.zones = zonesWith({ next: null })
    await ctx.resolver.now()
    for (let i = 0; i < 100 && (await ctx.resolver.now()).video.source !== 'stream'; i++) await new Promise((r) => setTimeout(r, 5))
    release() // the old download finishes into the void
    const r = await ctx.resolver.wrong(KEY)
    assert.equal(r.ok, true)
    await ctx.resolver.whenIdle()
    const e = ctx.resolver.index.get(KEY)
    assert.deepEqual(e.denied, ['mrZRURcb1cM'])
    assert.equal(e.videoId, 'OtherDream1')
    assert.equal(ctx.downloads().length, 2)
    const stray = ctx.resolver.index.list().filter((x) => x.videoId === 'mrZRURcb1cM')
    assert.deepEqual(stray, [], 'the cancelled download wrote nothing into the index')
  })

  test('wrong from the dashboard works on a song that is not playing', async (t) => {
    const ctx = setup(t, { search: (q) => (/Fleetwood/.test(q) ? twoCandidates() : EAGLES_LINES) })
    await settled(ctx)
    ctx.zones = zonesWith({ state: 'STOPPED' })
    ctx.clock += 5 * 60_000
    await settled(ctx)
    const r = await ctx.resolver.wrong(NEXT_KEY)
    assert.equal(r.ok, true)
    assert.equal(ctx.resolver.index.get(NEXT_KEY).status, 'none', 'Eagles has no second acceptable candidate')
    assert.deepEqual(ctx.resolver.index.get(NEXT_KEY).denied, ['EaglesVid01'])
    assert.equal((await ctx.resolver.wrong('nobody|nothing')).ok, false)
  })

  test('pick downloads that video, pinned, and forgets a past denial of it', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    await ctx.resolver.wrong(KEY)
    await ctx.resolver.whenIdle()
    assert.deepEqual(ctx.resolver.index.get(KEY).denied, ['mrZRURcb1cM'])

    const bad = await ctx.resolver.pick(KEY, 'not a link')
    assert.equal(bad.ok, false)
    const r = await ctx.resolver.pick(KEY, 'https://youtu.be/mrZRURcb1cM')
    assert.equal(r.ok, true)
    assert.equal(r.video.videoId, 'mrZRURcb1cM')
    assert.equal(r.video.videoTitle, 'Picked mrZRURcb1cM')
    await ctx.resolver.whenIdle()
    const e = ctx.resolver.index.get(KEY)
    assert.equal(e.status, 'ready')
    assert.equal(e.pinned, true)
    assert.equal(e.videoId, 'mrZRURcb1cM')
    assert.equal(e.channel, 'Chosen Channel')
    assert.deepEqual(e.denied, [])
    assert.equal(e.plays, 1)
  })

  test('pick works for a song that is not playing', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({ state: 'STOPPED' })
    await settled(ctx)
    ctx.resolver.index.markMiss('daft punk|get lucky', { artist: 'Daft Punk', title: 'Get Lucky', album: '', durationMs: 369_000 })
    const r = await ctx.resolver.pick('daft punk|get lucky', 'h5EofwRzit0')
    assert.equal(r.ok, true)
    await ctx.resolver.whenIdle()
    const e = ctx.resolver.index.get('daft punk|get lucky')
    assert.equal(e.videoId, 'h5EofwRzit0')
    assert.equal(e.pinned, true)
    assert.equal(e.file, 'cache/Daft Punk/Daft Punk - Get Lucky [h5EofwRzit0].mp4')
    assert.equal(ctx.streamCalls().length, 0, 'not playing: no stream')
  })

  test('a pinned entry is not re-searched', async (t) => {
    const ctx = setup(t)
    ctx.zones = zonesWith({ state: 'STOPPED' })
    await settled(ctx)
    await ctx.resolver.pick(KEY, 'h5EofwRzit0')
    await ctx.resolver.whenIdle()
    ctx.zones = zonesWith({ next: null })
    ctx.clock += 5 * 60_000
    const n = await settled(ctx)
    assert.equal(n.video.videoId, 'h5EofwRzit0')
    assert.equal(ctx.searches().length, 0)
  })
})

describe('collection, remove, clear, eviction', () => {
  test('collection lists entries newest play first with the totals', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    ctx.clock += 1000
    ctx.resolver.index.markPlayed(NEXT_KEY)
    const c = await ctx.resolver.collection()
    assert.equal(c.configured, true)
    assert.equal(c.count, 2)
    assert.equal(c.bytes, 2000)
    assert.equal(c.capBytes, 107_374_182_400)
    assert.deepEqual(c.entries.map((e) => e.key), [NEXT_KEY, KEY])
  })

  test('remove deletes the entry and its files; clear empties the cache', async (t) => {
    const ctx = setup(t)
    await settled(ctx)
    const e = ctx.resolver.index.get(NEXT_KEY)
    const file = join(ctx.nas, ...e.file.split('/'))
    assert.ok(existsSync(file))
    assert.deepEqual(await ctx.resolver.remove(NEXT_KEY), { ok: true })
    assert.equal(existsSync(file), false)
    assert.equal((await ctx.resolver.remove(NEXT_KEY)).ok, false)
    const cleared = await ctx.resolver.clear()
    assert.deepEqual(cleared, { ok: true, removed: 1 })
    assert.equal(ctx.resolver.index.get(KEY), null)
    assert.equal(ctx.resolver.index.totalBytes(), 0)
  })

  test('over the cap after a download: least recently played goes, what is playing stays', async (t) => {
    const ctx = setup(t, { shared: { capBytes: 2500 }, downloadBytes: 1000 })
    const old = (key, lastPlayedAt) => {
      const rel = `cache/Old/${key}.mp4`
      mkdirSync(join(ctx.nas, 'cache', 'Old'), { recursive: true })
      writeFileSync(join(ctx.nas, ...rel.split('/')), Buffer.alloc(900))
      ctx.resolver.index.set(key, { ...newEntry({ key }), status: 'ready', source: 'cache', file: rel, bytes: 900, lastPlayedAt, resolvedAt: 1 })
    }
    old('old|oldest', 10)
    old('old|newer', 20)
    ctx.zones = zonesWith({ next: null })
    await settled(ctx)
    // 900 + 900 + 1000 = 2800 > 2500: the oldest-played goes.
    assert.equal(ctx.resolver.index.get('old|oldest'), null)
    assert.ok(ctx.resolver.index.get('old|newer'))
    assert.equal(ctx.resolver.index.get(KEY).status, 'ready')
    assert.equal(existsSync(join(ctx.nas, 'cache', 'Old', 'old|oldest.mp4')), false)
    assert.ok(ctx.resolver.index.totalBytes() <= 2500)
  })

  test('pinned entries survive eviction even over the cap', async (t) => {
    const ctx = setup(t, { shared: { capBytes: 100 }, downloadBytes: 1000 })
    ctx.zones = zonesWith({ state: 'STOPPED' })
    await settled(ctx)
    await ctx.resolver.pick(KEY, 'h5EofwRzit0')
    await ctx.resolver.whenIdle()
    assert.equal(ctx.resolver.index.get(KEY).status, 'ready')
    assert.ok(ctx.resolver.index.totalBytes() > 100)
  })
})

describe('demand-driven polling and health', () => {
  test('polling starts on now() and stops itself a minute after the last call', async (t) => {
    const ctx = setup(t)
    ctx.make({ autoPoll: true, pollMs: 5 })
    assert.equal(ctx.resolver.health().polling, false)
    await ctx.resolver.now()
    assert.equal(ctx.resolver.health().polling, true)
    const reads = () => ctx.fetches.filter((u) => u.endsWith('/zones')).length
    const n0 = reads()
    await new Promise((r) => setTimeout(r, 60))
    assert.ok(reads() > n0 + 1, 'polled on its own')
    ctx.clock += 61_000
    await new Promise((r) => setTimeout(r, 40))
    const n1 = reads()
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(reads(), n1, 'idle: no more reads')
    assert.equal(ctx.resolver.health().polling, false)
    // And a new call wakes it.
    await ctx.resolver.now()
    assert.equal(ctx.resolver.health().polling, true)
    ctx.resolver.stop()
    await ctx.resolver.whenIdle()
  })

  test('start() records the yt-dlp version, finds ffmpeg, makes the layout and checks reachability', async (t) => {
    const ctx = setup(t)
    const s = ctx.resolver.start()
    assert.equal(s.configured, true)
    await ctx.resolver.whenIdle()
    const h = ctx.resolver.health()
    assert.equal(h.configured, true)
    assert.equal(h.dir, ctx.nas)
    assert.equal(h.reachable, true)
    assert.equal(h.ytdlp.version, '2026.10.01')
    assert.equal(h.ytdlp.path, 'yt-dlp-fake')
    assert.equal(h.ffmpeg.found, true)
    assert.equal(h.ffmpeg.path, 'ffmpeg-fake')
    assert.deepEqual(h.cache, { bytes: 0, capBytes: 107_374_182_400, count: 0 })
    assert.deepEqual(h.queue, { resolving: 0, downloading: 0 })
    assert.ok(existsSync(join(ctx.nas, 'cache')))
    assert.ok(existsSync(join(ctx.nas, 'overrides')))
    assert.ok(existsSync(join(ctx.nas, 'README.txt')))
    assert.equal(ctx.fetches.length, 0, 'start() alone does not poll Sonos')
  })

  test('a missing folder is unreachable, a missing yt-dlp has no version', async (t) => {
    const ctx = setup(t)
    writeFileSync(join(ctx.root, 'afile'), 'x')
    const missing = join(ctx.root, 'afile', 'Music Videos TV') // can be neither read nor created
    ctx.exec = async () => ({ code: null, stdout: '', stderr: '', error: 'not found' })
    ctx.make({ exec: ctx.exec, env: { MUSIC_VIDEOS_DIR: missing, VIDEO_LOCAL_DIR: ctx.local } })
    await ctx.resolver.probe()
    await ctx.resolver.start()
    await ctx.resolver.whenIdle()
    const h = ctx.resolver.health()
    assert.equal(h.reachable, false)
    assert.equal(h.ytdlp.version, null)
    assert.equal(h.ytdlp.lastError, 'not found')
    assert.equal(h.ffmpeg.found, false)
    assert.equal(h.configured, true)
  })

  test('the cap comes from shared settings', async (t) => {
    const ctx = setup(t, { shared: { capBytes: 5_000_000 } })
    assert.equal(ctx.resolver.health().cache.capBytes, 5_000_000)
    assert.equal((await ctx.resolver.collection()).capBytes, 5_000_000)
  })

  test('nothing in the health body carries a command line or a URL', async (t) => {
    const ctx = setup(t)
    ctx.failYtdlp = true
    ctx.zones = zonesWith({ next: null })
    await settled(ctx)
    const body = JSON.stringify(ctx.resolver.health())
    assert.doesNotMatch(body, /https?:|--no-warnings|ytsearch/)
  })
})
