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
// The rebuild is safe to run against a LIVE directory (the Pi runs it against
// the photos the kiosk is actively serving): existing files are kept and
// reused, new files land via tmp+rename, manifest.json is replaced atomically
// last, and only then are orphaned photos pruned. Clients polling mid-run
// always see a consistent manifest whose files all exist.
//
// Art albums (Immich mode only): albums whose name starts with "Art" hold
// professional copies of famous artworks. Their photos skip GPS resolution
// and face fetch; instead curated metadata from art-metadata.json (keyed by
// originalFileName, see docs/designs/art-albums.md) becomes a museum placard:
// exif.location = title, exif.date = "artist, year", exif.album = movement,
// plus a structured `art` field for clients that want the parts. sortKey
// comes from the artwork's creation year, so date-taken ordering doubles as
// art-history chronology.
//
// Environment:
//   - IMMICH_URL, IMMICH_API_KEY:   enables Immich mode.
//   - GOOGLE_API_KEY:               enables Google Places step (recommended).
//   - KIOSK_CUSTOM_PLACES_PATH:     custom-places.json path override.
//   - ART_METADATA_PATH:            art-metadata.json path override.
//   - STUB_PHOTOS_DIR:              output dir override (default
//                                   code/public/stub-photos; the Pi sets
//                                   /home/pi/kiosk/stub-photos).
//
// Usage:
//   node --env-file=.env scripts/build-photo-manifest.mjs

import { mkdir, readdir, readFile, writeFile, copyFile, rename, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, extname } from 'node:path'

import { LocationCache } from './lib/locationCache.mjs'
import { loadCustomPlaces } from './lib/customPlaces.mjs'
import { createResolver } from './lib/locationResolver.mjs'
import { listAlbums, listAlbumAssets, getAsset, downloadPreview } from './lib/immich.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const SAMPLES_DIR = join(PROJECT_ROOT, 'samplePhotos')
const PUBLIC_DIR =
  process.env.STUB_PHOTOS_DIR ||
  join(PROJECT_ROOT, 'code', 'public', 'stub-photos')
const LOCATION_CACHE = join(__dirname, '.location-cache.json')
const CUSTOM_PLACES_PATH =
  process.env.KIOSK_CUSTOM_PLACES_PATH ||
  join(PROJECT_ROOT, 'custom-places.json')
const ART_METADATA_PATH =
  process.env.ART_METADATA_PATH ||
  join(PROJECT_ROOT, 'art-metadata.json')

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
const { places: customPlaces, home: homeConfig } = await loadCustomPlaces(CUSTOM_PLACES_PATH)
console.log(`Loaded ${customPlaces.length} custom places from ${CUSTOM_PLACES_PATH}`)
if (homeConfig) {
  console.log(`Home metro: ${homeConfig.metro_radius_km} km around ${homeConfig.lat.toFixed(4)},${homeConfig.lon.toFixed(4)} (${homeConfig.country_code})`)
}
const resolver = createResolver({ cache, customPlaces, apiKey: googleKey, home: homeConfig })

// --- Art metadata (curated placards for "Art *" albums) ----------------------
// Keys are originalFileName, NFC-normalized on both sides: macOS uploads land
// in Immich NFD-decomposed, while the curated JSON is authored NFC.
const nfcName = (s) => (s || '').normalize('NFC')
let artPieces = new Map()
if (existsSync(ART_METADATA_PATH)) {
  try {
    const doc = JSON.parse(await readFile(ART_METADATA_PATH, 'utf8'))
    artPieces = new Map(
      Object.entries(doc.pieces || {}).map(([k, v]) => [nfcName(k), v])
    )
    console.log(`Loaded ${artPieces.size} art pieces from ${ART_METADATA_PATH}`)
  } catch (e) {
    console.warn(`! failed to parse ${ART_METADATA_PATH}: ${e.message} - art albums get no placards`)
  }
} else {
  console.warn(`! ${ART_METADATA_PATH} not found - art albums get no placards`)
}

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

// Photos referenced by the manifest being built. Orphans (on disk but not in
// the new manifest) are pruned only AFTER the new manifest lands, so a client
// polling mid-run never sees a manifest pointing at deleted files.
const keepFiles = new Set()

