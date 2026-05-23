import { useEffect, useRef } from 'react'
import { useView } from './ViewContext.jsx'
import './MenuPill.css'

// MenuPill - frosted-glass overlay summoned by tapping a dead area on any
// view. Four icons + labels (Photos, Music, Today, Settings). Tapping an
// icon navigates and dismisses; tapping outside the pill dismisses without
// navigating; auto-fades after AUTOFADE_MS of no interaction.

const AUTOFADE_MS = 4500

const ITEMS = [
  { id: 'photos', label: 'Photos', icon: '/icons/ui/pinwheel.svg' },
  { id: 'music', label: 'Music', icon: '/icons/ui/music-note.svg' },
  { id: 'today', label: 'Today', icon: '/icons/ui/calendar.svg' },
  { id: 'settings', label: 'Settings', icon: '/icons/ui/gear.svg' },
]

export default function MenuPill({ open, onClose }) {
  const { view, setView } = useView()
  const timerRef = useRef(null)

  // Schedule an auto-fade whenever the pill opens or is interacted with.
  useEffect(() => {
    if (!open) return
    const arm = () => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(onClose, AUTOFADE_MS)
    }
    arm()
    // Re-arm on any pointer move so a hovering finger does not get dropped.
    window.addEventListener('pointermove', arm, { passive: true })
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', arm)
    }
  }, [open, onClose])

  if (!open) return null

  function pick(viewId) {
    setView(viewId)
    onClose()
  }

  return (
    <div
      className="menu-overlay"
      // Tap on the dimmed backdrop dismisses without navigating.
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <div
        className="menu-pill"
        // Clicks inside the pill should not propagate to the backdrop
        // (which would dismiss). Stop propagation so taps on a label/icon
        // still trigger the per-item button onClick.
        onClick={(e) => e.stopPropagation()}
        data-interactive="true"
      >
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              'menu-pill__item' +
              (view === item.id ? ' menu-pill__item--active' : '')
            }
            onClick={() => pick(item.id)}
            aria-label={item.label}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <img className="menu-pill__icon" src={item.icon} alt="" aria-hidden="true" />
            <div className="menu-pill__label">{item.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
