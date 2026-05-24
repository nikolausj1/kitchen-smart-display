import { useEffect, useRef } from 'react'
import { useView } from './ViewContext.jsx'
import { logEvent } from './DebugLog.jsx'
import './MenuPill.css'

// MenuPill - frosted-glass overlay summoned by tapping a dead area on any
// view. Four icons + labels (Photos, Music, Today, Settings). Tapping an
// icon navigates and dismisses; tapping outside the pill dismisses without
// navigating; auto-fades after AUTOFADE_MS regardless of motion.

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

  // Simple AUTOFADE_MS timer - no pointermove re-arm, which on a touchscreen
  // was racing with click events and causing the menu to dismiss before
  // taps could register.
  useEffect(() => {
    if (!open) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      logEvent('menu autofade')
      onClose()
    }, AUTOFADE_MS)
    return () => clearTimeout(timerRef.current)
  }, [open, onClose])

  if (!open) return null

  function pick(e, viewId) {
    e.stopPropagation()
    logEvent(`menu pick: ${viewId}`)
    setView(viewId)
    onClose()
  }

  function onBackdropClick(e) {
    // Only the backdrop itself, not its descendants. e.target === e.currentTarget
    // means the click landed on the overlay surface, not the pill inside.
    if (e.target === e.currentTarget) {
      logEvent('menu backdrop tap -> dismiss')
      onClose()
    }
  }

  return (
    <div
      className="menu-overlay"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
    >
      <div className="menu-pill" data-interactive="true">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              'menu-pill__item' +
              (view === item.id ? ' menu-pill__item--active' : '')
            }
            onClick={(e) => pick(e, item.id)}
            aria-label={item.label}
            aria-current={view === item.id ? 'page' : undefined}
            data-interactive="true"
          >
            <img className="menu-pill__icon" src={item.icon} alt="" aria-hidden="true" />
            <div className="menu-pill__label">{item.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
