#!/usr/bin/env node
// Build a fresh manifest.json from samplePhotos/ at the project root.
//
// For each photo:
//   - Reads EXIF via exifr (dimensions, DateTimeOriginal, GPS).
//   - If GPS is present, reverse-geocodes via Nominatim (rate-limited to
//     1 req/sec, with a polite User-Agent and an on-disk cache).
//   - Computes orientation from width/height.
//
// Side effects:
//   - Wipes any *.jpg / *.jpeg / *.png / *.JPG / *.JPEG / *.PNG in
//     code/public/stub-photos/ (keeps icons/, weather/, etc. untouched).
//   - Copies every photo from samplePhotos/ into code/public/stub-photos/.
//   - Writes code/public/stub-photos/manifest.json sorted oldest->newest.
//
// Usage: node scripts/build-photo-manifest.mjs

import { mkdir, readdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, extname, basename } from 'node:path'
import exifr from 'exifr'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const SAMPLES_DIR = join(PROJECT_ROOT, 'samplePhotos')
const PUBLIC_DIR = join(PROJECT_ROOT, 'code', 'public', 'stub-photos')
const GEOCODE_CACHE = join(__dirname, '.geocode-cache.json')

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic'])

// --- Geocode cache ----------------------------------------------------------
let cache = {}
if (existsSync(GEOCODE_CACHE)) {
  try {
    cache = JSON.parse(await readFile(GEOCODE_CACHE, 'utf8'))
  } catch {
    cache = {}
  }
}

async function saveCache() {
  await writeFile(GEOCODE_CACHE, JSON.stringify(cache, null, 2))
}

// Round to ~100m precision so nearby photos share a cache key + look-up.
function gpsKey(lat, lon) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

let lastGeocodeAt = 0
async function reverseGeocode(lat, lon) {
  const key = gpsKey(lat, lon)
  if (cache[key] !== undefined) return cache[key]

  // Nominatim TOS: max 1 request per second.
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastGeocodeAt = Date.now()

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', lat)
  url.searchParams.set('lon', lon)
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '13')

  let place = null
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'kitchen-smart-display/0.1 (personal kiosk photo manifest build)',
      },
    })
    if (res.ok) {
      const data = await res.json()
      const a = data.address || {}
      const locality =
        a.neighbourhood || a.suburb || a.village || a.town || a.city || a.hamlet || a.county
      const region = a.state || a.region || a.country
      place = [locality, region].filter(Boolean).join(', ') || data.display_name || null
    }
  } catch (e) {
    console.warn(`  ! geocode failed for ${key}: ${e.message}`)
  }

  cache[key] = place
  await saveCache()
  return place
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

// --- Main -------------------------------------------------------------------

if (!existsSync(SAMPLES_DIR)) {
  console.error(`samplePhotos/ not found at ${SAMPLES_DIR}`)
  process.exit(1)
}
await mkdir(PUBLIC_DIR, { recursive: true })

// Wipe old photo files in PUBLIC_DIR (keep manifest.json for now; we
// rewrite it at the end. Do NOT touch icons/ or other subdirs).
const existing = await readdir(PUBLIC_DIR)
for (const name of existing) {
  if (ALLOWED_EXT.has(extname(name).toLowerCase())) {
    await rm(join(PUBLIC_DIR, name))
  }
}

const files = (await readdir(SAMPLES_DIR))
  .filter((n) => ALLOWED_EXT.has(extname(n).toLowerCase()))

console.log(`Processing ${files.length} photos...`)

const entries = []
let i = 0
for (const name of files) {
  i++
  const src = join(SAMPLES_DIR, name)
  const dst = join(PUBLIC_DIR, name)

  // Copy the file in.
  await copyFile(src, dst)

  // Read EXIF. Use { gps: true } so exifr returns synthesized decimal
  // latitude/longitude (otherwise GPSLatitude is the raw dms array).
  let exif = null
  try {
    exif = await exifr.parse(src, {
      tiff: true,
      exif: true,
      gps: true,
    })
  } catch {
    // No EXIF; fall through with nulls.
  }

  // Dimensions. iPhone (and other) photos shot in portrait have sensor
  // dimensions in landscape (e.g. 4032x3024) but an EXIF Orientation tag
  // of 5-8 that rotates them 90deg for display. Swap w/h in those cases so
  // our portrait/landscape classification matches what the user sees.
  let w = exif?.ExifImageWidth || exif?.PixelXDimension || exif?.ImageWidth || 0
  let h = exif?.ExifImageHeight || exif?.PixelYDimension || exif?.ImageHeight || 0
  const exifOri = exif?.Orientation || 1
  if (exifOri >= 5 && exifOri <= 8) {
    const tmp = w
    w = h
    h = tmp
  }
  const orientation = w && h ? (w >= h ? 'landscape' : 'portrait') : 'landscape'

  // Date.
  const dateObj = exif?.DateTimeOriginal || exif?.CreateDate || null
  const dateStr = fmtDate(dateObj)
  const sortKey = dateObj ? new Date(dateObj).getTime() : 0

  // GPS -> place name. exifr exposes decimal lat/lon as `latitude` /
  // `longitude` when { gps: true } is passed.
  let location = null
  const lat = typeof exif?.latitude === 'number' ? exif.latitude : null
  const lon = typeof exif?.longitude === 'number' ? exif.longitude : null
  if (lat != null && lon != null) {
    location = await reverseGeocode(lat, lon)
  }

  console.log(`  [${i}/${files.length}] ${name}  ${w}x${h}  ${dateStr || '(no date)'}  ${location || '(no location)'}`)

  entries.push({
    src: `/stub-photos/${name}`,
    width: w,
    height: h,
    orientation,
    sortKey,
    exif: {
      location: location || '',
      date: dateStr || '',
      album: '',
    },
  })
}

// Sort oldest -> newest so the slideshow walks chronologically.
entries.sort((a, b) => a.sortKey - b.sortKey)
for (const e of entries) delete e.sortKey

const manifest = {
  _comment:
    'Generated by scripts/build-photo-manifest.mjs from samplePhotos/. Re-run that script after adding/removing photos.',
  photos: entries,
}

await writeFile(
  join(PUBLIC_DIR, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
)

console.log(`\nWrote ${entries.length} entries to ${join(PUBLIC_DIR, 'manifest.json')}`)
