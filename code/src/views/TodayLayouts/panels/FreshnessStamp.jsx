import { fmtAge } from '../lib/format.js'
import './FreshnessStamp.css'

// FreshnessStamp - "just now" / "3 min ago" / "as of 12:36 pm" next to a
// panel's data, so stale and unreachable are visible instead of silent. Renders
// nothing until the first successful fetch, and "No data" if there is an error
// and nothing cached.
export default function FreshnessStamp({ fetchedAt, now, error, staleAfterMs = 30 * 60_000 }) {
  const text = fmtAge(fetchedAt, now)
  if (!text) {
    return error ? <span className="tl-fresh tl-fresh--stale">No data</span> : null
  }
  // `now` comes from the layout's 1 Hz tick; render stays pure (no Date.now()).
  const nowMs = now instanceof Date ? now.getTime() : null
  const stale = !!error || (nowMs != null && nowMs - fetchedAt > staleAfterMs)
  return <span className={`tl-fresh${stale ? ' tl-fresh--stale' : ''}`}>{text}</span>
}
