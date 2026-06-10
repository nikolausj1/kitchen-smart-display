// Nominatim reverse-geocode - the "broad strokes" fallback when neither
// the custom-places registry nor Google Places returned a meaningful match,
// and (via reverseGeocodeComponents) the city/state/country used to suffix
// POI captions when a photo is away from home.
//
// Free, no API key, but rate-limited to 1 req/sec per their TOS. Both exported
// functions share one fetch + one rate limiter.

import { US_STATE_ABBR } from './us-states.mjs'

const RATE_LIMIT_MS = 1100
let lastCallAt = 0

// Rate-limited reverse lookup. Returns { address, display_name } or null.
async function fetchAddress(lat, lon) {
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastCallAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '14') // street/neighborhood level
  url.searchParams.set('addressdetails', '1')

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'kitchen-smart-display/0.1 (personal kiosk photo manifest build)',
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  return { address: data.address || {}, display_name: data.display_name || null }
}

// Compose a single display string for the geographic-fallback tier:
//   "Magnolia, Seattle" / "Seattle" / "Washington" / country.
export async function reverseGeocode(lat, lon) {
  try {
    const r = await fetchAddress(lat, lon)
    if (!r) return null
    const a = r.address
    const neighborhood =
      a.neighbourhood || a.suburb || a.city_district || a.quarter || null
    const locality =
      a.city || a.town || a.village || a.hamlet || a.municipality || null
    const region = a.state || a.region || null
    const country = a.country || null

    if (neighborhood && locality) return `${neighborhood}, ${locality}`
    if (locality) return locality
    if (region) return region
    if (country) return country
    return r.display_name || null
  } catch (e) {
    console.warn(`  ! nominatim failed for ${lat},${lon}: ${e.message}`)
    return null
  }
}

// Structured components used to suffix a POI caption with where it was:
//   { city, region, regionCode, country, countryCode } | null.
// regionCode is the USPS abbreviation when the country is the US, else null.
export async function reverseGeocodeComponents(lat, lon) {
  try {
    const r = await fetchAddress(lat, lon)
    if (!r) return null
    const a = r.address
    const city = a.city || a.town || a.village || a.hamlet || a.municipality || null
    const region = a.state || a.region || null
    const countryCode = (a.country_code || '').toUpperCase() || null
    const regionCode =
      countryCode === 'US' && region ? US_STATE_ABBR[region] || null : null
    const country = a.country || null
    return { city, region, regionCode, country, countryCode }
  } catch (e) {
    console.warn(`  ! nominatim components failed for ${lat},${lon}: ${e.message}`)
    return null
  }
}
