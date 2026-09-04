import './tokens.css'

// Stand-in for a layout that has not landed yet. Shows the layout name in the
// shared tokens so the Settings row and the ?layout= override can be verified
// end to end before the real compositions exist.
export default function PlaceholderLayout({ name }) {
  return (
    <div className="tl-root" style={{ display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="tl-label">Today layout</div>
        <div style={{ fontSize: 'clamp(28px, 4vw, 72px)', fontWeight: 600, marginTop: '0.4em' }}>
          {name}
        </div>
        <div style={{ color: 'var(--tl-fg-3)', marginTop: '0.6em' }}>coming tonight</div>
      </div>
    </div>
  )
}
