---
title: "Kitchen Smart Display - Backlog & Tracker"
created: 2026-06-08
modified: 2026-09-25
version: 7.2
author: Claude Fable 5.1 (claude-fable-5-1)
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

### 2. Add art to the collection

The art collection lives as a single full-res copy in the NAS `Art/` folder,
indexed in place by an **Immich external library** ("Art (NAS)"), organized into
four **movement-based** `Art - <movement>` albums (full design:
`docs/designs/art-collection-lifecycle.md`; acquisition + naming + tone:
`docs/designs/art-metadata-style-guide.md`). Flow: Claude acquires into
`_inbox/art-downloads/` (`dezoomify-rs` for Google Arts & Culture, Wikimedia for
public-domain originals), names them `Title - Artist Year.ext`, and builds a
review contact sheet in `_review/art-review.html`. **You review/cull and assign
the movement** (exported to `_inbox/art-decisions.json`); then approved files
drop into `Art/Art - <movement>/`, the Immich external library scans them in
(auto or on demand), Claude curates `art-metadata.json`
(`scripts/art-metadata-check.mjs` -> fill missing
title/artist/year/movement + optional `rights` + fun facts), and a photo refresh
lands it on both screens. Family photos still use the separate `immich-go`
managed import. Rendering/schema detail: `docs/designs/art-albums.md`.

### 3. Triage place corrections

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

### Layout editor (BUILT 2026-09-24/25, see Recently Shipped)

A what-you-see-is-what-you-get editor for the boards, used from the MacBook,
reached from each screen's card on the admin page (`/editor/?device=<id>`).
The real app renders in an iframe at the screen's exact resolution; handles
and an inspector sit over it; Save writes a per-screen layout into the
registry. All four steps are built and deployed: steps 1 and 2 on
2026-09-24, steps 3 and 4 (panel knobs, spec v2, sub-elements, smart guides,
day-part tabs, the Board as a spec layout, history, copy to another screen)
overnight 2026-09-24/25. What is left is polish: "Layout editor nits" under
Shared / infrastructure. Design and as-built record:
`docs/designs/layout-editor.md`.

### Mixtape: cassette deck Now Playing (BUILT 2026-09-24, on the TV, in review)

A new Now Playing style for the Apple TV first, the kitchen Pi later: a photoreal
cassette seen straight on inside a tape deck, full-bleed (it replaces the mat).
Reels turn with real-deck physics and the tape packs track song progress; the
label carries album art plus handwritten artist / album / song. A collection of
tapes with real brand logos (TDK, Maxell, Sony, BASF, Memorex, Fuji), mixed label
styles, lightly used to beat up; first batch 12. **One tape per song**: every song
change is an eject-and-insert, and a stop ejects to an empty well (decided in the
2026-09-23 review; the album-keyed hybrid is the fallback if that wears thin).
The tape packs deliberately double as a progress bar. Reached as the 9th stop in
the Framed backdrop cycle. Full design, states, physics, manifest contract, asset
pipeline and phases: `docs/designs/mixtape.md` (v1.1, reviewed).

**Phase 0 (look development) done 2026-09-23** on `feature/mixtape`, Fable lead
plus six Opus workers: headless-Blender cassette and three deck styles, 36 option
renders, hand-made logos for six brands, 17 OpenAI textures, two Runway eject
references, and the options sheet `_review/mockups/mixtape-options.html`.
**Look chosen the same evening** from a ChatGPT reference image (silver 70s,
door on, VU + keys, about 50%, warm). Pipeline pivoted to camera projection of the
photo onto Blender proxies and **proven end to end the same night**: still match
0.95 levels, empty-well deck plate and door layers at 4K (Apple VT upscale),
two generated tape variants seated in the same well with per-variant measured
geometry. **Built overnight 2026-09-23/24** (Fable lead, Opus workers) on
`feature/mixtape`: `MixtapeView` with the States table, live reels, handwritten
labels, door tilt, key glow, 14 tapes, sim debug flags; **installed on the
Living Room Apple TV** (launch deferred until the TV wakes). Build log and known
gaps: `docs/designs/mixtape.md`, "Overnight build log". Captures:
`_review/mixtape/final/` and `final2/`. **Reviewed on the TV 2026-09-24: "overall it's great."** Follow-up round
opened the same day: **label layout**, much larger album art and bigger song /
artist text, with new concepts including a full-bleed art label with text over
the art. Concepts sheet: `_review/mockups/mixtape-label-concepts.html`
(six concepts on real deck and tape pixels). Justin picks, then it is built
and redeployed; merge after that.

### Sonos and /api/state to the hub (BUILT 2026-09-24, see Recently Shipped)

Built on `feature/echo-hub` together with the Echo Show screen; the final
shape is in `docs/designs/echo-show-and-hub.md`. The scoping below is kept
for the record.

Finish the FrameServer migration. Photos moved to the NUC in August; **Sonos and
`/api/state` did not**, so the kitchen Pi is still a single point of failure for
the Apple TV. Proven live on 2026-09-22: with the Pi down the TV kept photos and
weather but silently lost music and the morning countdown, and finding out why
took a /22 port sweep. Full scope, risks, ordering and effort:
`docs/designs/sonos-and-state-to-the-hub.md`.

Shape: run `node-sonos-http-api` on the NUC under nssm (Node 24 and nssm are
already there), proxy it from FrameServer at `/api/sonos/*`, move `/api/state`
to the hub with a byte-identical response shape, then delete `AppConfig.piBase`
from the tvOS app. Gate everything on the NUC's zone list matching the Pi's,
because SSDP multicast discovery on Windows is the one part that can fail for
environmental reasons.

**Decided 2026-09-22: the kitchen moves to the NUC's Sonos API too.** One
service in the house, not two. Accepted cost: a NUC outage will take the
kitchen's music as well as its photos. Fallback is a one-line settings change
back to `localhost:5005`, which is why the Pi's service stays installed for a
week.

Known trap for the rollout: the hub already stores
`sonos.apiBase: "http://localhost:5005"` for the kitchen, and a stored value
beats a new default, so changing the default alone will silently do nothing.
Same class of failure as the 2026-09-04 CORS bug.

Second-order find while scoping: shared settings also ride `/api/state`, so a
cold TV launch with the Pi down falls back to the built-in `SchoolSettings`
defaults (7:42 / 7:32) while the hub holds the real values (7:38 / 7:28). A
restarted TV would show a countdown four minutes late, silently.

### Today, second layout (BUILT 2026-09-04, in review)

Built overnight as THREE selectable layouts, not one: **Board** (dark bento
grid), **Briefing** (cream paper, serif) and **Ambient** (photo-forward with a
quiet HUD), on the kitchen React app, chosen per screen with
`display.todayLayout` (default `framed`, the untouched original). Design and
architecture: `docs/designs/today-layouts.md`. Review shots and the morning
checklist: `_review/today-layouts/README.md`. Merged into `feature/echo-hub`
and deployed with it on 2026-09-24, so every web screen can pick them (not
merged to `main`). Since then the Board is drawn from a layout spec and can be
tuned in the layout editor, and two more layouts joined: the Entry board and
the Flip clock (`today-layouts.md`).

Still open from the original topic: which layout (if any) gets the Apple TV
port; auto-select by time of day (Framed inside the school window, a layout
after); the house name on Briefing as a setting. The focus-model question is
moot on the kitchen (touch) and waits for the TV port.

Reminder that outlives the old topic here: **if a second photo frame comes up,
move the photo build to the NAS** - Decisions Log 2026-06-09.

---

## Backlog

### Kitchen Pi screen (React web app)

The app is largely complete: Today, Photos slideshow, Music / Now Playing with the
Jukebox station picker, full Settings, Sonos transport, weather, Immich photos,
the morning departure timer, and school-schedule awareness are all shipped.
Remaining:

- **Hardware backlight dimming (DDC/CI)** (TODO, ready to build) - replace the
  night-mode CSS black overlay with a real backlight dim over HDMI via `ddcutil`
  (`setvcp 10`). Feasibility confirmed on the panel 2026-06-22: it answers DDC/CI
  (Realtek, VCP 2.2, bus `/dev/i2c-13`) and the Pi 5 `setvcp` bug does not affect
  it. DDC stays primary, the overlay becomes the fallback + guaranteed-black "off"
  layer, so any failure degrades to today's behavior. Touch-to-wake survives
  because DDC never disables the output. Full plan + guardrails:
  `docs/designs/hardware-brightness-ddc.md`. Prereq `ddcutil` already installed on
  the Pi.
