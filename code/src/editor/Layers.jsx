// Layers - the left-hand column: every panel and block of the day part on
// show, front to back (the top row is drawn in front). Click selects, the eye
// hides, the lock stops drag and resize, drag a row (or use the arrows) to
// restack. Add text / Add image put a new block in the middle of the canvas,
// in front; Add panel lists the functional panels this part does not have
// (each appears at most once per layout) and puts the one chosen there too.

import { useState } from 'react'
import { DownIcon, EyeIcon, EyeOffIcon, ImageIcon, LockIcon, PanelIcon, TextIcon, UnlockIcon, UpIcon } from './icons.jsx'
import { Menu, MenuItem, MenuNote } from './menus.jsx'
import { frontToBack, panelLabel } from './spec.js'

function TypeIcon({ type }) {
  if (type === 'text') return <TextIcon />
  if (type === 'image') return <ImageIcon />
  return <PanelIcon />
}

export default function Layers({
  panels,
  selectedId,
  hoverId,
  labels,
  disabled,
  readOnlyNote,
  canAdd,
  addable,
  onSelect,
  onHover,
  onToggle,
  onReorder,
  onAdd,
  onAddPanel,
}) {
  const ordered = panels ? frontToBack(panels) : []
  const ids = ordered.map((p) => p.id)
  // While a row is dragged: which one, and where it would land.
  const [drag, setDrag] = useState(null) // { id, overId, after }

  function moveTo(id, targetIndex) {
    const rest = ids.filter((x) => x !== id)
    rest.splice(Math.max(0, Math.min(rest.length, targetIndex)), 0, id)
    if (rest.join() !== ids.join()) onReorder(rest)
  }

  function step(id, dir) {
    const i = ids.indexOf(id)
    moveTo(id, i + dir)
  }

  function onDrop(e, overId) {
    e.preventDefault()
    if (!drag || drag.id === overId) return setDrag(null)
    const rest = ids.filter((x) => x !== drag.id)
    const at = rest.indexOf(overId) + (drag.after ? 1 : 0)
    setDrag(null)
    moveTo(drag.id, at)
  }

  return (
    <aside className="ed-layers" aria-label="Layers">
      <div className="ed-side__head">
        <h2>Layers</h2>
        <span className="ed-side__meta">{ordered.length}</span>
      </div>
      <div className="ed-layers__add">
        <button type="button" className="ed-btn" disabled={!canAdd} onClick={() => onAdd('text')}>
          <TextIcon /> Add text
        </button>
        <button type="button" className="ed-btn" disabled={!canAdd} onClick={() => onAdd('image')}>
          <ImageIcon /> Add image
        </button>
        <Menu
          className="ed-layers__addpanel"
          disabled={!canAdd}
          title="Put a panel this layout does not have on it"
          label={
            <>
              <PanelIcon /> Add panel
            </>
          }
        >
          {(close) =>
            addable.length ? (
              addable.map((t) => (
                <MenuItem key={t.type} close={close} onSelect={() => onAddPanel(t.type)}>
                  {t.label}
                </MenuItem>
              ))
            ) : (
              <MenuNote>Every panel is on this layout already. A hidden one comes back with its eye.</MenuNote>
            )
          }
        </Menu>
      </div>
      {readOnlyNote && <p className="ed-side__empty">{readOnlyNote}</p>}
      <ul className="ed-layers__list" aria-label="Layers, front to back">
        {ordered.map((p, i) => {
          const cls = ['ed-layer']
          if (p.id === selectedId) cls.push('is-selected')
          if (p.id === hoverId) cls.push('is-hover')
          if (p.hidden) cls.push('is-hidden')
          if (drag?.id === p.id) cls.push('is-dragging')
          if (drag?.overId === p.id && drag.id !== p.id) cls.push(drag.after ? 'drop-after' : 'drop-before')
          return (
            <li
              key={p.id}
              className={cls.join(' ')}
              draggable={!disabled}
              onClick={() => onSelect(p.id)}
              onMouseEnter={() => onHover(p.id)}
              onMouseLeave={() => onHover(null)}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', p.id)
                setDrag({ id: p.id, overId: null, after: false })
              }}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientY > r.top + r.height / 2
                if (drag.overId !== p.id || drag.after !== after) setDrag({ ...drag, overId: p.id, after })
              }}
              onDrop={(e) => onDrop(e, p.id)}
              onDragEnd={() => setDrag(null)}
            >
              <span className="ed-layer__icon">
                <TypeIcon type={p.type} />
              </span>
              <button
                type="button"
                className="ed-layer__name"
                title={p.id}
                aria-pressed={p.id === selectedId}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(p.id)
                }}
              >
                {panelLabel(p, labels)}
              </button>
              <span className="ed-layer__tools">
                <button
                  type="button"
                  className="ed-icon"
                  title={p.hidden ? 'Show' : 'Hide'}
                  aria-label={`${p.hidden ? 'Show' : 'Hide'} ${p.id}`}
                  aria-pressed={p.hidden}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(p.id, 'hidden')
                  }}
                >
                  {p.hidden ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button
                  type="button"
                  className={`ed-icon${p.locked ? ' is-on' : ''}`}
                  title={p.locked ? 'Unlock' : 'Lock'}
                  aria-label={`${p.locked ? 'Unlock' : 'Lock'} ${p.id}`}
                  aria-pressed={p.locked}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggle(p.id, 'locked')
                  }}
                >
                  {p.locked ? <LockIcon /> : <UnlockIcon />}
                </button>
                <button
                  type="button"
                  className="ed-icon ed-restack"
                  title="Bring forward"
                  aria-label={`Bring ${p.id} forward`}
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    step(p.id, -1)
                  }}
                >
                  <UpIcon />
                </button>
                <button
                  type="button"
                  className="ed-icon ed-restack"
                  title="Send backward"
                  aria-label={`Send ${p.id} backward`}
                  disabled={i === ordered.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    step(p.id, 1)
                  }}
                >
                  <DownIcon />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="ed-side__foot">Top of the list is in front. Drag a row to restack.</p>
    </aside>
  )
}
