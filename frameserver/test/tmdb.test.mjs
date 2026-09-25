// tmdb.test.mjs - lib/tmdb.mjs: the cast board's credits and person cards.
//
//   node --test frameserver/test/tmdb.test.mjs
//
// The pure row-builders and combineCast/personFromTmdb/ageFromBirthday are
// exercised directly against real (trimmed) TMDB fixtures: The Studio S1E2
// "The Oner" (TMDB show id 247767) and Catherine O'Hara (TMDB person id
// 11514). createTmdb() itself is exercised too, against a stubbed
// globalThis.fetch (swapped back in `after`), never a real socket - this
// covers its caching and the "always merge in the series regulars" wiring.

import { describe, test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAST_MAX, KNOWN_FOR_MAX, ageFromBirthday, combineCast, createTmdb, episodeCastRows,
  isBearerToken, movieCastRows, personFromTmdb, posterUrl, profileUrl, regularCastRows,
} from '../lib/tmdb.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plex')
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const movieCredits = () => fixture('tmdb-movie-credits.json')
const episodeCredits = () => fixture('tmdb-episode-credits.json')
const aggregateCredits = () => fixture('tmdb-series-aggregate-credits.json')
const personPayload = () => fixture('tmdb-person-11514.json')

describe('image sizes', () => {
  test('profileUrl: w185 by default, any size on request, null with no path', () => {
    assert.equal(profileUrl('/p.jpg'), 'https://image.tmdb.org/t/p/w185/p.jpg')
    assert.equal(profileUrl('/p.jpg', 'w342'), 'https://image.tmdb.org/t/p/w342/p.jpg')
    assert.equal(profileUrl('/p.jpg', 'h632'), 'https://image.tmdb.org/t/p/h632/p.jpg')
    assert.equal(profileUrl(null), null)
    assert.equal(profileUrl(''), null)
  })

  test('posterUrl: w342 by default', () => {
    assert.equal(posterUrl('/q.jpg'), 'https://image.tmdb.org/t/p/w342/q.jpg')
  })

  test('isBearerToken: a v4 JWT starts with eyJ, a v3 key does not', () => {
    assert.equal(isBearerToken('eyJhbGciOiJIUzI1NiJ9.x.y'), true)
    assert.equal(isBearerToken('abc123deadbeef'), false)
    assert.equal(isBearerToken(''), false)
    assert.equal(isBearerToken(undefined), false)
  })
})

describe('movieCastRows: the full cast, in billing order', () => {
  test('real fixture: Gianmarco Soresi: Thief of Joy (TMDB 1547831)', () => {
    const rows = movieCastRows(movieCredits())
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((r) => r.name), ['Gianmarco Soresi', 'Tovah Silbermann'])
    assert.deepEqual(rows.map((r) => r.guest), [false, false])
    assert.deepEqual(rows.map((r) => r.regular), [false, false])
    assert.equal(rows[0].role, 'Self')
    assert.equal(rows[0].tmdbPersonId, 1928556)
    assert.ok(rows[0].thumb.startsWith('https://image.tmdb.org/t/p/w342/'))
    // Every existing field, no `order` yet (combineCast assigns it) and no
    // `plexId` (a TMDB row never has one).
    assert.deepEqual(Object.keys(rows[0]), ['name', 'role', 'thumb', 'tmdbPersonId', 'guest', 'regular'])
  })

  test('every credited person is kept, even with no photo, and the role falls back to empty', () => {
    const rows = movieCastRows({
      cast: [
        { id: 1, name: 'Has A Photo', character: 'Lead', order: 0, profile_path: '/x.jpg' },
        { id: 2, name: 'No Photo', order: 1, profile_path: null },
      ],
    })
    assert.equal(rows.length, 2)
    assert.equal(rows[1].thumb, null)
    assert.equal(rows[1].role, '')
  })

  test('malformed payload or rows: no crash, no bogus entries', () => {
    assert.deepEqual(movieCastRows(null), [])
    assert.deepEqual(movieCastRows({}), [])
    assert.deepEqual(movieCastRows({ cast: [null, {}, { id: 1 }, { name: 'No id' }, 'junk'] }), [])
  })
})

