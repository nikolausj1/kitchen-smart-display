// Layers - the left-hand column, "Blocks": everything on the day part on
// show, front to back (the top row is drawn in front). Click selects,
// Shift-click adds a block to the selection or takes it out, the eye hides,
// the lock stops drag and resize, drag a row (or use the arrows) to restack.
// Every panel is a "block" in the UI (the code keeps its names); a type with
// more than one on the part is numbered in list order ("Weather",
// "Weather 2"; `names`, spec.js instanceNames).
//
// Add block (AddMenu.jsx) lists every type the app knows, grouped, whether or
// not the layout has one already (another is a further instance), with the
// shape twice: in front, or behind the selection.
//
// A panel of a type the app does not know is listed dimmed, "Shape (not
// supported by this app)": the app draws nothing for it and the editor keeps
// it exactly as stored, so it has no eye, lock or restacking, and a restack
// of the others leaves its z alone (select it for the way to remove it).
//
// A chevron opens a panel's elements (the type's element list: Countdowns
// has Tile, Image, Title, Number): click one to select it on the stage, its
// eye hides that element alone (props.elements[key].hidden). A panel row
// counts its styled elements, and a panel with a rule says when it shows
// ("shows: school morning").

import { useState } from 'react'
import AddMenu from './AddMenu.jsx'
import {
  BlockIcon,
  ChevronIcon,
  DownIcon,
  EyeIcon,
  EyeOffIcon,
  ImageIcon,
  LockIcon,
  PanelIcon,
  RuleIcon,
  ShapeIcon,
  TextIcon,
  UnknownIcon,
  UnlockIcon,
  UpIcon,
} from './icons.jsx'
import { elementList, isBlockType, isKnownType } from './schema.js'
import { elementStyleOf, frontToBack, isStyled, panelLabel, styledCount, whenSummary } from './spec.js'

const BLOCK_ICONS = { text: TextIcon, image: ImageIcon, shape: ShapeIcon }

function TypeIcon({ type }) {
  if (!isKnownType(type)) return <UnknownIcon />
  if (!isBlockType(type)) return <PanelIcon />
  const Icon = BLOCK_ICONS[type] || BlockIcon
  return <Icon />
}

// Depth of an element in its panel's list, from the parents the list names.
function depthOf(list, key) {
  let d = 0
  let at = list.find((e) => e.key === key)
  const seen = new Set()
  while (at?.parent && !seen.has(at.parent) && d < 4) {
    seen.add(at.parent)
    at = list.find((e) => e.key === at.parent)
    if (!at) break
    d += 1
  }
  return d
}