- **Frame cabling / HDMI connector** (RESOLVED 2026-09-10) - the FPV FPC ribbon
  won. `B01M8HDX8Z` mini HDMI 90 degree up head at the panel plus `B0GZHT6LML`
  bare 20-pin 0.5 mm ribbon at 10 cm, micro head at the Pi. Confirmed working on
  the kitchen frame. Short ribbon was the deciding variable. Rigid right-angle
  adapters (Option B) failed on geometry twice and are closed. Reference build
  for every frame in the house: `docs/designs/frame-cabling-hdmi.md` v2.0.
- **Front door frame build** (TODO, parts ordered 2026-09-10) - third screen,
  same EVICIV B0CYLTZSWD panel as the kitchen. **Ordered:** `B0CYLTZSWD` panel,
  `B0DFMNHL62` Vemico Pi 5 8GB kit, `B01787RBUO` JSER micro-to-mini FPC kit (both
  heads, down bend), `B0C36MCW9N` CY micro head 90 degree up, `B0GZHSJBGB` ribbon
  (length unconfirmed, adjacent ASIN to the 10 cm `B0GZHT6LML` used on the
  kitchen). Panel power comes from the outlet USB port, same as the kitchen, so no
  charger was bought.
  **Still missing, in priority order:**
  1. **microSD card.** `B0DFMNHL62` is board plus active cooler plus 27W PSU only,
     no card, no case, no reader. Hard blocker: the Pi cannot boot. High-endurance
     recommended (`B09W9XYQCQ`), and a USB card reader too if the Mac has no slot.
  2. **Mini HDMI head in the UP bend.** The kitchen works on mini-up
     (`B01M8HDX8Z`). `B01787RBUO` ships both heads in the DOWN bend only, so if the
     front door panel mounts like the kitchen there is no correct panel-end head in
     this order. Micro is covered in both bends.
  3. **Right-angle USB cables** for touch and panel power. The panel ships straight
     cables which work electrically but are now the thickest parts in the frame and
     set minimum depth.
  Confirm the `B0GZHSJBGB` ribbon length on the order: anything 20 cm or over
  should be swapped for 5 to 10 cm, since length was the deciding variable.
  Orientation still undecided. The ribbon does not care, but the React app assumes
  1920x1080 landscape throughout: the slideshow portrait-pairing logic, the Today
  layouts and the mat are all laid out to landscape coordinates, so a portrait
  front door screen is a real front-end project, not a config flag. Rotation itself
  is `wlr-randr --transform 90` plus checking touch rotates with the output.
  Software otherwise near free: point the kiosk at the hub with `?device=front-door`
  and it self-seeds. One code prerequisite: `deploy.sh` hardcodes
  `PI_HOST=pi@smartdisplay.local` and needs a second target.
- **Run "let's triage place corrections"** - to take care of the queue of places that I have marked on the kitchen display that need geo data updated. After running triage, save file, and move it to "inbox" to be processed. (KEEP THIS HERE.. DO NOT MARK COMPLETE)
- **Custom-label city/state suffix** (DECISION) - extend the away-from-home
  "City, ST" suffix to custom labels too, so out-of-metro custom places (e.g.
  "Mark & Kim's - AZ") get it automatically. Today only POIs + the geographic
  fallback get the suffix; custom labels are typed by hand.
- **Google Calendar / agenda** (SHIPPED 2026-09-24 in the Entry board) -
  Google Calendar through a service account on the hub (`GET /api/calendar`,
  no OAuth), with the agenda and the countdown tiles on the Entry board. The
  kitchen gets it by choosing the Entry board as its Today layout; the TV
  mirror stays under Cross-cutting themes. Design:
  `docs/designs/entry-board.md`.
- **Today "what to wear"** (SHIPPED 2026-09-24 in the Entry board) - the rule
  (`views/TodayLayouts/lib/wear.js`) came with the Today layouts on
  2026-09-04 and sits on the Entry board and the Board; Framed Today does not
  show it.
- **Music auto-interrupt** (DECISION) - Sonos playback auto-switches to Now
  Playing (from Photos, not Today). Open: from which views, and what happens when
  music stops. Shared with the TV "auto-show Now Playing" item.
- **Doorbell ring to Camera view** (TODO, BLOCKED) - requires Home Assistant.
- **Presence / light-level dimming** (TODO, BLOCKED) - via Home Assistant; today
  brightness is time-based only.
- **Security hardening** (TODO) - noted as a future enhancement in the spec.
- **Cleanup** (POLISH) - remove the dead `ComingSoonView`; confirm/add touch-swipe
  photo gestures (programmatic nav exists, gestures unverified).
- **Voice assistant visual feedback** (TODO, down the road) - if a voice
  assistant gets added to Home Assistant, the kitchen display shows its visual
  feedback (timers, shopping-list additions, etc.). Goal: retire the Alexas,
  at least in the kitchen.
- **Smart-crop (face) feedback loop** (TODO) - like the geolocation
  corrections: when the face-aware crop gets it wrong, mark the photo on the
  display so it queues for fixing later (and so we learn why it was wrong).
- **Today layouts, review nits** (POLISH, from the 2026-09-04 build) - Board's
  Forecast tile has dead vertical space in its 3-row cell; the weather SVGs
  were drawn for a dark panel so the sun disc reads as a black dot on
  Briefing's cream (needs a light-safe icon set or a filter); Board has no
  lunch / activities tile (seven panels is what a 12x6 grid fits at 1280x800);
  Briefing's `HOUSE_NAME` is a constant that wants a setting; check whether
  this Fraunces cut honours `oldstyle-nums`. Full list in
  `_review/today-layouts/README.md`.
- **Today layout auto-select by time** (DECISION) - Framed inside the school
  window, the chosen layout the rest of the day, using the existing schedule
  watchers in `AppShell.jsx`. Or leave it manual per screen.
- **Kitchen: display art fun facts** (TODO) - the TV side shipped 2026-06-10
  (rotating fact bottom-center on the mat, "Art Facts" toggle); the facts
  already ride the manifest's `art.facts`, so the kitchen needs only a
  display slot (caption pill extension or a separate lower line).
- **Mixtape on the Pi: physical controls** (DESIGN, after the TV ships) - port
  the Mixtape cassette deck (see Active design topics) to the kitchen as its own,
  touch-first experience, not a copy of the TV. Ideas from 2026-09-23, not yet
  decisions: **eject opens the station picker** (a shelf of tapes, one per
  Jukebox station; picking one inserts it), **fast-forward / rewind keys skip
  tracks** (hold to seek?), play / pause / stop keys are the real transport,
  maybe a volume knob. Same assets and `mixtape-manifest.json` as the TV; a
  React renderer. Design: `docs/designs/mixtape.md`, "Phase 2: the kitchen Pi".

### Apple TV / Frame TV app

