---
title: "School Schedule Awareness - Implementation Plan"
created: 2026-06-08
modified: 2026-06-08
version: 1.1
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [plan, kitchen-display, apple-tv, school-schedule, today-view]
---

# School Schedule Awareness - Implementation Plan

## Context

The kitchen Today view currently treats "school day" as a weekday set
(`school.schoolDays`, Mon-Fri). It has no idea about holidays, breaks, or
in-service days, so the morning countdown shows on no-school days, and it shows
nothing useful about the day's lunch or per-kid activities. This adds three
things to the kitchen Pi screen (Apple TV mirrors no-school only for now):

1. Suppress the morning countdown on real no-school days (holidays, breaks,
   summer), driven by the official Seattle Public Schools calendar feed plus a
   manual override list.
2. A compact lunch entree line on Today, from the school's MealViewer menu.
3. A per-kid activity reminder line (e.g. "Vinny: Library") from a manual,
   extensible per-kid recurring-activity model.

Decisions already made (this session): kitchen first, TV mirrors no-school;
no-school source is the SPS ICS feed plus a manual override list; lunch is a
compact entree line; activities use a generic per-kid model; conference and
1-hour-early-dismissal days count as normal school mornings (only "No School ..."
events suppress).

## Data sources (confirmed)

- **Lunch:** `https://api.mealviewer.com/api/v4/school/Lawton/{MM-DD-YYYY}/{MM-DD-YYYY}`
  returns JSON `menuSchedules` -> per-day `menuBlocks` (Breakfast, Lunch) -> items.
  The exact field that marks an item as an "entree" (category/station) must be
  confirmed from a live payload before parsing (see Open details).
- **No-school:** `https://www.seattleschools.org/dates/ics/` ("School Year Dates"
  feed). All-day VEVENTs; no-school days are SUMMARY-prefixed `No School ...`.
  Multi-day breaks are single events with `DTSTART` inclusive -> `DTEND`
  exclusive. Also carries `First Day of School` / `Last Day of School` (for the
  summer boundary). Conferences and early-dismissal are NOT prefixed "No School".

Both must be fetched server-side: the kiosk is a browser and these will hit CORS.
The Pi already proxies Sonos the same way.

## Architecture

- **Pi backend** (`pi/kiosk-server.py`) gets two new cached GET endpoints that
  fetch + parse the external sources and return compact JSON. It serves only
  calendar/menu facts; it does not own the no-school decision.
- **Kitchen (React)** owns the no-school decision (it has `school.schoolDays`
  and the manual overrides), computes `noSchoolToday`, suppresses the countdown,
  renders the lunch + activity lines, gates the boot/auto-show, and POSTs
  `noSchoolToday` to `/api/state` for the TV.
- **Apple TV (Swift)** reads the posted `noSchoolToday` flag and mirrors the
  suppression (boot picker + Today). Lunch/activities on the TV are a follow-up.

## Phase 1 - Pi backend endpoints (`pi/kiosk-server.py`)

Stdlib only (`urllib.request`, `json`, `datetime`, `re`); copy the outbound
pattern from `_proxy_sonos()` (lines 160-182) and the JSON responder `_json()`
(lines 133-140). Add two route checks in `do_GET()` after the `/api/sonos` check
(around line 191), before the `super().do_GET()` fallthrough.

- **`get_school_cal()` + `/api/schoolcal`:** fetch the ICS, parse all-day
  VEVENTs, keep those whose SUMMARY starts with `No School` (case-insensitive),
  plus capture `First Day of School` / `Last Day of School`. Return:
  ```json
  { "noSchoolRanges": [{"start":"2025-12-22","end":"2026-01-02","summary":"No School Winter Break"}],
    "firstDay":"2025-09-03", "lastDay":"2026-06-17", "fetchedAt": "<iso>" }
  ```
  Convert `DTEND` to inclusive (subtract one day) so the client can do a simple
  `start <= today <= end` check. Cache in a module-level dict; refresh if older
  than ~7 days (school calendar is static). Tiny hand-rolled VEVENT parser is
  fine for this all-day-only feed; no ICS library needed.