export default function Layers({
  panels,
  selectedIds,
  selectedId,
  selectedElement,
  hoverId,
  labels,
  names,
  disabled,
  readOnlyNote,
  canAdd,
  catalog,
  onSelect,
  onSelectElement,
  onHover,
  onToggle,
  onToggleElement,
  onReorder,
  onAdd,
}) {
  const ordered = panels ? frontToBack(panels) : []
  // Restacking moves the panels the app knows; one it does not know keeps
  // its z, as stored.
  const ids = ordered.filter((p) => isKnownType(p.type)).map((p) => p.id)
  // While a row is dragged: which one, and where it would land.
  const [drag, setDrag] = useState(null) // { id, overId, after }
  // Rows opened or closed by hand; otherwise the selected panel is open while
  // one of its elements is selected.
  const [expanded, setExpanded] = useState({})
  const isOpen = (id) => (id in expanded ? expanded[id] : id === selectedId && !!selectedElement)

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
    <aside className="ed-layers" aria-label="Blocks">
      <div className="ed-side__head">
        <h2>Blocks</h2>
        <span className="ed-side__meta">{selectedIds.length > 1 ? `${selectedIds.length} of ${ordered.length} selected` : ordered.length}</span>
      </div>
      <div className="ed-layers__add">
        <AddMenu
          groups={catalog}
          disabled={!canAdd}
          title="Put a block on this layout: a clock, the weather, the calendar, text, a picture…"
          onPick={(it) => onAdd(it.type, it.where)}
        />
      </div>
      {readOnlyNote && <p className="ed-side__empty">{readOnlyNote}</p>}
      <ul className="ed-layers__list" aria-label="Blocks, front to back">
        {ordered.map((p) => {
          const supported = isKnownType(p.type)
          // Where it stands among the panels that restack (not a type the app does not know).
          const at = ids.indexOf(p.id)
          const selected = selectedIds.includes(p.id)
          const els = supported ? elementList(p.type) : []
          const open = els.length > 0 && isOpen(p.id)
          const styled = supported ? styledCount(p) : 0
          const summary = supported ? whenSummary(p.when) : null
          const cls = ['ed-layer']
          if (selected) cls.push('is-selected')
          if (p.id === hoverId) cls.push('is-hover')
          if (p.hidden) cls.push('is-hidden')
          if (!supported) cls.push('is-unsupported')
          if (summary) cls.push('has-rule')
          if (drag?.id === p.id) cls.push('is-dragging')
          if (drag?.overId === p.id && drag.id !== p.id) cls.push(drag.after ? 'drop-after' : 'drop-before')
          return (
            <li key={p.id} className="ed-layer-item">
              <div
                className={cls.join(' ')}
                draggable={!disabled && supported}
                title={supported ? undefined : `${p.id}: this app does not draw a ${p.type}; kept in the layout as saved`}
                onClick={(e) => onSelect(p.id, e.shiftKey)}
                onMouseEnter={() => onHover(p.id, null)}
                onMouseLeave={() => onHover(null, null)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', p.id)
                  setDrag({ id: p.id, overId: null, after: false })
                }}
                onDragOver={(e) => {
                  if (!drag || !supported) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  const r = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > r.top + r.height / 2
                  if (drag.overId !== p.id || drag.after !== after) setDrag({ ...drag, overId: p.id, after })
                }}
                onDrop={(e) => onDrop(e, p.id)}
                onDragEnd={() => setDrag(null)}
              >
                {els.length > 0 ? (
                  <button
                    type="button"
                    className="ed-icon ed-layer__chev"
                    aria-expanded={open}
                    aria-label={`${open ? 'Close' : 'Open'} the elements of ${p.id}`}
                    title={open ? 'Hide its elements' : 'Show its elements'}
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpanded((x) => ({ ...x, [p.id]: !open }))
                    }}
                  >
                    <ChevronIcon open={open} />
                  </button>
                ) : (
                  <span className="ed-layer__chev" aria-hidden="true" />
                )}
                <span className="ed-layer__icon">
                  <TypeIcon type={p.type} />
                </span>
                <button
                  type="button"
                  className="ed-layer__name"
                  title={summary ? `${p.id} · ${summary}` : p.id}
                  aria-pressed={selected}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(p.id, e.shiftKey)
                  }}
                >
                  <span className="ed-layer__label">{panelLabel(p, labels, names)}</span>
                </button>
                {styled > 0 && (
                  <span className="ed-badge" title={`${styled} element${styled === 1 ? '' : 's'} styled`}>
                    {styled}
                  </span>
                )}
                <span className="ed-layer__tools">
                  <button
                    type="button"
                    className="ed-icon"
                    title={p.hidden ? 'Show' : 'Hide'}
                    aria-label={`${p.hidden ? 'Show' : 'Hide'} ${p.id}`}
                    aria-pressed={p.hidden}
                    disabled={!supported}
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
                    disabled={!supported}
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
                    disabled={at <= 0}
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
                    disabled={at < 0 || at === ids.length - 1}
                    onClick={(e) => {
                      e.stopPropagation()
                      step(p.id, 1)
                    }}
                  >
                    <DownIcon />
                  </button>
                </span>
                {summary && (
                  <span className="ed-layer__rule" title={summary}>
                    <RuleIcon size={11} />
                    <span>{summary}</span>
                  </span>
                )}
              </div>
              {open && (
                <ul className="ed-els" aria-label={`Elements of ${p.id}`}>
                  {els.map((el) => {
                    const style = elementStyleOf(p, el.key)
                    const hidden = style.hidden === true
                    const on = p.id === selectedId && el.key === selectedElement
                    const c = ['ed-elrow']
                    if (on) c.push('is-selected')
                    if (hidden) c.push('is-hidden')
                    return (
                      <li
                        key={el.key}
                        className={c.join(' ')}
                        style={{ paddingLeft: 30 + depthOf(els, el.key) * 12 }}
                        onClick={() => onSelectElement(p.id, el.key)}
                        onMouseEnter={() => onHover(p.id, el.key)}
                        onMouseLeave={() => onHover(null, null)}
                      >
                        <button
                          type="button"
                          className="ed-elrow__name"
                          aria-pressed={on}
                          title={`${el.label}: select it on the stage`}
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelectElement(p.id, el.key)
                          }}
                        >
                          {el.label}
                        </button>
                        {isStyled(style) && !hidden && <span className="ed-elrow__mark" title="Styled" aria-label="Styled" />}
                        <button
                          type="button"
                          className="ed-icon ed-elrow__eye"
                          title={hidden ? `Show ${el.label}` : `Hide ${el.label}`}
                          aria-label={`${hidden ? 'Show' : 'Hide'} ${p.id} ${el.label}`}
                          aria-pressed={hidden}
                          disabled={disabled}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleElement(p.id, el.key)
                          }}
                        >
                          {hidden ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <p className="ed-side__foot">Top of the list is in front. Drag a row to restack; Shift-click to select several.</p>
    </aside>
  )
}
