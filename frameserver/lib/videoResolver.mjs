// videoResolver.mjs - Music Videos: which official video goes with the song
// Sonos is playing, and how the Apple TV gets it.
//
// The living-room TV (docs/designs/music-videos.md) shows the video for the
// current Sonos track, muted. This module is the hub half: it watches Sonos,
// matches each song to a YouTube upload with yt-dlp, streams it at once and
// saves it to the NAS collection for next time. lib/videoMatch.mjs holds the
// pure rules (keys, scoring), lib/videoIndex.mjs the collection on disk.
//
// Configuration (environment, lib/env.mjs; the factory takes `env`):
//   MUSIC_VIDEOS_DIR     the collection folder. Unset = not configured: every
//                        call answers (video.status "none", reason "not
//                        configured") and nothing polls or runs.
//   YTDLP_PATH, FFMPEG_PATH     default "yt-dlp", "ffmpeg"
//   VIDEO_ROOM           the Sonos room the TV follows, default "Main"
//   VIDEO_STREAM_FORMAT, VIDEO_DOWNLOAD_FORMAT   yt-dlp -f selectors
//   VIDEO_LOCAL_DIR      the hub's own index copy and download scratch dir,
//                        default <root>/data/video
// Shared settings (getShared().video): { capBytes, favorites: { name: 'yes'|'no' } }.
//
// Demand-driven. Nothing polls until a screen asks: now() is the demand
// signal. While it has been called in the last 60 s the hub reads Sonos
// /zones every 2 s (through SONOS_UPSTREAM, like the /api/sonos proxy), else
// it is idle. Each track change then goes through
//
//   override file -> cache file -> yt-dlp search (ytsearch8, flat) -> score
//   -> live stream URL (yt-dlp -g) AND, in parallel, a download into the
//   collection (yt-dlp merge to mp4, a jpg thumbnail) -> entry ready
//
// and the next track (Sonos nextTrack, when it reports one) is searched and
// downloaded ahead, without a stream. Work is single-flight per song; one
// search, one stream resolve and one download run at a time, the playing
// song's ahead of the prefetch's. A search that finds nothing acceptable is a
// "none" entry, retried after 7 days or on wrong() / pick().
//
// A stream session sticks to the stream: byte offsets differ between the live
// DASH stream and the merged download, so once /now has handed the TV the
// stream for a song, play() keeps serving it until the track changes (then a
// replay comes from the file).
//
// Public API (all safe unconfigured):
//   start() stop()                    timers and background checks
//   now(room) -> /api/video/now body  async: refreshes a stale Sonos read
//   play(key) -> { kind: 'file', path } | { kind: 'stream', url, videoId } | null
//   thumb(key) -> absolute jpg path | null
//   streamFailed(key)                 the upstream refused: fetch a new URL
//   wrong(key) pick(key, urlOrId) remove(key) clear()   -> { ok, ... }
//   collection() health() probe() whenIdle()
//
// yt-dlp is judged by exit code alone (it warns on stderr every call); stdout
// is what is parsed, and the last stderr line is kept for health.lastError on
// a failure. Command lines are never logged or returned (no tokens leak), and
// URLs are scrubbed from error text.

import { execFile } from 'node:child_process'
import { access, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createVideoIndex, newEntry } from './videoIndex.mjs'
import {
  MISS_RETRY_MS, cacheFileName, cleanStationName, dcTitle, favoriteAllowed, favoriteFor, isAdTrack,
  pickCandidate, searchTerms, songKey,
} from './videoMatch.mjs'

export const DEFAULT_STREAM_FORMAT = 'bv*[height<=720][ext=mp4][vcodec^=avc1]/b[height<=720][ext=mp4]'
export const DEFAULT_DOWNLOAD_FORMAT = 'bv*[height<=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/b'
export const DEFAULT_CAP_BYTES = 107_374_182_400
export const DEMAND_MS = 60_000
export const POLL_MS = 2_000
const ERROR_BACKOFF_MS = 60_000
const OVERRIDE_SCAN_MS = 60_000
const FAVORITES_REFRESH_MS = 10 * 60_000
const FAVORITES_RETRY_MS = 60_000
const STREAM_TTL_MS = 5 * 60 * 60_000
const STREAM_EXPIRY_MARGIN_MS = 5 * 60_000
const SONOS_TIMEOUT_MS = 5_000
const SEARCH_TIMEOUT_MS = 60_000
const STREAM_TIMEOUT_MS = 45_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const FFMPEG_TIMEOUT_MS = 30_000
const VERSION_TIMEOUT_MS = 15_000
const VERSION_CHECK_MS = 24 * 60 * 60_000
const REACHABLE_MS = 15_000
const REACHABLE_TIMEOUT_MS = 3_000
const WRONG_WAIT_MS = 8_000
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'webm', 'mkv']
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/

// --- small helpers --------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.())
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const errMsg = (e) => String((e && e.message) || e)

// The last meaningful stderr line, URLs scrubbed, at most 200 characters.
function lastLine(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const line = [...lines].reverse().find((l) => /^ERROR/i.test(l)) ?? lines[lines.length - 1] ?? ''
  return line.replace(/https?:\/\/\S+/g, '<url>').slice(0, 200)
}

