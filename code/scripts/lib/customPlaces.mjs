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

// Returns { places, home }. `home` is the metro-center config used to decide
// whether a POI gets a "City, ST" caption suffix (see location-resolution
// -strategy.md). Falls back to the "Home" place's coords if no `home` block.
export async function loadCustomPlaces(path) {
  if (!existsSync(path)) {
    console.warn(`! custom-places file not found at ${path} - resolver will skip custom matching`)
    return { places: [], home: null }
  }
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const list = Array.isArray(raw?.places) ? raw.places : []
    const places = list
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
    return { places, home: normalizeHome(raw?.home, places) }
  } catch (e) {
    console.warn(`! custom-places parse failed (${e.message}) - resolver will skip custom matching`)
    return { places: [], home: null }
  }
}

// Resolve the home-metro config: an explicit `home` block wins; otherwise fall
// back to the "Home" place's coordinates. Returns null if no center is known.
function normalizeHome(home, places) {
  let lat = home && typeof home.lat === 'number' ? home.lat : null
  let lon = home && typeof home.lon === 'number' ? home.lon : null
  if (lat === null || lon === null) {
    const h = places.find((p) => p.category === 'home') ||
      places.find((p) => /^home$/i.test(p.name))
    if (h) { lat = h.lat; lon = h.lon }
  }
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  return {
    lat,
    lon,
    metro_radius_km: home && typeof home.metro_radius_km === 'number' ? home.metro_radius_km : 60,
    country_code: String((home && home.country_code) || 'US').toUpperCase(),
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
