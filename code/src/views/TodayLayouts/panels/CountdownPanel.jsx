import PanelFrame from './PanelFrame.jsx'
import CountdownCard from './CountdownCard.jsx'
import { panelKnobs } from './schemas.js'
import { pickCountdown } from './countdownParts.js'
import './CountdownsPanel.css'
import './CountdownPanel.css'

// CountdownPanel - one countdown, big, drawn the DAKboard way: its art above
// (or left of) a coloured card, the number large on the card
// (docs/designs/panels-and-controls.md, chunk 2 "Single countdown"; the
// card is CountdownCard.jsx, as the countdowns panel's 'artAbove' tiles are).
//
// countdowns: the same list as the tiles (useTodayData's countdowns: the
// hub's, soonest first, daysLeft recounted today). Only countdowns the hub
// sends can be picked: marked events inside their own lead window, the first
// shared.calendar.countdownMax of them (3 unless the dashboard says more).
//
// knobs (panels/schemas.js 'countdown'):
//   pick            'next' (the soonest) or 'title' (the first whose title
//                   holds titleMatch, any case; none while it is empty)
//   titleMatch      part of a countdown's title (its `label:` when it has one)
//   layout          'stacked' (the art above the card) or 'side' (left of it)
//   tileGradient, tileColorFrom, tileRadius, artSize, artOverlap, titleSize,
//   numberSize, showUnit, prefer: as the art-above tiles'
//                   (CountdownsPanel.jsx); artSize and artOverlap count
//                   across the card's height beside it
//
// Nothing to show (no countdowns, no match) says "No countdown", quietly, in
// the layout editor too: the box shows what the screen would.

export default function CountdownPanel({ countdowns, knobs }) {
  const k = panelKnobs('countdown', knobs || {})
  const countdown = pickCountdown(countdowns, k.pick, k.titleMatch)
  const layout = k.layout === 'side' ? 'side' : 'stacked'
  const style = {
    '--tl-cd-radius': String(k.tileRadius),
    '--tl-cd-title': String(k.titleSize),
    '--tl-cd-num': String(k.numberSize),
    '--tl-cd-art-size': String(k.artSize),
    '--tl-cd-art-overlap': String(k.artOverlap),
  }

  return (
    <PanelFrame title={null} className={`tl-cd1 tl-cd1--${layout} tl-knobs`} bodyClassName="tl-cd1__body" style={style}>
      {countdown ? (
        <CountdownCard
          key={countdown.id == null ? 'countdown' : String(countdown.id)}
          countdown={countdown}
          k={k}
          layout={layout}
          solo
        />
      ) : (
        <div className="tl-cd__empty" data-edit="empty">
          No countdown
        </div>
      )}
    </PanelFrame>
  )
}
