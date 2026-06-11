// School-schedule helpers - the single source of truth for "is today a
// no-school day", the lunch entree to show, and which per-kid activities land
// today. Pure functions (no React/IO) so they are easy to unit-test and can be
// reused by the Today view, the boot/auto-show gating, and the noSchoolToday
// post to the Pi.

// Local 'YYYY-MM-DD' for a Date (NOT toISOString, which is UTC and can be a day
// off). ISO date strings compare lexicographically == chronologically.
export function dateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Is `date` a no-school day? True if any of:
//   - the weekday is not in school.schoolDays (weekend / non-school weekday)
//   - the date is in school.noSchoolOverrides (manual: snow days, Lawton-only)
//   - the date falls in a "No School ..." range from the SPS calendar feed
//   - the calendar has session bounds and the date is outside them (summer /
//     before the year starts)
// The calendar arg is the /api/schoolcal payload (may be null if unavailable -
// in which case only schoolDays + overrides apply, so we never falsely suppress
// just because the feed failed).
export function isNoSchoolToday(school, calendar, date = new Date()) {
  const key = dateKey(date)

  const schoolDays = school?.schoolDays || []
  if (!schoolDays.includes(date.getDay())) return true

  const overrides = school?.noSchoolOverrides || []
  if (overrides.includes(key)) return true

  if (calendar) {
    const ranges = calendar.noSchoolRanges || []
    if (ranges.some((r) => key >= r.start && key <= r.end)) return true

    const firsts = calendar.firstDays || []
    const lasts = calendar.lastDays || []
    if (firsts.length && lasts.length) {
      const inSession = firsts.some((f, i) => {
        const l = lasts[i]
        return l && key >= f && key <= l
      })
      if (!inSession) return true
    }
  }

  return false
}

// MealViewer often lists the entree as a "CHEFS CHOICE MON" placeholder. Treat
// those as no real entree.
function isChefsChoice(name) {
  return /chef'?s\s*choice/i.test(name || '')
}

// The lunch entree string for `date`: a real entree, or "Chef's Choice" when the
// menu only has a placeholder, or null (weekend / summer / no menu). The Grab &
// Go item is reported separately by grabForToday so both can show.
export function lunchEntreeForToday(lunch, date = new Date()) {
  const day = lunch?.days?.[dateKey(date)]
  if (!day) return null
  const realEntree = (day.entrees || []).find((n) => !isChefsChoice(n))
  if (realEntree) return realEntree
  if ((day.entrees || []).some(isChefsChoice)) return "Chef's Choice"
  return null
}

// The day's Grab & Go item, or null.
export function grabForToday(lunch, date = new Date()) {
  const day = lunch?.days?.[dateKey(date)]
  return (day?.grabAndGo || [])[0] || null
}

// Per-kid activities that land on `date`'s weekday: [{ name, label }, ...].
export function activitiesForToday(school, date = new Date()) {
  const wd = date.getDay()
  const out = []
  for (const kid of school?.kids || []) {
    for (const act of kid?.activities || []) {
      if ((act?.weekdays || []).includes(wd)) {
        out.push({ name: kid.name, label: act.label })
      }
    }
  }
  return out
}
