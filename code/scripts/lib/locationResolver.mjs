// Main entry: resolveLocation({lat, lon}) -> { name, source } | null.
//
// Walks the cascade defined in location-resolution-strategy.md:
//   1. Custom places (gitignored JSON, user's named bubbles)
//   2. Google Places nearby (whitelist + 50m + ambiguity guard)
//   3. Nominatim reverse-geocode (broad geographic fallback)
//   4. null  -> the chip hides

import { findMatchingCustomPlace } from './customPlaces.mjs'
import { nearbySearch, nearbyContextSearch } from './googlePlaces.mjs'
import { reverseGeocodeComponents } from './geocoder.mjs'
import { haversineMeters } from './haversine.mjs'

export function createResolver({ cache, customPlaces, apiKey, home }) {
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

  // Suffix a POI caption with "City, ST" (or "City, Country" abroad) when the
  // photo is beyond the home-metro radius. Within the radius - or with no home
  // configured / no city resolved - the bare place name is returned.
  function composePoi(name, comp, lat, lon) {
    if (!home || !comp) return name
    const dist = haversineMeters(lat, lon, home.lat, home.lon)
    if (dist <= home.metro_radius_km * 1000) return name
    if (!comp.city) return name
    if (comp.countryCode && comp.countryCode === home.country_code) {
      return comp.regionCode
        ? `${name} - ${comp.city}, ${comp.regionCode}`
        : `${name} - ${comp.city}`
    }
    return comp.country ? `${name} - ${comp.city}, ${comp.country}` : `${name} - ${comp.city}`
  }

  // Compose the geographic-fallback caption from components. At home:
  // "Neighborhood, City" (or city / region / country). Away from home: drop the
  // neighborhood and append the state ("City, ST" in the US) or country abroad.
  function composeGeo(comp, lat, lon) {
    if (!comp) return null
    const { neighborhood, city, region, regionCode, country, countryCode } = comp
    const away = home && haversineMeters(lat, lon, home.lat, home.lon) > home.metro_radius_km * 1000
    if (away && city) {
      if (countryCode && countryCode === home.country_code) {
        return regionCode ? `${city}, ${regionCode}` : city
      }
      return country ? `${city}, ${country}` : city
    }
    if (neighborhood && city) return `${neighborhood}, ${city}`
    if (city) return city
    if (region) return region
    if (country) return country
    return null
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
      if (!cached.name) return null
      if (cached.source === 'google_places') {
        // Compose the city/state suffix from stored components. Entries that
        // predate this feature lack components - backfill once via geocode.
        let comp = cached.comp
        if (!('comp' in cached)) {
          comp = await reverseGeocodeComponents(lat, lon)
          cache.set(lat, lon, {
            name: cached.name,
            source: 'google_places',
            place_id: cached.place_id,
            comp: comp || null,
          })
        }
        return { name: composePoi(cached.name, comp, lat, lon), source: 'google_places' }
      }
      if (cached.source === 'geocode') {
        let comp = cached.comp
        if (!('comp' in cached)) {
          comp = await reverseGeocodeComponents(lat, lon)
          cache.set(lat, lon, { name: cached.name, source: 'geocode', comp: comp || null })
        }
        return { name: composeGeo(comp, lat, lon) || cached.name, source: 'geocode' }
      }
      return { name: cached.name, source: cached.source }
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
        const comp = await reverseGeocodeComponents(lat, lon)
        cache.set(lat, lon, {
          name: ctx.name,
          source: 'google_places',
          place_id: ctx.place_id,
          comp: comp || null,
        })
        return { name: composePoi(ctx.name, comp, lat, lon), source: 'google_places' }
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
        const comp = await reverseGeocodeComponents(lat, lon)
        cache.set(lat, lon, {
          name: hit.name,
          source: 'google_places',
          place_id: hit.place_id,
          comp: comp || null,
        })
        return { name: composePoi(hit.name, comp, lat, lon), source: 'google_places' }
      }
    }

    // 3. Nominatim reverse-geocode (broad fallback). Away from home we append
    // the state/country and drop the neighborhood; at home we keep
    // "Neighborhood, City".
    stats.geocodeCalls++
    const geo = await reverseGeocodeComponents(lat, lon)
    const place = composeGeo(geo, lat, lon)
    if (place) {
      stats.geocodeHits++
      cache.set(lat, lon, { name: place, source: 'geocode', comp: geo })
      return { name: place, source: 'geocode' }
    }

    // 4. Null - persist as null_no_match so we don't re-query.
    stats.nullCached++
    cache.set(lat, lon, { name: null, source: 'null_no_match' })
    return null
  }

  return { resolve, stats }
}
