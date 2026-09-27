// AddMenu - the Add block button and its menu (catalog.js): a search field on
// top, then every type the app knows in groups (Clocks and dates, Weather,
// Calendar, Countdowns, Home, Media, Blocks, then Other), a hairline between
// groups; each row a thumbnail, the label and a one-line description, and a
// type already on the layout says how many (picking it adds another). A
// picked row goes to onPick(item): Editor.jsx adds that block.
//
// Keys: the search field keeps the focus. Typing filters; Up and Down move
// the highlighted row (wrapping), Page Up and Page Down jump a few; Enter
// adds the highlighted row; Esc closes and gives the button the focus back;
// Tab closes. The pointer highlights the row it is over. The field is a
// combobox over a listbox (aria-activedescendant), so a screen reader follows
// the highlight.
//
// Drawn in a portal at a fixed position under the button: the layers column
// scrolls (overflow: auto) and would clip a menu wider than it. As tall as
// the window allows below the button; the rows scroll under the field.
//
// Thumbnails: the placeholder tile (the type's initial) is always drawn, and
// the picture is laid over it only once it has loaded, so a preview that is
// not there yet (or is not a picture) never shows as a broken image. What
// each URL did is remembered for the page's life.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { filterCatalog } from './catalog.js'
import { PlusIcon, SearchIcon } from './icons.jsx'

const WIDTH = 384
const MARGIN = 12
const PAGE = 6

// URL -> 'ok' | 'missing'
const previewState = new Map()

function Thumb({ src, label }) {
  const [state, setState] = useState(() => (src ? previewState.get(src) || 'loading' : 'missing'))
  const initial = String(label || '?').trim().charAt(0).toUpperCase()
  const done = (ok) => {
    previewState.set(src, ok ? 'ok' : 'missing')
    setState(ok ? 'ok' : 'missing')
  }
  return (
    <span className={`ed-thumb${state === 'ok' ? ' has-image' : ''}`} aria-hidden="true">
      <span className="ed-thumb__initial">{initial}</span>
      {src && state !== 'missing' && (
        <img src={src} alt="" draggable={false} decoding="async" onLoad={(e) => done(e.currentTarget.naturalWidth > 0)} onError={() => done(false)} />
      )}
    </span>
  )
}

// Where the menu goes: under the button, inside the window.
function placeUnder(button) {
  const r = button.getBoundingClientRect()
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN))
  const top = r.bottom + 4
  return { left, top, width, maxHeight: Math.max(180, window.innerHeight - top - MARGIN) }
}

export default function AddMenu({ groups, disabled, title, onPick }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState(null)
  const buttonRef = useRef(null)
  const popRef = useRef(null)
  const listRef = useRef(null)
  const uid = useId()
  const listId = `${uid}-list`

  const shown = useMemo(() => filterCatalog(groups, query), [groups, query])
  const flat = useMemo(() => shown.flatMap((g) => g.items), [shown])
  const indexOf = useMemo(() => new Map(flat.map((it, i) => [it.key, i])), [flat])
  const at = flat.length ? Math.min(active, flat.length - 1) : -1
  const optionId = (i) => `${uid}-o${i}`
  const activeId = at >= 0 ? optionId(at) : null

  function show() {
    if (!buttonRef.current) return
    setPos(placeUnder(buttonRef.current))
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  function hide(focusButton) {
    setOpen(false)
    if (focusButton) buttonRef.current?.focus()
  }

  function pick(item) {
    if (!item) return
    setOpen(false)
    onPick(item)
  }

  // Outside presses close it; the window resizing or anything scrolling moves
  // it back under the button.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onMove = () => {
      if (!buttonRef.current) return
      const next = placeUnder(buttonRef.current)
      setPos((p) => (p && Object.keys(next).every((k) => p[k] === next[k]) ? p : next))
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  // The highlighted row stays in view.
  useEffect(() => {
    if (!open || !activeId) return
    listRef.current?.querySelector(`#${CSS.escape(activeId)}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, activeId, shown])

  function onKeyDown(e) {
    const n = flat.length
    let next = null
    if (e.key === 'ArrowDown') next = n ? (at + 1) % n : 0
    else if (e.key === 'ArrowUp') next = n ? (at <= 0 ? n - 1 : at - 1) : 0
    else if (e.key === 'PageDown') next = Math.min(n - 1, at + PAGE)
    else if (e.key === 'PageUp') next = Math.max(0, at - PAGE)
    else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      pick(flat[at])
      return
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      hide(true)
      return
    } else if (e.key === 'Tab') {
      hide(false)
      return
    }
    if (next == null) return
    e.preventDefault()
    e.stopPropagation()
    setActive(Math.max(0, next))
  }

  return (
    <div className="ed-addmenu-root">
      <button
        type="button"
        ref={buttonRef}
        className="ed-btn ed-addmenu__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? hide(false) : show())}
      >
        <PlusIcon /> Add block
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="ed-menu__caret">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="ed-addmenu"
            style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
            role="dialog"
            aria-label="Add block"
          >
            <div className="ed-addmenu__search">
              <SearchIcon />
              <input
                type="text"
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeId || undefined}
                aria-label="Search blocks"
                placeholder="Search blocks"
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
              />
            </div>
            <div className="ed-addmenu__list" id={listId} role="listbox" aria-label="Blocks to add" ref={listRef}>
              {shown.map((g) => (
                <div key={g.id} className="ed-addmenu__group" role="group" aria-labelledby={`${uid}-g-${g.id}`}>
                  <div className="ed-addmenu__head" id={`${uid}-g-${g.id}`}>
                    {g.label}
                  </div>
                  {g.items.map((it) => {
                    const i = indexOf.get(it.key)
                    const on = i === at
                    return (
                      <div
                        key={it.key}
                        id={optionId(i)}
                        role="option"
                        aria-selected={on}
                        className={`ed-addmenu__item${on ? ' is-active' : ''}`}
                        title={it.count && it.where === 'front' ? `${it.count} on this layout already; this adds another` : undefined}
                        onMouseMove={() => i !== at && setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pick(it)}
                      >
                        <Thumb key={it.preview} src={it.preview} label={it.label} />
                        <span className="ed-addmenu__text">
                          <span className="ed-addmenu__label">{it.label}</span>
                          {it.description && <span className="ed-addmenu__desc">{it.description}</span>}
                        </span>
                        {it.count > 0 && it.where === 'front' && (
                          <span className="ed-addmenu__count">{it.count === 1 ? 'on layout' : `${it.count} on layout`}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
              {!flat.length && <div className="ed-addmenu__empty">No block matches "{query.trim()}".</div>}
            </div>
            <div className="ed-addmenu__foot" aria-hidden="true">
              ↑ ↓ to choose · Enter to add · Esc to close
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