- **Mixtape follow-ups** (POLISH, after Justin's on-device review) - apply the
  vector brand headers to the "printed" tapes; a label wear overlay; keep the
  tapes' own hub rims visible around the live packs; door edge thickness;
  align the inpainted spindles with the hubs (about 30 px high); verify the
  Siri Remote key press and frame rate on the real TV. Detail in
  `docs/designs/mixtape.md`, "Known gaps".

Phase 1 shipped (per-view mats, Framed Now Playing, Today mat, linear nav, smooth
progress bar). Remaining:

- **TV catch-ups** (TODO, listed 2026-09-25) - the Apple TV has fallen behind
  the web screens: no build stamp, no data freshness stamps, no pixel shift
  (each "TV TODO" under Shared / infrastructure), no "Display server
  unreachable" hint (below), and it sends no heartbeat to the hub's health
  module. One pass to bring it level.
- **Port a Today layout to tvOS** (TODO, after Justin picks one) - React
  first was the plan; port the winner, not all three. `tvos/Sources/TodayView.swift`
  is the current Framed Today; the panel/composition split in
  `docs/designs/today-layouts.md` is the shape to mirror.
- **"Display server unreachable" indicator** (TODO) - the TV swallows all
  manifest/photo fetch errors silently (`fetchJSON` in `AppModel.swift` returns
  nil on any failure), so a down/offline Pi looks identical to "no albums":
  Settings shows "Photo albums: 0 of 0" and the slideshow goes black with no
  hint why (diagnosed live 2026-08-12, Pi off the network). Add a small hint in
  Settings (e.g. "Display server unreachable" on the Photo albums row, or a
  status row showing last successful manifest fetch) so the next occurrence is
  diagnosable from the couch. See **Data freshness stamps** under Shared /
  infrastructure - the general form of this fix.
- **Cold-threshold (35F) Settings row** (TODO) - currently hard-coded; expose as a
  TV-local setting.
- **App name + Brand Assets** (IN PROGRESS) - the **app icon is done**
  (2026-06-12): a layered **wood-frame** parallax icon (back wood frame ->
  art canvas -> inner shadow -> off-white mat -> front bevel) wired into
  `Resources/Assets.xcassets/App Icon & Top Shelf Image.brandassets`, both
  the App Store (1280x768) and Home Screen (400x240/800x480) stacks. Source
  PNGs in `_inbox/tvos_layered_app_icon_wood_frame_assets` (3-layer set: wood
  frame -> artwork -> mat). tvOS requires the backmost stack layer opaque, so
  the wood-frame layer is flattened over a deep-brown (#1E110A) backing at
  build (the frame's transparent corners would otherwise fail actool). Still
  open: **(a)** the app's display name
  (currently "Kitchen Display" - name brainstorm done, not chosen), and
  **(b)** Top Shelf banners (1920x720 + wide 2320x720, needed for App Store
  but not to build/run).
- **Home Assistant auto-launch** (TODO) - school mornings open Today, guests scene
  opens Now Playing. Pursued in a separate session.
- **Launch to Today on school-day mornings** (TODO/VERIFY) - sometimes the TV
  is on Photos in the morning instead of Today (likely the app has been running
  since the prior evening, so the boot picker never re-fires). Needs a
  time-aware re-pick, not just boot-time logic.
- **Dimming phase 2: lux-driven auto** (TODO, BLOCKED on Home Assistant) -
  phase 1 (sunset-anchored auto-dim + manual brightness) shipped 2026-06-10.
  When HA + an illuminance sensor exist: HA publishes living-room lux to the
  Pi's `/api/state`, the TV maps lux -> brightness continuously (with
  hysteresis so a lamp doesn't strobe the art); the schedule becomes the
  fallback. The kitchen's blocked presence-dimming item can consume the same
  signal. Code-tuned curve constants (evening 70%, night 45% at 22:30) may
  deserve Settings rows if the defaults prove wrong.
- **Review inset + drop shadows** (POLISH) - mat shadows read a bit too dark
  on the real screen. Nothing major.
- **Favorite-station picker** (TODO, not P0) - pick a Jukebox station from the
  remote on the TV. Open: what the ingress is (the kitchen's station list
  lives in the web app; the Pi serves `/api/state` + Sonos proxy).
- **Auto-show Now Playing when music starts** (DECISION) - the PRD currently
  forbids mid-session auto-switching. Counterpart to the kitchen auto-interrupt.
- **Multi-room Sonos** (TODO) - transport/volume target "Main" only.
- **Playback-reactive backdrop** (TODO) - the Framed music backdrops (Drift /
  Lava / Marble / Ink) flow at full energy while music plays and settle to
  near-still when paused. No beat sync (Sonos exposes no audio analysis) -
  just ease a speed multiplier on the play/pause state the app already polls.
- **Tempo-locked backdrops via a BPM lookup** (DECISION) - upgrade the item
  above from play/pause to real tempo. Theatrium drives its scenes from track
  BPM without listening to the room either (it says so explicitly: no
  microphone); it looks the tempo up from artist plus title, credited to
  GetSongBPM. We already poll artist and title from node-sonos-http-api, so the
  eight Metal backdrops could lock their speed to actual BPM - which is also the
  only thing that would make `bars` honest, since its own code comment in
  `TVSettings.swift` calls it noise-driven. Open before committing: GetSongBPM's
  free tier requires a visible attribution backlink, coverage on obscure tracks
  is patchy, and it needs a per-track cache plus a clean fallback to the current
  fixed speed on a miss.
- **True-black screensaver step** (TODO) - a third rung below the existing
  auto-dim curve: after N hours, true black with a drifting clock, rather than a
  dimmed picture. Theatrium's measured numbers make the case - on a 65" OLED
  their dashboard draws 65W, the *dimmed* dashboard 60W, and the screensaver
  58W, against a ~58W floor for the panel electronics with no picture. Dimming a
  lit screen saves almost nothing; going black is the whole win. The Frame TV is
  QLED so the burn-in half matters less, but the power half still holds.
- **Live school-morning verification** (VERIFY) - weather-aware walk/drive default
  + timer mirroring are unit-tested but not confirmed on a real morning.
- **Polish** (POLISH) - tune Framed handwritten metadata size/placement on the real
  screen; gradient-fill alternative to the blurred Framed background.

### Shared / infrastructure

- **Lock the kitchen Pi to localhost after the soak** (TODO, from 2026-10-01) -
  the Pi's legacy routes (`/api/state`, `/api/flags`, `/api/lunch`,
  `/api/schoolcal`, `/api/sonos`) and its `node-sonos-http-api` service stayed
  up for a rollback week after 2026-09-24. After a clean week: delete the
  routes listed in the TODO at the top of `pi/kiosk-server.py`, flip `BIND`'s
  default to `127.0.0.1` (and the fallback in `pi/kiosk-restart.sh`), disable
  `sonos-http-api.service` on the Pi, redeploy with `./deploy.sh pi`. Check
  `/tmp/kiosk-server.log` on the Pi first: nothing but the Mac should have
  called those routes since the TV rebuild.
- **Echo Shows: first run on each device** (VERIFY, Justin) - see STATUS
  "Waiting on Me". Three now: `family-room-echo` (Echo Show 10, 1280x800),
  `echo-show15` (Echo Show 15, 1920x1080, landscape) and `echo-show5-office`
  (Echo Show 5, 960x480). All three poll the hub (seen 2026-09-25), but each
  reports a viewport 100 px shorter than its panel (1280x700, 1920x980,
  960x380), which reads as Silk's toolbar still showing (fullscreen not on).
  Still to confirm on the devices: fullscreen after a tap, does the
  one-minute audio reload keep Silk off the Alexa home screen overnight, does
  the night clock drift, does the chip hide.
- **Echo Show 15 in portrait** (TODO, later) - the panel rotates, but the app
  assumes 1920x1080 landscape throughout (slideshow portrait pairing, the
  Today layouts, the mat). Same project as the portrait front-door screen:
  a real front-end layout, not a config flag. Landscape only for now
  (decided 2026-09-24).
- **Kitchen Pi is underpowered** (TODO, URGENT, do this first) - the Pi 5 runs
  off a USB-A port built into a wall outlet. USB-A cannot negotiate USB-C PD and
  tops out near 5V/2.4A (12W); a Pi 5 wants 5V/5A (27W). Measured 2026-09-22,
  seven minutes after a reset: `throttled=0x50000` (bit 16 undervoltage has
  occurred, bit 18 throttling has occurred) with four `Undervoltage detected!`
  kernel events in the first 50 seconds of boot. **Corrected 2026-09-25: the
  dips are not only inrush.** The kernel's `Undervoltage detected!` count for
  this boot (up since 2026-09-22) read 153 at 23:50 on 2026-09-24 and 201 at
  08:42 on 2026-09-25: dips of about 2 s, 5 to 11 an hour during the day and
  roughly 6 an hour overnight. The supply sags under normal load, all the
  time. The dashboard's Power line shows it live
  since 2026-09-25 (amber, "Undervoltage since boot"). `EXT5V_V` reads 5.03V
  once idle, so the supply is marginal rather than dead, which is exactly the
  profile that hangs a screen unattended and reads as a software fault. The
  likely cause of the 2026-09-22 outage. Fix: the official Raspberry Pi 27W
  USB-C PD supply into a real AC socket. Nothing is wrong with the SD card (no
  I/O errors, no ext4 journal replay) or the Pi itself. **Check the total budget
  on that outlet:** per the front door entry below, the EVICIV panel is also
  powered from an outlet USB port, and a dual-USB outlet typically shares one
  2.4A budget across both ports. A Pi 5 alone wants more than the whole outlet
  can give, so the panel should keep the USB port and the Pi should get its own
  27W charger, not the other way round.
- **No logs survived the outage** (DONE 2026-09-25, VERIFY at the next reboot) -
  `journalctl --list-boots` showed only the current boot because Raspberry Pi
  OS ships `/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf`,
  which keeps the journal in RAM whatever `journald.conf` says. Now
  `/etc/systemd/journald.conf.d/60-persistent.conf` (`Storage=persistent`,
  `SystemMaxUse=200M`, `Compress=yes`) wins, applied live overnight
  2026-09-24/25 without a reboot. Proof waits for the next reboot:
  `journalctl --list-boots` should then list two boots. The heartbeat and
  throttle readout from `docs/designs/sonos-and-state-to-the-hub.md` section E
  shipped the same night (Recently Shipped).
- **Kitchen Pi health follow-ups** (TODO, from 2026-09-25) - (1) the kiosk
  server's own log is `/tmp/kiosk-server.log`, lost at every boot: route it to
  the journal from `pi/kiosk-restart.sh`; (2) the hub keeps each screen's
  latest health report in memory only (a hub restart forgets it until the
  next beat, within a minute; the power events are on disk); (3) the journald
  proof above after the next reboot.

- **Data freshness stamps** (SHIPPED 2026-09-04 on the kitchen, TV still TODO) -
  never render a value without its age.
  Theatrium stamps every panel ("as of 12:36 pm" on markets, "just now" on
  traffic, "10 mins ago" on the webcam, relative ages on notifications), which
  makes stale and unreachable visible instead of silent. This is the general
  form of the TV's "Display server unreachable" bug, where a down Pi looks
  identical to "no albums". Needs a `fetchedAt` on every service response, then
  a shared way to render it. Data-layer work, so it improves the views we ship
  today rather than only the panel board.
- **Pixel shift** (SHIPPED 2026-09-04 on the kitchen, default off; TV TODO) -
  nudge the whole rendered view a pixel or two on an
  irregular timer so no element sits on the same pixels for hours. Roughly
  fifteen lines on each surface. Currently we have no burn-in mitigation of any
  kind; it matters little while every view drifts, and becomes a **prerequisite**
  the moment the static panel board ships (see Active design topics). Irregular
  timing is the point - a fixed interval settles into its own pattern.
- **Build stamp in Settings** (SHIPPED 2026-09-04 on the kitchen; TV TODO) - a
  small version plus build-time line in a
  corner of Settings on each surface (Theatrium shows `v1.6(172) - Aug 10
  08:06`). With a Pi, a TV, a hub and a third screen coming, "which build is
  this screen running" should be answerable from the couch instead of over SSH.
- **Live drive time to school** (TODO) - the morning timer uses fixed
  `drivingDepart` / `walkingDepart` thresholds, so it is wrong on exactly the
  mornings that matter. Theatrium's Traffic and Commute panels draw the route on
  an Apple Maps tile with a traffic-coloured polyline and a "23 min to school"
  readout, and are built on Apple Maps specifically so there is no account and
  no API key - which is the interesting part for us. On tvOS that is MapKit
  directly; the kitchen would need a different source. Data work, so the
  existing timer benefits immediately, ahead of any panel board.
- **Plex second screen follow-ups** (TODO; the view SHIPPED 2026-09-25, see
  Recently Shipped) - (1) test transport control (play, pause, stop, skips,
  captions) once the Apple TV's Plex app advertises as a player (Justin's
  switch, STATUS "Waiting on Me"); (2) a Plex button in the menu pill, to open
  the view by hand; (3) a "New on Plex" panel (recently added to the library)
  for the spec layouts; (4) unit tests for `frameserver/lib/plex.mjs` and
  `tmdb.mjs`, which the hub suite does not cover yet. Design:
  `docs/designs/plex-second-screen.md`.
- **ROADOM as the long-term family-room screen** (DECISION, 2026-09-24) - the
  Echo Show is the quick win; a ROADOM 10.1" on a Pi pointed at the hub
  (`?device=family-room`) would drop the Silk keep-alive dance and the
  one-tap re-arm. Software is ready for it: the same bundle, self-seeding
  registration, and the night face.
- **Lunch + per-kid activities on the Apple TV** (TODO) - kitchen-only today.
- **No-school date *ranges* in the manual override UI** (TODO) - single dates ship
  today (covers snow days).
- **Early-dismissal handling** for the morning countdown (TODO) - treated as a
  normal morning today.
- **Photos with no geolocation** (DECISION) - some photos have no GPS at all,
  so they get no caption and can't be fixed by the radius bubbles. Open: where
  to fix - set location in Immich (it supports editing asset location), or
  extend the kitchen press-and-hold flag flow to cover "no location" photos
  (flag exists, but the triage page needs coords to anchor a bubble).

- **Entry board: what is left of phases 1.5 and 2** (TODO) - shipped: the
  headline's weather rules and National Weather Service alerts, backdrop
  legibility (adaptive darkness, per-panel scrims, blur; both 2026-09-25), and
  per-calendar status on the dashboard (with phase 1). Left: a "suggested
  countdowns" list on the dashboard; multi-day timed events in the headline;
  on-screen Settings rows for `display.entryAdaptive` and `entryBlur` (the
  dashboard has them); the two in the layout editor's Backdrop section (its
  draft carries only `entryBackdrop` and `entryDim`); blur measured on Silk;
  and phase 2's content: the day-part mechanism shipped with the layout
  editor, what morning, evening and weekend show is Justin's to lay out.
  Design: `docs/designs/entry-board.md`.
