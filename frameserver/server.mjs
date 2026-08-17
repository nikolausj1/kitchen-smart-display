#!/usr/bin/env node
// FrameServer - the Smart Display hub.
//
// Runs as a Windows service on the NUC (C:\Services\FrameServer) and serves the
// photo manifest + derivatives that every screen in the house reads. Replaces
// the kitchen Pi as the content host; the Pi keeps only its own panel hardware
// (wlr-randr power, ddcutil brightness).
//
//   GET  /stub-photos/manifest.json   the manifest, no-store
//   GET  /stub-photos/<file>          a derivative JPEG
//   POST /api/photos/refresh          start a rebuild (409 if one is running)
//   GET  /api/photos/refresh/status   {running, lastRun, ok, photoCount, error}
//   GET  /healthz                     liveness + photo count
//
// Paths stay `/stub-photos/...` because that prefix is baked into every
// manifest entry's `src` (build-photo-manifest.mjs) and into both clients.
// Renaming it would mean a coordinated rebuild + tvOS deploy for no gain.
//
// CORS is wide open: after the migration the kitchen app is served from the Pi
// but fetches the manifest from here, which is cross-origin. Images in <img>
// tags do not need it, but the manifest fetch() does. LAN-only service, so
// allow-all is the right level of ceremony.

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.FRAMESERVER_ROOT || resolve(__dirname)
const PHOTOS_DIR = process.env.STUB_PHOTOS_DIR || join(ROOT, 'photos')
const SCRIPTS_DIR = process.env.FRAMESERVER_SCRIPTS_DIR || join(ROOT, 'scripts')
const STATUS_FILE = join(ROOT, 'refresh-status.json')
const PORT = Number(process.env.FRAMESERVER_PORT || 8095)
const BIND = process.env.FRAMESERVER_BIND || '0.0.0.0'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
}

// --- refresh state -----------------------------------------------------------
// Single-flight in-process. The nightly Scheduled Task runs the same script, so
// a rebuild can also be started from outside; the lock below only guards against
// this process stacking two at once, which is the case the button can cause.
let running = false

function readStatus() {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8'))
  } catch {
    return { running: false, lastRun: null, ok: null, error: null, photoCount: null }
  }
}

function writeStatus(obj) {
  const tmp = STATUS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj))
  renameSync(tmp, STATUS_FILE) // atomic; clients poll this while a build runs
}

function countPhotos() {
  try {
    return JSON.parse(readFileSync(join(PHOTOS_DIR, 'manifest.json'), 'utf8')).photos.length
  } catch {
    return null
  }
}

function startRefresh(trigger) {
  if (running) return false
  running = true
  const startedAt = new Date().toISOString()
  writeStatus({ running: true, startedAt, trigger })

  const child = spawn(
    process.execPath,
    ['--env-file=' + join(ROOT, '.env'), 'build-photo-manifest.mjs'],
    { cwd: SCRIPTS_DIR, windowsHide: true },
  )
  let tail = ''
  const keep = (buf) => { tail = (tail + buf.toString()).slice(-4000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)

  child.on('close', (code) => {
    running = false
    writeStatus({
      running: false,
      startedAt,
      trigger,
      finishedAt: new Date().toISOString(),
      lastRun: new Date().toISOString(),
      ok: code === 0,
      error: code === 0 ? null : `build exited ${code}: ${tail.slice(-500)}`,
      photoCount: countPhotos(),
    })
  })
  child.on('error', (err) => {
    running = false
    writeStatus({
      running: false, startedAt, trigger,
      finishedAt: new Date().toISOString(), lastRun: new Date().toISOString(),
      ok: false, error: String(err), photoCount: countPhotos(),
    })
  })
  return true
}

// --- device registry ---------------------------------------------------------
// devices.json is the source of truth for what each screen shows. It replaces
// the old model where the kitchen's localStorage was master and pushed a
// three-key subset to the Pi's /api/state, which could not express "the living
// room shows different albums than the kitchen".
//
//   { shared:  { location, school, timerThresholds, weatherSlots },
//     devices: { "<id>": { name, kind, createdAt, config: { slideshow, display, sonos } } } }
//
// Shared = one value for the family. Config = per screen. Values are stored
// per-field rather than as opaque blobs so a `locked` flag could be added later
// without reshaping the file (locking is deliberately not implemented).
const REGISTRY_FILE = join(ROOT, 'devices.json')

function readRegistry() {
  try {
    const r = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
    return { shared: r.shared || {}, devices: r.devices || {} }
  } catch {
    return { shared: {}, devices: {} }
  }
}

function writeRegistry(reg) {
  const tmp = REGISTRY_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(reg, null, 2))
  renameSync(tmp, REGISTRY_FILE) // atomic: clients poll this
}

