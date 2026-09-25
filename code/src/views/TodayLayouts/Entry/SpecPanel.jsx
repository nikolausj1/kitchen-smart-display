import { panelType } from '../layoutSpec.js'
import './SpecPanel.css'

// SpecPanel - one box of a layout spec (layoutSpec.js), drawn exactly where the
// spec says: left / top / width / height in percent of the screen, its z,
// opacity, padding and corner radius as multiples of the layout's --tl-pad and
// --tl-radius (which the root's global radius already scales, tokens.css), a
// background per the spec ('none', 'card', 'solid'), and --tl-text-scale for
// every font size inside (tokens.css). Used by SpecBoard for both spec
// layouts (the Entry board and the Board); each layout's root names its card
// colours (--tl-spec-card, --tl-spec-edge; SpecPanel.css).
//
// The box is a size container (container-name tl-spec): the panel inside sizes
// its type against its own body as before, and below the type's minPx the
// box shows a quiet "Too small" instead of letting the content overflow
// (SpecPanel.css holds those thresholds as container queries).
//
// The panel inside gives up its own card, padding and radius: the box draws
// them (SpecPanel.css). The departure panel in a box with no background keeps
// its own card, as the countdown tiles do.
//
// join: { top, bottom } from cardJoins(): a card stacked flush on another card
// loses the corners and edge where they meet and gains a hairline divider, so
// the stack reads as one card (the phase 1 "outside" card).
//
// borrowed: the box is showing the departure countdown in place of its own
// panel (SpecBoard's rule for the countdowns and now-playing boxes), so the
// departure panel's "Too small" threshold applies.
//
// data-panel-id / data-panel-type mark the box for the layout editor, which
// reads each box's rectangle (editBridge.js). data-hover is the editor's
// hover highlight: a 1 px inset outline and nothing else.
//
// The scrim (the universal `scrim`, 'soft' or 'strong', on a box with no
// background): the box gains a close text shadow on its text
// (tl-spec--scrim-<level>), and SpecScrims below draws the shade behind it.
// The shade is not inside the box: the box clips its content, and the shade
// has to bleed past the box's edges.

function r3(n) {
  return Math.round(n * 1000) / 1000
}

// 'soft' | 'strong' when the panel draws a scrim, else null: only a box with
// no background has one (a card is its own shade).
function scrimOf(panel) {
  const p = panel && panel.props
  if (!p || p.background !== 'none') return null
  return p.scrim === 'soft' || p.scrim === 'strong' ? p.scrim : null
}

const SCRIM_LEVELS = ['soft', 'strong']

// SpecScrims - the shade behind every scrimmed box, drawn by SpecBoard under
// all the boxes (SpecPanel.css "Scrims"). One layer per strength: in it each
// box's shade is opaque, feathered by its own box-shadow, and the layer's
// opacity is the strength, so shades that meet (the clock's and the
// headline's, across the gap between them) merge into one instead of
// doubling up into a darker band. Nothing at all is drawn when no box has a
// scrim.
export function SpecScrims({ panels }) {
  const groups = { soft: [], strong: [] }
  ;(Array.isArray(panels) ? panels : []).forEach((p) => {
    const level = scrimOf(p)
    if (level) groups[level].push(p)
  })
  return SCRIM_LEVELS.filter((level) => groups[level].length > 0).map((level) => (
    <div key={level} className={`tl-spec-scrims tl-spec-scrims--${level}`} aria-hidden="true">
      {groups[level].map((p) => (
        <div
          key={p.id}
          className="tl-spec-scrim"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.w}%`,
            height: `${p.h}%`,
            // A faded panel gets a faded shade.
            opacity: p.props.opacity < 1 ? p.props.opacity : undefined,
          }}
        />
      ))}
    </div>
  ))
}

export default function SpecPanel({ panel, textScale = 1, join = null, hover = false, borrowed = false, children }) {
  const { id, type, x, y, w, h, z, props } = panel
  const t = panelType(type)
  const shape = t && t.padShape ? t.padShape : [1, 1]
  const pad = props.padding
  const padY = r3(shape[0] * pad)
  const padX = r3(shape[1] * pad)
  const background = props.background
  const scrim = scrimOf(panel)
  // Corners are drawn where there is something to round: a background, or an
  // image. Bare text keeps square corners so a big clock numeral sitting in
  // the box's corner is never clipped by an invisible radius.
  const rounded = background !== 'none' || type === 'image'
  const radius = `calc(var(--tl-radius) * ${r3(props.radius)})`
  const top = join && join.top ? '0' : radius
  const bottom = join && join.bottom ? '0' : radius

  const style = {
    left: `${x}%`,
    top: `${y}%`,
    width: `${w}%`,
    height: `${h}%`,
    zIndex: z,
    padding: `calc(var(--tl-pad) * ${padY}) calc(var(--tl-pad) * ${padX})`,
    '--tl-spec-pad-x': `calc(var(--tl-pad) * ${padX})`,
    '--tl-text-scale': String(textScale),
  }
  if (rounded) style.borderRadius = `${top} ${top} ${bottom} ${bottom}`
  // Only below 1: an opacity property at all, even 1, makes Chrome raster the
  // box's content differently (a photo tile's pixels change).
  if (props.opacity < 1) style.opacity = props.opacity

  const cls = [
    'tl-spec',
    `tl-spec--${type}`,
    `tl-spec--bg-${background}`,
    `tl-spec--align-${props.align}`,
    scrim ? `tl-spec--scrim-${scrim}` : '',
    join && join.top ? 'tl-spec--join-top' : '',
    join && join.bottom ? 'tl-spec--join-bottom' : '',
    borrowed ? 'tl-spec--departure-host' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={style}
      data-panel-id={id}
      data-panel-type={type}
      data-hover={hover ? '' : undefined}
    >
      <div className="tl-spec__content">{children}</div>
      {t && (t.minPx || borrowed) && (
        <div className="tl-panel--small" aria-hidden="true">
          Too small
        </div>
      )}
    </div>
  )
}
