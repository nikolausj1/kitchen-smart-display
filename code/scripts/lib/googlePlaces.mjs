// Google Places API (New) - Nearby Search.
// See location-resolution-strategy.md for the cascade rules.
//
// API key is read from GOOGLE_API_KEY env var. If missing, the resolver
// skips this step entirely and falls through to Nominatim.
//
// Field mask is restricted to the minimum we need - this keeps every call
// in Google's cheapest pricing tier (~$0.032 / call as of 2026).

import { haversineMeters } from './haversine.mjs'

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby'
const FIELD_MASK = 'places.displayName,places.types,places.location,places.id'

// Types we're willing to display as a photo location. Biased toward
// "places worth photographing." Edit this list to tune behavior - it is
// the single source of truth for the whitelist.
const ALLOWED_TYPES = new Set([
  // Food + drink
  'restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway',
  // Outdoor + parks
  'park', 'national_park', 'tourist_attraction',
  // Culture
  'museum', 'art_gallery', 'library',
  // Recreation
  'amusement_park', 'aquarium', 'zoo', 'stadium', 'gym',
  // Education
  'school', 'university',
  // Worship
  'place_of_worship', 'church', 'mosque', 'synagogue', 'hindu_temple',
  // Performance
  'movie_theater', 'performing_arts_theater',
  // Transit (travel photos)
  'airport', 'train_station', 'subway_station', 'ferry_terminal',
  // Context-mode extras (only relevant for context drilldowns, but
  // including them here too is harmless and keeps one whitelist).
  'amusement_park_ride',
])

// Types we always reject even if Google returns them. Defensive: Places
// occasionally tags a restaurant ALSO as 'establishment' or as a coarse
// 'point_of_interest'. We only need ONE allowed type to accept it.
const DENY_TYPES = new Set([
  'bank', 'atm', 'gas_station', 'car_dealer', 'car_repair', 'parking',
  'post_office', 'pharmacy', 'supermarket', 'convenience_store',
  'shopping_mall', 'office', 'corporate_office',
])

function hasAllowedType(types) {
  for (const t of types || []) {
    if (DENY_TYPES.has(t)) return false
  }
  for (const t of types || []) {
    if (ALLOWED_TYPES.has(t)) return true
  }
  return false
}

async function callPlaces({ apiKey, lat, lon, radius_m, includedTypes }) {
  const body = {
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: radius_m,
      },
    },
    rankPreference: 'POPULARITY',
  }
  if (includedTypes && includedTypes.length > 0) {
    body.includedTypes = includedTypes
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`places HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  return Array.isArray(data?.places) ? data.places : []
}

// Normalize a /v1 result into the small shape we use downstream.
function normalize(place, lat, lon) {
  const lat2 = place?.location?.latitude
  const lon2 = place?.location?.longitude
  const dist =
    typeof lat2 === 'number' && typeof lon2 === 'number'
      ? haversineMeters(lat, lon, lat2, lon2)
      : Infinity
  return {
    id: place?.id || '',
    name: place?.displayName?.text || '',
    types: place?.types || [],
    distance: dist,
  }
}

// Standard nearby lookup. Returns { name, place_id } or null on:
//   - no results within radius_m matching the whitelist
//   - ambiguity (two whitelisted POIs within radius_m AND within 30m of
//     each other) - we'd rather abstain than guess wrong
//   - HTTP / parse failure
export async function nearbySearch({ apiKey, lat, lon, radius_m = 50 }) {
  if (!apiKey) return null
  let raw
  try {
    raw = await callPlaces({ apiKey, lat, lon, radius_m })
  } catch (e) {
    console.warn(`  ! google places failed for ${lat},${lon}: ${e.message}`)
    return null
  }

  const candidates = raw
    .map((p) => normalize(p, lat, lon))
    .filter((p) => p.name && p.distance <= radius_m && hasAllowedType(p.types))

  if (candidates.length === 0) return null

  // Ambiguity guard: if the top two whitelisted candidates are close to
  // each other, we can't tell which one the photo is "of". Abstain so the
  // cascade falls through to geographic fallback.
  if (candidates.length >= 2) {
    const [a, b] = candidates
    // a, b are normalized; we need their lat/lon to measure their
    // mutual distance. Re-derive from the raw entries by id.
    const rawA = raw.find((r) => r.id === a.id)
    const rawB = raw.find((r) => r.id === b.id)
    if (rawA && rawB) {
      const d = haversineMeters(
        rawA.location.latitude, rawA.location.longitude,
        rawB.location.latitude, rawB.location.longitude
      )
      if (d <= 30) {
        return null
      }
    }
  }

  const winner = candidates[0]
  return { name: winner.name, place_id: winner.id }
}

// Context-mode lookup: tighter radius, relaxed ambiguity, expanded
// whitelist (the standard whitelist already includes the context extras,
// so we just call through with a smaller radius and skip the ambiguity
// guard).
export async function nearbyContextSearch({ apiKey, lat, lon, inner_radius_m = 30 }) {
  if (!apiKey) return null
  let raw
  try {
    raw = await callPlaces({ apiKey, lat, lon, radius_m: inner_radius_m })
  } catch (e) {
    console.warn(`  ! google places (context) failed for ${lat},${lon}: ${e.message}`)
    return null
  }

  const candidates = raw
    .map((p) => normalize(p, lat, lon))
    .filter((p) => p.name && p.distance <= inner_radius_m && hasAllowedType(p.types))

  if (candidates.length === 0) return null

  // No ambiguity guard - inside theme parks, adjacent attractions are
  // expected. Take the most prominent (rankPreference=POPULARITY already
  // ordered them).
  const winner = candidates[0]
  return { name: winner.name, place_id: winner.id }
}
