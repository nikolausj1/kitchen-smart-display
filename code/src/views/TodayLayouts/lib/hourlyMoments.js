// hourlyMoments.js - the moments the hourly forecast shows, in each mode of
// its Show knob (docs/designs/panels-and-controls.md, "The hourly forecast's
// Show modes"). No React, no DOM, no clock: `now` is handed in. Tested from
// Node (hourlyMoments.test.mjs).
//
// hourlyMoments({ mode, knobs, now, feed }) -> { header, moments, nowLine, empty }
//   mode     'next' | 'untilEnd' | 'wholeDay' | 'dayParts' | 'setTimes'
//            (else knobs.mode, else 'next')
//   knobs    the hourly block's knobs (panels/schemas.js 'hourly')
//   feed     { hourly, current, daily, moon } from the hub's weather feed
//            (useTodayData d.weather): hourly[] from today's local midnight,
//            each the hour STARTING at its local stamp; current (with isDay);
//            daily[] with date, sunrise, sunset, moonPhase; moon.phase today's
//   header   the block's header ('Hourly', 'Rest of day', 'Today',
//            'Tomorrow', 'Tonight and tomorrow')
//   moments  [{ key, time, label, past, current, tomorrow, isDay, moonPhase,
//            tempF, tempWord, feelsF, code, rain, windMph }], in order: what
//            each column draws. tempWord is 'Low' on a night's part (its
//            temperature is the low), else null
//   nowLine  where now falls across the strip, a fraction of its width with
//            the columns' centres at (i + 0.5) / n, or null (Whole day only)
//   empty    'noTimes' when Set times holds no time, else null
//
// The modes:
//   next      exactly the strip it always was (weatherPanels.js
//             hourlyColumns): "Now", then every `step` hours for `hours` or
//             to `untilHour`
//   untilEnd  "Now" (the current reading), then `count` - 1 moments from the
//             next whole hour to `endHour`; from `endHour` o'clock, tomorrow
//             from the hour of its sunrise to `endHour`: "Tomorrow"
//   wholeDay  `count` moments from `startHour` to `endHour`: an hour that has
//             ended is past (dimmed), the one now is in current, and the now
//             line sits between the columns either side of now; from
//             `endHour` o'clock, tomorrow's, nothing dimmed: "Tomorrow"
//   dayParts  Morning 6-12, Afternoon 12-17, Evening 17-21, Overnight 21-6:
//             each one moment (its most significant sky, its high or the
//             night's low, its highest rain chance); from 21:00 until 6 am,
//             Tonight and the next day's Morning, Afternoon and Evening
//   setTimes  each time of `times` from the hour containing it, labelled
//             with the time itself; from the last one on, tomorrow's
// Moments are whole hours (a set time excepted): `count` of them spread from
// one end to the other, both ends exact, those between rounded to the nearest
// hour, none twice (spreadHours: 8 to 22 in six is 8, 11, 14, 16, 19, 22).
//
// Night: a moment's isDay is its hour's own in the feed ("Now": current's),
// else the sunrise and sunset of its date in daily[]; a day part is night
// when most of its hours are. moonPhase is the exact mean phase at the
// moment's hour (a part's: 9 pm of the date it starts on), as the Sun and
// moon panel draws it.
//
// Runtime rule: the Echo's Silk may be as old as Chrome 80, so no
// Object.hasOwn, Array.prototype.at, structuredClone or String replaceAll.

import { fmtHour, hourlyColumns, hourlyTitle, localHourKey, pctOf } from './weatherPanels.js'
import { synodicPhase } from '../../../components/MoonGlyph/moonGeometry.js'

export const HOURLY_MODES = ['next', 'untilEnd', 'wholeDay', 'dayParts', 'setTimes']

// The knobs' ranges (panels/schemas.js 'hourly' keeps the same numbers).
export const MOMENT_COUNT = { min: 3, max: 12, default: 6 }
export const START_HOUR = { min: 0, max: 23, default: 8 }
export const END_HOUR = { min: 1, max: 24, default: 22 }
export const SET_TIMES_DEFAULT = '7:30,12:00,15:15,18:00'
export const SET_TIMES_MAX = 8

