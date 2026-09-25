// plex.mjs - what Plex is playing, for the second-screen view.
//
// The living room watches Plex on the Apple TV; a web screen that opts in
// (display.plexFollow = the player's machineIdentifier; the family-room Echo)
// switches to the Plex view and shows what is on: the show, the episode, the
// air date, the progress, the cast, and a transport bar when the player can
// be controlled. Plex Media Server runs on the NUC next to this service, so
// the hub talks to it on loopback: PLEX_URL (default http://127.0.0.1:32400)
// with the server owner's token, PLEX_TOKEN from the environment or .env,
// else the file PLEX_TOKEN_FILE (default secrets/plex-token.txt, copied by
// hand, never in git). The token travels in a header only and is never
// logged or returned.
//
// Every 5 s, single-flight, GET /status/sessions becomes the snapshot that
// GET /api/plex/now serves:
//
//   { fetchedAt, error, sessions: [...], players: [...] }
//
//   sessions: [{ key,
//     player: { name, machineId, product, platform, address, local, state },
//     user,
//     media: { type: 'movie'|'episode'|'other', ratingKey, title, show,
//              showRatingKey, season, episode, episodeTitle, year, airDate,
//              durationMs, offsetMs, offsetAt, contentRating, rating,
//              ratingSource, tagline, summary, genres, directors, writers,
//              studio, poster, art, ultraBlur, cast, castSource, subtitles,
//              subtitlesOn, guids, showGuids },
//     controllable }]
//   players: [{ name, machineId, product, platform, lastSeenAt, lastItem }]
//
//   state      'playing' | 'paused' | 'buffering' | 'stopped' | 'unknown'
//   title      the item's own title (an episode's title for an episode);
//              show / season / episode / episodeTitle are set for episodes
//   offsetAt   when this offsetMs was first seen (ISO). Plex updates
//              viewOffset only when the player reports its timeline, so a
//              value seen on two polls keeps its first time; a client
//              advances offsetMs from it while the state is 'playing'.
//   poster, art  hub image paths (/api/plex/image?path=...): Plex images
//              need the token, so the hub proxies them. An episode's poster
//              is its show's.
//   cast       up to 12 [{ name, role, thumb, tmdbPersonId? , plexId? }]:
//              TMDB's credits when a key is configured and the item has a
//              TMDB id (lib/tmdb.mjs), else Plex's Role[]. thumb is an
//              absolute URL (TMDB, metadata-static.plex.tv) or a hub path.
//   subtitles  [{ id, language, languageCode, title, forced, selected }]
//   guids      { tmdb, imdb, tvdb } from the item's Guid[]; showGuids the
//              show's (episodes)
//   controllable  the player is listed by GET /clients (it advertises as a
//              player), so a Companion command can reach it. /clients is
//              polled every 30 s.
//   players    every player ever seen in a session, persisted to
//              plex-players.json, with the last item it played: the
//              dashboard's "Follow Plex player" select and the view's
//              "nothing playing" state read it.
//
// Sessions of type clip (trailers, extras), track (music) and photo are
// dropped. Item metadata (/library/metadata/<ratingKey>, and the show for an
// episode) is fetched once per item and cached for an hour, so the 5 s poll
// stays one request. Plex down: the last snapshot is kept and `error` set.
//
// Transport (POST /api/plex/command) goes through the server's Companion
// relay: GET /player/playback/<cmd>?commandID=<n>&type=video with
// X-Plex-Target-Client-Identifier. A command is only ever sent to a player
// that /clients lists (re-checked on demand); anything else answers
// 'player not advertising' without reaching Plex, as does a 404 from the
// relay. back = seekTo(offset - 10 s), forward = seekTo(offset + 30 s),
// ccOn = setStreams with the first English subtitle stream (else the first
// one), ccOff = setStreams?subtitleStreamID=0.
//
// PLEX_FIXTURE (tests, running without Plex): a JSON file
//   { sessions: <a /status/sessions payload, or its Metadata array>,
//     clients: [machineIdentifier, ...] | <a /clients payload>,
//     metadata: { "<ratingKey>": <a /library/metadata payload, or the item> } }
// read instead of /status/sessions and /clients, re-read when it changes.
// Metadata missing from it is fetched from Plex as usual; images and the
// library search still go to Plex; commands are never sent.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'

