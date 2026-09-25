import { useEffect, useState, useSyncExternalStore } from 'react'
import { hubUrl } from '../lib/hub.js'
import { READ_ONLY, deepEqual } from '../lib/settings.js'

// usePlexNow - what Plex is playing, from the hub.
//
// FrameServer polls Plex every 5 s and serves the result normalized
// (frameserver/lib/plex.mjs has the full shape):
//
//   GET hubUrl('/api/plex/now') ->
//   { fetchedAt, error, servedAt, source, tmdb,
//     sessions: [{ key, player: { name, machineId, product, platform, address,
//                                 local, state },
//                  user,
//                  media: { type, ratingKey, title, show, showRatingKey, season,
//                           episode, episodeTitle, year, airDate, durationMs,
//                           offsetMs, offsetAt, contentRating, rating,
//                           ratingSource, tagline, summary, genres, directors,
//                           writers, studio, poster, art, ultraBlur, cast,
//                           castSource, subtitles, subtitlesOn, guids,
//                           showGuids },
//                  controllable }],
//     players: [{ name, machineId, product, platform, lastSeenAt, lastItem }] }
//
// Same pattern as hooks/useCalendar.js: a module store read with
// useSyncExternalStore that polls only while something needs it. Two kinds of
// subscriber: ACTIVE ones keep the 5 s poll running (the Plex view while it is
// on screen, and the shell's follow logic while display.plexFollow names a
// player), PASSIVE ones only listen (the Settings row, which asks for the
// player list once). No poll at all on a screen that does not follow Plex.
// Hidden pages (a laptop lid, Silk in the background) stop polling and ask
// again the moment they are visible.
//
// Snapshot: { sessions, players, fetchedAt, error, hubError, plexError,
//   plexDown, stale, loaded, tmdb }
//   hubError   this screen could not reach the hub (or it answered badly)
//   plexError  the hub's own error: Plex unreachable, no token
//   plexDown   plexError, and the hub's last good copy is over 15 s old: one
//              failed poll is a blip, three are an outage
//   error      hubError || plexError
//   stale      no good answer from the hub for 30 s (or none yet)
//   loaded     the hub has answered at least once
// Each session's media also carries offsetBaseMs / offsetBaseAt: the offset
// aged to the moment this screen received it, measured with the hub's clock
// (servedAt - offsetAt) and then this screen's (Date.now() - offsetBaseAt),
// so a screen whose clock is off by a minute still draws the right progress.
// currentOffsetMs(session) advances it while playing.

const POLL_MS = 5 * 1000
const STALE_AFTER_MS = 30 * 1000
const FETCH_TIMEOUT_MS = 8 * 1000
// Collapses StrictMode's double subscribe and bursts of visibility changes.
const MIN_POLL_GAP_MS = 1000
// The hub's copy may be this old, with an error, before Plex counts as down.
const PLEX_DOWN_AFTER_MS = 15 * 1000
// After a transport command, look again this soon rather than on the tick.
const AFTER_COMMAND_MS = 1500

export const PLEX_OFF = 'off'

// Dev only (never in a build): ?plexTest=<machineId> follows that player as
// if display.plexFollow named it, without saving anything, so the follow
// logic can be exercised from a laptop.
export const PLEX_TEST_FOLLOW =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('plexTest') || null
    : null

// The machineId this screen follows, or PLEX_OFF.
export function effectivePlexFollow(setting) {
  if (PLEX_TEST_FOLLOW) return PLEX_TEST_FOLLOW
  const v = typeof setting === 'string' ? setting.trim() : ''
  return v && v !== PLEX_OFF ? v : PLEX_OFF
}

function emptyState() {
  return {
    sessions: [],
    players: [],
    fetchedAt: null,
    error: null,
    hubError: null,
    plexError: null,
    plexDown: false,
    stale: true,
    loaded: false,
    tmdb: null,
  }
}