// Where tomorrow starts after "Now until" rolls over, when the feed has no
// sunrise for it.
const SUNRISE_FALLBACK_HOUR = 7

// The day parts, in hours of the day they start on (Overnight runs to 6 am
// the next day). A part is past once its last hour is over.
export const DAY_PARTS = [
  { key: 'morning', label: 'Morning', from: 6, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 21 },
  { key: 'overnight', label: 'Overnight', from: 21, to: 30 },
]

// WMO codes from the least significant to the most: what a day part's one
// icon shows when its hours differ. Sun, cloud, fog, drizzle, rain (showers
// under steady rain), freezing drizzle and rain, snow, thunder.
const SKY_ORDER = [0, 1, 2, 3, 45, 48, 51, 53, 55, 80, 61, 81, 63, 82, 65, 56, 57, 66, 67, 77, 85, 71, 73, 86, 75, 95, 96, 99]

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function isObj(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function validDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

// A whole number in [lo, hi], else the fallback.
function intIn(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return v != null && v !== '' && Number.isFinite(n) && n >= lo && n <= hi ? n : fallback
}

function round4(v) {
  return Math.round(v * 10000) / 10000
}

// 'YYYY-MM-DD' of a local Date.
function dayKeyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// The day key n days after another. Built at local noon, so a clock change
// at midnight (some zones) cannot move it to the wrong date.
function addDays(key, n) {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + n, 12)
  return dayKeyOf(d)
}

// 'YYYY-MM-DDTHH' of an hour of a day; hour 24 and past are the next days'.
function hourKey(day, hour) {
  if (hour >= 24) return hourKey(addDays(day, Math.floor(hour / 24)), hour % 24)
  return `${day}T${pad2(hour)}`
}

// 'YYYY-MM-DDTHH:MM' of a stamp, or null.
function minuteStamp(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : null
}

function stamped(e) {
  return isObj(e) && typeof e.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}/.test(e.time)
}

// --- The feed ----------------------------------------------------------------------------

function contextOf(feed, now) {
  const f = isObj(feed) ? feed : {}
  const list = (Array.isArray(f.hourly) ? f.hourly : []).filter(stamped)
  // By hour. The night the clocks go back has two 1 am stamps: the first.
  const hours = new Map()
  list.forEach((e) => {
    const k = e.time.slice(0, 13)
    if (!hours.has(k)) hours.set(k, e)
  })
  const days = new Map()
  ;(Array.isArray(f.daily) ? f.daily : []).forEach((d) => {
    if (isObj(d) && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.date) && !days.has(d.date.slice(0, 10))) {
      days.set(d.date.slice(0, 10), d)
    }
  })
  return {
    raw: f.hourly,
    list,
    hours,
    days,
    moon: isObj(f.moon) ? f.moon : null,
    current: isObj(f.current) ? f.current : null,
    today: dayKeyOf(now),
    hour: now.getHours(),
    minute: now.getMinutes(),
    // The time of day in hours, on the wall clock (a day the clocks change
    // still reads its own hours).
    nowH: now.getHours() + now.getMinutes() / 60,
    nowKey: localHourKey(now),
    nowStamp: `${localHourKey(now)}:${pad2(now.getMinutes())}`,
  }
}

// Is the sun up at a local stamp, by its date's sunrise and sunset: true,
// false, or null when daily[] has no times for that date.
function sunUpAt(ctx, stamp) {
  const d = ctx.days.get(stamp.slice(0, 10))
  const rise = d ? minuteStamp(d.sunrise) : null
  const set = d ? minuteStamp(d.sunset) : null
  if (!rise || !set) return null
  return stamp >= rise && stamp < set
}