// A YouTube video id from an 11-character id or any common link form.
export function parseYouTubeId(input) {
  const s = str(input)
  if (YT_ID_RE.test(s)) return s
  let u
  try {
    u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./i, '').toLowerCase()
  let id = null
  if (host === 'youtu.be') id = u.pathname.split('/')[1]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v')
    if (!id) {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
      id = m ? m[1] : null
    }
  }
  return id && YT_ID_RE.test(id) ? id : null
}

// When a googlevideo URL stops working: its expire= (unix seconds) less five
// minutes, but never later than five hours from now.
export function streamExpiry(url, nowMs) {
  let at = nowMs + STREAM_TTL_MS
  try {
    const expire = Number(new URL(url).searchParams.get('expire'))
    if (Number.isFinite(expire) && expire > 0) at = Math.min(at, expire * 1000 - STREAM_EXPIRY_MARGIN_MS)
  } catch { /* keep the five hours */ }
  return at
}

// node:child_process execFile with a timeout and a big buffer. Never rejects:
// { code, stdout, stderr, error }. (err.message holds the whole command line,
// so only codes and the stderr tail are ever kept.)
export function defaultExec(cmd, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr })
      resolve({
        code: typeof err.code === 'number' ? err.code : null,
        stdout: stdout || '',
        stderr: stderr || '',
        error: err.killed ? 'timed out' : err.code === 'ENOENT' ? 'not found' : `exit ${err.code ?? '?'}`,
      })
    })
  })
}

// A FIFO of async tasks run `size` at a time (always 1 here), lower priority
// numbers first. 0 = the song playing, 1 = the prefetch.
function createLane() {
  const queue = []
  let running = 0
  let seq = 0
  function pump() {
    if (running >= 1 || !queue.length) return
    queue.sort((a, b) => a.priority - b.priority || a.seq - b.seq)
    const t = queue.shift()
    running++
    t.fn().then(t.resolve, t.reject).finally(() => {
      running--
      pump()
    })
  }
  return {
    run(fn, priority = 1) {
      return new Promise((resolve, reject) => {
        queue.push({ fn, priority, seq: ++seq, resolve, reject })
        pump()
      })
    },
    get size() { return queue.length + running },
  }
}

// --- the resolver -----------------------------------------------------------------

