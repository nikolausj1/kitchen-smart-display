// countdownArt.mjs - the "Countdown Art" Immich album, mirrored for the tiles.
//
// The countdown tiles' pictures live in an Immich album named "Countdown Art"
// (any case): PNGs with transparent backgrounds (backpacks, cakes, cabins,
// planes, state shapes, faces). Decided 2026-09-24, docs/designs/entry-board.md.
// Hourly, at startup and on POST /api/countdown-art/refresh, the hub mirrors
// the album's ORIGINALS into countdown-art/ as <assetId>.<ext> and writes
// countdown-art/index.json:
//
//   [ { id, file, name, keywords, updatedAt, checksum, bytes } ]
//
//   name      the original file name's stem, lowercased, trailing digits
//             dropped: pumpkin1.png -> "pumpkin", mark_kim5.png -> "mark_kim"
//             (countdowns.mjs artName; `image:` is compared the same way)
//   keywords  the name, its parts split on _ - and spaces ("mark", "kim"),
//             then the words of the asset's Immich description
//             (exifInfo.description) split on commas and whitespace;
//             lowercased, edge punctuation trimmed, deduped, single
//             characters dropped
//   checksum, bytes   Immich's, for change detection
//
// countdowns.mjs matches events against it (explicit `image: <name>`, else
// the longest keyword found in the title).
//
// A file is downloaded only when it is new or changed (Immich's checksum,
// else its updatedAt, else the size) or missing on disk; assets that left the
// album are deleted; index.json is replaced atomically. Only images a browser
// draws are kept (png, jpg, webp, gif, avif): videos and HEIC are skipped and
// logged. One failed download keeps that image's previous copy.
//
// No Immich config, Immich unreachable, or no such album: the error is
// reported (GET /api/countdown-art) and the folder is left untouched, so the
// tiles keep the art they had. Retried in 15 minutes after a failure.

import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fetchWithTimeout, isDict, readJsonFile, writeJsonFileAtomic } from './io.mjs'
import { artName } from './countdowns.mjs'

export const ALBUM_NAME = 'Countdown Art'
export const NO_IMMICH = 'IMMICH_URL / IMMICH_API_KEY not set'
export const ART_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'])
const SYNC_MS = 60 * 60 * 1000
const RETRY_MS = 15 * 60 * 1000
const LOG_REPEAT_MS = 60 * 60 * 1000
const API_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const ASSET_ID_RE = new RegExp(`^${UUID}$`, 'i')
// Files this module owns: anything else in the folder is never deleted.
const ART_FILE_RE = new RegExp(`^${UUID}\\.[a-z0-9]{2,5}$`, 'i')
const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' }

export const artUrl = (file) => `/countdown-art/${encodeURIComponent(file)}`

const extOf = (p) => (typeof p === 'string' ? extname(p).toLowerCase() : '')