export const DEFAULT_PLEX_URL = 'http://127.0.0.1:32400'
export const NO_TOKEN = 'no Plex token (set PLEX_TOKEN, or put it in PLEX_TOKEN_FILE)'
export const NOT_ADVERTISING = 'player not advertising'
export const ACTIONS = Object.freeze(['play', 'pause', 'stop', 'back', 'forward', 'ccOn', 'ccOff'])
export const BACK_MS = 10_000
export const FORWARD_MS = 30_000
export const CAST_MAX = 12
export const LIBRARY_MAX = 8
const POLL_MS = 5_000
const CLIENTS_MS = 30_000
// A command re-reads /clients first when the list is older than this.
const CLIENTS_FRESH_MS = 5_000
const HTTP_TIMEOUT_MS = 6_000
const IMAGE_TIMEOUT_MS = 15_000
const IMAGE_QUALITY = 82
const META_TTL_MS = 60 * 60 * 1000
const META_RETRY_MS = 5 * 60 * 1000
const META_MAX = 200
const SEARCH_TTL_MS = 24 * 60 * 60 * 1000
const SEARCH_RETRY_MS = 5 * 60 * 1000
const SEARCH_MAX = 200
// A new item's TMDB credits are waited on this long before the snapshot is
// published without them (the next poll picks them up).
const CREDITS_WAIT_MS = 2_500
// A player's lastSeenAt reaches plex-players.json at most this often.
const PLAYERS_SAVE_MS = 5 * 60 * 1000
const LOG_REPEAT_MS = 10 * 60 * 1000
const DROPPED_TYPES = new Set(['clip', 'track', 'photo'])
const STATES = new Set(['playing', 'paused', 'buffering', 'stopped'])
const IMAGE_PATH_RE = /^\/(library|photo)\//
const MACHINE_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/
const RATING_KEY_RE = /^\d{1,12}$/
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const HEX_RE = /^[0-9a-f]{6}$/i

// How the hub introduces itself to Plex. The relay needs a client identifier
// to route a Companion command; the rest names us in Plex's own logs.
const CLIENT_HEADERS = Object.freeze({
  Accept: 'application/json',
  'X-Plex-Client-Identifier': 'smart-display-hub',
  'X-Plex-Product': 'Smart Display',
  'X-Plex-Version': '1.0',
  'X-Plex-Device-Name': 'FrameServer',
  'X-Plex-Platform': 'Node',
})

// --- small readers (Plex's JSON mixes numbers and numeric strings) ------------

const str = (v) => {
  if (typeof v === 'string') return v.trim() ? v.trim() : null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const num = (v) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

const int = (v) => {
  const n = num(v)
  return n == null ? null : Math.round(n)
}

const flag = (v) => v === true || v === 1 || v === '1' || v === 'true'
const list = (v) => (Array.isArray(v) ? v : [])
const tags = (v) => list(v).map((x) => str(x?.tag)).filter(Boolean)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms).unref?.())

// --- images ---------------------------------------------------------------------

// A Plex image path the proxy will fetch: /library/... or /photo/..., nothing
// that could leave the server (no scheme, no //, no ..), no whitespace.
export function isImagePath(p) {
  return typeof p === 'string' && p.length <= 512 && IMAGE_PATH_RE.test(p) &&
    !p.includes('..') && !p.includes('//') && !p.includes('\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f]/.test(p)
}

// The hub path a screen loads a Plex image from (GET /api/plex/image).
export function imagePath(plexPath, w, h) {
  if (!isImagePath(plexPath)) return null
  return `/api/plex/image?path=${encodeURIComponent(plexPath)}&w=${w}&h=${h}`
}

// A person's picture: Plex gives absolute metadata-static.plex.tv URLs for
// agent-matched people (public, no token) and library paths for others.
function thumbUrl(t, size = 200) {
  const s = str(t)
  if (!s) return null
  if (/^https:\/\//i.test(s)) return s
  return imagePath(s, size, size)
}

// --- normalizing a session --------------------------------------------------------

// { tmdb, imdb, tvdb } from a Guid[] like [{ id: 'tmdb://1547831' }].
export function parseGuids(arr) {
  const out = { tmdb: null, imdb: null, tvdb: null }
  for (const g of list(arr)) {
    const m = /^(tmdb|imdb|tvdb):\/\/(.+)$/.exec(str(g?.id) || '')
    if (m && !out[m[1]]) out[m[1]] = m[2]
  }
  return out
}

function ratingSource(image) {
  const s = str(image) || ''
  if (s.startsWith('imdb://')) return 'imdb'
  if (s.startsWith('themoviedb://')) return 'tmdb'
  if (s.startsWith('rottentomatoes://')) return 'rottentomatoes'
  return s ? s.split(':')[0] || null : null
}

function normState(v) {
  const s = (str(v) || '').toLowerCase()
  return STATES.has(s) ? s : 'unknown'
}

// Plex's four-corner "UltraBlur" colours: an array of one object in a
// session, a bare object in item metadata. Hex without '#', in both.
function ultraBlur(v) {
  const o = Array.isArray(v) ? v[0] : v
  if (!isDict(o)) return null
  const out = {}
  for (const k of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    const c = str(o[k])
    if (!c || !HEX_RE.test(c)) return null
    out[k] = `#${c.toLowerCase()}`
  }
  return out
}

function selectedPart(m) {
  const media = list(m?.Media)
  const med = media.find((x) => flag(x?.selected)) || media[0]
  const parts = list(med?.Part)
  return parts.find((x) => flag(x?.selected)) || parts[0] || null
}

// The subtitle streams (streamType 3) of what is playing.
export function subtitleStreams(m) {
  return list(selectedPart(m)?.Stream)
    .filter((s) => int(s?.streamType) === 3 && int(s?.id) != null)
    .map((s) => ({
      id: int(s.id),
      language: str(s.language),
      languageCode: str(s.languageCode),
      title: str(s.extendedDisplayTitle) || str(s.displayTitle) || str(s.title),
      forced: flag(s.forced),
      selected: flag(s.selected),
    }))
}

// The stream "captions on" selects: the first English one that is not
// forced-only, else the first English, else the first non-forced, else any.
export function captionsStream(subs) {
  const all = list(subs)
  const english = (s) => /^(en|eng)$/i.test(s.languageCode || '') || /^english/i.test(s.language || '')
  return all.find((s) => english(s) && !s.forced) || all.find(english) ||
    all.find((s) => !s.forced) || all[0] || null
}

// Plex's Role[] as the cast row: billing order, capped.
export function plexCast(roles, max = CAST_MAX) {
  const out = []
  const seen = new Set()
  for (const r of list(roles)) {
    const name = str(r?.tag)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, role: str(r?.role), thumb: thumbUrl(r?.thumb), plexId: int(r?.id) })
    if (out.length >= max) break
  }
  return out
}

