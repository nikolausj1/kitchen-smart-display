import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useImmichPhotos from '../../hooks/useImmichPhotos.js'
import TimeWidget from './overlays/TimeWidget.jsx'
import ExifCaption from './overlays/ExifCaption.jsx'
import AlbumArtWidget from './overlays/AlbumArtWidget.jsx'
import './PhotoSlideshow.css'

const SLIDESHOW_INTERVAL_MS = 6000
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
  const queueIndexRef = useRef(0)
  const portraitBufferRef = useRef([])
  const advanceCountRef = useRef(0)
  const [display, setDisplay] = useState(null)

  const advance = useCallback(() => {
    if (!photos || photos.length === 0) return
    const next = pickNextDisplay({
      photos,
      queueIndexRef,
      portraitBufferRef,
      advanceCountRef,
    })
    if (next) setDisplay(next)
  }, [photos])

  // Initial display once photos are loaded.
  useEffect(() => {
    if (photos && photos.length > 0 && display === null) {
      advance()
    }
  }, [photos, display, advance])

  // Auto-advance every SLIDESHOW_INTERVAL_MS.
  useEffect(() => {
    if (!photos || photos.length === 0) return
    const id = setInterval(advance, SLIDESHOW_INTERVAL_MS)
    return () => clearInterval(id)
  }, [photos, advance])

  // The current EXIF data drives the caption overlay. For pairs we show the
  // first photo's exif; could be expanded to show both if we ever want it.
  const captionExif = display?.photos?.[0]?.exif || null
  const captionKey = useMemo(
    () => display ? `${display.kind}-${advanceCountRef.current}` : 'none',
    [display]
  )

  return (
    <div className="photo-slideshow">
      {loading && !display && (
        <div className="photo-slideshow__placeholder">Loading photos...</div>
      )}

      {/* Use the advance count as a key so a fresh DOM node mounts on every
        * change, triggering the CSS fade-in animation. */}
      <div className="photo-slideshow__layer" key={captionKey}>
        <PhotoLayer display={display} />
      </div>

      <TimeWidget />
      <ExifCaption exif={captionExif} cycleKey={captionKey} />
      <AlbumArtWidget />
    </div>
  )
}
