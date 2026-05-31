#!/usr/bin/env node
// Build a fresh manifest.json. Two modes:
//
//   1. Immich mode (preferred): IMMICH_URL + IMMICH_API_KEY env vars set.
//      Pulls every album from Immich, downloads preview-sized JPEGs into
//      code/public/stub-photos/, and writes a manifest with per-photo
//      album tags plus a top-level albums[] index.
//
//   2. samplePhotos mode (fallback for offline dev): no IMMICH_* env vars.
//      Walks samplePhotos/ on disk, parses EXIF via exifr, copies files in.
//
// In both modes:
//   - GPS coordinates flow through the location resolver (custom places ->
//     Google Places -> Nominatim) and are cached on disk so the same
//     coordinates never re-query an API.
//   - Output dimensions and orientation are computed.
//   - Manifest sorted oldest -> newest by photo date.
//
// Environment:
//   - IMMICH_URL, IMMICH_API_KEY:   enables Immich mode.
//   - GOOGLE_API_KEY:               enables Google Places step (recommended).
//   - KIOSK_CUSTOM_PLACES_PATH:     custom-places.json path override.
//
// Usage:
//   node --env-file=.env scripts/build-photo-manifest.mjs

import { mkdir, readdir, writeFile, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, extname } from 'node:path'
import exifr from 'exifr'

import { LocationCache } from './lib/locationCache.mjs'
import { loadCustomPlaces } from './lib/customPlaces.mjs'
import { createResolver } from './lib/locationResolver.mjs'
import { listAlbums, listAlbumAssets, getAsset, downloadPreview } from './lib/immich.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const SAMPLES_DIR = join(PROJECT_ROOT, 'samplePhotos')
const PUBLIC_DIR = join(PROJECT_ROOT, 'code', 'public', 'stub-photos')
const LOCATION_CACHE = join(__dirname, '.location-cache.json')
const CUSTOM_PLACES_PATH =
  process.env.KIOSK_CUSTOM_PLACES_PATH ||
  join(PROJECT_ROOT, 'custom-places.json')

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic'])

const googleKey = process.env.GOOGLE_API_KEY || ''
const immichUrl = (process.env.IMMICH_URL || '').replace(/\/+$/, '')
const immichKey = process.env.IMMICH_API_KEY || ''
const useImmich = !!(immichUrl && immichKey)

if (!googleKey) {
  console.warn('! GOOGLE_API_KEY not set - Google Places step will be skipped')
  console.warn('  Cascade will be: custom places -> Nominatim -> null')
}

// --- Resolver setup ---------------------------------------------------------
const cache = new LocationCache(LOCATION_CACHE)
await cache.load()
const customPlaces = await loadCustomPlaces(CUSTOM_PLACES_PATH)
console.log(`Loaded ${customPlaces.length} custom places from ${CUSTOM_PLACES_PATH}`)
const resolver = createResolver({ cache, customPlaces, apiKey: googleKey })

// --- Date formatting --------------------------------------------------------

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function fmtDate(d) {
  if (!d) return null
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// --- Output dir housekeeping ------------------------------------------------

await mkdir(PUBLIC_DIR, { recursive: true })

// Wipe old photo files in PUBLIC_DIR (keep manifest.json + non-photo
// subdirs like icons/, weather/, etc.).
const existingFiles = await readdir(PUBLIC_DIR)
for (const name of existingFiles) {
  if (ALLOWED_EXT.has(extname(name).toLowerCase())) {
    await rm(join(PUBLIC_DIR, name))
  }
}

// --- Shared per-photo logic -------------------------------------------------

async function resolveLocation(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { name: null, source: null }
  }
  const r = await resolver.resolve(lat, lon)
  return { name: r?.name || null, source: r?.source || null }
}

// Pull face bounding boxes out of an Immich asset detail response.
// Returns an array of { cx, cy, w, h } normalized 0..1 in the face's own
// reference frame (which is the same frame across all faces on one asset).
// Filters to faces whose area is at least 2% of the image so background
// strangers don't drag the crop sideways.
function extractFaces(assetDetail) {
  const out = []
  const people = assetDetail?.people || []
  for (const p of people) {
    for (const f of p.faces || []) {
      const iw = Number(f.imageWidth) || 0
      const ih = Number(f.imageHeight) || 0
      if (!iw || !ih) continue
      const x1 = Number(f.boundingBoxX1)
      const y1 = Number(f.boundingBoxY1)
      const x2 = Number(f.boundingBoxX2)
      const y2 = Number(f.boundingBoxY2)
      const w = (x2 - x1) / iw
      const h = (y2 - y1) / ih
      if (!(w > 0) || !(h > 0)) continue
      if (w * h < 0.02) continue // skip tiny background faces
      out.push({
        cx: ((x1 + x2) / 2) / iw,
        cy: ((y1 + y2) / 2) / ih,
        w,
        h,
      })
    }
  }
  return out
}

