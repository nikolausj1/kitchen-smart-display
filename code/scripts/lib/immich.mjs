// Immich API client for the build script.
//
// All calls authenticated with the IMMICH_API_KEY env var via the
// x-api-key header. Base URL from IMMICH_URL. We use the v1 REST endpoints:
//   GET /api/albums                         -> list albums
//   GET /api/albums/{id}?withoutAssets=false -> album details + assets
//   GET /api/assets/{id}/thumbnail?size=preview -> ~1920px preview JPEG
//
// The build script is the only Immich consumer for now; nothing in the
// React app touches Immich directly (album selection happens against the
// manifest's albums[] array that we build here).

import { writeFile } from 'node:fs/promises'

function authHeaders(apiKey) {
  return { 'x-api-key': apiKey, Accept: 'application/json' }
}

async function jsonOrThrow(res, what) {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`immich ${what} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// List all albums on the server. Each entry: { id, albumName, assetCount }.
// We map to a smaller shape with the field names we use elsewhere.
export async function listAlbums({ baseUrl, apiKey }) {
  const res = await fetch(`${baseUrl}/api/albums`, {
    headers: authHeaders(apiKey),
  })
  const data = await jsonOrThrow(res, 'listAlbums')
  return data.map((a) => ({
    id: a.id,
    name: a.albumName || '(untitled album)',
    count: a.assetCount || 0,
  }))
}

// Fetch one album's full asset list. Returns the raw Immich asset objects
// so the build script can read whatever fields it needs (exifInfo, type,
// width/height, dates, etc.).
//
// Note: this endpoint does NOT include people[].faces[] geometry. Use
// getAsset(id) per-asset if you need face bounding boxes.
export async function listAlbumAssets({ baseUrl, apiKey, albumId }) {
  const url = `${baseUrl}/api/albums/${albumId}?withoutAssets=false`
  const res = await fetch(url, { headers: authHeaders(apiKey) })
  const data = await jsonOrThrow(res, `listAlbumAssets(${albumId})`)
  return data.assets || []
}

// Fetch a single asset by ID. Returns the asset object including the
// people[].faces[] structure with bounding boxes - which is what we need
// for Smart Faces cropping.
export async function getAsset({ baseUrl, apiKey, assetId }) {
  const res = await fetch(`${baseUrl}/api/assets/${assetId}`, {
    headers: authHeaders(apiKey),
  })
  return jsonOrThrow(res, `getAsset(${assetId})`)
}

// Download the preview-sized thumbnail (~1920px) for an asset to disk.
// Returns the byte size written.
export async function downloadPreview({ baseUrl, apiKey, assetId, outPath }) {
  const url = `${baseUrl}/api/assets/${assetId}/thumbnail?size=preview`
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`immich preview ${assetId} HTTP ${res.status}: ${text.slice(0, 120)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(outPath, buf)
  return buf.length
}
