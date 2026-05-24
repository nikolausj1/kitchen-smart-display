import { useEffect, useState } from 'react'
import useSonosState, { sonosActions } from '../../hooks/useSonosState.js'
import './NowPlaying.css'

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
  const now = useNow()

  const { track, stationName, playing, paused, loading, error } = state
  const progress =
    track && track.durationMs > 0
      ? Math.min(1, track.elapsedMs / track.durationMs)
      : 0

  return (
    <div className="np">
      {/* Left half - metadata + transport */}
      <div className="np__left">
        {stationName && (
          <div className="np__station">{stationName}</div>
        )}

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
            onClick={sonosActions.previous}
          />
          <TransportButton
            icon={
              playing
                ? '/icons/ui/transport-pause.svg'
                : '/icons/ui/transport-next-alt.svg'
            }
            label={playing ? 'Pause' : 'Play'}
            onClick={playing ? sonosActions.pause : sonosActions.play}
          />
          <TransportButton
            icon="/icons/ui/transport-prev-next.svg"
            label="Next track"
            onClick={sonosActions.next}
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
    </div>
  )
}
