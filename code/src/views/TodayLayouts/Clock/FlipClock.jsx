import { Fragment, memo, useEffect, useState } from 'react'
// Inter 800, latin subset only. main.jsx ships 400/600/700, and a rule asking
// for 800 would silently render at 700; a split-flap numeral wants the
// heaviest cut. One more face of a font we already ship, and the latin subset
// is all a clock (digits, AM, PM) can use.
import '@fontsource/inter/latin-800.css'
// Fraunces for the date line. The `full` cut on purpose: it is the module the
// Briefing already imports, so the bundle carries one Fraunces @font-face, not
// two declarations of the same family pointing at different files.
import '@fontsource-variable/fraunces/full.css'
import { fmtDayShort } from '../lib/format.js'
import './FlipClock.css'

// FlipClock - a split-flap clock: one wide hour card, a colon, two minute
// cards, an AM / PM tab on the hour card's left edge, and the date underneath.
//
// Props: now (a Date; the only clock it reads), hour24 (00..23 and no tab),
// showMeridiem (the AM / PM tab on a 12-hour clock; off leaves a bare 1..12),
// showDate. Everything is sized from one variable, --tl-flip-u (the card
// height), which FlipClock.css derives from the viewport; a host that wants the
// clock in a box (a layout editor panel) overrides that one variable with
// container units and nothing else changes: the Flip clock panel
// (panels/FlipClockPanel.jsx) does.
//
// Its parts carry the layout editor's data-edit keys (panels/schemas.js
// PANEL_ELEMENTS 'flipclock'): hour (the hour card), minutes, tab and date.
// Outside a spec layout they are plain attributes and change nothing.
//
// How a card flips. Each card is two static halves plus, only while it flips,
// one leaf: the old digit's top half on its front, the new digit's bottom half
// on its back. When the value changes the static top already shows the new
// top (hidden under the leaf) and the static bottom keeps the old bottom; the
// leaf turns 180 degrees down about the split line, and when it lands its back
// face sits exactly where the static bottom is, so the settle (static bottom
// -> new, leaf unmounted) is invisible. Only transform and opacity animate;
// nothing changes size, so a flip never touches layout. Cards are memoised, so
// the host's 1 Hz tick (if it has one) re-renders none of them between flips.

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Must match --tl-flip-ms in FlipClock.css. Used only by the settle fallback.
const FLIP_MS = 600
// The leaf's animationend settles a flip. This timer is the backstop for an
// animation that never reports (an element hidden mid-flip does not finish),
// set well past the end so it can never cut a running flip short.
const SETTLE_BACKSTOP_MS = 1000
// The face a card flips from when it first mounts: a blank card, so the first
// paint is the clock arriving, not digits appearing from nowhere.
const BLANK = ''
// The mount flip runs left to right, a beat apart, like a board powering up.
const MOUNT_DELAY_MS = { tab: 0, hour: 70, tens: 170, ones: 270 }

function isDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

// What each card shows. Pure: reads only the Date it is handed. No time is the
// honest empty state, dashes on the cards and a blank tab, never a made-up hour.
function readTime(now, hour24) {
  if (!isDate(now)) {
    return { hour: '--', tens: '-', ones: '-', meridiem: hour24 ? null : BLANK, label: 'No time' }
  }
  const h = now.getHours()
  const m = now.getMinutes()
  const hour = hour24 ? String(h).padStart(2, '0') : String(h % 12 || 12)
  const tens = String(Math.floor(m / 10))
  const ones = String(m % 10)
  const meridiem = hour24 ? null : h < 12 ? 'AM' : 'PM'
  return { hour, tens, ones, meridiem, label: `${hour}:${tens}${ones}${meridiem ? ` ${meridiem}` : ''}` }
}

// 'Mon, Apr 28, 2026'. FlipClock.css sets it in capitals; the text itself
// stays in title case so a screen reader says "Monday", not "M-O-N".
function dateLine(now) {
  if (!isDate(now)) return ''
  return `${fmtDayShort(now)}, ${MONTH_SHORT[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`
}

// One half of a card face. The glyph box is the full card height, pinned to
// the half's outer edge, so each half shows its half of one centred glyph.
function Half({ pos, value, face = false }) {
  return (
    <div className={`tl-flip__half tl-flip__half--${pos}${face ? ' tl-flip__face' : ''}`}>
      <span className="tl-flip__glyph">{value}</span>
    </div>
  )
}

