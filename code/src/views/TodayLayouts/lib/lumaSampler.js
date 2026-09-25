// lumaSampler.js - the browser half of backdropLuma.js: how bright a photo
// is, cell by cell, as a box of a given size shows it.
//
//   sampleLuma(src, { w, h, fit }) -> Promise<{ src, cols, rows, grid, ms } | null>
//
// The photo is read again beside the <img> on screen, as a CORS request (the
// kitchen Pi's app is served by the Pi and its photos by the hub, which sends
// Access-Control-Allow-Origin: * on them; the Echos load both from the hub,
// same-origin). It normally comes straight from the HTTP cache: PhotoPanel
// preloads the next photo, and the hub lets photos cache for a week.
//
// The work stays off the main thread: the file is fetched as a Blob and
// createImageBitmap decodes it already scaled down to DECODE_WIDTH pixels
// wide, on the browser's decoder threads. The main thread only draws that
// small bitmap's visible part (object-fit: cover, centred; the whole picture
// for 'contain') into a LUMA_COLS x rows canvas and reads it back: well under
// a millisecond. Measured in headless Chrome with the CPU slowed 6x (about an
// Echo), drawing the full-size photo into the canvas instead took 230 ms of
// main thread per photo; decoding through an <img> left 150-250 ms long tasks.
// Without createImageBitmap (not expected on anything that runs this app) it
// falls back to an Image with crossOrigin="anonymous" drawn at the default
// smoothing, which lets the decoder scale down too. ms is the main-thread time
// of the last step.
//
// Anything that goes wrong resolves to null, silently: a failed fetch, a CORS
// refusal, a decode error, a canvas the browser considers tainted (getImageData
// throws), no canvas at all. The caller then keeps the screen's own darkness.
// Results (null included) are cached per photo and grid size, the last
// CACHE_MAX of them, so a photo coming round again costs nothing; no decoded
// photo is held.
//
// Runtime rule (layoutSpec.js): Chrome 80. createImageBitmap with resize
// options, fetch, Blob and the willReadFrequently hint (ignored when unknown)
// are all older.

import { LUMA_COLS, coverRect, gridRows, lumaGrid } from './backdropLuma.js'

const CACHE_MAX = 48
// Decoded width: four source pixels per grid column even when the screen
// crops a portrait photo to a band across its middle.
const DECODE_WIDTH = LUMA_COLS * 4
const cache = new Map()

function clock() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : 0
}

// A small decoded bitmap of the photo, or a decoded <img> as the fallback.
function decode(src) {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    return fetch(src, { mode: 'cors' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => createImageBitmap(blob, { resizeWidth: DECODE_WIDTH, resizeQuality: 'medium' }))
  }
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load failed'))
    img.src = src
  })
}

function measure(source, src, cols, rows, fit, w, h) {
  const iw = source.naturalWidth || source.width
  const ih = source.naturalHeight || source.height
  if (!(iw > 0) || !(ih > 0)) return null
  const t0 = clock()
  const r = fit === 'contain' ? { sx: 0, sy: 0, sw: iw, sh: ih } : coverRect(iw, ih, w, h)
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, cols, rows)
  // Throws a SecurityError on a tainted canvas: the caller's catch.
  const data = ctx.getImageData(0, 0, cols, rows).data
  const grid = lumaGrid(data, cols, rows)
  return { src, cols, rows, grid, ms: Math.round((clock() - t0) * 10) / 10 }
}

function release(source) {
  if (source && typeof source.close === 'function') source.close()
}

function remember(key, promise) {
  cache.set(key, promise)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

// box: { w, h } the size the photo is shown at (CSS px; only the aspect
// matters), fit: 'cover' (default) or 'contain'.
export function sampleLuma(src, box) {
  if (typeof src !== 'string' || !src || typeof document === 'undefined') return Promise.resolve(null)
  const w = box && box.w > 0 ? box.w : 16
  const h = box && box.h > 0 ? box.h : 9
  const fit = box && box.fit === 'contain' ? 'contain' : 'cover'
  const cols = LUMA_COLS
  const rows = gridRows(cols, w, h)
  const key = `${fit}|${cols}x${rows}|${src}`
  const hit = cache.get(key)
  if (hit) {
    // Most recently used last.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const promise = decode(src)
    .then((source) => {
      try {
        return measure(source, src, cols, rows, fit, w, h)
      } finally {
        release(source)
      }
    })
    .catch(() => null)
  remember(key, promise)
  return promise
}
