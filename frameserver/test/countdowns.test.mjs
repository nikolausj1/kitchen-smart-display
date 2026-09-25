// countdowns.test.mjs - the Entry board's hand-marked countdown tiles.
//
// docs/designs/entry-board.md is the source of truth for the marker syntax
// and the art-matching precedence tested here.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  descriptionText,
  parseCountdownMarker,
  titleEmoji,
  stripEmoji,
  artName,
  matchArt,
  daysBetween,
  buildCountdowns,
} from '../lib/countdowns.mjs'

describe('descriptionText', () => {
  it('turns <br> into newlines', () => {
    assert.equal(descriptionText('Line1<br>Line2<br/>Line3'), 'Line1\nLine2\nLine3')
  })

  it('turns block tags into newlines and strips other tags', () => {
    assert.equal(descriptionText('<p>Para1</p><p>Para2</p>'), '\nPara1\n\nPara2\n')
    assert.equal(descriptionText('plain <b>bold</b> text'), 'plain bold text')
  })

  it('decodes named and numeric entities, &amp; last so double-encoding survives', () => {
    assert.equal(descriptionText('A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;'), `A & B <tag> "q" 's'`)
    assert.equal(descriptionText('&amp;lt;'), '&lt;')
    assert.equal(descriptionText('&#65;&#x42;'), 'AB')
  })

  it('returns empty string for null/empty input', () => {
    assert.equal(descriptionText(null), '')
    assert.equal(descriptionText(''), '')
    assert.equal(descriptionText(undefined), '')
  })
})

describe('parseCountdownMarker', () => {
  it('returns null when there is no marker', () => {
    assert.equal(parseCountdownMarker('just a normal event'), null)
    assert.equal(parseCountdownMarker(''), null)
    assert.equal(parseCountdownMarker(null), null)
  })

  it('bare "countdown" uses the default lead days', () => {
    assert.deepEqual(parseCountdownMarker('countdown'), { leadDays: 30, label: null, image: null })
    assert.deepEqual(parseCountdownMarker('countdown', { defaultLeadDays: 10 }), { leadDays: 10, label: null, image: null })
  })

  it('"countdown 14" is 14 days', () => {
    assert.deepEqual(parseCountdownMarker('countdown 14'), { leadDays: 14, label: null, image: null })
  })

  it('"countdown = 14 days" is 14 days', () => {
    assert.deepEqual(parseCountdownMarker('countdown = 14 days'), { leadDays: 14, label: null, image: null })
  })

  it('"countdown: 2 weeks" is 14 days', () => {
    assert.deepEqual(parseCountdownMarker('countdown: 2 weeks'), { leadDays: 14, label: null, image: null })
  })

  it('"countdown 1 month" is 30 days', () => {
    assert.deepEqual(parseCountdownMarker('countdown 1 month'), { leadDays: 30, label: null, image: null })
  })

  it('tolerates extra whitespace between the number and the unit', () => {
    assert.deepEqual(parseCountdownMarker('countdown   7   weeks'), { leadDays: 49, label: null, image: null })
  })

  it('is a whole-word match: "countdowns" and "notcountdown" do not match', () => {
    assert.equal(parseCountdownMarker('countdowns are fun'), null)
    assert.equal(parseCountdownMarker('notcountdown here'), null)
  })

  it('reads label: and image: from their own lines', () => {
    const marker = parseCountdownMarker('countdown 5\nlabel: Minnesota!\nimage: airplane')
    assert.deepEqual(marker, { leadDays: 5, label: 'Minnesota!', image: 'airplane' })
  })

  it('splits a label/image pair sharing one line at the second keyword', () => {
    const marker = parseCountdownMarker('countdown\nlabel: Trip image: mark_kim')
    assert.deepEqual(marker, { leadDays: 30, label: 'Trip', image: 'mark_kim' })
  })

  it('"image: none" is captured verbatim (matchArt interprets it)', () => {
    assert.deepEqual(parseCountdownMarker('countdown\nimage: none'), { leadDays: 30, label: null, image: 'none' })
  })

  it('reads the marker out of HTML (Google stores descriptions as HTML)', () => {
    const marker = parseCountdownMarker('countdown 7<br>label: Test')
    assert.deepEqual(marker, { leadDays: 7, label: 'Test', image: null })
  })

  it('is case-insensitive and can sit anywhere in the description', () => {
    const marker = parseCountdownMarker('Some preamble text. COUNTDOWN 3 more notes after.')
    assert.equal(marker.leadDays, 3)
  })

  it('truncates an overlong label to 80 characters', () => {
    const long = 'x'.repeat(200)
    const marker = parseCountdownMarker(`countdown\nlabel: ${long}`)
    assert.equal(marker.label.length, 80)
  })
})