function longer(a, b) {
  return list(a).length >= list(b).length ? list(a) : list(b)
}

function sessionKeyOf(m) {
  return str(m?.sessionKey) || str(m?.Session?.id) ||
    `${str(m?.Player?.machineIdentifier) || '?'}:${str(m?.ratingKey) || '?'}`
}

// One /status/sessions Metadata entry -> the session the screens read, or null
// when it is not something to show (a trailer, music, a photo).
//   ctx.meta     the item's /library/metadata entry (Guid[], the full Role[])
//   ctx.show     the show's, for an episode
//   ctx.credits  TMDB cast (lib/tmdb.mjs), replaces Plex's when non-empty
//   ctx.offsetAt ISO time the viewOffset was first seen
//   ctx.clients  Set of machineIdentifiers /clients lists, or null
export function normalizeSession(m, ctx = {}) {
  if (!isDict(m)) return null
  const rawType = str(m.type)
  if (!rawType || DROPPED_TYPES.has(rawType)) return null
  const meta = isDict(ctx.meta) ? ctx.meta : {}
  const show = isDict(ctx.show) ? ctx.show : {}
  const p = isDict(m.Player) ? m.Player : {}
  const type = rawType === 'movie' || rawType === 'episode' ? rawType : 'other'
  const isEpisode = type === 'episode'
  // The session first: it is the live copy. Metadata fills what it lacks.
  const pick = (k) => (m[k] ?? meta[k])
  const machineId = str(p.machineIdentifier)

  const title = str(pick('title')) || '(untitled)'
  const airDate = str(pick('originallyAvailableAt'))
  const genres = tags(m.Genre).length ? tags(m.Genre) : tags(meta.Genre).length ? tags(meta.Genre) : tags(show.Genre)
  const posterPath = isEpisode
    ? str(pick('grandparentThumb')) || str(pick('parentThumb')) || str(pick('thumb'))
    : str(pick('thumb'))
  const artPath = str(pick('art')) || str(pick('grandparentArt')) || str(show.art)
  const roles = longer(meta.Role, m.Role).length ? longer(meta.Role, m.Role) : list(show.Role)
  const credits = Array.isArray(ctx.credits) && ctx.credits.length ? ctx.credits : null
  const subtitles = subtitleStreams(m).length ? subtitleStreams(m) : subtitleStreams(meta)

  return {
    key: sessionKeyOf(m),
    player: {
      name: str(p.title) || str(p.device) || str(p.product) || 'Plex player',
      machineId,
      product: str(p.product),
      platform: str(p.platform),
      address: str(p.address),
      local: flag(p.local),
      state: normState(p.state),
    },
    user: str(m.User?.title),
    media: {
      type,
      ratingKey: str(pick('ratingKey')),
      title,
      show: isEpisode ? str(pick('grandparentTitle')) || str(show.title) : null,
      showRatingKey: isEpisode ? str(pick('grandparentRatingKey')) : null,
      season: isEpisode ? int(pick('parentIndex')) : null,
      episode: isEpisode ? int(pick('index')) : null,
      episodeTitle: isEpisode ? title : null,
      year: int(pick('year')),
      airDate: airDate && DATE_KEY_RE.test(airDate) ? airDate : null,
      durationMs: int(pick('duration')) ?? int(list(m.Media)[0]?.duration),
      offsetMs: Math.max(0, int(m.viewOffset) ?? 0),
      offsetAt: str(ctx.offsetAt),
      contentRating: str(pick('contentRating')) || str(show.contentRating),
      rating: num(pick('audienceRating')) ?? num(pick('rating')),
      ratingSource: num(pick('audienceRating')) != null ? ratingSource(pick('audienceRatingImage'))
        : ratingSource(pick('ratingImage')),
      tagline: str(pick('tagline')),
      summary: str(pick('summary')) || (isEpisode ? str(show.summary) : null),
      genres,
      directors: tags(longer(meta.Director, m.Director)),
      writers: tags(longer(meta.Writer, m.Writer)),
      studio: str(pick('studio')) || str(show.studio),
      poster: imagePath(posterPath, 600, 900),
      art: imagePath(artPath, 1280, 720),
      ultraBlur: ultraBlur(m.UltraBlurColors) || ultraBlur(meta.UltraBlurColors) || ultraBlur(show.UltraBlurColors),
      cast: credits || plexCast(roles),
      castSource: credits ? 'tmdb' : 'plex',
      subtitles,
      subtitlesOn: subtitles.some((s) => s.selected),
      guids: parseGuids(meta.Guid ?? m.Guid),
      showGuids: isEpisode ? parseGuids(show.Guid) : null,
    },
    controllable: !!(ctx.clients instanceof Set && machineId && ctx.clients.has(machineId)),
  }
}

