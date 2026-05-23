import useSonosState from '../../../hooks/useSonosState.js'
import { useView } from '../../../shell/ViewContext.jsx'
import './AlbumArtWidget.css'

// Album art widget - bottom-right of the Photo Slideshow.
// Only renders when Sonos is playing. Tapping navigates to Now Playing.
// In Phase 1 useSonosState always returns playing:false, so this stays
// hidden until the Sonos hook is wired to the real node-sonos-http-api.

export default function AlbumArtWidget() {
  const { playing, track } = useSonosState()
  const { setView } = useView()
  if (!playing || !track) return null

  return (
    <button
      type="button"
      className="album-art-widget"
      onClick={(e) => {
        e.stopPropagation()
        setView('music')
      }}
      data-interactive="true"
      aria-label={`Now playing: ${track.title} by ${track.artist}`}
    >
      {track.albumArtUrl && (
        <img src={track.albumArtUrl} alt="" draggable="false" />
      )}
    </button>
  )
}
