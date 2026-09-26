import { useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import CountdownCard from './CountdownCard.jsx'
import { panelKnobs } from './schemas.js'
import { artUrl, dayCount, hasArt } from './countdownParts.js'
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
//                   corners), 'imageOnly' (the art alone, in the card) or
//                   'artAbove' (DAKboard's: the art above a coloured card,
//                   dipping into it; CountdownCard.jsx draws those tiles)
//   tileBorder      'color' (the calendar colour along the top) or 'none'
//   tileBackground  'card' (the translucent surface), 'solid' or 'none' (no
//                   surface and no hairline)
//   tileRadius      multiplier of the corner radius
//   imageSize       share of the room the text leaves the art (0.25..1)
//   titleSize, numberSize (the number and its unit), showUnit, gap (between
//   tiles, multiplier), prefer ('art' | 'emoji': which one a countdown that
//   has both shows first)
// and for 'artAbove' alone (the edge, the background and imageSize are the
// other styles'):
//   artSize         the art's box, of the card's width (0.4..1.2, 0.8)
//   artOverlap      how much of the art's height dips into the card (0..0.8,
//                   0.35)
//   tileGradient    'down' | 'diagonal' | 'none': the card runs from its
//                   colour to a darker shade of it
//   tileColorFrom   'auto' (the event's `color:` marker, else a colour from
//                   the art, else the calendar's), 'marker' (never the art)
//                   or 'calendar'; the accent with none (lib/tileColor.js)

const MAX_TILES = 3

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

// Every tile marks its parts for the layout editor (data-edit: tile, image,
// name, number, unit), so an element style reaches every tile alike. k: the
// knobs, or null (no layout spec: the tile as it always was).
function Tile({ countdown, k = null }) {
  const count = dayCount(countdown)
  const title = typeof countdown?.title === 'string' ? countdown.title.trim() : ''
  const src = artUrl(countdown?.image)
  // The edge is the calendar's colour; without one the edge draws nothing.
  const color = !k || (k.tileBorder !== 'none' && k.tileStyle !== 'bare') ? cleanColor(countdown?.color) : null
  const style = color ? { '--tl-cd-color': color } : undefined
  const artOnly = !!k && k.tileStyle === 'imageOnly'
  const showUnit = k ? !!k.showUnit : true

  const numberClass = count.today ? 'tl-cd__num' : 'tl-cd__num tl-num'
  const numberText = count.today ? <span className="tl-cd__today">{count.text}</span> : count.text
  const unit = count.unit

  return (
    <div
      className={`tl-cd__tile${count.today ? ' tl-cd__tile--today' : ''}`}
      style={style}
      data-edit="tile"
      data-edit-label={title || 'Countdown'}
    >
      <div className="tl-cd__art" data-edit="image" data-edit-label="Image">
        <CountdownArt
          key={src || 'none'}
          src={src}
          emoji={countdown?.emoji}
          preferEmoji={!!k && k.prefer === 'emoji'}
        />
      </div>
      {!artOnly && (
        <>
          <div className="tl-cd__title" data-edit="name" data-edit-label="Event name">
            <span className="tl-cd__title-text">{title || 'Countdown'}</span>
          </div>
          <div className={numberClass} data-edit="number" data-edit-label="Number">
            {numberText}
          </div>
          {showUnit && (
            <div className="tl-cd__unit" data-edit="unit" data-edit-label="Days label">
              {unit || ' '}
            </div>
          )}
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

  // Art above: the tiles are CountdownCards, which take the art's size and
  // overlap as two more variables. The other styles draw exactly as before.
  const above = !!k && k.tileStyle === 'artAbove'
  const cls = k ? `tl-cd tl-knobs tl-cd--style-${k.tileStyle} tl-cd--bg-${k.tileBackground}` : 'tl-cd'
  const style = k
    ? {
        '--tl-cd-radius': String(k.tileRadius),
        '--tl-cd-art': String(k.imageSize),
        '--tl-cd-title': String(k.titleSize),
        '--tl-cd-num': String(k.numberSize),
        '--tl-cd-gap': String(k.gap),
        ...(above ? { '--tl-cd-art-size': String(k.artSize), '--tl-cd-art-overlap': String(k.artOverlap) } : null),
      }
    : undefined
  // A tile with no art keeps its text level with its neighbours' when any of
  // them has art.
  const align = above && list.some(hasArt)

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-cd__body" style={style}>
      {list.length === 0 ? (
        <div className="tl-cd__empty" data-edit="empty">
          No countdowns
        </div>
      ) : (
        <div className="tl-cd__row">
          {list.map((c, i) =>
            above ? (
              <CountdownCard key={c.id == null ? `cd-${i}` : String(c.id)} countdown={c} k={k} align={align} />
            ) : (
              <Tile key={c.id == null ? `cd-${i}` : String(c.id)} countdown={c} k={k} />
            )
          )}
        </div>
      )}
    </PanelFrame>
  )
}
