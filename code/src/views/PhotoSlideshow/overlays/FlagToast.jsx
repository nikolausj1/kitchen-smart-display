import { useEffect, useState } from 'react'
import './FlagToast.css'

// Brief confirmation shown after long-pressing a photo to flag its wrong
// location caption. Shows what was captured so you trust the right photo was
// recorded, then fades. No undo by design - stray flags are dropped at triage.
export default function FlagToast({ flag, onDone }) {
  const [leaving, setLeaving] = useState(false)

  // The parent keys this component by flag, so each new flag remounts it with
  // leaving=false. We only schedule the fade-out + dismissal here.
  useEffect(() => {
    if (!flag) return undefined
    const fade = setTimeout(() => setLeaving(true), 2200)
    const done = setTimeout(() => onDone?.(), 2600)
    return () => {
      clearTimeout(fade)
      clearTimeout(done)
    }
  }, [flag, onDone])

  if (!flag) return null
  const label = flag.caption && flag.caption.trim() ? flag.caption : '(no caption)'
  return (
    <div
      className={'flag-toast' + (leaving ? ' flag-toast--leaving' : '')}
      aria-hidden="true"
    >
      <div className="flag-toast__title">Flagged for review</div>
      <div className="flag-toast__caption">{label}</div>
      <div className="flag-toast__hint">we&rsquo;ll fix this later</div>
    </div>
  )
}
