import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PanelFrame from './PanelFrame.jsx'
import './PhotoPanel.css'

// PhotoPanel - the slideshow, as a tile on the Board and full-bleed in Ambient.
//
// Two things make this harder than it looks:
//
// 1. The layouts re-render every second (the `now` tick), and a fade that
//    restarted every second would never finish. So the panel is memoised, every
//    timer lives in a ref, and the advance interval only depends on values that
//    genuinely change (has-photos, interval).
// 2. React's purity rules forbid Math.random() during render, and the run has
//    to be derived during render to stay in sync with the props. So the shuffle
//    is seeded: buildRun() is a pure function of (photos, count, preferLandscape,
//    seed), and a fresh seed is only ever minted in a useState initializer or in
//    the advance timer, both of which are allowed to be impure.
//
// Crossfade technique is borrowed from views/PhotoSlideshow: two stacked layers
// that both stay mounted, with the active one at opacity 1.

const FADE_MS = 1200 // keep in step with the transition in PhotoPanel.css
const TALL_CELL_VH = 0.4 // art facts only appear on a cell at least this tall

// mulberry32: a tiny deterministic PRNG, so buildRun stays pure for a seed.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Fisher-Yates against the seeded generator.
function shuffled(list, rand) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The run of photos this cell cycles through. Deterministic for a given seed.
// When the cell is wider than it is tall and we are cropping to fill, landscapes
// come first: a portrait cropped into a letterbox tile loses everyone's heads.
function buildRun(photos, count, preferLandscape, seed) {
  if (!Array.isArray(photos) || photos.length === 0) return []
  const pool = shuffled(photos, mulberry32(seed))
  const wanted = Math.max(1, count || 1)
  if (!preferLandscape) return pool.slice(0, wanted)
  const wide = []
  const rest = []
  for (const p of pool) {
    if (p?.orientation === 'landscape') wide.push(p)
    else rest.push(p)
  }
  return wide.concat(rest).slice(0, wanted)
}

