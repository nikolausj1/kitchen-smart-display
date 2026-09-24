---
title: "Echo Show and the Hub - every screen depends on FrameServer only"
created: 2026-09-24
modified: 2026-09-24
version: 1.4
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, frameserver, hub, echo-show, silk, kitchen, apple-tv, countdown, sonos, migration]
---

# Echo Show and the Hub

**Status: built and deployed 2026-09-24** (hub, kitchen Pi, Apple TV) from
`feature/echo-hub`. Verified end to end from the Mac at 1280x800 against the
live hub; the on-device Silk check (one tap, overnight keep-alive) is Justin's.

The family-room Echo Show 10 shows the kitchen web app (Photos, Today, Now
Playing) in its Silk browser, and every screen in the house depends only on
FrameServer on the NUC, never on the kitchen Pi. This finishes the migration
scoped in `sonos-and-state-to-the-hub.md` and adds the third screen.

## Decisions (Justin, 2026-09-24)

- Shared services finish moving from the kitchen Pi to FrameServer. Accepted:
  the NUC becomes required for music on every screen.
- Echo device id `family-room-echo`, its own registry entry, seeded once from
  the kitchen's settings (slideshow, `sonos.room`, display schedule), then
  independent. Sonos room: Main.
- Night: keep the page alive and show a faint clock. New per-screen setting
  `display.nightFace = 'black' | 'clock'`. The Echo defaults to `clock`, the
  kitchen stays `black`.
- One shared house countdown: set, cancel, or travel toggle on any screen
  applies everywhere.
- One tap to re-arm after an Echo restart is acceptable (Silk needs a gesture
  before it will play unmuted audio or go fullscreen).
- ROADOM is probably the long-term family-room screen. Plex second-screen
  info (show, episode, cast, air date) is a later phase; logged in BACKLOG.

## Findings that shaped the design

- Silk on Fire OS cannot resolve `nuc.local` (the eero's DNS returns nothing
  for it either; only mDNS clients see it). So the Echo loads the app **from
  FrameServer by IP**: `http://192.168.4.61:8095/?kiosk=echo`. The NUC has a
  DHCP reservation.
- FrameServer did not serve the React app; `deploy.sh` shipped `code/dist` to
  the Pi only.
- The Pi's `kiosk-server.py` still hosted `/api/state`, `/api/lunch`,
  `/api/schoolcal`, `/api/flags` (+`/resolve`) and the `/api/sonos` proxy. The
  Apple TV read state and Sonos from the Pi via `AppConfig.piBase`.
- Trap: loading the kitchen app on any other device with no URL flags used
  device id `kitchen` and POSTed relative `/api/display/*`, which on the Pi
  drives the kitchen panel's DDC backlight. The Pi's display endpoints accepted
  any LAN caller.
- The hub's CORS preflight already listed PATCH on the live server (fixed
  2026-09-04, deployed); DELETE was missing. The kitchen's registry writes had
  **not** been failing: the client sends POST, which the hub treats as PATCH.
- `useTimer.js` was a per-screen state machine, and the kitchen posted a
  *derived* timer to the Pi for the TV. Two web screens would have drifted.

## Topology after this change

| What | Served by | Client path |
|---|---|---|
| The web app (Echo, laptops, future screens) | FrameServer `/` | `http://192.168.4.61:8095/?kiosk=echo` |
| The web app (kitchen) | still the Pi, `localhost:8080` | unchanged; Chromium resolves `nuc.local` for everything else |
| Photos, manifest | FrameServer | unchanged |
| Per-screen and shared settings | FrameServer registry | unchanged |
| House state: countdown decisions, derived timer, travel default, noSchoolToday | FrameServer `/api/state` | every web screen and the TV |
| Lunch, school calendar | FrameServer `/api/lunch`, `/api/schoolcal` | web screens |
| Photo flags | FrameServer `/api/flags` | kitchen long-press, `flags-review.mjs`, `flags-apply.mjs` |
| Sonos | `node-sonos-http-api` on the NUC (nssm service `SmartDisplaySonosAPI`, loopback 5005), proxied at FrameServer `/api/sonos/*` (GET only) | every screen |
| Panel power and backlight | the Pi, loopback only | the kitchen bundle, same origin |

The Pi keeps its old routes serving for a rollback week, then they go.

## The hub resolver (web app)

`code/src/lib/hub.js` is the one place that knows where the hub is:

1. `?hub=http://host:port` (remembered in localStorage; `?hub=clear` forgets).
2. `<meta name="smart-display-hub" content="self">`, injected by FrameServer
   when it serves `index.html`. Same-origin is the hub, whatever the screen
   typed. `SERVED_BY_HUB` is true here.