- **Layout editor nits** (POLISH, from the 2026-09-24/25 build) - a centred
  multi-line headline stays left-aligned inside its block
  (`Entry/SpecPanel.css`); Board saves carry `eveningFrom` (harmless, the
  Board has no day parts); the editor rounds positions to two decimals when it
  loads a spec, so a Board tuned in the editor loses the default's third
  decimal on every box (edges can move by up to 4/64 px at 1280x800). Also
  not built from the design: the right-click menu, safe margins, "freeze
  data". Detail: `docs/designs/layout-editor.md`, "As built (steps 3 and 4)".
- **Home Assistant indicators and buttons on the Entry board** (DESIGN,
  discussed 2026-09-25) - Home Assistant states at a glance by the front door,
  and a few actions. Shape discussed: a hub-side HA module
  (`frameserver/lib/`) with a long-lived token in the hub's `secrets/`, a
  whitelist of entities it may read and actions it may call (nothing else
  passes through), and two panel types for the spec layouts, `hastatus`
  (indicators) and `habutton` (an action), with hold-to-confirm on anything
  that opens the house (garage, lock). Needs from Justin: HA's LAN URL, a
  long-lived token from a dedicated non-admin HA user, and the entity list.
  Pair it with the dashboard PIN below, since the hub has no login. The same
  module would be the way in for the items blocked on Home Assistant (the
  doorbell, presence dimming).
- **Dashboard PIN** (DECISION) - the hub has no login (LAN-only by design), so
  anyone on the network can change every screen from `/admin` and the editor.
  A PIN in front of the dashboard, and in front of any Home Assistant action
  once those exist. Needs Justin's call on the PIN and what it covers.
- **Countdown helpers** (SKIPPED 2026-09-25, kept as an option) - helpers
  around the countdown tiles, which today come only from the `countdown`
  marker typed into an event's description (`entry-board.md`). Not built in
  this round; the "suggested countdowns" list in the Entry board item above
  is the related idea.
- **"On this day" photos** (TODO, idea from 2026-09-25) - photos taken on
  today's date in past years, as a slideshow bias or a panel. The manifest
  already carries each photo's capture date (the slideshow can sort by it).
- **Screen health strip** (TODO, idea from 2026-09-25) - every screen's state
  at a glance (last seen, build, power) in one strip, so a sick screen shows
  without opening its card; the hub has all of it since the health module.
- **Per-photo display override** (TODO, idea, moved from the STATUS Ideas
  Shelf) - "never crop this one." Long-press already flags photos, the hub
  already stores per-device config and the dashboard edits it. Precedence:
  per-photo and device, then per-photo, then the device default. The "Barack
  Obama portrait should not be cropped on the TV" case.

### Cross-cutting themes (design once, use on both surfaces)

- **Google Calendar** - on the web screens since 2026-09-24 (the Entry board);
  TV mirrors later.
- **Multi-room Sonos** - affects kitchen controller and TV.
- **Home Assistant** - auto-launch, doorbell camera, presence dimming all depend on
  it; so would the Entry board's indicators and buttons (discussed 2026-09-25).
- **Auto-show Now Playing** - one rule set should govern kitchen and TV.
- **Today layouts** - Framed vs the panel board, chosen per screen through the
  hub's existing per-device settings. Subsumes the deferred "Configurable Today
  panels" idea.
- **Data freshness** - one `fetchedAt` convention and one way to render it,
  across every service on both surfaces.

---

## Decisions Log

Append-only, newest first. Locked product decisions also live in
`PRD - Smart Displays.md` ("Decisions Made") and `docs/Apple-TV-Display-PRD.md`; this log
captures decisions made during working sessions.

