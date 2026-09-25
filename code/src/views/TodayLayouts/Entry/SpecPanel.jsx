import { panelType } from '../layoutSpec.js'
import './SpecPanel.css'

// SpecPanel - one box of a layout spec (layoutSpec.js), drawn exactly where the
// spec says: left / top / width / height in percent of the screen, its z,
// opacity, padding and corner radius as multiples of the layout's --tl-pad and
// --tl-radius, a background per the spec ('none', 'card', 'solid'), and
// --tl-text-scale for every font size inside (tokens.css).
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
// data-panel-id / data-panel-type mark the box for the layout editor, which
// reads each box's rectangle (editBridge.js). data-hover is the editor's
// hover highlight: a 1 px inset outline and nothing else.

function r3(n) {
  return Math.round(n * 1000) / 1000
}

export default function SpecPanel({ panel, textScale = 1, join = null, hover = false, children }) {
  const { id, type, x, y, w, h, z, props } = panel
  const t = panelType(type)
  const shape = t && t.padShape ? t.padShape : [1, 1]
  const pad = props.padding
  const padY = r3(shape[0] * pad)
  const padX = r3(shape[1] * pad)
  const background = props.background
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
    opacity: props.opacity,
    padding: `calc(var(--tl-pad) * ${padY}) calc(var(--tl-pad) * ${padX})`,
    '--tl-spec-pad-x': `calc(var(--tl-pad) * ${padX})`,
    '--tl-text-scale': String(textScale),
  }
  if (rounded) style.borderRadius = `${top} ${top} ${bottom} ${bottom}`

  const cls = [
    'tl-spec',
    `tl-spec--${type}`,
    `tl-spec--bg-${background}`,
    `tl-spec--align-${props.align}`,
    join && join.top ? 'tl-spec--join-top' : '',
    join && join.bottom ? 'tl-spec--join-bottom' : '',
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
      {t && t.minPx && (
        <div className="tl-panel--small" aria-hidden="true">
          Too small
        </div>
      )}
    </div>
  )
}
