import { DEFAULT_PHASE, clampPhase, moonLitPath, moonPhaseName } from './moonGeometry.js'

// MoonGlyph - the moon at its phase, drawn the way the weather icons draw the
// sun (public/icons/weather): the sun's orange, the width of the sun's ring.
// The lit part is solid, bounded by the limb and the terminator
// (moonGeometry.js moonLitPath: lit on the right while waxing, on the left
// while waning); the dark part is a faint outline of the disc, so a new moon
// is still a circle.
//
//   <MoonGlyph phase={0.625} size={40} />
//     the moon on its own, a square <svg> `size` px wide, or filling its box
//     (width and height 100%, display block) when size is omitted. `label`
//     names it for a screen reader ('Waning gibbous' unless given; false
//     hides it).
//   <MoonShape phase cx cy r />
//     the same drawing as SVG elements, for inside another <svg>: the night
//     skies of components/WeatherIcon draw it behind their clouds.
//
// phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter, 1 new
// again (the hub's scale, GET /api/weather). Missing or not a number: a
// waxing crescent (DEFAULT_PHASE); outside 0..1: held to the nearer end.

// The weather icons' sun orange, written out rather than read from the icons'
// `var(--fill-0, ...)` hook: an inline drawing would pick that variable up
// from the page, and no day icon (an <img>) ever can.
export const MOON_COLOR = '#FEB338'
// The dark part's outline, a faint copy of the lit colour: at half strength
// it still closes the circle over a photo and on the light page, and stays
// well below the lit part (0.35 vanished over a photo at the time widget's
// size; 0.65 read as a second ring).
export const MOON_DARK_OPACITY = 0.5
// The outline's width in the icons' own units: clear.svg's sun ring, 31.4 out
// and 26.7 in.
export const MOON_RING = 4.7

export function MoonShape({ phase, cx, cy, r, ring = MOON_RING, color = MOON_COLOR }) {
  const p = clampPhase(phase)
  const d = moonLitPath(p == null ? DEFAULT_PHASE : p, cx, cy, r)
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r - ring / 2}
        fill="none"
        stroke={color}
        strokeOpacity={MOON_DARK_OPACITY}
        strokeWidth={ring}
      />
      <path d={d} fill={color} />
    </g>
  )
}

// The standalone glyph's box: the moon filling it but for the ring's
// breathing room, the ring the same share of the moon as in clear-night.
const BOX = 100
const R = 46
const RING = (MOON_RING / 42) * R

export default function MoonGlyph({ phase, size, label, className, color = MOON_COLOR }) {
  const p = clampPhase(phase)
  const shown = p == null ? DEFAULT_PHASE : p
  const name = label === undefined ? moonPhaseName(shown) : label
  const dim = typeof size === 'number' && size > 0 ? size : '100%'
  return (
    <svg
      className={className}
      width={dim}
      height={dim}
      viewBox={`0 0 ${BOX} ${BOX}`}
      style={{ display: 'block' }}
      {...(name ? { role: 'img', 'aria-label': name } : { 'aria-hidden': 'true' })}
    >
      <MoonShape phase={shown} cx={BOX / 2} cy={BOX / 2} r={R} ring={RING} color={color} />
    </svg>
  )
}
