import PanelFrame from './PanelFrame.jsx'
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

const KINDS = ['now', 'soon', 'next', 'today', 'tomorrow', 'daypart']
const RELATIVE_KINDS = ['now', 'soon']
// A poll or two of slack past `until` before the line is called outdated.
const OUTDATED_GRACE_MS = 2 * 60_000

function parseMs(v) {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

export default function HeadlinePanel({ headline, now }) {
  const text = typeof headline?.text === 'string' ? headline.text.trim() : ''
  const kind = KINDS.includes(headline?.kind) ? headline.kind : 'daypart'
  const untilMs = parseMs(headline?.until)
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : null
  const outdated =
    RELATIVE_KINDS.includes(kind) &&
    untilMs != null &&
    nowMs != null &&
    nowMs > untilMs + OUTDATED_GRACE_MS

  const cls = ['tl-headline', `tl-headline--${kind}`, outdated ? 'tl-headline--outdated' : '']
    .join(' ')
    .trim()

  return (
    <PanelFrame title={null} className={cls} bodyClassName="tl-headline__body">
      {text && (
        <div className="tl-headline__line">
          {kind !== 'daypart' && <span className="tl-headline__dot" aria-hidden="true" />}
          <span className="tl-headline__text">{text}</span>
        </div>
      )}
    </PanelFrame>
  )
}
