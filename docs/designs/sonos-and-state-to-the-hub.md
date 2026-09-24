---
title: "Sonos and /api/state to the Hub"
created: 2026-09-22
modified: 2026-09-24
version: 1.3
author: Claude Opus 5 (claude-opus-5)
tags: [design, frameserver, sonos, apple-tv, hub, migration, single-point-of-failure]
---

# Sonos and /api/state to the Hub

**Status: built 2026-09-24.** Superseded in detail by
`docs/designs/echo-show-and-hub.md`, which carries the final shape (the app
served from the hub, the shared countdown decisions, lunch, schoolcal and the
flag queue moving too). This document stays as the scoping record.

Corrections from the build (2026-09-24): the service is `SmartDisplaySonosAPI`
(not `SonosHTTPAPI`); discovery needs inbound UDP **1905** and TCP 3500-3509,
not UDP 1900; the house has seven zones, not six; and the gate ran on the NUC
against `127.0.0.1:5005` because the listener is loopback-only, so
`nuc.local:5005` is refused by design.

Scope for finishing the 2026-08 FrameServer migration. Photos moved to the NUC;
Sonos and `/api/state` did not. Until they do, the kitchen Pi is still a single
point of failure for the Apple TV, which is the thing that migration set out to
end.

## Why now

On 2026-09-22 the kitchen Pi went down (underpowered, see BACKLOG). The Apple TV
kept showing photos and weather but silently lost **music** and the **morning
countdown**, because those are the only two things it still reads from the Pi.
Diagnosing it took a LAN sweep, because nothing on any screen says "the server
is gone".

Worth recording plainly: `STATUS.md` 2026-08-16 opens with "the Apple TV fetched
photos, settings, and Sonos through it", then describes moving the photo server.
Sonos was named in the problem and left out of the fix. The entry reads as
though all three moved. It did not.

## Current topology

| What | Served by | Client path |
|---|---|---|
| Photos, manifest, derivatives | FrameServer, `nuc.local:8095` | `AppConfig.photosBase`, `PhotoService.swift` |
| TV per-device settings | FrameServer device registry | `TVSettingsHubSync.swift` |
| Shared settings (location, school) | BOTH: hub `/api/settings/shared` AND Pi `/api/state` | TV reads the Pi copy |
| Sonos | Pi `kiosk-server.py` proxy to `127.0.0.1:5005` | `SonosController.swift` via `piBase` |
| Timer mirror, noSchoolToday | Pi `/api/state`, persisted `/home/pi/state.json` | `AppModel.swift:69` via `piBase` |

`node-sonos-http-api` is a systemd service on the Pi bound to loopback.
`kiosk-server.py` forwards `/api/sonos/<rest>` to it (GET only, 6s timeout) in
`_proxy_sonos`.

Second-order consequence worth knowing: because shared settings ride
`/api/state`, a cold TV launch with the Pi down falls back to
`SchoolSettings.defaults` (7:42 / 7:32) while the hub holds the real values
(7:38 / 7:28). A restarted TV would show a countdown four minutes late, silently.

## Target topology

`AppConfig.piBase` is deleted. The TV depends on `nuc.local:8095` and nothing
else on the LAN. The Pi keeps only what is genuinely Pi-local: serving the kiosk
bundle, DDC display and brightness control, the flag queue, and the school
calendar and lunch proxies the kitchen calls same-origin.

## Work packages

### A. node-sonos-http-api on the NUC

The NUC is ready: Node v24.18.0, npm 11.16.0, `nssm` already installed and
already running `SmartDisplayFrameServer`. Install the app, wrap it as service
`SonosHTTPAPI`, auto-start, bound to `127.0.0.1:5005` so only FrameServer
proxies it.

**This is the only package that can fail for environmental reasons, so it gates
everything else.** Sonos discovery is SSDP multicast (239.255.255.250:1900).
Three known hazards on Windows:

- Windows Firewall blocking inbound UDP 1900. Needs an explicit allow rule.
- Multiple interfaces: the service may bind the wrong one and discover nothing.
  node-sonos-http-api exposes binding and discovery options in its
  `settings.json`; the exact keys need confirming against the version installed.
- The LAN is a /22 (192.168.4.0 to 192.168.7.255) across an eero mesh, with the
  NUC on `.4.61` and the Pi on `.7.131`. Multicast normally crosses eero nodes
  fine, but it is worth proving rather than assuming.

**Verification gate.** `curl http://nuc.local:5005/zones` must return the same
six zones the Pi returns today, and `Main` must report the same playback state
and track. Diff the two responses field by field before anything is repointed.
This mirrors how the photo migration was proven (both manifests diffed to zero
differences) and is the reason that migration went cleanly.

**If discovery will not hold on Windows,** stop and reconsider rather than
shipping something flaky: the fallback is to keep the service on the Pi and
instead move only `/api/state` (package B2), which still removes the countdown
dependency and leaves only music behind.

### B. FrameServer routes (additive, nothing breaks while they land)

**B1. `/api/sonos/*` proxy.** Port `_proxy_sonos` from `pi/kiosk-server.py:604`.
GET only, 6 second timeout, `Cache-Control: no-store`, pass the upstream status
through. Roughly 25 lines of Node. CORS is already `*` and already allows the
methods needed.

