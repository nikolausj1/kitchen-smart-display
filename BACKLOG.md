---
title: "Kitchen Smart Display - Backlog & Tracker"
created: 2026-06-08
modified: 2026-06-10
version: 3.6
author: Claude Fable 5 (claude-fable-5)
tags: [backlog, roadmap, decisions, progress, apple-tv, kitchen-display]
---

# Kitchen Smart Display - Backlog & Tracker

The single running tracker for this project: **recurring tasks**, **active
design topics**, the **backlog** of open work, a dated **Decisions Log**, a
**Recently Shipped** log, and **Housekeeping**. Covers both surfaces - the kitchen Raspberry Pi screen
(React web app in `code/`) and the Apple TV / Frame TV app (native SwiftUI in
`tvos/`).

Where things live:
- **Spec / locked decisions:** `PRD - Smart Displays.md` (master) and
  `docs/Apple-TV-Display-PRD.md` (TV). This file does not duplicate them - it
  links.
- **Design / "how it works" references:** `docs/designs/` (e.g.
  `location-resolution-strategy.md`). Deep designs from the topics below land here.
- **Point-in-time records** (handoffs, run logs, executed plans): `archive/`.

Status legend: TODO = not started, DESIGN = being worked out below, DECISION =
needs a decision before building, BLOCKED = waiting on a dependency, VERIFY =
built but not confirmed live, POLISH = minor/cosmetic.

---

## Recurring Tasks

The repeatable maintenance workflows (not one-off backlog items).

### 1. Add new photos from Google Photos

How we ran it 2026-06-09 (the 2018 album): **you export, Claude does the rest.**

1. **You:** export from Google Photos via Takeout and unzip into
   `~/Downloads/Takeout/` (ends up as `Google Photos <MM-DD-YYYY>/` with the
   album folders + `.json` sidecars inside).
2. **You:** tell Claude "I downloaded another album, add it to Immich" and
   paste the `immich-go-import` API key **from 1Password** when asked.
3. **Claude:** finds the new Takeout folder, dry-runs immich-go (binary:
   `~/Downloads/immich-go`, server `http://192.168.6.128:2283`), runs the real
   upload, waits for Immich's thumbnail + metadata jobs to drain (refreshing
   too early only picks up part of the import - caveat in
   `docs/designs/photo-refresh-automation.md`), triggers the Pi photo refresh,
   and verifies the new album landed in the manifest.

Kitchen + TV update within ~5 min of the rebuild. If Claude isn't around for
steps 2-3, the manual command lives in the import log
(`archive/import-log-2026-06-08.md`) and the nightly 3am refresh will pick up
any finished import on its own.

### 2. Triage place corrections

Wrong captions get long-press-flagged on the kitchen display and queue up on
the Pi. Periodically (when the queue has a few): tell Claude **"let's triage
place corrections"** - that runs `flags-review.mjs` (self-serve review page in
`_review/`), you fill in correct labels and export to `_inbox/`, then
`flags-apply.mjs` writes the bubbles into `custom-places.json`. Finish with
the printed commands: scp `custom-places.json` to the Pi, trigger a photo
refresh, resolve the flags. Full flow:
`docs/designs/photo-corrections-workflow.md`.

---

## Active design topics (in discussion)

Topics we are actively talking through. Each gets its detail captured per-topic
(inline here, or spun out to `docs/designs/<topic>.md` if it grows). Summary +
decision live here once settled.

(none right now - photo-refresh automation shipped 2026-06-09, see Recently
Shipped. Reminder that outlives it: **if a second photo frame comes up, move
the photo build to the NAS** - Decisions Log 2026-06-09.)

---

## Backlog

### Kitchen Pi screen (React web app)

The app is largely complete: Today, Photos slideshow, Music / Now Playing with the
Jukebox station picker, full Settings, Sonos transport, weather, Immich photos,
the morning departure timer, and school-schedule awareness are all shipped.
Remaining:

- **Run "let's triage place corrections"** - to take care of the queue of places that I have marked on the kitchen display that need geo data updated. After running triage, save file, and move it to "inbox" to be processed. (KEEP THIS HERE.. DO NOT MARK COMPLETE)
- **Custom-label city/state suffix** (DECISION) - extend the away-from-home
  "City, ST" suffix to custom labels too, so out-of-metro custom places (e.g.
  "Mark & Kim's - AZ") get it automatically. Today only POIs + the geographic
  fallback get the suffix; custom labels are typed by hand.
