// tmdb.mjs - The Movie Database, for the Plex view's cast board and person cards.
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
//     -> { cast: [{ name, role, thumb, tmdbPersonId, guest, regular, order }],
//          total }: every credited person (a picture when TMDB has one, else
//        thumb: null; the cast board wants everyone, not just who has a
//        photo), capped at CAST_MAX = 60, `total` the count before the cap.
//        A movie's cast in billing order. An episode's own cast, then its
//        guest stars (guest: true), then - always, so a thin episode credit
//        never shows five people for a full ensemble show - the series'
//        regular cast from GET /3/tv/{id}/aggregate_credits (falling back to
//        GET /3/tv/{id}/credits when aggregate has nothing), regular: true,
//        for anyone not already listed. Deduped by TMDB person id, else by
//        normalised name. thumb = https://image.tmdb.org/t/p/w342<profile_path>,
//        public, so a screen loads it directly. Cached 24 h per item; the
//        series' regular cast is one more call, cached 24 h per series id
//        (shared by every episode of the show, so a poll never repeats it).
//   cachedCredits(lookup)  the same, synchronously: undefined when not
//        fetched yet (or expired), else { cast, total } (cast possibly []).
//   person(id)  GET /3/person/{id}?append_to_response=combined_credits ->
//        { tmdbId, name, profile, profileLarge, age, biography, birthday,
//          deathday, placeOfBirth, knownForDepartment,
//          knownFor: [{ tmdbId, mediaType: 'movie'|'tv', title, year,
//                       poster, character }] }
//        profile is w185 (small, for a cast row's tap target); profileLarge
//        is h632, for the full-screen person card. age is whole years at
//        death, or today when still alive; null with no birthday.
//        knownFor: acting credits by vote_count, highest first, deduped by
//        title, talk / news / reality TV left out (every actor's most-voted
//        "credit" is otherwise a late-night show), top KNOWN_FOR_MAX = 12;
//        posters w342. Cached 24 h. lib/plex.mjs adds inLibrary/plexRatingKey
//        to each knownFor entry (it needs the Plex library search, which this
//        module does not do).
//
// A 404 is cached as "nothing there" for 6 h; a failure (network, 5xx, a
// refused key) is retried after 10 minutes and logged at most every 10.

import { fetchWithTimeout, isDict } from './io.mjs'

export const TMDB_API = 'https://api.themoviedb.org/3'
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p'
export const CAST_MAX = 60
export const KNOWN_FOR_MAX = 12
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

// One TMDB cast/guest_stars row -> our shape, or null for a malformed one. On
// an aggregate-credits row the character sits in roles[0] instead of
// directly on the row. No profile_path filter: every credited person is
// kept, thumb null when TMDB has no picture.
function castEntry(c, { guest, regular }) {
  if (!isDict(c) || c.id == null || !str(c.name)) return null
  return {
    name: str(c.name),
    role: str(c.character) || str(list(c.roles)[0]?.character) || '',
    thumb: profileUrl(c.profile_path, 'w342'),
    tmdbPersonId: Number(c.id),
    guest,
    regular,
  }
}

function rowsOf(arr, flags) {
  return list(arr).slice().sort(byOrder).map((c) => castEntry(c, flags)).filter(Boolean)
}

// A movie's (or a show's plain, non-aggregate) credits payload -> billing-order rows.
export function movieCastRows(payload) {
  return isDict(payload) ? rowsOf(payload.cast, { guest: false, regular: false }) : []
}

// An episode credits payload -> its own cast, in order, then its guest
// stars, in order, flagged guest: true.
export function episodeCastRows(payload) {
  if (!isDict(payload)) return []
  return [
    ...rowsOf(payload.cast, { guest: false, regular: false }),
    ...rowsOf(payload.guest_stars, { guest: true, regular: false }),
  ]
}

// A series aggregate_credits (or plain credits, as a fallback) payload -> its
// regular cast, in the show's own billing order, flagged regular: true.
export function regularCastRows(payload) {
  return isDict(payload) ? rowsOf(payload.cast, { guest: false, regular: true }) : []
}

const normKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()

