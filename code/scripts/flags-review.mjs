#!/usr/bin/env node
// Triage step for photo-location corrections.
//
// Pulls the unresolved flags from the Pi, recovers each photo's GPS from
// Immich and the source that named it from the location cache, and writes a
// self-serve review page to _review/flag-review.html. Justin opens it, fills
// in the correct labels, clicks Export, and drops the downloaded file into
// _inbox/ for flags-apply.mjs.
//
// Usage:
//   node --env-file=.env scripts/flags-review.mjs
//   (optional)  PI_BASE=http://smartdisplay.local:8080

import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { LocationCache } from './lib/locationCache.mjs'
import { getAsset } from './lib/immich.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const REVIEW_DIR = join(PROJECT_ROOT, '_review')
const OUT = join(REVIEW_DIR, 'flag-review.html')
const LOCATION_CACHE = join(__dirname, '.location-cache.json')

const PI_BASE = (process.env.PI_BASE || 'http://smartdisplay.local:8080').replace(/\/+$/, '')
const immichUrl = (process.env.IMMICH_URL || '').replace(/\/+$/, '')
const immichKey = process.env.IMMICH_API_KEY || ''

if (!immichUrl || !immichKey) {
  console.error('! IMMICH_URL + IMMICH_API_KEY required (run with --env-file=.env)')
  process.exit(1)
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

const CATEGORIES = ['home', 'friend', 'family', 'restaurant', 'park', 'venue', 'school', 'work', 'other']

function card(r) {
  const thumb = `../code/public/stub-photos/immich-${esc(r.assetId)}.jpg`
  const maps = r.ok ? `https://www.google.com/maps?q=${r.lat},${r.lon}` : null
  const coords = r.ok ? `${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}` : '(no GPS)'
  const opts = CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')
  return `
  <div class="row${r.ok ? '' : ' row--disabled'}" data-asset="${esc(r.assetId)}" data-lat="${r.ok ? r.lat : ''}" data-lon="${r.ok ? r.lon : ''}" data-wrong="${esc(r.wrongCaption)}">
    <img class="thumb" src="${thumb}" alt="" loading="lazy" onerror="this.classList.add('thumb--missing')" />
    <div class="meta">
      <div class="wrong">was: <b>${esc(r.wrongCaption || '(no caption)')}</b>${r.source ? ` <span class="src">${esc(r.source)}</span>` : ''}</div>
      <div class="coords">${coords}${maps ? ` &middot; <a href="${maps}" target="_blank" rel="noopener">map &#8599;</a>` : ''}</div>
      ${r.ok ? `
      <div class="fields">
        <input class="label" type="text" placeholder="correct label (blank = skip)" autocomplete="off" />
        <select class="cat"><option value="">category&hellip;</option>${opts}</select>
      </div>` : `<div class="note">${esc(r.note)}</div>`}
    </div>
  </div>`
}

function renderHtml(rows) {
  const cards = rows.length ? rows.map(card).join('\n') : '<p class="empty">No unresolved flags. Nothing to triage. 🎉</p>'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Photo caption corrections - review</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; background: #f5f5f7; color: #1d1d1f; }
  header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e5e7; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  header h1 { font-size: 17px; margin: 0; }
  header p { margin: 2px 0 0; color: #6e6e73; font-size: 13px; }
  button { font: inherit; font-weight: 600; background: #0071e3; color: #fff; border: 0; border-radius: 980px; padding: 9px 18px; cursor: pointer; }
  button:active { transform: scale(0.98); }
  main { padding: 20px 24px 80px; max-width: 900px; margin: 0 auto; }
  .row { display: flex; gap: 16px; background: #fff; border: 1px solid #e5e5e7; border-radius: 14px; padding: 12px; margin-bottom: 14px; }
  .row--disabled { opacity: 0.55; }
  .thumb { width: 160px; height: 120px; object-fit: cover; border-radius: 8px; background: #ddd; flex: none; }
  .thumb--missing { visibility: hidden; }
  .meta { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; }
  .wrong b { font-weight: 600; }
  .src { font-size: 11px; color: #6e6e73; background: #f0f0f2; border-radius: 5px; padding: 1px 6px; margin-left: 4px; }
  .coords { font-size: 13px; color: #6e6e73; }
  .coords a { color: #0071e3; text-decoration: none; }
  .fields { display: flex; gap: 8px; margin-top: auto; }
  .label { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 8px; font: inherit; }
  .cat { padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 8px; font: inherit; background: #fff; }
  .note { font-size: 13px; color: #b00; }
  .empty { text-align: center; color: #6e6e73; padding: 60px 0; }
  .done { color: #1a7f37; font-weight: 600; }
</style></head>
<body>
<header>
  <div><h1>Photo caption corrections</h1><p>Type the correct label for any photo you want to fix, pick a category, then Export. Drop the file into <b>_inbox/</b>.</p></div>
  <button id="export">Export filled → download</button>
</header>
<main>
${cards}
<p id="status"></p>
</main>
<script>
document.getElementById('export').addEventListener('click', () => {
  const out = [];
  document.querySelectorAll('.row:not(.row--disabled)').forEach((row) => {
    const label = (row.querySelector('.label')?.value || '').trim();
    if (!label) return;
    out.push({
      assetId: row.dataset.asset,
      lat: Number(row.dataset.lat),
      lon: Number(row.dataset.lon),
      wrongCaption: row.dataset.wrong,
      correctLabel: label,
      category: row.querySelector('.cat')?.value || 'other',
    });
  });
  if (!out.length) { document.getElementById('status').textContent = 'Nothing filled in yet.'; return; }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flag-corrections.json';
  a.click();
  document.getElementById('status').className = 'done';
  document.getElementById('status').textContent = 'Exported ' + out.length + ' correction(s). Move flag-corrections.json into _inbox/, then run flags-apply.mjs.';
});
</script>
</body></html>`
}

async function main() {
  let flags = []
  try {
    const res = await fetch(`${PI_BASE}/api/flags?unresolved=1`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    flags = await res.json()
  } catch (e) {
    console.error(`! could not reach the Pi flags endpoint at ${PI_BASE}: ${e.message}`)
    process.exit(1)
  }
  if (!Array.isArray(flags)) flags = []

  const cache = new LocationCache(LOCATION_CACHE)
  await cache.load()

  const rows = []
  for (const f of flags) {
    const assetId = f.assetId
    const row = { assetId, wrongCaption: f.wrongCaption || '', lat: null, lon: null, source: null, ok: true, note: '' }
    try {
      const asset = await getAsset({ baseUrl: immichUrl, apiKey: immichKey, assetId })
      const ex = asset?.exifInfo || {}
      const lat = typeof ex.latitude === 'number' ? ex.latitude : null
      const lon = typeof ex.longitude === 'number' ? ex.longitude : null
      if (lat != null && lon != null) {
        row.lat = lat
        row.lon = lon
        row.source = cache.get(lat, lon)?.source || null
      } else {
        row.ok = false
        row.note = 'No GPS on this photo - cannot place a location bubble.'
      }
    } catch (e) {
      row.ok = false
      row.note = `Immich lookup failed: ${e.message}`
    }
    rows.push(row)
  }

  await mkdir(REVIEW_DIR, { recursive: true })
  await writeFile(OUT, renderHtml(rows))
  console.log(`Wrote ${rows.length} flag(s) to ${OUT}`)
  if (rows.length) {
    console.log('Open it, fill in the correct labels, Export, and drop the file into _inbox/.')
  }
}

main()