- **Google Calendar / agenda** (TODO) - the one real feature gap. Direct OAuth
  via a `useCalendarEvents` hook, agenda on the Today view.
- **Today "what to wear"** (TODO) - jacket weight, shorts vs. pants from weather
  thresholds.
- **Music auto-interrupt** (DECISION) - Sonos playback auto-switches to Now
  Playing (from Photos, not Today). Open: from which views, and what happens when
  music stops. Shared with the TV "auto-show Now Playing" item.
- **Doorbell ring to Camera view** (TODO, BLOCKED) - requires Home Assistant.
- **Presence / light-level dimming** (TODO, BLOCKED) - via Home Assistant; today
  brightness is time-based only.
- **Security hardening** (TODO) - noted as a future enhancement in the spec.
- **Cleanup** (POLISH) - remove the dead `ComingSoonView`; confirm/add touch-swipe
  photo gestures (programmatic nav exists, gestures unverified).

### Apple TV / Frame TV app

Phase 1 shipped (per-view mats, Framed Now Playing, Today mat, linear nav, smooth
progress bar). Remaining:

- **Cold-threshold (35F) Settings row** (TODO) - currently hard-coded; expose as a
  TV-local setting.
- **App icon / Brand Assets** (TODO) - no icon set yet.
- **Merge `feature/apple-tv-display` into main** (TODO) - once proven in daily use.
- **Home Assistant auto-launch** (TODO) - school mornings open Today, guests scene
  opens Now Playing. Pursued in a separate session.
- **Auto-show Now Playing when music starts** (DECISION) - the PRD currently
  forbids mid-session auto-switching. Counterpart to the kitchen auto-interrupt.
- **Multi-room Sonos** (TODO) - transport/volume target "Main" only.
- **Live school-morning verification** (VERIFY) - weather-aware walk/drive default
  + timer mirroring are unit-tested but not confirmed on a real morning.
- **Polish** (POLISH) - tune Framed handwritten metadata size/placement on the real
  screen; gradient-fill alternative to the blurred Framed background.

### Shared / infrastructure

- **Lunch + per-kid activities on the Apple TV** (TODO) - kitchen-only today.
- **No-school date *ranges* in the manual override UI** (TODO) - single dates ship
  today (covers snow days).
- **Early-dismissal handling** for the morning countdown (TODO) - treated as a
  normal morning today.

### Cross-cutting themes (design once, use on both surfaces)

- **Google Calendar** - kitchen agenda first; TV mirrors later.
- **Multi-room Sonos** - affects kitchen controller and TV.
- **Home Assistant** - auto-launch, doorbell camera, presence dimming all depend on
  it.
- **Auto-show Now Playing** - one rule set should govern kitchen and TV.

---

## Decisions Log

Append-only, newest first. Locked product decisions also live in
`PRD - Smart Displays.md` ("Decisions Made") and `docs/Apple-TV-Display-PRD.md`; this log
captures decisions made during working sessions.

- **2026-06-09 - Photo-refresh automation design settled: Pi-first.** Build runs
  on the kitchen Pi (`/home/pi/photo-build/`), writing into the live
  `stub-photos/`. Triggers: kitchen Settings "Refresh photos" button
  (`kiosk-server.py` POST `/api/photos/refresh` + status endpoint, single-flight)
  and a 3am systemd timer. Secrets on the Pi: read-only Immich key +
  Places-restricted Google key (POI-quality captions for new places). Prereqs:
  atomic rebuild (no wipe-first), deploy excludes `stub-photos/` and syncs
  scripts + `custom-places.json`; `flags-apply.mjs` ends with scp + refresh
  trigger. Design: `docs/designs/photo-refresh-automation.md`.
- **2026-06-09 - Photo-refresh: NAS-centralized build identified as the
  multi-frame architecture.** The Synology (always-on, runs Immich, stores the
  photos) is the natural build host once there is more than one frame: build
  once, serve manifest + previews over LAN, frames just point at the URL.
  Pi-self-sufficient stays the pragmatic single-frame path; the script is
  portable so migrating later is cheap. Trigger to revisit: a second photo
  frame. (Windows NUC noted but not relevant unless Immich compute runs there -
  unconfirmed.)
