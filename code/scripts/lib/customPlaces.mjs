// Load the user's custom-places JSON and match coordinates against the
// defined "bubbles". See location-resolution-strategy.md for the schema.
//
// The file lives OUTSIDE the repo by design - it holds real residential
// coordinates and is gitignored. Default path is
// <project-root>/custom-places.json; override with the
// KIOSK_CUSTOM_PLACES_PATH env var.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { haversineMeters } from './haversine.mjs'

export async function loadCustomPlaces(path) {
  if (!existsSync(path)) {
    console.warn(`! custom-places file not found at ${path} - resolver will skip custom matching`)
    return []
  }
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const list = Array.isArray(raw?.places) ? raw.places : []
    return list
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number' && typeof p.radius_m === 'number')
      .map((p) => ({
        name: String(p.name || ''),
        lat: p.lat,
        lon: p.lon,
        radius_m: p.radius_m,
        category: p.category || 'other',
        mode: p.mode === 'context' ? 'context' : 'label',
        inner_radius_m: p.mode === 'context' ? (p.inner_radius_m || 30) : null,
      }))
  } catch (e) {
    console.warn(`! custom-places parse failed (${e.message}) - resolver will skip custom matching`)
    return []
  }
}

// Return the custom place that best matches the given coordinates, or
// null. "Best" = inside the radius AND smallest radius_m (most specific).
// This way a small "Home" bubble nested inside a larger "Magnolia
// neighborhood" bubble would win.
export function findMatchingCustomPlace(lat, lon, places) {
  let best = null
  for (const p of places) {
    const dist = haversineMeters(lat, lon, p.lat, p.lon)
    if (dist <= p.radius_m) {
      if (!best || p.radius_m < best.radius_m) {
        best = p
      }
    }
  }
  return best
}