const SERVER_SNAPSHOT = Object.freeze(emptyState())

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function parseMs(v) {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

// Sessions as the hub sent them, with the local offset base. A session whose
// offset, offsetAt and state did not move keeps the base it already has, so
// an unchanged poll is structurally identical and is dropped by publish().
function localize(raw, prev, receivedAt, servedAtMs) {
  const out = []
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!isObj(s) || !isObj(s.media) || !isObj(s.player)) continue
    const m = s.media
    const old = prev.find((p) => p.key === s.key)
    const same =
      old &&
      old.media.ratingKey === m.ratingKey &&
      old.media.offsetMs === m.offsetMs &&
      old.media.offsetAt === m.offsetAt &&
      old.player.state === s.player.state
    let offsetBaseMs
    let offsetBaseAt
    if (same) {
      offsetBaseMs = old.media.offsetBaseMs
      offsetBaseAt = old.media.offsetBaseAt
    } else {
      const at = parseMs(m.offsetAt)
      const age =
        s.player.state === 'playing' && at != null && servedAtMs != null ? Math.max(0, servedAtMs - at) : 0
      offsetBaseMs = (Number(m.offsetMs) || 0) + age
      offsetBaseAt = receivedAt
    }
    out.push({
      ...s,
      media: {
        ...m,
        cast: Array.isArray(m.cast) ? m.cast.filter((c) => isObj(c) && str(c.name)) : [],
        genres: Array.isArray(m.genres) ? m.genres : [],
        directors: Array.isArray(m.directors) ? m.directors : [],
        subtitles: Array.isArray(m.subtitles) ? m.subtitles : [],
        offsetBaseMs,
        offsetBaseAt,
      },
    })
  }
  return out
}

let current = emptyState()
let lastOkAt = null
let inFlight = false
let lastPollStartedAt = 0
let intervalId = null
let activeCount = 0
const listeners = new Set()

function keep(prev, next) {
  return deepEqual(prev, next) ? prev : next
}

function publish(next) {
  const merged = {
    ...next,
    sessions: keep(current.sessions, next.sessions),
    players: keep(current.players, next.players),
  }
  const same =
    merged.sessions === current.sessions &&
    merged.players === current.players &&
    merged.error === current.error &&
    merged.hubError === current.hubError &&
    merged.plexError === current.plexError &&
    merged.plexDown === current.plexDown &&
    merged.stale === current.stale &&
    merged.loaded === current.loaded &&
    merged.tmdb === current.tmdb
  if (same) return
  current = merged
  listeners.forEach((fn) => fn())
}

function accept(payload, receivedAt) {
  lastOkAt = receivedAt
  const plexError = str(payload.error)
  // Both times are the hub's clock.
  const servedAtMs = parseMs(payload.servedAt)
  const fetchedAtMs = parseMs(payload.fetchedAt)
  const plexDown =
    !!plexError && (servedAtMs == null || fetchedAtMs == null || servedAtMs - fetchedAtMs > PLEX_DOWN_AFTER_MS)
  publish({
    sessions: localize(payload.sessions, current.sessions, receivedAt, servedAtMs),
    players: Array.isArray(payload.players) ? payload.players.filter((p) => isObj(p) && str(p.machineId)) : current.players,
    fetchedAt: fetchedAtMs,
    error: plexError,
    hubError: null,
    plexError,
    plexDown,
    stale: false,
    loaded: true,
    tmdb: typeof payload.tmdb === 'boolean' ? payload.tmdb : null,
  })
}

function fail(err) {
  const hubError =
    err && err.name === 'AbortError' ? 'timed out' : String((err && err.message) || err || 'unreachable')
  publish({
    ...current,
    hubError,
    error: hubError,
    stale: lastOkAt == null || Date.now() - lastOkAt > STALE_AFTER_MS,
  })
}

async function poll(force = false) {
  if (typeof fetch === 'undefined' || inFlight) return
  const startedAt = Date.now()
  if (!force && startedAt - lastPollStartedAt < MIN_POLL_GAP_MS) return
  lastPollStartedAt = startedAt
  inFlight = true
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(hubUrl('/api/plex/now'), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const payload = await res.json()
    if (!isObj(payload) || !Array.isArray(payload.sessions)) throw new Error('bad /api/plex/now payload')
    accept(payload, Date.now())
  } catch (err) {
    fail(err)
  } finally {
    if (timeout) clearTimeout(timeout)
    inFlight = false
  }
}

function visible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

