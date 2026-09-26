import { useContext } from 'react'
import { PanelTitleContext } from './panelTitle.js'
import './PanelFrame.css'

// PanelFrame - the one piece of chrome every panel shares: an optional header
// row (label left, aside right) over a body that fills the rest of the cell.
// Pass title={null} for chrome-less panels (the clock, the photo tile).
//
// style: inline style on the root (a panel's knob variables, schemas.js).
//
// The header's parts are layout-editor sub-elements (data-edit, tokens.css):
// the title is 'title', or titleEdit / titleEditLabel for a panel whose label
// is content (the clock's greeting); the aside is asideEdit / asideEditLabel
// ('aside' unless the panel names it: the weather's 'updated' stamp).
//
// In a spec layout the box may override the title (the universal `title`,
// PanelTitleContext from Entry/SpecPanel): 'custom' shows its text in the
// title's place, on any panel (key 'title'), and 'none' drops the header row.
// Outside one, or at 'default', the panel's own title shows as always.
export default function PanelFrame({
  title,
  aside,
  children,
  className = '',
  bodyClassName = '',
  style,
  titleEdit,
  titleEditLabel,
  asideEdit,
  asideEditLabel,
}) {
  const override = useContext(PanelTitleContext)
  const mode = override ? override.mode : 'default'
  let shown = title
  let editKey = titleEdit || 'title'
  let editLabel = titleEditLabel || 'Title'
  if (mode === 'custom') {
    shown = override.text ? override.text : null
    editKey = 'title'
    editLabel = 'Title'
  }
  const head = mode !== 'none' && shown != null

  return (
    <section className={`tl-panel ${className}`.trim()} style={style}>
      {head && (
        <header className="tl-panel__head">
          <div className="tl-panel__title tl-label" data-edit={editKey} data-edit-label={editLabel}>
            {shown}
          </div>
          {aside != null && (
            <div className="tl-panel__aside" data-edit={asideEdit || 'aside'} data-edit-label={asideEditLabel || undefined}>
              {aside}
            </div>
          )}
        </header>
      )}
      <div className={`tl-panel__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  )
}
