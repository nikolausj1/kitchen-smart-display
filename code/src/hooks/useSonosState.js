import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import { computeSourceLabel, detectSource } from '../lib/sonosSource.js'

// useSonosState - reads node-sonos-http-api via Settings-configured base + room.

// Strip Pandora's "(My Station)" suffix so the UI shows clean names.
export function cleanStationName(name) {
  if (!name) return name
  return name.replace(/\s*\((My Station|Shared)\)\s*$/i, '').trim()
}

// Module-scope cache of Sonos favorites with their URIs and metadata.
// Populated by useSonosState on first run and refreshed periodically.
// Shared across hook instances so we don't re-fetch on every NowPlaying
// mount. computeSourceLabel matches the current avTransportUri against
// these favorites to display "you are playing X" by name.
let favoritesCache = []
let favoritesLoadedAt = 0
const FAVORITES_REFRESH_MS = 10 * 60 * 1000

// Module-scope timestamp of the last poll where Sonos was actively playing.
// Lives outside the hook so it persists across NowPlaying mount/unmount and
// is shared by every consumer of useSonosState (e.g. AlbumArtWidget in the
// Photos view also keeps it fresh while the user is browsing photos).
// `null` means we have never observed playback in this session.
let lastPlayingAt = null

export function getLastPlayingAt() {
  return lastPlayingAt
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

// Pull the active player object out of a /zones response. /zones returns
// an array of groups; each group has a coordinator + members. We use the
// coordinator's data because group followers don't carry their own
// avTransportUri (they have x-rincon:RINCON_xxx pointing at the
// coordinator).
function findPlayerInZones(zones, roomName) {
  if (!Array.isArray(zones)) return null
  for (const group of zones) {
    const members = group.members || []
    const hasOurRoom = members.some((m) => m.roomName === roomName)
    if (!hasOurRoom) continue
    // The coordinator may be the group object itself or a separate field;
    // node-sonos-http-api typically uses coordinator with full player data.
    return group.coordinator || members.find((m) => m.roomName === roomName) || null
  }
  return null
}

async function loadFavorites(sonos) {
  if (Date.now() - favoritesLoadedAt < FAVORITES_REFRESH_MS && favoritesCache.length) {
    return favoritesCache
  }
  try {
    const res = await fetch(`${sonos.apiBase}/${sonos.room}/favorites/detailed`, {
      cache: 'no-store',
    })
    if (!res.ok) return favoritesCache
    const items = await res.json()
    if (!Array.isArray(items)) return favoritesCache
    favoritesCache = items.map((it) => ({
      name: it.title || '',
      uri: it.uri || '',
      metadata: it.metadata || '',
      source: detectSource(it),
    }))
    favoritesLoadedAt = Date.now()
    return favoritesCache
  } catch {
    return favoritesCache
  }
}

export function getCachedFavorites() {
  return favoritesCache
}

export default function useSonosState() {
  const { sonos } = useSettings()
  const [state, setState] = useState({
    playing: false,
    paused: false,
    track: null,
    stationName: '',
    sourceLabel: '',
    sourceKind: '',
    avTransportUri: '',
    avTransportUriMetadata: '',
    volume: 0,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function fetchState() {
      try {
        // /zones returns all groups with per-player state AND the
        // avTransportUri/avTransportUriMetadata we need for source naming.
        // /state alone strips those out, so we use /zones as the single
        // source of truth.
        const [zonesRes, favorites] = await Promise.all([
          fetch(`${sonos.apiBase}/zones`, { cache: 'no-store' }),
          loadFavorites(sonos),
        ])
        if (!zonesRes.ok) throw new Error(`HTTP ${zonesRes.status}`)
        const zones = await zonesRes.json()
        if (cancelled) return

        const player = findPlayerInZones(zones, sonos.room)
        if (!player) throw new Error(`room "${sonos.room}" not in zones`)

        const raw = player.state || {}
        const parsed = parseState(raw)
        if (parsed?.playing) {
          lastPlayingAt = Date.now()
        }

        const avTransportUri = player.avTransportUri || ''
        const avTransportUriMetadata = player.avTransportUriMetadata || ''
        const { label, source } = computeSourceLabel({
          avTransportUri,
          avTransportUriMetadata,
          stationName: parsed?.stationName || '',
          favorites,
        })

        setState((prev) => ({
          ...prev,
          ...(parsed || {}),
          sourceLabel: label,
          sourceKind: source,
          avTransportUri,
          avTransportUriMetadata,
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
