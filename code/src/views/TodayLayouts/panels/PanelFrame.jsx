import './PanelFrame.css'

// PanelFrame - the one piece of chrome every panel shares: an optional header
// row (label left, aside right) over a body that fills the rest of the cell.
// Pass title={null} for chrome-less panels (the clock, the photo tile).
//
// style: inline style on the root (a panel's knob variables, schemas.js).
// titleEdit / titleEditLabel: the header label as a layout-editor sub-element
// (data-edit, see tokens.css), for a panel whose label is content (the clock's
// greeting).
export default function PanelFrame({
  title,
  aside,
  children,
  className = '',
  bodyClassName = '',
  style,
  titleEdit,
  titleEditLabel,
}) {
  return (
    <section className={`tl-panel ${className}`.trim()} style={style}>
      {title != null && (
        <header className="tl-panel__head">
          <div className="tl-panel__title tl-label" data-edit={titleEdit} data-edit-label={titleEditLabel}>
            {title}
          </div>
          {aside != null && <div className="tl-panel__aside">{aside}</div>}
        </header>
      )}
      <div className={`tl-panel__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  )
}
