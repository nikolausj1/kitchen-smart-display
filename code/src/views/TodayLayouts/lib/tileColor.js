// tileColor.js - the colour of a countdown tile drawn the DAKboard way, art
// above a gradient card (docs/designs/panels-and-controls.md, chunk 2
// "Countdown tiles"; drawn by panels/CountdownCard.jsx for the countdowns
// panel's 'artAbove' tiles and the single countdown panel).
//
// Where the colour comes from (the tiles' tileColorFrom knob):
//
//   'auto'      (the default) the countdown's marker colour, else a colour
//               picked from its art, else its calendar's colour
//   'marker'    the marker colour, else the calendar's (never the art's)
//   'calendar'  the calendar's colour alone
//
// and with none of them, the layout's accent (the CSS falls back to
// var(--tl-accent)). The marker colour is the hub's `tileColor`, from `color:`
// in the event's description (frameserver/lib/countdowns.mjs); the calendar's
// is the countdown's `color`, the same one the tiles' edge draws.
//
// The pure half (no DOM, testable from Node: tileColor.test.mjs):
//
//   artColor(rgba)        the colour picked from an image's pixels, or null
//   readableTone(hex)     that colour made a tile white text reads on
//   pickTileColor(...)    the order above
//   tileVars(color, g)    the card's CSS variables: the colour and its shade
//
// and the browser half, the sampler: each art URL is fetched, decoded small
// and off the main thread (lumaSampler.js's decoder: the art is a CORS
// request, same-origin on the Echos, and the hub's art carries
// Access-Control-Allow-Origin: *), read back once, and its colour kept per
// URL for the life of the page (the library is a few dozen images). Anything
// that goes wrong (a failed fetch, a decode error, a tainted canvas, an image
// with no colour in it) settles as null, silently, and the next colour in
// line is used. A component reads it through subscribeArtColors /
// artColorFor (useSyncExternalStore) and asks for it with requestArtColor
// (panels/useTileColor.js).
//
// Runtime rule (layoutSpec.js): Chrome 80 on the Echo. Plain ES2019.

import { contrastRatio, relativeLuminance, srgbToLinear } from './backdropLuma.js'
import { decodeElement, decodeImage } from './lumaSampler.js'
import { cleanColor } from './agenda.js'
import { linearGradient } from '../Entry/specStyles.js'

export const TILE_COLOR_FROM = ['auto', 'marker', 'calendar']

// --- Colour arithmetic ------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

// '#2f7fe8' (or '#27e') -> [47, 127, 232], or null.
export function hexToRgb(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex.trim())) return null
  let h = hex.trim().slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function byte(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0
}

// [r, g, b] (0..255) -> '#rrggbb'.
export function rgbToHex(rgb) {
  return `#${rgb
    .slice(0, 3)
    .map((c) => `0${byte(c).toString(16)}`.slice(-2))
    .join('')}`
}

// Linear light (0..1) -> an 8-bit sRGB channel value (unrounded).
export function linearToSrgb(l) {
  const v = Math.min(1, Math.max(0, l))
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
}

// A '#rgb' / '#rrggbb' as lowercase '#rrggbb', or null.
export function hexColor(v) {
  const rgb = hexToRgb(v)
  return rgb ? rgbToHex(rgb) : null
}

// WCAG 2 contrast of white text on a colour ('#rrggbb'), or null.
export function whiteTextContrast(hex) {
  const rgb = hexToRgb(hex)
  return rgb ? contrastRatio(1, relativeLuminance(rgb[0], rgb[1], rgb[2])) : null
}

