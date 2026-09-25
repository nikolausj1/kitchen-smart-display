import { useState } from 'react'
import { hubUrl } from '../../../lib/hub.js'
import './ImageBlock.css'

// ImageBlock - a picture on a board: a Countdown Art PNG, a family photo, a
// logo. A layout-spec block (layoutSpec.js, type 'image'); the box around it
// (Entry/SpecPanel) owns position, radius and background.
//
// src: a hub path ('/countdown-art/<file>') is resolved against the hub, so
// the Echo (which reaches the hub by IP) and the Mac (nuc.local) both load
// it; an http(s) URL is used as is. fit: 'contain' (the whole picture) or
// 'cover' (fills the box, cropped).
//
// Honest when there is nothing to show: no src, or a src that fails to load,
// draws a quiet outline and says so, never a broken-image icon. The failure
// is remembered per URL, so choosing a new picture gets a fresh try.

function resolveSrc(src) {
  if (typeof src !== 'string') return null
  const s = src.trim()
  if (!s) return null
  if (s.charAt(0) === '/' && s.charAt(1) !== '/') return hubUrl(s)
  if (/^https?:\/\//i.test(s)) return s
  return null
}

export default function ImageBlock({ src, fit = 'contain' }) {
  const url = resolveSrc(src)
  const [failedUrl, setFailedUrl] = useState(null)

  if (!url || failedUrl === url) {
    return (
      <div className="tl-imageblock tl-imageblock--empty">
        <span className="tl-imageblock__empty">{url ? 'Image not found' : 'No image'}</span>
      </div>
    )
  }

  return (
    <div className="tl-imageblock">
      <img
        className={`tl-imageblock__img tl-imageblock__img--${fit === 'cover' ? 'cover' : 'contain'}`}
        src={url}
        alt=""
        draggable="false"
        onError={() => setFailedUrl(url)}
      />
    </div>
  )
}
