import { shapeLine } from '../Entry/specStyles.js'
import './ShapeBlock.css'

// ShapeBlock - a shape on a board: a card behind a group of panels, a band of
// colour, a divider (docs/designs/panels-and-controls.md, chunk 4). A
// layout-spec block (layoutSpec.js type 'shape': any number, ids
// 'shape-<4 hex>'), with no content of its own.
//
// A rectangle is its box: the box v2 fill, gradient, opacity, border, shadow,
// blur and radius, drawn by Entry/SpecPanel from Entry/specStyles.js boxLook
// with the shape's fill colour (fillPreset: the card, the accent, or the
// box's own fill colour). So for a rectangle this draws nothing.
//
// A line (kind 'line') is a 2 px line across the middle of the box, in the
// fill colour at the fill opacity, with the box's shadow; the gradient,
// border and blur are for rectangles (specStyles.js shapeLine).
//
// props: the box's props, normalized (layoutSpec.js).
export default function ShapeBlock({ props }) {
  const line = shapeLine(props)
  return (
    <div className="tl-shape" aria-hidden="true">
      {line && <div className="tl-shape__line" style={line} />}
    </div>
  )
}
