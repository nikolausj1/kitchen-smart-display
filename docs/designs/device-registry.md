---
title: "Device Registry - Per-Screen Settings on FrameServer"
created: 2026-08-17
modified: 2026-08-17
version: 1.0
author: Claude Opus 5 (claude-opus-5)
tags: [design, frameserver, settings, multi-device, kitchen-display, apple-tv]
---

# Device Registry - Per-Screen Settings on FrameServer

**Status: shipped 2026-08-17 (Phase 2).** Both screens are registered and running
from hub-held config.

## Why

Before this, the kitchen's `localStorage` was the master and pushed a three-key
subset (`location`, `school`, `slideshow`) to the Pi's `/api/state`.

Note what was and was not already possible. The Apple TV **already** showed
different albums from the kitchen - its picker had been TV-local and independent
since 2026-06-10. So kitchen-vs-TV divergence is not what this unlocked, and the
current 10-albums-vs-3 split predates the registry.

What was impossible was **two web clients differing from each other**: both would
have read the same `slideshow` blob, so the kitchen and a future ROADOM screen
could not have shown different albums. And the TV's independence came at a cost -
its settings existed nowhere but its own `UserDefaults`, could not be changed
except with the Siri Remote, and were lost on reinstall.

So the registry buys three things:

1. Any two screens can differ, web included - verified during rollout with a
   second web device holding `intervalMs 12345` while the kitchen held `60000`.
2. Settings survive a reflash or reinstall.
3. Settings are readable and writable off-device, which is what the Phase 3
   dashboard needs.

## The model

FrameServer holds `devices.json`:

```
{ shared:  { location, school, timerThresholds, weatherSlots },
  devices: { "<id>": { name, kind, createdAt, config: { ... } } } }
```

**Shared** is one value for the family. **Config** is per screen. Values are
stored per-field rather than as opaque blobs, so a `locked` flag could be added
later without reshaping the file. Locking itself is deliberately not built.

Config keys by device kind:

| Key | Kitchen / web | Apple TV |
| --- | --- | --- |
| `slideshow.selectedAlbumIds` | yes | yes - deliberately the SAME key, so the dashboard has one notion of "which albums does this screen show" |
| `slideshow.*` (interval, mode, smart faces, EXIF) | yes | - |
| `display.*` (brightness, dim/off/wake) | yes | - |
| `sonos.room` | yes | - |
| `tv.*` (mats, backdrop, art display, dimming, dwell) | - | yes |

## Endpoints

```
GET    /api/devices                    list + shared
POST   /api/devices/register           self-seeding; NEVER overwrites an existing device
GET    /api/devices/<id>/config        one device (includes shared)
PATCH  /api/devices/<id>/config        deep merge; arrays replace wholesale
DELETE /api/devices/<id>               remove; the device re-seeds if it reconnects
GET    /api/settings/shared
PATCH  /api/settings/shared
```

## The rule that makes it simple

**On-device pickers write to the hub instead of to local storage.** The
on-screen Settings UI and (in Phase 3) the dashboard are then two views over one
store - no sync protocol, no merge rules, no last-write-wins to reason about.
Local storage stays as a cache so a hub outage leaves each screen running on its
last known settings rather than resetting.

## Self-seeding, and why it matters

`POST /api/devices/register` returns an existing device untouched. It only
writes when the device is new. That is what carries live values across the
migration: on first run of the new build, each device hands over what it already
had, instead of accepting code defaults.

This was not theoretical. Caught during the rollout:

- The kitchen was running **60s** per photo against a **6s** default, **10**
  curated albums against a default of "all albums" (art included), and `fill`
  against a default of `smart`.
- The Apple TV was running a **30-minute** dwell against a 30s default, plus a
  non-default brightness, backdrop, art display, and music mat.

The TV's values existed **only** in its own `UserDefaults` and could not be read
remotely, so without self-seeding they would have had to be re-picked by remote.

**Trap worth remembering:** the first client to register an ID wins. During the
rollout a dev server opened without a `?device=` param, defaulted to `kitchen`,
and registered the Mac browser's defaults under that ID. Fix was to delete the
entry and let the real display register first. House-wide settings were
pre-seeded from the Pi's live `/api/state` for the same reason.

## Identity

From the kiosk URL (`?device=living-room`), extending the existing `?kiosk=tv`
pattern, and remembered in `localStorage` so a reload without the param keeps the
same identity. Defaults: `kitchen`, or `web-tv` under `?kiosk=tv`. The Apple TV
uses a compile-time `living-room-tv`.

The hub assigns nothing - devices name themselves. The dashboard can re-point an
existing config at a new device, so reflashing a Pi does not lose its settings.

## Transition state

`postSharedState()` still pushes to the Pi's `/api/state` alongside the hub
write, because the tvOS app reads house-wide settings (location, school, timer)
from there. Drop that call once tvOS reads shared config from the hub too; the
per-device half already comes from the hub.

## Not built, on purpose

Capabilities negotiation (defer until the e-ink panel needs it), heartbeat /
online status, and a remote command queue. None are required by anything asked
for, and each would need an implementation on all three surfaces.

## Not yet exercised

The tvOS **outbound** PATCH is compiled and wired but has not been triggered -
it needs a settings change made with the Siri Remote. Inbound (hub -> device) is
verified, as is tvOS self-seeding.
