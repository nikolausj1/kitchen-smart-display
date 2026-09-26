// Tests for fonts.js: one registry, and Inter's and Fraunces' stacks are the
// tokens' own. Run from code/: node --test src/views/TodayLayouts/lib/fonts.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FONTS, FONT_IDS, fontById, fontStack } from './fonts.js'

test('the five families, unique ids', () => {
  assert.deepEqual(FONT_IDS, ['inter', 'fraunces', 'roboto', 'barlow', 'plexmono'])
  assert.equal(new Set(FONT_IDS).size, FONTS.length)
  assert.equal(fontById('barlow').label, 'Barlow Condensed')
  assert.equal(fontStack('nope'), null)
})

test("Inter and Fraunces are exactly tokens.css's stacks", () => {
  const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  const token = (name) => new RegExp(`${name}: ([^;]+);`).exec(tokens)[1].trim()
  assert.equal(fontStack('inter'), token('--tl-font-inter'))
  assert.equal(fontStack('fraunces'), token('--tl-font-fraunces'))
})
