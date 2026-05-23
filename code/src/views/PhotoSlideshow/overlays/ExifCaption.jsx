import { useEffect, useState } from 'react'
import './ExifCaption.css'

// EXIF caption - bottom-center overlay on the Photo Slideshow.
// Reappears whenever cycleKey changes (i.e. a new photo is shown) and
// auto-fades out after VISIBLE_MS. Pure visual; not interactive, so taps
// pass through to the dead-area handler that summons the menu pill.

const VISIBLE_MS = 5500

export default function ExifCaption({ exif, cycleKey }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
    const id = setTimeout(() => setVisible(false), VISIBLE_MS)
    return () => clearTimeout(id)
  }, [cycleKey])

  if (!exif) return null

  return (
    <div className={'exif-caption' + (visible ? ' exif-caption--visible' : '')}>
      <div className="exif-caption__inner">
        <div className="exif-caption__line exif-caption__line--primary">
          {exif.location}
        </div>
        <div className="exif-caption__line">{exif.date}</div>
        {exif.album && (
          <div className="exif-caption__line exif-caption__line--muted">
            {exif.album}
          </div>
        )}
      </div>
    </div>
  )
}
