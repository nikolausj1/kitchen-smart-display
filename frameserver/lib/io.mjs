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

// An ISO instant (usually UTC, 'Z') -> the local wall-clock stamp in `timeZone`
// ('2026-09-24T15:00', no zone), matching Open-Meteo's own local-stamp
// convention (lib/hubWeather.mjs, lib/openMeteoWeather.mjs): every `time` /
// `date` / `sunrise` / `sunset` the hub hands to weatherRules.mjs and
// headline.mjs is a local, offset-less string, so `new Date(v)` parses it in
// the process's own zone (the house's, verified Pacific on the NUC) and every
// source reads the same way. WeatherKit answers in UTC, so lib/weatherKit.mjs
// uses this to convert. Returns null for an unparseable instant or a missing
// timeZone.
export function toLocalStamp(iso, timeZone) {
  if (!timeZone) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).map((p) => [p.type, p.value]),
  )
  // Some ICU builds print midnight as "24" with hour12: false.
  const hour = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`
}

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
