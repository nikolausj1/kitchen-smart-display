// Demo photos: the slideshow's manifest, faked (hooks/useImmichPhotos.js), for
// ?record=1. Generated landscapes - a sky gradient, a sun or moon and a few
// layers of hills, drawn as inline SVG data URIs - so a recording shows a
// photo frame without a single real family picture, and with no network.
// Nothing here is a photograph of anything.

const SCENES = [
  { name: 'Hillside at dusk', sky: ['#2b2350', '#b4506e', '#f2a65a'], hills: ['#3a2a52', '#2a1f40', '#1b1530'], orb: { x: 0.68, y: 0.52, r: 70, c: '#ffe7b8' } },
  { name: 'Morning fog', sky: ['#9db8cf', '#d6e3ea', '#f4efe6'], hills: ['#8aa3a6', '#6c8a8c', '#4e6e72'], orb: { x: 0.3, y: 0.34, r: 54, c: '#fffaf0' } },
  { name: 'Golden meadow', sky: ['#5aa0d8', '#a9d3ee', '#f8e3a8'], hills: ['#c9a24b', '#a9843a', '#7a6030'], orb: { x: 0.8, y: 0.28, r: 60, c: '#fff6c9' } },
  { name: 'Pine ridge', sky: ['#143a4b', '#2f6f78', '#8fc7b4'], hills: ['#1f5a52', '#16443f', '#0e2f2d'], orb: { x: 0.22, y: 0.4, r: 48, c: '#e8f6e4' } },
  { name: 'Harbor evening', sky: ['#1a2447', '#4a4f86', '#d98a8f'], hills: ['#2b2f5a', '#1f2248', '#14173a'], orb: { x: 0.56, y: 0.46, r: 80, c: '#fbe0d0' } },
  { name: 'Autumn orchard', sky: ['#6d8fb0', '#d9c4a0', '#f1a45c'], hills: ['#a8552e', '#833e24', '#5c2a1a'], orb: { x: 0.74, y: 0.36, r: 56, c: '#fff1d0' } },
]

const W = 1600
const H = 1000

function hillPath(seed, base, amp) {
  const pts = []
  for (let i = 0; i <= 8; i++) {
    const x = (W / 8) * i
    const y = base + Math.sin(seed + i * 0.9) * amp + Math.cos(seed * 1.7 + i * 0.4) * amp * 0.5
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(0)} ${y.toFixed(0)}`)
  }
  return `${pts.join(' ')} L${W} ${H} L0 ${H} Z`
}

function sceneSvg(s, index) {
  const hills = s.hills
    .map((c, i) => `<path d="${hillPath(index * 2.3 + i * 1.1, H * (0.62 + i * 0.1), 38 - i * 6)}" fill="${c}"/>`)
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${s.sky[0]}"/><stop offset="0.55" stop-color="${s.sky[1]}"/><stop offset="1" stop-color="${s.sky[2]}"/>
    </linearGradient>
    <radialGradient id="o" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${s.orb.c}" stop-opacity="0.85"/><stop offset="1" stop-color="${s.orb.c}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="${s.orb.x * W}" cy="${s.orb.y * H}" r="${s.orb.r * 3}" fill="url(#o)"/>
  <circle cx="${s.orb.x * W}" cy="${s.orb.y * H}" r="${s.orb.r}" fill="${s.orb.c}"/>
  ${hills}
</svg>`
}

const ALBUM_ID = 'demo-highlights'

// demoPhotoManifest() -> the manifest useImmichPhotos reads
// (/stub-photos/manifest.json).
export function demoPhotoManifest() {
  return {
    albums: [{ id: ALBUM_ID, name: 'Highlights', count: SCENES.length }],
    photos: SCENES.map((s, i) => ({
      src: `data:image/svg+xml,${encodeURIComponent(sceneSvg(s, i))}`,
      width: W,
      height: H,
      orientation: 'landscape',
      addedAt: 1_700_000_000_000 + i * 86_400_000,
      albums: [ALBUM_ID],
      exif: { location: s.name, date: null, album: 'Highlights' },
    })),
  }
}