describe('episodeCastRows: cast, then guest stars flagged', () => {
  test('real fixture: The Studio S1E2 "The Oner"', () => {
    const rows = episodeCastRows(episodeCredits())
    assert.equal(rows.length, 15)
    // The episode's own 5, billing order, before any guest star.
    assert.deepEqual(rows.slice(0, 5).map((r) => r.name),
      ['Seth Rogen', "Catherine O'Hara", 'Ike Barinholtz', 'Chase Sui Wonders', 'Kathryn Hahn'])
    assert.ok(rows.slice(0, 5).every((r) => r.guest === false && r.regular === false))
    // Then the 10 guest stars, in their own order, flagged guest: true.
    assert.equal(rows[5].name, 'Thomas Barbusca')
    assert.ok(rows.slice(5).every((r) => r.guest === true && r.regular === false))
    assert.equal(rows[rows.length - 1].name, 'Lia Kim')
  })
})

describe('regularCastRows: a series aggregate_credits payload', () => {
  test('real fixture: The Studio, trimmed aggregate credits', () => {
    const rows = regularCastRows(aggregateCredits())
    assert.equal(rows.length, 19)
    assert.ok(rows.every((r) => r.regular === true && r.guest === false))
    // The lead's character sits in roles[0] on an aggregate row, not `character`.
    assert.equal(rows[0].name, 'Seth Rogen')
    assert.equal(rows[0].role, 'Matt Remick')
  })
})

describe('combineCast: merge, dedupe, order, cap', () => {
  test('an episode\'s cast + guests + the series regulars: real fixtures', () => {
    const episodeRows = episodeCastRows(episodeCredits())
    const regularRows = regularCastRows(aggregateCredits())
    const { cast, total } = combineCast([episodeRows, regularRows])
    // 5 cast + 10 guests + 11 genuinely-new regulars (5 of the aggregate's 19
    // are the same 5 regulars already in the episode's own cast, and 3 more
    // are guest stars this episode already lists - The Studio is a real
    // ensemble show that reuses its guests as later recurring regulars).
    assert.equal(total, 26)
    assert.equal(cast.length, 26)
    assert.deepEqual(cast.map((c) => c.order), Array.from({ length: 26 }, (_, i) => i))
    assert.deepEqual(cast.slice(0, 5).map((c) => [c.name, c.guest, c.regular]),
      [['Seth Rogen', false, false], ["Catherine O'Hara", false, false], ['Ike Barinholtz', false, false],
        ['Chase Sui Wonders', false, false], ['Kathryn Hahn', false, false]])
    assert.deepEqual(cast.slice(5, 15).map((c) => c.guest), Array(10).fill(true))
    // The 3 guest stars who also show up in the aggregate list (Thomas
    // Barbusca, Greta Lee, Sarah Polley) are NOT duplicated as regulars.
    const names = cast.map((c) => c.name)
    assert.equal(names.filter((n) => n === 'Thomas Barbusca').length, 1)
    assert.equal(names.filter((n) => n === 'Greta Lee').length, 1)
    assert.equal(names.filter((n) => n === 'Sarah Polley').length, 1)
    // The 11 genuinely new regulars land after cast+guests, in their own order.
    assert.deepEqual(cast.slice(15).map((c) => [c.name, c.guest, c.regular]), [
      ['Ron Howard', false, true], ['Peter Berg', false, true], ['Steve Buscemi', false, true],
      ['Bryan Cranston', false, true], ['Paul Dano', false, true], ['David Krumholtz', false, true],
      ['Keyla Monterroso Mejia', false, true], ['Dewayne Perkins', false, true], ['Martin Scorsese', false, true],
      ['Nicholas Stoller', false, true], ['Charlize Theron', false, true],
    ])
  })

  test('capped at CAST_MAX (60), with total the pre-cap count', () => {
    const rows = Array.from({ length: 70 }, (_, i) => (
      { name: `Person ${i}`, role: '', thumb: null, tmdbPersonId: i, guest: false, regular: false }))
    const { cast, total } = combineCast([rows])
    assert.equal(CAST_MAX, 60)
    assert.equal(total, 70)
    assert.equal(cast.length, 60)
    assert.equal(cast[0].name, 'Person 0')
    assert.equal(cast[59].name, 'Person 59')
    assert.deepEqual(cast[59].order, 59)
  })

  test('dedupe: by TMDB person id first, else by normalised name', () => {
    // Same id, a later list's copy (even under a different name) is dropped.
    const byId = combineCast([
      [{ name: 'Ike', role: '', thumb: null, tmdbPersonId: 7, guest: false, regular: false }],
      [{ name: 'Ike (recast)', role: '', thumb: null, tmdbPersonId: 7, guest: false, regular: true }],
    ])
    assert.equal(byId.total, 1)
    assert.equal(byId.cast[0].name, 'Ike')
    // No id on either row: falls back to normalised (accent- and case-
    // insensitive) name matching.
    const byName = combineCast([
      [{ name: 'José', role: '', thumb: null, tmdbPersonId: null, guest: false, regular: false }],
      [{ name: 'JOSE', role: '', thumb: null, tmdbPersonId: null, guest: false, regular: true }],
    ])
    assert.equal(byName.total, 1)
    assert.equal(byName.cast[0].name, 'José')
  })

  test('an empty list of lists, or all-empty lists, combine to nothing', () => {
    assert.deepEqual(combineCast([]), { cast: [], total: 0 })
    assert.deepEqual(combineCast([[], []]), { cast: [], total: 0 })
  })
})

