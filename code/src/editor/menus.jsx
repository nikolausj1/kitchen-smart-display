// menus.jsx - a drop-down menu and a modal dialog for the tool chrome.
//
// Keys: while a menu or the dialog is open it listens on the window in the
// capture phase and stops Esc (closes it) and the arrow keys (move between
// items) from reaching the editor's own shortcuts, so Esc in a menu never
// also deselects and an arrow never nudges a panel. Enter and Space are the
// buttons' own.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

// A button that opens a list. children: (close) => items, or items.
export function Menu({ label, title, disabled, align = 'start', className = '', buttonClass = 'ed-btn', onOpen, children }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const id = useId()

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        rootRef.current?.querySelector('[aria-haspopup]')?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        const items = [...(listRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]
        if (!items.length) return
        const i = items.indexOf(document.activeElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length : i) - 1
        items[next].focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`ed-menu ${className}`} ref={rootRef}>
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="ed-menu__caret">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={id} ref={listRef} role="menu" className={`ed-menu__list ed-menu__list--${align}`}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

// One entry. `close` from the Menu's render function closes it after.
export function MenuItem({ onSelect, close, disabled, title, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="ed-menu__item"
      disabled={disabled}
      title={title}
      onClick={() => {
        close?.()
        onSelect?.()
      }}
    >
      {children}
    </button>
  )
}

export function MenuNote({ children }) {
  return <div className="ed-menu__note">{children}</div>
}

// A modal question. Esc or the backdrop cancels, Enter on the focused
// confirm button confirms (it has the focus when the dialog opens).
export function Dialog({ title, children, confirmLabel, cancelLabel = 'Cancel', danger, busy, onConfirm, onCancel }) {
  const confirmRef = useRef(null)
  const titleId = useId()
  const cancelRef = useRef(onCancel)
  useLayoutEffect(() => {
    cancelRef.current = onCancel
  })
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelRef.current()
      } else if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') {
        // Nothing else reaches the editor while the question is open.
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  return (
    <div className="ed-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="ed-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        <div className="ed-dialog__body">{children}</div>
        <div className="ed-dialog__actions">
          <button type="button" className="ed-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`ed-btn ${danger ? 'ed-btn--danger-solid' : 'ed-btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
