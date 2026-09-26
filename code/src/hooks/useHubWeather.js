import { useSyncExternalStore } from 'react'
import { hubUrl } from '../lib/hub.js'
import {
  FEED_CACHE_MAX_AGE_MS,
  cleanFeed,
  feedFresh,
  feedTimeMs,
  hasFeedData,
  localDateKey,
} from './hubWeatherFeed.js'

// useHubWeather - the hub's one weather feed, GET hubUrl('/api/weather')
// (docs/designs/panels-and-controls.md, "One weather feed"): Apple WeatherKit
// when the hub has its key, Open-Meteo otherwise, the same shape either way
// (hooks/hubWeatherFeed.js). Every weather reader on a screen shares it:
// hooks/useWeather.js (the Framed Today's slots, the departure-hour lookup),
// views/TodayLayouts/data/useDailyForecast.js (current conditions and the
// days), and through useTodayData the weather panels and Settings.
//
// A module store read with useSyncExternalStore, like lib/houseState.js. It
// polls from the first subscriber on: at once, every 5 minutes, and whenever
// the page becomes visible again (a screen waking). The 5 minute poll is not
// gated on visibility (a hidden page still keeps it current). The hub itself
// refreshes the feed every 15 minutes. A localStorage cache serves the last
// feed at once after a reload.
//
// Snapshot: { weather, fetchedAt, error, stale, checked, day }
//   weather    the last good feed (cleanFeed), from the hub or the cache, or
//              null. A poll that answers without data keeps the one held. Its
//              hours run from today's local midnight, so this morning's slots
//              are in it on a fresh load in the afternoon too
//   fetchedAt  ms epoch of weather.fetchedAt, when the hub fetched it
//              upstream: the data's age, what the panels' stamps show
//   error      why the last poll failed ('HTTP 404' from a hub on an older
//              build, 'Failed to fetch' with the hub down), else null
//   stale      no usable feed, or its data older than 90 minutes
//              (FEED_MAX_AGE_MS): the hooks then fetch Open-Meteo themselves
//   checked    the first poll of this page has settled; the hooks do not
//              start that fallback before, so a cold start with the hub up
//              never asks Open-Meteo
//   day        the local date at the last poll ('YYYY-MM-DD'): the day the
//              hooks read the hours for, so no render has to read the clock

const CACHE_KEY = 'kioskHubWeatherCache'
export const POLL_MS = 5 * 60 * 1000

function snapshotOf(weather, error, checked, nowMs) {
  return {
    weather,
    fetchedAt: feedTimeMs(weather),
    error,
    stale: !feedFresh(weather, nowMs),
    checked,
    day: localDateKey(new Date(nowMs)),
  }
}

// The feed from the cache, when its data is younger than
// FEED_CACHE_MAX_AGE_MS; else nothing.
function readCache() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return null
    const weather = cleanFeed(raw.weather)
    const t = feedTimeMs(weather)
    if (!hasFeedData(weather) || t == null || Date.now() - t > FEED_CACHE_MAX_AGE_MS) return null
    return { weather }
  } catch {
    return null
  }
}

function writeCache(s) {
  if (typeof localStorage === 'undefined' || !s.weather) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ weather: s.weather }))
  } catch {
    // storage full or disabled: the in-memory store still works
  }
}

function initial() {
  const now = Date.now()
  const cached = readCache()
  return snapshotOf(cached ? cached.weather : null, null, false, now)
}

// useSyncExternalStore needs the same object on every server-snapshot call.
const SERVER_SNAPSHOT = Object.freeze({
  weather: null,
  fetchedAt: null,
  error: null,
  stale: true,
  checked: false,
  day: null,
})

let current = initial()
let started = false
let inFlight = false
const listeners = new Set()

function sameJson(a, b) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

// Publish only what a consumer could notice, and keep the objects already
// held when the new ones are the same data, so whatever is memoised on them
// (the hooks' derived views) keeps its identity between polls.
function publish(next) {
  const weather = sameJson(current.weather, next.weather) ? current.weather : next.weather
  if (
    weather === current.weather &&
    next.error === current.error &&
    next.stale === current.stale &&
    next.checked === current.checked &&
    next.day === current.day
  ) {
    return
  }
  const changedData = weather !== current.weather
  current = { ...next, weather }
  if (changedData) writeCache(current)
  listeners.forEach((fn) => fn())
}

function accept(feed) {
  publish(snapshotOf(feed, null, true, Date.now()))
}

function fail(err) {
  const message = String((err && err.message) || err || 'unreachable')
  publish(snapshotOf(current.weather, message, true, Date.now()))
}

async function poll() {
  if (inFlight || typeof fetch === 'undefined') return
  inFlight = true
  try {
    const res = await fetch(hubUrl('/api/weather'), { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const feed = cleanFeed(await res.json())
    if (!feed) throw new Error('bad /api/weather payload')
    // A hub with nothing yet (just started, both sources failing) answers an
    // empty feed: keep what we hold and say why.
    if (!hasFeedData(feed)) throw new Error(feed.error ? `no weather on the hub: ${feed.error}` : 'no weather on the hub yet')
    accept(feed)
  } catch (err) {
    fail(err)
  } finally {
    inFlight = false
  }
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  poll()
  setInterval(poll, POLL_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') poll()
    })
  }
}

function subscribe(fn) {
  start()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return current
}

// { weather, fetchedAt, error, stale, checked, day }; the object only changes
// when one of them does.
export default function useHubWeather() {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)
}

// Synchronous read outside render (debugging, tests).
export function getHubWeather() {
  return current
}
