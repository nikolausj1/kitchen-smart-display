import { useEffect, useState } from 'react'

// useImmichPhotos - photo source for the slideshow.
//
// Phase 1 (now): reads /stub-photos/manifest.json - a static list of test
// photos shipped with the build. Lets us build and test the slideshow
// without depending on Immich being up.
//
// Phase 2 (later): swap the fetch to call the Immich REST API
//   GET {immichUrl}/api/albums/{albumId}/assets   (list assets in album)
//   GET {immichUrl}/api/assets/{assetId}/thumbnail (fetch a single image)
// with an `x-api-key` header from local config. The hook's return shape
// stays identical so the slideshow does not change.
//
// Return:
//   { photos: Photo[] | null, loading: boolean, error: string | null }
//
// Photo:
//   { src, width, height, orientation: 'landscape' | 'portrait',
//     exif: { location, date, album } }

const REFRESH_MS = 5 * 60 * 1000 // re-fetch the manifest every 5 min

export default function useImmichPhotos() {
  const [state, setState] = useState({
    photos: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/stub-photos/manifest.json')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const payload = await res.json()
        if (cancelled) return
        setState({
          photos: payload.photos || [],
          loading: false,
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          photos: null,
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

  return state
}
