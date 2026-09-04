import { useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { fmtMinutes } from '../lib/format.js'
import './NowPlayingPanel.css'

// NowPlayingPanel - what the Sonos in the kitchen is doing, read-only.
//
// The Sonos poll is slow (seconds apart), so a progress bar driven straight off
// the last payload would sit still and then jump. We advance elapsed locally
// from the layout's 1 Hz `now` instead, clamped to the track length so it never
// overruns the end of a song while we wait for the next poll.

// Album art placeholder: a plain note glyph, drawn rather than shipped, so a
// missing or unreachable art URL still leaves a square of the right shape.
function NoteGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path
        d="M9 17.5V6.2l9-1.7v10.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="17.7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="16" cy="15.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

export default function NowPlayingPanel({ music, now, compact = false }) {
  // Remember the art URL that failed rather than a bare boolean, so the next
  // track's art is tried again without needing an effect to reset the flag.
  const [artFailed, setArtFailed] = useState(null)

  const track = music?.track || null
  const playing = !!music?.playing
  const paused = !!music?.paused
  const idle = !track || (!playing && !paused)
  const room = music?.room || null

  if (idle) {
    return (
      <PanelFrame title="Now playing" className="tl-np" bodyClassName="tl-np__body">
        <div className="tl-np__idle">
          <div className="tl-np__idle-line">Nothing playing</div>
          {room && <div className="tl-np__idle-room">{room}</div>}
        </div>
      </PanelFrame>
    )
  }

  const durationMs = Number.isFinite(track.durationMs) ? track.durationMs : 0
  const baseElapsed = Number.isFinite(track.elapsedMs) ? Math.max(0, track.elapsedMs) : 0
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  // Only a playing track drifts forward; a paused one stays where the poll left it.
  const drift =
    playing && nowMs != null && Number.isFinite(music?.fetchedAt)
      ? Math.max(0, nowMs - music.fetchedAt)
      : 0
  const elapsedMs = durationMs > 0
    ? Math.min(durationMs, baseElapsed + drift)
    : baseElapsed + drift
  const pct = durationMs > 0 ? Math.min(100, (elapsedMs / durationMs) * 100) : 0

  const artUrl = track.albumArtUrl || ''
  const artOk = !!artUrl && artFailed !== artUrl
  const source = music?.sourceLabel || music?.stationName || ''
  const showProgress = !compact && durationMs > 0
  const showAlbum = !compact && !!track.album

  return (
    <PanelFrame
      title="Now playing"
      aside={room}
      className={`tl-np${compact ? ' tl-np--compact' : ''}`}
      bodyClassName="tl-np__body"
    >
      <div className="tl-np__row">
        <div className="tl-np__art">
          {artOk ? (
            <img
              src={artUrl}
              alt=""
              draggable="false"
              onError={() => setArtFailed(artUrl)}
            />
          ) : (
            <div className="tl-np__art-empty">
              <NoteGlyph />
            </div>
          )}
        </div>

        <div className="tl-np__text">
          <div className="tl-np__title">{track.title || 'Untitled'}</div>
          {track.artist && <div className="tl-np__artist">{track.artist}</div>}
          {showAlbum && <div className="tl-np__album">{track.album}</div>}
          {(paused || source) && (
            <div className="tl-np__meta">
              {paused && <span className="tl-np__pill">Paused</span>}
              {source && <span className="tl-np__source">{source}</span>}
            </div>
          )}
        </div>
      </div>

      {showProgress && (
        <div className="tl-np__progress">
          <div className="tl-np__track">
            <div className="tl-np__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="tl-np__times tl-num">
            <span>{fmtMinutes(elapsedMs)}</span>
            <span>{fmtMinutes(durationMs)}</span>
          </div>
        </div>
      )}
    </PanelFrame>
  )
}