// What lib/tmdb.mjs looks credits up by, from a normalized media: a movie's
// TMDB id, or an episode's show id + season + episode. Never a title search.
export function tmdbLookup(media) {
  if (!isDict(media)) return null
  if (media.type === 'movie' && media.guids?.tmdb) return { kind: 'movie', id: media.guids.tmdb }
  if (media.type === 'episode' && media.showGuids?.tmdb && media.season != null && media.episode != null) {
    return { kind: 'episode', showId: media.showGuids.tmdb, season: media.season, episode: media.episode }
  }
  return null
}

// The payload's Metadata[] (a /status/sessions or /library/metadata answer),
// or the array itself.
function metadataList(payload) {
  if (Array.isArray(payload)) return payload
  return list(payload?.MediaContainer?.Metadata)
}

// The machineIdentifiers a /clients answer lists (Server[] in current
// versions; Device[] / Metadata[] tolerated), or a fixture's plain list.
export function clientIds(payload) {
  if (Array.isArray(payload)) return new Set(payload.map(str).filter(Boolean))
  const mc = payload?.MediaContainer
  const rows = [...list(mc?.Server), ...list(mc?.Device), ...list(mc?.Metadata)]
  return new Set(rows.map((r) => str(r?.machineIdentifier) || str(r?.clientIdentifier)).filter(Boolean))
}

// --- transport --------------------------------------------------------------------

// Where a playing item is now: offsetMs advanced from offsetAt while playing.
export function currentOffset(media, state, nowMs = Date.now()) {
  const base = Math.max(0, Number(media?.offsetMs) || 0)
  const dur = Number(media?.durationMs) || 0
  let v = base
  if (state === 'playing') {
    const at = Date.parse(media?.offsetAt)
    if (Number.isFinite(at)) v = base + Math.max(0, nowMs - at)
  }
  return dur > 0 ? Math.min(dur, v) : v
}

// action + the player's session -> { path } of the Companion command, or
// { error } when it cannot be built.
export function commandPath(action, session, nowMs = Date.now()) {
  const media = session?.media
  switch (action) {
    case 'play':
    case 'pause':
    case 'stop':
      return { path: `/player/playback/${action}` }
    case 'back':
    case 'forward': {
      if (!media) return { error: 'nothing is playing on that player' }
      const cur = currentOffset(media, session.player?.state, nowMs)
      let target = action === 'back' ? cur - BACK_MS : cur + FORWARD_MS
      if (media.durationMs > 0) target = Math.min(target, media.durationMs - 1000)
      return { path: `/player/playback/seekTo?offset=${Math.max(0, Math.round(target))}` }
    }
    case 'ccOn': {
      const s = captionsStream(media?.subtitles)
      if (!s) return { error: media ? 'no subtitles for this item' : 'nothing is playing on that player' }
      return { path: `/player/playback/setStreams?subtitleStreamID=${s.id}` }
    }
    case 'ccOff':
      return { path: '/player/playback/setStreams?subtitleStreamID=0' }
    default:
      return { error: `action must be one of ${ACTIONS.join(', ')}` }
  }
}

// --- people -------------------------------------------------------------------------

export function normName(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

function excludeSet(v) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',')
  return new Set(raw.map((x) => String(x).trim()).filter((x) => RATING_KEY_RE.test(x)))
}

// --- the service ---------------------------------------------------------------------

