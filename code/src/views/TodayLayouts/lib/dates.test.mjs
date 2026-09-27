// Tests for lib/dates.js: the chunk 4 date block's formats and the day
// count (the ISO week, the day of the year, the days left, the school days
// left). Dates are local, as on the screens.
// Run from the project root: node --test 'code/src/**/*.test.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DATE_FORMATS,
  dateParts,
  dateText,
  dayCount,
  dayOfYear,
  daysInYear,
  daysLeftInYear,
  isoWeek,
  lastSchoolDay,
  schoolDaysLeft,
} from './dates.js'

// Saturday, September 26, 2026, mid-afternoon.
const SAT = new Date(2026, 8, 26, 15, 5, 0)
const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h)

test('the five formats read as the schema says', () => {
  assert.deepEqual(DATE_FORMATS, ['long', 'medium', 'short', 'dayname', 'daynumber'])
  assert.equal(dateText(SAT, 'long'), 'Saturday, September 26')
  assert.equal(dateText(SAT, 'medium'), 'Sat, Sep 26')
  assert.equal(dateText(SAT, 'short'), '9/26')
  assert.equal(dateText(SAT, 'dayname'), 'Saturday')
  assert.equal(dateText(SAT, 'daynumber'), 'Sep 26')
  assert.equal(dateText(SAT, 'nonsense'), 'Saturday, September 26')
  assert.equal(dateText(new Date(NaN), 'long'), '')
})

test('with the year, and dayname without', () => {
  const y = { year: true }
  assert.equal(dateText(SAT, 'long', y), 'Saturday, September 26, 2026')
  assert.equal(dateText(SAT, 'medium', y), 'Sat, Sep 26, 2026')
  assert.equal(dateText(SAT, 'short', y), '9/26/2026')
  assert.equal(dateText(SAT, 'dayname', y), 'Saturday')
  assert.equal(dateText(SAT, 'daynumber', y), 'Sep 2026 26')
})

test('dateParts marks each piece for the editor, punctuation unmarked', () => {
  assert.deepEqual(dateParts(SAT, 'medium'), [
    { key: 'weekday', text: 'Sat' },
    { key: null, text: ', ' },
    { key: 'month', text: 'Sep' },
    { key: null, text: ' ' },
    { key: 'day', text: '26' },
  ])
  const big = dateParts(SAT, 'daynumber', { year: true })
  assert.deepEqual(big.map((p) => p.key), ['month', null, 'year', 'day'])
  assert.deepEqual(dateParts(null, 'long'), [])
})

test('day of the year and the days left, leap years included', () => {
  assert.equal(dayOfYear(SAT), 269)
  assert.equal(daysLeftInYear(SAT), 96)
  assert.equal(dayOfYear(day(2026, 1, 1)), 1)
  assert.equal(dayOfYear(day(2026, 12, 31)), 365)
  assert.equal(daysLeftInYear(day(2026, 12, 31)), 0)
  assert.equal(dayOfYear(day(2028, 12, 31)), 366)
  assert.equal(dayOfYear(day(2028, 3, 1)), 61)
  assert.equal(daysInYear(2028), 366)
  assert.equal(daysInYear(2100), 365)
  assert.equal(daysInYear(2000), 366)
  // Daylight saving days are whole days all the same.
  assert.equal(dayOfYear(day(2026, 3, 8, 0)) + 1, dayOfYear(day(2026, 3, 9, 23)))
  assert.equal(dayOfYear(new Date(NaN)), null)
})

test('isoWeek: Monday weeks, week 1 holds the first Thursday', () => {
  assert.equal(isoWeek(SAT), 39)
  assert.equal(isoWeek(day(2026, 9, 21)), 39)
  assert.equal(isoWeek(day(2026, 9, 20)), 38)
  assert.equal(isoWeek(day(2026, 1, 1)), 1)
  assert.equal(isoWeek(day(2025, 12, 29)), 1)
  assert.equal(isoWeek(day(2021, 1, 3)), 53)
  assert.equal(isoWeek(day(2020, 12, 31)), 53)
  assert.equal(isoWeek(day(2027, 1, 1)), 53)
  assert.equal(isoWeek(day(2027, 1, 4)), 1)
  assert.equal(isoWeek(null), null)
})

// The SPS year as the hub serves it (/api/schoolcal), trimmed to 2026-27.
const CAL = {
  noSchoolRanges: [
    { start: '2026-10-09', end: '2026-10-09', summary: 'No School PD Day' },
    { start: '2026-11-11', end: '2026-11-11', summary: 'No School Veterans Day' },
    { start: '2026-11-26', end: '2026-11-27', summary: 'No School Thanksgiving' },
  ],
  firstDays: ['2025-09-03', '2026-09-02'],
  lastDays: ['2026-06-17', '2027-06-21'],
}
const SCHOOL = { schoolDays: [1, 2, 3, 4, 5], noSchoolOverrides: [] }

