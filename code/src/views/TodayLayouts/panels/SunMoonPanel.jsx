import PanelFrame from './PanelFrame.jsx'
import { fmtClock } from '../lib/format.js'
import './SunMoonPanel.css'

// Where the sun is in the day, and what the moon is doing tonight. The arc is
// the shape of the daylight, not a chart: a dashed path from sunrise to sunset
// with a lit dot sitting on today's position.

// The dashed track is a quadratic Bezier through the two horizon points. The
// same three points are used by the SVG path below and by the dot maths, so
// the dot always lands exactly on the curve.
const ARC = {
  p0: [2, 40],
  p1: [50, -30],
  p2: [98, 40],
  boxH: 44, // viewBox height; the horizon sits at y=40, night dots at y=42
  night: 42,
}

function msOf(d) {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null
}

// Local twin of lib/sun.js sunProgress(): the fraction of daylight elapsed, or
// null outside daylight. Kept in the panel so it stands alone in any layout.
function daylightFraction(now, sunrise, sunset) {
  const t = msOf(now)
  const a = msOf(sunrise)
  const b = msOf(sunset)
  if (t == null || a == null || b == null || b <= a) return null
  if (t < a || t > b) return null
  return (t - a) / (b - a)
}

function arcPoint(f) {
  const u = 1 - f
  const [ax, ay] = ARC.p0
  const [bx, by] = ARC.p1
  const [cx, cy] = ARC.p2
  return {
    x: u * u * ax + 2 * u * f * bx + f * f * cx,
    y: u * u * ay + 2 * u * f * by + f * f * cy,
  }
}

// The lit limb of the moon: the outer semicircle on the lit side, then half of
// the terminator ellipse back to the top. phase 0 = new, 0.25 = first quarter
// (lit on the right), 0.5 = full, 0.75 = last quarter (lit on the left).
function moonLitPath(phase, cx, cy, r) {
  if (!Number.isFinite(phase)) return null
  const p = ((phase % 1) + 1) % 1
  const t = Math.cos(2 * Math.PI * p) // +1 at new, -1 at full
  const waxing = p < 0.5
  const rx = Math.abs(t) * r
  // Where the terminator crosses the horizontal diameter: on the lit side for
  // a crescent, on the dark side for a gibbous.
  const xm = cx + (waxing ? 1 : -1) * t * r
  const limbSweep = waxing ? 1 : 0
  const termSweep = xm > cx ? 0 : 1
  const top = `${cx} ${cy - r}`
  const bottom = `${cx} ${cy + r}`
  return `M${top} A${r} ${r} 0 0 ${limbSweep} ${bottom} A${rx.toFixed(3)} ${r} 0 0 ${termSweep} ${top} Z`
}

export default function SunMoonPanel({ now, sunrise, sunset, moon }) {
  const riseMs = msOf(sunrise)
  const setMs = msOf(sunset)
  const nowMs = msOf(now)
  const hasSun = riseMs != null || setMs != null
  const hasMoon = moon != null && (moon.label || Number.isFinite(moon.phase))

  const fraction = daylightFraction(now, sunrise, sunset)
  let dot = null
  if (fraction != null) {
    const { x, y } = arcPoint(fraction)
    dot = { x, y, up: true }
  } else if (nowMs != null && riseMs != null && setMs != null) {
    // Sun is down: park it faintly on the side of the horizon it is on.
    dot = { x: nowMs < riseMs ? 3 : 97, y: ARC.night, up: false }
  }

  const litPath = hasMoon ? moonLitPath(moon.phase, 12, 12, 10) : null
  const illum = moon != null && Number.isFinite(moon.illumination)
    ? Math.round(moon.illumination * 100)
    : null

  return (
    <PanelFrame title="Sun & moon" className="tl-sun" bodyClassName="tl-sun__body">
      {!hasSun && !hasMoon ? (
        <div className="tl-sun__empty">No sun data yet</div>
      ) : (
        <div className="tl-sun__row">
          <div className="tl-sun__arc">
            <div className="tl-sun__sky">
              {/* preserveAspectRatio="none" so the arc always spans the cell;
                  the dot is a real round element on top, so nothing that is
                  meant to be circular gets stretched with it. */}
              <svg
                className="tl-sun__svg"
                viewBox="0 0 100 44"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path className="tl-sun__horizon" d="M0 40 H100" vectorEffect="non-scaling-stroke" />
                <path
                  className="tl-sun__track"
                  d="M2 40 Q 50 -30 98 40"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              {dot && (
                <span
                  className={`tl-sun__dot${dot.up ? '' : ' tl-sun__dot--down'}`}
                  style={{ left: `${dot.x}%`, top: `${(dot.y / ARC.boxH) * 100}%` }}
                />
              )}
            </div>
            <div className="tl-sun__times">
              <div className="tl-sun__time">
                <div className="tl-label">Sunrise</div>
                <div className="tl-sun__clock tl-num">{riseMs == null ? '--' : fmtClock(sunrise)}</div>
              </div>
              <div className="tl-sun__time tl-sun__time--end">
                <div className="tl-label">Sunset</div>
                <div className="tl-sun__clock tl-num">{setMs == null ? '--' : fmtClock(sunset)}</div>
              </div>
            </div>
          </div>

          {hasMoon && (
            <div className="tl-sun__moon">
              <svg className="tl-sun__moon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="tl-sun__moon-disc" cx="12" cy="12" r="10" />
                {litPath && <path className="tl-sun__moon-lit" d={litPath} />}
              </svg>
              <div className="tl-sun__moon-label">{moon.label || 'Moon'}</div>
              {illum != null && <div className="tl-sun__moon-lit-pct tl-num">{illum}% lit</div>}
            </div>
          )}
        </div>
      )}
    </PanelFrame>
  )
}
