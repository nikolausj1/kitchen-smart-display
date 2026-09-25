// plex.test.mjs - lib/plex.mjs: the cast board's Plex side and person matching.
//
//   node --test frameserver/test/plex.test.mjs
//
// normalizeSession and plexCast are exercised against real (trimmed)
// fixtures: The Studio S1E2 "The Oner" (a hand-written /status/sessions
// entry plus its own and its show's /library/metadata) and the standup
// special "Gianmarco Soresi: Thief of Joy". matchKnownFor is a pure
// function, tested directly. inLibrary() (real network inside) is exercised
// against a stubbed globalThis.fetch (swapped back after each test), never a
// real socket, to cover LIBRARY_MAX and the includeGuids=1 tmdbId wiring.

import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAST_MAX, LIBRARY_MAX, createPlex, matchKnownFor, normalizeSession, parseGuids, plexCast, tmdbLookup,
} from '../lib/plex.mjs'
import { combineCast, episodeCastRows, regularCastRows } from '../lib/tmdb.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plex')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const episodeSession = () => fixture('sessions-episode.json').MediaContainer.Metadata[0]
const episodeMeta = () => fixture('plex-episode-77536.json').MediaContainer.Metadata[0]
const showMeta = () => fixture('plex-show-77533.json').MediaContainer.Metadata[0]
const movieSession = () => fixture('sessions-movie.json').MediaContainer.Metadata[0]
const movieMeta = () => fixture('plex-movie-83499.json').MediaContainer.Metadata[0]
const episodeCredits = () => fixture('tmdb-episode-credits.json')
const aggregateCredits = () => fixture('tmdb-series-aggregate-credits.json')

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'plex-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe('constants', () => {
  test('CAST_MAX is 60, LIBRARY_MAX is 12 (bumped for the cast board)', () => {
    assert.equal(CAST_MAX, 60)
    assert.equal(LIBRARY_MAX, 12)
  })
})

describe('plexCast: Plex\'s own Role[] as the fallback cast', () => {
  test('real fixture: the episode\'s 15 roles, in Plex\'s billing order', () => {
    const { cast, total } = plexCast(episodeMeta().Role)
    assert.equal(total, 15)
    assert.equal(cast.length, 15)
    assert.equal(cast[0].name, 'Seth Rogen')
    assert.equal(cast[0].role, 'Matt Remick')
    assert.equal(cast[0].plexId, 1291)
    assert.equal(cast[0].tmdbPersonId, null)
    assert.equal(cast[0].guest, false)
    assert.equal(cast[0].regular, false)
    assert.equal(cast[0].order, 0)
    assert.ok(cast[0].thumb.startsWith('https://metadata-static.plex.tv/'))
    assert.deepEqual(Object.keys(cast[0]),
      ['name', 'role', 'thumb', 'tmdbPersonId', 'plexId', 'guest', 'regular', 'order'])
  })

  test('real fixture: the movie\'s 2 roles', () => {
    const { cast, total } = plexCast(movieMeta().Role)
    assert.equal(total, 2)
    assert.deepEqual(cast.map((c) => c.name), ['Gianmarco Soresi', 'Tovah Silbermann'])
    assert.deepEqual(cast.map((c) => c.role), ['Self', 'Self (uncredited)'])
  })

  test('a Plex-hosted thumb (not a metadata-static.plex.tv URL) is proxied at about 300px wide', () => {
    const { cast } = plexCast([{ id: 1, tag: 'Local Actor', role: 'X', thumb: '/library/metadata/1/thumb/123' }])
    assert.ok(cast[0].thumb.includes('w=300&h=300'), cast[0].thumb)
  })

  test('dedupes by lowercased name, capped at max, with total the pre-cap count', () => {
    const roles = Array.from({ length: 70 }, (_, i) => ({ id: i, tag: `Actor ${i}`, role: 'Self' }))
    roles.splice(3, 0, { id: 999, tag: 'actor 0', role: 'dup, different case' })
    const { cast, total } = plexCast(roles)
    assert.equal(total, 70) // the case-insensitive dup never counted
    assert.equal(cast.length, 60)
    assert.equal(cast[59].order, 59)
  })

  test('no tag: skipped; no role: empty string, not null/undefined', () => {
    const { cast } = plexCast([{ id: 1, tag: 'Has A Name' }, { id: 2, role: 'No name, dropped' }])
    assert.equal(cast.length, 1)
    assert.equal(cast[0].role, '')
  })
})