// An hour's own isDay (true, false, 1 or 0), else the sun at `stamp`.
function isDayAt(ctx, own, stamp) {
  if (typeof own === 'boolean') return own
  if (own === 0 || own === 1) return own === 1
  return sunUpAt(ctx, stamp)
}

// The moon's phase (0 new, 0.5 full, to 1) at a moment: the exact mean
// phase for that local hour (a bare date: its 9 pm), the same model the Sun
// and moon panel draws, so every moon on a board agrees. The feed's daily or
// moon phase (WeatherKit's eight named steps) is not used for the drawing.
function phaseOn(ctx, when) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}))?/.exec(String(when || ''))
  if (!m) return null
  return synodicPhase(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] != null ? Number(m[4]) : 21, 0, 0))
}

// The hour of a day's sunrise (the hour it falls in), or null.
function sunriseHourOf(ctx, day) {
  const d = ctx.days.get(day)
  const s = d ? minuteStamp(d.sunrise) : null
  return s && s.slice(0, 10) === day ? Number(s.slice(11, 13)) : null
}

// --- Moments -----------------------------------------------------------------------------

// A moment of one feed hour: the hour starting at `hour` o'clock on `day`
// (24: the next day's midnight).
function hourMoment(ctx, day, hour, state) {
  const key = hourKey(day, hour)
  const e = ctx.hours.get(key) || null
  const time = `${key}:00`
  return {
    key: time,
    time,
    label: fmtHour(time),
    past: !!(state && state.past),
    current: !!(state && state.current),
    tomorrow: key.slice(0, 10) > ctx.today,
    isDay: isDayAt(ctx, e && e.isDay, `${key}:30`),
    moonPhase: phaseOn(ctx, key),
    tempF: e ? e.tempF : null,
    tempWord: null,
    feelsF: e ? e.feelsF : null,
    code: e && num(e.code) != null ? e.code : null,
    rain: pctOf(e && e.precipProb),
    windMph: e ? e.windMph : null,
    data: !!e,
  }
}

// "Now": the hour now is in, with the current reading over the feed's where
// it has one (so it agrees with the weather card), exactly as the strip's
// first column always drew it; null with neither.
function nowMoment(ctx) {
  const e = ctx.hours.get(ctx.nowKey) || null
  const live = ctx.current
  if (!e && !live) return null
  return liveMoment(ctx, e || { time: `${ctx.nowKey}:00` }, live, true)
}

// A column of the strip as it always was (the 'next' mode): `e` the feed
// hour, `live` the current reading when this column is "Now".
function liveMoment(ctx, e, live, isNow) {
  const pick = (a, b) => (live && num(a) != null ? a : b)
  const liveDay = live && (typeof live.isDay === 'boolean' || live.isDay === 0 || live.isDay === 1) ? live.isDay : undefined
  const day = String(e.time).slice(0, 10)
  return {
    key: e.time,
    time: e.time,
    label: isNow ? 'Now' : fmtHour(e.time),
    past: false,
    current: isNow,
    tomorrow: day > ctx.today,
    isDay: isDayAt(ctx, liveDay !== undefined ? liveDay : e.isDay, isNow ? ctx.nowStamp : `${String(e.time).slice(0, 13)}:30`),
    moonPhase: phaseOn(ctx, isNow ? ctx.nowStamp : String(e.time)),
    tempF: pick(live && live.tempF, e.tempF),
    tempWord: null,
    code: live && typeof live.code === 'number' ? live.code : e.code,
    feelsF: pick(live && (num(live.feelsLikeF) != null ? live.feelsLikeF : live.feelsF), e.feelsF),
    rain: pctOf(e.precipProb),
    windMph: pick(live && live.windMph, e.windMph),
    data: true,
  }
}