// Mirrors deepMerge in code/src/lib/settings.js: objects merge, arrays replace
// wholesale. Replacing arrays matters - selectedAlbumIds and schoolDays are
// sets the user edits by replacement, not by append.
function deepMerge(base, override) {
  if (override == null || typeof override !== 'object') return base
  if (Array.isArray(override)) return override
  const out = { ...base }
  for (const k of Object.keys(override)) {
    const b = base?.[k]
    const o = override[k]
    out[k] = b && o && typeof b === 'object' && typeof o === 'object' &&
             !Array.isArray(b) && !Array.isArray(o)
      ? deepMerge(b, o)
      : o
  }
  return out
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

// Register (or look up) a device. A device that already exists is NEVER
// overwritten by its own registration - it just gets its stored config back.
// That is what makes registration self-seeding: the first run of a new build
// hands over whatever the device had locally, so live values survive the
// migration instead of being reset to code defaults. The kitchen is currently
// running drivingDepart 7:38 against a 7:42 default; resetting that would shift
// the family's morning timer by four minutes.
function registerDevice({ id, name, kind, config, shared }) {
  const reg = readRegistry()
  const existing = reg.devices[id]
  let changed = false

  if (!existing) {
    reg.devices[id] = {
      name: name || id,
      kind: kind || 'unknown',
      createdAt: new Date().toISOString(),
      config: config && typeof config === 'object' ? config : {},
    }
    changed = true
  } else if (name && existing.name !== name) {
    existing.name = name
    changed = true
  }

  // Seed house-wide settings from the first device that offers them, and only
  // while they are still empty. Later registrations must not clobber values the
  // dashboard or another screen has since edited.
  if (shared && typeof shared === 'object' && Object.keys(reg.shared).length === 0) {
    reg.shared = shared
    changed = true
  }

  if (changed) writeRegistry(reg)
  return { id, ...reg.devices[id], shared: reg.shared }
}

// --- http --------------------------------------------------------------------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body))
  cors(res)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  })
  res.end(buf)
}

