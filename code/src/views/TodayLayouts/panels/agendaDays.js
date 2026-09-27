// agendaDays.js - which day columns the agenda shows for its knobs (days,
// startDay; panels/schemas.js 'agenda'). Pure, no React: AgendaPanel uses it
// and re-exports sliceAgendaDays for the layouts, and Node can test it.

export const DEFAULT_AGENDA_DAYS = 3
export const MAX_AGENDA_DAYS = 5

export function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

// The number of columns the knobs ask for (1..5, default 3).
export function agendaDayCount(knobs) {
  return clampInt(knobs && knobs.days, 1, MAX_AGENDA_DAYS, DEFAULT_AGENDA_DAYS)
}

// sliceAgendaDays(agendaDays, knobs) -> the day columns the agenda shows: the
// list from today, cut to knobs.days (1..5, default 3) starting today or
// tomorrow (knobs.startDay). agendaDays must start today (useTodayData's
// agendaDays do) and hold startDay + days entries for every column to fill;
// lib/agenda.js buildAgendaDays(events, today, count) builds that many.
export function sliceAgendaDays(agendaDays, knobs) {
  const list = Array.isArray(agendaDays) ? agendaDays : []
  const days = agendaDayCount(knobs)
  const start = knobs && knobs.startDay === 'tomorrow' ? 1 : 0
  return list.slice(start, start + days)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 'YYYY-MM-DD' of `now`, local (lib/schoolDay.js dateKey, the key the days
// carry), or null.
export function localDateKey(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

// agendaColumns(given, knobs, now) -> the columns for the knobs, from whatever
// the layout handed in: a list that starts today is the whole one and is cut
// here; any other list was cut by the layout already (sliceAgendaDays) and
// only loses what it holds past the count. Without a clock to tell, a list
// longer than the count is taken as the whole one.
export function agendaColumns(given, knobs, now) {
  const list = Array.isArray(given) ? given : []
  const days = agendaDayCount(knobs)
  const todayKey = localDateKey(now)
  const whole = todayKey != null ? list.length > 0 && !!list[0] && list[0].dateKey === todayKey : list.length > days
  return whole ? sliceAgendaDays(list, knobs) : list.slice(0, days)
}

// --- The row budget -------------------------------------------------------------
//
// AgendaPanel.css caps the row size at 4.9cqh of a day's list, which fits six
// rows of two-line titles plus the "+N more" line: a default row is 3.06em (2
// x 1.22em of title, 0.32em of padding, a 0.3em gap), the "+N more" line
// 1.2em. Another count or shape of row scales that cap by the ratio of the two
// budgets, so the worst day still fits; six default rows are exactly 1.
//   rows        rows per day (rowsPerDay)
//   extraLines  lines a row carries past its title (a place, a description),
//               about 1.1em each
//   titleLines  1 or 2 (2): 1.22em a line
//   rowGap      the gap's multiplier (1: 0.3em)
//   stacked     the time on its own line over the title (rowLayout
//               'stacked'): 0.8em type at 1.2 lines and its margin, 1em
export const AGENDA_BASE_ROWS = 6
export const AGENDA_ROW_EM = 3.06
export const AGENDA_STACKED_TIME_EM = 1

export function agendaRowFit(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const rows = clampInt(o.rows, 1, 20, AGENDA_BASE_ROWS)
  const extra = Number.isFinite(o.extraLines) ? o.extraLines : 0
  const lines = o.titleLines === 1 ? 1 : 2
  const gap = Number.isFinite(o.rowGap) ? Math.min(2, Math.max(0, o.rowGap)) : 1
  // Every term is 0 at the defaults, so the default row is 3.06 exactly.
  const row = AGENDA_ROW_EM + (lines - 2) * 1.22 + (gap - 1) * 0.3 + (o.stacked ? AGENDA_STACKED_TIME_EM : 0)
  return Math.round(((AGENDA_BASE_ROWS * AGENDA_ROW_EM + 1.2) / (rows * (row + extra * 1.1) + 1.2)) * 10000) / 10000
}
