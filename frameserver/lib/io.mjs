// io.mjs - small file and HTTP helpers shared by the hub's modules.
//
// Every JSON file the hub owns is written the same way: to a .tmp sibling,
// then renamed over the real name. Screens poll these contents several times a
// minute and must never read a half-written document. On Windows renameSync
// is MoveFileEx(REPLACE_EXISTING), which is atomic on the same volume.

import { readFileSync, writeFileSync, renameSync } from 'node:fs'

// Parsed JSON, or `fallback` when the file is missing or unreadable. A corrupt
// cache file must degrade to "no cache", never take the hub down.
export function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonFileAtomic(path, value, pretty = false) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value))
  renameSync(tmp, path)
}

export const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// fetch() with a hard timeout covering the headers AND the body. The global
// fetch has no timeout of its own, and a hung upstream (a Sonos speaker
// mid-reboot, a school site that accepts the connection and stalls) must never
// pin a request or a refresh loop. Resolves { res, body: Buffer }; any HTTP
// status resolves, so callers decide what a 4xx/5xx means.
export async function fetchWithTimeout(url, { timeoutMs = 10_000, ...init } = {}) {
  const ac = new AbortController()
  const timer = setTimeout(
    () => ac.abort(new Error(`timed out after ${timeoutMs / 1000}s`)),
    timeoutMs,
  )
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    const body = Buffer.from(await res.arrayBuffer())
    return { res, body }
  } catch (e) {
    throw readableFetchError(e)
  } finally {
    clearTimeout(timer)
  }
}

// undici reports every network failure as "TypeError: fetch failed" and hides
// the useful part (ECONNREFUSED, ENOTFOUND, ...) in `cause`. Surface it, since
// these messages end up in 502 bodies and the service log.
function readableFetchError(e) {
  if (e && e.message === 'fetch failed' && e.cause) {
    const c = e.cause
    const inner = Array.isArray(c.errors) ? c.errors.map((x) => x.message).join('; ') : ''
    return new Error(c.message || inner || c.code || String(c))
  }
  return e instanceof Error ? e : new Error(String(e))
}