async function serveFile(res, urlPath) {
  // Resolve inside PHOTOS_DIR only: normalize collapses ../ before we join, and
  // the startsWith check catches anything that still escapes.
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '')
  const full = resolve(join(PHOTOS_DIR, rel))
  if (!full.startsWith(resolve(PHOTOS_DIR))) return json(res, 403, { error: 'forbidden' })

  let st
  try {
    st = await stat(full)
    if (!st.isFile()) throw new Error('not a file')
  } catch {
    return json(res, 404, { error: 'not found' })
  }

  const ext = full.slice(full.lastIndexOf('.')).toLowerCase()
  const isManifest = full.endsWith('manifest.json')
  cors(res)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    // The manifest is polled every 5 min and must never be stale. The JPEGs are
    // immutable per filename (asset id), so they can cache hard.
    'Cache-Control': isManifest ? 'no-store' : 'public, max-age=604800',
  })
  createReadStream(full).pipe(res)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const path = url.pathname

  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end() }

  if (path === '/healthz') {
    return json(res, 200, {
      ok: true,
      service: 'FrameServer',
      photos: countPhotos(),
      photosDir: PHOTOS_DIR,
      refreshRunning: running,
    })
  }

  if (path === '/api/photos/refresh/status') return json(res, 200, readStatus())

  // The album index only, so the dashboard's album picker does not have to pull
  // the whole 1.5 MB manifest to render a list of checkboxes.
  if (path === '/api/albums' && req.method === 'GET') {
    try {
      const m = JSON.parse(readFileSync(join(PHOTOS_DIR, 'manifest.json'), 'utf8'))
      return json(res, 200, { albums: m.albums || [] })
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) })
    }
  }

  // The dashboard. A single self-contained file rather than a second Vite
  // entry: the kiosk app is styled in viewport units for a fixed panel, which
  // is wrong for a desktop browser, so there was no stylesheet to reuse anyway.
  if (path === '/admin' || path === '/admin/') {
    try {
      const html = readFileSync(join(ROOT, 'admin.html'))
      cors(res)
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': html.length,
        'Cache-Control': 'no-store',
      })
      return res.end(html)
    } catch {
      return json(res, 404, { error: 'admin.html not deployed' })
    }
  }

  // --- device registry ---
  if (path === '/api/devices' && req.method === 'GET') {
    const reg = readRegistry()
    return json(res, 200, {
      devices: Object.entries(reg.devices).map(([id, d]) => ({ id, ...d })),
      shared: reg.shared,
    })
  }

  if (path === '/api/devices/register' && req.method === 'POST') {
    try {
      const body = await readBody(req)
      if (!body.id) return json(res, 400, { error: 'id required' })
      return json(res, 200, registerDevice(body))
    } catch (e) {
      return json(res, 400, { error: String(e.message || e) })
    }
  }

  if (path === '/api/settings/shared') {
    if (req.method === 'GET') return json(res, 200, readRegistry().shared)
    if (req.method === 'PATCH' || req.method === 'POST') {
      try {
        const reg = readRegistry()
        reg.shared = deepMerge(reg.shared, await readBody(req))
        writeRegistry(reg)
        return json(res, 200, reg.shared)
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) })
      }
    }
    return json(res, 405, { error: 'GET or PATCH' })
  }

  const devDel = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})$/)
  if (devDel && req.method === 'DELETE') {
    const reg = readRegistry()
    if (!reg.devices[devDel[1]]) return json(res, 404, { error: 'unknown device' })
    delete reg.devices[devDel[1]]
    writeRegistry(reg)
    // A deleted device that reconnects re-registers and seeds itself again from
    // whatever it still has cached locally, so this is recoverable, not fatal.
    return json(res, 200, { ok: true, removed: devDel[1] })
  }

  const devCfg = path.match(/^\/api\/devices\/([A-Za-z0-9._-]{1,64})\/config$/)
  if (devCfg) {
    const id = devCfg[1]
    const reg = readRegistry()
    if (!reg.devices[id]) return json(res, 404, { error: `unknown device: ${id}` })

    if (req.method === 'GET') {
      return json(res, 200, { id, ...reg.devices[id], shared: reg.shared })
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      try {
        reg.devices[id].config = deepMerge(reg.devices[id].config || {}, await readBody(req))
        writeRegistry(reg)
        return json(res, 200, { id, ...reg.devices[id], shared: reg.shared })
      } catch (e) {
        return json(res, 400, { error: String(e.message || e) })
      }
    }
    return json(res, 405, { error: 'GET or PATCH' })
  }

  if (path === '/api/photos/refresh') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
    const started = startRefresh('button')
    return started
      ? json(res, 200, { ok: true, started: true })
      : json(res, 409, { ok: false, running: true })
  }

  if (path.startsWith('/stub-photos/') && req.method === 'GET') {
    return serveFile(res, path.slice('/stub-photos'.length))
  }

  return json(res, 404, { error: 'not found' })
})

server.listen(PORT, BIND, () => {
  console.log(`FrameServer listening on http://${BIND}:${PORT}`)
  console.log(`  photos : ${PHOTOS_DIR} (${countPhotos() ?? '?'} in manifest)`)
  console.log(`  scripts: ${SCRIPTS_DIR}`)
  if (!existsSync(PHOTOS_DIR)) console.warn(`  WARNING: photos dir does not exist`)
})
