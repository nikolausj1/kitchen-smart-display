// Shared Sonos source-classification utilities.
//
// Sonos only populates currentTrack.stationName for streaming-radio sources
// (Pandora, internet radio, SiriusXM). For Spotify / Apple Music / Sonos
// playlists / album playback, that field is empty or garbage. The
// authoritative source identifier is the player's avTransportUri (plus its
// DIDL-Lite metadata), which lives on /zones and is shared by all members
// of a Sonos group.
//
// computeSourceLabel() resolves a human-readable label using a priority
// chain of progressively weaker signals.

// Map Sonos service IDs (sid= in URIs) and SA_RINCON service prefixes (in
// DIDL-Lite metadata) to friendly source names.
const SID_TO_SOURCE = {
  '9': 'Spotify',
  '12': 'Pandora',
  '236': 'Pandora',
  '151': 'Amazon Music',
  '160': 'SoundCloud',
  '184': 'Tidal',
  '254': 'YouTube Music',
  '255': 'YouTube Music',
}
const SA_TO_SOURCE = {
  '3079': 'Spotify',
  '60423': 'Pandora',
  '38663': 'Pandora',
}

// Classify a Sonos item (favorite, current source) into a friendly source
// label like "Spotify", "Pandora", "Sonos playlist", "Radio". Used by the
// Jukebox card subtitle and by computeSourceLabel as the last-resort label.
export function detectSource(item) {
  const uri = item?.uri || ''
  const meta = item?.metadata || ''

  const sidMatch = uri.match(/[?&]sid=(\d+)/)
  if (sidMatch && SID_TO_SOURCE[sidMatch[1]]) return SID_TO_SOURCE[sidMatch[1]]

  const saMatch = meta.match(/SA_RINCON(\d+)/)
  if (saMatch && SA_TO_SOURCE[saMatch[1]]) return SA_TO_SOURCE[saMatch[1]]

  if (uri.startsWith('x-sonosapi-stream:')) return 'Radio'
  if (uri.startsWith('x-rincon-playlist:')) return 'Sonos playlist'
  if (uri.startsWith('x-rincon-queue:')) return 'Sonos Queue'
  if (uri.startsWith('x-rincon-stream:')) return 'Line-In'
  if (uri.startsWith('x-sonos-htastream:')) return 'TV'
  if (uri.startsWith('file:')) return 'Library'
  if (uri.startsWith('x-sonos-spotify:') || uri.startsWith('x-sonosapi-hls:')) return 'Spotify'
  if (uri.startsWith('x-sonos-vli:')) return 'AirPlay'
  return 'Sonos'
}

// Extract <dc:title>...</dc:title> from a DIDL-Lite XML blob. Sonos
// returns this in avTransportUriMetadata when an enqueued container
// (Spotify playlist, Sonos playlist, album) is loaded. Returns null if
// not found or if the title is empty/whitespace.
export function extractDcTitle(xml) {
  if (!xml || typeof xml !== 'string') return null
  const m = xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/i)
  if (!m) return null
  // Decode the handful of XML entities that actually appear in titles.
  const decoded = m[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim()
  return decoded || null
}

// Sonos sometimes returns a single control character (0x99 / trademark
// sigil) or an empty/whitespace string for stationName on queued sources.
// Treat anything <= 2 printable chars as effectively empty.
function isMeaningfulStationName(s) {
  if (!s) return false
  const stripped = s.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim()
  return stripped.length >= 2
}

// Compute the best human label for the currently playing source.
//
// Priority:
//   1. Exact match: avTransportUri equals a favorite's uri  -> favorite.title
//   2. <dc:title> parsed out of avTransportUriMetadata       -> that title
//   3. currentTrack.stationName, if meaningful               -> as-is
//   4. URI-prefix classifier                                 -> "Spotify" / "Radio" / ...
//   5. Generic fallback                                      -> "Pick a station or playlist"
//
// Returns { label, source } where label is the primary display string and
// source is a coarse classification (used for the subtitle / aria text).
export function computeSourceLabel({
  avTransportUri = '',
  avTransportUriMetadata = '',
  stationName = '',
  favorites = [],
}) {
  // 1. Favorite match.
  if (avTransportUri) {
    const fav = favorites.find((f) => f.uri && f.uri === avTransportUri)
    if (fav?.name) return { label: fav.name, source: detectSource(fav) }
  }

  // 2. <dc:title> from enqueued metadata.
  const dcTitle = extractDcTitle(avTransportUriMetadata)
  if (dcTitle) {
    return {
      label: dcTitle,
      source: detectSource({ uri: avTransportUri, metadata: avTransportUriMetadata }),
    }
  }

  // 3. stationName if it's something real.
  if (isMeaningfulStationName(stationName)) {
    return {
      label: stationName,
      source: detectSource({ uri: avTransportUri, metadata: avTransportUriMetadata }),
    }
  }

  // 4. URI-prefix classifier.
  if (avTransportUri) {
    return {
      label: detectSource({ uri: avTransportUri, metadata: avTransportUriMetadata }),
      source: detectSource({ uri: avTransportUri, metadata: avTransportUriMetadata }),
    }
  }

  // 5. Generic fallback - shown when there's nothing playing at all
  // (no avTransportUri, no station). Keep it short and noun-shaped so the
  // station-pill UI still reads as a tappable target.
  return { label: 'Station', source: '' }
}
