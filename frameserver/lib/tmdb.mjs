// tmdb.mjs - The Movie Database, for the Plex view's cast row and person cards.
//
// Optional. The key is TMDB_API_KEY from the environment or .env, else the
// file TMDB_API_KEY_FILE (default secrets/tmdb-key.txt, copied by hand, never
// in git). Either form works: a v3 API key (sent as the api_key query
// parameter) or a v4 read access token (a JWT, "eyJ...", sent as a Bearer
// header). The key is never logged or returned. Without one, every call
// resolves null and the Plex view shows Plex's own cast (lib/plex.mjs).
//
// Lookups are by TMDB id only, never by title: Plex's Guid[] carries
// tmdb://<id> for a movie, and for an episode its show's id (on the show's
// metadata) plus the season and episode numbers.
//
//   credits(lookup)  lookup = { kind: 'movie', id } |
//                             { kind: 'episode', showId, season, episode }
//     -> [{ name, role, thumb, tmdbPersonId }], the top 12 that have a
//        profile picture: a movie's cast in billing order; an episode's cast
//        then its guest stars (GET /3/tv/{id}/season/{n}/episode/{m}/credits),
//        falling back to the show's regular cast when TMDB does not know the
//        episode. thumb = https://image.tmdb.org/t/p/w185<profile_path>,
//        public, so a screen loads it directly. Cached 24 h per item.
//   cachedCredits(lookup)  the same, synchronously: undefined when not
//        fetched yet (or expired), else the array (possibly empty).
//   person(id)  GET /3/person/{id}?append_to_response=combined_credits ->
//        { tmdbId, name, profile, biography, birthday, deathday,
//          placeOfBirth, knownForDepartment,
//          knownFor: [{ tmdbId, mediaType: 'movie'|'tv', title, year,
//                       poster, character }] }
//        knownFor: acting credits by vote_count, highest first, deduped by
//        title, talk / news / reality TV left out (every actor's most-voted
//        "credit" is otherwise a late-night show), top 10; posters w342.
//        Cached 24 h.
//
// A 404 is cached as "nothing there" for 6 h; a failure (network, 5xx, a
// refused key) is retried after 10 minutes and logged at most every 10.

import { fetchWithTimeout, isDict } from './io.mjs'

export const TMDB_API = 'https://api.themoviedb.org/3'
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p'
export const CAST_MAX = 12
export const KNOWN_FOR_MAX = 10
const TTL_MS = 24 * 60 * 60 * 1000
const MISS_TTL_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 10 * 60 * 1000
const HTTP_TIMEOUT_MS = 8_000
const CACHE_MAX = 400
const LOG_REPEAT_MS = 10 * 60 * 1000
// TMDB genre ids: News, Reality, Talk.
const SKIP_TV_GENRES = new Set([10763, 10764, 10767])
const ID_RE = /^\d{1,10}$/

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const list = (v) => (Array.isArray(v) ? v : [])

export const profileUrl = (p, size = 'w185') => (str(p) ? `${TMDB_IMAGES}/${size}${p}` : null)
export const posterUrl = (p, size = 'w342') => (str(p) ? `${TMDB_IMAGES}/${size}${p}` : null)

// A v4 read access token is a JWT ("eyJ..."); anything else is a v3 key.
export const isBearerToken = (key) => /^eyJ/.test(String(key || '').trim())

function byOrder(a, b) {
  const x = Number.isFinite(a?.order) ? a.order : 9999
  const y = Number.isFinite(b?.order) ? b.order : 9999
  return x - y
}

// A credits payload -> the cast row. Episodes: cast, then guest stars.
export function creditsFromTmdb(payload, kind = 'movie') {
  if (!isDict(payload)) return []
  const people = [
    ...list(payload.cast).slice().sort(byOrder),
    ...(kind === 'episode' ? list(payload.guest_stars).slice().sort(byOrder) : []),
  ]
  const out = []
  const seen = new Set()
  for (const c of people) {
    if (!isDict(c) || !str(c.profile_path) || !str(c.name) || c.id == null || seen.has(c.id)) continue
    seen.add(c.id)
    out.push({
      name: str(c.name),
      // A regular's role on /tv/{id}/credits sits in roles[]; everywhere
      // else it is `character`.
      role: str(c.character) || str(list(c.roles)[0]?.character),
      thumb: profileUrl(c.profile_path),
      tmdbPersonId: Number(c.id),
    })
    if (out.length >= CAST_MAX) break
  }
  return out
}

function yearOf(d) {
  const m = /^(\d{4})-/.exec(str(d) || '')
  return m ? Number(m[1]) : null
}

// A person payload (with combined_credits appended) -> the person card.
export function personFromTmdb(p) {
  if (!isDict(p) || p.id == null || !str(p.name)) return null
  const credits = list(p.combined_credits?.cast)
    .filter((c) => isDict(c) && (c.media_type === 'movie' || c.media_type === 'tv'))
    .filter((c) => !(c.media_type === 'tv' && list(c.genre_ids).some((g) => SKIP_TV_GENRES.has(g))))
    .filter((c) => str(c.title) || str(c.name))
    .slice()
    .sort((a, b) => (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0))
  const knownFor = []
  const seen = new Set()
  for (const c of credits) {
    const title = str(c.title) || str(c.name)
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    knownFor.push({
      tmdbId: Number(c.id),
      mediaType: c.media_type,
      title,
      year: yearOf(c.media_type === 'movie' ? c.release_date : c.first_air_date),
      poster: posterUrl(c.poster_path),
      character: str(c.character),
    })
    if (knownFor.length >= KNOWN_FOR_MAX) break
  }
  const bio = str(p.biography)
  return {
    tmdbId: Number(p.id),
    name: str(p.name),
    profile: profileUrl(p.profile_path),
    biography: bio && bio.length > 900 ? `${bio.slice(0, 897).replace(/\s+\S*$/, '')}...` : bio,
    birthday: str(p.birthday),
    deathday: str(p.deathday),
    placeOfBirth: str(p.place_of_birth),
    knownForDepartment: str(p.known_for_department),
    knownFor,
  }
}