const FlipCard = memo(function FlipCard({ kind, value, mountDelayMs = 0 }) {
  // shown: the value the card is showing or flipping to. from: the value it is
  // flipping from, or null when it is at rest. n: flips so far, which keys the
  // leaf so every flip mounts a fresh element and its animation starts over.
  const [flip, setFlip] = useState({ shown: value, from: BLANK, n: 0 })

  // A new value starts a flip from whatever the card shows now. State adjusted
  // during render (the documented pattern for reacting to a prop change), not
  // in an effect, so the frame that shows the new top also mounts the leaf
  // that covers it: there is never a frame with the new digit half-revealed.
  if (flip.shown !== value) {
    setFlip({ shown: value, from: flip.shown, n: flip.n + 1 })
  }

  const { from, n } = flip
  const flipping = from !== null
  const delayMs = n === 0 ? mountDelayMs : 0

  useEffect(() => {
    if (!flipping) return undefined
    const id = setTimeout(() => {
      setFlip((f) => (f.n === n ? { ...f, from: null } : f))
    }, delayMs + FLIP_MS + SETTLE_BACKSTOP_MS)
    return () => clearTimeout(id)
  }, [flipping, n, delayMs])

  // Only the leaf's own turn settles the card; the faces' shading animations
  // bubble their animationend through here too and are ignored.
  const settle = (e) => {
    if (e.target !== e.currentTarget) return
    setFlip((f) => (f.n === n ? { ...f, from: null } : f))
  }

  const style = flipping && delayMs ? { '--tl-flip-delay': `${delayMs}ms` } : undefined

  return (
    <div className={`tl-flip__card tl-flip__card--${kind}`} style={style}>
      <Half pos="top" value={value} />
      <Half pos="bottom" value={flipping ? from : value} />
      {flipping && (
        <Fragment key={n}>
          <div className="tl-flip__shade tl-flip__shade--top" />
          <div className="tl-flip__shade tl-flip__shade--bottom" />
          <div className="tl-flip__leaf" onAnimationEnd={settle}>
            <Half pos="top" value={from} face />
            <Half pos="bottom" value={value} face />
          </div>
        </Fragment>
      )}
    </div>
  )
})

// The hinge pins, one per outer edge of a card group, riding the split line.
function Pins() {
  return (
    <>
      <span className="tl-flip__pin tl-flip__pin--l" />
      <span className="tl-flip__pin tl-flip__pin--r" />
    </>
  )
}

export default function FlipClock({ now, hour24 = false, showMeridiem = true, showDate = true }) {
  const t = readTime(now, hour24)
  const date = showDate ? dateLine(now) : ''
  // The label keeps AM / PM either way: a screen reader still wants it.
  const tab = showMeridiem && t.meridiem !== null

  return (
    <div className={`tl-flip${t.meridiem === null ? ' tl-flip--24h' : ''}`}>
      <div className="tl-flip__row" role="img" aria-label={t.label}>
        <div className="tl-flip__unit tl-flip__unit--hour">
          {tab && (
            <div className="tl-flip__tab" data-edit="tab">
              <FlipCard kind="tab" value={t.meridiem} mountDelayMs={MOUNT_DELAY_MS.tab} />
            </div>
          )}
          <div className="tl-flip__cards" data-edit="hour">
            <FlipCard kind="hour" value={t.hour} mountDelayMs={MOUNT_DELAY_MS.hour} />
            <Pins />
          </div>
        </div>

        <div className="tl-flip__colon">
          <span className="tl-flip__dot" />
          <span className="tl-flip__dot tl-flip__dot--low" />
        </div>

        <div className="tl-flip__unit tl-flip__unit--minutes" data-edit="minutes">
          <div className="tl-flip__cards">
            <FlipCard kind="digit" value={t.tens} mountDelayMs={MOUNT_DELAY_MS.tens} />
            <FlipCard kind="digit" value={t.ones} mountDelayMs={MOUNT_DELAY_MS.ones} />
            <Pins />
          </div>
        </div>
      </div>

      {date && (
        <div className="tl-flip__date" data-edit="date">
          {date}
        </div>
      )}
    </div>
  )
}
