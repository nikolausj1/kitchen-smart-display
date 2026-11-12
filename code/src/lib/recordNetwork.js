// recordNetwork - ?record=1's offline hub (docs/designs/recording-mode.md).
//
// A recording must show only fictional data and must not depend on, or leak
// from, the house. So under ?record=1 window.fetch is replaced with a fixture
// server that lives in the page: the hub's answers the Today view reads are
// built from the demo fixtures (data/demo.js, data/demoPhotos.js) and served
// from here, which is what lets the real hooks (useHubWeather, useWeather,
// useImmichPhotos, houseState, useCalendar, ...) run their real code, and
// everything else that would leave the page (the real hub, Open-Meteo, Sonos,
// the settings PATCHes) is refused in the browser with an ordinary network
// error, which those hooks already treat as "offline". Nothing is sent
// anywhere. Requests the dev server itself must answer (modules, fonts,
// assets) pass through untouched.
//
// Imported once, after lib/recordMode.js, from main.jsx.

import { RECORD, RECORD_TRAVEL } from './recordMode.js'
import { dateKey } from './schoolDay.js'
import { demoCalendar, demoFeed } from '../views/TodayLayouts/data/demo.js'
import { demoPhotoManifest } from '../views/TodayLayouts/data/demoPhotos.js'

function json(body) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  )
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// What the hub would answer for each path the Today view reads, or undefined
// when this path is not one of them.
function fixtureFor(path) {
  const now = new Date()
  if (path.endsWith('/api/weather')) return demoFeed(now.getTime())
  if (path.endsWith('/stub-photos/manifest.json')) return demoPhotoManifest()
  if (path.endsWith('/api/calendar')) return { ...demoCalendar(startOfDay(now)), connected: true, fetchedAt: now.toISOString(), error: null }
  if (path.endsWith('/api/schoolcal')) return { noSchoolRanges: [], firstDays: [], lastDays: [] }
  if (path.endsWith('/api/state')) {
    // The house state: no decisions (so the default countdown runs), the
    // travel mode the URL asked for, and a school day.
    return {
      countdown: {},
      travelDefault: { date: dateKey(now), mode: RECORD_TRAVEL },
      noSchoolToday: false,
      timer: null,
      headline: null,
      airQuality: null,
      weatherAlerts: [],
    }
  }
  return undefined
}

function install() {
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
    let url
    try {
      url = new URL(raw, window.location.href)
    } catch {
      return Promise.reject(new TypeError('Failed to fetch'))
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return realFetch(input, init)

    const body = fixtureFor(url.pathname)
    if (body !== undefined) return json(body)

    // The dev server's own files. The hub's paths are refused even when the
    // hub is same-origin (?hub= pointed here), so a recording never reaches one.
    const hubPath = /^\/(api|stub-photos|countdown-art|build\.json)/.test(url.pathname)
    if (url.origin === window.location.origin && !hubPath) return realFetch(input, init)

    return Promise.reject(new TypeError('Failed to fetch'))
  }
}

if (RECORD && !window.__recordNetwork) {
  window.__recordNetwork = true
  install()
}