describe('titleEmoji', () => {
  it('finds a two-codepoint flag sequence', () => {
    assert.equal(titleEmoji('🇺🇸 Trip'), '🇺🇸')
  })

  it('adds VS16 to a pictograph whose default presentation is text (e.g. the airplane sign)', () => {
    assert.equal(titleEmoji('✈ Flight'), '✈️')
  })

  it('leaves an already-emoji-presentation pictograph unchanged', () => {
    assert.equal(titleEmoji('😀 Party'), '😀')
  })

  it('keeps a multi-codepoint ZWJ sequence intact (family emoji)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'
    assert.equal(titleEmoji(`${family} Reunion`), family)
  })

  it('does not treat a text symbol (TM, copyright, registered) as an emoji', () => {
    assert.equal(titleEmoji('Disney™ Trip'), null)
  })

  it('returns null when there is no emoji', () => {
    assert.equal(titleEmoji('Plain title'), null)
  })

  it('malformed input: non-string / empty returns null', () => {
    assert.equal(titleEmoji(null), null)
    assert.equal(titleEmoji(''), null)
    assert.equal(titleEmoji(undefined), null)
  })
})

describe('stripEmoji', () => {
  it('strips a leading emoji and its separator', () => {
    assert.equal(stripEmoji('🎉 Birthday Party'), 'Birthday Party')
  })

  it('strips a trailing emoji and its separator', () => {
    assert.equal(stripEmoji('Birthday Party 🎉'), 'Birthday Party')
    assert.equal(stripEmoji('Trip - ✈️'), 'Trip')
    assert.equal(stripEmoji('😀: Party time'), 'Party time')
  })

  it('returns the original title (trimmed) when nothing would be left', () => {
    assert.equal(stripEmoji('🎉🎈'), '🎉🎈')
  })

  it('keeps a text symbol like TM in place (not an emoji)', () => {
    assert.equal(stripEmoji('Disney™ Trip'), 'Disney™ Trip')
  })

  it('malformed input: non-string returns an empty string', () => {
    assert.equal(stripEmoji(null), '')
    assert.equal(stripEmoji(undefined), '')
  })
})

describe('artName', () => {
  it('lowercases, drops the extension, and drops trailing digits', () => {
    assert.equal(artName('Mark_Kim5.png'), 'mark_kim')
    assert.equal(artName('pumpkin1'), 'pumpkin')
  })

  it('strips wrapping quotes', () => {
    assert.equal(artName('"pumpkin1"'), 'pumpkin')
  })

  it('drops the separator before trailing digits too', () => {
    assert.equal(artName('mark-kim-2'), 'mark-kim')
  })

  it('collapses internal whitespace and trims', () => {
    assert.equal(artName('  MARK   KIM  '), 'mark kim')
  })

  it('a name that is all digits stays as-is', () => {
    assert.equal(artName('1234'), '1234')
  })

  it('malformed input: empty/null becomes an empty string, never throws', () => {
    assert.equal(artName(''), '')
    assert.equal(artName(null), '')
  })
})

describe('matchArt', () => {
  const artIndex = [
    { id: 'a1', file: 'a1.png', name: 'pumpkin', keywords: ['pumpkin', 'halloween'] },
    { id: 'a2', file: 'a2.png', name: 'airplane', keywords: ['airplane', 'flight', 'trip'] },
    { id: 'a3', file: 'a3.png', name: 'mark_kim', keywords: ['mark', 'kim'] },
    { id: 'a4', file: 'a4.png', name: 'disneyland', keywords: ['disney', 'disneyland'] },
    { id: 'a5', file: 'a5.png', name: 'shortkw', keywords: ['cat'] },
  ]

  it('an explicit image: wins, matched name-insensitively', () => {
    const hit = matchArt({ title: 'Something' }, { image: 'Mark_Kim5.png' }, artIndex)
    assert.equal(hit.id, 'a3')
  })

  it('"image: none" means no art at all', () => {
    assert.equal(matchArt({ title: 'Something pumpkin' }, { image: 'none' }, artIndex), null)
  })

  it('an unknown explicit image name falls through to keyword matching', () => {
    const hit = matchArt({ title: 'Our Halloween party' }, { image: 'nonexistent' }, artIndex)
    assert.equal(hit.id, 'a1')
  })

  it('the longest whole-word keyword match wins', () => {
    const hit = matchArt({ title: 'Disneyland trip' }, {}, artIndex)
    assert.equal(hit.id, 'a4') // "disneyland" (10) beats "disney" (6) and "trip" (4)
  })

  it('matches keywords from the label too, not just the title', () => {
    const hit = matchArt({ title: 'Something' }, { label: 'airplane adventure' }, artIndex)
    assert.equal(hit.id, 'a2')
  })

  it('requires a whole-word match ("cat" does not match inside "category")', () => {
    assert.equal(matchArt({ title: 'Category review' }, {}, artIndex), null)
    assert.equal(matchArt({ title: 'cat show' }, {}, artIndex).id, 'a5')
  })

  it('returns null with no match, or an empty index', () => {
    assert.equal(matchArt({ title: 'Grocery shopping' }, {}, artIndex), null)
    assert.equal(matchArt({ title: 'Trip' }, {}, []), null)
  })

  it('ties on keyword length go to the first entry in the index', () => {
    const tieIndex = [
      { id: 't1', file: 't1.png', name: 'one', keywords: ['zzzzz'] },
      { id: 't2', file: 't2.png', name: 'two', keywords: ['zzzzz'] },
    ]
    assert.equal(matchArt({ title: 'zzzzz event' }, {}, tieIndex).id, 't1')
  })

  it('malformed input: non-dict index entries are ignored, not thrown on', () => {
    const dirtyIndex = [null, 'junk', 42, { id: 'a1', file: 'a1.png', name: 'pumpkin', keywords: ['pumpkin'] }]
    const hit = matchArt({ title: 'pumpkin patch' }, {}, dirtyIndex)
    assert.equal(hit.id, 'a1')
  })
})

