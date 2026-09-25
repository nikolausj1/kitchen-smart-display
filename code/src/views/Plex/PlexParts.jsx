import { useState } from 'react'
import { initials, nameTint } from './plexFormat.js'

// Small pieces the Plex view and its person card share.

// Transport glyphs, drawn for a 24 x 24 box in currentColor. The skip arrows
// carry their seconds; CC is outlined when off and solid when on.
export function PlexIcon({ name, on = false }) {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }
  switch (name) {
    case 'play':
      return (
        <svg {...common}>
          <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <path d="M6.5 5h3.6v14H6.5zM13.9 5h3.6v14h-3.6z" fill="currentColor" />
        </svg>
      )
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
        </svg>
      )
    case 'back':
    case 'forward': {
      const back = name === 'back'
      // An open circle with its gap at the top, the arrowhead at twelve
      // o'clock pointing the way time moves: left to go back, right to skip.
      const arc = back ? 'M12 4.2A7.8 7.8 0 1 1 5.2 8.1' : 'M12 4.2A7.8 7.8 0 1 0 18.8 8.1'
      const head = back ? 'M8.9 4.2l3.6-2.5v5z' : 'M15.1 4.2l-3.6-2.5v5z'
      return (
        <svg {...common}>
          <path d={arc} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d={head} fill="currentColor" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="7.6" fontWeight="700" fill="currentColor">
            {back ? '10' : '30'}
          </text>
        </svg>
      )
    }
    case 'cc':
      return (
        <svg {...common}>
          <rect
            x="2.8"
            y="5.2"
            width="18.4"
            height="13.6"
            rx="2.6"
            fill={on ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <text
            x="12"
            y="14.6"
            textAnchor="middle"
            fontSize="7"
            fontWeight="700"
            fill={on ? 'var(--pv-cc-ink, #111)' : 'currentColor'}
          >
            CC
          </text>
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    default:
      return null
  }
}

// A portrait headshot filling its box (the box sets the size), or the
// person's initials on a colour of their own when there is no picture or it
// fails to load. `over` is a sharper copy laid on top once it has loaded (the
// person card: the cast thumb at once, TMDB's large profile when it arrives).
// Not loading="lazy", here or on the posters: Chrome does not fetch a lazy
// image clipped by a scroller until it scrolls into view, so the cast board
// and the Known for row would fill in late under a finger. A cast is 30 to
// 60 headshots of about 25 kB, once per item.
export function Headshot({ src, over = null, name, className = '' }) {
  // The src that failed, so a new src gets its own chance.
  const [failed, setFailed] = useState(null)
  const [overFailed, setOverFailed] = useState(null)
  const [overLoaded, setOverLoaded] = useState(null)
  const base = src && failed !== src ? src : null
  const top = over && over !== src && overFailed !== over ? over : null
  const initialsOnly = !base && !(top && overLoaded === top)
  return (
    <span className={`pv-shot ${className}`} style={initialsOnly ? { background: nameTint(name) } : undefined}>
      {base && <img src={base} alt="" draggable="false" onError={() => setFailed(base)} />}
      {top && (
        <img
          className={`pv-shot__over${overLoaded === top ? ' pv-shot__over--in' : ''}`}
          src={top}
          alt=""
          draggable="false"
          onLoad={() => setOverLoaded(top)}
          onError={() => setOverFailed(top)}
        />
      )}
      {initialsOnly && (
        <span className="pv-shot__initials" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  )
}

// A poster filling its box, or its title on a plain card when there is no
// picture.
export function Poster({ src, title, className = '' }) {
  const [failed, setFailed] = useState(null)
  return (
    <div className={`pv-poster ${className}`}>
      {src && failed !== src ? (
        <img src={src} alt="" draggable="false" onError={() => setFailed(src)} />
      ) : (
        <span className="pv-poster__title">{title}</span>
      )}
    </div>
  )
}
