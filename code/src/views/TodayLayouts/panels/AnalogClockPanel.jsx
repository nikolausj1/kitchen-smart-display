import { memo, useEffect, useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import { knobDefaults, panelKnobs } from './schemas.js'
import { handAngles, msToNextSecond } from '../lib/clocks.js'
import './AnalogClockPanel.css'

// AnalogClockPanel - an analog clock face in a box of a spec layout
// (docs/designs/panels-and-controls.md, chunk 4). One SVG, 200 units across,
// scaled to the box's shorter side (preserveAspectRatio "meet") and placed by
// the box's align (left, centre, right) and valign (bottom; top is the face
// centred, as designed).
//
// knobs (panels/schemas.js 'analog'):
//   style        'minimal' (a mark every hour, heavier at the quarters),
//                'classic' (minute marks too, and tapered hands), 'numerals'
//                (1 to 12, with small hour marks)
//   showSeconds  a seconds hand, in whole seconds
//   handColor    'auto' (the text colour, the seconds hand in the accent),
//                'accent' or 'text' (every hand)
//   faceOpacity  the face, 0 to 1: the layout's card (--tl-spec-card) with
//                its hairline, so a fresh clock reads as a round card
//
// Time: the layout's `now` (useTodayData, 1 Hz). The one exception, as the
// chunk allows: with the seconds hand on, the clock also ticks itself once a
// second, a hair past each second, so the hand lands on the second and in
// step. useTodayData's own tick keeps whatever phase it started with, so a
// hand driven by it alone would tick a fixed fraction late and, near a
// second's edge, now and then skip or stall. The later of the two readings
// wins. With the hand off, nothing of its own runs.
//
// The face and the marks never change with the time and are memoised; only
// the hands' rotations move. No transition: a hand passing 12 would spin
// back the long way.

const STYLES = ['minimal', 'classic', 'numerals']
const HAND_COLORS = ['auto', 'accent', 'text']

// Round to 2 decimals: stable attribute strings.
function r2(n) {
  return Math.round(n * 100) / 100
}

// A mark on a radius, from r1 to r2 at the angle of `step` sixtieths.
function mark(step, from, to) {
  const a = (step * Math.PI) / 30
  const s = Math.sin(a)
  const c = -Math.cos(a)
  return { x1: r2(s * from), y1: r2(c * from), x2: r2(s * to), y2: r2(c * to) }
}

// The marks of each style: [{ x1, y1, x2, y2, cls }]. Every hour has one,
// the quarters heavier; the classic face adds the minutes.
function marksOf(style) {
  const out = []
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0
    const quarter = i % 15 === 0
    if (style === 'numerals') {
      if (hour) out.push({ ...mark(i, quarter ? 84 : 86, 92), cls: quarter ? 'q' : 'h' })
    } else if (style === 'minimal') {
      if (hour) out.push({ ...mark(i, quarter ? 74 : 80, 90), cls: quarter ? 'q' : 'h' })
    } else if (hour) {
      out.push({ ...mark(i, quarter ? 72 : 78, 90), cls: quarter ? 'q' : 'h' })
    } else {
      out.push({ ...mark(i, 85, 90), cls: 'm' })
    }
  }
  return out
}

const MARKS = STYLES.reduce((acc, s) => {
  acc[s] = marksOf(s)
  return acc
}, {})

// The numerals' centres, 1 to 12, on a radius of 70.
const NUMERALS = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1
  const a = (n * Math.PI) / 6
  return { n, x: r2(Math.sin(a) * 70), y: r2(-Math.cos(a) * 70) }
})

// The hands, pointing at 12 (up, -y), each with a short tail past the
// centre. classic: blades widest at the centre, tapering to a point and to a
// narrower tail; the others: rounded bars.
const HANDS = {
  classic: {
    hour: 'M -2 12 L -4 0 L -2.6 -44 L 0 -50 L 2.6 -44 L 4 0 L 2 12 Z',
    minute: 'M -1.5 14 L -3 0 L -1.7 -70 L 0 -76 L 1.7 -70 L 3 0 L 1.5 14 Z',
  },
  bar: {
    hour: { y1: 9, y2: -46, w: 6 },
    minute: { y1: 11, y2: -72, w: 4 },
  },
  numerals: {
    hour: { y1: 8, y2: -40, w: 6 },
    minute: { y1: 10, y2: -60, w: 4 },
  },
}