function classifyOrientation(w, h, exifOrientation) {
  let ww = w, hh = h
  if (exifOrientation >= 5 && exifOrientation <= 8) {
    ;[ww, hh] = [hh, ww]
  }
  return {
    width: ww,
    height: hh,
    orientation: ww && hh ? (ww >= hh ? 'landscape' : 'portrait') : 'landscape',
  }
}

// --- Mode 1: Immich ---------------------------------------------------------

async function processImmich() {
  console.log(`Immich mode -> ${immichUrl}`)
  const albums = await listAlbums({ baseUrl: immichUrl, apiKey: immichKey })
  console.log(`Found ${albums.length} albums:`)
  for (const a of albums) console.log(`  - ${a.name}  (${a.count} assets)  ${a.id}`)

  // Map of assetId -> { asset, albums: Set<albumId> }. We dedupe so a photo
  // in two albums is downloaded + resolved once.
  const byAsset = new Map()
  for (const album of albums) {
    const assets = await listAlbumAssets({
      baseUrl: immichUrl, apiKey: immichKey, albumId: album.id,
    })
    for (const a of assets) {
      if (a.type !== 'IMAGE') continue
      if (a.isTrashed) continue
      const slot = byAsset.get(a.id) || { asset: a, albums: new Set() }
      slot.albums.add(album.id)
      byAsset.set(a.id, slot)
    }
  }
  const all = [...byAsset.values()]
  console.log(`Processing ${all.length} unique image assets...`)

  const entries = []
  let i = 0
  for (const { asset, albums: albumIds } of all) {
    i++
    const ex = asset.exifInfo || {}
    const filename = `immich-${asset.id}.jpg`
    const dst = join(PUBLIC_DIR, filename)

    // Download preview. Skip on per-asset error so one bad asset doesn't
    // sink the whole run.
    try {
      await downloadPreview({
        baseUrl: immichUrl, apiKey: immichKey, assetId: asset.id, outPath: dst,
      })
    } catch (e) {
      console.warn(`  [${i}/${all.length}] ! download failed for ${asset.id}: ${e.message}`)
      continue
    }

    // Fetch full asset detail to get people[].faces[] geometry, which the
    // album-list endpoint omits. Cheap on LAN.
    let faces = []
    try {
      const detail = await getAsset({ baseUrl: immichUrl, apiKey: immichKey, assetId: asset.id })
      faces = extractFaces(detail)
    } catch (e) {
      console.warn(`  [${i}/${all.length}] ! face fetch failed for ${asset.id}: ${e.message}`)
    }

    // Dimensions: prefer asset-level width/height (Immich normalizes for
    // orientation already, in most cases). Fall back to exifInfo.
    const rawW = asset.width || ex.exifImageWidth || 0
    const rawH = asset.height || ex.exifImageHeight || 0
    // Immich asset.width/height appear to already reflect display
    // orientation, so we don't re-rotate. Trust them as-is.
    const orientation = rawW && rawH
      ? (rawW >= rawH ? 'landscape' : 'portrait') : 'landscape'

    // Date: dateTimeOriginal is ISO. fileCreatedAt is when uploaded.
    const takenAt = ex.dateTimeOriginal ? new Date(ex.dateTimeOriginal) : null
    const dateStr = fmtDate(takenAt)
    const sortKey = takenAt ? takenAt.getTime() : 0

    // addedAt = when added to Immich (best proxy for "new in library").
    const addedAt = asset.createdAt ? new Date(asset.createdAt).getTime() : 0

    // GPS.
    const lat = typeof ex.latitude === 'number' ? ex.latitude : null
    const lon = typeof ex.longitude === 'number' ? ex.longitude : null
    const { name: location, source: locationSource } = await resolveLocation(lat, lon)

    const tag = locationSource ? `[${locationSource}] ` : ''
    const faceTag = faces.length > 0 ? ` ${faces.length}f` : ''
    console.log(`  [${i}/${all.length}] ${filename}  ${rawW}x${rawH}${faceTag}  ${dateStr || '(no date)'}  ${tag}${location || '(no location)'}`)

    const entry = {
      src: `/stub-photos/${filename}`,
      width: rawW,
      height: rawH,
      orientation,
      sortKey,
      addedAt,
      albums: [...albumIds],
      exif: {
        location: location || '',
        date: dateStr || '',
        album: '',
      },
    }
    if (faces.length > 0) entry.faces = faces
    entries.push(entry)
  }

  return { entries, albums }
}

