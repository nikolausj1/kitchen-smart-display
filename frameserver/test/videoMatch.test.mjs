// videoMatch.test.mjs - lib/videoMatch.mjs: song keys, safe file names, the
// candidate scoring and the Sonos favorite gate. All pure, no I/O.
//
//   node --test frameserver/test/videoMatch.test.mjs

import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACCEPT_FLOOR, cacheFileName, cleanStationName, dcTitle, favoriteAllowed, favoriteFor, isAdTrack,
  pickCandidate, safeName, scoreCandidate, searchTerms, songKey,
} from '../lib/videoMatch.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'video')
const searchResults = () => readFileSync(join(FIX, 'search-dreams.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))
const favorites = () => JSON.parse(readFileSync(join(FIX, 'favorites-detailed.json'), 'utf8'))
  .map((f) => ({ name: f.title, uri: f.uri, metadata: f.metadata }))

describe('songKey', () => {
  test('lowercase artist|title', () => {
    assert.equal(songKey('Daft Punk', 'Get Lucky'), 'daft punk|get lucky')
  })

  test('featured artists in the title brackets are dropped', () => {
    assert.equal(songKey('Daft Punk', 'Get Lucky (feat. Pharrell Williams & Nile Rodgers)'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk', 'Get Lucky [ft. Pharrell Williams]'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk', 'Get Lucky (featuring Pharrell)'), 'daft punk|get lucky')
    assert.equal(songKey('Lizzo', 'Truth Hurts (with Someone)'), 'lizzo|truth hurts')
  })

  test('featured artists in the artist field are cut at the first separator', () => {
    assert.equal(songKey('Daft Punk feat. Pharrell Williams', 'Get Lucky'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk ft. Pharrell', 'Get Lucky'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk featuring Pharrell', 'Get Lucky'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk & Pharrell', 'Get Lucky'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk x Pharrell', 'Get Lucky'), 'daft punk|get lucky')
    assert.equal(songKey('Daft Punk with Pharrell', 'Get Lucky'), 'daft punk|get lucky')
  })

  test('the same song from Spotify and Pandora gets one key', () => {
    assert.equal(
      songKey('Daft Punk', 'Get Lucky (feat. Pharrell Williams & Nile Rodgers)'),
      songKey('Daft Punk', 'Get Lucky'),
    )
    assert.equal(
      songKey('Fleetwood Mac', 'Dreams (2004 Remaster)'),
      songKey('Fleetwood Mac', 'Dreams'),
    )
  })

  test('remaster, radio edit and version tails and brackets are dropped', () => {
    assert.equal(songKey('Fleetwood Mac', 'Dreams - 2004 Remaster'), 'fleetwood mac|dreams')
    assert.equal(songKey('Fleetwood Mac', 'Dreams - Remastered 2004'), 'fleetwood mac|dreams')
    assert.equal(songKey('Fleetwood Mac', 'Dreams (Remastered)'), 'fleetwood mac|dreams')
    assert.equal(songKey('Fleetwood Mac', 'Dreams [2004 Remaster]'), 'fleetwood mac|dreams')
    assert.equal(songKey('Eagles', 'Hotel California - 2013 Remaster'), 'eagles|hotel california')
    assert.equal(songKey('A-ha', 'Take On Me - Radio Edit'), 'aha|take on me')
    assert.equal(songKey('A-ha', 'Take On Me - Single Version'), 'aha|take on me')
    assert.equal(songKey('A-ha', 'Take On Me (Album Version)'), 'aha|take on me')
    assert.equal(songKey('Abba', 'Dancing Queen - Mono'), 'abba|dancing queen')
    assert.equal(songKey('Queen', 'Bohemian Rhapsody - Live Aid'), 'queen|bohemian rhapsody')
    assert.equal(songKey('Prince', 'Purple Rain - 2015 Paisley Park Remaster'), 'prince|purple rain')
    assert.equal(songKey('Beatles', 'Help! - Remastered 2009 - Mono'), 'beatles|help')
  })

  test('a dash segment that is not a version tag stays in the title', () => {
    assert.equal(songKey('Blink-182', 'Mutt - Part II'), 'blink182|mutt part ii')
    assert.equal(songKey('Bad Bunny', 'Me Porto Bonito - Remix'), 'bad bunny|me porto bonito remix')
  })

  test('brackets that are part of the song stay', () => {
    assert.equal(songKey('Rolling Stones', "(I Can't Get No) Satisfaction"), 'rolling stones|i cant get no satisfaction')
    assert.equal(songKey('Elvis Presley', '(You\'re the) Devil in Disguise'), 'elvis presley|youre the devil in disguise')
    assert.equal(songKey('Eminem', 'Without Me (Explicit)'), 'eminem|without me')
  })

  test('"with" inside a word is not a separator or a bracket start', () => {
    assert.equal(songKey('Within Temptation', 'Without You'), 'within temptation|without you')
    assert.equal(songKey('Jimi Hendrix', 'Fire (Without a Net)'), 'jimi hendrix|fire without a net')
  })

  test('diacritics are stripped', () => {
    assert.equal(songKey('Beyoncé', 'Halo'), 'beyonce|halo')
    assert.equal(songKey('Sigur Rós', 'Hoppípolla'), 'sigur ros|hoppipolla')
    assert.equal(songKey('Mötley Crüe', 'Dr. Feelgood'), 'motley crue|dr feelgood')
    assert.equal(songKey('BEYONCÉ', 'HALO'), songKey('Beyonce', 'Halo'))
  })

  test('punctuation and spacing are removed', () => {
    assert.equal(songKey('P!nk', 'So What'), 'pnk|so what')
    assert.equal(songKey('AC/DC', "Rock 'n' Roll Train"), 'acdc|rock n roll train')
    assert.equal(songKey('  Guns N\' Roses ', ' Sweet   Child O\' Mine '), 'guns n roses|sweet child o mine')
    assert.equal(songKey('The B-52\'s', 'Love Shack!'), 'the b52s|love shack')
  })

  test('numbers survive', () => {
    assert.equal(songKey('Blink-182', 'All the Small Things'), 'blink182|all the small things')
    assert.equal(songKey('Prince', '1999'), 'prince|1999')
  })

  test('non-Latin names keep their letters instead of collapsing to nothing', () => {
    assert.equal(songKey('宇多田ヒカル', 'First Love'), '宇多田ヒカル|first love')
    assert.notEqual(songKey('宇多田ヒカル', '初恋'), songKey('椎名林檎', '丸の内サディスティック'))
  })

  test('empty inputs give a key without throwing', () => {
    assert.equal(songKey('', 'Advertisement'), '|advertisement')
    assert.equal(songKey(undefined, undefined), '|')
  })
})

describe('searchTerms', () => {
  test('keeps case and accents but drops remaster and feature noise', () => {
    assert.equal(searchTerms('Beyoncé feat. Jay-Z', 'Crazy in Love (Remastered)'), 'Beyoncé Crazy in Love')
    assert.equal(searchTerms('Fleetwood Mac', 'Dreams - 2004 Remaster'), 'Fleetwood Mac Dreams')
  })
})

describe('safeName', () => {
  test('strips characters illegal on Windows and SMB', () => {
    assert.equal(safeName('AC/DC'), 'ACDC')
    assert.equal(safeName('What?: <a> "b" | c * d\\e'), 'What a b c de')
  })

  test('strips control characters and collapses whitespace', () => {
    assert.equal(safeName('A\u0000B\u001fC\td   e\n'), 'ABC d e')
  })

  test('no trailing dots or spaces (Windows drops them)', () => {
    assert.equal(safeName('Mr. Brightside...'), 'Mr. Brightside')
    assert.equal(safeName('Name. . '), 'Name')
  })

  test('120 characters at most', () => {
    assert.equal(safeName('x'.repeat(300)).length, 120)
  })

  test('nothing left becomes Unknown', () => {
    assert.equal(safeName('???'), 'Unknown')
    assert.equal(safeName(null), 'Unknown')
  })
})

describe('cacheFileName', () => {
  test('cache/<Artist>/<Artist> - <Title> [<videoId>].mp4 with forward slashes and a jpg beside it', () => {
    const f = cacheFileName({ artist: 'Daft Punk', title: 'Get Lucky', videoId: 'h5EofwRzit0' })
    assert.equal(f.dir, 'Daft Punk')
    assert.equal(f.file, 'cache/Daft Punk/Daft Punk - Get Lucky [h5EofwRzit0].mp4')
    assert.equal(f.thumb, 'cache/Daft Punk/Daft Punk - Get Lucky [h5EofwRzit0].jpg')
  })

  test('illegal characters in the artist and title are removed from every component', () => {
    const f = cacheFileName({ artist: 'AC/DC', title: 'Who Made Who?', videoId: 'abcdefghijk' })
    assert.equal(f.file, 'cache/ACDC/ACDC - Who Made Who [abcdefghijk].mp4')
  })

  test('a very long title is shortened, never the id, and each component stays within 120', () => {
    const f = cacheFileName({ artist: 'A'.repeat(200), title: 'T'.repeat(200), videoId: 'abcdefghijk' })
    const [, dir, name] = f.file.split('/')
    assert.ok(dir.length <= 120)
    assert.ok(name.length <= 120, String(name.length))
    assert.ok(name.endsWith(' [abcdefghijk].mp4'))
  })
})

describe('isAdTrack', () => {
  test('Pandora ad: title Advertisement', () => {
    assert.equal(isAdTrack({ artist: '', title: 'Advertisement' }), true)
    assert.equal(isAdTrack({ artist: 'Pandora', title: 'advertisement' }), true)
  })
  test('no artist cannot be searched for', () => {
    assert.equal(isAdTrack({ artist: '  ', title: 'Something' }), true)
  })
  test('a song is not an ad, even one called Advertisement Break', () => {
    assert.equal(isAdTrack({ artist: 'Fleetwood Mac', title: 'Dreams' }), false)
    assert.equal(isAdTrack({ artist: 'Band', title: 'Advertisement Break' }), false)
    assert.equal(isAdTrack(null), false)
  })
})

const DREAMS = { artist: 'Fleetwood Mac', title: 'Dreams (2004 Remaster)', durationMs: 257_000, denied: [] }
const cand = (over) => ({ id: 'abc12345678', title: 'Fleetwood Mac - Dreams', channel: 'y', duration: 257, view_count: 1000, ...over })

describe('scoreCandidate', () => {
  test('a VEVO official video within the duration scores high', () => {
    const s = scoreCandidate(cand({
      title: 'The Weeknd - Blinding Lights (Official Video)', channel: 'TheWeekndVEVO', duration: 200, view_count: 1_000_000_000,
    }), { artist: 'The Weeknd', title: 'Blinding Lights', durationMs: 200_000 })
    // 15 (close cut) + 50 (channel) + 30 (official video) + 10 (official) + 10 (title) + 9 (views)
    assert.ok(s > 120 && s < 130, String(s))
  })

  test('the artist channel official music video', () => {
    const results = searchResults()
    const s = scoreCandidate(results[0], DREAMS)
    assert.ok(s >= 100, String(s))
  })

  test('score is exactly the sum of the parts', () => {
    const s = scoreCandidate(cand({
      title: 'Fleetwood Mac - Dreams (Official Video)', channel: 'Fleetwood Mac', view_count: 999,
    }), DREAMS)
    assert.equal(s, 15 + 50 + 30 + 10 + 10 + Math.log10(1000))
  })

  test('a channel run together like TaylorSwiftVEVO still matches the artist', () => {
    const s = scoreCandidate(cand({ title: 'Anti-Hero (Official Music Video)', channel: 'TaylorSwiftVEVO', duration: 201 }),
      { artist: 'Taylor Swift', title: 'Anti-Hero', durationMs: 201_000 })
    assert.ok(s >= 100, String(s))
  })

  test('a channel that ends in VEVO counts even when the artist name differs', () => {
    const s = scoreCandidate(cand({ title: 'Song (Official Video)', channel: 'SomeLabelVEVO' }),
      { artist: 'Other Artist', title: 'Song', durationMs: 257_000 })
    assert.ok(s >= 90, String(s))
  })

  test('lyric videos, live versions, covers and the like are rejected', () => {
    const results = searchResults()
    assert.equal(scoreCandidate(results[1], DREAMS), -1) // Lyrics
    assert.equal(scoreCandidate(results[2], DREAMS), -1) // Live 1997
    assert.equal(scoreCandidate(results[5], DREAMS), -1) // Cover by Anna
    for (const t of ['karaoke version', 'reaction to the song', 'audio only', 'Visualizer', 'Visualiser', 'fan made',
      'fanmade', '(Official Audio)', '8D audio', 'slowed + reverb', 'sped up', 'nightcore mix', 'instrumental', 'official teaser',
      'trailer', 'tutorial piano', 'behind the scenes', 'the making of', 'loop']) {
      assert.equal(scoreCandidate(cand({ title: `Fleetwood Mac - Dreams ${t}`, channel: 'Fleetwood Mac' }), DREAMS), -1, t)
    }
  })

  test('a reject word as part of another word does not reject', () => {
    const s = scoreCandidate(cand({ title: 'Fleetwood Mac - Dreams (Official Video) Delivered', channel: 'Fleetwood Mac' }), DREAMS)
    assert.ok(s > 0, 'delivered must not match live; cover must not match covered')
  })

  test('an auto-generated Topic channel is rejected', () => {
    assert.equal(scoreCandidate(searchResults()[3], DREAMS), -1)
    assert.equal(scoreCandidate(cand({ channel: 'Fleetwood Mac - topic' }), DREAMS), -1)
  })

  test('a denied video id is rejected', () => {
    const results = searchResults()
    assert.ok(scoreCandidate(results[0], DREAMS) > 0)
    assert.equal(scoreCandidate(results[0], { ...DREAMS, denied: ['mrZRURcb1cM'] }), -1)
  })

  test('duration: missing is rejected', () => {
    assert.equal(scoreCandidate(cand({ duration: null, channel: 'Fleetwood Mac' }), DREAMS), -1)
    assert.equal(scoreCandidate(cand({ duration: 0, channel: 'Fleetwood Mac' }), DREAMS), -1)
    assert.equal(scoreCandidate(searchResults()[7], DREAMS), -1)
  })

  test('duration: under half or over twice Sonos\'s is a hard reject, 0.5x to 2x is allowed', () => {
    const ctx = { ...DREAMS, durationMs: 200_000 }
    const at = (d) => scoreCandidate(cand({ duration: d, channel: 'Fleetwood Mac' }), ctx)
    assert.equal(at(99), -1)
    assert.ok(at(100) > 0)
    assert.ok(at(400) > 0)
    assert.equal(at(401), -1)
    assert.equal(at(30), -1, 'a 30 s teaser')
    assert.equal(at(36_000), -1, 'a 10 hour loop')
  })

  test('duration: a close cut (within 20 % or 45 s) earns +15 over an extended one', () => {
    const at = (d, ms) => scoreCandidate(cand({ duration: d, channel: 'Fleetwood Mac', view_count: 0 }), { ...DREAMS, durationMs: ms })
    // 45 s window on a short song: 60 s song, 100 s video.
    assert.equal(at(100, 60_000) - at(106, 60_000), 15)
    // 20 % window on a long song: 600 s song, 700 s video (100 s away, 17 %).
    assert.equal(at(700, 600_000) - at(730, 600_000), 15)
    assert.ok(at(257, 257_000) > at(400, 257_000))
  })

  test('the real cases that a tight window lost: Blinding Lights and Get Lucky now match', () => {
    const bl = scoreCandidate(cand({
      title: 'The Weeknd - Blinding Lights (Official Video)', channel: 'TheWeekndVEVO', duration: 262, view_count: 1_000_000_000,
    }), { artist: 'The Weeknd', title: 'Blinding Lights', durationMs: 200_000 })
    assert.ok(bl >= ACCEPT_FLOOR, String(bl))
    const gl = scoreCandidate(cand({
      title: 'Daft Punk - Get Lucky (Official Video) ft. Pharrell Williams, Nile Rodgers', channel: 'Daft Punk', duration: 248, view_count: 500_000_000,
    }), { artist: 'Daft Punk', title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)', durationMs: 369_000 })
    assert.ok(gl >= ACCEPT_FLOOR, String(gl))
  })

  test('duration: a 1 hour loop of a 4 minute song is out', () => {
    assert.equal(scoreCandidate(searchResults()[4], DREAMS), -1)
  })

  test('duration: Sonos with no duration (radio) does not gate, and gives no bonus', () => {
    const a = scoreCandidate(cand({ duration: 300, channel: 'Fleetwood Mac', view_count: 0 }), { ...DREAMS, durationMs: 0 })
    const b = scoreCandidate(cand({ duration: 300, channel: 'Fleetwood Mac', view_count: 0 }), { ...DREAMS, durationMs: 300_000 })
    assert.ok(a > 0)
    assert.equal(b - a, 15)
  })

  test('the title rule: a video whose title lacks the song title is out (Gypsy must not win for Dreams)', () => {
    const gypsy = cand({ id: 'mwgg1Pu6cNg', title: 'Fleetwood Mac - Gypsy (Official Music Video) [HD]', channel: 'Fleetwood Mac', duration: 295, view_count: 142_000_000 })
    assert.equal(scoreCandidate(gypsy, DREAMS), -1)
    const official = cand({ id: 'Y3ywicffOj4', title: 'Fleetwood Mac - Dreams (Official Music Video) [4K]', channel: 'Fleetwood Mac', duration: 264, view_count: 93_000_000 })
    assert.equal(pickCandidate([gypsy, official], DREAMS).candidate.id, 'Y3ywicffOj4')
    assert.equal(pickCandidate([gypsy], DREAMS), null, 'with the right one absent it is a miss, not Gypsy')
  })

  test('the title rule normalises like the key: case, accents, punctuation, spacing', () => {
    const ctx = { artist: 'Beyoncé', title: "Crazy in Love (feat. Jay-Z)", durationMs: 236_000 }
    const ok = scoreCandidate(cand({ title: 'BEYONCE - CRAZY  IN  LOVE (Official Video)', channel: 'beyonceVEVO', duration: 255 }), ctx)
    assert.ok(ok >= ACCEPT_FLOOR, String(ok))
    const ctx2 = { artist: 'Wham!', title: "Wake Me Up Before You Go-Go", durationMs: 232_000 }
    assert.ok(scoreCandidate(cand({ title: 'Wham! - Wake Me Up Before You Go Go (Official Video)', channel: 'Wham', duration: 232 }), ctx2) > 0)
  })

  test('the instrumental exception: Sonos says instrumental, so an instrumental video may match', () => {
    const ctx = { artist: 'Tycho', title: 'Awake (Instrumental)', durationMs: 257_000 }
    const s = scoreCandidate(cand({ title: 'Tycho - Awake (Instrumental) (Official Video)', channel: 'Tycho' }), ctx)
    assert.ok(s > 0, String(s))
    // ... but not for a song whose own title lacks the word.
    assert.equal(scoreCandidate(cand({ title: 'Tycho - Awake (Instrumental)', channel: 'Tycho' }),
      { ...ctx, title: 'Awake' }), -1)
  })

  test('the exception is per word: Sonos "Live Forever" still rejects a lyric video', () => {
    const ctx = { artist: 'Oasis', title: 'Live Forever', durationMs: 276_000 }
    assert.ok(scoreCandidate(cand({ title: 'Oasis - Live Forever (Official Video)', channel: 'Oasis', duration: 276 }), ctx) > 0)
    assert.equal(scoreCandidate(cand({ title: 'Oasis - Live Forever (Lyrics)', channel: 'Oasis', duration: 276 }), ctx), -1)
  })

  test('a band called Live is not rejected for its own name', () => {
    const ctx = { artist: 'Live', title: 'Lightning Crashes', durationMs: 325_000 }
    assert.ok(scoreCandidate(cand({ title: 'Live - Lightning Crashes (Official Video)', channel: 'Live', duration: 325 }), ctx) > 0)
  })

  test('view count only nudges: capped at 10 points', () => {
    const base = { title: 'Fleetwood Mac - Dreams (Official Video)', channel: 'Fleetwood Mac' }
    const a = scoreCandidate(cand({ ...base, view_count: 0 }), DREAMS)
    const b = scoreCandidate(cand({ ...base, view_count: 10 ** 12 }), DREAMS)
    assert.equal(b - a, 10)
    assert.equal(scoreCandidate(cand({ ...base, view_count: null }), DREAMS), a)
  })

  test('garbage in is a reject, not a throw', () => {
    assert.equal(scoreCandidate(null, DREAMS), -1)
    assert.equal(scoreCandidate({}, DREAMS), -1)
    assert.equal(scoreCandidate(cand({ title: undefined, channel: undefined }), DREAMS) <= 10, true)
  })
})

describe('pickCandidate', () => {
  test('picks the official video from a realistic search', () => {
    const r = pickCandidate(searchResults(), DREAMS)
    assert.equal(r.candidate.id, 'mrZRURcb1cM')
    assert.ok(r.score >= ACCEPT_FLOOR)
  })

  test('denying the winner moves to the next acceptable candidate, never back', () => {
    const results = searchResults()
    const second = pickCandidate(results, { ...DREAMS, denied: ['mrZRURcb1cM'] })
    // The only other non-rejected result is the random uploader's "Fleetwood Mac - Dreams": 10 + 4 = 14, under the floor.
    assert.equal(second, null)
  })

  test('the 40 floor: a fan upload with no official signals is a miss', () => {
    const fan = cand({ id: 'fan00000006', title: 'Fleetwood Mac - Dreams', channel: 'Some Random Guy', view_count: 5000 })
    assert.ok(scoreCandidate(fan, DREAMS) < ACCEPT_FLOOR)
    assert.equal(pickCandidate([fan], DREAMS), null)
  })

  test('the floor is 40: 35 is a miss, 50 is accepted', () => {
    const ctx = { artist: 'Q', title: 'Zzz', durationMs: 257_000 }
    // close cut 15 + official 10 + title 10 = 35
    const low = cand({ id: 'edge1234567', title: 'Zzz (Official)', channel: 'Nobody', view_count: 0 })
    assert.equal(scoreCandidate(low, ctx), 35)
    assert.equal(pickCandidate([low], ctx), null)
    // official video 30 + official 10 + title 10 = 50, a cut too far off for the bonus
    const ok = cand({ id: 'edge7654321', title: 'Zzz (Official Video)', channel: 'Nobody', view_count: 0, duration: 400 })
    assert.equal(scoreCandidate(ok, ctx), 50)
    assert.equal(pickCandidate([ok], ctx).candidate.id, 'edge7654321')
  })

  test('a tie goes to the more viewed upload, then to the earlier rank', () => {
    const a = cand({ id: 'aaaaaaaaaaa', title: 'Fleetwood Mac - Dreams (Official Video)', channel: 'Fleetwood Mac', view_count: 100 })
    const b = { ...a, id: 'bbbbbbbbbbb' }
    assert.equal(pickCandidate([a, b], DREAMS).candidate.id, 'aaaaaaaaaaa')
    assert.equal(pickCandidate([a, { ...b, view_count: 100 }], DREAMS).candidate.id, 'aaaaaaaaaaa')
  })

  test('empty and non-array input', () => {
    assert.equal(pickCandidate([], DREAMS), null)
    assert.equal(pickCandidate(null, DREAMS), null)
  })
})

describe('favoriteFor', () => {
  test('matches the transport URI exactly', () => {
    const favs = favorites()
    assert.equal(favoriteFor('x-sonosapi-radio:ST%3a8873310021?sid=236&flags=8300&sn=5', favs), 'Daft Punk Radio (My Station)')
  })

  test('a queue-based source matches by the container title in the metadata', () => {
    const favs = favorites()
    const meta = '<DIDL-Lite><item><dc:title>Classic Rock Party</dc:title></item></DIDL-Lite>'
    assert.equal(favoriteFor('x-rincon-queue:RINCON_1#0', favs, meta), 'Classic Rock Party')
  })

  test('the metadata title ignores Pandora\'s (My Station) tag and case', () => {
    const favs = favorites()
    const meta = '<DIDL-Lite><item><dc:title>morning instrumentals</dc:title></item></DIDL-Lite>'
    assert.equal(favoriteFor('x-sonosapi-radio:ST%3aother', favs, meta), 'Morning Instrumentals (My Station)')
  })

  test('no match is null', () => {
    assert.equal(favoriteFor('x-rincon-queue:RINCON_1#0', favorites(), ''), null)
    assert.equal(favoriteFor('', [], ''), null)
    assert.equal(favoriteFor('x', null), null)
  })

  test('dcTitle decodes entities; cleanStationName strips Pandora tags', () => {
    assert.equal(dcTitle('<dc:title>Rock &amp; Roll</dc:title>'), 'Rock & Roll')
    assert.equal(dcTitle('<x/>'), null)
    assert.equal(cleanStationName('Daft Punk Radio (My Station)'), 'Daft Punk Radio')
    assert.equal(cleanStationName('Shared Mix (Shared)'), 'Shared Mix')
    assert.equal(cleanStationName(''), '')
  })
})

describe('favoriteAllowed', () => {
  const video = { favorites: { 'Morning Instrumentals (My Station)': 'no', 'Classic Rock Party': 'yes' } }

  test('default is yes', () => {
    assert.equal(favoriteAllowed('Daft Punk Radio (My Station)', video), true)
    assert.equal(favoriteAllowed('Classic Rock Party', video), true)
    assert.equal(favoriteAllowed(null, video), true)
    assert.equal(favoriteAllowed('Anything', undefined), true)
    assert.equal(favoriteAllowed('Anything', {}), true)
  })

  test('a favorite set to no is denied', () => {
    assert.equal(favoriteAllowed('Morning Instrumentals (My Station)', video), false)
  })

  test('lookup tolerates the (My Station) tag and case', () => {
    assert.equal(favoriteAllowed('Morning Instrumentals', video), false)
    assert.equal(favoriteAllowed('morning instrumentals (my station)', video), false)
    assert.equal(favoriteAllowed('Classic Rock Party (My Station)', { favorites: { 'Classic Rock Party': 'no' } }), false)
  })
})

describe('scoring: lessons from the first evening (2026-11-11)', () => {
  const ctx = (over) => ({ artist: 'Miike Snow', title: 'Black & Blue', durationMs: 219_000, denied: [], ...over })

  test('"&" in the song matches "and" in the upload, and the other way round', () => {
    const own = cand({ title: 'Miike Snow - Black and Blue', channel: 'Miike Snow', duration: 223 })
    assert.ok(scoreCandidate(own, ctx()) >= 40)
    const amp = cand({ title: 'Miike Snow - Black & Blue', channel: 'Miike Snow', duration: 223 })
    assert.ok(scoreCandidate(amp, ctx({ title: 'Black and Blue' })) >= 40)
  })

  test('a remix is rejected unless Sonos is playing the remix', () => {
    const remix = cand({ title: 'Black & Blue (Netsky Remix)', channel: 'Miike Snow', duration: 315 })
    assert.equal(scoreCandidate(remix, ctx()), -1)
    assert.ok(scoreCandidate(remix, ctx({ title: 'Black & Blue - Netsky Remix', durationMs: 315_000 })) >= 40)
  })

  test('the artist own upload now beats the remix for the same song', () => {
    const own = cand({ id: 'own00000001', title: 'Miike Snow - Black and Blue', channel: 'Miike Snow', duration: 223 })
    const remix = cand({ id: 'rmx00000001', title: 'Black & Blue (Netsky Remix)', channel: 'Miike Snow', duration: 315 })
    assert.equal(pickCandidate([remix, own], ctx())?.candidate.id, 'own00000001')
  })
})
