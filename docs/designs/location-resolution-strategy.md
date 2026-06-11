---
title: "Location Resolution Strategy"
created: 2026-05-24
modified: 2026-06-09
version: 1.6
author: Claude Opus 4.7 (claude-opus-4-7)
tags:
---

# Location Resolution Strategy

## Purpose

This document defines how the Kitchen Smart Display converts EXIF GPS coordinates from a photo into a meaningful human-readable place name to show on the slideshow overlay. The goal is to display names people actually use ("Tartine", "The Bergers", "Lawton Elementary") rather than generic geographic fallbacks ("Seattle", "Magnolia neighborhood") whenever possible.

This is the living reference for photo place-name captions. The master spec is `../../PRD - Smart Displays.md`; open caption work (e.g. city/state rules) is tracked in `../../BACKLOG.md`. Wrong captions are corrected via the flag-and-triage loop in `photo-corrections-workflow.md`.

## Design principles

1. **Trusted user labels win over inferred ones.** A custom-defined place always beats whatever an external API would return.
2. **Be willing to abstain.** If we are not confident which place a photo was taken at, falling back to a broader name ("Magnolia, Seattle") is always better than guessing a specific place wrong ("Bank of America" when we were at the restaurant next door).
3. **Cache everything.** Coordinates that round to the same key get resolved exactly once. Most photo clusters share coordinates, so this matters a lot for cost and latency.
4. **Graceful degradation.** Missing GPS, API failures, network outages, and partial responses should never break the slideshow. Worst case: no location chip is shown for that photo.

## Resolution cascade

For any photo with GPS coordinates `(lat, lon)`, walk this list top to bottom and return the first hit.

### 1. Custom places registry

The user-defined JSON file (see "Custom places JSON" below). For each entry, compute the haversine distance from the photo coordinates to the entry's `(lat, lon)`. If the distance is less than or equal to the entry's `radius_m`, the entry is a match.

If multiple custom places match (overlapping bubbles), the entry with the smallest `radius_m` wins. This favors specificity: a small "Home" bubble nested inside a larger neighborhood bubble would resolve to "Home".

**Context-mode entries behave differently.** If the matched entry has `mode: "context"`, we do not return the entry's name directly. We treat the match as a hint to drill deeper inside this venue and run a tighter, specialized Google Places lookup (see "Special venues / context mode" below).

### 2. Google Places POI lookup

If no custom place matched, query Google Places API (New) "Nearby Search" with:

- `locationRestriction.circle.center`: photo coordinates
- `locationRestriction.circle.radius`: 50 meters
- `includedTypes`: see "POI category whitelist" below
- `rankPreference`: `POPULARITY`

Walk the returned results in order (Google ranks them by prominence) and return the first one whose type is on the whitelist and whose distance from the photo coordinates is less than or equal to 50 meters.

**Ambiguity rule.** If two or more whitelisted POIs are within 50 meters of the photo AND those POIs are within 30 meters of each other, treat the situation as ambiguous and skip to the next cascade level. We would rather say "Magnolia" than name the wrong restaurant.

### 3. Geographic fallback

Query Google Geocoding API reverse-geocode for the photo coordinates. From the returned address components, prefer in this order:

1. `neighborhood` or `sublocality_level_1` (e.g., "Magnolia")
2. `locality` (e.g., "Seattle")
3. `administrative_area_level_1` (e.g., "Washington")

Format the display as the most-specific level available. If a neighborhood is found, combine it with the city: "Magnolia, Seattle". Otherwise just the city, or just the state if even the city is missing.

### 4. Null

If geographic fallback fails (no internet, API error, no useful components), return null. The display layer hides the location chip entirely rather than showing a placeholder.

## Caption suffix: city/state by distance from home

POIs and the geographic fallback gain city/state context when a photo was taken away from home, so a trip photo reads "Lola - San Francisco, CA" (POI) or "Santa Barbara, CA" (fallback), while a local one stays "Lola" / "Magnolia, Seattle". Only custom labels are unchanged.

