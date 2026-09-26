// Tests for countdownParts.js, what the countdown panels share. Run from
// code/: node --test src/views/TodayLayouts/panels/countdownParts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { artUrl, dayCount, emojiOf, hasArt, titleOf } from './countdownParts.js'

test('artUrl: hub paths go to the hub, full URLs stay as they are', () => {
  assert.match(artUrl('/countdown-art/a.png'), /\/countdown-art\/a\.png$/)
  assert.equal(artUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.equal(artUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  for (const none of ['', '   ', null, undefined, 42]) assert.equal(artUrl(none), null)
})

test('emojiOf, titleOf, hasArt', () => {
  assert.equal(emojiOf({ emoji: ' \u{1F382} ' }), '\u{1F382}')
  assert.equal(emojiOf({ emoji: '' }), null)
  assert.equal(emojiOf(null), null)
  assert.equal(titleOf({ title: '  Fly to Minnesota ' }), 'Fly to Minnesota')
  assert.equal(titleOf({}), '')
  assert.equal(hasArt({ image: '/countdown-art/a.png' }), true)
  assert.equal(hasArt({ emoji: '\u{1F382}' }), true)
  assert.equal(hasArt({ image: null, emoji: null }), false)
  assert.equal(hasArt(null), false)
})

test('dayCount: the number and its word, as the tiles have always shown them', () => {
  assert.deepEqual(dayCount({ daysLeft: 12 }), { days: 12, today: false, text: '12', unit: 'DAYS' })
  assert.deepEqual(dayCount({ daysLeft: 1 }), { days: 1, today: false, text: '1', unit: 'DAY' })
  assert.deepEqual(dayCount({ daysLeft: 0 }), { days: 0, today: true, text: 'Today', unit: '' })
  assert.deepEqual(dayCount({ daysLeft: 2.6 }), { days: 3, today: false, text: '3', unit: 'DAYS' })
  assert.deepEqual(dayCount({ daysLeft: -2 }), { days: 0, today: true, text: 'Today', unit: '' })
  assert.deepEqual(dayCount({}), { days: null, today: false, text: '--', unit: 'DAYS' })
  assert.deepEqual(dayCount(null), { days: null, today: false, text: '--', unit: 'DAYS' })
})
