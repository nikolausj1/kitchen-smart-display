// schoolData.test.mjs - lunch menu parsing and the SPS school-calendar feed.
//
// fetchLunch/fetchSchoolCal (network) and getSchoolCal/getLunch/initSchoolData
// (module-level cache + disk persistence) are intentionally NOT exercised
// here. This covers the three pure functions: the Python-parity ISO
// timestamp, the MealViewer document walker, and the iCal VEVENT parser.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { pyNowIso, parseLunch, parseSchoolCal } from '../lib/schoolData.mjs'

describe('pyNowIso', () => {
  it("matches Python's isoformat(): no fractional part when milliseconds are 0", () => {
    assert.equal(pyNowIso(new Date(2026, 8, 24, 7, 30, 5, 0)), '2026-09-24T07:30:05')
  })

  it('pads milliseconds out to 6-digit microseconds when present', () => {
    assert.equal(pyNowIso(new Date(2026, 8, 24, 7, 30, 5, 250)), '2026-09-24T07:30:05.250000')
    assert.equal(pyNowIso(new Date(2026, 0, 5, 0, 0, 0, 1)), '2026-01-05T00:00:00.001000')
  })
})

describe('parseLunch', () => {
  const doc = {
    menuSchedules: [
      {
        dateInformation: { dateKey: '20261001' },
        menuBlocks: [
          {
            blockName: 'Lunch',
            cafeteriaLineList: {
              data: [
                {
                  foodItemList: {
                    data: [
                      { item_Name: ' Cheese Pizza ', item_Type: 'Entree' },
                      { item_Name: 'Grab n Go Sandwich', item_Type: 'Grab And Go' },
                      { item_Name: 'Milk', item_Type: 'Beverage' },
                    ],
                  },
                },
              ],
            },
          },
          { blockName: 'Breakfast', cafeteriaLineList: { data: [] } },
        ],
      },
      { dateInformation: { dateKey: '20261002' }, menuBlocks: [] },
    ],
  }

  it('walks menuSchedules -> lunch blocks -> line lists -> food items, categorized', () => {
    const days = parseLunch(doc)
    assert.deepEqual(days['2026-10-01'], {
      entrees: ['Cheese Pizza'],
      grabAndGo: ['Grab n Go Sandwich'],
      items: ['Cheese Pizza', 'Grab n Go Sandwich', 'Milk'],
    })
  })

  it('is case-insensitive on the "lunch" block name, and ignores non-lunch blocks', () => {
    const days = parseLunch(doc)
    // Breakfast contributed nothing, but Lunch (mixed case) still matched
    assert.equal(days['2026-10-01'].items.length, 3)
  })

  it('gives every scheduled date an entry, even with no lunch block at all', () => {
    const days = parseLunch(doc)
    assert.deepEqual(days['2026-10-02'], { entrees: [], grabAndGo: [], items: [] })
  })

  it('tolerates foodItemList being a bare array instead of { data: [...] }', () => {
    const bareDoc = {
      menuSchedules: [
        {
          dateInformation: { dateKey: '20261003' },
          menuBlocks: [{ blockName: 'lunch', cafeteriaLineList: { data: [{ foodItemList: [{ item_Name: 'Taco', item_Type: 'entree' }] }] } }],
        },
      ],
    }
    assert.deepEqual(parseLunch(bareDoc)['2026-10-03'], { entrees: ['Taco'], grabAndGo: [], items: ['Taco'] })
  })

  it('skips a schedule whose dateKey is not exactly 8 characters', () => {
    const shortKeyDoc = { menuSchedules: [{ dateInformation: { dateKey: '2026101' }, menuBlocks: [] }] }
    assert.deepEqual(parseLunch(shortKeyDoc), {})
  })

  it('an empty document has no days', () => {
    assert.deepEqual(parseLunch({}), {})
  })

  it('malformed input: a non-dict document raises a Python-style AttributeError message (documented parity)', () => {
    assert.throws(() => parseLunch('not a dict'), /has no attribute 'get'/)
    assert.throws(() => parseLunch(null), /has no attribute 'get'/)
  })
})

describe('parseSchoolCal', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:No School - Winter Break',
    'DTSTART;VALUE=DATE:20261221',
    'DTEND;VALUE=DATE:20270105',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:First Day of School',
    'DTSTART;VALUE=DATE:20260901',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Last Day of School',
    'DTSTART;VALUE=DATE:20270615',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:No School - Teacher In-Service',
    'DTSTART;VALUE=DATE:20261112',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Regular staff meeting',
    'DTSTART;VALUE=DATE:20261110',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:No summary here is missing',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Bad date event',
    'DTSTART;VALUE=DATE:20260230',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const parsed = parseSchoolCal(ics)

  it('keeps "No School ..." events as ranges, DTEND exclusive -> inclusive end', () => {
    assert.deepEqual(parsed.noSchoolRanges[0], { start: '2026-12-21', end: '2027-01-04', summary: 'No School - Winter Break' })
  })

  it('a no-school event with no DTEND is a single-day range', () => {
    assert.deepEqual(parsed.noSchoolRanges[1], { start: '2026-11-12', end: '2026-11-12', summary: 'No School - Teacher In-Service' })
  })

  it('captures first/last day of school markers, sorted', () => {
    assert.deepEqual(parsed.firstDays, ['2026-09-01'])
    assert.deepEqual(parsed.lastDays, ['2027-06-15'])
  })

  it('ignores events that are not "No School" and not first/last day', () => {
    assert.equal(parsed.noSchoolRanges.length, 2) // not the "Regular staff meeting"
  })

  it('skips events missing SUMMARY or DTSTART, and events with an invalid date', () => {
    // "No summary here is missing" (no DTSTART) and "Bad date event" (Feb 30)
    // must not appear anywhere in the parsed output.
    const all = JSON.stringify(parsed)
    assert.ok(!all.includes('missing'))
    assert.ok(!all.includes('Bad date event'))
  })

  it('unfolds RFC 5545 continuation lines before matching SUMMARY', () => {
    // Per RFC 5545, a fold is a CRLF plus exactly one inserted whitespace
    // character, removed verbatim on unfold. To reconstruct "wraps onto"
    // (one space) the real space stays at the end of the first physical
    // line, and the fold's own space (right after \r\n) is what disappears.
    const folded = 'BEGIN:VEVENT\r\nSUMMARY:No School - a long summary that wraps \r\n onto a continuation line\r\nDTSTART;VALUE=DATE:20261225\r\nEND:VEVENT'
    const out = parseSchoolCal(folded)
    assert.equal(out.noSchoolRanges[0].summary, 'No School - a long summary that wraps onto a continuation line')
  })

  it('malformed input: text with no VEVENTs parses to empty lists', () => {
    assert.deepEqual(parseSchoolCal('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), { noSchoolRanges: [], firstDays: [], lastDays: [] })
  })
})
