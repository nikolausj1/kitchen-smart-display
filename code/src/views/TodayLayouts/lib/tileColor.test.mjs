// Tests for tileColor.js, the pure half of the art-above countdown tiles'
// colour (docs/designs/panels-and-controls.md, chunk 2 "Countdown tiles").
// Run from code/: node --test src/views/TodayLayouts/lib/tileColor.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HUE_WINDOW,
  MIN_COLOURFUL,
  OPAQUE_ALPHA,
  TILE_SHADE,
  TONE_MAX_L,
  TONE_MIN_L,
  artColor,
  hexColor,
  hexToRgb,
  linearToSrgb,
  pickTileColor,
  readableTone,
  rgbToHex,
  tileVars,
  wantsArtColor,
  whiteTextContrast,
} from './tileColor.js'
import { hexLuminance, srgbToLinear } from './backdropLuma.js'

// RGBA bytes: [[count, [r, g, b, a]], ...] as one image.
function image(parts) {
  const out = []
  parts.forEach(([count, px]) => {
    for (let i = 0; i < count; i++) out.push(px[0], px[1], px[2], px.length > 3 ? px[3] : 255)
  })
  return Uint8ClampedArray.from(out)
}

// A colour's hue, degrees.
function hueOf(hex) {
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

test('hex in and out', () => {
  assert.deepEqual(hexToRgb('#2f7fe8'), [47, 127, 232])
  assert.deepEqual(hexToRgb('#27E'), [34, 119, 238])
  assert.deepEqual(hexToRgb(' #2F7FE8 '), [47, 127, 232])
  for (const bad of ['2f7fe8', '#2f7fe', '#2f7fe8ff', 'blue', '', null, undefined, 7]) assert.equal(hexToRgb(bad), null, String(bad))
  assert.equal(rgbToHex([47, 127, 232]), '#2f7fe8')
  assert.equal(rgbToHex([-3, 255.4, 300]), '#00ffff')
  assert.equal(hexColor('#ABC'), '#aabbcc')
  assert.equal(hexColor('rgb(1, 2, 3)'), null)
})

test('linearToSrgb undoes srgbToLinear for every 8-bit value', () => {
  for (let v = 0; v < 256; v++) assert.equal(Math.round(linearToSrgb(srgbToLinear(v))), v)
  assert.equal(linearToSrgb(-1), 0)
  assert.equal(Math.round(linearToSrgb(2)), 255)
})

test('readableTone leaves a tile colour white text already reads on alone', () => {
  for (const hex of ['#2f7fe8', '#d9453d', '#2f9e44', '#4a83bf', '#6b7280']) assert.equal(readableTone(hex), hex)
  assert.equal(readableTone('nope'), null)
})

test('readableTone darkens a light colour until white text reads, keeping its hue', () => {
  for (const light of ['#d8c283', '#ec8f38', '#ffff00', '#9fe0ff', '#ffffff']) {
    const out = readableTone(light)
    assert.ok(whiteTextContrast(out) >= 3, `${light} -> ${out} ${whiteTextContrast(out)}`)
    assert.ok(hexLuminance(out) <= TONE_MAX_L + 0.003, out)
    if (light !== '#ffffff') assert.ok(Math.abs(hueOf(out) - hueOf(light)) < 4, `${light} ${hueOf(light)} -> ${out} ${hueOf(out)}`)
  }
})

test('readableTone lifts a near-black colour to a dark tone of itself', () => {
  const out = readableTone('#200000')
  assert.ok(Math.abs(hexLuminance(out) - TONE_MIN_L) < 0.003, out)
  const [r, g, b] = hexToRgb(out)
  assert.ok(r > 100 && g === 0 && b === 0, out)
  assert.equal(readableTone('#000000'), '#383838')
})

test('artColor: nothing to go on is null', () => {
  assert.equal(artColor(null), null)
  assert.equal(artColor(undefined), null)
  assert.equal(artColor({}), null)
  assert.equal(artColor(new Uint8ClampedArray(0)), null)
  // Fully transparent, however colourful.
  assert.equal(artColor(image([[100, [255, 0, 0, 0]]])), null)
  // Semi-transparent pixels do not count as the art.
  assert.equal(artColor(image([[100, [255, 0, 0, OPAQUE_ALPHA - 1]]])), null)
  // Black, white and grey art: no colour to pick.
  assert.equal(artColor(image([[50, [0, 0, 0]], [30, [255, 255, 255]], [20, [128, 130, 126]]])), null)
})

test('artColor: too little colour in grey art is none', () => {
  const n = 1000
  const few = Math.floor(n * MIN_COLOURFUL) - 1
  assert.equal(artColor(image([[n - few, [90, 90, 90]], [few, [220, 40, 40]]])), null)
  const enough = Math.ceil(n * MIN_COLOURFUL) + 1
  assert.notEqual(artColor(image([[n - enough, [90, 90, 90]], [enough, [220, 40, 40]]])), null)
})

test('artColor: one colour is that colour', () => {
  assert.equal(artColor(image([[400, [47, 127, 232]]])), '#2f7fe8')
  // Among transparent pixels, of any colour.
  assert.equal(artColor(image([[400, [47, 127, 232]], [600, [255, 255, 0, 0]]])), '#2f7fe8')
})

test('artColor: outlines, highlights and shadows do not vote or dilute', () => {
  const out = artColor(image([[300, [0, 0, 0]], [200, [255, 255, 255]], [100, [60, 60, 60]], [400, [47, 158, 68]]]))
  assert.equal(out, '#2f9e44')
})

test('artColor: the dominant hue wins, and a far hue is not averaged in', () => {
  // A pumpkin: orange body, a smaller yellow glow 25 degrees round the wheel.
  const out = artColor(image([[600, [200, 90, 20]], [400, [250, 210, 40]]]))
  assert.equal(out, '#c85a14')
  // A red minority beside a blue majority.
  assert.equal(artColor(image([[700, [47, 127, 232]], [300, [220, 40, 40]]])), '#2f7fe8')
})

test('artColor: pixels within HUE_WINDOW of the dominant hue average in linear light', () => {
  // Two blues 10 degrees apart, equal chroma: one colour between them.
  const a = [40, 120, 230]
  const b = [40, 80, 230]
  const out = hexToRgb(artColor(image([[500, a], [500, b]])))
  const mid = Math.round(linearToSrgb((srgbToLinear(120) + srgbToLinear(80)) / 2))
  assert.deepEqual(out, [40, mid, 230])
  assert.ok(HUE_WINDOW >= 10)
})

test('artColor: red either side of 0 degrees stays red', () => {
  const out = hexToRgb(artColor(image([[500, [220, 30, 60]], [500, [220, 60, 30]]])))
  assert.equal(out[0], 220)
  assert.ok(Math.abs(out[1] - out[2]) <= 1 && out[1] < 60, String(out))
})

test('artColor: a light colour comes back readable', () => {
  const out = artColor(image([[1000, [250, 230, 120]]]))
  assert.ok(whiteTextContrast(out) >= 3, out)
})

test('pickTileColor: auto is the marker, else the art, else the calendar', () => {
  const all = { marker: '#2f7fe8', sampled: '#ba6311', calendar: '#e0457b' }
  assert.equal(pickTileColor(all, 'auto'), '#2f7fe8')
  assert.equal(pickTileColor({ ...all, marker: null }, 'auto'), '#ba6311')
  assert.equal(pickTileColor({ ...all, marker: null, sampled: null }, 'auto'), '#e0457b')
  assert.equal(pickTileColor({}, 'auto'), null)
  // Anything that is not one of the three reads as auto.
  assert.equal(pickTileColor({ ...all, marker: null }, undefined), '#ba6311')
  assert.equal(pickTileColor({ ...all, marker: null }, 'sparkly'), '#ba6311')
})

test('pickTileColor: marker skips the art, calendar takes the calendar alone', () => {
  const all = { marker: '#2f7fe8', sampled: '#ba6311', calendar: '#e0457b' }
  assert.equal(pickTileColor(all, 'marker'), '#2f7fe8')
  assert.equal(pickTileColor({ ...all, marker: null }, 'marker'), '#e0457b')
  assert.equal(pickTileColor(all, 'calendar'), '#e0457b')
  assert.equal(pickTileColor({ ...all, calendar: null }, 'calendar'), null)
})

test('pickTileColor: a colour that is not one counts as none', () => {
  assert.equal(pickTileColor({ marker: 'blue', sampled: '#ba6311' }, 'auto'), '#ba6311')
  assert.equal(pickTileColor({ marker: '#ABC' }, 'auto'), '#aabbcc')
  // The calendar paints what the agenda paints, rgb() included.
  assert.equal(pickTileColor({ calendar: 'rgb(10, 20, 30)' }, 'auto'), 'rgb(10, 20, 30)')
  assert.equal(pickTileColor({ calendar: 'url(x)' }, 'auto'), null)
  assert.equal(pickTileColor(null, 'auto'), null)
})

test('wantsArtColor: only on auto, and only without a marker colour', () => {
  assert.equal(wantsArtColor(null, 'auto'), true)
  assert.equal(wantsArtColor(undefined, undefined), true)
  assert.equal(wantsArtColor('#2f7fe8', 'auto'), false)
  assert.equal(wantsArtColor('not a colour', 'auto'), true)
  assert.equal(wantsArtColor(null, 'marker'), false)
  assert.equal(wantsArtColor(null, 'calendar'), false)
})

test('tileVars: the colour and a black veil in the gradient direction', () => {
  const veil = (dir) => `linear-gradient(${dir}, rgba(0, 0, 0, 0), rgba(0, 0, 0, ${TILE_SHADE}))`
  assert.deepEqual(tileVars('#2f7fe8', 'down'), { '--tl-cd-tint': '#2f7fe8', '--tl-cd-shade': veil('to bottom') })
  assert.deepEqual(tileVars('#2f7fe8', 'diagonal'), { '--tl-cd-tint': '#2f7fe8', '--tl-cd-shade': veil('to bottom right') })
  assert.deepEqual(tileVars('#2f7fe8', 'none'), { '--tl-cd-tint': '#2f7fe8', '--tl-cd-shade': 'none' })
  // No colour: the card falls back to the accent, in CSS.
  assert.deepEqual(tileVars(null, 'down'), { '--tl-cd-shade': veil('to bottom') })
  assert.deepEqual(tileVars('', 'bogus'), { '--tl-cd-shade': 'none' })
})

test('the veil is the colour running to a darker shade of itself', () => {
  // Black at alpha a over c is c * (1 - a), channel by channel: at the end
  // of the gradient the card is the colour darkened by TILE_SHADE.
  const [r, g, b] = hexToRgb('#2f7fe8')
  const end = [r, g, b].map((c) => Math.round(c * (1 - TILE_SHADE)))
  assert.deepEqual(end, [32, 86, 158])
})
