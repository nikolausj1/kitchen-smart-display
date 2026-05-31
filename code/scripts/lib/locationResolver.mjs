// Main entry: resolveLocation({lat, lon}) -> { name, source } | null.
//
// Walks the cascade defined in location-resolution-strategy.md:
//   1. Custom places (gitignored JSON, user's named bubbles)
//   2. Google Places nearby (whitelist + 50m + ambiguity guard)
//   3. Nominatim reverse-geocode (broad geographic fallback)
//   4. null  -> the chip hides

import { findMatchingCustomPlace } from './customPlaces.mjs'
import { nearbySearch, nearbyContextSearch } from './googlePlaces.mjs'
import { reverseGeocode } from './geocoder.mjs'

export function createResolver({ cache, customPlaces, apiKey }) {
  // Counters so the build script can print "made N new API calls" at the
  // end - lets the user see cost in real time.
  const stats = {
    customHits: 0,
    googleHits: 0,
    geocodeHits: 0,
    nullCached: 0,
    cacheHits: 0,
    googleCalls: 0,
    contextGoogleCalls: 0,
    geocodeCalls: 0,
  }

  // Drop cache entries that have been overridden by a (new or renamed)
  // custom place. Per doc: cleanest is to walk on app start.
  cache.invalidateForCustomPlaces((lat, lon) =>
    findMatchingCustomPlace(lat, lon, customPlaces)
  )

  async function resolve(lat, lon) {
    const cached = cache.get(lat, lon)
    if (cached !== undefined) {
      stats.cacheHits++
      return cached.name ? { name: cached.name, source: cached.source } : null
    }

    // 1. Custom places.
    const custom = findMatchingCustomPlace(lat, lon, customPlaces)
    if (custom && custom.mode !== 'context') {
      stats.customHits++
      cache.set(lat, lon, { name: custom.name, source: 'custom' })
      return { name: custom.name, source: 'custom' }
    }

    // Context-mode: drill deeper inside the venue, never fall through to
    // geographic fallback (we don't want "Orlando" for a photo at
    // Universal Studios).
    if (custom && custom.mode === 'context') {
      if (apiKey) stats.contextGoogleCalls++
      const ctx = await nearbyContextSearch({
        apiKey,
        lat,
        lon,
        inner_radius_m: custom.inner_radius_m || 30,
      })
      if (ctx) {
        stats.googleHits++
        cache.set(lat, lon, {
          name: ctx.name,
          source: 'google_places',
          place_id: ctx.place_id,
        })
        return { name: ctx.name, source: 'google_places' }
      }
      // Fall back to the venue name itself - skip geographic fallback.
      stats.customHits++
      cache.set(lat, lon, { name: custom.name, source: 'custom' })
      return { name: custom.name, source: 'custom' }
    }

    // 2. Google Places nearby.
    if (apiKey) {
      stats.googleCalls++
      const hit = await nearbySearch({ apiKey, lat, lon, radius_m: 50 })
      if (hit) {
        stats.googleHits++
        cache.set(lat, lon, {
          name: hit.name,
          source: 'google_places',
          place_id: hit.place_id,
        })
        return { name: hit.name, source: 'google_places' }
      }
    }

    // 3. Nominatim reverse-geocode (broad fallback).
    stats.geocodeCalls++
    const place = await reverseGeocode(lat, lon)
    if (place) {
      stats.geocodeHits++
      cache.set(lat, lon, { name: place, source: 'geocode' })
      return { name: place, source: 'geocode' }
    }

    // 4. Null - persist as null_no_match so we don't re-query.
    stats.nullCached++
    cache.set(lat, lon, { name: null, source: 'null_no_match' })
    return null
  }

  return { resolve, stats }
}
