import useSonosState from '../../../hooks/useSonosState.js'
import { useView } from '../../../shell/ViewContext.jsx'
import './AlbumArtWidget.css'

// Album art widget - bottom-right of the Photo Slideshow.
// Renders only when Sonos is playing AND we have a track with art.
// Tap navigates to the Music (Now Playing) view.

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
