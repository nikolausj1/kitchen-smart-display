// headline.mjs - the one-line "top thing to know right now" for the Entry board.
//
// Phase 1 rules (decided 2026-09-24), highest priority first:
//   1. The next TIMED event today: "Vinny soccer at 5:00 pm"; inside the last
//      hour "Vinny soccer in 40 min"; while it runs "Vinny soccer now".
//   2. Otherwise an all-day event today: "Today: PJ and Stuffy day".
//   3. After 6 pm, tomorrow's first event: "Tomorrow: Sheena Chicago" (with
//      "at 10:00 am" when timed).
//   4. Otherwise a day-part line: morning, afternoon, evening, night, and the
//      late-night "You're up late. Go to bed."
//
// Weather interjections (rain from 3 pm, frost tonight) are phase 1.5.
//
// Computed on the hub (GET /api/state.headline) so every screen says the same
// thing; the same function can run in the browser as a fallback. Pure ESM,
// local time, no imports beyond countdown.mjs's dateKey.
//
// Events are the normalized shape GET /api/calendar serves:
//   { id, title, allDay, start, end, startDate, endDate, calendarLabel, color }
//   allDay: startDate / endDate are 'YYYY-MM-DD', endDate EXCLUSIVE (Google's
//           convention); start / end are null.
//   timed:  start / end are ISO strings; startDate is the local date of start.

import { dateKey } from './countdown.mjs'

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

// Returns { text, kind, eventId, until } where kind is one of
// 'now' | 'soon' | 'next' | 'today' | 'tomorrow' | 'daypart', and `until` is
// an ISO time after which the line may change (a hint for pollers; null for
// day-part lines).
export function headlineFor({ now = new Date(), events = [] } = {}) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.status !== 'cancelled') : []
  const today = dateKey(now)
  const nowMs = now.getTime()

  // 1. Timed events today: running now, else the next to start.
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
    return {
      text: `${clean(next.e.title)} at ${fmtTime(next.start)}`,
      kind: 'next',
      eventId: next.e.id ?? null,
      until: new Date(next.start.getTime() - SOON_MINUTES * 60_000).toISOString(),
    }
  }

  // 2. An all-day event today.
  const allDayToday = list.find((e) => allDayCovers(e, today))
  if (allDayToday) {
    return { text: `Today: ${clean(allDayToday.title)}`, kind: 'today', eventId: allDayToday.id ?? null, until: null }
  }

  // 3. Evening: tomorrow's first thing.
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

  // 4. Day part.
  return { text: dayPartLine(now), kind: 'daypart', eventId: null, until: null }
}