- **2026-09-25 - Countdown helpers skipped for now.** Not built in this
  round; kept in the backlog as an option (Shared / infrastructure).
- **2026-09-25 - Every deploy runs the hub's tests first.** `deploy.sh` runs
  `node --test` over `frameserver/test/` (345 tests: 242 core, 89 headline
  and weather rules, 14 health; no network, no writes outside the OS temp
  dir) before `hub`, `pi` and `migrate`, and a red run stops the deploy before
  anything is touched. `SKIP_TESTS=1` bypasses it, with a warning. The suite
  found no bugs on its first run; it is there for the next change.
- **2026-09-25 - The kitchen Pi's journal is persistent.** Raspberry Pi OS
  keeps the journal in RAM through a vendor drop-in; a drop-in of our own that
  sorts later (`60-persistent.conf`) overrides it, so the next outage leaves
  evidence. 200 MB cap, compressed. Applied live overnight 2026-09-24/25.
- **2026-09-25 - Entry board legibility: soft scrims on the clock and the
  headline by default, adaptive darkness on by default.** The two boxes that
  sit straight on the photo get a soft shade and text shadow; everything else
  is on a card and gets none. The wash follows each photo around the screen's
  own darkness, so an average photo looks as before and only bright or dark
  ones move. Both can be turned off per screen or per box, and off they give
  back the phase 1 board pixel for pixel. Design: `docs/designs/entry-board.md`.
- **2026-09-24 - Plex second screen: scope.** The family-room screen follows
  the living-room Apple TV and shows what is on. Cast and person cards come
  from TMDB, looked up by the ids Plex holds (never by title). Skipped:
  on-screen face matching, song detection, and trailers, music and photos.
  Transport buttons only for a player that advertises itself to Plex. Design:
  `docs/designs/plex-second-screen.md`.
- **2026-09-24 - Weather alerts come from the National Weather Service,
  through the hub.** The hub fetches the alerts for `shared.location` every
  10 minutes, beside its own Open-Meteo forecast, and folds both into the one
  headline every screen shows (`weatherAlerts` and `headline` in
  `/api/state`); no screen talks to the NWS. Warnings (and anything Extreme
  or Severe) outrank even a running event; advisories and the forecast lines
  sit below an event inside the hour. Design: `docs/designs/entry-board.md`,
  "Headline rules".
- **2026-09-24 - The Board becomes a spec layout.** Rather than keep a second,
  fixed grid beside the editable Entry board, the Board is drawn by the same
  machinery from `DEFAULT_BOARD_SPEC` (its old 12 x 6 grid measured into
  percent boxes at 1280x800, the Echo Show 10) and each screen can tune it in
  the editor (`config.layouts.board`). Pixel-identical at 1280x800; up to
  about 3 px off at 1920x1080.
- **2026-09-24 - Layout positions keep three decimals.** Chrome rounds a
  percentage length down to 1/64 px; with two decimals the Board's edges
  missed their old grid lines by up to 4/64 px, enough to move text by a
  subpixel. The spec normaliser keeps three (the editor's own edits still
  write two). Design: `docs/designs/layout-editor.md`.
- **2026-09-24 - A layout editor, on the MacBook, from the admin page.** Justin
  wants to move and size the board's elements himself instead of describing
  pixel changes. Decided: edited only on the MacBook, reached from each
  screen's dashboard card, the real app in an iframe at the exact resolution
  (no second renderer), percent positions so layouts port between the Echo
  sizes, per-element properties (text size and more) not just containers, and
  text and image blocks in the first usable cut. Design:
  `docs/designs/layout-editor.md`. Not built yet.
- **2026-09-24 - Every screen depends on the hub only; the Echo Show joins as
  the third screen.** Justin's calls: finish moving shared services (Sonos,
  `/api/state`, lunch, schoolcal, the flag queue) from the kitchen Pi to
  FrameServer, accepting that the NUC becomes required for music everywhere;
  the family-room Echo Show 10 runs the kitchen web app in Silk from the hub as
  device `family-room-echo`, seeded once from the kitchen (slideshow,
  `sonos.room`, display schedule) then independent, Sonos room Main; at night
  the page stays alive and shows a faint clock (new per-screen
  `display.nightFace`, `clock` on the Echo, `black` on the kitchen); one tap
  to re-arm after an Echo restart is acceptable; ROADOM is probably the
  long-term family-room screen, and Plex second-screen info is a later phase.
  Findings that shaped it: Silk cannot resolve `nuc.local` (nor can the eero's
  DNS), so the hub serves the app and injects a same-origin marker; the hub's
  CORS already allowed PATCH on the live server, so the kitchen's registry
  writes had not been failing (DELETE was the missing verb). Design:
  `docs/designs/echo-show-and-hub.md`.
- **2026-09-24 - One shared house countdown: share decisions, derive
  everywhere.** `useTimer.js` was a per-screen state machine and the kitchen
  posted a derived timer for the TV, so a second web screen would drift.
  Decided: `/api/state` carries only the user's decisions (dismissed today,
  travel override, manual target), last writer wins; one pure module
  (`frameserver/lib/countdown.mjs`) derives the timer on the hub and on every
  web screen; the hub computes the weather travel default and the no-school
  flag so the inputs agree too; the hub still publishes the derived `timer` so
  the Apple TV's decoder is unchanged. The picker-open state stays local.
- **2026-09-23 - Mixtape: a cassette deck Now Playing style, which partly
  reverses the 2026-08-31 "no retro visualiser objects" call.** Justin wants a
  photoreal cassette in a tape deck as a music visualization. Why it is not the
  rejected iPod / mirrorball: those were novelty props floating over the framed
  art, while Mixtape is a photographed still life that replaces the frame
  entirely and is opt-in from the backdrop cycle. Decided: Apple TV first, Pi
  later as a touch-first control surface; full-bleed, straight-on camera; real
  brand logos (private in-home use only); album-keyed tape choice with eject on
  album change and a rewind whir on song change; 12 tapes to start; no sound.
  Assets are built reproducibly in Blender with a shared geometry manifest so
  the Pi port reuses them; logos are hand-made vectors because AI image tools
  garble lettering. Deck style, door and panel extras are chosen from an
  options sheet first. Design: `docs/designs/mixtape.md`.
- **2026-09-23 - Mixtape look chosen from a ChatGPT reference; pipeline pivots to
  camera projection.** Justin skipped the options form and supplied a photoreal
  image of the target (silver 70s deck, framed smoked door, lit VU meters,
  transport keys, tape at about 50%, warm glow, fictional "Horizon HX-7" brand,
  full-face label). Eevee and even Cycles will not reach it, so the plates come
  from the photograph and Blender is demoted to geometry and motion via camera
  projection (photo projected onto a 3D proxy that animates the eject, door and
  key press). Proof of concept and an upscaler bake-off (1672 px source, 3840 px
  screen) run before Phase 1 is re-planned. Design: `docs/designs/mixtape.md`,
  "The chosen look" and "Camera projection".
