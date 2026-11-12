// recordMode - the screen-recording switch (docs/designs/recording-mode.md).
//
//   ?record=1        public-safe, self-contained, deterministic. Implies
//                    ?demo=1 (the fictional fixtures in
//                    views/TodayLayouts/data/demo.js), pins a FIXTURE CLOCK so
//                    the school-morning countdown turns yellow a few seconds
//                    after load, and (lib/recordNetwork.js) keeps every request
//                    off the network: the hub, Open-Meteo and Sonos are
//                    answered from the fixtures or refused in the browser.
//   &yellowIn=4      seconds after load until the countdown goes green ->
//                    yellow (default 4)
//   &travel=walking  'driving' (default, leave 7:42) or 'walking' (7:32)
//   &date=YYYY-MM-DD the fixture day, which must be a school day (default: today
//                    when that is Monday-Friday, else the next Monday)
//   &at=HH:MM:SS     start the fixture clock here instead (overrides yellowIn)
//
// The fixture clock replaces window.Date's notion of "now" with a fixed day and
// time that then ticks in real time, so everything that reads the clock (the
// big clock, the greeting, the sun and the sky, the calendar days, and the real
// countdown derivation in frameserver/lib/countdown.mjs) agrees with itself,
// and no app code needs a recording special case for time.
//
// Parsed ONCE at import, like lib/kioskMode.js, and imported first in
// main.jsx so the clock is in place before any module reads it.

import { SCHOOL } from '../config.js'

const RealDate = Date

function parseParams() {
  if (typeof window === 'undefined') return { on: false }
  const p = new URLSearchParams(window.location.search)
  if (p.get('record') !== '1') return { on: false }
  const travel = p.get('travel') === 'walking' ? 'walking' : 'driving'
  const yellowIn = Number.isFinite(Number(p.get('yellowIn'))) && p.get('yellowIn') !== null
    ? Math.max(0, Number(p.get('yellowIn')))
    : 4
  return { on: true, travel, yellowIn, date: p.get('date'), at: p.get('at') }
}

const cfg = parseParams()

// The day the fixture clock shows: ?date=, else today when it is a school day
// (Monday-Friday), else the next Monday. A Sunday recording would otherwise
// draw the no-school screen.
function fixtureDay(dateParam) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam || '')
  if (m) return new RealDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new RealDate()
  d.setHours(0, 0, 0, 0)
  while (!SCHOOL.schoolDays.includes(d.getDay())) d.setDate(d.getDate() + 1)
  return d
}

// The moment the fixture clock starts: `at`, else the yellow threshold (7
// minutes to departure, lib/settings.js timerThresholds.greenAbove) plus
// yellowIn seconds before the chosen departure time.
function fixtureStart(c) {
  const day = fixtureDay(c.date)
  const at = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(c.at || '')
  if (at) {
    day.setHours(Number(at[1]), Number(at[2]), Number(at[3] || 0), 0)
    return day.getTime()
  }
  const dep = c.travel === 'walking' ? SCHOOL.walkingDepart : SCHOOL.drivingDepart
  day.setHours(dep.hour, dep.minute, 0, 0)
  return day.getTime() - 7 * 60_000 - c.yellowIn * 1000
}

function installClock(startMs) {
  const offset = startMs - RealDate.now()
  const shifted = () => RealDate.now() + offset
  class FixtureDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(shifted())
      else super(...args)
    }

    static now() {
      return shifted()
    }
  }
  window.Date = FixtureDate
}

// localStorage, in memory. The app caches the hub's settings, house state and
// weather there, and a browser that has ever shown the real house holds the
// REAL ones (the school's depart times, the kids). A recording must neither
// read those nor leave fixture data behind for the next normal session, so for
// the life of the page localStorage is a blank, throwaway Storage.
function installMemoryStorage() {
  const mem = new Map()
  const store = {
    get length() {
      return mem.size
    },
    key: (i) => Array.from(mem.keys())[i] ?? null,
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => {
      mem.set(String(k), String(v))
    },
    removeItem: (k) => {
      mem.delete(String(k))
    },
    clear: () => mem.clear(),
  }
  try {
    Object.defineProperty(window, 'localStorage', { value: store, configurable: true })
  } catch {
    // The page keeps the real storage; the fixtures still win in demo mode.
  }
}

export const RECORD = cfg.on
export const RECORD_TRAVEL = cfg.on ? cfg.travel : 'driving'

if (cfg.on && !window.__recordClock) {
  window.__recordClock = true
  installMemoryStorage()
  installClock(fixtureStart(cfg))
}
