import { useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { hubUrl } from '../../../lib/hub.js'
import { cleanColor } from '../lib/agenda.js'
import './CountdownsPanel.css'

// CountdownsPanel - up to three countdown tiles side by side: the art, the
// title, the number of days.
//
// countdowns: [{ id, title, date, daysLeft, image, emoji, color }], chosen by
// the hub (events whose description carries the `countdown` marker; see
// docs/designs/entry-board.md). `image` is a hub-relative path into the
// "Countdown Art" library ('/countdown-art/<file>'); when it is missing or
// fails to load the tile shows the event's emoji, and failing that a calendar
// glyph. The panel is a transparent frame: each tile is its own card, so a
// single countdown does not sit alone in a big empty plate.

const MAX_TILES = 3

// '/countdown-art/x.png' -> the hub's URL for it. Absolute and data: URLs are
// left alone, so a fixture can point anywhere.
function artUrl(image) {
  if (typeof image !== 'string' || !image.trim()) return null
  const s = image.trim()
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  return hubUrl(s)
}

function CalendarGlyph() {
  return (
    <svg
      className="tl-cd__glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.4" />
      <path d="M3.5 9.6h17" />
      <path d="M8 3.2v3.4M16 3.2v3.4" />
      <path d="M8 13.4h.01M12 13.4h.01M16 13.4h.01M8 17h.01M12 17h.01" />
    </svg>
  )
}

// Art falls back in order: the picture, the emoji, the glyph. The failed flag
// is per image (the caller keys this component by URL), so a new picture for
// the same countdown gets a fresh try.
function CountdownArt({ src, emoji }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        className="tl-cd__img"
        src={src}
        alt=""
        draggable="false"
        onError={() => setFailed(true)}
      />
    )
  }
  if (typeof emoji === 'string' && emoji.trim()) {
    return (
      <span className="tl-cd__emoji" aria-hidden="true">
        {emoji.trim()}
      </span>
    )
  }
  return <CalendarGlyph />
}

function Tile({ countdown }) {
  const days = Number.isFinite(countdown?.daysLeft) ? Math.max(0, Math.round(countdown.daysLeft)) : null
  const title = typeof countdown?.title === 'string' ? countdown.title.trim() : ''
  const src = artUrl(countdown?.image)
  const color = cleanColor(countdown?.color)
  const style = color ? { '--tl-cd-color': color } : undefined

  let number
  let unit
  if (days == null) {
    number = <div className="tl-cd__num tl-num">--</div>
    unit = 'DAYS'
  } else if (days === 0) {
    number = (
      <div className="tl-cd__num">
        <span className="tl-cd__today">Today</span>
      </div>
    )
    unit = ''
  } else {
    number = <div className="tl-cd__num tl-num">{days}</div>
    unit = days === 1 ? 'DAY' : 'DAYS'
  }

  return (
    <div className={`tl-cd__tile${days === 0 ? ' tl-cd__tile--today' : ''}`} style={style}>
      <div className="tl-cd__art">
        <CountdownArt key={src || 'none'} src={src} emoji={countdown?.emoji} />
      </div>
      <div className="tl-cd__title">
        <span className="tl-cd__title-text">{title || 'Countdown'}</span>
      </div>
      {number}
      <div className="tl-cd__unit">{unit || ' '}</div>
    </div>
  )
}

export default function CountdownsPanel({ countdowns }) {
  const list = (Array.isArray(countdowns) ? countdowns : [])
    .filter((c) => c && typeof c === 'object')
    .slice(0, MAX_TILES)

  return (
    <PanelFrame title={null} className="tl-cd" bodyClassName="tl-cd__body">
      {list.length === 0 ? (
        <div className="tl-cd__empty">No countdowns</div>
      ) : (
        <div className="tl-cd__row">
          {list.map((c, i) => (
            <Tile key={c.id == null ? `cd-${i}` : String(c.id)} countdown={c} />
          ))}
        </div>
      )}
    </PanelFrame>
  )
}
