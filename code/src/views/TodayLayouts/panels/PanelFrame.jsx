import './PanelFrame.css'

// PanelFrame - the one piece of chrome every panel shares: an optional header
// row (label left, aside right) over a body that fills the rest of the cell.
// Pass title={null} for chrome-less panels (the clock, the photo tile).
export default function PanelFrame({ title, aside, children, className = '', bodyClassName = '' }) {
  return (
    <section className={`tl-panel ${className}`.trim()}>
      {title != null && (
        <header className="tl-panel__head">
          <div className="tl-panel__title tl-label">{title}</div>
          {aside != null && <div className="tl-panel__aside">{aside}</div>}
        </header>
      )}
      <div className={`tl-panel__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  )
}