- **2026-09-23 - Mixtape review: one tape per song, empty well on stop, packs as a
  progress bar.** The design review dropped the album-keyed hybrid (eject on album
  change, rewind whir between songs) for a plain per-song eject: Justin wants to
  see the mechanism often, and the hybrid would have made radio and compilations
  eject per song anyway. A stop ejects to an empty well after a 5 s grace. The
  wind fraction sweeping 70% of the reel in one song is a knowing exaggeration,
  kept because it reads as progress from the couch. Also fixed in review: the
  tape choice hash must be FNV-1a (Swift's `hashValue` is per-process random),
  the manifest is normalised not pixel-based, and the scene is flattened to three
  plates plus sprites rather than ten runtime layers.
- **2026-09-22 - The kitchen Pi was never powered adequately, and it took the
  Apple TV's music and countdown down with it.** The Pi 5 runs from a wall-outlet
  USB-A port: no USB-C PD negotiation and roughly 12W against the 27W a Pi 5
  wants. Measured `throttled=0x50000` with four undervoltage events in the first
  50 seconds of boot. Diagnosed only after a /22 sweep, because the Apple TV
  swallows a dead server silently and kept showing photos and weather the whole
  time. Two structural lessons folded into the backlog: the hub should hold a
  `lastSeenAt` heartbeat (it is always on, so it is the natural watcher), and
  journald on the Pi is running volatile so no logs survived the crash.
- **2026-09-22 - Sonos and /api/state finish the move to the hub, kitchen
  included.** The August migration moved photos but not these two, leaving the
  Pi a single point of failure for the TV. Decided: `node-sonos-http-api` runs
  on the NUC under nssm, FrameServer proxies it, `/api/state` moves with a
  byte-identical shape, `AppConfig.piBase` is deleted, and **the kitchen
  repoints to the NUC as well** rather than keeping a second local service.
  Everything gates on the NUC's zone list matching the Pi's, since SSDP
  multicast on Windows is the one part that can fail environmentally. Scope:
  `docs/designs/sonos-and-state-to-the-hub.md`.
- **2026-09-04 - Three Today layouts built as a per-screen setting, Framed
  untouched.** Board, Briefing and Ambient shipped to `feature/today-layouts`
  behind `display.todayLayout` (default `framed`). Architecture: pure
  presentational panels themed by CSS variables, one data hook, layouts as
  compositions (`docs/designs/today-layouts.md`). Lead decisions during the
  build: the Board's bottom-right tile is the live countdown while a timer runs
  and Now Playing otherwise (music is one of the display's three jobs; the
  Board is the rest-of-the-day view, Framed is the morning instrument); the
  Briefing re-inks the timer band colours for paper; `useTodayData` never calls
  `postTimerState`, so Framed stays the TV's timer authority. React first, TV
  port after a winner is chosen.
- **2026-09-04 - FrameServer CORS blocked every settings write from a browser
  screen.** The preflight listed `GET, POST, OPTIONS`; the screens PATCH. The
  settings store is optimistic and silent, so every write from the kitchen
  panel since the 2026-08-17 migration was dropped and reverted by the next
  10s poll (the tvOS app is unaffected, no CORS in URLSession). Found because
  dev-device writes kept reverting; confirmed with a curl preflight and the
  Pi's plain `chromium --kiosk` flags. Fixed on both sides so deploy order does
  not matter: the hub lists PATCH, the client sends POST (which the hub already
  treated as PATCH and the old preflight allowed). Lesson recorded in STATUS.
- **2026-08-31 - Sourced ideas from Theatrium; the layout ones land as a second
  Today layout, not a rewrite.** Reviewed Theatrium (theatrium.info), a
  commercial tvOS home-dashboard app, including a screenshot audit of its four
  themes, its Settings, and its alert cards. Decision: its panel-dashboard ideas
  go into a **second selectable Today layout** (see Active design topics), while
  Framed Today, Photos and Music keep the mat/placard treatment unchanged. The
  ideas were split by weight rather than adopted as a set: layout ideas to the
  new topic; **freshness stamps, pixel shift, build stamp and live drive time**
  to Shared / infrastructure, because they are data-layer or app-shell work that
  improves the views we already ship; **BPM-locked backdrops** and the
  true-black screensaver to the Apple TV list. Explicitly **rejected**, so this
  is not re-litigated: light sync (needs HA plus Hue, and it is a party feature,
  not a family-display one), the retro visualiser objects (a spinning iPod and a
  mirrorball fight the framed-art aesthetic), stocks / crypto / news panels
  (noise in a kitchen), per-theme panel arrangements, iCloud sync and Family
  Sharing, and a companion app (the kitchen touchscreen already is the
  companion, and TV-settings-live-at-the-kitchen is a deliberate PRD non-goal).
  Two things they do that we should copy verbatim if Home Assistant ever lands:
  alerts are a **pop-up over the current view plus a notification history**,
  never a forced view switch, and any HA automation whose notification ID starts
  with a fixed prefix pops up on the TV, so there is **no per-alert config in the
  app at all**. Worth noting for morale: several things we already ship
  (time-curve auto-dim, ambient warming through the day, generative backdrops
  keyed to album art, art-as-frame with captions off) they arrived at
  independently, and their Estate theme is a light paper-toned serif board,
  which is evidence that a light Today mat would read fine across a room.

- **2026-06-16 - Art albums settled on the MOVEMENT-based "4B" scheme.** The four
  albums are by art movement, not subject theme: `Art - Impressionism &
  Post-Impressionism`, `Art - Romantic, Symbolist & Landscape`, `Art - Early
  Modern & Abstraction (pre-1945)`, and `Art - Postwar & Contemporary (1945+)`.
  The two representational albums split by temperament; the modern bucket splits
  at 1945 for balance and to give a clean "hide the modern stuff" toggle. Albums
  are the screens' only curation lever (`selectedAlbumIds`); a piece may live in
  several. This SUPERSEDES the subject-theme starter set in the 2026-06-15
  decision below. Copyright is treated identically (personal household display):
  copyrighted and public-domain art are archived, indexed, and displayed the same
  way, with an optional `art-metadata.json` `rights` field
  ("public-domain" | "in-copyright") recording status only - it does not affect
  display. Design: `docs/designs/art-collection-lifecycle.md`.
- **2026-06-16 - Immich EXTERNAL LIBRARY is the delivery mechanism for art
  (LIVE).** The art collection is indexed in place from the NAS
  `/volume1/Media/Art` (one copy, no duplication) by an Immich external library
  "Art (NAS)" (import path `/mnt/media/Art` mounted read-only into the
  immich-server container, exclusion `**/_culled/**`). 257 assets scanned, four
  `Art - <movement>` albums assigned by folder. The old managed "Art 01" album
  was retired (deleted; its 90 superseded managed-upload assets trashed). TWO
  Immich libraries now run side by side: the external library (art, in-place) and
  the existing managed `immich-go` library (family / Google Photos + iOS backup);
  the family-photo flow is unchanged.
- **2026-06-16 - Hi-res 4K art on the TV shipped.** For art assets ONLY, the build
  now downloads the Immich original (`GET /api/assets/{id}/original`) and
  downscales it to 3840px long edge (libvips `vipsthumbnail` on the Pi, `sips` on
  macOS; only ever shrinks). Non-art still uses the ~1920px preview. New
  build-host dependency: `libvips-tools` (installed on the Pi); the Pi's
  `pi-photo-refresh` Immich key was granted `asset.download`. First build after
  adding art is heavier (originals fetched once, then reused by filename).
- **2026-06-15 - Art collection organization settled: NAS external library +
  thematic albums.** The growing art collection lives as a single full-res copy in
  the NAS `Art/` folder, indexed in place by an **Immich external library** (no
  duplication, no routine downscaling - the build only pulls Immich's preview).
  Organized into thematic `Art - <Theme>` albums so the screens can curate per
  room via `selectedAlbumIds`. Family photos keep the separate `immich-go` managed
  library. Personal display only the household views, so copyrighted and
  public-domain art are treated identically (optional `rights` metadata field
  retains the distinction). A user review gate (HTML contact sheet in `_review/`)
  precedes any move to the NAS. Backfilling the staged works (~96). Deferred: TV
  hi-res via art-specific ~4K stubs (build change). Design:
  `docs/designs/art-collection-lifecycle.md`.
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

- **2026-09-25 - Pi outage evidence: a persistent journal, a heartbeat, a
  Power line** (hub deployed 08:24, kitchen Pi 08:41, build `812242f`). The
  kitchen Pi's journal survives reboots (`60-persistent.conf`, applied live).
  `pi/kiosk-server.py` posts a heartbeat every 60 s to
  `/api/devices/kitchen/health` on the hub (by name, falling back to the IP):
  the decoded `get_throttled` flags, temperature, uptime, load, memory, disk,
  kernel, model, build, and the kernel's undervoltage dip count and the age of
  the last dip; it also serves `GET /api/health` (17 Python tests). Hub:
  `lib/health.mjs` keeps the latest report per screen, writes power events
  (one per flag per boot, the newest 200) to `health-events.json`, counts a
  screen stale after 180 s, and adds `health` to `/api/devices` and `/healthz`
  (14 tests). Dashboard: a Power line on the Screen card (green OK, amber
  since boot with the dip count, red now, grey stale or no reading) and a
  Power events list. The first heartbeat landed at 08:41 (204); the kitchen
  reads amber, 201 dips this boot. Shots: `_review/hub/`.
- **2026-09-25 - Hub test suite and a deploy gate.** `frameserver/test/*.test.mjs`,
  345 tests on `node:test` (242 core, 89 headline and weather rules, 14
  health), fixtures in `frameserver/test/fixtures/`. Run with
  `node --test 'frameserver/test/**/*.test.mjs'` (Node 22 needs the glob; a
  bare directory fails). `deploy.sh` runs it before `hub`, `pi` and
  `migrate`; `SKIP_TESTS=1` skips it. No bugs found.
- **2026-09-25 - Entry board legibility (phase 1.5)** (hub deployed 08:24).
  Adaptive darkness (`display.entryAdaptive`, on by default: the wash follows
  each photo's brightness behind the text), a per-panel `scrim` (soft on the
  clock and the headline by default), and optional blur (`display.entryBlur`,
  0 to 20 px). Contrast behind the clock over a snow photo went from 5.2 to
  14.2; with both off the board is pixel-identical to phase 1. Dashboard rows
  for both; on-screen Settings rows not yet. Design:
  `docs/designs/entry-board.md`. Shots: `_review/entry/legibility-*.png`.
- **2026-09-25 - Plex second screen** (hub deployed 08:24). The hub polls
  Plex every 5 s and serves what is playing with TMDB cast (`/api/plex/now`,
  `/players`, `/command`, `/person`, `/image`); a screen whose
  `display.plexFollow` names a player switches to a Plex view after 10 s of
  playback (poster, show and episode, air date, progress, summary, six cast
  headshots with person cards, transport when the player advertises) and goes
  home when it stops. `family-room-echo` follows the Apple TV. Transport is
  untested until the Apple TV's Plex app advertises as a player. Design:
  `docs/designs/plex-second-screen.md`. Shots: `_review/plex/`.
- **2026-09-25 - Headline weather rules and National Weather Service alerts**
  (built 2026-09-24, hub deployed 2026-09-25 08:24). NWS warnings above
  everything; advisories and forecast lines (rain, frost, wind, heat, cold)
  above everything but an event that is running or inside the hour;
  `weatherAlerts` in `/api/state`, `weather` and `alerts` in `/healthz`, the
  dashboard glossing the new kinds. The first real one: "Rain from 10 am" at
  08:25. Design: `docs/designs/entry-board.md`, "Headline rules". Shots:
  `_review/entry/headline-*.png`.
- **2026-09-24 - Layout editor, steps 3 and 4** (hub deployed 23:45, build
  `309eb66`). Every panel has knobs from a schema (sizes, weights, days,
  tile styles; the countdown tiles' border, background and radius among them),
  global font, colours, card opacity and radius, spec v2 with day-part
  variants (Morning, Evening, Weekend), the Board as a spec layout, and in the
  editor: a schema-driven inspector, click-into sub-elements, smart guides
  with distances, Add panel, day-part tabs, History from the hub, Copy layout
  to another screen, undo per document. Defaults pixel-identical to before.
  Design and as-built: `docs/designs/layout-editor.md`. Shots:
  `_review/layout-editor/editor3-*`, `panels-*`, `spec2-*`.
- **2026-09-24 - Flip clock Today layout** (hub deployed 23:45). A split-flap
  clock and the date on near-black (`clock`, "Flip clock"), sized from one
  variable so it holds from the Echo Show 5 to 1920x1080, with no data hooks
  at all. It is the office Echo Show 5's Today layout. Design:
  `docs/designs/today-layouts.md`. Shots: `_review/layout-editor/clock-*.png`.
- **2026-09-24 - Every screen depends on the hub only; the family-room Echo
  Show is the third screen** (`feature/echo-hub`, deployed to the NUC, the
  kitchen Pi and the Living Room Apple TV; committed, not merged).
  FrameServer now serves the web app itself (`http://192.168.4.61:8095/?kiosk=echo`
  for Silk, which cannot resolve mDNS) plus every shared service: `/api/state`
  (the shared countdown decisions, the derived timer, the weather travel
  default and the no-school flag), lunch, the school calendar, the photo-flag
  queue (40 flags migrated off the Pi) and a GET-only Sonos proxy in front of
  `node-sonos-http-api`, now an nssm service on the NUC (`SmartDisplaySonosAPI`,
  loopback 5005, `frameserver/setup-sonos.ps1`). Web app: one hub resolver
  (`code/src/lib/hub.js`), the timer derived on every screen from
  `frameserver/lib/countdown.mjs`, Sonos through the hub with stale
  `localhost:5005` bases healed, `/api/display/*` only on a Pi with a panel,
  Echo mode (keep-alive audio, tap to start, fullscreen, night clock,
  reload on deploy), `display.nightFace`, dashboard night face / reload /
  last-seen. Pi: display endpoints loopback-only. TV: `AppConfig.piBase`
  deleted. Verified end to end at 1280x800 against the live hub from the Mac;
  the on-device Silk check is Justin's. Design:
  `docs/designs/echo-show-and-hub.md`.
- **2026-09-24 - Layout editor, steps 1 and 2** (`feature/echo-hub`, deployed).
  The Entry board is now rendered from a per-screen layout spec
  (`config.layouts.entry`, percent positions, universal props, text and image
  blocks; the built-in board is the default), the app has an edit mode
  (`?edit=1`: read-only, no kiosk behaviour, a postMessage bridge reporting
  panel rectangles), and the hub serves a React editor at `/editor/` with the
  real app in an iframe at the screen's resolution: select, drag, resize,
  grid snap, nudge, layers with reorder / hide / lock, add text and image
  blocks, undo and redo, Save, Revert, Reset, backdrop section, sample data,
  screen picker. Dashboard: Edit layout on each web screen's card; the hub
  records each screen's viewport for the canvas size. Design and the as-built
  contract: `docs/designs/layout-editor.md`.
- **2026-09-24 - Entry board, phase 1: the front-door DAKboard replacement**
  (`feature/echo-hub`, deployed; the Echo Show 15 runs it as its home view).
  Hub: Google Calendar through a service account (JWT signed with Node's
  crypto, no dependency; Justin's calendar live, Sheena's pending sharing),
  `GET /api/calendar` with the agenda window and the countdowns marked by
  `countdown` in an event's description (lead days, `label:`, `image:`), the
  Immich album "Countdown Art" synced hourly into `countdown-art/` with
  keywords from file names and descriptions, the headline rules in
  `frameserver/lib/headline.mjs` and Open-Meteo air quality in `/api/state`.
  Web: the `entry` Today layout (clock, weather, what to wear, air quality
  chip, headline, three-day agenda, countdown tiles, the departure countdown
  in the school-morning window) over a photo backdrop with a per-screen
  toggle and darkness slider, and `display.homeView` so a screen can rest on
  Today. Dashboard: calendars and countdown settings, hub status, the art
  library. Design: `docs/designs/entry-board.md`.
- **2026-09-24 - Third Echo: `echo-show5-office`** (Echo Show 5, 960x480, a
  2:1 panel). Same URL pattern, seeded from the kitchen, verified at 960x480
  from the Mac: nothing overflows, the views scale with the viewport units
  they were built in; text is small at that size, as expected on a 5.5"
  screen.
- **2026-09-24 - Second Echo: `echo-show15`** (Echo Show 15, landscape,
  1920x1080). No new code: `http://192.168.4.61:8095/?kiosk=echo&device=echo-show15`
  registers it seeded from the kitchen, and the settings cache tag kept the
  family-room Echo's per-screen values out of it (the trap fixed earlier
  today, now exercised for real). Verified at 1920x1080 from the Mac.
- **2026-09-24 - Dashboard "Show" nudge for every screen.** The admin page's
  Screen card has Show Photos / Today / Now Playing for the kitchen, the Echo
  and the Apple TV: a one-shot `command {action: 'view', view, ts}` in the
  registry, picked up by the web app's settings poll (about 10 s, and it wakes
  a dark screen) and by the TV's hub poll (about 30 s,
  `TVSettingsHubSync.handleCommand` posting `.hubShowView` to `RootView`).
  A nudge, not a pin: the morning schedule and idle rules carry on afterwards.
  Verified on the Echo page from the Mac (Now Playing to Today and back to
  Photos); the TV path is built and installed but not watched.