describe('normalizeSession: cast wiring end to end', () => {
  test('Plex fallback, real episode fixtures: castSource plex, castTotal, guids for the TMDB lookup', () => {
    const s = normalizeSession(episodeSession(), {
      meta: episodeMeta(), show: showMeta(), offsetAt: '2026-09-25T00:00:00.000Z',
      clients: new Set(['TEST-PLAYER-0001']),
    })
    assert.equal(s.media.type, 'episode')
    assert.equal(s.media.show, 'The Studio (2025)')
    assert.equal(s.media.season, 1)
    assert.equal(s.media.episode, 2)
    assert.equal(s.media.castSource, 'plex')
    assert.equal(s.media.castTotal, 15)
    assert.equal(s.media.cast.length, 15)
    assert.equal(s.player.machineId, 'TEST-PLAYER-0001')
    assert.equal(s.controllable, true)
    assert.deepEqual(s.media.guids, { tmdb: '5772135', imdb: 'tt34901367', tvdb: '10814412' })
    assert.deepEqual(s.media.showGuids, { tmdb: '247767', imdb: 'tt23649128', tvdb: '448147' })
    assert.deepEqual(tmdbLookup(s.media), { kind: 'episode', showId: '247767', season: 1, episode: 2 })
  })

  test('Plex fallback, real movie fixture', () => {
    const s = normalizeSession(movieSession(), {
      meta: movieMeta(), offsetAt: '2026-09-25T00:00:00.000Z', clients: new Set(),
    })
    assert.equal(s.media.type, 'movie')
    assert.equal(s.media.title, 'Gianmarco Soresi: Thief of Joy')
    assert.equal(s.media.year, 2025)
    assert.equal(s.media.castSource, 'plex')
    assert.equal(s.media.castTotal, 2)
    assert.equal(s.controllable, false)
    assert.deepEqual(tmdbLookup(s.media), { kind: 'movie', id: '1547831' })
  })

  test('TMDB credits (ctx.credits), once merged, take precedence over Plex\'s own cast', () => {
    const merged = combineCast([episodeCastRows(episodeCredits()), regularCastRows(aggregateCredits())])
    const s = normalizeSession(episodeSession(), {
      meta: episodeMeta(), show: showMeta(), offsetAt: '2026-09-25T00:00:00.000Z',
      clients: new Set(), credits: merged,
    })
    assert.equal(s.media.castSource, 'tmdb')
    assert.equal(s.media.castTotal, 26)
    assert.equal(s.media.cast.length, 26)
    assert.equal(s.media.cast[0].name, 'Seth Rogen')
    assert.equal(s.media.cast[0].tmdbPersonId, 19274)
  })

  test('empty ctx.credits (TMDB had nothing to say) still falls back to Plex\'s own cast', () => {
    const s = normalizeSession(episodeSession(), {
      meta: episodeMeta(), show: showMeta(), offsetAt: '2026-09-25T00:00:00.000Z',
      clients: new Set(), credits: { cast: [], total: 0 },
    })
    assert.equal(s.media.castSource, 'plex')
    assert.equal(s.media.castTotal, 15)
  })
})

describe('matchKnownFor: a person\'s TMDB "known for" against the library search', () => {
  test('matches by TMDB id when the library item\'s own guid is known (includeGuids=1)', () => {
    const knownFor = [{ tmdbId: 76479, mediaType: 'tv', title: 'The Boys', year: 2019, poster: null, character: 'Self' }]
    const lib = [{ ratingKey: '19614', type: 'show', title: 'Something Else Entirely', year: 1999, rating: 8, poster: null, tmdbId: 76479 }]
    const out = matchKnownFor(knownFor, lib)
    assert.equal(out.length, 1)
    assert.equal(out[0].inLibrary, true)
    assert.equal(out[0].plexRatingKey, '19614')
    // Every existing knownFor field survives.
    assert.equal(out[0].title, 'The Boys')
    assert.equal(out[0].character, 'Self')
  })

  test('falls back to normalised title + year within one, when there is no id to match', () => {
    const knownFor = [{ tmdbId: 999, mediaType: 'movie', title: 'Home Alone', year: 1990, poster: null, character: 'Kate' }]
    const lib = [{ ratingKey: '55', type: 'movie', title: '  HOME ALONE  ', year: 1991, rating: 9, poster: null, tmdbId: null }]
    const out = matchKnownFor(knownFor, lib)
    assert.equal(out[0].inLibrary, true)
    assert.equal(out[0].plexRatingKey, '55')
  })

  test('year more than one apart, or a different title: no match, and plexRatingKey is omitted', () => {
    const knownFor = [
      { tmdbId: 1, mediaType: 'movie', title: 'Old Movie', year: 1990, poster: null, character: 'X' },
      { tmdbId: 2, mediaType: 'movie', title: 'Totally Unrelated', year: null, poster: null, character: 'Y' },
    ]
    const lib = [{ ratingKey: '1', type: 'movie', title: 'Old Movie', year: 1993, rating: 5, poster: null, tmdbId: null }]
    const out = matchKnownFor(knownFor, lib)
    assert.equal(out[0].inLibrary, false)
    assert.equal('plexRatingKey' in out[0], false)
    assert.equal(out[1].inLibrary, false)
  })

  test('an empty library: everything comes back not in library', () => {
    const out = matchKnownFor([{ tmdbId: 1, title: 'X', year: 2000 }], [])
    assert.deepEqual(out, [{ tmdbId: 1, title: 'X', year: 2000, inLibrary: false }])
  })
})