function PhotoPanel({
  photos,
  intervalMs = 20000,
  count = 12,
  fit = 'cover',
  showCounter = true,
  showCaption = true,
  className = '',
}) {
  // Impure only here, which the purity rule allows: a lazy state initializer.
  const [seed, setSeed] = useState(() => (Math.random() * 0xffffffff) >>> 0)
  // Measured cell, from a ResizeObserver. `tall` gates the art-fact line.
  const [cell, setCell] = useState({ w: 0, h: 0, tall: false })
  // frames holds the actual photo objects on each of the two layers, so a
  // reshuffle can never yank the photo that is currently fading out.
  const [pos, setPos] = useState({ active: 0, idx: 0, frames: [null, null] })

  const preferLandscape = fit === 'cover' && cell.w > cell.h

  const run = useMemo(
    () => buildRun(photos, count, preferLandscape, seed),
    [photos, count, preferLandscape, seed]
  )

  // Latest values for the advance timer to read. Written in effects (never in
  // render) so the refs rule stays happy.
  const runRef = useRef(run)
  const idxRef = useRef(0)
  const photosRef = useRef(photos)
  const countRef = useRef(count)
  const preferRef = useRef(preferLandscape)
  useEffect(() => {
    runRef.current = run
    photosRef.current = photos
    countRef.current = count
    preferRef.current = preferLandscape
  }, [run, photos, count, preferLandscape])

  const advance = useCallback(() => {
    const current = runRef.current
    if (!Array.isArray(current) || current.length === 0) return
    const curIdx = idxRef.current
    const cur = current[curIdx] || null

    let nextRun = current
    let nextIdx = curIdx + 1
    if (nextIdx >= current.length) {
      // Run exhausted: reshuffle. buildRun is deterministic, so building the new
      // run here and pushing its seed into state cannot drift from what the memo
      // produces on the next render.
      const nextSeed = (Math.random() * 0xffffffff) >>> 0
      const rebuilt = buildRun(photosRef.current, countRef.current, preferRef.current, nextSeed)
      if (rebuilt.length === 0) return
      nextRun = rebuilt
      nextIdx = 0
      runRef.current = rebuilt
      setSeed(nextSeed)
    }

    const next = nextRun[nextIdx]
    if (!next) return
    idxRef.current = nextIdx
    setPos((prev) => {
      const frames = prev.frames.slice()
      // Park the on-screen photo on the outgoing layer so the very first
      // advance has something to fade out of.
      if (!frames[prev.active] && cur) frames[prev.active] = cur
      frames[1 - prev.active] = next
      return { active: 1 - prev.active, idx: nextIdx, frames }
    })
  }, [])

  // The interval calls through a ref, so rebuilding `advance` (or the parent
  // re-rendering at 1 Hz) never restarts the clock mid-fade.
  const advanceRef = useRef(advance)
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  const hasPhotos = run.length > 0
  // intervalMs <= 0 parks the slideshow on one photo (same contract as the
  // full-screen slideshow); anything shorter than the fade is raised to it so a
  // misconfigured cell cannot leave both layers half faded.
  const paused = !(intervalMs > 0)
  const tickMs = Math.max(FADE_MS, intervalMs)
  useEffect(() => {
    if (!hasPhotos || paused) return
    const id = setInterval(() => advanceRef.current(), tickMs)
    return () => clearInterval(id)
  }, [hasPhotos, paused, tickMs])

  // Measure the cell. setState lives in the observer callback, not in the effect
  // body, and short-circuits when nothing moved so it cannot loop.
  const stageRef = useRef(null)
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect
      if (!rect) return
      const tall = rect.height >= TALL_CELL_VH * window.innerHeight
      setCell((prev) =>
        prev.w === rect.width && prev.h === rect.height && prev.tall === tall
          ? prev
          : { w: rect.width, h: rect.height, tall }
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const idx = hasPhotos ? Math.min(pos.idx, run.length - 1) : 0

  // Warm the next image so the crossfade has a decoded frame to work with. On
  // the last item of a run this preloads the wrap-around rather than whatever
  // the reshuffle will pick, which is a miss we can live with once per run.
  useEffect(() => {
    if (run.length === 0) return
    const next = run[(idx + 1) % run.length]
    if (!next?.src) return
    const img = new Image()
    img.src = next.src
  }, [run, idx])

  // Layer contents: state wins, and before the first advance the active layer
  // falls back to the head of the run so something shows at mount.
  const slot0 = pos.frames[0] || (pos.active === 0 ? run[idx] : null) || null
  const slot1 = pos.frames[1] || (pos.active === 1 ? run[idx] : null) || null
  const shown = pos.active === 0 ? slot0 : slot1

  const location = shown?.exif?.location || ''
  const date = shown?.exif?.date || ''
  const facts = Array.isArray(shown?.art?.facts) ? shown.art.facts : []
  const fact = facts.length > 0 && cell.tall ? facts[idx % facts.length] : ''
  const hasCaption = showCaption && !!(location || date || fact)

  return (
    <PanelFrame
      title={null}
      className={`tl-photo tl-photo--${fit === 'contain' ? 'contain' : 'cover'} ${className}`.trim()}
      bodyClassName="tl-photo__body"
    >
      <div className="tl-photo__stage" ref={stageRef}>
        {[slot0, slot1].map((photo, i) => (
          <div
            key={i}
            className={`tl-photo__layer${i === pos.active ? ' tl-photo__layer--active' : ''}`}
          >
            {photo?.src && <img src={photo.src} alt="" draggable="false" />}
          </div>
        ))}

        {!hasPhotos && <div className="tl-photo__empty">No photos</div>}

        {hasPhotos && showCounter && (
          <div className="tl-photo__counter tl-num">
            {idx + 1}/{run.length}
          </div>
        )}

        {hasCaption && (
          <div className="tl-photo__caption">
            {location && <div className="tl-photo__caption-line">{location}</div>}
            {date && <div className="tl-photo__caption-sub">{date}</div>}
            {fact && <div className="tl-photo__caption-fact">{fact}</div>}
          </div>
        )}
      </div>
    </PanelFrame>
  )
}

// The parent re-renders every second. Compare photos by identity (the manifest
// hook hands back a stable array between fetches) and the rest by value, so a
// tick alone never reaches this component.
function propsEqual(prev, next) {
  return (
    prev.photos === next.photos &&
    prev.intervalMs === next.intervalMs &&
    prev.count === next.count &&
    prev.fit === next.fit &&
    prev.showCounter === next.showCounter &&
    prev.showCaption === next.showCaption &&
    prev.className === next.className
  )
}

export default memo(PhotoPanel, propsEqual)