- **`get_lunch()` + `/api/lunch`:** fetch the current week (Mon-Fri around
  today) from MealViewer, parse the Lunch block per day, return a compact map:
  ```json
  { "days": { "2026-06-08": { "entrees": ["Cheese Pizza"], "items": ["..."] } },
    "fetchedAt": "<iso>" }
  ```
  Cache ~24h. Graceful empty `{ "days": {} }` on fetch error or out-of-term.

Mirror the Sonos proxy's error handling (`urllib.error.HTTPError` -> pass through,
other -> `_json(502, ...)`). Reuse `_json()` so headers/`Cache-Control` match.

## Phase 2 - Kitchen data hooks + settings schema

**Settings schema** (`code/src/lib/settings.js`, `DEFAULTS.school`, lines 67-75).
Add to the `school` object (deep-merge handles new nested keys automatically):
- `noSchoolOverrides: []` - array of `"YYYY-MM-DD"` strings (snow days, Lawton
  specifics).
- `kids: []` - `[{ id, name, activities: [{ id, label, weekdays: [1..5] }] }]`.
- `lunch: { enabled: true, schoolSlug: "Lawton" }`.

No migration needed (deep-merge + reads use optional chaining), matching the
existing pattern. Add a `migrateLegacy()` block only if a default shape changes.

**Hooks** (new, following the `useWeather.js` fetch/cache/retry pattern,
lines 88-160):
- `useSchoolCalendar()` -> GET `/api/schoolcal`, localStorage cache, weekly
  refresh. Returns `{ noSchoolRanges, firstDay, lastDay, ... }`.
- `useLunch()` -> GET `/api/lunch`, daily refresh. Returns today's entree list
  via a small selector.

**Pure helper** (e.g. `code/src/lib/schoolDay.js`):
`isNoSchoolToday(school, calendar, date)` returns true if any of: weekday not in
`school.schoolDays`; date inside any `noSchoolRanges` entry; date before
`firstDay` or after `lastDay` (summer); date in `school.noSchoolOverrides`.
Single source of truth used by the Today view, the boot/auto-show gating, and the
`noSchoolToday` post. Unit-test this helper (it is the core logic).

## Phase 3 - Kitchen Today UI + gating + TV post

Chosen designs (see `mockups/today-school-data-mockup.html`): lunch + activities
= **variant C (slim band in the weather panel)**; no-school = **variant D, full
width with NO message**.

**Today view** (`code/src/views/TodayView/TodayView.jsx`, render lines 47-117):
- Compute `noSchool = isNoSchoolToday(school, calendar, new Date())`.
- When `noSchool`, collapse the timer column and render time + weather full width
  (set `.today-view` to a single column / drop `.today-view__right`), with **no
  "no school" message** - just the calm time + weather, matching the Apple TV
  no-timer layout. No `TimerPanel` changes needed for this (it simply is not
  rendered).
- Lunch + activities live as a **slim band at the bottom of the weather panel**
  (`views/TodayView/WeatherPanel.jsx` + `WeatherPanel.css`): a thin top-border
  divider then one compact row, e.g. `Lunch  Cheese Pizza  -  Vinny  Library  -
  Chase  Coding`. Lunch from `useLunch()`; per-kid segments from `school.kids`
  matched to today's weekday. Render the band only when it has content; on
  no-school/weekend/summer it is absent (so the no-school full-width view is just
  time + weather).

**Boot + auto-show gating** (`code/src/shell/AppShell.jsx`):
- `computeInitialView()` (lines 33-46): replace the `schoolDays.includes(day)`
  check with `!isNoSchoolToday(...)` so no-school mornings boot to Photos.
