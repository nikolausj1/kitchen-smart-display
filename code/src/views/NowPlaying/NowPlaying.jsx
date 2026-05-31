import { useEffect, useRef, useState } from 'react'
import useSonosState, { useSonosActions, getLastPlayingAt } from '../../hooks/useSonosState.js'
import { useView } from '../../shell/ViewContext.jsx'
import Jukebox from './Jukebox.jsx'
import './NowPlaying.css'

// If Sonos has been idle (not playing) for at least this long when the user
// enters the Music tab, auto-open the Jukebox picker so they can pick
// something to play without an extra tap on the station name.
const IDLE_OPEN_PICKER_MS = 60_000

// While sitting on the Music tab with nothing playing, after this long bounce
// back to the Photos view. Cancelled if music starts, the Jukebox picker is
// open, or the user navigates away on their own.
const IDLE_TO_PHOTOS_MS = 60_000

// NowPlaying view per Figma node 83:461.
// Left: station name pill, track title (bold), artist, progress bar, three
// round transport buttons.  Right: large square album art.  Bottom-left:
// a big clock (the view's own time widget).

function fmtTime(now) {
  const hour12 = now.getHours() % 12 || 12
  const min = String(now.getMinutes()).padStart(2, '0')
  return `${hour12}:${min}`
}

function useNow() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function TransportButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      className="np__btn"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      <img src={icon} alt="" aria-hidden="true" draggable="false" />
    </button>
  )
}

export default function NowPlaying() {
  const state = useSonosState()
  const actions = useSonosActions()
  const { setView } = useView()
  const now = useNow()
  const [jukeboxOpen, setJukeboxOpen] = useState(false)

  const { track, stationName, sourceLabel, playing, paused, loading, error } = state
  const displayLabel = sourceLabel || stationName || 'Station'
  const progress =
    track && track.durationMs > 0
      ? Math.min(1, track.elapsedMs / track.durationMs)
      : 0

  // Auto-open the Jukebox picker once per mount if Sonos has been idle for
  // long enough. Decision is deferred until the first real state arrives
  // (loading flips to false) so we don't auto-open on a transient stale
  // value. Once decided, decidedRef pins the outcome for this mount - if
  // the user dismisses the picker, it stays dismissed until they navigate
  // away and come back.
  const idleDecisionRef = useRef(false)
  useEffect(() => {
    if (idleDecisionRef.current) return
    if (loading) return
    idleDecisionRef.current = true
    const lastPlayingAt = getLastPlayingAt()
    const idleFor = lastPlayingAt ? Date.now() - lastPlayingAt : Infinity
    if (!playing && idleFor >= IDLE_OPEN_PICKER_MS) {
      setJukeboxOpen(true)
    }
  }, [loading, playing])

  // While on the Music tab with nothing playing, auto-bounce back to the
  // Photos view after IDLE_TO_PHOTOS_MS. Cancelled if music starts, the
  // user opens the Jukebox picker, or NowPlaying unmounts (user navigated
  // away on their own). If music transitions paused -> playing -> paused
  // the timer resets, which is the behavior we want.
  useEffect(() => {
    if (loading) return
    if (playing) return
    if (jukeboxOpen) return
    const id = setTimeout(() => setView('photos'), IDLE_TO_PHOTOS_MS)
    return () => clearTimeout(id)
  }, [loading, playing, jukeboxOpen, setView])

  return (
    <div className="np">
      {/* Left half - metadata + transport */}
      <div className="np__left">
        {/* Always render the picker affordance. Sonos only populates
         *  stationName for stream-style sources (Pandora, internet radio);
         *  playlists / Spotify queues / library tracks return an empty
         *  string. We still need the user to be able to tap to open the
         *  Jukebox picker, so fall back to an action label when there's no
         *  station name to display. */}
        <button
          type="button"
          className="np__station"
          onClick={(e) => {
            e.stopPropagation()
            setJukeboxOpen(true)
          }}
          data-interactive="true"
          aria-label={`Change source from ${displayLabel}`}
        >
          {displayLabel}
        </button>

        <div className="np__title">
          {track?.title || (loading ? 'Loading...' : '—')}
        </div>

        <div className="np__artist">
          {track?.artist || (error ? error : '')}
        </div>

        {track && (
          <div className="np__progress" aria-hidden="true">
            <div
              className="np__progress-fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        <div className="np__transport">
          <TransportButton
            icon="/icons/ui/transport-prev-next.svg"
            label="Previous track"
            onClick={actions.previous}
          />
          <TransportButton
            icon={
              playing
                ? '/icons/ui/transport-pause.svg'
                : '/icons/ui/transport-next-alt.svg'
            }
            label={playing ? 'Pause' : 'Play'}
            onClick={playing ? actions.pause : actions.play}
          />
          <TransportButton
            icon="/icons/ui/transport-prev-next.svg"
            label="Next track"
            onClick={actions.next}
          />
        </div>

        <div className="np__clock">{fmtTime(now)}</div>
      </div>

      {/* Right half - album art */}
      <div className="np__right">
        {track?.albumArtUrl ? (
          <img
            className="np__art"
            src={track.albumArtUrl}
            alt={track.album || ''}
            draggable="false"
          />
        ) : (
          <div className="np__art np__art--empty" aria-hidden="true" />
        )}
      </div>

      <Jukebox
        open={jukeboxOpen}
        onClose={() => setJukeboxOpen(false)}
        currentStationName={sourceLabel || stationName}
      />
    </div>
  )
}