// The keyword list: the name, its parts, then the description's words.
export function artKeywords(name, description) {
  const out = []
  const add = (w) => {
    if (w && w.length >= 2 && !out.includes(w)) out.push(w)
  }
  const n = String(name ?? '').trim().toLowerCase()
  add(n)
  for (const part of n.split(/[\s_-]+/)) add(part)
  for (const raw of String(description ?? '').toLowerCase().split(/[\s,]+/)) {
    add(raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
  }
  return out
}

// One album asset -> its index entry, or { skip: reason } when it is not
// usable art.
export function artEntry(asset) {
  if (!isDict(asset) || !ASSET_ID_RE.test(String(asset.id))) return { skip: 'an asset without a usable id' }
  const fileName = typeof asset.originalFileName === 'string' ? asset.originalFileName : ''
  const label = fileName || asset.id
  if (asset.type && asset.type !== 'IMAGE') return { skip: `${label} (${String(asset.type).toLowerCase()})` }
  if (asset.isTrashed) return { skip: `${label} (in the trash)` }
  const ext = extOf(asset.originalPath) || extOf(fileName) || MIME_EXT[asset.originalMimeType] || ''
  if (!ART_EXTS.has(ext)) return { skip: `${label} (${ext || 'unknown type'}: not drawable in a browser)` }
  const id = String(asset.id).toLowerCase()
  const name = artName(fileName.replace(/\.[^.]*$/, '')) || id
  const bytes = Number(asset.exifInfo?.fileSizeInByte)
  return {
    id,
    file: `${id}${ext}`,
    name,
    keywords: artKeywords(name, asset.exifInfo?.description ?? asset.description ?? ''),
    updatedAt: typeof asset.updatedAt === 'string' ? asset.updatedAt : null,
    checksum: typeof asset.checksum === 'string' && asset.checksum ? asset.checksum : null,
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
  }
}

// An index.json entry as written by hand or by an older version, tidied; null
// when unusable (a file name must be a plain name with an image extension).
function indexItem(x) {
  if (!isDict(x) || typeof x.file !== 'string' || /[/\\]/.test(x.file) || !ART_EXTS.has(extOf(x.file))) return null
  const name = artName(x.name ?? x.file.replace(/\.[^.]*$/, ''))
  return {
    id: String(x.id ?? x.file.replace(/\.[^.]*$/, '')).toLowerCase(),
    file: x.file,
    name,
    keywords: Array.isArray(x.keywords) ? x.keywords.map((k) => String(k).toLowerCase()) : [name],
    updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : null,
    checksum: typeof x.checksum === 'string' ? x.checksum : null,
    bytes: Number.isFinite(Number(x.bytes)) && Number(x.bytes) > 0 ? Number(x.bytes) : null,
  }
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function needsDownload(old, entry, path) {
  const size = fileSize(path)
  if (size == null || !old || old.file !== entry.file) return true
  if (entry.checksum && old.checksum) return entry.checksum !== old.checksum
  if (entry.updatedAt && old.updatedAt) return entry.updatedAt !== old.updatedAt
  if (entry.bytes) return size !== entry.bytes
  return false
}

async function getJson(base, path, apiKey) {
  const { res, body } = await fetchWithTimeout(base + path, {
    timeoutMs: API_TIMEOUT_MS,
    headers: { 'x-api-key': apiKey, Accept: 'application/json' },
  })
  const what = `Immich ${path.split('?')[0]}`
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`)
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error(`${what}: not JSON`)
  }
}

async function download(base, id, apiKey, path) {
  const { res, body } = await fetchWithTimeout(`${base}/api/assets/${encodeURIComponent(id)}/original`, {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    headers: { 'x-api-key': apiKey },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!body.length) throw new Error('empty file')
  const tmp = `${path}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, path) // a screen fetching the old copy mid-sync still gets a whole file
}

// getConfig() -> { url, apiKey }, read on every sync.
export function createCountdownArt({ dir, getConfig, log = (m) => console.log(m) }) {
  const indexFile = join(dir, 'index.json')
  let items = []
  let album = null
  let syncedAt = null
  let error = null
  let inFlight = null
  let timer = null
  let lastSkipped = ''
  let synced = false
  const lastLog = { msg: null, at: 0 }

  function logRepeat(msg) {
    const now = Date.now()
    if (msg === lastLog.msg && now - lastLog.at < LOG_REPEAT_MS) return
    lastLog.msg = msg
    lastLog.at = now
    log(msg)
  }

  function status() {
    return {
      album,
      syncedAt,
      error,
      running: !!inFlight,
      items: items.map((i) => ({
        id: i.id,
        file: i.file,
        name: i.name,
        keywords: i.keywords,
        updatedAt: i.updatedAt,
        url: artUrl(i.file),
      })),
    }
  }

  async function sync() {
    const { url, apiKey } = getConfig() || {}
    if (!url || !apiKey) {
      error = NO_IMMICH
      logRepeat(`[art] ${NO_IMMICH}; serving the ${items.length} image(s) already in ${dir}`)
      return
    }
    const base = String(url).replace(/\/+$/, '')
    const albums = await getJson(base, '/api/albums', apiKey)
    if (!Array.isArray(albums)) throw new Error('Immich /api/albums: not a list')
    const want = ALBUM_NAME.toLowerCase()
    const found = albums.find((a) => String(a?.albumName ?? '').trim().toLowerCase() === want)
    if (!found) {
      album = null
      throw new Error(`no Immich album named "${ALBUM_NAME}"`)
    }
    album = { id: String(found.id), name: String(found.albumName) }
    const detail = await getJson(base, `/api/albums/${encodeURIComponent(album.id)}?withoutAssets=false`, apiKey)
    const assets = Array.isArray(detail?.assets) ? detail.assets : []

    mkdirSync(dir, { recursive: true })
    const prev = new Map(items.map((i) => [i.id, i]))
    const next = []
    const skipped = []
    const failed = []
    let added = 0
    let updated = 0
    for (const a of assets) {
      const entry = artEntry(a)
      if (entry.skip) {
        skipped.push(entry.skip)
        continue
      }
      if (next.some((i) => i.id === entry.id)) continue
      const old = prev.get(entry.id)
      const path = join(dir, entry.file)
      if (!needsDownload(old, entry, path)) {
        next.push(entry) // same file; the keywords may still have changed
        continue
      }
      try {
        await download(base, entry.id, apiKey, path)
        if (old) updated += 1
        else added += 1
        next.push(entry)
      } catch (e) {
        failed.push(`${entry.name}: ${e.message}`)
        if (old && fileSize(join(dir, old.file)) != null) next.push(old)
      }
    }
    next.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

    // Our files that are not in the new index (assets that left the album)
    // and leftovers of an interrupted download go.
    const keep = new Set(next.map((i) => i.file))
    let removed = 0
    for (const f of readdirSync(dir)) {
      if (keep.has(f) || !(ART_FILE_RE.test(f) || f.endsWith('.tmp'))) continue
      try {
        unlinkSync(join(dir, f))
        if (!f.endsWith('.tmp')) removed += 1
      } catch (e) {
        log(`[art] could not delete ${f}: ${e.message}`)
      }
    }

    items = next
    writeJsonFileAtomic(indexFile, items, true)
    syncedAt = new Date().toISOString()
    error = failed.length ? `${failed.length} download(s) failed: ${failed.join('; ')}` : null
    const skippedNow = skipped.join('; ')
    if (!synced || added || updated || removed || failed.length || skippedNow !== lastSkipped) {
      const parts = [`${added} new`, `${updated} updated`, `${removed} removed`]
      if (skipped.length) parts.push(`skipped ${skippedNow}`)
      if (failed.length) parts.push(`FAILED ${failed.join('; ')}`)
      log(`[art] "${album.name}": ${items.length} image(s) (${parts.join(', ')})`)
    }
    lastSkipped = skippedNow
    synced = true
    lastLog.msg = null
  }

  // Never rejects; resolves to status() when the sync is done.
  function refresh(reason) {
    if (inFlight) return inFlight
    inFlight = (async () => {
      let failedHard = false
      try {
        await sync()
      } catch (e) {
        failedHard = true
        error = e.message
        logRepeat(`[art] sync failed (${reason}): ${e.message}; keeping the ${items.length} image(s) already here`)
      } finally {
        inFlight = null
        clearTimeout(timer)
        timer = setTimeout(() => refresh('hourly'), failedHard ? RETRY_MS : SYNC_MS)
        timer.unref?.()
      }
      return status()
    })()
    return inFlight
  }

  return {
    // Load index.json (syncedAt = its mtime, the last sync that wrote it),
    // then sync. Returns what was there, for the startup log.
    start() {
      const v = readJsonFile(indexFile, null)
      const list = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : []
      items = list.map(indexItem).filter(Boolean)
      try {
        syncedAt = statSync(indexFile).mtime.toISOString()
      } catch {
        syncedAt = null
      }
      const restored = { items: items.length, syncedAt }
      refresh('startup')
      return restored
    },
    items: () => items,
    status,
    running: () => !!inFlight,
    refresh,
    stop() {
      clearTimeout(timer)
    },
  }
}
