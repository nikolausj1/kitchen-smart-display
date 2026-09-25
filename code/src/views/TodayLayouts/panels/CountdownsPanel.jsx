import { useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
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
//
// knobs (a spec layout, panels/schemas.js 'countdowns'):
//   maxTiles        1..4 tiles (3)
//   tileStyle       'card' (the card per the three knobs below), 'bare' (the
//                   art, title and number alone: no surface, no edge, no
//                   corners) or 'imageOnly' (the art alone, in the card)
//   tileBorder      'color' (the calendar colour along the top) or 'none'
//   tileBackground  'card' (the translucent surface), 'solid' or 'none' (no
//                   surface and no hairline)
//   tileRadius      multiplier of the corner radius
//   imageSize       share of the room the text leaves the art (0.25..1)
//   titleSize, numberSize (the number and its unit), showUnit, gap (between
//   tiles, multiplier), prefer ('art' | 'emoji': which one a countdown that
//   has both shows first)

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

// Art falls back in order: the picture, the emoji, the glyph (the emoji first
// when preferEmoji). The failed flag is per image (the caller keys this
// component by URL), so a new picture for the same countdown gets a fresh try.
function CountdownArt({ src, emoji, preferEmoji = false }) {
  const [failed, setFailed] = useState(false)
  const glyph = typeof emoji === 'string' && emoji.trim() ? emoji.trim() : null
  const emojiArt = glyph ? (
    <span className="tl-cd__emoji" aria-hidden="true">
      {glyph}
    </span>
  ) : null
  if (preferEmoji && emojiArt) return emojiArt
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
  if (emojiArt) return emojiArt
  return <CalendarGlyph />
}

// first: the first tile also marks its art, title and number for the layout
// editor (one of each is enough to select and tune them). k: the knobs, or
// null (no layout spec: the tile as it always was).
function Tile({ countdown, first = false, k = null }) {
  const days = Number.isFinite(countdown?.daysLeft) ? Math.max(0, Math.round(countdown.daysLeft)) : null
  const title = typeof countdown?.title === 'string' ? countdown.title.trim() : ''
  const src = artUrl(countdown?.image)
  // The edge is the calendar's colour; without one the edge draws nothing.
  const color = !k || (k.tileBorder !== 'none' && k.tileStyle !== 'bare') ? cleanColor(countdown?.color) : null
  const style = color ? { '--tl-cd-color': color } : undefined
  const artOnly = !!k && k.tileStyle === 'imageOnly'
  const showUnit = k ? !!k.showUnit : true

  let numberClass = 'tl-cd__num tl-num'
  let numberText
  let unit
  if (days == null) {
    numberText = '--'
    unit = 'DAYS'
  } else if (days === 0) {
    numberClass = 'tl-cd__num'
    numberText = <span className="tl-cd__today">Today</span>
    unit = ''
  } else {
    numberText = days
    unit = days === 1 ? 'DAY' : 'DAYS'
  }

  return (
    <div
      className={`tl-cd__tile${days === 0 ? ' tl-cd__tile--today' : ''}`}
      style={style}
      data-edit="tile"
      data-edit-label={title || 'Countdown'}
    >
      <div className="tl-cd__art" data-edit={first ? 'image' : undefined}>
        <CountdownArt
          key={src || 'none'}
          src={src}
          emoji={countdown?.emoji}
          preferEmoji={!!k && k.prefer === 'emoji'}
        />
      </div>
      {!artOnly && (
        <>
          <div className="tl-cd__title" data-edit={first ? 'title' : undefined}>
            <span className="tl-cd__title-text">{title || 'Countdown'}</span>
          </div>
          <div className={numberClass} data-edit={first ? 'number' : undefined}>
            {numberText}
          </div>
          {showUnit && <div className="tl-cd__unit">{unit || ' '}</div>}
        </>
      )}
    </div>
  )
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

export default function CountdownsPanel({ countdowns, knobs }) {
  const k = panelKnobs('countdowns', knobs)
  const max = k ? clampInt(k.maxTiles, 1, 4, MAX_TILES) : MAX_TILES
  const list = (Array.isArray(countdowns) ? countdowns : [])
    .filter((c) => c && typeof c === 'object')
    .slice(0, max)

  const cls = k ? `tl-cd tl-knobs tl-cd--style-${k.tileStyle} tl-cd--bg-${k.tileBackground}` : 'tl-cd'
  const style = k
    ? {
        '--tl-cd-radius': String(k.tileRadius),
        '--tl-cd-art': String(k.imageSize),
        '--tl-cd-title': String(k.titleSize),
        '--tl-cd-num': String(k.numberSize),
        '--tl-cd-gap': String(k.gap),
      }
    : undefined

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-cd__body" style={style}>
      {list.length === 0 ? (
        <div className="tl-cd__empty">No countdowns</div>
      ) : (
        <div className="tl-cd__row">
          {list.map((c, i) => (
            <Tile key={c.id == null ? `cd-${i}` : String(c.id)} countdown={c} first={i === 0} k={k} />
          ))}
        </div>
      )}
    </PanelFrame>
  )
}