- **2026-09-24 - FrameServer admin: Music backdrop dropdown.** Already correct
  since `07d851c` (Still 0 .. Marble 7, Mixtape 8); an unset value now shows
  the TV's default (Lava) instead of Still.
- **2026-09-24 - Mixtape: a photoreal cassette deck Now Playing style on the
  Apple TV** (`feature/mixtape`, installed on the Living Room TV, not merged).
  Justin's ChatGPT deck photo camera-projected onto proxies, an inpainted empty
  well, 14 generated tapes with per-tape measured geometry, live reels as a
  progress bar, handwritten labels with album art, per-song eject and insert,
  stop to an empty well. Nine-hour overnight build; design, build log and gaps
  in `docs/designs/mixtape.md`.
- **2026-09-04 - Three selectable Today layouts (kitchen).** Board, Briefing,
  Ambient in `code/src/views/TodayLayouts/`, chosen per screen via
  `display.todayLayout` or previewed with `?layout=<id>`. Verified in headless
  Chrome at 1920x1080 and 1280x800 against live hub photos and weather. Not
  deployed; review from `_review/today-layouts/`. Branch `feature/today-layouts`.
- **2026-09-04 - Kitchen plumbing for the layouts, all default-off or additive:**
  pixel shift (`display.pixelShift`), build stamp in the Settings footer,
  `fetchedAt` on the weather / Sonos / photo hooks, a second Open-Meteo call for
  daily + current + sunrise/sunset, moon phase, a what-to-wear rule, `?demo=1`
  fixtures, `@fontsource-variable/fraunces`.
