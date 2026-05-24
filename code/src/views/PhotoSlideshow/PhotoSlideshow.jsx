import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useImmichPhotos from '../../hooks/useImmichPhotos.js'
import { useSettings } from '../../lib/settings.js'
import TimeWidget from './overlays/TimeWidget.jsx'
import ExifCaption from './overlays/ExifCaption.jsx'
import AlbumArtWidget from './overlays/AlbumArtWidget.jsx'
import './PhotoSlideshow.css'

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

function PhotoLayer({ display }) {
  if (!display) return null
  if (display.kind === 'landscape') {
    const p = display.photos[0]
    return (
      <div className="photo-stage photo-stage--landscape">
        <img className="photo-stage__img" src={p.src} alt="" draggable="false" />
      </div>
    )
  }
  if (display.kind === 'portrait-pair') {
    return (
      <div className="photo-stage photo-stage--pair">
        {display.photos.map((p, i) => (
          <div key={i} className="photo-stage__half">
            <img className="photo-stage__img" src={p.src} alt="" draggable="false" />
          </div>
        ))}
      </div>
    )
  }
  // portrait-solo with blurred background
  const p = display.photos[0]
  return (
    <div className="photo-stage photo-stage--solo">
      <img className="photo-stage__blur-bg" src={p.src} alt="" aria-hidden="true" draggable="false" />
      <div className="photo-stage__blur-overlay" aria-hidden="true" />
      <img className="photo-stage__solo-img" src={p.src} alt="" draggable="false" />
    </div>
  )
}

export default function PhotoSlideshow() {
  const { photos, loading } = useImmichPhotos()
  const { slideshow } = useSettings()
  const intervalMs = slideshow?.intervalMs ?? 6000
  const queueIndexRef = useRef(0)
  const portraitBufferRef = useRef([])
  const advanceCountRef = useRef(0)

  // Two-layer crossfade. Both <Layer>s stay mounted; we just flip which one
  // is "active" (opacity 1) and put the new photo into the other slot. CSS
  // transitions handle the simultaneous fade in/out.
  const [layers, setLayers] = useState([null, null])
  const [activeIdx, setActiveIdx] = useState(0)
  const [tick, setTick] = useState(0) // bumps each advance so EXIF caption resets

  const advance = useCallback(() => {
    if (!photos || photos.length === 0) return
    const next = pickNextDisplay({
      photos,
      queueIndexRef,
      portraitBufferRef,
      advanceCountRef,
    })
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
  }, [photos])

  // Initial display once photos are loaded.
  useEffect(() => {
    if (photos && photos.length > 0 && layers[0] === null && layers[1] === null) {
      advance()
    }
  }, [photos, layers, advance])

  // Auto-advance every intervalMs (when > 0).
  useEffect(() => {
    if (!photos || photos.length === 0) return
    if (intervalMs <= 0) return
    const id = setInterval(advance, intervalMs)
    return () => clearInterval(id)
  }, [photos, advance, intervalMs])

  // EXIF drives off whichever layer is currently active.
  const activeDisplay = layers[activeIdx]
  const captionExif = activeDisplay?.photos?.[0]?.exif || null
  const captionKey = useMemo(
    () => activeDisplay ? `${activeDisplay.kind}-${tick}` : 'none',
    [activeDisplay, tick]
  )

  return (
    <div className="photo-slideshow">
      {loading && !activeDisplay && (
        <div className="photo-slideshow__placeholder">Loading photos...</div>
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
          <PhotoLayer display={layers[idx]} />
        </div>
      ))}

      <TimeWidget />
      <ExifCaption exif={captionExif} cycleKey={captionKey} />
      <AlbumArtWidget />
    </div>
  )
}
