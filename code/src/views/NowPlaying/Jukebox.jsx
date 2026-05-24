import { useEffect, useState } from 'react'
import { useSettings } from '../../lib/settings.js'
import { useSonosActions, cleanStationName } from '../../hooks/useSonosState.js'
import './Jukebox.css'

// Sonos exposes the music service per favorite in two places:
//   - the URI's sid= query param (numeric service ID)
//   - the metadata's <desc>SA_RINCONxxx_...</desc> token
// Map the ones we actually see in this household to a friendly name.
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

function detectSource(item) {
  const uri = item?.uri || ''
  const meta = item?.metadata || ''

  const sidMatch = uri.match(/[?&]sid=(\d+)/)
  if (sidMatch && SID_TO_SOURCE[sidMatch[1]]) return SID_TO_SOURCE[sidMatch[1]]

  const saMatch = meta.match(/SA_RINCON(\d+)/)
  if (saMatch && SA_TO_SOURCE[saMatch[1]]) return SA_TO_SOURCE[saMatch[1]]

  if (uri.startsWith('x-sonosapi-stream:')) return 'Radio'
  if (uri.startsWith('x-rincon-playlist:')) return 'Sonos playlist'
  if (uri.startsWith('file:')) return 'Library'
  return 'Sonos'
}

// Jukebox - the station/playlist picker. Opens centered over Now Playing
// (Figma 171:20). Lists all Sonos Favorites as a 2-column grid; tap a
// card to play that favorite and dismiss.

// A small palette of muted color squares (no real album art is provided
// by /Main/favorites). Hashing favorite names into this palette keeps
// each card visually distinct and stable across renders.
const PALETTE = [
  '#b86c4a', // burnt orange
  '#5d8a5a', // forest green
  '#c45a85', // raspberry
  '#3f6a99', // ocean blue
  '#e08e4f', // amber
  '#8c6f54', // walnut
  '#92ab5c', // moss
  '#7a4f93', // plum
  '#c08c4a', // mustard
  '#4f6e80', // slate
  '#a8568a', // pink
  '#4d8a8a', // teal
]

function hashIndex(str, mod) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i)
  }
  return Math.abs(h) % mod
}

function pad2(n) {
  return String(n + 1).padStart(2, '0')
}

// Tiny CSS-animated equalizer used as the "now playing" indicator.
function EqIndicator() {
  return (
    <div className="jb-eq" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  )
}

export default function Jukebox({ open, onClose, currentStationName }) {
  const { sonos } = useSettings()
  const actions = useSonosActions()
  const [favorites, setFavorites] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // The 'detailed' variant returns rich entries with uri + metadata so we
    // can derive the underlying service (Pandora / Spotify / etc.).
    fetch(`${sonos.apiBase}/${sonos.room}/favorites/detailed`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const items = Array.isArray(data) ? data : []
        setFavorites(
          items.map((it) => ({
            name: it.title || '',
            uri: it.uri || '',
            source: detectSource(it),
          }))
        )
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setFavorites([])
      })
    return () => {
      cancelled = true
    }
  }, [open, sonos.apiBase, sonos.room])

  if (!open) return null

  function onBackdrop(e) {
    if (e.target.closest && e.target.closest('button')) return
    onClose()
  }

  function pick(e, name) {
    e.stopPropagation()
    actions.playFavorite(name)
    onClose()
  }

  return (
    <div className="jb-overlay" onClick={onBackdrop}>
      <div className="jb-panel" data-interactive="true">
        <div className="jb-header">
          <button
            type="button"
            className="jb-back"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
          >
            <span className="jb-back__arrow">&larr;</span>
            <span>Now Playing</span>
          </button>
          <div className="jb-title">PICK YOUR VIBE</div>
          <div className="jb-header__spacer" aria-hidden="true" />
        </div>

        <div className="jb-grid">
          {favorites === null && (
            <div className="jb-empty">Loading favorites&hellip;</div>
          )}
          {favorites && favorites.length === 0 && (
            <div className="jb-empty">
              No Sonos Favorites yet. Add some in the Sonos app.
              {error && <div className="jb-empty__err">({error})</div>}
            </div>
          )}
          {favorites?.map((fav, i) => {
            const color = PALETTE[hashIndex(fav.name, PALETTE.length)]
            const display = cleanStationName(fav.name)
            const isPlaying =
              cleanStationName(fav.name) === cleanStationName(currentStationName)
            return (
              <button
                key={fav.name}
                type="button"
                className={'jb-card' + (isPlaying ? ' jb-card--playing' : '')}
                onClick={(e) => pick(e, fav.name)}
                data-interactive="true"
              >
                <div className="jb-card__art" style={{ background: color }}>
                  {isPlaying && <EqIndicator />}
                </div>
                <div className="jb-card__body">
                  <div className="jb-card__name">{display}</div>
                  <div className="jb-card__source">{fav.source}</div>
                </div>
                <div className="jb-card__slot">{pad2(i)}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