- **2026-09-04 - FrameServer admin: Today screen card.** Layout (Framed /
  Board / Briefing / Ambient) and Pixel shift per web screen, in
  `frameserver/admin.html`; verified against the live hub through a local
  proxy before deploy. Lands with `npm run deploy:hub`.
- **2026-09-04 - Fix: hub CORS dropped browser settings writes** (see Decisions
  Log). `frameserver/server.mjs` lists PATCH; `lib/settings.js` sends POST.
  Lands with `npm run deploy:pi` (client) and `deploy:hub` (server).
- **2026-08-24 - Fix: the kitchen slideshow stopped advancing.** The hub settings
  poll (every 10s since the hub became the source of truth in `31b4535`)
  re-merged an unchanged payload on every tick, handing every consumer a fresh
  `selectedAlbumIds` array. That new identity rippled through the photo filter
  and the `advance` callback and tore down the slideshow's `setInterval`, so any
  photo duration longer than 10s could never elapse. With the kitchen set to 5
  minutes the screen simply froze on whichever photo was picked at boot. Two
  fixes: `applyFromHub` now deep-compares and drops a no-op poll instead of
  republishing it (which also ends six needless app-wide re-renders a minute),
  and `PhotoSlideshow` reads `advance` through a ref so only a real interval
  change, or photos appearing/disappearing, resets the clock. Verified in the
  running app: zero timer teardowns across five minutes, and the photo advanced
  at t=307s. Deployed to the Pi and confirmed serving.
- **2026-06-16 - Art collection overhaul: 257 works, NAS-organized.** Curated and
  organized the full art collection on the NAS `/volume1/Media/Art` (one full-res
  copy) into four movement-based `Art - <movement>` albums (97 / 67 / 45 / 48),
  plus a recoverable `_culled/` holding folder (14 confirmed duplicates + junk).
  Indexed in place by a new Immich external library "Art (NAS)" (mounted read-only
  into the container, `**/_culled/**` excluded); the old managed "Art 01" album
  retired (90 superseded assets trashed). Acquisition via `dezoomify-rs` (Google
  Arts & Culture) + Wikimedia/museum open-access, staged in
  `_inbox/art-downloads/`, reviewed/culled/assigned via `_review/art-review.html`.
  `art-metadata.json` curated to 257 entries (was 90), 0 orphans, each with a
  specific `movement` and optional `rights`. Design:
  `docs/designs/art-collection-lifecycle.md`.
- **2026-06-16 - Hi-res 4K art on the TV.** The build now fetches the Immich
  original for art assets and downscales to 3840px long edge (libvips
  `vipsthumbnail` on the Pi, `sips` on macOS dev; shrink-only, masters under 3840
  left as-is), writing `immich-<id>-hi.jpg` stubs; non-art keeps the ~1920px
  preview. New `downloadOriginal()` in `code/scripts/lib/immich.mjs` and a
  `resizeMaxEdge` helper + art hi-res path (with preview fallback) in
  `code/scripts/build-photo-manifest.mjs`. Build-host now needs `libvips-tools`
  (installed on the Pi) and the Pi's `pi-photo-refresh` Immich key gained
  `asset.download`. The 4K TV benefits; the ~1080p kitchen panel is unaffected.
- **2026-06-16 - TV morning auto-show fix.** `tvos/Sources/RootView.swift` now
  re-checks the school-morning Today auto-show on app wake (scenePhase active) and
  on a 60s timer, with a once-per-calendar-day latch (`lastAutoTodayDay`) that
  respects a manual choice. Fixes that the boot-only picker never re-ran when tvOS
  resumed a suspended app. Deployed to the Living Room Apple TV.
- **2026-06-16 - Kitchen weather-icon mapping fix.** `code/src/hooks/useWeather.js`:
  WMO code 3 now maps to `overcast` (was `mostly-cloudy`, which left the overcast
  icon unused); snow rebucketed so 73 (moderate) + 85 (slight showers) ->
  `snow` and only 75 + 86 -> `heavy-snow`. (The TV renders weather via SF Symbols
  separately.)
- **2026-06-11 - Framed Now Playing: breathing backdrop.** The blurred album
  wash now drifts on a slow Lissajous wander (x/y on ~53s/67s periods, never
  visibly repeating) with a gentle scale breathe (~75s), transform applied
  after the blur so the GPU re-composites a cached texture (~10 sub-pixel
  updates/s). Cover, hairline progress, and metadata stay still. If it still
  feels too static someday: palette-extracted drifting color blobs (Apple
  Music style) compose underneath - discussed as option B.
- **2026-06-10 - Art fun facts on the Apple TV.** One curated fact per piece,
  handwritten bottom-center on the mat between the placard blocks (up to two
  lines, smaller hand), rotating per showing (advance counter modulo the
  piece's fact count, so repeat visits surface different facts). New "Art
  Facts" Settings toggle (default On). Kitchen counterpart stays in the
  backlog.
- **2026-06-10 - Apple TV auto-dim (dimming phase 1).** Software dimming
  overlay (black scrim + warm tint that scales with dim, so the mat reads as
  paper in lamplight): sunset-anchored auto curve (full by day; ramp to 70%
  over 45 min from sunset via Open-Meteo sunrise/sunset, fetched twice daily
  with a fixed-time fallback; 45% after 22:30; restore at sunrise) or a fixed
  manual level. Settings: "Auto Dim" On/Off + "Brightness" row (reads "Auto"
  while auto is on, 20-100% stepper when off); Settings view itself never dims
  below 85% so it stays adjustable. Settings list is now scrollable (rows
  outgrew one screen). Phase 2 (HA lux sensor) stays in the backlog.
- **2026-06-10 - Art albums: museum placards + shadow-box rendering.** Immich
  "Art *" albums (71 pieces curated: Monet, van Gogh, Hokusai, Krasner, ...)
  display as gallery art on both screens: TV shadow box (blurred wash in the
  mat opening, crisp canvas floating with a soft shadow) with a handwritten
  placard - title + artist bottom-left, year + movement bottom-right (music
  keeps the right corner while playing); kitchen shows full canvas + the
  caption pill (title / artist-year / movement). Art never crops and never
  pairs. Curated `art-metadata.json` (incl. fun facts for a future feature)
  joined by the Pi build; `art-metadata-check.mjs` keeps it honest. Also fixed
  the sim-only debug.fakeMusic flag (was ignored by PhotosView). Design:
  `docs/designs/art-albums.md`.
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

- **2026-06-10 - Merged `feature/apple-tv-display` into main** (merge commit
  31d6af4) after the TV app proved out in daily use. Day-to-day work continues
  on main; origin (GitHub) has not been pushed - push when ready.
- **Branches not on GitHub (2026-09-25)** - `main` matches `origin/main`
  (2026-08-18). `feature/mixtape` (45 commits) and `feature/echo-hub` (65
  commits over `main`, with Mixtape and the Today layouts inside it) exist
  only locally. Merging waits on the Mixtape label pick; pushing does not
  have to.
- **Secrets on the Mac and the hub** - `~/.config/smart-display/` holds
  `google-calendar.json`, `plex-token.txt` and `tmdb-key.txt` (mode 600); the
  hub keeps its copies in `C:\Services\FrameServer\secrets\`. Never in git,
  never in `_inbox/` (it syncs to Dropbox).
- **Photo-flag triage queue** - the queue lives on the hub since 2026-09-24
  (`GET http://nuc.local:8095/api/flags?unresolved=1`, 25 unresolved after the
  migration, 26 on 2026-09-25; `flags-review.mjs` and `flags-apply.mjs` point
  there). The older notes still apply: 7 have no GPS (can't anchor a
  `custom-places` bubble - would need GPS added in Immich + re-import), 2 were
  skipped (`Bridgehaven`, a 2nd `Cave Creek`). Run `flags-review.mjs` to label
  or clear.
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
