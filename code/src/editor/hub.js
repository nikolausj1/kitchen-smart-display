// hub.js - where the layout editor finds the hub and the app, and its API
// calls. Resolved the way lib/hub.js resolves it for the app:
//
//   1. ?hub=http://host:port   dev override (the Vite server, a mock hub).
//                              URL only: unlike the app's it is not
//                              remembered, so it can never leak into the
//                              app's own remembered hub on the same origin.
//   2. <meta name="smart-display-hub" content="self">
//                              injected by FrameServer when it serves
//                              /editor/: the hub is whoever served the page.
//   3. PHOTOS.baseUrl          the compiled default (nuc.local:8095).
//
// The preview iframe is the app on the hub's origin:
//   <hub>/?device=<id>&layout=<entry|board>&edit=1&view=today
// which is the editor's own origin when the hub served the editor. For
// development, ?app=<url> points the iframe at another page instead (the Vite
// dev server's app, a mock); its own query is kept, and device, layout, edit
// and view are set on top.

import { PHOTOS } from '../config.js'
import { isLayoutId } from './spec.js'

const strip = (u) => String(u || '').trim().replace(/\/+$/, '')

function resolveHub() {
  const params = new URLSearchParams(window.location.search)
  const q = params.get('hub')
  if (q && q !== 'clear') return { hub: strip(q), source: 'param' }
  const meta = document.querySelector('meta[name="smart-display-hub"]')
  if (meta) {
    const c = strip(meta.getAttribute('content'))
    if (!c || c === 'self' || c === 'same-origin') return { hub: strip(window.location.origin), source: 'meta' }
    return { hub: c, source: 'meta' }
  }
  return { hub: strip(PHOTOS.baseUrl), source: 'config' }
}

const resolved = resolveHub()

// 'http://host:port', no trailing slash.
export const HUB = resolved.hub
// 'param' | 'meta' | 'config', for the status line.
export const HUB_SOURCE = resolved.source

export const hubUrl = (path) => `${HUB}${path.startsWith('/') ? path : `/${path}`}`

const APP_OVERRIDE = new URLSearchParams(window.location.search).get('app')

// The app in edit mode, for one screen and one layout. `origin` is what its
// messages must come from; `target` is the postMessage targetOrigin: the
// exact origin when the app shares the editor's origin (the hub serves both),
// '*' only across origins, which happens in development only (?hub= or ?app=).
export function appFrame(deviceId, layoutId) {
  let url
  try {
    url = APP_OVERRIDE ? new URL(APP_OVERRIDE, window.location.href) : new URL('/', `${HUB}/`)
  } catch {
    url = new URL('/', window.location.href)
  }
  url.searchParams.set('device', deviceId)
  url.searchParams.set('layout', layoutId)
  url.searchParams.set('edit', '1')
  url.searchParams.set('view', 'today')
  const sameOrigin = url.origin === window.location.origin
  return {
    src: url.href,
    origin: url.origin,
    sameOrigin,
    target: sameOrigin ? url.origin : '*',
    overridden: !!APP_OVERRIDE,
  }
}

// A file of the app build (code/public, e.g. previews/weather.png) as the
// preview app sees it: beside the page the iframe loads, so the hub's own in
// production (the hub serves the build) and the ?app= page's in development.
// path: relative to the app ('previews/x.png'; a leading '/' is dropped).
export function appAsset(path) {
  const rel = String(path || '').replace(/^\/+/, '')
  try {
    const page = APP_OVERRIDE ? new URL(APP_OVERRIDE, window.location.href) : new URL('/', `${HUB}/`)
    return new URL(rel, new URL('.', page)).href
  } catch {
    return `/${rel}`
  }
}

// This page for another screen or layout: same hub/app overrides. Absolute,
// so history.replaceState cannot resolve it against anything else. A null
// layout leaves ?layout= out (the screen's own Today layout decides).
export function editorUrlFor(deviceId, layoutId) {
  const u = new URL(window.location.href)
  u.searchParams.set('device', deviceId)
  if (layoutId) u.searchParams.set('layout', layoutId)
  else u.searchParams.delete('layout')
  return u.href
}

const QUERY = new URLSearchParams(window.location.search)
export const REQUESTED_DEVICE = QUERY.get('device') || null
// ?layout=entry|board; anything else is ignored.
export const REQUESTED_LAYOUT = isLayoutId(QUERY.get('layout')) ? QUERY.get('layout') : null

// --- API ----------------------------------------------------------------------

const TIMEOUT_MS = 10_000

async function request(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(hubUrl(path), {
      method,
      cache: 'no-store',
      signal: ctrl.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(e?.name === 'AbortError' ? `${method} ${path} timed out` : `${method} ${path}: hub unreachable`, { cause: e })
  } finally {
    clearTimeout(timer)
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    // not JSON; the status says enough
  }
  if (!res.ok) throw new Error(data?.error || `${method} ${path}: HTTP ${res.status}`)
  return data
}

// Every screen, with its config, lastSeenAt and screen: { w, h } | null.
// The editor reads devices from this list rather than from
// /api/devices/<id>/config: a config GET is what a screen's own poll looks
// like, and the hub would stamp that screen as seen (a dead Echo would look
// alive on the dashboard while the editor is open).
export const fetchDevices = () => request('/api/devices')

export const patchDeviceConfig = (id, patch) =>
  request(`/api/devices/${encodeURIComponent(id)}/config`, { method: 'PATCH', body: patch })

// The screen's config.layouts as it was before each of its last ten changes,
// newest first: [{ at, layouts }] (frameserver/server.mjs, layout history).
export const fetchLayoutHistory = (id) => request(`/api/devices/${encodeURIComponent(id)}/layout-history`)

export const fetchCountdownArt = () => request('/api/countdown-art')

export const isWebScreen = (d) => typeof d?.kind === 'string' && d.kind.startsWith('web')

const KIND_LABELS = { 'web-echo': 'Echo Show', 'web-tv': 'web TV', web: 'web' }
export const kindLabel = (k) => KIND_LABELS[k] || k || ''
