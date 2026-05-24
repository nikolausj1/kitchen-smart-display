import { useEffect, useState } from 'react'
import { SONOS } from '../config.js'

// useSonosState - reads node-sonos-http-api on the Pi.
//
// GET {apiBase}/{room}/state returns full track + transport info. We poll
// every SONOS.pollIntervalMs so the progress bar and play/pause state stay
// fresh. (Webhooks are available on jishi's API too; we can add them later
// for true push updates if 1.5s polling feels laggy.)
//
// Return shape (stable across phases):
//   { playing, track: { title, artist, album, albumArtUrl, durationMs,
//                       elapsedMs },
//     stationName, volume, loading, error }

function parseState(raw) {
  if (!raw) return null
  const t = raw.currentTrack || {}
  return {
    playing: raw.playbackState === 'PLAYING',
    paused: raw.playbackState === 'PAUSED_PLAYBACK',
    track: t.title || t.artist || t.album
      ? {
          title: t.title || '',
          artist: t.artist || '',
          album: t.album || '',
          albumArtUrl: t.absoluteAlbumArtUri || t.albumArtUri || '',
          durationMs: (t.duration || 0) * 1000,
          elapsedMs: (raw.elapsedTime || 0) * 1000,
        }
      : null,
    stationName: t.stationName || '',
    volume: raw.volume || 0,
  }
}

export default function useSonosState() {
  const [state, setState] = useState({
    playing: false,
    paused: false,
    track: null,
    stationName: '',
    volume: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function fetchState() {
      try {
        const res = await fetch(
          `${SONOS.apiBase}/${SONOS.room}/state`,
          { cache: 'no-store' }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw = await res.json()
        if (cancelled) return
        const parsed = parseState(raw)
        setState((prev) => ({
          ...prev,
          ...(parsed || {}),
          loading: false,
          error: null,
        }))
      } catch (err) {
        if (cancelled) return
        setState((prev) => ({ ...prev, loading: false, error: err.message }))
      }
    }

    fetchState()
    const id = setInterval(fetchState, SONOS.pollIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}

// --- Transport action helpers ------------------------------------------------
// Fire-and-forget POSTs (the polling loop will pick up the new state on the
// next tick). All return a promise but callers can ignore it.

async function send(path) {
  try {
    await fetch(`${SONOS.apiBase}/${SONOS.room}${path}`, {
      method: 'GET',
      cache: 'no-store',
    })
  } catch (e) {
    // Surface to console; the polling loop will reveal any persistent issue.
    console.warn('sonos action failed', path, e)
  }
}

export const sonosActions = {
  play: () => send('/play'),
  pause: () => send('/pause'),
  next: () => send('/next'),
  previous: () => send('/previous'),
  playFavorite: (name) => send(`/favorite/${encodeURIComponent(name)}`),
  volumeUp: () => send('/volume/+5'),
  volumeDown: () => send('/volume/-5'),
}
