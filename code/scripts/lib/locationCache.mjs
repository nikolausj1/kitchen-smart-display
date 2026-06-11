// On-disk cache for resolved photo locations.
//
// Key format: lat/lon rounded to 5 decimal places (~1.1 meter precision).
// Photos taken at the same coordinates share a cache entry and never
// re-query the resolver. See location-resolution-strategy.md.
//
// Entry shape per the doc:
//   {
//     "47.66106,-122.39738": {
//       name: "Home" | null,           // null when no match was found
//       source: "custom" | "google_places" | "geocode" | "null_no_match",
//       place_id: "ChIJ..." (optional, google_places only),
//       resolved_at: "2026-05-24T12:34:56Z"
//     }
//   }
//
// Null entries expire after NULL_TTL_MS in case Google's data improves.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const NULL_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function gpsKey(lat, lon) {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`
}

export class LocationCache {
  constructor(path) {
    this.path = path
    this.data = {}
    this.dirty = false
  }

  async load() {
    if (!existsSync(this.path)) return
    try {
      this.data = JSON.parse(await readFile(this.path, 'utf8'))
    } catch {
      this.data = {}
    }
  }

  async save() {
    if (!this.dirty) return
    await writeFile(this.path, JSON.stringify(this.data, null, 2) + '\n')
    this.dirty = false
  }

  // Look up by rounded coordinates. Returns the entry, or undefined if
  // missing / expired-null. Caller should treat undefined as "needs
  // resolution" and a valid entry (even one with name=null) as "skip the
  // API, we already know there's nothing here".
  get(lat, lon) {
    const key = gpsKey(lat, lon)
    const entry = this.data[key]
    if (!entry) return undefined
    if (entry.source === 'null_no_match') {
      const age = Date.now() - new Date(entry.resolved_at).getTime()
      if (age > NULL_TTL_MS) {
        delete this.data[key]
        this.dirty = true
        return undefined
      }
    }
    return entry
  }

  set(lat, lon, entry) {
    const key = gpsKey(lat, lon)
    this.data[key] = {
      ...entry,
      resolved_at: new Date().toISOString(),
    }
    this.dirty = true
  }

  // Walk cache and drop entries whose coordinates now fall inside a custom
  // place whose name differs from the cached name. Called on startup after
  // loading the custom places, per the doc's "Cache invalidation" rule.
  invalidateForCustomPlaces(findCustomMatch) {
    for (const [key, entry] of Object.entries(this.data)) {
      const [latStr, lonStr] = key.split(',')
      const lat = Number(latStr)
      const lon = Number(lonStr)
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue
      const match = findCustomMatch(lat, lon)
      if (match && match.name !== entry.name) {
        delete this.data[key]
        this.dirty = true
      }
    }
  }

  stats() {
    let hits = 0
    let nulls = 0
    const bySource = {}
    for (const e of Object.values(this.data)) {
      hits++
      bySource[e.source] = (bySource[e.source] || 0) + 1
      if (e.source === 'null_no_match') nulls++
    }
    return { total: hits, nulls, bySource }
  }
}