export function createVideoResolver({
  env = process.env,
  root = process.cwd(),
  getShared = () => ({}),
  sonosUpstream = 'http://127.0.0.1:5005',
  exec = defaultExec,
  now = () => Date.now(),
  pollMs = POLL_MS,
  autoPoll = true,
  log = () => {},
} = {}) {
  const dir = str(env.MUSIC_VIDEOS_DIR) || null
  const configured = !!dir
  const cfg = {
    ytdlp: str(env.YTDLP_PATH) || 'yt-dlp',
    ffmpeg: str(env.FFMPEG_PATH) || 'ffmpeg',
    room: str(env.VIDEO_ROOM) || 'Main',
    streamFormat: str(env.VIDEO_STREAM_FORMAT) || DEFAULT_STREAM_FORMAT,
    downloadFormat: str(env.VIDEO_DOWNLOAD_FORMAT) || DEFAULT_DOWNLOAD_FORMAT,
    localDir: str(env.VIDEO_LOCAL_DIR) || join(root, 'data', 'video'),
  }
  const upstream = String(sonosUpstream).replace(/\/+$/, '')
  const index = configured ? createVideoIndex({ dir, localDir: cfg.localDir, now }) : null

  const searchLane = createLane()
  const streamLane = createLane()
  const downloadLane = createLane()

  const known = new Map() // key -> { artist, title, album, durationMs }
  const jobs = new Map() // key -> job
  const streams = new Map() // videoId -> { url, expiresAt }
  const verified = new Set() // keys whose cache file was seen on disk this run
  const sticky = new Set() // keys whose stream was handed to the TV
  const bg = new Set() // background promises (layout, checks) for whenIdle()
  let initP = null
  let started = false
  let stopped = false
  let lastDemandAt = 0
  let pollTimer = null
  let pollP = null
  let zone = null // { at, cur, next, playbackState, elapsedMs, roomFound }
  let zoneError = null // { msg, count }
  let curKey = null
  let nextKey = null
  let curPlay = null // { key, counted }
  let favorites = { list: [], at: 0, failedAt: 0 }
  let overridesAt = 0
  let overridesP = null
  let reachable = null
  let reachableAt = 0
  let probeP = null
  let ffmpegFound = null
  let versionTimer = null
  let probeTimer = null
  const yt = { version: null, lastOkAt: null, lastError: null, consecutiveFailures: 0 }

  const capBytes = () => {
    const v = getShared()?.video?.capBytes
    return typeof v === 'number' && v > 0 ? v : DEFAULT_CAP_BYTES
  }
  const sharedVideo = () => getShared()?.video
  const playUrl = (key) => `/api/video/play/${encodeURIComponent(key)}`
  const thumbUrl = (key) => `/api/video/thumb/${encodeURIComponent(key)}`
  const lite = (i) => ({ artist: i.artist || '', title: i.title || '', album: i.album || '', durationMs: i.durationMs || 0 })
  const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`
  const load = () => (initP ??= index.load())
  const background = (p) => {
    bg.add(p)
    p.catch(() => {}).finally(() => bg.delete(p))
    return p
  }

  // --- running yt-dlp and ffmpeg ---------------------------------------------------

  function noteOk() {
    yt.lastOkAt = now()
    yt.consecutiveFailures = 0
  }

  function noteFail(msg) {
    yt.consecutiveFailures++
    yt.lastError = msg
    log(`[video] yt-dlp failed (${yt.consecutiveFailures} in a row): ${msg}`)
  }

  // yt-dlp with the flags every call carries. Resolves stdout; throws on a
  // non-zero exit. Exit code alone decides: stderr is warning noise.
  async function ytdlp(args, { timeoutMs }) {
    let r
    try {
      r = await exec(cfg.ytdlp, ['--no-warnings', '--no-playlist', ...args], { timeoutMs })
    } catch (e) {
      r = { code: null, stdout: '', stderr: '', error: errMsg(e) }
    }
    if (r && r.code === 0) {
      noteOk()
      return String(r.stdout ?? '')
    }
    const msg = lastLine(r?.stderr) || r?.error || `exit ${r?.code}`
    noteFail(msg)
    throw new Error(msg)
  }

  async function checkYtdlp() {
    try {
      const r = await exec(cfg.ytdlp, ['--version'], { timeoutMs: VERSION_TIMEOUT_MS })
      if (r && r.code === 0) yt.version = String(r.stdout ?? '').trim() || null
      else yt.lastError = lastLine(r?.stderr) || r?.error || 'yt-dlp not found'
    } catch (e) {
      yt.lastError = errMsg(e)
    }
  }

  async function checkFfmpeg() {
    try {
      const r = await exec(cfg.ffmpeg, ['-version'], { timeoutMs: VERSION_TIMEOUT_MS })
      ffmpegFound = !!(r && r.code === 0)
    } catch {
      ffmpegFound = false
    }
  }

  // ytsearch8 (flat) -> [{ id, title, channel, duration, view_count }]
  async function search(info) {
    const q = `ytsearch8:${searchTerms(info.artist, info.title)} official video`
    const out = await ytdlp(['--flat-playlist', '--dump-json', q], { timeoutMs: SEARCH_TIMEOUT_MS })
    const results = []
    for (const line of out.split(/\r?\n/)) {
      if (!line.trim()) continue
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (o && typeof o.id === 'string') {
        results.push({
          id: o.id,
          title: o.title ?? '',
          channel: o.channel ?? o.uploader ?? '',
          duration: num(o.duration) || null,
          view_count: num(o.view_count),
        })
      }
    }
    return results
  }

  // A live stream URL for one video: video-only, 720p or less, cached per
  // video id until its own expiry.
  async function streamUrl(id) {
    const hit = streams.get(id)
    if (hit && hit.expiresAt > now()) return hit
    const out = await ytdlp(['-f', cfg.streamFormat, '-g', watchUrl(id)], { timeoutMs: STREAM_TIMEOUT_MS })
    const url = out.split(/\r?\n/).map((l) => l.trim()).find((l) => /^https?:\/\//i.test(l))
    if (!url) throw new Error('yt-dlp returned no stream URL')
    const s = { url, expiresAt: streamExpiry(url, now()) }
    streams.set(id, s)
    return s
  }

  async function exists(full) {
    try {
      await access(full)
      return true
    } catch {
      return false
    }
  }

  async function cleanTmp(id) {
    try {
      const tmp = join(cfg.localDir, 'tmp')
      for (const f of await readdir(tmp)) if (f.startsWith(`${id}.`)) await unlink(join(tmp, f)).catch(() => {})
    } catch { /* nothing to clean */ }
  }

  // A jpg from the video itself when yt-dlp left no thumbnail: a frame at 10 s,
  // else at 1 s (a clip shorter than that).
  async function frameThumb(videoFull, outFull) {
    for (const at of ['10', '1']) {
      try {
        const r = await exec(
          cfg.ffmpeg,
          ['-y', '-v', 'error', '-ss', at, '-i', videoFull, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', outFull],
          { timeoutMs: FFMPEG_TIMEOUT_MS },
        )
        if (r && r.code === 0 && (await exists(outFull))) return true
      } catch { /* try the next */ }
    }
    return false
  }

  // --- the collection: placing a finished download -----------------------------------

  // yt-dlp into the local scratch dir, then into the NAS folder, then the
  // entry. Returns the entry.
  async function download(job) {
    if (job.cancelled) return null
    const c = job.candidate
    const tmp = join(cfg.localDir, 'tmp')
    await mkdir(tmp, { recursive: true })
    await cleanTmp(c.id)
    const args = [
      '-f', cfg.downloadFormat, '--merge-output-format', 'mp4',
      '--write-thumbnail', '--convert-thumbnails', 'jpg',
    ]
    if (cfg.ffmpeg !== 'ffmpeg') args.push('--ffmpeg-location', cfg.ffmpeg)
    args.push('-o', join(tmp, `${c.id}.%(ext)s`), watchUrl(c.id))
    try {
      await ytdlp(args, { timeoutMs: DOWNLOAD_TIMEOUT_MS })
      const files = await readdir(tmp)
      const video = [`${c.id}.mp4`, ...VIDEO_EXTS.map((e) => `${c.id}.${e}`)].find((f) => files.includes(f))
      if (!video) throw new Error('download produced no video file')
      if (job.cancelled) return null
      const ext = video.slice(video.lastIndexOf('.') + 1)
      const videoFull = join(tmp, video)
      let thumbFull = join(tmp, `${c.id}.jpg`)
      if (!files.includes(`${c.id}.jpg`) && !(await frameThumb(videoFull, thumbFull))) thumbFull = null

      const name = cacheFileName({ artist: job.info.artist, title: job.info.title, videoId: c.id, ext })
      const dest = await index.place(videoFull, name.file)
      let thumbRel = null
      let thumbDest = null
      if (thumbFull) {
        try {
          thumbDest = await index.place(thumbFull, name.thumb)
          thumbRel = name.thumb
        } catch { /* a missing thumbnail is not worth failing the video */ }
      }
      const bytes = (await stat(dest)).size
      if (job.cancelled) {
        // Re-matched while it downloaded: this file is not wanted. Only our
        // own two files go; the key's entry belongs to the new job now.
        await unlink(dest).catch(() => {})
        if (thumbDest) await unlink(thumbDest).catch(() => {})
        return null
      }
      const entry = index.update(job.key, {
        status: 'ready', source: 'cache', videoId: c.id, videoTitle: c.title || null, channel: c.channel || null,
        videoDurationMs: c.duration ? Math.round(c.duration * 1000) : null, file: name.file, thumb: thumbRel,
        bytes, resolvedAt: now(), missAt: null, pinned: !!job.pin,
      }, lite(job.info))
      verified.add(job.key)
      maybeCountPlay()
      const removed = await index.evictToCap(capBytes(), { protect: new Set([job.key, curKey, nextKey]) })
      if (removed.length) log(`[video] evicted ${removed.length} video(s) over the cap`)
      return entry
    } finally {
      await cleanTmp(c.id)
    }
  }

  // --- one song's pipeline -----------------------------------------------------------

  function startStream(job) {
    if (job.streamP || !job.candidate || job.cancelled) return
    job.streamP = streamLane
      .run(() => streamUrl(job.candidate.id), job.priority)
      .then((s) => {
        if (!job.cancelled) job.stream = { url: s.url, videoId: job.candidate.id, expiresAt: s.expiresAt }
      })
      .catch((e) => {
        job.streamError = errMsg(e)
      })
  }

  async function run(job) {
    const { key, info } = job
    try {
      await load()
      await maybeSyncOverrides()
      if (job.cancelled) return
      const e = index.get(key)
      if (e?.status === 'ready' && (e.source === 'override' || verified.has(key))) return
      if (e?.status === 'ready' && e.source === 'cache') {
        if (await exists(index.absPath(e.file) || '')) {
          verified.add(key)
          return
        }
        log(`[video] ${key}: cached file is gone, fetching again`)
        await index.remove(key, { files: true })
        index.update(key, { denied: e.denied, plays: e.plays, lastPlayedAt: e.lastPlayedAt }, lite(info))
      } else if (e?.status === 'none' && e.missAt && now() - e.missAt < MISS_RETRY_MS && !job.candidate) {
        return
      }

      if (!job.candidate) {
        job.phase = 'searching'
        const found = await searchLane.run(() => search(info), job.priority)
        if (job.cancelled) return
        const hit = pickCandidate(found, { ...info, denied: index.get(key)?.denied ?? [] })
        if (!hit) {
          index.markMiss(key, lite(info))
          log(`[video] no official video for ${info.artist} - ${info.title} (${found.length} candidates)`)
          return
        }
        job.candidate = hit.candidate
        job.score = hit.score
        log(`[video] ${info.artist} - ${info.title}: ${hit.candidate.id} "${hit.candidate.title}" (${hit.candidate.channel}) score ${hit.score.toFixed(1)}`)
      }
      job.phase = 'fetching'
      if (job.wantStream) startStream(job)
      const dl = downloadLane.run(() => download(job), job.priority).catch((err) => {
        job.downloadError = errMsg(err)
        log(`[video] download of ${job.candidate.id} failed: ${job.downloadError}`)
      })
      await Promise.all([job.streamP, dl])
      if (job.streamP) await job.streamP // a prefetch that became the playing song meanwhile
      const got = index.get(key)
      if (!job.cancelled && !(got?.status === 'ready' && got.file) && !usableStream(job)) {
        job.error = job.downloadError || job.streamError || null
      }
    } catch (err) {
      job.error = errMsg(err)
    } finally {
      job.settled = true
      job.phase = job.error ? 'error' : 'done'
      if (job.error) job.errorAt = now()
      maybeCountPlay()
    }
  }

  const usableStream = (job) => !!(job && job.stream && job.stream.expiresAt > now())

  // Make sure a song is resolved: a no-op when it already is. Safe to call on
  // every poll.
  function ensure(info, { stream = false, priority = 1 } = {}) {
    if (!configured) return Promise.resolve()
    const key = info.key
    known.set(key, lite(info))
    const prior = jobs.get(key)
    if (prior && !prior.settled) {
      if (stream && !prior.wantStream) {
        prior.wantStream = true
        startStream(prior)
      }
      return prior.promise
    }
    if (initP) {
      const e = index.get(key)
      if (e?.status === 'ready' && (e.source === 'override' || verified.has(key))) return Promise.resolve()
      if (e?.status === 'none' && e.missAt && now() - e.missAt < MISS_RETRY_MS) return Promise.resolve()
      if (prior?.error && now() - prior.errorAt < ERROR_BACKOFF_MS) return Promise.resolve()
    }
    return startJob(key, info, { stream, priority })
  }

  function startJob(key, info, { stream = false, priority = 1, candidate = null, pin = false } = {}) {
    const job = {
      key, info: { ...lite(info), key }, priority, wantStream: stream, settled: false, phase: 'queued',
      candidate, pin, stream: null, streamP: null, streamError: null, downloadError: null,
      error: null, errorAt: 0, cancelled: false, score: null, promise: null,
    }
    jobs.set(key, job)
    job.promise = run(job)
    return job.promise
  }

  function cancelJob(key) {
    const job = jobs.get(key)
    if (job) {
      job.cancelled = true
      jobs.delete(key)
    }
    sticky.delete(key)
  }

  // A play counts once per track change, as soon as the song has a ready
  // entry (an override or cache file), even when the stream carried it.
  function maybeCountPlay() {
    if (!curPlay || curPlay.counted || curPlay.key !== curKey) return
    const e = index.get(curKey)
    if (e?.status === 'ready' && favoriteOk(zone?.cur)) {
      index.markPlayed(curKey)
      curPlay.counted = true
    }
  }

  async function maybeSyncOverrides() {
    if (overridesP) return Promise.race([overridesP, sleep(4000)])
    if (now() - overridesAt < OVERRIDE_SCAN_MS) return undefined
    overridesAt = now()
    overridesP = index.syncOverrides()
      .then((r) => {
        if (r.error) log(`[video] overrides not scanned: ${r.error}`)
        else if (r.added || r.removed || r.replaced) log(`[video] overrides: +${r.added} -${r.removed} ~${r.replaced}`)
      })
      .catch(() => {})
      .finally(() => { overridesP = null })
    return Promise.race([overridesP, sleep(4000)])
  }

  // --- reading Sonos ---------------------------------------------------------------------

  async function getJson(path, timeoutMs) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    try {
      const res = await globalThis.fetch(upstream + path, { signal: ac.signal })
      if (!res.ok) throw new Error(`Sonos HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      const c = e && e.cause
      throw new Error(e?.message === 'fetch failed' && c ? (c.message || c.code || String(c)) : errMsg(e))
    } finally {
      clearTimeout(timer)
    }
  }

  async function loadFavorites() {
    const t = now()
    if (favorites.list.length && t - favorites.at < FAVORITES_REFRESH_MS) return
    if (t - favorites.failedAt < FAVORITES_RETRY_MS) return
    try {
      const items = await getJson(`/${encodeURIComponent(cfg.room)}/favorites/detailed`, SONOS_TIMEOUT_MS)
      if (!Array.isArray(items)) throw new Error('not a list')
      favorites = {
        list: items.map((it) => ({ name: str(it.title), uri: str(it.uri), metadata: str(it.metadata) })).filter((f) => f.name),
        at: now(),
        failedAt: 0,
      }
    } catch {
      favorites = { ...favorites, failedAt: t }
    }
  }

  // A track from a Sonos track object. null when there is nothing to play.
  function trackFrom(t, ctx = {}) {
    if (!t || typeof t !== 'object') return null
    const artist = str(t.artist)
    const title = str(t.title)
    if (!artist && !title) return null
    const art = str(t.absoluteAlbumArtUri) || str(t.albumArtUri)
    return {
      key: songKey(artist, title),
      artist,
      title,
      album: str(t.album),
      durationMs: Math.round(num(t.duration) * 1000),
      albumArtUrl: art.startsWith('/') ? `/api/sonos${art}` : art,
      isAd: isAdTrack({ artist, title }),
      ...ctx,
    }
  }

  function parseZones(zones) {
    if (!Array.isArray(zones)) return null
    const want = cfg.room.toLowerCase()
    for (const group of zones) {
      const members = Array.isArray(group?.members) ? group.members : []
      if (!members.some((m) => str(m?.roomName).toLowerCase() === want)) continue
      return group.coordinator || members.find((m) => str(m?.roomName).toLowerCase() === want) || null
    }
    return null
  }

  async function doPoll() {
    let zones
    try {
      zones = await getJson('/zones', SONOS_TIMEOUT_MS)
    } catch (e) {
      zoneError = { msg: errMsg(e), count: (zoneError?.count ?? 0) + 1 }
      return
    }
    zoneError = null
    const at = now()
    const player = parseZones(zones)
    const st = player?.state ?? {}
    const playbackState = str(st.playbackState)
    const uri = str(player?.avTransportUri)
    const meta = str(player?.avTransportUriMetadata)
    if (uri) await loadFavorites().catch(() => {})
    const favoriteName = uri || meta ? favoriteFor(uri, favorites.list, meta) : null
    const rawStation = str(st.currentTrack?.stationName)
    const station = favoriteName
      ? cleanStationName(favoriteName)
      : dcTitle(meta) || (rawStation.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().length >= 2 ? cleanStationName(rawStation) : '')
    const playing = playbackState === 'PLAYING' || playbackState === 'TRANSITIONING'
    const ctx = { station, favoriteName }
    const idle = !player || playbackState === 'STOPPED' || !playbackState
    const cur = idle ? null : trackFrom(st.currentTrack, ctx)
    let next = null
    if (cur) {
      next = trackFrom(st.nextTrack, ctx)
      if (next && (next.isAd || next.key === cur.key)) next = null
    }
    zone = {
      at, cur, next, playbackState, playing, elapsedMs: Math.round(num(st.elapsedTime) * 1000), roomFound: !!player,
    }

    if (!cur) {
      curKey = null
      nextKey = null
      curPlay = null
      return
    }
    if (cur.key !== curKey) {
      sticky.delete(curKey)
      curKey = cur.key
      curPlay = { key: cur.key, counted: false }
    }
    known.set(cur.key, lite(cur))
    nextKey = next ? next.key : null
    if (!cur.isAd && favoriteOk(cur)) ensure(cur, { stream: true, priority: 0 })
    if (next && favoriteOk(next)) ensure(next, { stream: false, priority: 1 })
    if (initP) maybeCountPlay()
  }

  function pollOnce() {
    pollP ??= doPoll().catch((e) => { zoneError = { msg: errMsg(e), count: (zoneError?.count ?? 0) + 1 } })
      .finally(() => { pollP = null })
    return pollP
  }

  function favoriteOk(t) {
    if (!t) return true
    return favoriteAllowed(t.favoriteName || t.station, sharedVideo())
  }

  function schedulePoll() {
    if (!autoPoll || pollTimer || stopped) return
    pollTimer = setTimeout(tick, pollMs)
    pollTimer.unref?.()
  }

  // One poll cycle; stops itself when nobody has asked for a minute.
  async function tick() {
    pollTimer = null
    if (stopped || now() - lastDemandAt > DEMAND_MS) return
    await load()
    await pollOnce()
    schedulePoll()
  }

  // --- what a screen is told ------------------------------------------------------------

  function describe(e) {
    return {
      videoId: e.videoId ?? undefined,
      videoTitle: e.videoTitle ?? undefined,
      channel: e.channel ?? undefined,
      videoDurationMs: e.videoDurationMs ?? undefined,
      thumbUrl: e.thumb ? thumbUrl(e.key) : undefined,
    }
  }

  function videoFor(key, t, { remember = false } = {}) {
    if (t?.isAd) return { status: 'ad', reason: t.artist ? 'advertisement' : 'no artist, nothing to search for' }
    if (!favoriteOk(t)) return { status: 'denied', reason: 'videos are off for this station' }
    const e = index.get(key)
    const job = jobs.get(key)
    if (e?.status === 'ready' && e.source === 'override') {
      return { status: 'ready', source: 'override', url: playUrl(key), ...describe(e) }
    }
    if (e?.status === 'ready') {
      if (sticky.has(key) && usableStream(job)) return streamVideo(key, job, e)
      return { status: 'ready', source: 'cache', url: playUrl(key), ...describe(e) }
    }
    if (usableStream(job)) {
      if (remember) sticky.add(key)
      return streamVideo(key, job, e)
    }
    if (job && !job.settled) {
      const c = job.candidate
      return c
        ? { status: 'resolving', videoId: c.id, videoTitle: c.title || undefined, channel: c.channel || undefined }
        : { status: 'resolving' }
    }
    if (job?.error && now() - job.errorAt < ERROR_BACKOFF_MS) return { status: 'error', reason: job.error }
    if (e?.status === 'none' && e.missAt && now() - e.missAt < MISS_RETRY_MS) {
      return { status: 'none', reason: 'no official video found' }
    }
    return { status: 'resolving' }
  }

  function streamVideo(key, job, e) {
    const c = job.candidate
    return {
      status: 'ready',
      source: 'stream',
      url: playUrl(key),
      videoId: c.id,
      videoTitle: c.title || undefined,
      channel: c.channel || undefined,
      videoDurationMs: c.duration ? Math.round(c.duration * 1000) : undefined,
      thumbUrl: e?.thumb ? thumbUrl(key) : undefined,
    }
  }

  function snapshot(room) {
    const base = { configured: true, room: room || cfg.room }
    if (room && room.toLowerCase() !== cfg.room.toLowerCase()) {
      return { ...base, track: null, video: { status: 'idle', reason: `room ${room} is not followed (VIDEO_ROOM=${cfg.room})` }, next: null }
    }
    if (!zone || (zoneError && zoneError.count >= 2)) {
      return {
        ...base, track: null, next: null,
        video: zoneError ? { status: 'error', reason: `Sonos unreachable: ${zoneError.msg}` } : { status: 'resolving', reason: 'reading Sonos' },
      }
    }
    if (!zone.cur) {
      const reason = zone.roomFound ? 'nothing is playing' : `room ${cfg.room} not found in Sonos zones`
      return { ...base, track: null, video: { status: 'idle', reason }, next: null }
    }
    const t = zone.cur
    const allowed = favoriteOk(t)
    const track = {
      key: t.key,
      artist: t.artist,
      title: t.title,
      album: t.album,
      station: t.station,
      favoriteName: t.favoriteName,
      favoriteAllowed: allowed,
      durationMs: t.durationMs,
      elapsedMs: zone.elapsedMs,
      elapsedAt: zone.at,
      albumArtUrl: t.albumArtUrl,
      isAd: t.isAd,
      playing: zone.playing,
    }
    const n = zone.next
    return {
      ...base,
      track,
      video: videoFor(t.key, t, { remember: true }),
      next: n ? { key: n.key, artist: n.artist, title: n.title, status: videoFor(n.key, n).status } : null,
    }
  }

  // --- background upkeep ----------------------------------------------------------------

  async function probe() {
    if (!configured) return false
    if (probeP) return probeP
    if (reachable !== null && now() - reachableAt < REACHABLE_MS) return reachable
    probeP = Promise.race([
      stat(dir).then((s) => s.isDirectory(), () => false),
      sleep(REACHABLE_TIMEOUT_MS).then(() => false),
    ]).then((ok) => {
      reachable = ok
      reachableAt = now()
      return ok
    }).finally(() => { probeP = null })
    return probeP
  }

  async function upkeep() {
    const layout = await index.ensureLayout()
    if (!layout.ok) log(`[video] folder not ready: ${layout.error}`)
    await load()
    await maybeSyncOverrides()
    const removed = await index.evictToCap(capBytes(), { protect: new Set([curKey, nextKey]) })
    if (removed.length) log(`[video] evicted ${removed.length} video(s) over the cap`)
  }

  // --- the public face ----------------------------------------------------------------------

  const api = {
    configured,

    start() {
      if (!configured || started) return { configured, dir }
      started = true
      background(load().then(() => upkeep()))
      background(probe())
      background(checkYtdlp())
      background(checkFfmpeg())
      versionTimer = setInterval(() => background(checkYtdlp()), VERSION_CHECK_MS)
      versionTimer.unref?.()
      probeTimer = setInterval(() => background(probe()), 30_000)
      probeTimer.unref?.()
      return { configured, dir, localDir: cfg.localDir }
    },

    stop() {
      stopped = true
      clearTimeout(pollTimer)
      pollTimer = null
      clearInterval(versionTimer)
      clearInterval(probeTimer)
    },

    // GET /api/video/now. Calling it is the demand signal.
    async now(room) {
      if (!configured) {
        return { configured: false, room: room || cfg.room, track: null, video: { status: 'none', reason: 'not configured' }, next: null }
      }
      lastDemandAt = now()
      schedulePoll()
      await load()
      if (!zone || now() - zone.at > pollMs * 2 + 1000) await pollOnce()
      return snapshot(room)
    },

    // Where /api/video/play/<key> gets its bytes from.
    async play(key) {
      if (!configured) return null
      await load()
      const e = index.get(key)
      const job = jobs.get(key)
      const hold = sticky.has(key) && usableStream(job)
      if (e?.status === 'ready' && !hold) {
        const full = index.absPath(e.file)
        if (full && (await exists(full))) return { kind: 'file', path: full }
        if (e.source === 'cache') {
          log(`[video] ${key}: file missing on disk, dropping the entry`)
          verified.delete(key)
          await index.remove(key, { files: false })
          index.update(key, { denied: e.denied, plays: e.plays, lastPlayedAt: e.lastPlayedAt }, lite(e))
          if (key === curKey && zone?.cur) ensure(zone.cur, { stream: true, priority: 0 })
        }
      }
      if (usableStream(job)) return { kind: 'stream', url: job.stream.url, videoId: job.stream.videoId }
      return null
    },

    thumb(key) {
      if (!configured) return null
      const e = index.get(key)
      return e?.thumb ? index.absPath(e.thumb) : null
    },

    // The stream upstream refused (403/410: the URL expired early): forget it
    // and fetch a fresh one.
    streamFailed(key) {
      const job = jobs.get(key)
      if (!job?.candidate) return
      streams.delete(job.candidate.id)
      job.stream = null
      job.streamP = null
      sticky.delete(key)
      if (job.wantStream || key === curKey) {
        job.wantStream = true
        startStream(job)
      }
    },

    // POST /api/video/wrong: deny the matched video and match again.
    async wrong(key) {
      if (!configured) return { ok: false, error: 'not configured' }
      await load()
      const e = index.get(key)
      const prior = jobs.get(key)
      if (e?.source === 'override') {
        return { ok: false, error: 'this song uses a hand-picked file in overrides/; rename or delete the file' }
      }
      const info = known.get(key) || (e ? lite(e) : null) || keyInfo(key)
      if (!info || (!e && !prior && !known.has(key))) return { ok: false, error: 'unknown song' }
      const videoId = (e?.status === 'ready' && e.videoId) || prior?.candidate?.id || null
      cancelJob(key)
      const denied = [...new Set([...(e?.denied ?? []), ...(videoId ? [videoId] : [])])]
      if (e) await index.remove(key, { files: true })
      verified.delete(key)
      if (videoId) streams.delete(videoId)
      index.set(key, { ...newEntry({ key, ...info }), denied, plays: e?.plays ?? 0, lastPlayedAt: e?.lastPlayedAt ?? null })
      const p = startJob(key, { ...info, key }, { stream: key === curKey, priority: 0 })
      await Promise.race([p, sleep(WRONG_WAIT_MS)])
      return { ok: true, video: videoFor(key, key === curKey ? zone?.cur : null, { remember: key === curKey }) }
    },

    // POST /api/video/pick: use this YouTube video for the song, pinned.
    async pick(key, urlOrId) {
      if (!configured) return { ok: false, error: 'not configured' }
      await load()
      const id = parseYouTubeId(urlOrId)
      if (!id) return { ok: false, error: 'not a YouTube link or video id' }
      const e = index.get(key)
      if (e?.source === 'override') {
        return { ok: false, error: 'this song uses a hand-picked file in overrides/; rename or delete the file' }
      }
      const info = known.get(key) || (e ? lite(e) : null) || keyInfo(key)
      if (!info) return { ok: false, error: 'unknown song' }
      let meta
      try {
        const out = await searchLane.run(() => ytdlp(['--dump-json', watchUrl(id)], { timeoutMs: SEARCH_TIMEOUT_MS }), 0)
        meta = JSON.parse(out.split(/\r?\n/).find((l) => l.trim().startsWith('{')) || '')
      } catch (err) {
        return { ok: false, error: `could not read that video: ${errMsg(err)}` }
      }
      cancelJob(key)
      if (e) await index.remove(key, { files: true })
      verified.delete(key)
      index.set(key, {
        ...newEntry({ key, ...info }), plays: e?.plays ?? 0, lastPlayedAt: e?.lastPlayedAt ?? null,
        denied: (e?.denied ?? []).filter((d) => d !== id),
      })
      const candidate = {
        id, title: meta.title ?? '', channel: meta.channel ?? meta.uploader ?? '',
        duration: num(meta.duration) || null, view_count: num(meta.view_count),
      }
      startJob(key, { ...info, key }, { stream: key === curKey, priority: 0, candidate, pin: true })
      return { ok: true, video: videoFor(key, key === curKey ? zone?.cur : null, { remember: key === curKey }) }
    },

    // POST /api/video/delete
    async remove(key) {
      if (!configured) return { ok: false, error: 'not configured' }
      await load()
      const e = index.get(key)
      if (!e) return { ok: false, error: 'unknown song' }
      if (e.source === 'override') return { ok: false, error: 'overrides are managed by hand: delete the file' }
      cancelJob(key)
      verified.delete(key)
      await index.remove(key, { files: true })
      return { ok: true }
    },

    // POST /api/video/clear
    async clear() {
      if (!configured) return { ok: false, removed: 0, error: 'not configured' }
      await load()
      for (const key of [...jobs.keys()]) cancelJob(key)
      verified.clear()
      const removed = await index.clearCache()
      return { ok: true, removed }
    },

    // GET /api/video/collection
    async collection() {
      const cap = capBytes()
      if (!configured) return { configured: false, bytes: 0, capBytes: cap, count: 0, entries: [] }
      await load()
      const entries = index.list().sort((a, b) => (b.lastPlayedAt ?? -1) - (a.lastPlayedAt ?? -1))
      return { configured: true, bytes: index.totalBytes(), capBytes: cap, count: entries.length, entries }
    },

    // GET /api/video/health. Reachability is refreshed by probe() (every 30 s
    // and on the health route); this reads what it last saw.
    health() {
      return {
        configured,
        dir,
        reachable: configured && reachable === true,
        ytdlp: {
          path: cfg.ytdlp, version: yt.version, lastOkAt: yt.lastOkAt, lastError: yt.lastError,
          consecutiveFailures: yt.consecutiveFailures,
        },
        ffmpeg: { path: cfg.ffmpeg, found: ffmpegFound === true },
        cache: {
          bytes: index ? index.totalBytes() : 0,
          capBytes: capBytes(),
          count: index ? index.cacheCount() : 0,
        },
        queue: { resolving: searchLane.size + streamLane.size, downloading: downloadLane.size },
        polling: !!pollTimer,
        room: cfg.room,
        indexError: index ? index.lastWriteError || index.lastLocalError : null,
      }
    },

    probe,

    // Resolves when no job, lane task or background check is running. For tests.
    async whenIdle() {
      for (let i = 0; i < 200; i++) {
        const pending = [...jobs.values()].filter((j) => !j.settled).map((j) => j.promise)
        if (!pending.length && !bg.size && !searchLane.size && !streamLane.size && !downloadLane.size && !pollP && !overridesP) return
        await Promise.allSettled([...pending, ...bg, pollP, overridesP].filter(Boolean))
        await new Promise((r) => setImmediate(r))
      }
    },

    // For tests: one poll now, and one timer cycle.
    poll: () => (configured ? load().then(pollOnce) : Promise.resolve()),
    tick,
    index,
  }

  // artist|title from a key, for a song the hub has not seen play this run.
  function keyInfo(key) {
    const at = key.indexOf('|')
    if (at < 0) return null
    return { artist: key.slice(0, at), title: key.slice(at + 1), album: '', durationMs: 0 }
  }

  return api
}
