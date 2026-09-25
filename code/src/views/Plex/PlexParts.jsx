import { useState } from 'react'
import { initials } from './plexFormat.js'

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

// A round headshot, or the person's initials when there is no picture (or it
// fails to load).
export function Face({ src, name, className = '' }) {
  const [failed, setFailed] = useState(false)
  const show = src && !failed
  return (
    <span className={`pv-face ${className}`}>
      {show ? (
        <img src={src} alt="" draggable="false" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="pv-face__initials" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  )
}

// A 2:3 poster, or its title on a plain card when there is no picture.
export function Poster({ src, title, className = '' }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`pv-poster ${className}`}>
      {src && !failed ? (
        <img src={src} alt="" draggable="false" onError={() => setFailed(true)} />
      ) : (
        <span className="pv-poster__title">{title}</span>
      )}
    </div>
  )
}
