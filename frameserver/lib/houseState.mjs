// houseState.mjs - GET/POST /api/state, the one shared house state.
//
// Before 2026-09-24 this lived on the kitchen Pi as a blob the kitchen pushed
// (its settings subset plus a derived timer), which the Apple TV mirrored.
// Two web screens would each have pushed their own derived timer and fought.
// Now screens share only the user's countdown DECISIONS (see countdown.mjs);
// the hub stores those and derives everything else from inputs it owns:
//
//   {
//     timer:         { active, travelMode, targetISO, kind }  derived; the Apple
//                    TV's decoder (SharedStatePayload.TimerLenient) reads this
//     location:      registry shared.location
//     school:        registry shared.school
//     slideshow:     the kitchen's slideshow settings (omitted if none)
//     noSchoolToday: shared school settings + the hub's cached SPS calendar
//     countdown:     the decisions, normalized to today
//     travelDefault: the hub's weather-based walk/drive default, or null
//     serverTime:    ISO; lets a screen notice its own clock is off
//   }
//
// The first five keys come first and in the Pi's order, so the response is a
// superset of what the Pi served. Pure functions; server.mjs does the IO.

import { deriveCountdown, isNoSchoolToday, normalizeDecisions, timerPayload } from './countdown.mjs'
import { isDict } from './io.mjs'

// The TV's slideshow fallback has always been the kitchen's. If there is no
// `kitchen` device, the first plain web screen that has one.
export function pickSlideshow(registry) {
  const devices = isDict(registry?.devices) ? registry.devices : {}
  const kitchen = devices.kitchen?.config?.slideshow
  if (isDict(kitchen)) return kitchen
  for (const d of Object.values(devices)) {
    if (d?.kind === 'web' && isDict(d?.config?.slideshow)) return d.config.slideshow
  }
  return undefined
}

export function composeState({ now = new Date(), registry, stored, calendar = null, travelDefault = null }) {
  const shared = isDict(registry?.shared) ? registry.shared : {}
  const school = shared.school
  const decisions = normalizeDecisions(stored?.countdown, now)
  const noSchoolToday = isNoSchoolToday(school, calendar, now)
  const derived = deriveCountdown({ now, school, decisions, travelDefault, noSchoolToday })

  const out = { timer: timerPayload(derived), location: shared.location, school }
  const slideshow = pickSlideshow(registry)
  if (slideshow) out.slideshow = slideshow
  out.noSchoolToday = noSchoolToday
  out.countdown = decisions
  out.travelDefault = travelDefault || null
  out.serverTime = now.toISOString()
  return out
}

// A POST body -> what to store. Only `countdown` is accepted, and it REPLACES
// the stored decisions (last writer wins; each screen posts the whole object
// it applied optimistically). Everything else is reported back as ignored:
// those are pushes from a kitchen bundle that predates the hub (timer,
// noSchoolToday, location, school, slideshow), whose values the hub now
// derives or owns itself.
export function acceptStatePost(body, now = new Date()) {
  const ignored = Object.keys(body).filter((k) => k !== 'countdown')
  let countdown = null
  if (isDict(body.countdown)) {
    // normalizeDecisions keeps string updatedAt/by from the body.
    countdown = normalizeDecisions(body.countdown, now)
    if (!countdown.updatedAt) countdown.updatedAt = now.toISOString()
  }
  return { countdown, ignored }
}
