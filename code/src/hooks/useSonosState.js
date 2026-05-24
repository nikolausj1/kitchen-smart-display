import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'

// useSonosState - reads node-sonos-http-api via Settings-configured base + room.

// Strip Pandora's "(My Station)" suffix so the UI shows clean names.
export function cleanStationName(name) {
  if (!name) return name
  return name.replace(/\s*\((My Station|Shared)\)\s*$/i, '').trim()
}

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
    stationName: cleanStationName(t.stationName || ''),
    volume: raw.volume || 0,
  }
}

export default function useSonosState() {
  const { sonos } = useSettings()
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
        const res = await fetch(`${sonos.apiBase}/${sonos.room}/state`, {
          cache: 'no-store',
        })
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
    const id = setInterval(fetchState, sonos.pollIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sonos.apiBase, sonos.room, sonos.pollIntervalMs])

  return state
}

// Hook for transport + favorite actions, bound to current Settings.
export function useSonosActions() {
  const { sonos } = useSettings()
  return useMemo(() => {
    const send = async (path) => {
      try {
        await fetch(`${sonos.apiBase}/${sonos.room}${path}`, {
          method: 'GET',
          cache: 'no-store',
        })
      } catch (e) {
        console.warn('sonos action failed', path, e)
      }
    }
    return {
      play: () => send('/play'),
      pause: () => send('/pause'),
      next: () => send('/next'),
      previous: () => send('/previous'),
      playFavorite: (name) => send(`/favorite/${encodeURIComponent(name)}`),
      volumeUp: () => send('/volume/+5'),
      volumeDown: () => send('/volume/-5'),
    }
  }, [sonos.apiBase, sonos.room])
}

// Backwards-compatible non-hook export. Reads settings ONCE at call time
// from the storage layer. Prefer useSonosActions() inside components for
// reactive bindings; this fallback is here so existing imports don't break.
export const sonosActions = {
  play: () => stubWarn('play'),
  pause: () => stubWarn('pause'),
  next: () => stubWarn('next'),
  previous: () => stubWarn('previous'),
  playFavorite: (name) => stubWarn(`playFavorite(${name})`),
  volumeUp: () => stubWarn('volumeUp'),
  volumeDown: () => stubWarn('volumeDown'),
}

function stubWarn(action) {
  console.warn(
    `sonosActions.${action}() called outside React - use useSonosActions() instead`
  )
}