- **2026-06-09 - POI captions get city/state by distance from home.** Boundary is
  a configurable home-metro radius (default 60 km in `custom-places.json` `home`
  block), not the state line - so far-WA places get annotated too. US -> "City, ST",
  abroad -> "City, Country". Applies to POIs and the geographic fallback (away ->
  "City, ST", neighborhood dropped); custom labels unchanged. Components stored in
  the cache + composed at build, so radius/format
  tweaks are rebuild-only. Design: `docs/designs/location-resolution-strategy.md`.
- **2026-06-09 - Built the photo caption-corrections loop.** Long-press a kitchen
  photo to flag a wrong caption -> Pi `flags.json` (`/api/flags`) -> self-serve
  review page (`flags-review.mjs`) -> `custom-places.json` bubbles
  (`flags-apply.mjs`) -> rebuild/deploy. GPS kept out of git (recovered from Immich
  at triage). Design: `docs/designs/photo-corrections-workflow.md`.
- **2026-06-09 - Ported the tvOS history+cursor nav model to the kitchen slideshow.**
  Replaced the pop-only back stack in `PhotoSlideshow.jsx` so next/previous are a
  reversible cursor walk over an immutable, lazily-extended display sequence.
- **2026-06-09 - Renamed the master spec** `Smart Displays.md` -> `PRD - Smart Displays.md`,
  starting a `PRD - <project>` naming convention (still being figured out across
  projects). All living-doc references updated; archived snapshots left as
  historical. The TV PRD (`docs/Apple-TV-Display-PRD.md`) could later be renamed to
  match (e.g. `PRD - Apple TV Display.md`).