Rule, by distance from a configurable home center:
- Within `metro_radius_km` of home (default 60 km) - POI: just the name; fallback: "Neighborhood, City" (e.g. "Magnolia, Seattle").
- Beyond, in the home country (US) - POI: `Name - City, ST`; fallback: `City, ST` (drops the neighborhood). USPS abbr; includes far-but-in-state places ("Andreas Keller Restaurant - Leavenworth, WA", "Birch Bay, WA").
- Beyond, abroad - POI: `Name - City, Country`; fallback: `City, Country`.
- No resolvable city - no suffix / current behavior (graceful).

Home config lives at the top of `custom-places.json` (falls back to the "Home" place's coords):
```json
"home": { "lat": 47.66, "lon": -122.40, "metro_radius_km": 60, "country_code": "US" }
```

Implementation: `reverseGeocodeComponents()` (geocoder.mjs, Nominatim + `us-states.mjs` abbreviation map) yields `{ neighborhood, city, regionCode, country, countryCode }`; the resolver stores these on the cache entry (both the `google_places` and `geocode` tiers) and composes the caption at build time - so tuning the radius or format only needs a rebuild, never a re-query. Wrong POI names are fixed via `photo-corrections-workflow.md`.

## POI category whitelist

When querying Google Places, include only these types. The list is biased toward "places worth photographing":

**Allow:**

- restaurant, cafe, bar, bakery, meal_takeaway
- park, national_park, tourist_attraction
- museum, art_gallery, library
- amusement_park, aquarium, zoo, stadium, gym
- school, university (custom entries should usually override, but as a fallback these are fine)
- place_of_worship (church, mosque, synagogue, etc.)
- movie_theater, performing_arts_theater
- airport, train_station, subway_station, ferry_terminal (useful for travel photos)

**Exclude (never display these as a location, even if nearest):**

- bank, atm
- gas_station
- car_dealer, car_repair, parking
- post_office, pharmacy
- supermarket, convenience_store, shopping_mall (debatable; default exclude, see Open Questions)
- office, corporate_office
- generic `establishment`, `point_of_interest`

Implement the whitelist as a constant array in code so future tuning is a one-line change.

## Distance threshold

50 meters is the default radius for POI matching. Rationale: phone GPS is typically accurate to 5 to 20 meters outdoors and 20 to 50 meters indoors. 50m matches a "we were at this place" intuition without spilling into neighboring buildings.

For custom places, the per-entry `radius_m` overrides this. Use larger radii for properties with grounds (estates, schools, parks, large yards).

## Special venues (context mode)

Some locations are large named venues with internally interesting sub-POIs: theme parks, fairgrounds, college campuses, big festivals, sprawling museums and zoos. At Universal Studios Orlando, the label "Universal Studios Orlando" is technically correct but loses the much better information of which ride or area the photo was taken at ("Hagrid's Magical Creatures Motorbike Adventure", "Hogsmeade", "Jurassic Park River Adventure").

For these, the custom places registry supports a `mode: "context"` flag. When a photo's coordinates fall inside a context-mode entry's bubble, the cascade behaves differently:

1. **Do not immediately return the venue name.** Treat the venue as a hint to look deeper.
2. **Run Google Places Nearby Search with a tighter inner radius.** Default 30m, configurable per entry as `inner_radius_m`.
3. **Relax the ambiguity rule.** Multiple POIs close together is expected inside theme parks; pick the highest-prominence whitelisted result rather than abstaining.
4. **Expand the whitelist for this lookup** to include `amusement_park_ride` and weight `tourist_attraction` heavily.
5. **If a specific POI is found, return it** (e.g., "Hagrid's Magical Creatures Motorbike Adventure").
6. **If nothing specific is found, return the venue name** as the fallback (e.g., "Universal Studios Orlando"). Skip geographic fallback entirely - we never want to show "Orlando" or "Orange County" for a photo taken inside the resort.

Context-mode entries are intended for large, well-mapped venues. Do not use this mode for a friend's house or a regular restaurant.

### Per-entry schema additions for context mode

```json
{
  "name": "Universal Studios Orlando",
  "lat": 28.4762,
  "lon": -81.467,
  "radius_m": 1500,
  "category": "venue",
  "mode": "context",
  "inner_radius_m": 30
}
```

`mode` is optional. Default is `"label"` (normal behavior - the place name becomes the label). `inner_radius_m` is optional and only meaningful in context mode (defaults to 30 if mode is `context` and the field is absent).

## Custom places JSON

File location: `code/src/data/custom-places.json`

Schema:

```json
{
  "places": [
    {
      "name": "string (display name)",
      "lat": "number (decimal degrees)",
      "lon": "number (decimal degrees)",
      "radius_m": "number (meters)",
      "category": "string (optional metadata)",
      "mode": "string (optional: 'label' [default] or 'context')",
      "inner_radius_m": "number (optional, context mode only; meters; default 30)"
    }
  ]
}
```

`category` is optional metadata for future display logic (e.g., an icon next to the name). Allowed values: `home`, `work`, `school`, `park`, `friend`, `family`, `venue`, `other`.

`mode` defaults to `"label"`. Use `"context"` for large venues with interesting sub-POIs (theme parks, fairgrounds, campuses). See "Special venues (context mode)" above.

### Initial data

```json
{
  "places": [
    { "name": "Home", "lat": 47.6610572, "lon": -122.3973827, "radius_m": 40, "category": "home" },
    { "name": "Work", "lat": 47.6158481, "lon": -122.3404291, "radius_m": 120, "category": "work" },
    { "name": "Lawton Elementary School", "lat": 47.6567429, "lon": -122.3903984, "radius_m": 80, "category": "school" },
    { "name": "Magnolia Playfield", "lat": 47.6467855, "lon": -122.3990745, "radius_m": 150, "category": "park" },
    { "name": "The Bergers", "lat": 47.6490167, "lon": -122.4055175, "radius_m": 40, "category": "friend" },
    { "name": "The Bells", "lat": 47.6365218, "lon": -122.3889396, "radius_m": 40, "category": "friend" },
    { "name": "Ben & Leslie's", "lat": 47.7008424, "lon": -122.3893068, "radius_m": 40, "category": "friend" },
    { "name": "Mark & Kim's", "lat": 45.655769, "lon": -94.200737, "radius_m": 80, "category": "friend" },
    { "name": "Jeff & Sherry's", "lat": 43.2538064, "lon": -88.2287939, "radius_m": 40, "category": "friend" },
    { "name": "Alex & Katie's", "lat": 28.0835314, "lon": -82.5261528, "radius_m": 40, "category": "friend" },
    { "name": "Universal Studios Orlando", "lat": 28.4762, "lon": -81.467, "radius_m": 1500, "category": "venue", "mode": "context", "inner_radius_m": 30 }
  ]
}
```

The Universal Orlando entry uses approximate center coordinates and a 1500m radius to cover the full resort footprint (Universal Studios Florida, Islands of Adventure, CityWalk, Volcano Bay, Epic Universe). Adjust center/radius if photos near the edges of the resort are not getting picked up.

## Caching

### Cache key

Round coordinates to 5 decimal places (approximately 1.1 meter precision) and concatenate. Examples:

- `(47.6610572, -122.3973827)` becomes `"47.66106,-122.39738"`

### Cache structure

A single JSON file on the Pi at `~/.kiosk/location-cache.json`. The kiosk app reads it at startup and writes back when a new entry is added.

```json
{
  "47.66106,-122.39738": {
    "name": "Home",
    "source": "custom",
    "resolved_at": "2026-05-24T12:34:56Z"
  },
  "37.76112,-122.42089": {
    "name": "Tartine Bakery",
    "source": "google_places",
    "place_id": "ChIJ...optional...",
    "resolved_at": "2026-05-24T12:35:10Z"
  }
}
```

`source` values: `custom`, `google_places`, `geocode`, `null_no_match`.

`null_no_match` caches the negative result so we do not re-query Google for known dead coordinates. Null entries expire after 30 days in case Google's data improves.

### Cache invalidation

- **Custom places registry changes** should invalidate any cache entry whose coordinates fall inside the changed entry's bubble (so re-resolution picks up the new label). Cleanest implementation: on app start, walk the cache and remove any entry whose coordinates now match a custom place but whose cached `name` does not match that custom place's `name`.
- **Other entries** never expire automatically (places do not move). The user can manually delete the cache file to force a full re-resolution.

## Display behavior

The location chip on the photo slideshow overlay:

- **Renders only after the photo image has loaded.** The image is the priority; the chip should never block first paint.
- **Loads asynchronously.** If the resolver is doing an API call, the chip appears late rather than the photo waiting.
- **Hides cleanly when null.** No "Unknown" placeholder, no blank chip outline.
- **Shows just the resolved name** for v1. No category badge. (Categories are stored for future use.)

## API integration notes

- **API key:** Stored in an environment variable read at app startup (`GOOGLE_API_KEY` or similar). Never commit the key to git. The same key works for Places API (New) and Geocoding API; enable both in the Google Cloud project.
- **APIs to use:**
  - Places Nearby Search (New): `POST https://places.googleapis.com/v1/places:searchNearby`
  - Geocoding (fallback): `GET https://maps.googleapis.com/maps/api/geocode/json`
- **Rate limits:** Not a practical concern at our scale, but respect HTTP 429 with exponential backoff.
- **Cost monitoring:** Set a daily Google Cloud budget alert at $5 as a safety net. Expected actual cost: well under $1/month with caching.
- **Field mask** (Places API New requires this): request only `places.displayName`, `places.types`, `places.location`, `places.id` to keep costs in the cheapest SKU tier.

## Pre-warm (future enhancement)

Not required for v1. Once the kiosk app is stable, add a background job that:

1. Polls the Immich API every 5 minutes for newly-ingested assets.
2. Extracts GPS from each.
3. Resolves and caches the location.

This eliminates the first-display latency for new photos. Implement as a separate Node process or a simple interval inside the kiosk app.

## Implementation outline (suggested module shape)

```
code/src/
├── data/
│   └── custom-places.json
├── lib/
│   ├── locationResolver.js     // main entry: resolveLocation({lat, lon}) -> {name, source} | null
│   ├── customPlaces.js          // load JSON, find matching place by haversine
│   ├── googlePlaces.js          // Nearby Search call + whitelist filtering + ambiguity check
│   ├── geocoder.js              // reverse-geocode fallback
│   ├── locationCache.js         // read/write JSON cache, key rounding
│   └── haversine.js             // distance helper
└── hooks/
    └── useResolvedLocation.js   // React hook that wraps resolveLocation with async state
```

The hook returns `{ name, isLoading, source }` so the overlay can render the chip when ready and hide it when name is null.

## Other venues worth considering for context mode

Universal Orlando is the obvious one. If the photo library has lots of pictures from any of the following, add them as context-mode entries with similarly large radii. Each of these has rich Google Places coverage for sub-attractions:

- **Disney World / Disneyland** parks
- **Major zoos and aquariums** (Woodland Park Zoo, Seattle Aquarium, etc.)
- **Theme parks** generally (Six Flags, Cedar Point, Knott's Berry Farm)
- **State / county fairgrounds** during fair season
- **Large festivals** with named stages or areas (Coachella, Bumbershoot)
- **College campuses** if photos are taken at named buildings
- **Major museum complexes** (Smithsonian campus, Getty Center)

These do not need to be added preemptively. Add them when a photo from one of these venues displays incorrectly.

## Open questions for later

- **Markets and stores:** Currently excluded. If photos at Pike Place Market or Whole Foods would benefit from named labels, add `market` and `supermarket` to the whitelist.
- **Time-of-day signals:** A photo at 7pm at a coordinate with both a restaurant and a bank should obviously be the restaurant. The whitelist already excludes banks, so this is mostly handled. If specific bad cases come up, time-of-day could become a tiebreaker.
- **User overrides UI:** If Google Places returns "Joe's Pizza" but the user wants it labeled "Mom's birthday spot", currently they would add it to custom places (which wins). A future Settings UI could let the user tap the chip on the display and override the name inline.
- **Confidence display:** Could show a subtle visual distinction between custom-place labels (high confidence) and Google-derived ones (medium). Probably overkill.
