import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useImmichPhotos from '../../hooks/useImmichPhotos.js'
import { useSettings, postPhotoFlag } from '../../lib/settings.js'
import TimeWidget from './overlays/TimeWidget.jsx'
import ExifCaption from './overlays/ExifCaption.jsx'
import AlbumArtWidget from './overlays/AlbumArtWidget.jsx'
import FlagToast from './overlays/FlagToast.jsx'
import './PhotoSlideshow.css'

// Fisher-Yates shuffle (returns a new array).
function shuffle(arr) {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function orderPhotos(photos, sortOrder) {
  if (!photos) return null
  switch (sortOrder) {
    case 'random':
      return shuffle(photos)
    case 'date-added':
      return photos.slice().sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
    case 'date-taken':
    default:
      // Manifest is already sorted oldest -> newest by date taken.
      return photos.slice()
  }
}

const PORTRAIT_BUFFER_FALLBACK_AFTER_N_ADVANCES = 40

// Compute the next display item, mutating refs that hold the queue cursor
// and the portrait buffer. The "display item" is either a single landscape
// photo, a pair of portraits side-by-side, or a single portrait shown
// centered with a blurred background.
//
// Per spec: as photos come in we buffer portraits and emit them in pairs.
// A portrait that has waited longer than 40 advances comes out solo so it
// is not held forever.
function pickNextDisplay({ photos, queueIndexRef, portraitBufferRef, advanceCountRef }) {
  if (!photos || photos.length === 0) return null

  // Each loop iteration either returns a display or reads one more photo
  // from the queue. Guard so we never spin forever if the queue is entirely
  // portraits and the buffer can't form a pair yet.
  let safety = photos.length * 2 + 4

  while (safety-- > 0) {
    const buf = portraitBufferRef.current

    // If two portraits are buffered, emit them as a pair.
    if (buf.length >= 2) {
      const a = buf.shift()
      const b = buf.shift()
      advanceCountRef.current += 1
      return { kind: 'portrait-pair', photos: [a.photo, b.photo] }
    }

    // If one portrait has been waiting too long, emit it solo.
    if (buf.length === 1) {
      const waited = advanceCountRef.current - buf[0].arrivedAt
      if (waited >= PORTRAIT_BUFFER_FALLBACK_AFTER_N_ADVANCES) {
        const lone = buf.shift()
        advanceCountRef.current += 1
        return { kind: 'portrait-solo', photos: [lone.photo] }
      }
    }

    // Pull the next photo from the queue.
    const next = photos[queueIndexRef.current % photos.length]
    queueIndexRef.current += 1

    if (next.orientation === 'landscape') {
      advanceCountRef.current += 1
      return { kind: 'landscape', photos: [next] }
    } else {
      // Portrait: park it in the buffer and continue the loop. On the next
      // iteration the buffer may now be a pair, or we read another photo.
      portraitBufferRef.current.push({ photo: next, arrivedAt: advanceCountRef.current })
      // do not increment advance count - this photo is not on screen yet
    }
  }
  return null
}

// When Smart Faces is on AND the photo has detected faces that fit the
// cover-crop window, we let crop-loss go this high before falling back to
// Fit. Higher than the default 15% smart threshold because we know we
// aren't cutting anyone's face off.
const SMART_FACES_CROP_LOSS_MAX = 0.40

// Crop loss = fraction of the photo's area that would be hidden if drawn
// with object-fit: cover into the given container aspect ratio.
function coverCropLoss(photoW, photoH, containerW, containerH) {
  if (!photoW || !photoH || !containerW || !containerH) return 0
  const photoAR = photoW / photoH
  const containerAR = containerW / containerH
  if (photoAR > containerAR) {
    return 1 - containerAR / photoAR
  }
  return 1 - photoAR / containerAR
}

// Compute the object-position that keeps all faces visible in a cover-crop
// of `photo` into `(containerW, containerH)`. Returns { objectPosition,
// facesFit } where facesFit=false means the face union is wider than the
// crop window and the caller should fall back to Fit.
//
// `faces` is an array of { cx, cy, w, h } normalized to [0..1] in the
// photo's own coords (manifest schema). Empty / missing -> centered.
function computeFillCrop(photoW, photoH, containerW, containerH, faces) {
  if (!faces || faces.length === 0 || !photoW || !photoH || !containerW || !containerH) {
    return { objectPosition: '50% 50%', facesFit: true }
  }
  const pA = photoW / photoH
  const cA = containerW / containerH

  // Which axis crops? Compute normalized window extent on that axis.
  let axis, wN
  if (pA > cA) {
    axis = 'x'
    wN = cA / pA  // visible window width in normalized photo-x
  } else {
    axis = 'y'
    wN = pA / cA  // visible window height in normalized photo-y
  }

  // Face union on the cropping axis.
  let minE = Infinity, maxE = -Infinity
  for (const f of faces) {
    const c = axis === 'x' ? f.cx : f.cy
    const half = axis === 'x' ? f.w / 2 : f.h / 2
    minE = Math.min(minE, c - half)
    maxE = Math.max(maxE, c + half)
  }

  // Don't fit: face union spans wider than the visible window.
  if (maxE - minE > wN + 1e-6) {
    return { objectPosition: '50% 50%', facesFit: false }
  }

  // Pick the window centered on the face union, clamped to [0, 1-wN].
  const midpoint = (minE + maxE) / 2
  const idealStart = midpoint - wN / 2
  const start = Math.max(0, Math.min(1 - wN, idealStart))

  // object-position maps the window start to the photo's overflow range
  // [0, 1-wN]. If wN ~= 1 (axis fully visible), default to 50%.
  const posPct = wN < 1 ? (start / (1 - wN)) * 100 : 50

  return {
    objectPosition: axis === 'x' ? `${posPct}% 50%` : `50% ${posPct}%`,
    facesFit: true,
  }
}

// Decide Fill vs Fit for a single photo + container, factoring in Smart
// Faces. Returns { mode: 'fill' | 'fit', objectPosition: 'X% Y%' }.
function resolveCell(photo, containerW, containerH, opts) {
  const { displayMode, smartThreshold, smartFaces } = opts
  if (displayMode === 'fill') {
    // Explicit Fill: still use face-aware positioning if we can, but never
    // bail to Fit (the user asked for Fill).
    const { objectPosition } = smartFaces
      ? computeFillCrop(photo.width, photo.height, containerW, containerH, photo.faces || [])
      : { objectPosition: '50% 50%' }
    return { mode: 'fill', objectPosition }
  }
  if (displayMode === 'fit') {
    return { mode: 'fit', objectPosition: '50% 50%' }
  }
  // 'smart' mode.
  const loss = coverCropLoss(photo.width, photo.height, containerW, containerH)
  const hasFaces = smartFaces && Array.isArray(photo.faces) && photo.faces.length > 0
  if (hasFaces) {
    const { objectPosition, facesFit } =
      computeFillCrop(photo.width, photo.height, containerW, containerH, photo.faces)
    if (!facesFit) return { mode: 'fit', objectPosition: '50% 50%' }
    return loss > SMART_FACES_CROP_LOSS_MAX
      ? { mode: 'fit', objectPosition: '50% 50%' }
      : { mode: 'fill', objectPosition }
  }
  return loss > smartThreshold
    ? { mode: 'fit', objectPosition: '50% 50%' }
    : { mode: 'fill', objectPosition: '50% 50%' }
}

// Single landscape or pair-half cell. Receives the resolved mode and an
// object-position (only meaningful for Fill).
function PhotoCell({ photo, mode, objectPosition, className }) {
  if (mode === 'fit') {
    return (
      <div className={`${className} photo-stage__cell--fit`}>
        <img className="photo-stage__blur-bg" src={photo.src} alt="" aria-hidden="true" draggable="false" />
        <div className="photo-stage__blur-overlay" aria-hidden="true" />
        <img className="photo-stage__fit-img" src={photo.src} alt="" draggable="false" />
      </div>
    )
  }
  return (
    <div className={`${className} photo-stage__cell--fill`}>
      <img
        className="photo-stage__img"
        src={photo.src}
        alt=""
        draggable="false"
        style={objectPosition ? { objectPosition } : undefined}
      />
    </div>
  )
}

function PhotoLayer({ display, displayMode, smartThreshold, smartFaces }) {
  if (!display) return null
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const opts = { displayMode, smartThreshold, smartFaces }

  if (display.kind === 'landscape') {
    const p = display.photos[0]
    const { mode, objectPosition } = resolveCell(p, vw, vh, opts)
    return (
      <div className="photo-stage photo-stage--landscape">
        <PhotoCell photo={p} mode={mode} objectPosition={objectPosition} className="photo-stage__full" />
      </div>
    )
  }
  if (display.kind === 'portrait-pair') {
    const halfW = vw / 2
    return (
      <div className="photo-stage photo-stage--pair">
        {display.photos.map((p, i) => {
          const { mode, objectPosition } = resolveCell(p, halfW, vh, opts)
          return (
            <PhotoCell
              key={i}
              photo={p}
              mode={mode}
              objectPosition={objectPosition}
              className="photo-stage__half"
            />
          )
        })}
      </div>
    )
  }
  // Portrait-solo: route through the same resolveCell logic. When Smart
  // Faces says we can Fill safely, we do; otherwise fall back to the
  // existing solo-with-blur layout.
  const p = display.photos[0]
  const { mode, objectPosition } = resolveCell(p, vw, vh, opts)
  if (mode === 'fill') {
    return (
      <div className="photo-stage photo-stage--landscape">
        <PhotoCell
          photo={p}
          mode="fill"
          objectPosition={objectPosition}
          className="photo-stage__full"
        />
      </div>
    )
  }
  return (
    <div className="photo-stage photo-stage--solo">
      <img className="photo-stage__blur-bg" src={p.src} alt="" aria-hidden="true" draggable="false" />
      <div className="photo-stage__blur-overlay" aria-hidden="true" />
      <img className="photo-stage__solo-img" src={p.src} alt="" draggable="false" />
    </div>
  )
}

export default function PhotoSlideshow() {
  const { photos: rawPhotos, loading } = useImmichPhotos()
  const { slideshow } = useSettings()
  const intervalMs = slideshow?.intervalMs ?? 6000
  const sortOrder = slideshow?.sortOrder || 'random'
  const displayMode = slideshow?.displayMode || 'smart'
  const smartThreshold = slideshow?.smartCropLossThreshold ?? 0.15
  const smartFaces = slideshow?.smartFaces !== false

  // Order the photo list per the user's sort preference. Recomputed when
  // the photo list changes or the sort changes - and a fresh shuffle each
  // time the component mounts (so navigating away + back from Photos does
  // not always start on the same image when sort='random').
  const photos = useMemo(
    () => orderPhotos(rawPhotos, sortOrder),
    [rawPhotos, sortOrder]
  )

  const queueIndexRef = useRef(0)
  const portraitBufferRef = useRef([])
  const advanceCountRef = useRef(0)
  // Reversible navigation: every shown display item is appended to `history`
  // and `cursor` is the index of the one currently on screen. next/previous
  // are cursor moves over this immutable list; only stepping past the end
  // generates a fresh item via pickNextDisplay. Ported from the tvOS
  // SlideshowEngine so back/forward are fully predictable - and a portrait
  // pair replays as the same pair (the whole display item is stored).
  const historyRef = useRef([])
  const cursorRef = useRef(-1)
  const HISTORY_MAX = 30
  // While the user is browsing backwards, suppress auto-advance for this
  // long so they have time to look at the photo they just rewound to.
  const PAUSE_AFTER_BACK_MS = 60_000
  const pausedUntilRef = useRef(0)

  // Two-layer crossfade. Both <Layer>s stay mounted; we just flip which one
  // is "active" (opacity 1) and put the new photo into the other slot. CSS
  // transitions handle the simultaneous fade in/out.
  const [layers, setLayers] = useState([null, null])
  const [activeIdx, setActiveIdx] = useState(0)
  const [tick, setTick] = useState(0) // bumps each advance so EXIF caption resets
  const [flagToast, setFlagToast] = useState(null) // brief "Flagged" confirmation

  // Swap in a new display item with the crossfade machinery. Used by both
  // forward advance and back-stack replay.
  const showItem = useCallback((next) => {
    if (!next) return
    setActiveIdx((prev) => {
      const nextIdx = 1 - prev
      setLayers((prevLayers) => {
        const updated = [...prevLayers]
        updated[nextIdx] = next
        return updated
      })
      return nextIdx
    })
    setTick((t) => t + 1)
  }, [])

  const advance = useCallback(
    (opts = {}) => {
      const { auto = false } = opts
      if (auto && Date.now() < pausedUntilRef.current) return
      if (!photos || photos.length === 0) return
      // Manual advance: extend the auto-advance pause so the next auto
      // tick fires intervalMs from now (not from whenever the last
      // auto-fired). Math.max preserves a longer back-pause if one is
      // already in effect.
      if (!auto) {
        pausedUntilRef.current = Math.max(
          pausedUntilRef.current,
          Date.now() + intervalMs
        )
      }
      // If the user had stepped back, walk forward through the existing
      // history instead of generating a new item - so back-then-forward
      // returns to the same photos, in order.
      if (cursorRef.current < historyRef.current.length - 1) {
        cursorRef.current += 1
        showItem(historyRef.current[cursorRef.current])
        return
      }
      // At the end of history: generate a fresh display item and remember it.
      const next = pickNextDisplay({
        photos,
        queueIndexRef,
        portraitBufferRef,
        advanceCountRef,
      })
      if (!next) return
      historyRef.current.push(next)
      if (historyRef.current.length > HISTORY_MAX) historyRef.current.shift()
      cursorRef.current = historyRef.current.length - 1
      showItem(next)
    },
    [photos, showItem, intervalMs]
  )

  const goBack = useCallback(() => {
    // Step the cursor back through history; the item is replayed unchanged
    // (same photo, same portrait pairing). No-op at the oldest remembered item.
    if (cursorRef.current <= 0) return
    cursorRef.current -= 1
    pausedUntilRef.current = Date.now() + PAUSE_AFTER_BACK_MS
    showItem(historyRef.current[cursorRef.current])
  }, [showItem])

  // Initial display once photos are loaded. Even for deterministic sort
  // orders (date-taken / date-added) we randomize the starting index so the
  // first photo varies between visits to the Photos tab.
  useEffect(() => {
    if (photos && photos.length > 0 && layers[0] === null && layers[1] === null) {
      queueIndexRef.current = Math.floor(Math.random() * photos.length)
      advance({ auto: false })
    }
  }, [photos, layers, advance])

  // Auto-advance every intervalMs (when > 0). The auto:true flag lets the
  // pause-after-back logic suppress the next few ticks.
  useEffect(() => {
    if (!photos || photos.length === 0) return
    if (intervalMs <= 0) return
    const id = setInterval(() => advance({ auto: true }), intervalMs)
    return () => clearInterval(id)
  }, [photos, advance, intervalMs])

  // Listen for swipe gestures (emitted by the document-level handler in
  // DebugLog.jsx). Left = next, right = previous.
  useEffect(() => {
    function onSwipe(e) {
      const dir = e.detail?.direction
      if (dir === 'left') advance({ auto: false })
      else if (dir === 'right') goBack()
    }
    window.addEventListener('app-swipe', onSwipe)
    return () => window.removeEventListener('app-swipe', onSwipe)
  }, [advance, goBack])

  // Imperative photo navigation for the tvOS shell (Siri Remote clickpad).
  // 'next' advances, 'prev' steps back. Mirrors the swipe handlers, which
  // already pause auto-advance briefly after a manual move, then resume.
  useEffect(() => {
    window.photoNav = (dir) => {
      if (dir === 'next') advance({ auto: false })
      else if (dir === 'prev') goBack()
    }
    return () => {
      if (window.photoNav) delete window.photoNav
    }
  }, [advance, goBack])

  // Long-press flags the on-screen photo's location caption as wrong; the flag
  // (asset id + caption) is posted to the Pi for later triage. On a portrait
  // pair, the half you pressed is the one flagged.
  useEffect(() => {
    function onLongPress(e) {
      const disp = layers[activeIdx]
      if (!disp || !disp.photos || disp.photos.length === 0) return
      let photo = disp.photos[0]
      if (disp.kind === 'portrait-pair' && disp.photos.length > 1) {
        const x = e.detail?.x ?? window.innerWidth / 2
        photo = x < window.innerWidth / 2 ? disp.photos[0] : disp.photos[1]
      }
      const assetId = photo?.src?.match(/immich-([^.]+)\.jpg/)?.[1] || null
      if (!assetId) return
      const caption = photo?.exif?.location || ''
      postPhotoFlag(assetId, caption)
      setFlagToast({ caption, key: assetId + ':' + Date.now() })
    }
    window.addEventListener('app-long-press', onLongPress)
    return () => window.removeEventListener('app-long-press', onLongPress)
  }, [layers, activeIdx])

  // Suppress the native long-press context menu / iOS callout so flagging
  // feels clean (global user-select:none already covers text selection).
  useEffect(() => {
    function onCtx(e) {
      e.preventDefault()
    }
    window.addEventListener('contextmenu', onCtx)
    return () => window.removeEventListener('contextmenu', onCtx)
  }, [])

  // EXIF drives off whichever layer is currently active. For portrait-pair
  // we render TWO captions (one under each photo); for landscape and
  // portrait-solo it's a single centered caption.
  const activeDisplay = layers[activeIdx]
  const captionKey = useMemo(
    () => activeDisplay ? `${activeDisplay.kind}-${tick}` : 'none',
    [activeDisplay, tick]
  )
  const isPair = activeDisplay?.kind === 'portrait-pair'
  const leftExif = activeDisplay?.photos?.[0]?.exif || null
  const rightExif = isPair ? (activeDisplay?.photos?.[1]?.exif || null) : null

  const isEmpty = !loading && photos && photos.length === 0

  return (
    <div className="photo-slideshow">
      {loading && !activeDisplay && (
        <div className="photo-slideshow__placeholder">Loading photos...</div>
      )}
      {isEmpty && !activeDisplay && (
        <div className="photo-slideshow__placeholder">
          No photos to show. Enable an album in Settings &rarr; Photo slideshow.
        </div>
      )}

      {/* Two stable, stacked layers. activeIdx flips between 0 and 1; the
        * active layer fades to opacity 1, the other fades to 0 - both
        * transitioning simultaneously for a smooth crossfade. */}
      {[0, 1].map((idx) => (
        <div
          key={idx}
          className={
            'photo-slideshow__layer' +
            (idx === activeIdx ? ' photo-slideshow__layer--active' : '')
          }
        >
          <PhotoLayer
            display={layers[idx]}
            displayMode={displayMode}
            smartThreshold={smartThreshold}
            smartFaces={smartFaces}
          />
        </div>
      ))}

      <TimeWidget />
      {isPair ? (
        <>
          <ExifCaption exif={leftExif} cycleKey={captionKey + '-L'} position="left" />
          <ExifCaption exif={rightExif} cycleKey={captionKey + '-R'} position="right" />
        </>
      ) : (
        <ExifCaption exif={leftExif} cycleKey={captionKey} position="center" />
      )}
      <AlbumArtWidget />
      <FlagToast
        key={flagToast?.key}
        flag={flagToast}
        onDone={() => setFlagToast(null)}
      />
    </div>
  )
}
