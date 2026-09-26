import PanelFrame from './PanelFrame.jsx'
import { panelKnobs } from './schemas.js'
import './WhatToWearPanel.css'

// One sentence of advice with a drawing of the thing you should put on. The
// glyphs are line art on a 24 x 24 grid, stroked in currentColor so they take
// the panel's foreground on either theme.
//
// knobs (a spec layout, panels/schemas.js 'wear'): size (the words; the glyph
// is art and keeps the box's size), showIcon, lines (1: the advice alone, 2:
// the advice and its detail).
const GLYPHS = {
  shorts: (
    <>
      <path d="M4.8 3.5h14.4l-1 17h-5.1L12 11.4l-1.1 9.1H5.8z" />
      <path d="M4.95 7.4h14.1" />
    </>
  ),
  tshirt: (
    <path d="M9 3 4 5.8 2.6 10l3.3 1.3.6-2.1V21h11V9.2l.6 2.1 3.3-1.3L20 5.8 15 3a3 3 0 0 1-6 0Z" />
  ),
  'light-jacket': (
    <>
      <path d="M9 3 4 5.8 2.6 10l3.3 1.3.6-2.1v11.4h11V9.2l.6 2.1 3.3-1.3L20 5.8 15 3l-3 4.2Z" />
      <path d="M12 7.2v13.4" />
    </>
  ),
  jacket: (
    <>
      <path d="M9 2.8 4 5.6 2.7 10.1l3.3 1.3.6-2.1v12.1h11V9.3l.6 2.1 3.3-1.3L20 5.6 15 2.8l-3 5Z" />
      <path d="M12 7.8v13.6" />
      <path d="M8.1 15.6h1.9M14 15.6h1.9" />
    </>
  ),
  coat: (
    <>
      <path d="M9 2.4 4.2 5.2 3 9.7l3.1 1.2.6-2v13.5h10.6V8.9l.6 2 3.1-1.2-1.2-4.5L15 2.4l-3 5.2Z" />
      <path d="M12 7.6v14.8" />
      <path d="M6.7 15.2h10.6" />
    </>
  ),
  raincoat: (
    <>
      <path d="M8.9 4.6 4.2 7.2 3 11.6l3.1 1.2.6-2v11.6h10.6V10.8l.6 2 3.1-1.2-1.2-4.4-4.7-2.6" />
      <path d="M8.9 4.6C8.9 1.6 10.3.9 12 .9s3.1.7 3.1 3.7" />
      <path d="M12 5v17.4" />
    </>
  ),
  umbrella: (
    <>
      <path d="M2.4 12.2C2.4 6.7 6.7 2.7 12 2.7s9.6 4 9.6 9.5Z" />
      <path d="M7.2 12.2c0-5.4 1.8-9.3 4.8-9.5M16.8 12.2c0-5.4-1.8-9.3-4.8-9.5" />
      <path d="M12 2.2v16.3c0 1.9-1.4 3.1-3 3.1-1.4 0-2.4-.9-2.6-2.2" />
    </>
  ),
  hat: (
    <>
      <path d="M5 15.4C5 9.9 8.1 6.3 12 6.3s7 3.6 7 9.1" />
      <rect x="3.2" y="15.3" width="17.6" height="3.7" rx="1.85" />
      <circle cx="12" cy="4.5" r="1.7" />
    </>
  ),
}

function WearGlyph({ name }) {
  const glyph = GLYPHS[name]
  if (!glyph) return null
  return (
    <svg
      className="tl-wear__svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  )
}

export default function WhatToWearPanel({ wear, knobs }) {
  const k = panelKnobs('wear', knobs)
  const headline = wear?.headline || null
  // One line keeps the advice and drops its detail, unless the advice is all
  // there is to say it with.
  const detail = wear?.detail && !(k && Number(k.lines) === 1 && headline) ? wear.detail : null
  // An unknown icon name draws nothing rather than the wrong garment; the
  // words still carry the advice.
  const hasGlyph = !!(wear?.icon && GLYPHS[wear.icon]) && (k ? !!k.showIcon : true)

  return (
    <PanelFrame
      title="What to wear"
      className={`tl-wear${k ? ' tl-knobs' : ''}`}
      bodyClassName="tl-wear__body"
      style={k ? { '--tl-wear-size': String(k.size) } : undefined}
    >
      {!headline && !detail ? (
        <div className="tl-wear__empty" data-edit="empty">
          Forecast not in yet
        </div>
      ) : (
        <div className="tl-wear__row">
          {hasGlyph && (
            <div className="tl-wear__glyph" data-edit="icon">
              <WearGlyph name={wear.icon} />
            </div>
          )}
          <div className="tl-wear__text">
            {headline && (
              <div className="tl-wear__headline" data-edit="label" data-edit-label="Advice">
                {headline}
              </div>
            )}
            {detail && (
              <div className="tl-wear__detail" data-edit="detail">
                {detail}
              </div>
            )}
          </div>
        </div>
      )}
    </PanelFrame>
  )
}