// Sweep stray .part files from a previous interrupted run. Downloads land at
// their final name only via rename, so anything .part is garbage.
for (const name of await readdir(PUBLIC_DIR)) {
  if (name.endsWith('.part')) await rm(join(PUBLIC_DIR, name)).catch(() => {})
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

  // Albums named "Art", "Art 01", "Art - Landscapes", ... hold curated
  // artworks (\b so e.g. "Artisan Market" stays a photo album). A photo in
  // both an art album and a family album is treated as art.
  const artAlbumIds = new Set(
    albums.filter((a) => /^Art\b/.test(a.name)).map((a) => a.id)
  )

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
  let downloaded = 0
  let reused = 0
  for (const { asset, albums: albumIds } of all) {
    i++
    const ex = asset.exifInfo || {}
    const filename = `immich-${asset.id}.jpg`
    const dst = join(PUBLIC_DIR, filename)

    // Previews are content-stable per asset id, so a file already on disk is
    // reused (keeps nightly runs fast and spares the Pi's SD card). Partial
    // files never land at the final name (tmp+rename), so existence implies
    // a complete file. New assets download on per-asset error tolerance so
    // one bad asset doesn't sink the whole run.
    if (existsSync(dst)) {
      reused++
    } else {
      try {
        await downloadPreview({
          baseUrl: immichUrl, apiKey: immichKey, assetId: asset.id, outPath: `${dst}.part`,
        })
        await rename(`${dst}.part`, dst)
        downloaded++
      } catch (e) {
        await rm(`${dst}.part`).catch(() => {})
        console.warn(`  [${i}/${all.length}] ! download failed for ${asset.id}: ${e.message}`)
        continue
      }
    }
    keepFiles.add(filename)

    const isArt = [...albumIds].some((id) => artAlbumIds.has(id))

    // Fetch full asset detail to get people[].faces[] geometry, which the
    // album-list endpoint omits. Cheap on LAN. Skipped for art: face boxes on
    // painted figures would drag the kitchen's smart crop around a canvas.
    let faces = []
    if (!isArt) {
      try {
        const detail = await getAsset({ baseUrl: immichUrl, apiKey: immichKey, assetId: asset.id })
        faces = extractFaces(detail)
      } catch (e) {
        console.warn(`  [${i}/${all.length}] ! face fetch failed for ${asset.id}: ${e.message}`)
      }
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

    const entry = {
      src: `/stub-photos/${filename}`,
      width: rawW,
      height: rawH,
      orientation,
      sortKey,
      addedAt,
      albums: [...albumIds],
      exif: { location: '', date: '', album: '' },
    }

    if (isArt) {
      // Museum placard from curated metadata; no GPS work at all. A miss
      // degrades to an uncaptioned photo and is fixed by re-running the
      // curation workflow (docs/designs/art-albums.md).
      const meta = artPieces.get(nfcName(asset.originalFileName))
      if (meta) {
        entry.exif = {
          location: meta.title || '',
          date: meta.artist ? `${meta.artist}, ${meta.year || ''}`.replace(/, $/, '') : '',
          album: meta.movement || '',
        }
        entry.art = {
          title: meta.title || '',
          artist: meta.artist || '',
          year: meta.year || '',
          movement: meta.movement || '',
          facts: Array.isArray(meta.facts) ? meta.facts : [],
        }
        if (Number.isFinite(meta.sortYear)) {
          entry.sortKey = Date.UTC(meta.sortYear, 0, 1)
        }
        console.log(`  [${i}/${all.length}] ${filename}  ${rawW}x${rawH}  [art] ${meta.title} - ${meta.artist} (${meta.year})`)
      } else {
        console.warn(`  [${i}/${all.length}] ! art asset missing from art-metadata.json: ${asset.originalFileName}`)
      }
      entries.push(entry)
      continue
    }

    // GPS.
    const lat = typeof ex.latitude === 'number' ? ex.latitude : null
    const lon = typeof ex.longitude === 'number' ? ex.longitude : null
    const { name: location, source: locationSource } = await resolveLocation(lat, lon)

    const tag = locationSource ? `[${locationSource}] ` : ''
    const faceTag = faces.length > 0 ? ` ${faces.length}f` : ''
    console.log(`  [${i}/${all.length}] ${filename}  ${rawW}x${rawH}${faceTag}  ${dateStr || '(no date)'}  ${tag}${location || '(no location)'}`)

    entry.exif = {
      location: location || '',
      date: dateStr || '',
      album: '',
    }
    if (faces.length > 0) entry.faces = faces
    entries.push(entry)
  }

  console.log(`Previews: ${downloaded} downloaded, ${reused} reused from disk`)
  return { entries, albums }
}

// --- Mode 2: samplePhotos/ (fallback) ---------------------------------------

async function processSamplePhotos() {
  if (!existsSync(SAMPLES_DIR)) {
    throw new Error(`samplePhotos/ not found at ${SAMPLES_DIR} - set IMMICH_URL+IMMICH_API_KEY or populate samplePhotos/`)
  }
  // exifr is only needed in this mode; loading it lazily keeps the Pi's
  // Immich-mode build free of node_modules entirely.
  const exifr = (await import('exifr')).default
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
    await copyFile(src, `${dst}.part`)
    await rename(`${dst}.part`, dst)
    keepFiles.add(name)

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

// A live display is behind this manifest; an empty result is far more likely
// an Immich hiccup than a deliberately emptied library. Bail without touching
// the manifest or pruning (which would otherwise delete every photo).
if (entries.length === 0) {
  throw new Error('0 photos processed - aborting without writing manifest or pruning')
}

// Sort oldest -> newest by date taken.
entries.sort((a, b) => a.sortKey - b.sortKey)
for (const e of entries) delete e.sortKey

const manifest = {
  _comment:
    `Generated by scripts/build-photo-manifest.mjs (${useImmich ? 'Immich mode' : 'samplePhotos mode'}). Re-run to refresh.`,
  albums,
  photos: entries,
}

// Atomic replace: clients polling manifest.json never see a partial write.
const manifestPath = join(PUBLIC_DIR, 'manifest.json')
await writeFile(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2) + '\n')
await rename(`${manifestPath}.tmp`, manifestPath)

// Only now is it safe to drop photos the new manifest no longer references.
let pruned = 0
for (const name of await readdir(PUBLIC_DIR)) {
  if (!ALLOWED_EXT.has(extname(name).toLowerCase())) continue
  if (keepFiles.has(name)) continue
  await rm(join(PUBLIC_DIR, name)).catch(() => {})
  pruned++
}
if (pruned > 0) console.log(`Pruned ${pruned} orphaned photo file(s)`)

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
