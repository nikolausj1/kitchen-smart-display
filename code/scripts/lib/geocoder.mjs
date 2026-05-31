// Nominatim reverse-geocode - the "broad strokes" fallback when neither
// the custom-places registry nor Google Places returned a meaningful match.
// Free, no API key, but rate-limited to 1 req/sec per their TOS.
//
// Per the doc, the preferred address components are:
//   1. neighborhood / sublocality_level_1   -> "Magnolia"
//   2. locality                              -> "Seattle"
//   3. administrative_area_level_1           -> "Washington"
// And the display string combines the two most specific available
// ("Magnolia, Seattle"), or just the city, or just the state.

const RATE_LIMIT_MS = 1100
let lastCallAt = 0

export async function reverseGeocode(lat, lon) {
  // Be a polite Nominatim citizen.
  const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastCallAt))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCallAt = Date.now()

  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('format', 'json')
  url.searchParams.set('zoom', '14') // street/neighborhood level
  url.searchParams.set('addressdetails', '1')

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'kitchen-smart-display/0.1 (personal kiosk photo manifest build)',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    const a = data.address || {}

    // Map Nominatim address keys to the doc's preferred components.
    const neighborhood =
      a.neighbourhood || a.suburb || a.city_district || a.quarter || null
    const locality =
      a.city || a.town || a.village || a.hamlet || a.municipality || null
    const region = a.state || a.region || null
    const country = a.country || null

    // Build the most-specific available display string.
    if (neighborhood && locality) return `${neighborhood}, ${locality}`
    if (locality) return locality
    if (region) return region
    if (country) return country
    return data.display_name || null
  } catch (e) {
    console.warn(`  ! nominatim failed for ${lat},${lon}: ${e.message}`)
    return null
  }
}