**B2. `/api/state` GET and POST.** Keep the response shape byte-identical to the
Pi's so the TV's `SharedStatePayload` decoder needs zero changes. GET composes
the registry's shared settings (location, school, slideshow) with a small
runtime blob (`timer`, `noSchoolToday`); POST accepts that runtime blob from the
kitchen and persists it beside the registry. Note the hub already owns shared
settings at `/api/settings/shared`, so this route is a composition, not a second
copy. Do not let the two diverge.

### C. Clients

**TV.** Delete `piBase` from `AppConfig.swift`; derive `stateURL` and `sonos()`
from `photosBase`. This is exactly the "one-line change" the comment above
`piBase` already predicts. Needs an Xcode rebuild and a deploy to the Living
Room device.

**Kitchen.** Two changes, and one trap:

- `postTimerState` and `postSchoolDayState` in `lib/settings.js` POST to
  `/api/state` same-origin (the Pi today). Point them at the hub.
- `sonos.apiBase` default moves from `http://localhost:5005` to
  `http://nuc.local:8095/api/sonos`.
- **The trap:** `sonos` is in `DEVICE_SCOPE`, and the hub already stores
  `sonos.apiBase: "http://localhost:5005"` for the kitchen. A stored value beats
  a new default, so changing the default alone does nothing and the change
  appears to fail. Either PATCH the device records as part of the rollout, or
  have the client treat a stored `localhost:5005` as stale and re-seed it. This
  is the same class of silent failure as the CORS bug: an optimistic store
  hiding a write that never took effect.
- `lib/kioskMode.js` rewrites `sonos.apiBase` for the `?kiosk=tv` web surface.
  Dead for the native TV app; update or delete it in the same pass.
- **Fold in the layout coupling while these call sites are open.**
  `postTimerState` is called only from `views/TodayView/TodayView.jsx`, the
  Framed layout. The three 2026-09 layouts run through `useTodayData`, which
  deliberately does not call it, so selecting Board, Briefing or Ambient on the
  kitchen silently kills the TV's countdown with exactly the symptom this
  migration is meant to prevent. Move the call up into `shell/AppShell.jsx`,
  which already hosts `postSchoolDayState` for the same reason, so it runs
  regardless of layout.

### D. Decommission on the Pi

Leave `/api/state` and the Sonos proxy serving for a rollback window of about a
week, then remove them and disable the Pi's `node-sonos-http-api` service. The
Pi's dormant photo build is already the precedent for keeping a rollback path in
place rather than deleting it on day one.

Note for later: the backlog item "Lunch and per-kid activities on the Apple TV"
would need `/api/lunch` and `/api/schoolcal` to move too. Out of scope here, but
that is the next thing that would re-introduce a Pi dependency on the TV.

### E. Make the next outage visible (recommended, cheap)

Today's diagnosis needed a /22 port sweep. Three small additions would have made
it a glance:

- **Heartbeat in the device registry.** Every screen already polls the hub every
  10 to 30 seconds. Record `lastSeenAt` and show it on the dashboard. The hub is
  always on, so it is the natural watcher.
- **"Display server unreachable" on the TV** (existing backlog item, now more
  valuable since the TV will depend on the hub for everything).
- **Expose `vcgencmd get_throttled`** from `kiosk-server.py` and surface it on
  the dashboard, so undervoltage is visible before it becomes an outage.

## Ordering

1. A, behind its verification gate. Nothing is repointed until `nuc.local:5005`
   matches the Pi's zone list.
2. B, additive. Both the Pi and the hub serve both routes at once.
3. C, one client at a time. TV first, since reverting it is a rebuild and the
   kitchen is the surface the family uses every morning.
4. D after about a week of clean running.
5. E whenever; independent of the rest.

## Effort

| Package | Estimate |
|---|---|
| A, Sonos on the NUC | half a day, mostly if Windows multicast fights back |
| B, FrameServer routes | 1 to 2 hours |
| C, clients | 1 hour plus an Xcode build and deploy |
| D, decommission | 30 minutes |
| E, visibility | 2 to 3 hours |

## Decided 2026-09-22: the kitchen uses the NUC's Sonos API too

One Sonos service in the house, not two. The kitchen repoints from
`http://localhost:5005` to `http://nuc.local:8095/api/sonos` along with the TV,
and the Pi's `node-sonos-http-api` service is disabled in package D.

Rationale: the kitchen already depends on the NUC for photos, so a NUC outage
already degrades it; "NUC = applications, NAS = data" is the house rule and a
Sonos HTTP API is plainly an application; and two services would mean two
installs to patch and two different answers when Sonos misbehaves.

**What this costs, stated plainly.** Today a NUC outage leaves the kitchen
without photos but still playing music. After this it loses both, and the
kitchen's 1.5 second poll goes over the network instead of staying on the box.
That is a deliberate trade of blast radius for one source of truth.

**Two things that make it safe to take:** nssm restarts a crashed service
automatically, which loopback-on-the-Pi never gave us; and the fallback is a
one-line settings change back to `localhost:5005` while the Pi's service is
still installed, which is why package D waits a week.

## Rollback

Every step is reversible with a settings change or a revert:
- C is a config value on each client (TV needs a rebuild; kitchen does not).
- B is additive, so reverting C is sufficient.
- A leaves the Pi's service installed and running until D.