// --- The colour of the art ----------------------------------------------------------
//
// artColor(rgba) -> '#rrggbb' | null, from an image's RGBA bytes (a canvas's
// getImageData().data; the sampler draws the art SAMPLE_WIDTH pixels wide).
//
// The average of the art's opaque pixels, taken over its dominant hue:
//
//   1. Every opaque pixel (alpha from OPAQUE_ALPHA) with some colour in it
//      (chroma, max minus min channel, from MIN_CHROMA) votes with its chroma
//      for its 10-degree band of hue. The black outlines, white highlights
//      and grey shadows of cartoon art have no chroma and do not vote.
//   2. The band whose votes, smoothed over its neighbours (1 2 3 2 1 across
//      five bands), are the most is the dominant hue.
//   3. The colour is the average, in linear light and weighted by chroma, of
//      the voting pixels within HUE_WINDOW degrees of that band's centre.
//
// A plain average of every opaque pixel was the brief. On the real Countdown
// Art (2026-09-26, the library's six images sampled 64 px wide) it turned
// multicoloured art to mud: the balloons came out #967f6a, a grey-brown,
// where this picks their red, #e03b3e; the camper's cream body buried its
// red stripe, #bbb1a4 against #d77159; the pumpkin's lit face pulled its
// orange to #c48819 in a first, 30-degree-bucket cut of this, #ba6311 now.
// Single-colour art comes out much the same either way (the backpack's blue
// #4a83bf; plain, #50759e). The Minnesota map, sky, fields and forest in
// bands, is yellow-khaki by either (#a39362 once readable): a tile whose art
// has no one colour is what the `color:` marker is for.
//
// null when no pixel is opaque, or fewer than MIN_COLOURFUL of the opaque
// ones have any colour (grey or black-and-white art): the calendar's colour
// is then the better tile. The result goes through readableTone.
export const SAMPLE_WIDTH = 64
export const OPAQUE_ALPHA = 200
export const MIN_CHROMA = 0.15
export const MIN_COLOURFUL = 0.03
export const HUE_WINDOW = 20
const HUE_BANDS = 36
const HUE_KERNEL = [1, 2, 3, 2, 1]

// A pixel's hue in degrees (0..360) when it has MIN_CHROMA, else -1; its
// chroma (0..1) in out[0].
function hueOf(r, g, b, out) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = (max - min) / 255
  out[0] = chroma
  if (!(chroma >= MIN_CHROMA)) return -1
  const d = max - min
  let h
  if (max === r) h = (g - b) / d
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export function artColor(data) {
  if (!data || typeof data.length !== 'number') return null
  const band = 360 / HUE_BANDS
  const votes = []
  for (let k = 0; k < HUE_BANDS; k++) votes.push(0)
  const c = [0]
  let opaque = 0
  let colourful = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!(data[i + 3] >= OPAQUE_ALPHA)) continue
    opaque += 1
    const h = hueOf(data[i], data[i + 1], data[i + 2], c)
    if (h < 0) continue
    colourful += 1
    votes[Math.floor(h / band) % HUE_BANDS] += c[0]
  }
  if (!opaque || colourful / opaque < MIN_COLOURFUL) return null

  const half = (HUE_KERNEL.length - 1) / 2
  let peak = 0
  let peakScore = -1
  for (let k = 0; k < HUE_BANDS; k++) {
    let score = 0
    for (let j = 0; j < HUE_KERNEL.length; j++) score += HUE_KERNEL[j] * votes[(k + j - half + HUE_BANDS) % HUE_BANDS]
    if (score > peakScore) {
      peak = k
      peakScore = score
    }
  }
  const centre = (peak + 0.5) * band

  let weight = 0
  const lin = [0, 0, 0]
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (!(data[i + 3] >= OPAQUE_ALPHA)) continue
    const h = hueOf(data[i], data[i + 1], data[i + 2], c)
    if (h < 0 || hueDistance(h, centre) > HUE_WINDOW) continue
    weight += c[0]
    lin[0] += srgbToLinear(data[i]) * c[0]
    lin[1] += srgbToLinear(data[i + 1]) * c[0]
    lin[2] += srgbToLinear(data[i + 2]) * c[0]
  }
  if (!(weight > 0)) return null
  return readableTone(rgbToHex(lin.map((v) => linearToSrgb(v / weight))))
}

// readableTone(hex) -> the colour with its luminance brought into
// [TONE_MIN_L, TONE_MAX_L], its hue and saturation kept (linear light scaled):
// light enough to read as a colour rather than black, dark enough that white
// text reads on it (TONE_MAX_L keeps WCAG contrast with white at 3 or more,
// the large-text bar, after rounding). Only the art's colour goes through it:
// a marker or calendar colour is someone's choice and is drawn as chosen.
// null for anything that is not a hex colour.
export const TONE_MIN_L = 0.04
export const TONE_MAX_L = 0.295

export function readableTone(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  let lin = rgb.map((c) => srgbToLinear(c))
  const l = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
  if (l >= TONE_MIN_L && l <= TONE_MAX_L) return rgbToHex(rgb)
  if (l <= 0) lin = [TONE_MIN_L, TONE_MIN_L, TONE_MIN_L]
  else {
    const k = (l > TONE_MAX_L ? TONE_MAX_L : TONE_MIN_L) / l
    lin = lin.map((c) => c * k)
  }
  return rgbToHex(lin.map((v) => linearToSrgb(v)))
}