describe('ageFromBirthday', () => {
  test('no birthday: null', () => {
    assert.equal(ageFromBirthday(null, null), null)
    assert.equal(ageFromBirthday(undefined, '2020-01-01'), null)
  })

  test('alive: whole years as of `now`, before vs. on/after the birthday this year', () => {
    assert.equal(ageFromBirthday('1990-06-15', null, new Date('2026-06-14T12:00:00Z')), 35)
    assert.equal(ageFromBirthday('1990-06-15', null, new Date('2026-06-15T00:00:00Z')), 36)
    assert.equal(ageFromBirthday('1990-06-15', null, new Date('2026-12-31T00:00:00Z')), 36)
  })

  test('deceased: whole years at deathday, `now` irrelevant', () => {
    assert.equal(ageFromBirthday('1954-03-04', '2026-01-30', new Date('2099-01-01')), 71)
  })

  test('malformed dates: null, not a throw', () => {
    assert.equal(ageFromBirthday('not-a-date', null, new Date('2026-01-01')), null)
    assert.equal(ageFromBirthday('1990-01-01', 'also-not-a-date'), null)
  })
})

describe('personFromTmdb', () => {
  test('real fixture: Catherine O\'Hara (TMDB 11514), knownFor capped at KNOWN_FOR_MAX', () => {
    const card = personFromTmdb(personPayload(), new Date('2026-09-25T00:00:00Z'))
    assert.equal(card.tmdbId, 11514)
    assert.equal(card.name, "Catherine O'Hara")
    assert.equal(card.profile, 'https://image.tmdb.org/t/p/w185/gI2RyymLJ9ZrhEyJSD5EqSvFpCX.jpg')
    assert.equal(card.profileLarge, 'https://image.tmdb.org/t/p/h632/gI2RyymLJ9ZrhEyJSD5EqSvFpCX.jpg')
    // Her real TMDB record carries a deathday, so age is at death (71),
    // regardless of the `now` passed above.
    assert.equal(card.age, 71)
    assert.equal(KNOWN_FOR_MAX, 12)
    assert.equal(card.knownFor.length, KNOWN_FOR_MAX)
    assert.ok(card.knownFor.every((k) => k.poster == null || k.poster.startsWith('https://image.tmdb.org/t/p/w342/')))
    // Talk/reality/news credits never make the list, no matter the vote count.
    assert.ok(!card.knownFor.some((k) => /tonight show|the view|full frontal/i.test(k.title)))
    // Highest vote_count first.
    assert.equal(card.knownFor[0].title, 'Home Alone')
  })

  test('genre skip and title dedup, on a small synthetic payload (so the cap cannot hide it)', () => {
    const payload = {
      id: 999,
      name: 'Test Person',
      birthday: '1970-01-01',
      deathday: null,
      profile_path: '/pp.jpg',
      place_of_birth: 'Nowhere',
      known_for_department: 'Acting',
      biography: 'A short bio.',
      combined_credits: {
        cast: [
          { id: 1, media_type: 'movie', title: 'Big Movie', release_date: '2010-01-01',
            poster_path: '/a.jpg', character: 'Lead', vote_count: 500, genre_ids: [18] },
          // A talk show with MORE votes than the movie: still skipped.
          { id: 2, media_type: 'tv', name: 'Late Night Show', first_air_date: '2015-01-01',
            poster_path: '/b.jpg', character: 'Self', vote_count: 900, genre_ids: [10767] },
          // Same title, fewer votes: deduped away, not counted twice.
          { id: 3, media_type: 'movie', title: 'big movie', release_date: '2010-06-01',
            poster_path: '/c.jpg', character: 'Lead (rerelease)', vote_count: 300, genre_ids: [18] },
        ],
      },
    }
    const card = personFromTmdb(payload, new Date('2026-01-01T00:00:00Z'))
    assert.deepEqual(card.knownFor.map((k) => k.title), ['Big Movie'])
    assert.equal(card.age, 56)
  })

  test('malformed payload: null, not a throw', () => {
    assert.equal(personFromTmdb(null), null)
    assert.equal(personFromTmdb({}), null)
    assert.equal(personFromTmdb({ id: 1 }), null) // no name
  })
})