- **2026-06-09 - figma-exports + mockups treated as transient.** Moved into
  `_inbox/figma-exports/` and `_review/mockups/` (gitignored, no longer
  version-controlled); the Figma file is the live design source. `samplePhotos/`
  kept at the project root (the build's offline fallback reads it there);
  `custom-places.json` + `.example.json` stay at root (functional config).
- **2026-06-09 - Added `_inbox/` + `_review/` workspaces and codified doc/folder
  conventions** in `CLAUDE.md` ("Doc & Folder Conventions"). `_inbox/` = you to
  Claude (drop files); `_review/` = Claude to you (mockups, drafts). Both
  gitignored except their README.
- **2026-06-09 - Docs reorg.** `BACKLOG.md` is the single tracker (decisions +
  progress + open work). Done/stale docs moved to `archive/`; design/reference docs
  to `docs/designs/`; `PRD - Smart Displays.md` stays the master spec. Per-topic depth
  captured inline or in `docs/designs/<topic>.md`, decided per topic.
- **2026-06-09 - Published the imported albums to both displays** via a manual
  manifest rebuild (`build-photo-manifest.mjs`) + `npm run deploy`. No automation
  yet (see Active topic #1).
- **2026-06-09 - Photo-refresh automation leaning Pi-self-sufficient** (not final;
  in design). Over nightly-on-Mac or a Pi-to-Mac SSH button.
- **2026-06-08 - Clean-slate Immich import.** Wiped all 270 pre-existing (bad-date)
  assets and imported a self-selected year-album batch (2019-2025), rather than
  selectively deleting. Why: avoid mixing wrong-date photos into the fresh set.

---

## Recently Shipped

Newest first.

- **2026-06-10 - Apple TV album multi-select.** TV Settings "Photo albums" is
  now a wrapped pill grid (alphanumeric order, checkmark + count, left/right
  highlights, play/pause toggles, "All albums / k of n" summary). TV-local and
  independent of the kitchen's selection; nil = All so new albums auto-include.
  Also fixed: the TV's album selection was never actually applied to the
  slideshow fetch. Deployed to the Living Room Apple TV.
- **2026-06-10 - Kitchen photo-duration slider extends to 24hr.** Non-linear
  stops: 2-60s by the second, then 2/3/5/10/15/30/60min and 3/6/12/24hr;
  readout switches units. Deployed.
- **2026-06-10 - 2018 album imported + live on both displays.** immich-go
  Takeout import (354 uploaded, 0 errors), first real-world run of the
  photo-refresh automation: manifest now 1,835 photos; the Pi's restricted
  Google key resolved 172 live Places lookups. Surfaced the post-import
  job-queue caveat now documented in the design doc + Recurring Tasks.
- **2026-06-09 - Photo-refresh automation (Pi-self-sufficient).** The Pi now
  rebuilds its own photo manifest from Immich: "Refresh photos" button in
  kitchen Settings (POST `/api/photos/refresh` + status endpoint on
  `kiosk-server.py`, single-flight via flock) and a nightly 3:01am systemd
  timer, both through `photo-refresh.sh`. Rebuild made atomic (reuse existing
  previews, tmp+rename, manifest written last, prune after; 0-photo abort
  guard) - verified live: 1,573 photos, 0 re-downloaded. Secrets on the Pi
  (`/home/pi/photo-build/.env`, chmod 600): read-only Immich key +
  Places-restricted Google key, both verified working. Deploy now excludes
  `stub-photos/` (Pi authoritative) and syncs scripts + `custom-places.json`;
  `flags-apply.mjs` hand-off is now scp + refresh trigger. Design:
  `docs/designs/photo-refresh-automation.md`.
- **2026-06-09 - City/state captions for out-of-metro POIs.** Google-named POIs
  now gain "- City, ST" (or "- City, Country" abroad) when a photo is beyond a
  configurable home-metro radius (default 60 km), including far-WA places
  (Leavenworth, WA). Distance-from-home, not the state line. The geographic
  fallback also gains "City, ST" away from home (e.g. "Santa Barbara, CA",
  "Birch Bay, WA"); custom labels unchanged.
- **2026-06-09 - Photo caption corrections.** Long-press flagging on the kitchen,
  a Pi flag store, a self-serve `_review/` triage page, and `flags-apply.mjs` that
  encodes corrections into `custom-places.json`. One bubble fixes the whole spot.
  Verified end to end (front-end, Pi endpoints, both scripts). See
  `docs/designs/photo-corrections-workflow.md`.
- **2026-06-09 - Predictable photo back-navigation (kitchen).** The slideshow now
  uses a history-array + cursor model (ported from `tvos/Sources/SlideshowEngine.swift`)
  instead of a pop-only back stack. next/previous are fully reversible - back then
  forward replays the same photos in order, including identical portrait pairings.
  Verified live via `window.photoNav`. (`code/src/views/PhotoSlideshow/PhotoSlideshow.jsx`.)
- **2026-06-09 - Albums live on both displays.** 7 year albums (2019-2025)
  published; kitchen + TV reading the new manifest.
- **2026-06-08 - Google Photos -> Immich import.** 2,379 assets (1,573 stills + 806
  videos, ~737 of them Live-Photo motion clips), correct capture dates, ~98% GPS,
  7 albums. (Run log: `archive/import-log-2026-06-08.md`.)
- **2026-06-08 - School-schedule awareness.** No-school suppression (SPS feed +
  manual overrides), lunch entree (MealViewer), per-kid activity reminders. (Plan:
  `archive/school-schedule-awareness-plan.md`.)
- **tvOS Phase 1.** Today, Photos, Now Playing, TV-local Settings, Siri Remote nav,
  per-view picture-frame mats, Framed Now Playing, smooth progress bar.
- **Kitchen app baseline.** All three views, full Settings, Sonos transport,
  weather (cached), Immich photo slideshow with face-aware smart crop, morning
  departure timer.

---

## Housekeeping / Ops

- **Photo-flag triage queue** - 9 flags remain on the Pi
  (`GET /api/flags?unresolved=1`): 7 have no GPS (can't anchor a `custom-places`
  bubble - would need GPS added in Immich + re-import), 2 were skipped
  (`Bridgehaven`, a 2nd `Cave Creek`). Run `flags-review.mjs` to label or clear.
- **Rotate/delete the `immich-go-import` API key** - it has all permissions and was
  pasted in chat during the import. The read-only `kitchen_display` key in
  `code/.env` remains for manifest builds.
- **Re-import the rest of Google Photos later** - only the 2019-2025 year albums
  were done; the full library Takeout is deferred.
- **Keep the Takeout source ~1 week** (until ~2026-06-15):
  `~/Downloads/takeout-20260609T041911Z-3-001.zip` + extracted folder. Google
  Photos source is untouched (import was additive).
- **Confirm the MealViewer "entree" field** - fetch one live payload and verify
  `get_lunch()` parses the right field for the lunch entree.