test('lastSchoolDay: the house date while ahead, else the calendar next one', () => {
  assert.equal(lastSchoolDay({ today: SAT, school: SCHOOL, calendar: CAL }), '2027-06-21')
  assert.equal(lastSchoolDay({ today: SAT, school: { ...SCHOOL, lastDay: '2027-06-11' }, calendar: CAL }), '2027-06-11')
  // Past, or not a date: the calendar's.
  assert.equal(lastSchoolDay({ today: SAT, school: { ...SCHOOL, lastDay: '2026-06-17' }, calendar: CAL }), '2027-06-21')
  assert.equal(lastSchoolDay({ today: SAT, school: { ...SCHOOL, lastDay: '2027-02-30' }, calendar: CAL }), '2027-06-21')
  assert.equal(lastSchoolDay({ today: day(2026, 6, 17), school: SCHOOL, calendar: CAL }), '2026-06-17')
  assert.equal(lastSchoolDay({ today: day(2027, 6, 22), school: SCHOOL, calendar: CAL }), null)
  assert.equal(lastSchoolDay({ today: SAT, school: SCHOOL, calendar: null }), null)
  assert.equal(lastSchoolDay({ today: SAT, school: SCHOOL, calendar: { lastDays: 'no' } }), null)
})

test('schoolDaysLeft counts school days through the last day, today included', () => {
  // Mon Sep 28 .. Fri Oct 9, the PD day off: 9.
  assert.equal(schoolDaysLeft({ today: SAT, school: SCHOOL, calendar: CAL, lastDay: '2026-10-09' }), 9)
  // The last day itself is a school day: counted.
  assert.equal(schoolDaysLeft({ today: SAT, school: SCHOOL, calendar: CAL, lastDay: '2026-10-08' }), 9)
  // Today, a Monday, counts until it is over.
  assert.equal(schoolDaysLeft({ today: day(2026, 9, 28, 20), school: SCHOOL, calendar: CAL, lastDay: '2026-09-28' }), 1)
  // A no-school date from the dashboard is not a school day either.
  const off = { ...SCHOOL, noSchoolOverrides: ['2026-09-30'] }
  assert.equal(schoolDaysLeft({ today: SAT, school: off, calendar: CAL, lastDay: '2026-10-09' }), 8)
  assert.equal(schoolDaysLeft({ today: SAT, school: SCHOOL, calendar: CAL, lastDay: '2026-09-25' }), null)
  assert.equal(schoolDaysLeft({ today: SAT, school: SCHOOL, calendar: CAL, lastDay: null }), null)
})

test('dayCount: each kind with its label', () => {
  const ctx = { now: SAT, school: SCHOOL, calendar: CAL }
  assert.deepEqual(dayCount('weekOfYear', ctx), { value: 39, label: 'Week of the year' })
  assert.deepEqual(dayCount('dayOfYear', ctx), { value: 269, label: 'Day of 365' })
  assert.deepEqual(dayCount('daysLeftInYear', ctx), { value: 96, label: 'Days left in 2026' })
  assert.deepEqual(dayCount('daysLeftInYear', { now: day(2026, 12, 30) }), { value: 1, label: 'Day left in 2026' })
  assert.deepEqual(dayCount('dayOfYear', { now: day(2028, 2, 1) }), { value: 32, label: 'Day of 366' })
  const school = dayCount('schoolDays', ctx)
  assert.equal(school.label, 'School days left')
  assert.equal(school.lastDay, '2027-06-21')
  assert.ok(school.value > 150 && school.value < 190, String(school.value))
  assert.deepEqual(dayCount('schoolDays', { now: day(2026, 10, 9), school: { ...SCHOOL, lastDay: '2026-10-12' }, calendar: CAL }), {
    value: 1,
    label: 'School day left',
    lastDay: '2026-10-12',
  })
  assert.deepEqual(dayCount('bogus', ctx), { value: 39, label: 'Week of the year' })
})

test('dayCount: school days with no last day ahead cannot be counted', () => {
  assert.equal(dayCount('schoolDays', { now: SAT, school: SCHOOL, calendar: null }), null)
  assert.equal(dayCount('schoolDays', { now: day(2027, 7, 1), school: SCHOOL, calendar: CAL }), null)
  assert.equal(dayCount('weekOfYear', { now: null }), null)
})