- Auto-show watcher (lines 233-259) and morning-end watcher (lines 284-315):
  gate on `!isNoSchoolToday(...)` instead of the raw `schoolDays` check.

**Post `noSchoolToday` for the TV** (`code/src/lib/settings.js`):
- Add `postSchoolDayState(noSchool)` mirroring `postTimerState()` (lines 46-59),
  POSTing `{ noSchoolToday: <bool> }` to `/api/state`. Call it from AppShell when
  the computed value changes (the watchers already run on a 30s tick; recompute
  there). Do not add it to `SHARED_KEYS` (it is derived state, not a setting).

## Phase 4 - Kitchen Settings UI (`code/src/views/Settings/SettingsView.jsx`)

Add a "School schedule" section using the existing `Row` (lines 19-29) and
controls. Reuse the 7-day toggle pattern from the "School days" row (lines
275-295) for activity weekday pickers; extract it into a small `WeekdayPicker`.
- **Lunch:** a toggle for `school.lunch.enabled` and a text field for
  `schoolSlug` (default "Lawton").
- **Kids & activities:** list kids with add/remove; per kid, a name field and a
  list of activities (label text + WeekdayPicker) with add/remove. Writes via
  `updateSettings({ school: { kids: [...] } })`.
- **No-school overrides:** add/remove single dates (snow days). A date input plus
  a removable chip list, writing `school.noSchoolOverrides`.

All controls write through `updateSettings()` (lines 203-216); reads via
`useSettings()`.

## Phase 5 - Apple TV mirroring (no-school only)

- `tvos/Sources/AppConfig.swift` `SharedStatePayload` (lines 118-199): add
  `noSchoolToday: Bool?`; add `noSchoolToday: Bool` to `AppSettings`
  (default false); merge it in `merged(into:)`.
- `tvos/Sources/RootView.swift` `AppRouter.pick(...)` (lines 25-36): return
  `.photos` (skip Today) when `settings.noSchoolToday`.
- `tvos/Sources/TodayView.swift`: when `noSchoolToday`, render the existing
  full-width no-timer layout (already built) with no message; just skip the
  countdown. The 30s settings poll (`AppModel.refreshSettings`, lines 68-72)
  already delivers the flag.

## Open implementation details to confirm

- **MealViewer entree field:** fetch one live payload and confirm which
  field/category marks the Lunch "entree" item(s); adjust `get_lunch()` parsing.
- **Override granularity:** single dates only for v1 (covers snow days). Add
  ranges later if needed.
- **No-school layout:** RESOLVED - full-width time + weather, no message
  (mockup variant D without the note).
- **Lunch/activity placement:** RESOLVED - slim band in the weather panel
  (mockup variant C).

## Verification

- **Pi:** on the Pi (or locally), `curl localhost:8080/api/schoolcal` and
  `/api/lunch`; confirm parsed ranges match the known SPS dates and the entree
  string matches the MealViewer page for today.
- **Helper:** unit-test `isNoSchoolToday` against known dates (a holiday, a
  weekend, a normal school day, a summer date, an override).
- **Kitchen:** use a dev date override (or temporarily a known no-school date) to
  confirm the countdown is suppressed, boot/auto-show skip Today, the lunch line
  shows today's entree, and a kid's activity line shows on the right weekday.
  Confirm empty states (weekend, summer) hide the lunch/activity lines.
- **TV:** with the kitchen posting `noSchoolToday: true`, confirm the TV boot
  picker skips Today and the Today screen suppresses the countdown (verify in the
  tvOS simulator by posting state, then `./deploy-device.sh`).

## Out of scope / follow-ups

- Lunch + per-kid activities on the Apple TV (kitchen-only for now).
- No-school date ranges in the manual override UI (single dates first).
- Early-dismissal handling for the morning countdown (treated as normal mornings).
- What-to-wear recommendations and school-schedule-driven view changes (separate
  backlog items).