describe('inLibrary: LIBRARY_MAX cap and includeGuids=1, against a stubbed Plex', () => {
  const realFetch = globalThis.fetch
  after(() => {
    globalThis.fetch = realFetch
  })

  function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  test('caps at LIBRARY_MAX, best-rated first, and reads a tmdbId from Guid when the search includes it', async (t) => {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/hubs/search')) {
        return jsonResponse({
          MediaContainer: { Hub: [{ type: 'actor', Directory: [{ tag: 'Test Actor', key: '/library/sections/1/all?actor=999' }] }] },
        })
      }
      if (u.includes('/library/sections/1/all')) {
        assert.ok(u.includes('includeGuids=1'), u)
        const items = Array.from({ length: 20 }, (_, i) => ({
          ratingKey: String(100 + i),
          type: 'movie',
          title: `Movie ${i}`,
          year: 2000 + i,
          audienceRating: 20 - i,
          thumb: '/library/metadata/x/thumb',
          Guid: i === 0 ? [{ id: 'tmdb://76479' }] : [],
        }))
        return jsonResponse({ MediaContainer: { Metadata: items } })
      }
      throw new Error(`unexpected Plex url in test: ${u}`)
    }
    const plex = createPlex({ dir: tempDir(t), getToken: () => 'test-token', checkClients: false })
    const lib = await plex.inLibrary('Test Actor')
    assert.equal(lib.length, LIBRARY_MAX)
    assert.deepEqual(lib.map((x) => x.rating), lib.map((x) => x.rating).slice().sort((a, b) => b - a))
    assert.equal(lib[0].title, 'Movie 0')
    assert.equal(lib[0].tmdbId, 76479)
    assert.ok(lib[0].poster.includes('w=300&h=450'), lib[0].poster)
    assert.equal(lib[1].tmdbId, null)
  })

  test('exclude drops rating keys already on screen', async (t) => {
    globalThis.fetch = async (url) => {
      const u = String(url)
      if (u.includes('/hubs/search')) {
        return jsonResponse({
          MediaContainer: { Hub: [{ type: 'actor', Directory: [{ tag: 'Another Actor', key: '/library/sections/2/all?actor=1' }] }] },
        })
      }
      if (u.includes('/library/sections/2/all')) {
        return jsonResponse({
          MediaContainer: {
            Metadata: [
              { ratingKey: '1', type: 'movie', title: 'A', year: 2000, audienceRating: 9, thumb: '/library/t' },
              { ratingKey: '2', type: 'movie', title: 'B', year: 2001, audienceRating: 8, thumb: '/library/t' },
            ],
          },
        })
      }
      throw new Error(`unexpected Plex url in test: ${u}`)
    }
    const plex = createPlex({ dir: tempDir(t), getToken: () => 'test-token', checkClients: false })
    const lib = await plex.inLibrary('Another Actor', { exclude: '1' })
    assert.deepEqual(lib.map((x) => x.ratingKey), ['2'])
  })
})

describe('parseGuids (sanity: feeds tmdbLookup and matchKnownFor)', () => {
  test('real fixtures: movie, episode and show guids', () => {
    assert.deepEqual(parseGuids(movieMeta().Guid), { tmdb: '1547831', imdb: 'tt37961407', tvdb: '370713' })
    assert.deepEqual(parseGuids(episodeMeta().Guid), { tmdb: '5772135', imdb: 'tt34901367', tvdb: '10814412' })
    assert.deepEqual(parseGuids(showMeta().Guid), { tmdb: '247767', imdb: 'tt23649128', tvdb: '448147' })
  })
})
