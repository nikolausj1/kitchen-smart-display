// School-schedule helpers: "is today a no-school day", the lunch entree to
// show, and which per-kid activities land today. Pure functions (no React/IO)
// so they are easy to unit-test and can be reused by the Today view and the
// boot/auto-show gating.
//
// dateKey and isNoSchoolToday now live in lib/countdown.js (the shared
// frameserver/lib/countdown.mjs), because the hub computes noSchoolToday for
// every screen with the same code. Re-exported here so existing imports keep
// working; do not grow a second copy - two copies are how screens drift.
import { dateKey } from './countdown.js'

export { dateKey, isNoSchoolToday } from './countdown.js'

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