// spreadHours(from, to, n) -> up to n whole hours from `from` to `to`, both
// ends exact, those between on the nearest hour, each once, in order: 8 to
// 22 in six is 8, 11, 14, 16, 19, 22; 8 to 10 in six is 8, 9, 10.
export function spreadHours(from, to, n) {
  const a = Math.round(Number(from))
  const b = Math.round(Number(to))
  const count = Math.floor(Number(n))
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(count >= 1)) return []
  if (count === 1 || a === b) return [b]
  const out = []
  for (let i = 0; i < count; i++) {
    const h = i === 0 ? a : i === count - 1 ? b : Math.round(a + ((b - a) * i) / (count - 1))
    if (out[out.length - 1] !== h) out.push(h)
  }
  return out
}

// nowLineAt(hours, nowH) -> where the time of day nowH (in hours) falls
// across a strip of those hours' columns, as a fraction of its width, the
// columns' centres at (i + 0.5) / n: on the way from the centre of the
// moment it is past to the next one's. null before the first moment's hour
// and from the last one's on.
export function nowLineAt(hours, nowH) {
  const n = Array.isArray(hours) ? hours.length : 0
  if (!n || !(nowH >= hours[0])) return null
  for (let i = 0; i < n - 1; i++) {
    if (nowH >= hours[i] && nowH < hours[i + 1]) {
      return round4((i + 0.5 + (nowH - hours[i]) / (hours[i + 1] - hours[i])) / n)
    }
  }
  return null
}

// nowLineRow(fraction, n, cols, rows) -> { row, x }: where a now line at
// `fraction` of a one-row strip of n moments lands once they wrap into rows
// of `cols`: the row, and the fraction across it. null for no line.
export function nowLineRow(fraction, n, cols, rows) {
  if (num(fraction) == null || !(n > 0) || !(cols > 0)) return null
  const p = fraction * n
  const row = Math.max(0, Math.min(Math.max(1, rows) - 1, Math.floor(p / cols)))
  return { row, x: round4((p - row * cols) / cols) }
}

// --- The modes ---------------------------------------------------------------------------

function nextMoments(ctx, k, now) {
  const list = hourlyColumns(ctx.raw, now, k)
  const moments = list.map((e, i) => {
    const isNow = i === 0 && String(e.time).slice(0, 13) === ctx.nowKey
    return liveMoment(ctx, e, isNow && ctx.current ? ctx.current : null, isNow)
  })
  return { header: hourlyTitle(k), moments, nowLine: null }
}

function untilEndMoments(ctx, k) {
  const end = intIn(k.endHour, END_HOUR.min, END_HOUR.max, END_HOUR.default)
  const count = intIn(k.count, MOMENT_COUNT.min, MOMENT_COUNT.max, MOMENT_COUNT.default)
  if (ctx.nowH < end) {
    const first = nowMoment(ctx)
    const rest = spreadHours(ctx.hour + 1, end, count - 1).map((h) => hourMoment(ctx, ctx.today, h))
    return { header: 'Rest of day', moments: first ? [first].concat(rest) : rest, nowLine: null }
  }
  // Past the end: tomorrow, from the hour of its sunrise (from midnight when
  // the end comes before it).
  const day = addDays(ctx.today, 1)
  let from = sunriseHourOf(ctx, day)
  if (from == null) from = sunriseHourOf(ctx, ctx.today)
  if (from == null) from = SUNRISE_FALLBACK_HOUR
  if (from >= end) from = 0
  return { header: 'Tomorrow', moments: spreadHours(from, end, count).map((h) => hourMoment(ctx, day, h)), nowLine: null }
}

function wholeDayMoments(ctx, k) {
  let start = intIn(k.startHour, START_HOUR.min, START_HOUR.max, START_HOUR.default)
  let end = intIn(k.endHour, END_HOUR.min, END_HOUR.max, END_HOUR.default)
  if (end < start) {
    const t = start
    start = end
    end = t
  }
  const count = intIn(k.count, MOMENT_COUNT.min, MOMENT_COUNT.max, MOMENT_COUNT.default)
  const hours = spreadHours(start, end, count)
  if (ctx.nowH >= end) {
    const day = addDays(ctx.today, 1)
    return { header: 'Tomorrow', moments: hours.map((h) => hourMoment(ctx, day, h)), nowLine: null }
  }
  const moments = hours.map((h) =>
    hourMoment(ctx, ctx.today, h, { past: ctx.nowH >= h + 1, current: ctx.nowH >= h && ctx.nowH < h + 1 })
  )
  return { header: 'Today', moments, nowLine: nowLineAt(hours, ctx.nowH) }
}

