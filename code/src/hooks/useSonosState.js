// useSonosState - stub for the Sonos state hook.
//
// Phase 1 (now): always returns "nothing playing". Used by the photo album
// art widget so it knows to stay hidden, and later by Now Playing.
//
// Phase 2 (later): hits the local node-sonos-http-api on the Pi:
//   GET http://localhost:5005/{room}/state
// and merges in webhook-pushed updates for low-latency state. Return shape
// is unchanged so the rest of the app does not care.
//
// Return:
//   { playing: boolean,
//     track: { title, artist, album, albumArtUrl, durationMs, elapsedMs }
//             | null,
//     stationName: string | null,
//     loading: boolean,
//     error: string | null }

export default function useSonosState() {
  return {
    playing: false,
    track: null,
    stationName: null,
    loading: false,
    error: null,
  }
}