// The face: the disc and the marks (and the numerals), static per style.
const Face = memo(function Face({ style, faceOpacity }) {
  const marks = MARKS[style] || MARKS.classic
  return (
    <>
      <g className="tl-analog__face" data-edit="face">
        <circle className="tl-analog__disc" r="97" style={faceOpacity < 1 ? { opacity: faceOpacity } : undefined} />
        {marks.map((m, i) => (
          <line key={i} className={`tl-analog__mark tl-analog__mark--${m.cls}`} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />
        ))}
      </g>
      {style === 'numerals' && (
        <g className="tl-analog__numerals" data-edit="numerals">
          {NUMERALS.map((p) => (
            <text key={p.n} className="tl-analog__num" x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central">
              {p.n}
            </text>
          ))}
        </g>
      )}
    </>
  )
})

function Bar({ cls, hand }) {
  return <line className={`tl-analog__hand ${cls}`} x1="0" y1={hand.y1} x2="0" y2={hand.y2} strokeWidth={hand.w} />
}

// A once-a-second tick of its own while `on`, a hair past each second
// (msToNextSecond), or null. new Date() only in the effect's timer, never in
// render (the React Compiler purity rule).
function useSecondTick(on) {
  const [tick, setTick] = useState(null)
  useEffect(() => {
    if (!on) return undefined
    let timer = 0
    const run = () => {
      const d = new Date()
      setTick(d)
      timer = setTimeout(run, msToNextSecond(d))
    }
    timer = setTimeout(run, msToNextSecond(new Date()))
    return () => clearTimeout(timer)
  }, [on])
  return on ? tick : null
}

function isDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

// preserveAspectRatio from the box's align and valign.
function placement(align, valign) {
  const x = align === 'start' ? 'xMin' : align === 'end' ? 'xMax' : 'xMid'
  const y = valign === 'bottom' ? 'YMax' : 'YMid'
  return `${x}${y} meet`
}

export default function AnalogClockPanel({ now, knobs, align = 'center', valign = 'top' }) {
  const k = panelKnobs('analog', knobs) || knobDefaults('analog')
  const style = STYLES.indexOf(k.style) >= 0 ? k.style : 'classic'
  const handColor = HAND_COLORS.indexOf(k.handColor) >= 0 ? k.handColor : 'auto'
  const seconds = !!k.showSeconds
  const faceOpacity = Number.isFinite(k.faceOpacity) ? Math.max(0, Math.min(1, k.faceOpacity)) : 1
  const tick = useSecondTick(seconds)
  // The later reading: the tick lands just past each second, `now` whenever
  // the layout's own second comes round.
  const time = isDate(tick) && (!isDate(now) || tick.getTime() > now.getTime()) ? tick : now
  const a = handAngles(time)
  const label = isDate(time)
    ? `${time.getHours() % 12 || 12}:${String(time.getMinutes()).padStart(2, '0')} ${time.getHours() < 12 ? 'AM' : 'PM'}`
    : 'No time'
  const bars = style === 'numerals' ? HANDS.numerals : HANDS.bar

  return (
    <PanelFrame
      title={null}
      className={`tl-analog tl-analog--${style} tl-analog--hands-${handColor} tl-knobs`}
      bodyClassName="tl-analog__body"
    >
      <svg className="tl-analog__svg" viewBox="-100 -100 200 200" preserveAspectRatio={placement(align, valign)} role="img" aria-label={label}>
        <Face style={style} faceOpacity={faceOpacity} />
        <g className="tl-analog__hands" data-edit="hands">
          <g transform={`rotate(${a.hour})`}>
            {style === 'classic' ? (
              <path className="tl-analog__hand tl-analog__hand--hour" d={HANDS.classic.hour} />
            ) : (
              <Bar cls="tl-analog__hand--hour" hand={bars.hour} />
            )}
          </g>
          <g transform={`rotate(${a.minute})`}>
            {style === 'classic' ? (
              <path className="tl-analog__hand tl-analog__hand--minute" d={HANDS.classic.minute} />
            ) : (
              <Bar cls="tl-analog__hand--minute" hand={bars.minute} />
            )}
          </g>
          {seconds && (
            <g className="tl-analog__sec" transform={`rotate(${a.second})`}>
              <line className="tl-analog__hand tl-analog__hand--second" x1="0" y1="18" x2="0" y2="-84" />
              <circle className="tl-analog__hand--second-dot" cx="0" cy="13" r="3" />
            </g>
          )}
          <circle className="tl-analog__cap" r={seconds ? 4 : 5} />
        </g>
      </svg>
    </PanelFrame>
  )
}
