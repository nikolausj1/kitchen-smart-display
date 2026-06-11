import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'

// useImmichPhotos - photo source for the slideshow.
//
// Reads the baked manifest at /stub-photos/manifest.json which is produced
// by scripts/build-photo-manifest.mjs (Immich or samplePhotos mode). The
// manifest carries:
//   - albums:  [{ id, name, count }]  (empty in samplePhotos mode)
//   - photos:  [{ src, width, height, orientation, addedAt, albums, exif }]
//
// We filter the photos list by the user's selectedAlbumIds setting:
//   - null/undefined -> all photos
//   - array of ids   -> only photos whose albums[] intersects
//   - empty array    -> nothing (caller renders empty state)
//
// Return shape:
//   { photos, albums, loading, error }

const REFRESH_MS = 5 * 60 * 1000 // re-fetch the manifest every 5 min

function filterByAlbums(photos, selected) {
  if (!Array.isArray(photos)) return photos
  if (selected == null) return photos             // null/undefined -> all
  if (!Array.isArray(selected)) return photos     // bad value -> all
  if (selected.length === 0) return []            // empty -> none
  const wanted = new Set(selected)
  return photos.filter((p) => {
    const a = p.albums
    if (!Array.isArray(a) || a.length === 0) return false
    for (const id of a) if (wanted.has(id)) return true
    return false
  })
}

export default function useImmichPhotos() {
  const { slideshow } = useSettings()
  const selectedAlbumIds = slideshow?.selectedAlbumIds

  const [raw, setRaw] = useState({
    photos: null,
    albums: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/stub-photos/manifest.json', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        setRaw({
          photos: payload.photos || [],
          albums: payload.albums || [],
          loading: false,
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        setRaw({
          photos: null,
          albums: [],
          loading: false,
          error: err.message || 'fetch failed',
        })
      }
    }

    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const filteredPhotos = useMemo(
    () => filterByAlbums(raw.photos, selectedAlbumIds),
    [raw.photos, selectedAlbumIds]
  )

  return {
    photos: filteredPhotos,
    albums: raw.albums,
    loading: raw.loading,
    error: raw.error,
  }
}