// The significance of a WMO code (SKY_ORDER), -1 for one not listed.
function significance(code) {
  return SKY_ORDER.indexOf(code)
}

// partSky(codes) -> the one code a day part shows: the most significant code
// that covers at least two of its hours, else the most common (a tie: the
// more significant); null for none.
export function partSky(codes) {
  const counts = new Map()
  ;(Array.isArray(codes) ? codes : []).forEach((c) => {
    if (num(c) != null) counts.set(c, (counts.get(c) || 0) + 1)
  })
  let best = null
  counts.forEach((n, c) => {
    if (n >= 2 && (best == null || significance(c) > significance(best))) best = c
  })
  if (best != null) return best
  counts.forEach((n, c) => {
    const m = best == null ? 0 : counts.get(best)
    if (best == null || n > m || (n === m && significance(c) > significance(best))) best = c
  })
  return best
}

function extreme(values, low) {
  const list = values.filter((v) => num(v) != null)
  if (!list.length) return null
  return low ? Math.min.apply(null, list) : Math.max.apply(null, list)
}

// One day part starting on `day`, from the feed hours inside it.
function partMoment(ctx, day, part, label) {
  const from = hourKey(day, part.from)
  const to = hourKey(day, part.to)
  const hours = ctx.list.filter((e) => {
    const k = e.time.slice(0, 13)
    return k >= from && k < to
  })
  const low = part.key === 'overnight'
  let night = 0
  let known = 0
  hours.forEach((e) => {
    const d = isDayAt(ctx, e.isDay, `${e.time.slice(0, 13)}:30`)
    if (d == null) return
    known += 1
    if (!d) night += 1
  })
  return {
    key: `${day}-${part.key}`,
    time: `${from}:00`,
    label,
    past: ctx.nowKey >= to,
    current: ctx.nowKey >= from && ctx.nowKey < to,
    tomorrow: day > ctx.today,
    isDay: known ? night * 2 <= known : null,
    moonPhase: phaseOn(ctx, day),
    tempF: extreme(hours.map((e) => e.tempF), low),
    tempWord: low ? 'Low' : null,
    feelsF: extreme(hours.map((e) => e.feelsF), low),
    code: partSky(hours.map((e) => e.code)),
    rain: extreme(hours.map((e) => pctOf(e.precipProb)), false),
    windMph: extreme(hours.map((e) => e.windMph), false),
    data: hours.length > 0,
  }
}

function dayPartsMoments(ctx) {
  const overnight = DAY_PARTS[3]
  // From 9 pm until 6 am: the night that is on, and the day after it.
  if (ctx.hour >= overnight.from || ctx.hour < overnight.to - 24) {
    const night = ctx.hour >= overnight.from ? ctx.today : addDays(ctx.today, -1)
    const next = addDays(night, 1)
    const moments = [partMoment(ctx, night, overnight, 'Tonight')].concat(
      DAY_PARTS.slice(0, 3).map((p) => partMoment(ctx, next, p, p.label))
    )
    return { header: 'Tonight and tomorrow', moments, nowLine: null }
  }
  return { header: 'Today', moments: DAY_PARTS.map((p) => partMoment(ctx, ctx.today, p, p.label)), nowLine: null }
}

// One time of a list, as minutes of the day (0..1439), or null: 24-hour
// ('7:30', '07:30', '19:30', a bare '7'), with am or pm ('7:30 pm',
// '7:30pm', '7 am', '12 am' is midnight, '12 pm' noon), 'noon', 'midnight'.
export function parseTime(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase()
  if (!t) return null
  if (t === 'noon') return 720
  if (t === 'midnight') return 0
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|a|p)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] == null ? 0 : Number(m[2])
  if (min > 59) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3][0] === 'p' ? 12 : 0)
  } else if (h > 23) {
    return null
  }
  return h * 60 + min
}