// Merge rows from several already-flagged, already-ordered lists (an
// episode's cast, then its guests, then a show's regulars): a later list's
// repeat of an earlier person is dropped, by TMDB person id, else by
// normalised name (for the rare row with no id). Returns the merged list
// capped at `max` with `order` set to its final position, and `total`, the
// count before the cap - so a cast board can say "and N more" honestly.
export function combineCast(lists, max = CAST_MAX) {
  const seenIds = new Set()
  const seenNames = new Set()
  const merged = []
  for (const rows of list(lists)) {
    for (const c of list(rows)) {
      if (!isDict(c)) continue
      const idKey = Number.isFinite(c.tmdbPersonId) ? c.tmdbPersonId : null
      const nameKey = normKey(c.name)
      if (idKey != null ? seenIds.has(idKey) : seenNames.has(nameKey)) continue
      if (idKey != null) seenIds.add(idKey)
      seenNames.add(nameKey)
      merged.push(c)
    }
  }
  return { cast: merged.slice(0, max).map((c, i) => ({ ...c, order: i })), total: merged.length }
}

function yearOf(d) {
  const m = /^(\d{4})-/.exec(str(d) || '')
  return m ? Number(m[1]) : null
}

// Whole years lived at deathday, or as of `now` when still alive. null with
// no birthday, or with either date unparsable.
export function ageFromBirthday(birthday, deathday, now = new Date()) {
  const b = str(birthday)
  if (!b) return null
  const bd = new Date(b)
  const end = str(deathday) ? new Date(str(deathday)) : now
  if (Number.isNaN(bd.getTime()) || Number.isNaN(end.getTime())) return null
  let age = end.getUTCFullYear() - bd.getUTCFullYear()
  const beforeBirthday = end.getUTCMonth() < bd.getUTCMonth() ||
    (end.getUTCMonth() === bd.getUTCMonth() && end.getUTCDate() < bd.getUTCDate())
  if (beforeBirthday) age -= 1
  return age >= 0 ? age : null
}

// A person payload (with combined_credits appended) -> the person card.
// `now`: tests pass a fixed clock for `age`; live calls use the real time.
export function personFromTmdb(p, now = new Date()) {
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
    profileLarge: profileUrl(p.profile_path, 'h632'),
    age: ageFromBirthday(p.birthday, p.deathday, now),
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

  // A series' regular cast: aggregate_credits (roles per person, so a
  // recurring guest still reads as a regular), falling back to plain
  // credits when aggregate has nothing. Cached 24 h per series id, shared by
  // every episode of the show.
  async function loadRegularRows(showId) {
    const agg = await get(`/tv/${showId}/aggregate_credits`)
    if (agg && !agg.notFound && list(agg.cast).length) {
      return { value: regularCastRows(agg), ttl: TTL_MS }
    }
    const plain = await get(`/tv/${showId}/credits`)
    if (!plain || plain.notFound || !list(plain.cast).length) return { value: [], ttl: MISS_TTL_MS }
    return { value: regularCastRows(plain), ttl: TTL_MS }
  }

  function seriesRegularRows(showId) {
    return cached(`aggregate:${showId}`, () => loadRegularRows(showId))
  }

  async function loadCredits(l) {
    if (l.kind === 'movie') {
      const r = await get(`/movie/${l.id}/credits`)
      if (!r || r.notFound) return { value: { cast: [], total: 0 }, ttl: MISS_TTL_MS }
      const { cast, total } = combineCast([movieCastRows(r)])
      return { value: { cast, total }, ttl: TTL_MS }
    }
    const episodeR = await get(`/tv/${l.showId}/season/${Number(l.season)}/episode/${Number(l.episode)}/credits`)
    const episodeRows = episodeR && !episodeR.notFound ? episodeCastRows(episodeR) : []
    // Always merged in, not just when the episode credits are thin: an
    // ensemble show's regulars belong on the board even when TMDB's episode
    // credits are complete on their own.
    const regularRows = await seriesRegularRows(l.showId)
    const { cast, total } = combineCast([episodeRows, regularRows])
    if (!cast.length) return { value: { cast: [], total: 0 }, ttl: MISS_TTL_MS }
    return { value: { cast, total }, ttl: TTL_MS }
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
