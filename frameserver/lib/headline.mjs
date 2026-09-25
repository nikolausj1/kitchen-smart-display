// headline.mjs - the one-line "top thing to know right now" for the Entry board.
//
// The rules, highest priority first (phase 1 decided 2026-09-24; the weather
// rules, phase 1.5, in lib/weatherRules.mjs):
//   1. Tier A weather: a National Weather Service alert that is Extreme or
//      Severe, or any Warning: "Winter Storm Warning through Sat 6 am".
//   2. A timed event running now: "Vinny soccer now".
//   3. The next timed event today, inside the hour: "Vinny soccer in 40 min".
//   4. Tier B weather: any other NWS alert ("Wind Advisory until 6 pm"), then
//      the forecast rules: rain ("Rain from 3 pm"), frost, wind, heat, cold.
//   5. The next timed event today, later: "Vinny soccer at 5:00 pm".
//   6. An all-day event today: "Today: PJ and Stuffy day".
//   7. After 6 pm, tomorrow's first event: "Tomorrow: Sheena Chicago" (with
//      "at 10:00 am" when timed).
//   8. A day-part line: morning, afternoon, evening, night, and the late-night
//      "You're up late. Go to bed."
// Without a forecast or alerts (or with nothing to say about them) the line
// is exactly phase 1's.
//
// Computed on the hub (GET /api/state.headline) so every screen says the same
// thing, over the hub's cached events, its own forecast (lib/hubWeather.mjs)
// and the NWS alerts (lib/nwsAlerts.mjs). Pure ESM and local time, importing
// only countdown.mjs's dateKey and weatherRules.mjs (itself pure), so the
// same function can run in the browser as a fallback.
//
// Events are the normalized shape GET /api/calendar serves:
//   { id, title, allDay, start, end, startDate, endDate, calendarLabel, color }
//   allDay: startDate / endDate are 'YYYY-MM-DD', endDate EXCLUSIVE (Google's
//           convention); start / end are null.
//   timed:  start / end are ISO strings; startDate is the local date of start.
// forecast, alerts, units: as weatherLinesFor takes them (weatherRules.mjs);
// all optional.

import { dateKey } from './countdown.mjs'
import { TIER_B_RANK, weatherLinesFor } from './weatherRules.mjs'

export const SOON_MINUTES = 60
export const TOMORROW_FROM_HOUR = 18

function fmtTime(d) {
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m} ${h < 12 ? 'am' : 'pm'}`
}

function parse(iso) {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return dateKey(dt)
}

function clean(title) {
  return String(title || '').trim().replace(/\s+/g, ' ')
}

// An all-day event covers `key` when startDate <= key < endDate (exclusive end;
// a missing endDate means one day).
function allDayCovers(ev, key) {
  if (!ev?.allDay || typeof ev.startDate !== 'string') return false
  const end = typeof ev.endDate === 'string' && ev.endDate > ev.startDate ? ev.endDate : addDays(ev.startDate, 1)
  return ev.startDate <= key && key < end
}

export function dayPartLine(now) {
  const h = now.getHours()
  if (h < 5) return "You're up late. Go to bed."
  if (h < 11) return 'Good morning, everybody.'
  if (h < 17) return 'Good afternoon.'
  if (h < 21) return 'Good evening.'
  return 'Good night.'
}

// A weather line as a headline. `changeAtMs`: when the calendar would take
// the line back (the next event coming inside the hour), which makes an
// earlier `until` when it comes first.
function weatherHeadline(line, changeAtMs = null) {
  let until = line.until
  if (changeAtMs != null && (until == null || changeAtMs < Date.parse(until))) {
    until = new Date(changeAtMs).toISOString()
  }
  return { text: line.text, kind: line.kind, eventId: null, until }
}

// Returns { text, kind, eventId, until } where kind is one of
// 'alert' | 'now' | 'soon' | 'weather' | 'next' | 'today' | 'tomorrow' |
// 'daypart' ('alert' for an NWS alert of either tier, 'weather' for a
// forecast rule), and `until` is an ISO time after which the line may change
// (a hint for pollers; null for day-part lines). eventId is the calendar
// event's id, null for weather and day-part lines.
export function headlineFor({ now = new Date(), events = [], forecast = null, alerts = null, units } = {}) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.status !== 'cancelled') : []
  const today = dateKey(now)
  const nowMs = now.getTime()

  const weather = weatherLinesFor({ now, forecast, alerts, units })
  const tierA = weather.find((l) => l.rank < TIER_B_RANK)
  const tierB = weather.find((l) => l.rank >= TIER_B_RANK)

  // 1. A severe alert or any warning outranks everything.
  if (tierA) return weatherHeadline(tierA)

  // 2, 3. Timed events today: running now, else the next to start.
  const timedToday = list
    .filter((e) => !e.allDay && parse(e.start))
    .map((e) => ({ e, start: parse(e.start), end: parse(e.end) }))
    .filter(({ start }) => dateKey(start) === today)
    .sort((a, b) => a.start - b.start)

  const running = timedToday.find(({ start, end }) => start.getTime() <= nowMs && end && end.getTime() > nowMs)
  if (running) {
    return {
      text: `${clean(running.e.title)} now`,
      kind: 'now',
      eventId: running.e.id ?? null,
      until: running.end.toISOString(),
    }
  }
  const next = timedToday.find(({ start }) => start.getTime() > nowMs)
  const soonAtMs = next ? next.start.getTime() - SOON_MINUTES * 60_000 : null
  if (next) {
    const minutes = Math.ceil((next.start.getTime() - nowMs) / 60_000)
    if (minutes <= SOON_MINUTES) {
      return {
        text: `${clean(next.e.title)} in ${minutes} min`,
        kind: 'soon',
        eventId: next.e.id ?? null,
        until: next.start.toISOString(),
      }
    }
  }

  // 4. A weather interjection, until it changes or the next event comes
  //    inside the hour, whichever is first.
  if (tierB) return weatherHeadline(tierB, soonAtMs)

  // 5. The next timed event today, later.
  if (next) {
    return {
      text: `${clean(next.e.title)} at ${fmtTime(next.start)}`,
      kind: 'next',
      eventId: next.e.id ?? null,
      until: new Date(soonAtMs).toISOString(),
    }
  }

  // 6. An all-day event today.
  const allDayToday = list.find((e) => allDayCovers(e, today))
  if (allDayToday) {
    return { text: `Today: ${clean(allDayToday.title)}`, kind: 'today', eventId: allDayToday.id ?? null, until: null }
  }

  // 7. Evening: tomorrow's first thing.
  if (now.getHours() >= TOMORROW_FROM_HOUR) {
    const tomorrow = addDays(today, 1)
    const allDayTomorrow = list.find((e) => allDayCovers(e, tomorrow))
    const timedTomorrow = list
      .filter((e) => !e.allDay && parse(e.start) && dateKey(parse(e.start)) === tomorrow)
      .sort((a, b) => parse(a.start) - parse(b.start))[0]
    const pick = allDayTomorrow || timedTomorrow
    if (pick) {
      const at = pick.allDay ? '' : ` at ${fmtTime(parse(pick.start))}`
      return { text: `Tomorrow: ${clean(pick.title)}${at}`, kind: 'tomorrow', eventId: pick.id ?? null, until: null }
    }
  }

  // 8. Day part.
  return { text: dayPartLine(now), kind: 'daypart', eventId: null, until: null }
}