// --- Which colour --------------------------------------------------------------

// pickTileColor({ marker, sampled, calendar }, from) -> the tile's colour, or
// null (the accent). marker and sampled are hex colours, calendar anything
// the agenda paints (hex, rgb(), hsl(); agenda.js cleanColor); an invalid one
// counts as none. from: TILE_COLOR_FROM ('auto' for anything else).
export function pickTileColor(sources, from) {
  const s = sources && typeof sources === 'object' ? sources : {}
  const marker = hexColor(s.marker)
  const sampled = hexColor(s.sampled)
  const calendar = cleanColor(s.calendar)
  if (from === 'calendar') return calendar
  if (from === 'marker') return marker || calendar
  return marker || sampled || calendar
}

// Does the art get a say? Only on 'auto' (or a `from` that is not one of
// TILE_COLOR_FROM, which reads as 'auto') and only while no marker colour
// wins over it, so the sampler never fetches art whose colour is not used.
export function wantsArtColor(marker, from) {
  const auto = from !== 'marker' && from !== 'calendar'
  return auto && !hexColor(marker)
}

// How far the gradient darkens: from the colour at its start to the colour
// with this much black over it at its end.
export const TILE_SHADE = 0.32

// tileVars(color, gradient) -> the card's CSS variables (CountdownCard.css):
//   --tl-cd-tint   the colour (left out for null: the card takes the accent)
//   --tl-cd-shade  a black veil from clear to TILE_SHADE in the gradient's
//                  direction ('down', 'diagonal'), laid over the colour, which
//                  is exactly the colour running to a darker shade of itself
//                  and works for whatever colour the card ends up with, the
//                  accent included; 'none' for a flat card
// The direction is the box v2 gradient's (Entry/specStyles.js).
export function tileVars(color, gradient) {
  const out = {}
  if (typeof color === 'string' && color) out['--tl-cd-tint'] = color
  out['--tl-cd-shade'] = linearGradient(gradient, 'rgba(0, 0, 0, 0)', `rgba(0, 0, 0, ${TILE_SHADE})`) || 'none'
  return out
}

// --- The sampler (browser) ---------------------------------------------------

// Settled colours per art URL ('#rrggbb', or null when the art gave none), the
// ones still being read, and who to tell when one settles.
const settled = new Map()
const reading = new Set()
const listeners = new Set()
// A bound, not a working set: the library is a few dozen images.
const KEEP_MAX = 200

// The art's pixels, SAMPLE_WIDTH wide, from a decoded bitmap or <img>.
function pixelsOf(source) {
  const iw = source.naturalWidth || source.width
  const ih = source.naturalHeight || source.height
  if (!(iw > 0) || !(ih > 0)) return null
  const w = Math.max(1, Math.min(SAMPLE_WIDTH, Math.round(iw)))
  const h = Math.max(1, Math.round((ih * w) / iw))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, 0, 0, w, h)
  // Throws a SecurityError on a tainted canvas: the caller's catch.
  return ctx.getImageData(0, 0, w, h).data
}

function release(source) {
  if (source && typeof source.close === 'function') source.close()
}

// sampleArtColor(src) -> Promise<'#rrggbb' | null>, never rejects. An image
// the bitmap decoder refuses (an SVG) is tried once more as an <img>.
export function sampleArtColor(src) {
  if (typeof src !== 'string' || !src || typeof document === 'undefined') return Promise.resolve(null)
  return decodeImage(src, SAMPLE_WIDTH)
    .catch(() => decodeElement(src))
    .then((source) => {
      try {
        const data = pixelsOf(source)
        return data ? artColor(data) : null
      } finally {
        release(source)
      }
    })
    .catch(() => null)
}

export function subscribeArtColors(fn) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// The art's settled colour: '#rrggbb', null (it has none), or undefined while
// it has not been read (requestArtColor starts that).
export function artColorFor(src) {
  return typeof src === 'string' && settled.has(src) ? settled.get(src) : undefined
}

// Read the art's colour once, unless it is read or being read already.
export function requestArtColor(src) {
  if (typeof src !== 'string' || !src || settled.has(src) || reading.has(src)) return
  if (typeof document === 'undefined') return
  reading.add(src)
  sampleArtColor(src).then((color) => {
    reading.delete(src)
    settled.set(src, color)
    while (settled.size > KEEP_MAX) settled.delete(settled.keys().next().value)
    listeners.forEach((fn) => fn())
  })
}
