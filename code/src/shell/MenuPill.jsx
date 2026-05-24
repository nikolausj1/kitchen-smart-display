import { useEffect, useRef } from 'react'
import { useView } from './ViewContext.jsx'
import { logEvent } from './DebugLog.jsx'
import './MenuPill.css'

// MenuPill - frosted-glass overlay summoned by tapping a dead area on any
// view. Four icons + labels (Photos, Music, Today, Settings). Tapping an
// icon navigates and dismisses. Tapping anywhere outside a button dismisses.
// Auto-fades after AUTOFADE_MS if untouched.

const AUTOFADE_MS = 5000

// Note: the SVG files saved at pinwheel.svg / music-note.svg are swapped
// relative to their filenames (verified from screen). Use the file that
// actually contains each glyph.
const ITEMS = [
  { id: 'photos', label: 'Photos', icon: '/icons/ui/music-note.svg' },
  { id: 'music', label: 'Music', icon: '/icons/ui/pinwheel.svg' },
  { id: 'today', label: 'Today', icon: '/icons/ui/calendar.svg' },
  { id: 'settings', label: 'Settings', icon: '/icons/ui/gear.svg' },
]

export default function MenuPill({ open, onClose }) {
  const { view, setView } = useView()
  const timerRef = useRef(null)

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
    // Anything outside a button dismisses the menu. Button clicks call
    // pick() which stops propagation, so they never reach this handler.
    if (e.target.closest && e.target.closest('button')) return
    logEvent('menu backdrop tap -> dismiss')
    onClose()
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
