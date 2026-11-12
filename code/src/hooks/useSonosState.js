import { useEffect, useMemo, useState } from 'react'
import { useSettings } from '../lib/settings.js'
import { computeSourceLabel, detectSource } from '../lib/sonosSource.js'

// useSonosState - reads node-sonos-http-api via Settings-configured base + room.
// The base is the hub's /api/sonos proxy on every screen (lib/settings.js).

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

// Grouping facts for the Sound popover, from the same /zones poll:
//   groupMembers  room names in our group, ours included
//   groupVolume   the group's volume (Sonos app's main slider): the mean of the
//                 members' volumes, so it equals the room volume when the room
//                 plays alone
//   roomVolumes   { roomName: volume } for every room in our group, so the
//                 Sound card can show and set each one
//   elsewhere     { roomName: label } for rooms playing in some OTHER group,
//                 so a join can warn that it takes the room over
function parseGrouping(zones, roomName) {
  const out = { groupMembers: [roomName], groupVolume: null, roomVolumes: {}, elsewhere: {} }
  if (!Array.isArray(zones)) return out
  for (const group of zones) {
    const members = (group.members || []).map((m) => m.roomName)
    const c = group.coordinator || {}
    if (members.includes(roomName)) {
      out.groupMembers = members
      out.groupVolume = c.groupState?.volume ?? null
      for (const m of group.members || []) {
        if (typeof m.state?.volume === 'number') out.roomVolumes[m.roomName] = m.state.volume
      }
    } else if (c.state?.playbackState === 'PLAYING') {
      const t = c.state.currentTrack || {}
      const label = String(t.uri).includes('htastream')
        ? 'the TV'
        : t.type === 'line_in'
          ? 'line-in'
          : cleanStationName(t.stationName || '') || t.title || 'music'
      for (const m of members) out.elsewhere[m] = label
    }
  }
  return out
}

async function loadFavorites({ apiBase, room }) {
  if (Date.now() - favoritesLoadedAt < FAVORITES_REFRESH_MS && favoritesCache.length) {
    return favoritesCache
  }
  try {
    const res = await fetch(`${apiBase}/${room}/favorites/detailed`, {
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
  // Scalars, so the poll effect below restarts only when one of them changes,
  // not whenever the settings object is replaced.
  const { apiBase, room, pollIntervalMs } = sonos
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
    groupMembers: [room],
    groupVolume: null,
    roomVolumes: {},
    elsewhere: {},
    loading: true,
    error: null,
    // ms epoch of the last successful poll; lets a view advance the elapsed
    // time locally between polls and show the data's age.
    fetchedAt: null,
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
          fetch(`${apiBase}/zones`, { cache: 'no-store' }),
          loadFavorites({ apiBase, room }),
        ])
        if (!zonesRes.ok) throw new Error(`HTTP ${zonesRes.status}`)
        const zones = await zonesRes.json()
        if (cancelled) return

        const player = findPlayerInZones(zones, room)
        if (!player) throw new Error(`room "${room}" not in zones`)

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
          ...parseGrouping(zones, room),
          sourceLabel: label,
          sourceKind: source,
          avTransportUri,
          avTransportUriMetadata,
          loading: false,
          error: null,
          fetchedAt: Date.now(),
        }))
      } catch (err) {
        if (cancelled) return
        setState((prev) => ({ ...prev, loading: false, error: err.message }))
      }
    }

    fetchState()
    const id = setInterval(fetchState, pollIntervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [apiBase, room, pollIntervalMs])

  return state
}

// How long one Sonos command may hang before the screen gives up on it.
// node-sonos-http-api holds a player's address from discovery; when a player
// moves (2026-10-29: the Family Room Playbar changed IP and the API kept the
// old one for six days) every write to it hangs 21 s upstream and the hub's
// proxy answers 502 after 6 s. The Sound card sends a volume step every 250 ms
// while a button is held, so without a short abort those hung requests filled
// Chromium's six connections to the hub and stalled the /zones poll: the card
// looked dead. 3 s is longer than any healthy command (under 0.1 s through
// the hub) and short enough that a stuck player costs one slot at a time.
export const SONOS_ACTION_TIMEOUT_MS = 3000

// One fire-and-forget Sonos command. Never rejects: a failure is a console
// warning and nothing else, so a caller can drop the promise. `fetchImpl` is
// for tests; the app always uses the global fetch.
export async function sendSonosCommand(
  url,
  { timeoutMs = SONOS_ACTION_TIMEOUT_MS, fetchImpl = fetch } = {},
) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    await fetchImpl(url, { method: 'GET', cache: 'no-store', signal: ac.signal })
  } catch (e) {
    if (e && e.name === 'AbortError') {
      console.warn(`sonos action timed out after ${timeoutMs / 1000}s`, url)
    } else {
      console.warn('sonos action failed', url, e)
    }
  } finally {
    clearTimeout(timer)
  }
}

// Hook for transport + favorite actions, bound to current Settings.
export function useSonosActions() {
  const { sonos } = useSettings()
  return useMemo(() => {
    // `path` is relative to the API base; `send` prefixes this screen's room.
    // Callers do not await: a command that hangs is abandoned after
    // SONOS_ACTION_TIMEOUT_MS and the next poll shows what the player did.
    const sendRaw = (path) => sendSonosCommand(`${sonos.apiBase}${path}`)
    const send = (path) => sendRaw(`/${encodeURIComponent(sonos.room)}${path}`)
    return {
      play: () => send('/play'),
      pause: () => send('/pause'),
      next: () => send('/next'),
      previous: () => send('/previous'),
      playFavorite: (name) => send(`/favorite/${encodeURIComponent(name)}`),
      volumeUp: () => send('/volume/+5'),
      volumeDown: () => send('/volume/-5'),
      // Absolute, so a burst of optimistic taps lands on what the screen shows.
      setGroupVolume: (v) => send(`/groupVolume/${Math.round(v)}`),
      // One room's own volume; the group's follows as the new mean.
      setRoomVolume: (other, v) =>
        sendRaw(`/${encodeURIComponent(other)}/volume/${Math.round(v)}`),
      // Pull another room into this screen's group, or send it back out.
      joinRoom: (other) =>
        sendRaw(`/${encodeURIComponent(other)}/join/${encodeURIComponent(sonos.room)}`),
      leaveRoom: (other) => sendRaw(`/${encodeURIComponent(other)}/leave`),
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