describe('daysBetween', () => {
  it('counts whole days forward and backward', () => {
    assert.equal(daysBetween('2026-01-01', '2026-01-02'), 1)
    assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0)
    assert.equal(daysBetween('2026-01-02', '2026-01-01'), -1)
  })

  it('is DST/leap-day proof (UTC-based)', () => {
    assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2) // 2028 is a leap year
  })
})

describe('buildCountdowns', () => {
  const artIndex = [{ id: 'a4', file: 'a4.png', name: 'disneyland', keywords: ['disney', 'disneyland'] }]
  const now = new Date(2026, 8, 24) // Thursday

  const events = [
    { id: '1', title: 'Disneyland Trip', description: 'countdown 10\nimage: disneyland', startDate: '2026-10-04' },
    { id: '2', title: 'Not marked', description: 'just a normal event', startDate: '2026-10-05' },
    { id: '3', title: 'Cancelled marked', description: 'countdown 5', status: 'cancelled', startDate: '2026-09-27' },
    { id: '4', title: 'Too far out', description: 'countdown 5', startDate: '2026-12-25' },
    { id: '5', title: 'Past event', description: 'countdown 30', startDate: '2026-09-01' },
    { id: '6', title: '🎂 Birthday', description: 'countdown', startDate: '2026-10-10' },
    { id: '7', recurringEventId: 'series-1', title: 'Weekly thing A', description: 'countdown 20', startDate: '2026-10-01' },
    { id: '8', recurringEventId: 'series-1', title: 'Weekly thing B', description: 'countdown 20', startDate: '2026-10-08' },
  ]

  it('filters to 0 <= daysLeft <= leadDays, sorts by date then title, and caps at max', () => {
    const out = buildCountdowns(events, { now, artIndex, defaultLeadDays: 30, max: 3 })
    assert.deepEqual(out.map((c) => c.id), ['7', '1', '6'])
    assert.deepEqual(out.map((c) => c.daysLeft), [7, 10, 16])
  })

  it('excludes cancelled events, unmarked events, and events outside the lead window', () => {
    const out = buildCountdowns(events, { now, artIndex, max: 100 })
    const ids = out.map((c) => c.id)
    assert.ok(!ids.includes('2')) // no marker
    assert.ok(!ids.includes('3')) // cancelled
    assert.ok(!ids.includes('4')) // beyond its own leadDays
    assert.ok(!ids.includes('5')) // already past (negative daysLeft)
  })

  it('shows only the next instance of a recurring series', () => {
    const out = buildCountdowns(events, { now, artIndex, max: 100 })
    const seriesHits = out.filter((c) => c.id === '7' || c.id === '8')
    assert.equal(seriesHits.length, 1)
    assert.equal(seriesHits[0].id, '7') // the earlier date wins
  })

  it('resolves art via the explicit image: directive and builds the default URL', () => {
    const out = buildCountdowns(events, { now, artIndex, max: 100 })
    const disneyland = out.find((c) => c.id === '1')
    assert.equal(disneyland.image, '/countdown-art/a4.png')
  })

  it('falls back to the title emoji, and strips it from the shown title', () => {
    const out = buildCountdowns(events, { now, artIndex, max: 100 })
    const birthday = out.find((c) => c.id === '6')
    assert.equal(birthday.emoji, '🎂')
    assert.equal(birthday.title, 'Birthday')
    assert.equal(birthday.image, null)
  })

  it('counts a multi-day (all-day) event to its start date', () => {
    // event id 1 spans conceptually but is marked by its startDate only
    const out = buildCountdowns(events, { now, artIndex, max: 100 })
    const disneyland = out.find((c) => c.id === '1')
    assert.equal(disneyland.date, '2026-10-04')
  })

  it('derives the date from a timed `start` timestamp when there is no startDate', () => {
    const timed = [{ id: '9', title: 'Timed event', description: 'countdown 30', start: new Date(2026, 9, 1, 14, 0).toISOString() }]
    const out = buildCountdowns(timed, { now, artIndex })
    assert.equal(out[0].date, '2026-10-01')
    assert.equal(out[0].daysLeft, 7)
  })

  it('honours a custom artUrl callback', () => {
    const out = buildCountdowns([events[0]], { now, artIndex, artUrl: (e) => `custom/${e.file}` })
    assert.equal(out[0].image, 'custom/a4.png')
  })

  it('malformed input: non-array events, and junk entries, never throw', () => {
    assert.deepEqual(buildCountdowns(undefined, { now }), [])
    assert.deepEqual(buildCountdowns([null, 42, 'junk'], { now }), [])
  })
})
