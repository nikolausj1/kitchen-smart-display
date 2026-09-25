import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
import './HeadlinePanel.css'

// HeadlinePanel - the one line of "what to know right now", large.
//
// headline: { text, kind, eventId, until } from the hub (frameserver/lib/
// headline.mjs), where kind says what sort of line it is and picks the prefix
// dot: 'now' (running), 'soon' (inside the hour), 'next' (later today),
// 'today' (an all-day event), 'tomorrow' (evenings), 'daypart' (a greeting,
// no dot).
//
// `now` is used for one thing: a 'now' or 'soon' line reads relative time ("in
// 40 min"), so once the hub's `until` has passed by a margin the words are
// probably out of date (the hub stopped answering). Such a line steps back
// rather than keep counting down confidently. null or empty: an empty line.
//
// knobs (a spec layout, panels/schemas.js 'headline'): size, weight, showDot,
// maxLines. Past one line a long headline wraps instead of ending in an
// ellipsis, and the type steps down so that many lines fit the box.

const KINDS = ['now', 'soon', 'next', 'today', 'tomorrow', 'daypart']
const RELATIVE_KINDS = ['now', 'soon']
// A poll or two of slack past `until` before the line is called outdated.
const OUTDATED_GRACE_MS = 2 * 60_000

// The share of the one-line size that lets N lines fit the same box: one
// line is sized to 56% of the box's height at a 1.12 line height, and N lines
// at N x 1.12 must stay inside 95% of it.
const LINES_FIT = { 1: 1, 2: 0.75, 3: 0.5 }

function parseMs(v) {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

export default function HeadlinePanel({ headline, now, knobs }) {
  const k = panelKnobs('headline', knobs)
  const text = typeof headline?.text === 'string' ? headline.text.trim() : ''
  const kind = KINDS.includes(headline?.kind) ? headline.kind : 'daypart'
  const untilMs = parseMs(headline?.until)
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  const outdated =
    RELATIVE_KINDS.includes(kind) &&
    untilMs != null &&
    nowMs != null &&
    nowMs > untilMs + OUTDATED_GRACE_MS

  const lines = k ? Math.min(3, Math.max(1, Math.round(Number(k.maxLines)) || 1)) : 1
  const showDot = kind !== 'daypart' && (k ? !!k.showDot : true)

  const cls = [
    'tl-headline',
    `tl-headline--${kind}`,
    outdated ? 'tl-headline--outdated' : '',
    k ? 'tl-knobs' : '',
    lines > 1 ? 'tl-headline--wrap' : '',
  ]
    .filter(Boolean)
    .join(' ')

  let style
  if (k) {
    style = { '--tl-headline-size': String(k.size) }
    if (lines > 1) style = { ...style, '--tl-headline-fit': String(LINES_FIT[lines]) }
  }

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-headline__body" style={style}>
      {text && (
        <div className="tl-headline__line" data-edit="text" style={k ? { fontWeight: k.weight } : undefined}>
          {showDot && <span className="tl-headline__dot" aria-hidden="true" />}
          <span className="tl-headline__text" style={lines > 1 ? { WebkitLineClamp: lines } : undefined}>
            {text}
          </span>
        </div>
      )}
    </PanelFrame>
  )
}
