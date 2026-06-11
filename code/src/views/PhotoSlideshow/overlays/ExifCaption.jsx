import { useEffect, useState } from 'react'
import { useSettings } from '../../../lib/settings.js'
import './ExifCaption.css'

// EXIF caption - bottom-center overlay on the Photo Slideshow.
// Reappears whenever cycleKey changes (i.e. a new photo is shown). If the
// 'auto-dismiss' setting is on, fades out after exifVisibleSeconds seconds;
// otherwise stays visible for the full photo. Pure visual; not interactive,
// so taps pass through to the dead-area handler that summons the menu pill.

export default function ExifCaption({ exif, cycleKey, position = 'center' }) {
  const { slideshow } = useSettings()
  const autoDismiss = slideshow?.autoDismissExif !== false
  const visibleMs = Math.max(1, slideshow?.exifVisibleSeconds ?? 5) * 1000
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    if (!autoDismiss) return
    const id = setTimeout(() => setVisible(false), visibleMs)
    return () => clearTimeout(id)
  }, [cycleKey, autoDismiss, visibleMs])

  if (!exif) return null
  // If there's nothing useful to show at all, render nothing. Avoids an
  // empty chip outline when a photo has no GPS, no date, no album.
  if (!exif.location && !exif.date && !exif.album) return null

  return (
    <div
      className={
        'exif-caption ' +
        ('exif-caption--' + (position || 'center')) +
        (visible ? ' exif-caption--visible' : '')
      }
    >
      <div className="exif-caption__inner">
        {exif.location && (
          <div className="exif-caption__line exif-caption__line--primary">
            <img
              className="exif-caption__icon"
              src="/icons/ui/map-pin.svg"
              alt=""
              aria-hidden="true"
              draggable="false"
            />
            {exif.location}
          </div>
        )}
        {exif.date && (
          <div className="exif-caption__line">
            <img
              className="exif-caption__icon"
              src="/icons/ui/calendar.svg"
              alt=""
              aria-hidden="true"
              draggable="false"
            />
            {exif.date}
          </div>
        )}
        {exif.album && (
          <div className="exif-caption__line exif-caption__line--muted">
            {exif.album}
          </div>
        )}
      </div>
    </div>
  )
}