// --- Mode 2: samplePhotos/ (fallback) ---------------------------------------

async function processSamplePhotos() {
  if (!existsSync(SAMPLES_DIR)) {
    throw new Error(`samplePhotos/ not found at ${SAMPLES_DIR} - set IMMICH_URL+IMMICH_API_KEY or populate samplePhotos/`)
  }
  const files = (await readdir(SAMPLES_DIR))
    .filter((n) => ALLOWED_EXT.has(extname(n).toLowerCase()))
  console.log(`samplePhotos mode -> ${files.length} files`)

  const entries = []
  let i = 0
  for (const name of files) {
    i++
    const src = join(SAMPLES_DIR, name)
    const dst = join(PUBLIC_DIR, name)

    let addedAt = 0
    try { addedAt = Math.round((await stat(src)).mtimeMs) } catch {}
    await copyFile(src, dst)

    let exif = null
    try {
      exif = await exifr.parse(src, { tiff: true, exif: true, gps: true })
    } catch {}

    const rawW = exif?.ExifImageWidth || exif?.PixelXDimension || exif?.ImageWidth || 0
    const rawH = exif?.ExifImageHeight || exif?.PixelYDimension || exif?.ImageHeight || 0
    const { width, height, orientation } =
      classifyOrientation(rawW, rawH, exif?.Orientation || 1)

    const takenAt = exif?.DateTimeOriginal || exif?.CreateDate || null
    const dateStr = fmtDate(takenAt)
    const sortKey = takenAt ? new Date(takenAt).getTime() : 0

    const lat = typeof exif?.latitude === 'number' ? exif.latitude : null
    const lon = typeof exif?.longitude === 'number' ? exif.longitude : null
    const { name: location, source: locationSource } = await resolveLocation(lat, lon)

    const tag = locationSource ? `[${locationSource}] ` : ''
    console.log(`  [${i}/${files.length}] ${name}  ${width}x${height}  ${dateStr || '(no date)'}  ${tag}${location || '(no location)'}`)

    entries.push({
      src: `/stub-photos/${name}`,
      width,
      height,
      orientation,
      sortKey,
      addedAt,
      albums: [],
      exif: { location: location || '', date: dateStr || '', album: '' },
    })
  }

  return { entries, albums: [] }
}

// --- Main -------------------------------------------------------------------

const { entries, albums } = useImmich
  ? await processImmich()
  : await processSamplePhotos()

// Sort oldest -> newest by date taken.
entries.sort((a, b) => a.sortKey - b.sortKey)
for (const e of entries) delete e.sortKey

const manifest = {
  _comment:
    `Generated by scripts/build-photo-manifest.mjs (${useImmich ? 'Immich mode' : 'samplePhotos mode'}). Re-run to refresh.`,
  albums,
  photos: entries,
}

await writeFile(
  join(PUBLIC_DIR, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
)

await cache.save()

console.log(`\nWrote ${entries.length} entries to ${join(PUBLIC_DIR, 'manifest.json')}`)
if (albums.length > 0) console.log(`Albums in manifest: ${albums.length}`)

const s = resolver.stats
console.log('\nResolver stats:')
console.log(`  cache hits:        ${s.cacheHits}`)
console.log(`  custom matches:    ${s.customHits}`)
console.log(`  google API calls:  ${s.googleCalls + s.contextGoogleCalls}  (${s.googleHits} matched)`)
console.log(`  nominatim calls:   ${s.geocodeCalls}  (${s.geocodeHits} matched)`)
console.log(`  null cached:       ${s.nullCached}`)
const cs = cache.stats()
console.log(`  cache size:        ${cs.total} entries  (${cs.nulls} null)`)