3. `PHOTOS.baseUrl` from `config.js` (`http://nuc.local:8095`), the kitchen
   Pi's path.
4. `''` = same-origin relative URLs (samplePhotos dev mode, rollback).

Everything network-shaped goes through `hubUrl(path)`: settings registry,
`/api/state`, manifest, lunch, schoolcal, flags, `/api/sonos`, `/build.json`.

`HAS_PANEL = !SERVED_BY_HUB && kiosk not in (tv, echo)`: only then does
`useDisplaySchedule` POST to the same-origin `/api/display/*`. The Pi also
refuses `/api/display/*` from anything but loopback.

Identity on a hub-served page: `?device=<id>` wins, then the remembered id,
then `family-room-echo` under `?kiosk=echo`, and with nothing at all
`web-guest` (a laptop having a look), never `kitchen`. The kitchen's own
bundle is served by its Pi, so its default stays `kitchen`. The settings
cache in localStorage is tagged with the device id that wrote it; on a
mismatch only the house-wide keys are kept, so switching `?device=` on one
origin cannot seed the new entry with the old screen's per-screen values.

Sonos: `sonos.apiBase` defaults to `hubUrl('/api/sonos')`. A stored
`http://localhost:5005` (the value the hub still held for the kitchen) or an
old `.../8080/api/sonos` is treated as stale and normalised on read, and the
corrected value is written back to the registry. Changing the default alone
would have done nothing, since a stored value beats a default.

## The shared countdown

Screens share only **user decisions**; every screen derives the timer from
the same inputs with the same code, `frameserver/lib/countdown.mjs`
(re-exported to the app as `code/src/lib/countdown.js`).

```
/api/state.countdown = {
  date: 'YYYY-MM-DD',        local date the day-scoped fields belong to
  dismissed: bool,           default timer cancelled today
  travelMode: 'driving'|'walking'|null,   manual override for today
  manualTargetISO: string|null,           a manual timer (self-dating)
  updatedAt, by
}
```

- `POST /api/state {countdown}` replaces the object: last writer wins. Each
  screen applies its own write optimistically and polls `/api/state` every
  10 s to pick up the others.
- `deriveCountdown({ now, school, decisions, travelDefault, noSchoolToday })`
  returns `{ mode, kind, travelMode, target, minutesLeft, band }`. A live
  manual timer wins; else the default arms on a school day from `autoShowAt`
  until 15 min past departure unless dismissed today; else no timer.
- The hub computes `travelDefault` (`{ date, mode, forecast }`) from
  Open-Meteo at `school.walkingDepart.hour`, refreshed every 30 min, and
  `noSchoolToday` from the shared school settings plus its cached calendar. So
  screens never disagree on the inputs either.
- The hub also publishes the derived `timer {active, travelMode, targetISO,
  kind}` so the Apple TV's decoder is unchanged.
- `set-timer` (the picker open) is local UI state, never shared.

`GET /api/state` composes: shared `location` and `school` from the registry,
the kitchen's `slideshow`, derived `timer`, `noSchoolToday`, `countdown`,
`travelDefault`. `postSharedState`, `postTimerState` and
`postSchoolDayState` are gone from the app.

## Echo mode (`?kiosk=echo`)

- Device id defaults to `family-room-echo`, kind `web-echo`, `<body
  data-kiosk="echo">`. Registers with `seedFrom: 'kitchen'`: the hub copies
  the kitchen's `slideshow`, `sonos.room` and display schedule
  (`dimAt/offAt/wakeAt/wakeBrightness/eveningBrightness`) onto the new entry,
  once. `display.nightFace` defaults to `clock` in this mode.
- Keep-alive (the keep-silk-open technique): a looping `<audio>` of a
  self-hosted silent file, muted autoplay first, unmuted on the first tap.
  That tap also requests fullscreen. If Alexa pauses the audio, it resumes.
  A small "tap to start" overlay covers the page until that tap.
- Night: the schedule runs as on the kitchen, but with no panel there is no
  DDC; dim is the CSS overlay and off is the night face: black, or a faint
  drifting clock.
- Reload after deploys: the app polls `/build.json` on the hub every 5 min and
  reloads when the stamp changes. The dashboard also has a Reload button
  (`command: {action: 'reload'}`) and a Night face select per web screen.
- The hub records `lastSeenAt` per device on every config poll; the dashboard
  shows it. That is the outage-visibility item from
  `sonos-and-state-to-the-hub.md` section E.