// parseTimes(text) -> the times of a comma-separated list, as minutes of the
// day in order, each once: the first SET_TIMES_MAX that read as times
// (parseTime); anything else is ignored.
export function parseTimes(text) {
  const out = []
  if (typeof text !== 'string' && typeof text !== 'number') return out
  String(text)
    .split(/[,;\n]/)
    .forEach((part) => {
      const t = parseTime(part)
      if (t != null && out.indexOf(t) < 0 && out.length < SET_TIMES_MAX) out.push(t)
    })
  return out.sort((a, b) => a - b)
}

// '7:30 AM', '12 PM', '3:15 PM', '12 AM': a time of day in the strip's
// words (fmtHour's, with the minutes when there are any).
export function fmtTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h % 12 || 12}${m ? `:${pad2(m)}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

function setTimesMoments(ctx, k) {
  const times = parseTimes(k.times)
  if (!times.length) return { header: 'Today', moments: [], nowLine: null, empty: 'noTimes' }
  const nowMin = ctx.hour * 60 + ctx.minute
  const rolled = nowMin >= times[times.length - 1]
  const day = rolled ? addDays(ctx.today, 1) : ctx.today
  const moments = times.map((t) => {
    const hh = Math.floor(t / 60)
    const stamp = `${day}T${pad2(hh)}:${pad2(t % 60)}`
    const e = ctx.hours.get(hourKey(day, hh)) || null
    return {
      key: stamp,
      time: stamp,
      label: fmtTime(t),
      past: !rolled && nowMin >= (hh + 1) * 60,
      current: !rolled && ctx.hour === hh,
      tomorrow: rolled,
      isDay: isDayAt(ctx, e && e.isDay, stamp),
      moonPhase: phaseOn(ctx, stamp),
      tempF: e ? e.tempF : null,
      tempWord: null,
      feelsF: e ? e.feelsF : null,
      code: e && num(e.code) != null ? e.code : null,
      rain: pctOf(e && e.precipProb),
      windMph: e ? e.windMph : null,
      data: !!e,
    }
  })
  return { header: rolled ? 'Tomorrow' : 'Today', moments, nowLine: null }
}

const TODAY_HEADERS = { untilEnd: 'Rest of day', wholeDay: 'Today', dayParts: 'Today', setTimes: 'Today' }

// The mode a block is in: `mode`, else its knobs', else 'next'.
export function hourlyMode(mode, knobs) {
  const m = mode != null ? mode : isObj(knobs) ? knobs.mode : null
  return HOURLY_MODES.indexOf(m) >= 0 ? m : 'next'
}

export function hourlyMoments(args) {
  const a = isObj(args) ? args : {}
  const k = isObj(a.knobs) ? a.knobs : {}
  const mode = hourlyMode(a.mode, k)
  const now = a.now
  if (!validDate(now)) {
    return { header: mode === 'next' ? hourlyTitle(k) : TODAY_HEADERS[mode], moments: [], nowLine: null, empty: null }
  }
  const ctx = contextOf(a.feed, now)
  let out
  if (mode === 'untilEnd') out = untilEndMoments(ctx, k)
  else if (mode === 'wholeDay') out = wholeDayMoments(ctx, k)
  else if (mode === 'dayParts') out = dayPartsMoments(ctx)
  else if (mode === 'setTimes') out = setTimesMoments(ctx, k)
  else out = nextMoments(ctx, k, now)
  // Nothing in the feed for any of them: the panel says so, rather than a
  // row of dashes.
  const any = out.moments.some((m) => m.data)
  return {
    header: out.header,
    moments: any
      ? out.moments.map((m) => {
          const copy = { ...m }
          delete copy.data
          return copy
        })
      : [],
    nowLine: any ? out.nowLine : null,
    empty: out.empty || null,
  }
}
