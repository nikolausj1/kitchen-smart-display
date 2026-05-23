import { useCallback, useState } from 'react'
import TodayView from '../views/TodayView/TodayView.jsx'
import PhotoSlideshow from '../views/PhotoSlideshow/PhotoSlideshow.jsx'
import ComingSoonView from '../views/ComingSoon/ComingSoonView.jsx'
import MenuPill from './MenuPill.jsx'
import { ViewProvider, useView } from './ViewContext.jsx'

// AppShell - top-level chrome that owns view routing and menu pill state.
//
// Dead-area tap rule per spec: tapping the background of any view summons
// the menu pill. Tapping an interactive element (button, toggle, anything
// with data-interactive="true" anywhere up its DOM tree) does NOT.
//
// We implement this with a single onClick on the shell that walks up from
// event.target looking for [data-interactive="true"]; if it finds nothing
// before reaching the shell, the click counts as dead-area.

// Treat as interactive: <button>, <a>, <input>, anything with role=listbox
// (our scroll-wheel viewport), and anything explicitly marked with
// data-interactive="true". Everything else is dead-area.
function isInsideInteractive(target, stopNode) {
  let el = target
  while (el && el !== stopNode) {
    const tag = el.tagName
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return true
    }
    if (el.dataset && el.dataset.interactive === 'true') return true
    if (typeof el.getAttribute === 'function' && el.getAttribute('role') === 'listbox') {
      return true
    }
    el = el.parentElement
  }
  return false
}

function CurrentView() {
  const { view } = useView()
  switch (view) {
    case 'today':
      return <TodayView />
    case 'photos':
      return <PhotoSlideshow />
    case 'music':
      return (
        <ComingSoonView
          title="Now Playing"
          subtitle="Sonos integration coming next"
        />
      )
    case 'settings':
      return (
        <ComingSoonView title="Settings" subtitle="Settings page coming later" />
      )
    default:
      return <TodayView />
  }
}

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const shellRef = useCallback((node) => {
    // No-op now; reserved if we ever need direct DOM access.
    void node
  }, [])

  function onShellClick(e) {
    if (menuOpen) return // clicks while menu open are handled by the overlay
    if (isInsideInteractive(e.target, e.currentTarget)) return
    setMenuOpen(true)
  }

  return (
    <div className="app-shell" onClick={onShellClick} ref={shellRef}>
      <CurrentView />
      <MenuPill open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  )
}

export default function AppShell() {
  return (
    <ViewProvider initialView="today">
      <Shell />
    </ViewProvider>
  )
}