- Dashboard commands are one-shot `config.command = { action, ts, ... }`
  objects; each screen remembers the last `ts` it ran and ignores anything
  older than two minutes. Actions: `sleep`, `wake`, `reload` (web screens) and
  `view` with `view: photos | today | music` (every screen, the "Show" row).
  A `view` command is a nudge: the screen switches once, wakes if it was
  dark, and the schedule watchers carry on. There is deliberately no pin; a
  per-screen "always show X" would need every watcher to respect it.
- The keep-alive follows the reference keep-silk-open script: a 60 second
  silent MP3 without `loop`, reloaded under a fresh `?q=` cache-buster when it
  ends, so Silk sees a new media load every minute. A failed load backs off
  for 10 s and a single watchdog owns the retry; without that, a page whose
  server had gone away hammered it several times a second.
- A fresh browser profile that first loads after `morningEndsAt` no longer
  jumps to Today: the auto-show watcher only switches inside the morning
  window (it used to fire on any load after `autoShowAt` with no marker for
  the day, which is exactly what the Echo's first run is).

## Adding another Echo

Nothing to build. Echo mode is generic: `?kiosk=echo&device=<id>` registers
`<id>` as a `web-echo` screen seeded from the kitchen (albums, slideshow
timing, dim / off / wake, Sonos room) with the Echo defaults (clock night
face, no panel), after which it is independent and editable on the dashboard.
Screens so far:

| Device id | Hardware | URL |
|---|---|---|
| `family-room-echo` | Echo Show 10 (3rd gen), 1280x800 | `http://192.168.4.61:8095/?kiosk=echo` |
| `echo-show15` | Echo Show 15, 1920x1080, landscape only for now | `http://192.168.4.61:8095/?kiosk=echo&device=echo-show15` |
| `echo-show5-office` | Echo Show 5, 960x480 (2:1) | `http://192.168.4.61:8095/?kiosk=echo&device=echo-show5-office` |

The views are built in viewport units, so they scale to the 5's 960x480
without overflowing; text is small there, as a 5.5" screen is.

Portrait on the Echo Show 15 is a later project: the app is laid out for
landscape throughout (see BACKLOG).

## First run on the device (Justin)

1. In Silk: `http://192.168.4.61:8095/?kiosk=echo` (or the device's URL from
   the table above). The IP, not `nuc.local`.
2. Tap "Tap to start". The chip bottom-left reads `echo · audio on|off ·
   fullscreen on|off` and disappears once both are on (fullscreen "n/a" is
   fine if Silk does not offer it).
3. Leave it 15 minutes: it should still be there. Overnight: the faint clock
   from midnight to 6:00, photos again after.
4. Note the Silk version (whatismybrowser.com) and viewport
   (whatismyviewport.com) once, and confirm `http://nuc.local:8095/healthz`
   fails from Silk, so the docs can stop guessing.
5. The dashboard (`http://nuc.local:8095/admin`) shows it as `family-room-echo`
   with "seen N s ago"; its Night face and Reload page controls are there.

## Rollout order

1. NUC: `node-sonos-http-api` as nssm service `SmartDisplaySonosAPI`
   (`frameserver/setup-sonos.ps1`, idempotent), settings `port 5005, ip
   127.0.0.1`, firewall rules for node.exe from the local subnet: UDP 1905
   (the discovery socket; nothing listens on 1900) and TCP 3500-3509 (UPnP
   event callbacks; the port climbs by one per rediscovery). Gate: `/zones`
   matched the Pi's seven speakers; the one name difference (Basement vs
   Garage) was the Pi's stale cache, the speaker itself says Basement. Note:
   the NUC's Private firewall profile is off, so these rules only bite if it
   is turned back on.
2. Hub: deploy `server.mjs` + `lib/` + the app bundle (`deploy.sh hub`), then
   migrate the Pi's flag queue and fix the registry's stale Sonos base
   (`deploy.sh migrate`).
3. Kitchen: `deploy.sh pi`.
4. Echo: open `http://192.168.4.61:8095/?kiosk=echo` in Silk, tap once.
5. Apple TV: rebuild with `piBase` gone, deploy with `tvos/deploy-device.sh`.
6. After a week's soak: set `KIOSK_BIND=127.0.0.1` for the Pi's server and
   remove its state, flags, lunch, schoolcal and Sonos routes.

## Rollback

- Every client change is a URL or config value; the Pi keeps serving its old
  routes for the soak week, and its `node-sonos-http-api` service stays
  installed.
- `?hub=` overrides the hub per screen without a redeploy.
- The TV needs a rebuild to go back; the previous build is the one on the
  device until then.