// getToken() -> the token or null, read per request (a token added or
// rotated needs no restart). tmdb: lib/tmdb.mjs's createTmdb(), optional.
// checkClients: false only in tests (a command then goes to the relay even
// for a player /clients does not list).
export function createPlex({
  dir,
  url = DEFAULT_PLEX_URL,
  getToken = () => null,
  tmdb = null,
  fixtureFile = null,
  checkClients = true,
  log = (msg) => console.log(msg),
}) {
  const base = String(url || DEFAULT_PLEX_URL).replace(/\/+$/, '')
  const playersFile = join(dir, 'plex-players.json')
  let snapshot = { fetchedAt: null, error: null, sessions: [], players: [] }
  let players = []
  let savedSeen = new Map() // machineId -> lastSeenAt as persisted
  let lastRaw = []
  let clients = null // Set, or null until /clients has answered
  let clientsAt = 0
  let clientsError = null
  let inFlight = null
  let clientsInFlight = null
  let pollTimer = null
  let clientsTimer = null
  let commandSeq = 0
  let fixture = null
  let fixtureStamp = null
  const metaCache = new Map() // ratingKey -> { at, value, promise }
  const offsets = new Map() // session key -> { rk, offset, state, at }
  const searchCache = new Map() // normName -> { at, value, promise }
  const lastLog = { msg: null, at: 0 }

  function logRepeat(msg) {
    const now = Date.now()
    if (msg === lastLog.msg && now - lastLog.at < LOG_REPEAT_MS) return
    lastLog.msg = msg
    lastLog.at = now
    log(msg)
  }

  // --- Plex HTTP ---
  async function plexGet(path, { timeoutMs = HTTP_TIMEOUT_MS, headers = {} } = {}) {
    const token = getToken()
    if (!token) throw new Error(NO_TOKEN)
    return fetchWithTimeout(base + path, {
      timeoutMs,
      headers: { ...CLIENT_HEADERS, ...headers, 'X-Plex-Token': token },
    })
  }

  async function plexJson(path, opts) {
    const what = `Plex ${path.split('?')[0]}`
    const { res, body } = await plexGet(path, opts)
    if (res.status === 401) throw new Error('Plex refused the token (HTTP 401)')
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`)
    if (!body.length) return {}
    try {
      return JSON.parse(body.toString('utf8'))
    } catch {
      throw new Error(`${what}: not JSON`)
    }
  }

  // --- the fixture ---
  function readFixture() {
    let st
    try {
      st = statSync(fixtureFile)
    } catch (e) {
      throw new Error(`fixture ${fixtureFile}: ${e.code || e.message}`)
    }
    const stamp = `${st.mtimeMs}:${st.size}`
    if (stamp !== fixtureStamp) {
      try {
        fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'))
      } catch (e) {
        throw new Error(`fixture ${fixtureFile}: ${e.message}`)
      }
      fixtureStamp = stamp
    }
    return isDict(fixture) ? fixture : {}
  }

  function fixtureMeta(rk) {
    if (!fixtureFile) return null
    try {
      const v = readFixture().metadata?.[rk]
      return v ? (metadataList(v)[0] || (isDict(v) ? v : null)) : null
    } catch {
      return null
    }
  }

  // --- item metadata, cached per ratingKey ---
  function metaFor(rk) {
    return (rk && metaCache.get(rk)?.value) || null
  }

  function ensureMeta(rk) {
    if (!rk || !RATING_KEY_RE.test(rk)) return Promise.resolve(null)
    const now = Date.now()
    const e = metaCache.get(rk)
    if (e?.promise) return e.promise
    if (e && now - e.at < (e.value ? META_TTL_MS : META_RETRY_MS)) return Promise.resolve(e.value)
    // The cache is written in .then(), never inside the async body: a body
    // that finishes without awaiting (the fixture has the item) would
    // otherwise write its result BEFORE the in-flight entry below, which
    // would then hold a settled promise for good.
    const promise = (async () => {
      try {
        return fixtureMeta(rk) || metadataList(await plexJson(`/library/metadata/${rk}`))[0] || null
      } catch (err) {
        logRepeat(`[plex] metadata ${rk}: ${err.message}`)
        return e?.value || null
      }
    })().then((value) => {
      metaCache.delete(rk) // re-insert: the Map's order is the eviction order
      metaCache.set(rk, { at: Date.now(), value, promise: null })
      while (metaCache.size > META_MAX) metaCache.delete(metaCache.keys().next().value)
      return value
    })
    metaCache.set(rk, { at: e?.at || 0, value: e?.value || null, promise })
    return promise
  }

  // --- players ---
  function loadPlayers() {
    const v = readJsonFile(playersFile, [])
    const rows = Array.isArray(v) ? v : list(v?.players)
    players = rows.filter((p) => isDict(p) && MACHINE_ID_RE.test(String(p.machineId || '')))
      .map((p) => ({
        machineId: String(p.machineId),
        name: str(p.name) || 'Plex player',
        product: str(p.product),
        platform: str(p.platform),
        firstSeenAt: str(p.firstSeenAt),
        lastSeenAt: str(p.lastSeenAt),
        lastItem: isDict(p.lastItem) ? p.lastItem : null,
      }))
    savedSeen = new Map(players.map((p) => [p.machineId, p.lastSeenAt]))
  }

  function savePlayers() {
    try {
      writeJsonFileAtomic(playersFile, players, true)
      savedSeen = new Map(players.map((p) => [p.machineId, p.lastSeenAt]))
    } catch (e) {
      logRepeat(`[plex] could not write ${playersFile}: ${e.message}`)
    }
  }

  function publicPlayers() {
    return players
      .map((p) => ({
        name: p.name,
        machineId: p.machineId,
        product: p.product,
        platform: p.platform,
        lastSeenAt: p.lastSeenAt,
        lastItem: p.lastItem,
      }))
      .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
  }

  function notePlayers(sessions, nowIso) {
    let dirty = false
    for (const s of sessions) {
      const p = s.player
      if (!p.machineId || !MACHINE_ID_RE.test(p.machineId)) continue
      const m = s.media
      const lastItem = {
        ratingKey: m.ratingKey,
        type: m.type,
        title: m.title,
        show: m.show,
        season: m.season,
        episode: m.episode,
        year: m.year,
        poster: m.poster,
        at: nowIso,
      }
      let e = players.find((x) => x.machineId === p.machineId)
      if (!e) {
        e = { machineId: p.machineId, name: p.name, product: p.product, platform: p.platform,
          firstSeenAt: nowIso, lastSeenAt: nowIso, lastItem }
        players.push(e)
        log(`[plex] new player "${p.name}" (${p.product || 'unknown product'}, ${p.machineId})`)
        dirty = true
        continue
      }
      if (e.name !== p.name || e.product !== p.product || e.platform !== p.platform) {
        Object.assign(e, { name: p.name, product: p.product, platform: p.platform })
        dirty = true
      }
      if (e.lastItem?.ratingKey !== lastItem.ratingKey) {
        e.lastItem = lastItem
        dirty = true
      } else {
        e.lastItem = { ...e.lastItem, at: nowIso }
      }
      e.lastSeenAt = nowIso
      const saved = Date.parse(savedSeen.get(p.machineId) || '')
      if (!Number.isFinite(saved) || Date.parse(nowIso) - saved >= PLAYERS_SAVE_MS) dirty = true
    }
    if (dirty) savePlayers()
  }

  // --- the snapshot ---
  function build(fetchedAt) {
    const iso = fetchedAt.toISOString()
    const seen = new Set()
    const sessions = []
    for (const m of lastRaw) {
      const rk = str(m.ratingKey)
      const meta = metaFor(rk)
      const show = str(m.type) === 'episode'
        ? metaFor(str(m.grandparentRatingKey) || str(meta?.grandparentRatingKey))
        : null
      const key = sessionKeyOf(m)
      const offset = Math.max(0, int(m.viewOffset) ?? 0)
      const state = normState(m.Player?.state)
      const prev = offsets.get(key)
      const offsetAt = prev && prev.rk === rk && prev.offset === offset && prev.state === state ? prev.at : iso
      offsets.set(key, { rk, offset, state, at: offsetAt })
      seen.add(key)
      const s = normalizeSession(m, { meta, show, offsetAt, clients })
      if (!s) continue
      const look = tmdb ? tmdbLookup(s.media) : null
      const credits = look ? tmdb.cachedCredits(look) : null
      if (Array.isArray(credits) && credits.length) {
        s.media.cast = credits
        s.media.castSource = 'tmdb'
      }
      sessions.push(s)
    }
    for (const k of [...offsets.keys()]) if (!seen.has(k)) offsets.delete(k)
    notePlayers(sessions, iso)
    snapshot = { fetchedAt: iso, error: null, sessions, players: publicPlayers() }
  }

  // Never rejects. Plex down: the last snapshot stays, with `error`. The
  // latch is cleared in a chained .finally(), which always runs after the
  // assignment below; a finally inside the async body would run first when
  // the body never awaits (a fixture that fails to read), leaving inFlight
  // set to a settled promise and every later poll a no-op.
  function poll(reason = 'timer') {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const fetchedAt = new Date()
      try {
        const payload = fixtureFile ? readFixture().sessions : await plexJson('/status/sessions')
        // A fixture's players list is a file read: keep it in step with its sessions.
        if (fixtureFile) await pollClients()
        const raw = metadataList(payload).filter((m) => isDict(m) && !DROPPED_TYPES.has(str(m.type)))
        await Promise.all(raw.map((m) => ensureMeta(str(m.ratingKey))))
        await Promise.all(raw.filter((m) => str(m.type) === 'episode').map((m) =>
          ensureMeta(str(m.grandparentRatingKey) || str(metaFor(str(m.ratingKey))?.grandparentRatingKey))))
        lastRaw = raw
        const wasError = snapshot.error
        build(fetchedAt)
        if (wasError) log(`[plex] sessions answering again (${raw.length} video session(s))`)
        // TMDB credits for an item seen for the first time: waited on briefly
        // so the first snapshot usually has them.
        if (tmdb && tmdb.configured()) {
          const pending = snapshot.sessions.map((s) => tmdbLookup(s.media))
            .filter((l) => l && tmdb.cachedCredits(l) === undefined)
            .map((l) => tmdb.credits(l))
          if (pending.length) {
            await Promise.race([Promise.all(pending), sleep(CREDITS_WAIT_MS)])
            build(fetchedAt)
          }
        }
      } catch (e) {
        snapshot = { ...snapshot, error: e.message }
        logRepeat(`[plex] sessions (${reason}): ${e.message}; ` +
          (snapshot.fetchedAt ? `keeping the snapshot from ${snapshot.fetchedAt}` : 'no snapshot yet'))
      }
      return snapshot
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  function markControllable() {
    snapshot = {
      ...snapshot,
      sessions: snapshot.sessions.map((s) => {
        const c = !!(clients && s.player.machineId && clients.has(s.player.machineId))
        return c === s.controllable ? s : { ...s, controllable: c }
      }),
    }
  }

  // GET /clients: which players advertise, so a command can reach them.
  function pollClients() {
    if (clientsInFlight) return clientsInFlight
    clientsInFlight = (async () => {
      try {
        const next = fixtureFile ? clientIds(readFixture().clients || []) : clientIds(await plexJson('/clients'))
        const before = clients ? [...clients].sort().join(',') : null
        clients = next
        clientsError = null
        if ([...next].sort().join(',') !== before) {
          log(`[plex] players advertising for control: ${next.size ? [...next].join(', ') : 'none'}`)
          markControllable()
        }
      } catch (e) {
        clientsError = e.message
        logRepeat(`[plex] clients: ${e.message}`)
      }
      clientsAt = Date.now()
      return clients
    })().finally(() => {
      clientsInFlight = null // after the assignment below, as in poll()
    })
    return clientsInFlight
  }

  async function relay(machineId, path) {
    const q = `commandID=${++commandSeq}&type=video&X-Plex-Target-Client-Identifier=${encodeURIComponent(machineId)}`
    try {
      const { res } = await plexGet(`${path}${path.includes('?') ? '&' : '?'}${q}`, {
        headers: { 'X-Plex-Target-Client-Identifier': machineId },
      })
      if (res.ok) {
        // Pick the new state up at once rather than on the next 5 s tick.
        setTimeout(() => poll('command'), 800).unref?.()
        return { ok: true, status: res.status, error: null }
      }
      if (res.status === 404) return { ok: false, status: 404, error: NOT_ADVERTISING }
      if (res.status === 401) return { ok: false, status: 401, error: 'Plex refused the token (HTTP 401)' }
      return { ok: false, status: res.status, error: `Plex answered HTTP ${res.status}` }
    } catch (e) {
      return { ok: false, status: 502, error: e.message }
    }
  }

  // POST /api/plex/command { machineId, action } -> { ok, status, error }.
  async function command(body) {
    const machineId = str(body?.machineId)
    const action = str(body?.action)
    if (!machineId || !MACHINE_ID_RE.test(machineId)) return { ok: false, status: 400, error: 'machineId required' }
    if (!ACTIONS.includes(action)) return { ok: false, status: 400, error: `action must be one of ${ACTIONS.join(', ')}` }
    if (fixtureFile) return { ok: false, status: 409, error: 'fixture mode: commands are not sent to Plex' }
    if (!getToken()) return { ok: false, status: 503, error: NO_TOKEN }
    if (checkClients && !clients?.has(machineId)) {
      if (Date.now() - clientsAt > CLIENTS_FRESH_MS) await pollClients()
      if (!clients?.has(machineId)) return { ok: false, status: 404, error: NOT_ADVERTISING }
    }
    const session = snapshot.sessions.find((s) => s.player.machineId === machineId) || null
    const built = commandPath(action, session, Date.now())
    if (built.error) return { ok: false, status: 409, error: built.error }
    const r = await relay(machineId, built.path)
    log(`[plex] command ${action} -> ${session?.player.name || machineId}: ${r.ok ? 'ok' : r.error}`)
    return r
  }

  // --- "In your Plex library": everything else a person is in ---
  // /hubs/search answers a name with an Actors hub: one entry per library
  // section they appear in, keyed by Plex's own tag id (an exact filter,
  // /library/sections/<id>/all?actor=<tag>), so no title matching and no
  // per-item metadata reads. Best-rated first. Cached 24 h per name.
  async function searchPerson(name) {
    const payload = await plexJson(`/hubs/search?query=${encodeURIComponent(name)}&limit=30`)
    const want = normName(name)
    const hubs = list(payload?.MediaContainer?.Hub)
    const actors = hubs.filter((h) => str(h?.type) === 'actor').flatMap((h) => list(h.Directory))
    const keys = actors
      .filter((d) => normName(d?.tag) === want)
      .map((d) => str(d.key))
      .filter((k) => k && /^\/library\/sections\/\d+\/all\?[\w=&.%-]+$/.test(k))
    const items = []
    for (const k of [...new Set(keys)].slice(0, 6)) {
      try {
        const res = await plexJson(`${k}&sort=audienceRating:desc`, {
          headers: { 'X-Plex-Container-Start': '0', 'X-Plex-Container-Size': String(LIBRARY_MAX + 4) },
        })
        for (const m of metadataList(res)) {
          const type = str(m?.type)
          if (type !== 'movie' && type !== 'show') continue
          items.push({
            ratingKey: str(m.ratingKey),
            type,
            title: str(m.title) || '(untitled)',
            year: int(m.year),
            rating: num(m.audienceRating),
            poster: imagePath(str(m.thumb), 240, 360),
          })
        }
      } catch (e) {
        logRepeat(`[plex] library search for "${name}": ${e.message}`)
      }
    }
    const seen = new Set()
    return items
      .filter((x) => x.ratingKey && !seen.has(x.ratingKey) && seen.add(x.ratingKey))
      .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
      .slice(0, LIBRARY_MAX + 4)
  }

  async function inLibrary(name, { exclude } = {}) {
    const key = normName(name)
    if (!key) return []
    const skip = excludeSet(exclude)
    const now = Date.now()
    let e = searchCache.get(key)
    if (!e || (!e.promise && now - e.at >= (e.value ? SEARCH_TTL_MS : SEARCH_RETRY_MS))) {
      const promise = searchPerson(String(name).trim())
        .then((value) => {
          searchCache.set(key, { at: Date.now(), value, promise: null })
          while (searchCache.size > SEARCH_MAX) searchCache.delete(searchCache.keys().next().value)
          return value
        })
        .catch((err) => {
          searchCache.set(key, { at: Date.now(), value: null, promise: null })
          throw err
        })
      e = { at: now, value: e?.value || null, promise }
      searchCache.set(key, e)
    }
    const value = e.promise ? await e.promise : e.value
    return list(value).filter((x) => !skip.has(x.ratingKey)).slice(0, LIBRARY_MAX)
  }

  // GET /api/plex/person?tmdbId=&name=&exclude= -> { status, body }.
  async function person({ tmdbId, name, exclude } = {}) {
    const id = str(tmdbId)
    if (id && !/^\d{1,10}$/.test(id)) return { status: 400, body: { ok: false, error: 'tmdbId must be a number' } }
    let card = null
    if (id && tmdb) {
      try {
        card = await tmdb.person(id)
      } catch (e) {
        logRepeat(`[plex] TMDB person ${id}: ${e.message}`)
      }
    }
    const who = card?.name || str(name)
    if (!who) return { status: 400, body: { ok: false, error: 'tmdbId or name required' } }
    let lib = []
    let error = null
    try {
      lib = await inLibrary(who, { exclude })
    } catch (e) {
      error = `library search: ${e.message}`
    }
    return {
      status: 200,
      body: {
        ok: true,
        name: who,
        tmdbId: card?.tmdbId ?? (id ? Number(id) : null),
        profile: card?.profile ?? null,
        biography: card?.biography ?? null,
        birthday: card?.birthday ?? null,
        deathday: card?.deathday ?? null,
        placeOfBirth: card?.placeOfBirth ?? null,
        knownForDepartment: card?.knownForDepartment ?? null,
        knownFor: card?.knownFor ?? [],
        inLibrary: lib,
        tmdb: { configured: !!(tmdb && tmdb.configured()), found: !!card },
        error,
      },
    }
  }

  // GET /api/plex/image?path=&w=&h= -> { status, type, body } or { status, json }.
  async function image(params) {
    const path = params.get('path')
    if (!isImagePath(path)) return { status: 400, json: { error: 'path must be a Plex /library/ or /photo/ path' } }
    const clamp = (v, d) => {
      const n = Number.parseInt(v ?? '', 10)
      return Number.isFinite(n) ? Math.min(2000, Math.max(16, n)) : d
    }
    const w = clamp(params.get('w'), 600)
    const h = clamp(params.get('h'), w)
    if (!getToken()) return { status: 503, json: { error: NO_TOKEN } }
    // format=jpeg: without it the transcoder hands back a PNG source as PNG
    // (labelled image/jpeg), five times the bytes of the JPEG (a 600x900
    // poster: 1.1 MB against 190 kB), which the Echo would pull on every item.
    const q = `width=${w}&height=${h}&minSize=1&upscale=1&format=jpeg&quality=${IMAGE_QUALITY}` +
      `&url=${encodeURIComponent(path)}`
    try {
      const { res, body } = await plexGet(`/photo/:/transcode?${q}`, {
        timeoutMs: IMAGE_TIMEOUT_MS,
        headers: { Accept: 'image/*' },
      })
      if (!res.ok || !body.length) {
        return { status: res.status === 404 ? 404 : 502, json: { error: `Plex image: HTTP ${res.status}` } }
      }
      const type = res.headers.get('content-type') || 'image/jpeg'
      if (!/^image\//i.test(type)) return { status: 502, json: { error: `Plex image: ${type}` } }
      return { status: 200, type, body }
    } catch (e) {
      return { status: 502, json: { error: e.message } }
    }
  }

  return {
    // Restore the players seen before, then poll. Returns what was restored.
    start() {
      loadPlayers()
      snapshot = { ...snapshot, players: publicPlayers() }
      poll('startup')
      pollClients()
      pollTimer = setInterval(() => poll('timer'), POLL_MS)
      pollTimer.unref?.()
      clientsTimer = setInterval(() => pollClients(), CLIENTS_MS)
      clientsTimer.unref?.()
      return { players: players.length }
    },
    stop() {
      clearInterval(pollTimer)
      clearInterval(clientsTimer)
    },
    poll,
    pollClients,
    // GET /api/plex/now. servedAt lets a screen age offsetAt without trusting
    // its own clock against the hub's.
    now() {
      return {
        ...snapshot,
        servedAt: new Date().toISOString(),
        source: fixtureFile ? 'fixture' : 'plex',
        tmdb: !!(tmdb && tmdb.configured()),
      }
    },
    playersResponse() {
      return { players: snapshot.players, fetchedAt: snapshot.fetchedAt }
    },
    health() {
      return {
        sessions: snapshot.sessions.length,
        error: snapshot.error,
        controllable: snapshot.sessions.filter((s) => s.controllable).length,
        clients: clients ? clients.size : null,
        clientsError,
        players: players.length,
        fetchedAt: snapshot.fetchedAt,
        fixture: !!fixtureFile,
      }
    },
    command,
    person,
    inLibrary,
    image,
    configured: () => !!getToken(),
  }
}
