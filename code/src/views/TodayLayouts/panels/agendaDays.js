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
