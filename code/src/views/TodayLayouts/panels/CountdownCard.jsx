import { useState } from 'react'
import useTileColor from './useTileColor.js'
import { artUrl, dayCount, emojiOf, titleOf } from './countdownParts.js'
import { tileVars } from '../lib/tileColor.js'
import './CountdownCard.css'

// CountdownCard - one countdown drawn the DAKboard way
// (docs/designs/panels-and-controls.md, chunk 2 "Countdown tiles"): its art
// above a coloured card, dipping into the card's top edge, and on the card,
// in white, the title, the number and its unit. The countdowns panel's
// 'artAbove' tiles are these; so is the single countdown panel.
//
//   countdown  the hub's countdown (panels/countdownParts.js)
//   k          the panel's knobs: tileGradient, tileColorFrom, prefer and
//              showUnit are read here; the sizes (artSize, artOverlap,
//              tileRadius, titleSize, numberSize) arrive as the panel root's
//              CSS variables (CountdownCard.css)
//   layout     'stacked' (the art above the card) or 'side' (the art left of
//              it, dipping into its left edge; the single countdown only)
//   solo       the single countdown: its own, bigger type, and no 'tile'
//              element (the tile is the whole panel)
//   align      the card sits in a row of tiles some of which have art: with
//              none of its own, it keeps its text where its neighbours have
//              theirs
//
// The art: the picture, else the emoji (the emoji first with prefer
// 'emoji'). With neither, or a picture that fails to load and no emoji, the
// card fills the slot: a plain gradient tile (the calendar glyph the other
// tile styles fall back to is not art). The picture's own shape is read when
// it loads, so a wide picture dips into the card by the overlap of its own
// height, not of its box's.
//
// The colour: the marker's, the picture's, the calendar's, or the accent
// (useTileColor, lib/tileColor.js), drawn with the gradient knob as a veil
// from clear to a darker shade over it (tileVars).

function round3(n) {
  return Math.round(n * 1000) / 1000
}

export default function CountdownCard({ countdown, k, layout = 'stacked', solo = false, align = false }) {
  const src = artUrl(countdown && countdown.image)
  const emoji = emojiOf(countdown)
  // The picture that failed to load, and the shape of the one that loaded
  // (each tied to its URL, so a new picture starts afresh).
  const [failed, setFailed] = useState(null)
  const [shape, setShape] = useState(null)
  const preferEmoji = !!k && k.prefer === 'emoji' && !!emoji
  const showImg = !!src && failed !== src && !preferEmoji
  const showEmoji = !showImg && !!emoji
  const art = showImg || showEmoji
  const color = useTileColor(countdown, k ? k.tileColorFrom : 'auto', showImg ? src : null)
  const count = dayCount(countdown)
  const title = titleOf(countdown)
  const side = layout === 'side'

  const style = tileVars(color, k ? k.tileGradient : 'down')
  if (showImg && shape && shape.src === src) {
    style['--tl-cdc-wf'] = String(shape.wf)
    style['--tl-cdc-hf'] = String(shape.hf)
  }

  const cls = [
    'tl-cdc',
    side ? 'tl-cdc--side' : 'tl-cdc--stacked',
    solo ? 'tl-cdc--solo' : '',
    art ? '' : 'tl-cdc--noart',
    !art && align ? 'tl-cdc--align' : '',
    count.today ? 'tl-cdc--today' : '',
  ]
    .filter(Boolean)
    .join(' ')

  function onLoad(e) {
    const w = e.currentTarget.naturalWidth
    const h = e.currentTarget.naturalHeight
    if (!(w > 0) || !(h > 0)) return
    setShape({ src, wf: round3(Math.min(1, w / h)), hf: round3(Math.min(1, h / w)) })
  }

  const showUnit = k ? k.showUnit !== false : true

  return (
    <div
      className={cls}
      style={style}
      data-edit={solo ? undefined : 'tile'}
      data-edit-label={solo ? undefined : title || 'Countdown'}
    >
      {art && (
        <div className="tl-cdc__art" data-edit="image" data-edit-label="Image">
          {showImg ? (
            <img
              key={src}
              className="tl-cdc__img"
              src={src}
              alt=""
              draggable="false"
              onLoad={onLoad}
              onError={() => setFailed(src)}
            />
          ) : (
            <span className="tl-cdc__emoji" aria-hidden="true">
              {emoji}
            </span>
          )}
        </div>
      )}
      <div className="tl-cdc__card">
        <div className="tl-cdc__title" data-edit="name" data-edit-label="Event name">
          <span className="tl-cdc__title-text">{title || 'Countdown'}</span>
        </div>
        <div className={count.today ? 'tl-cdc__num' : 'tl-cdc__num tl-num'} data-edit="number" data-edit-label="Number">
          {count.today ? <span className="tl-cdc__today">{count.text}</span> : count.text}
        </div>
        {showUnit && (
          <div className="tl-cdc__unit" data-edit="unit" data-edit-label="Days label">
            {count.unit || ' '}
          </div>
        )}
      </div>
    </div>
  )
}
