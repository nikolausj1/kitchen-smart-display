import { useState } from 'react'
import TodayView from '../views/TodayView/TodayView.jsx'
import PhotoSlideshow from '../views/PhotoSlideshow/PhotoSlideshow.jsx'
import ComingSoonView from '../views/ComingSoon/ComingSoonView.jsx'
import MenuPill from './MenuPill.jsx'
import { ViewProvider, useView } from './ViewContext.jsx'
import { DebugHud, logEvent } from './DebugLog.jsx'

// AppShell - top-level chrome that owns view routing and menu pill state.
//
// Dead-area tap rule per spec: tapping the background of any view summons
// the menu pill. Tapping an interactive element does NOT. Interactive =
// <button>, <a>, <input>, <select>, <textarea>, anything with role=listbox,
// or anything with data-interactive="true".

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
      return <ComingSoonView title="Now Playing" subtitle="Sonos integration coming next" />
    case 'settings':
      return <ComingSoonView title="Settings" subtitle="Settings page coming later" />
    default:
      return <TodayView />
  }
}

function Shell() {
  const [menuOpen, setMenuOpen] = useState(false)

  function onShellClick(e) {
    const tag = e.target.tagName
    const cls = (e.target.className && typeof e.target.className === 'string')
      ? e.target.className.split(/\s+/).slice(0, 2).join('.')
      : ''
    const interactive = isInsideInteractive(e.target, e.currentTarget)
    logEvent(`shell click: ${tag}.${cls} interactive=${interactive} menuOpen=${menuOpen}`)
    if (menuOpen) return
    if (interactive) return
    setMenuOpen(true)
  }

  function closeMenu() {
    logEvent('menu close')
    setMenuOpen(false)
  }

  return (
    <div className="app-shell" onClick={onShellClick}>
      <CurrentView />
      <MenuPill open={menuOpen} onClose={closeMenu} />
      <DebugHud />
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