describe('createTmdb: caching and the "always merge the regulars in" wiring', () => {
  const realFetch = globalThis.fetch
  after(() => {
    globalThis.fetch = realFetch
  })

  function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200 })
  }

  function stubFetch(calls) {
    return async (url) => {
      const u = String(url)
      if (u.includes('/movie/1547831/credits')) {
        calls.movie = (calls.movie || 0) + 1
        return jsonResponse(movieCredits())
      }
      if (u.includes('/tv/247767/aggregate_credits')) {
        calls.aggregate = (calls.aggregate || 0) + 1
        return jsonResponse(aggregateCredits())
      }
      if (/\/tv\/247767\/season\/1\/episode\/\d+\/credits/.test(u)) {
        calls.episode = (calls.episode || 0) + 1
        return jsonResponse(episodeCredits())
      }
      if (u.includes('/person/11514')) {
        calls.person = (calls.person || 0) + 1
        return jsonResponse(personPayload())
      }
      throw new Error(`unexpected TMDB url in test: ${u}`)
    }
  }

  test('episode credits merge in the series regulars; the aggregate call is cached per series id', async () => {
    const calls = {}
    globalThis.fetch = stubFetch(calls)
    const tmdb = createTmdb({ getKey: () => 'test-v3-key' })
    const lookup = { kind: 'episode', showId: '247767', season: 1, episode: 2 }
    assert.equal(tmdb.cachedCredits(lookup), undefined)
    const result = await tmdb.credits(lookup)
    assert.equal(result.total, 26)
    assert.equal(result.cast.length, 26)
    assert.equal(result.cast[0].name, 'Seth Rogen')
    assert.equal(result.cast[5].guest, true)
    assert.equal(result.cast[15].regular, true)
    assert.deepEqual(tmdb.cachedCredits(lookup), result)
    assert.equal(calls.episode, 1)
    assert.equal(calls.aggregate, 1)
    // A different episode of the same show: its own credits are fetched,
    // but the series' regular cast is reused from cache, not refetched.
    await tmdb.credits({ ...lookup, episode: 3 })
    assert.equal(calls.episode, 2)
    assert.equal(calls.aggregate, 1)
  })

  test('movie credits, and a person card, through the same cache', async () => {
    const calls = {}
    globalThis.fetch = stubFetch(calls)
    const tmdb = createTmdb({ getKey: () => 'test-v3-key' })
    const movie = await tmdb.credits({ kind: 'movie', id: '1547831' })
    assert.equal(movie.total, 2)
    assert.deepEqual(movie.cast.map((c) => c.name), ['Gianmarco Soresi', 'Tovah Silbermann'])
    assert.equal(calls.movie, 1)
    await tmdb.credits({ kind: 'movie', id: '1547831' })
    assert.equal(calls.movie, 1) // cached, not refetched

    const card = await tmdb.person('11514')
    assert.equal(card.name, "Catherine O'Hara")
    assert.equal(card.profileLarge.includes('/h632/'), true)
    assert.equal(calls.person, 1)
  })

  test('no key configured: resolves null/undefined rather than fetching', async () => {
    let fetched = false
    globalThis.fetch = async () => {
      fetched = true
      throw new Error('should not be called')
    }
    const tmdb = createTmdb({ getKey: () => null })
    assert.equal(tmdb.configured(), false)
    assert.equal(await tmdb.credits({ kind: 'movie', id: '1' }), null)
    assert.equal(tmdb.cachedCredits({ kind: 'movie', id: '1' }), null)
    assert.equal(await tmdb.person('1'), null)
    assert.equal(fetched, false)
  })
})