function creditsKey(l) {
  if (!isDict(l)) return null
  if (l.kind === 'movie' && ID_RE.test(String(l.id))) return `movie:${l.id}`
  if (l.kind === 'episode' && ID_RE.test(String(l.showId)) &&
      Number.isInteger(Number(l.season)) && Number.isInteger(Number(l.episode))) {
    return `tv:${l.showId}:s${Number(l.season)}e${Number(l.episode)}`
  }
  return null
}

// getKey() -> the key or null, read per call (a key added later needs no
// restart). apiBase: tests point it at a stub.
export function createTmdb({ getKey = () => null, apiBase = TMDB_API, log = (m) => console.log(m) } = {}) {
  const base = String(apiBase || TMDB_API).replace(/\/+$/, '')
  const cache = new Map() // key -> { at, ttl, value, promise }
  const lastLog = { msg: null, at: 0 }

  function logRepeat(msg) {
    const now = Date.now()
    if (msg === lastLog.msg && now - lastLog.at < LOG_REPEAT_MS) return
    lastLog.msg = msg
    lastLog.at = now
    log(msg)
  }

  const key = () => str(getKey())

  // A JSON answer, or { notFound: true } for a 404. Throws on anything else.
  async function get(path) {
    const k = key()
    if (!k) return null
    const bearer = isBearerToken(k)
    const url = `${base}${path}${bearer ? '' : `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(k)}`}`
    const { res, body } = await fetchWithTimeout(url, {
      timeoutMs: HTTP_TIMEOUT_MS,
      headers: { Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${k}` } : {}) },
    })
    // The messages below name the path only: the URL carries the key.
    const what = `TMDB ${path.split('?')[0]}`
    if (res.status === 404) return { notFound: true }
    if (res.status === 401) throw new Error(`${what}: the key was refused (HTTP 401)`)
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`)
    try {
      return JSON.parse(body.toString('utf8'))
    } catch {
      throw new Error(`${what}: not JSON`)
    }
  }

  function fresh(e, now = Date.now()) {
    return e && !e.promise && now - e.at < e.ttl
  }

  // Single-flight, cached. load() resolves { value, ttl }.
  function cached(k, load) {
    const e = cache.get(k)
    if (e?.promise) return e.promise
    if (fresh(e)) return Promise.resolve(e.value)
    const promise = load()
      .then(({ value, ttl }) => {
        cache.delete(k)
        cache.set(k, { at: Date.now(), ttl, value, promise: null })
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
        return value
      })
      .catch((err) => {
        logRepeat(`[tmdb] ${k}: ${err.message}`)
        // Keep an older good value if there is one; retry after RETRY_MS.
        cache.set(k, { at: Date.now(), ttl: RETRY_MS, value: e?.value ?? null, promise: null })
        return e?.value ?? null
      })
    cache.set(k, { at: e?.at ?? 0, ttl: e?.ttl ?? 0, value: e?.value, promise })
    return promise
  }

  async function loadCredits(l) {
    if (l.kind === 'movie') {
      const r = await get(`/movie/${l.id}/credits`)
      if (!r || r.notFound) return { value: [], ttl: MISS_TTL_MS }
      return { value: creditsFromTmdb(r, 'movie'), ttl: TTL_MS }
    }
    const r = await get(`/tv/${l.showId}/season/${Number(l.season)}/episode/${Number(l.episode)}/credits`)
    if (r && !r.notFound) {
      const value = creditsFromTmdb(r, 'episode')
      if (value.length) return { value, ttl: TTL_MS }
    }
    // TMDB's numbering can differ from Plex's (specials, split seasons):
    // the show's regular cast is still right for the show.
    const show = await get(`/tv/${l.showId}/credits`)
    if (!show || show.notFound) return { value: [], ttl: MISS_TTL_MS }
    return { value: creditsFromTmdb(show, 'movie'), ttl: TTL_MS }
  }

  return {
    configured: () => !!key(),

    credits(lookup) {
      const k = creditsKey(lookup)
      if (!k || !key()) return Promise.resolve(null)
      return cached(`credits:${k}`, () => loadCredits(lookup))
    },

    cachedCredits(lookup) {
      const k = creditsKey(lookup)
      if (!k || !key()) return null
      const e = cache.get(`credits:${k}`)
      return fresh(e) ? e.value : undefined
    },

    person(id) {
      const s = String(id ?? '')
      if (!ID_RE.test(s) || !key()) return Promise.resolve(null)
      return cached(`person:${s}`, async () => {
        const r = await get(`/person/${s}?append_to_response=combined_credits`)
        if (!r || r.notFound) return { value: null, ttl: MISS_TTL_MS }
        return { value: personFromTmdb(r), ttl: TTL_MS }
      })
    },
  }
}