// Poll while an active subscriber exists and the page is visible.
function reconcile() {
  const want = activeCount > 0 && visible() && typeof window !== 'undefined'
  if (want && intervalId == null) {
    poll()
    intervalId = setInterval(poll, POLL_MS)
  } else if (!want && intervalId != null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', reconcile)
}

// Raw subscription for code outside render (the shell's follow logic): an
// active one keeps the poll alive until the returned function is called.
export function subscribePlexNow(fn, { active = true } = {}) {
  listeners.add(fn)
  if (active) activeCount += 1
  reconcile()
  let done = false
  return () => {
    if (done) return
    done = true
    listeners.delete(fn)
    if (active) activeCount -= 1
    reconcile()
  }
}

const subscribeActive = (fn) => subscribePlexNow(fn, { active: true })
const subscribePassive = (fn) => subscribePlexNow(fn, { active: false })
const getSnapshot = () => current

// The Plex view: live data, polled every 5 s while mounted.
export default function usePlexNow() {
  return useSyncExternalStore(subscribeActive, getSnapshot, () => SERVER_SNAPSHOT)
}

export function getPlexNow() {
  return current
}

// The session playing on one player, or null.
export function sessionForPlayer(machineId, snap = current) {
  if (!machineId || machineId === PLEX_OFF) return null
  return snap.sessions.find((s) => s.player?.machineId === machineId) || null
}

// What a screen shows: the followed player's session; following nobody, the
// first one playing, else the first at all.
export function pickSession(snap, follow) {
  if (follow && follow !== PLEX_OFF) return sessionForPlayer(follow, snap)
  return snap.sessions.find((s) => s.player?.state === 'playing') || snap.sessions[0] || null
}

// Where the item is now, in ms: advanced locally while playing.
export function currentOffsetMs(session, nowMs = Date.now()) {
  const m = session?.media
  if (!m) return 0
  const dur = Number(m.durationMs) || 0
  let v = Number(m.offsetMs) || 0
  if (session.player?.state === 'playing' && Number.isFinite(m.offsetBaseAt)) {
    v = (Number(m.offsetBaseMs) || 0) + Math.max(0, nowMs - m.offsetBaseAt)
  }
  v = Math.max(0, v)
  return dur > 0 ? Math.min(dur, v) : v
}

// A picture the hub serves ('/api/plex/image?...') or an absolute URL
// (TMDB, metadata-static.plex.tv). w / h resize a hub image.
export function plexImageUrl(src, w, h) {
  const s = str(src)
  if (!s) return null
  if (!s.startsWith('/')) return s
  if (w && h && s.startsWith('/api/plex/image?')) {
    const q = new URLSearchParams(s.slice('/api/plex/image?'.length))
    q.set('w', String(w))
    q.set('h', String(h))
    return hubUrl(`/api/plex/image?${q.toString()}`)
  }
  return hubUrl(s)
}

// Transport: 'play' | 'pause' | 'stop' | 'back' | 'forward' | 'ccOn' | 'ccOff'.
// Resolves the hub's { ok, status, error }; never rejects. The layout
// editor's preview (READ_ONLY) never sends one.
export async function postPlexCommand(machineId, action) {
  if (READ_ONLY) return { ok: false, status: 0, error: 'read-only preview' }
  if (typeof fetch === 'undefined') return { ok: false, status: 0, error: 'no fetch' }
  try {
    const res = await fetch(hubUrl('/api/plex/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machineId, action }),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => null)
    if (body && typeof body.ok === 'boolean') {
      if (body.ok) setTimeout(() => poll(true), AFTER_COMMAND_MS)
      return { ok: body.ok, status: body.status ?? res.status, error: body.error ?? null }
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}` }
  } catch {
    return { ok: false, status: 0, error: 'hub unreachable' }
  }
}

// A person card: TMDB (when the hub has a key) and what else of theirs is in
// the Plex library. Cached for the page's life; a failure is not cached.
const personCache = new Map()
export async function fetchPlexPerson({ tmdbId, name, exclude }) {
  const q = new URLSearchParams()
  if (tmdbId != null && tmdbId !== '') q.set('tmdbId', String(tmdbId))
  if (name) q.set('name', name)
  const ex = (Array.isArray(exclude) ? exclude : [exclude]).filter(Boolean)
  if (ex.length) q.set('exclude', ex.join(','))
  const key = q.toString()
  if (personCache.has(key)) return personCache.get(key)
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeout = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null
  try {
    const res = await fetch(hubUrl(`/api/plex/person?${key}`), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
    const body = await res.json().catch(() => null)
    if (!res.ok || !isObj(body)) throw new Error((body && body.error) || `HTTP ${res.status}`)
    personCache.set(key, body)
    return body
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

// The players list for the Settings row: asked for once on mount (no poll),
// and kept current by the live store when this screen polls anyway.
async function refreshPlayers() {
  if (typeof fetch === 'undefined') return
  try {
    const res = await fetch(hubUrl('/api/plex/players'), { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json()
    if (isObj(body) && Array.isArray(body.players)) {
      publish({ ...current, players: body.players.filter((p) => isObj(p) && str(p.machineId)) })
    }
  } catch {
    // hub unreachable: the list stays as it is
  }
}

export function usePlexPlayers() {
  const snap = useSyncExternalStore(subscribePassive, getSnapshot, () => SERVER_SNAPSHOT)
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    let live = true
    refreshPlayers().finally(() => {
      if (live) setAsked(true)
    })
    return () => {
      live = false
    }
  }, [])
  return { players: snap.players, loading: !asked && snap.players.length === 0 }
}
