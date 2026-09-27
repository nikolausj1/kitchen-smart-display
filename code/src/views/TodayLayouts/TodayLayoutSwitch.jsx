import { useEffect, useRef, useState } from 'react'
import TodayView from '../TodayView/TodayView.jsx'
import AmbientLayout from './Ambient/AmbientLayout.jsx'
import BoardLayout from './Board/BoardLayout.jsx'
import BriefingLayout from './Briefing/BriefingLayout.jsx'
import ClockLayout from './Clock/ClockLayout.jsx'
import EntryLayout from './Entry/EntryLayout.jsx'
import { READ_ONLY, swipeLayoutsOn, updateSettings, useSettings } from '../../lib/settings.js'
import { EDIT_MODE, KIOSK_TV, REQUESTED_LAYOUT } from '../../lib/kioskMode.js'
import { LAYOUT_IDS, LAYOUT_LABELS, normalizeLayoutId } from './registry.js'
import useLayoutSwipe, { stepLayout } from './useLayoutSwipe.js'
import './TodayLayoutSwitch.css'

// TodayLayoutSwitch - picks which Today to render. 'framed' is the original
// TodayView, untouched. Anything else is one of the new layouts in this
// folder. A ?layout= URL param wins for the page load without being saved.
//
// entry and board are drawn from the screen's layout spec (layoutSpec.js,
// Entry/SpecBoard.jsx); inside the layout editor's frame (?edit=1) the one on
// screen is the one the editor edits (editBridge.js reports its id).
//
// clock is the flip clock (Clock/ClockLayout.jsx).
//
// Swiping (display.swipeLayouts, on by default): a swipe to the left shows
// the next layout in registry.js LAYOUT_IDS, to the right the previous one,
// wrapping at the ends (useLayoutSwipe.js decides what counts as a swipe).
// The old layout slides out and the new one in, a pill at the bottom names
// it for 1.5 s, and the choice is saved as this screen's display.todayLayout
// through updateSettings(), exactly as the Settings select saves it, so it
// holds after a reload and shows on the dashboard. A swipe during a slide is
// ignored. A swipe also ends a ?layout= preview: the screen then shows, and
// keeps, what it was swiped to. Reduced motion swaps without the slide.
// Not in the layout editor's preview (it must never change a screen's
// settings) and not on the legacy web TV (a remote, no finger): there the
// layout renders bare, as before. A dimmed or sleeping screen needs no rule
// here: DimOverlay (and the Echo's start gate) sit above this and take the
// touch that wakes it, so that touch never reaches the gesture.

const LAYOUTS = {
  board: BoardLayout,
  briefing: BriefingLayout,
  ambient: AmbientLayout,
  entry: EntryLayout,
  clock: ClockLayout,
}

const SWIPE_SURFACE = !EDIT_MODE && !READ_ONLY && !KIOSK_TV
// The slide, as in TodayLayoutSwitch.css. The timer is only the fallback for
// an animationend that never comes (an animation cut by CSS, say).
const SLIDE_MS = 260
const SLIDE_FALLBACK_MS = SLIDE_MS + 400
const PILL_MS = 1500

function renderLayout(id) {
  const Layout = LAYOUTS[id]
  if (!Layout) return <TodayView />
  return <Layout />
}

// The pill's name for a layout: its Settings label without the aside
// ("Framed (original)" reads "Framed").
function pillLabel(id) {
  return String(LAYOUT_LABELS[id] || id).replace(/\s*\(.*\)\s*$/, '')
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

export default function TodayLayoutSwitch() {
  const { display } = useSettings()
  if (!SWIPE_SURFACE) return renderLayout(normalizeLayoutId(REQUESTED_LAYOUT || display?.todayLayout))
  return <SwipeableToday display={display} />
}

function SwipeableToday({ display }) {
  const rootRef = useRef(null)
  // A swipe ends a ?layout= preview (see above).
  const [previewEnded, setPreviewEnded] = useState(false)
  const id = normalizeLayoutId((!previewEnded && REQUESTED_LAYOUT) || display?.todayLayout)
  const enabled = swipeLayoutsOn(display?.swipeLayouts)
  // { from, to, dir } while the two layouts slide, else null.
  const [slide, setSlide] = useState(null)
  // { id, n } while the pill shows; n restarts its fade on a quick second swipe.
  const [pill, setPill] = useState(null)

  function onSwipe(dir) {
    if (slide) return // mid-slide: ignored
    const to = stepLayout(LAYOUT_IDS, id, dir)
    if (to === id) return
    setPreviewEnded(true)
    if (!prefersReducedMotion()) setSlide({ from: id, to, dir })
    setPill((p) => ({ id: to, n: p ? p.n + 1 : 1 }))
    updateSettings({ display: { todayLayout: to } })
  }
  useLayoutSwipe(rootRef, { enabled, onSwipe })

  useEffect(() => {
    if (!slide) return undefined
    const t = setTimeout(() => setSlide(null), SLIDE_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [slide])

  useEffect(() => {
    if (!pill) return undefined
    const t = setTimeout(() => setPill(null), PILL_MS)
    return () => clearTimeout(t)
  }, [pill])

  // Only the incoming pane's own animation ends the slide; the layouts'
  // animations (the flip clock's cards) bubble animationend too.
  function onPaneAnimationEnd(e) {
    if (e.target === e.currentTarget) setSlide(null)
  }

  // Keyed by layout id, so the layout on screen stays mounted as it becomes
  // the outgoing pane, and the incoming one stays mounted when the slide ends.
  const panes = slide ? [slide.from, slide.to] : [id]
  return (
    <div ref={rootRef} className={`tl-swipe${enabled ? ' tl-swipe--on' : ''}`}>
      {panes.map((pid) => {
        const leaving = !!slide && pid === slide.from
        const entering = !!slide && pid === slide.to
        let cls = 'tl-swipe__pane'
        if (leaving) cls += ` tl-swipe__pane--out tl-swipe__pane--out-${slide.dir}`
        if (entering) cls += ` tl-swipe__pane--in-${slide.dir}`
        return (
          <div
            key={pid}
            className={cls}
            aria-hidden={leaving ? 'true' : undefined}
            onAnimationEnd={entering ? onPaneAnimationEnd : undefined}
          >
            {renderLayout(pid)}
          </div>
        )
      })}
      {pill && (
        <div key={pill.n} className="tl-swipe__pill" role="status">
          {pillLabel(pill.id)}
        </div>
      )}
    </div>
  )
}
