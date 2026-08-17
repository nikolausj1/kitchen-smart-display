---
title: "Photo-Refresh Automation - FrameServer Build"
created: 2026-06-09
modified: 2026-08-16
version: 2.0
author: Claude Opus 5 (claude-opus-5)
tags: [design, photos, immich, frameserver, nuc, automation, kitchen-display]
---

# Photo-Refresh Automation - FrameServer Build

How new Immich photos (added to an album, or a new album) and caption
corrections reach the displays without a manual Mac-side manifest rebuild +
deploy.

**Status: migrated to FrameServer 2026-08-16.** The build ran on the kitchen Pi
from 2026-06-09; it now runs on the NUC as the `SmartDisplayFrameServer` Windows
service. The Pi's copy remains installed but dormant as the rollback path.
Migration verified by diffing both manifests: 2,176 entries, 13 albums, 348 art,
1,233 with faces, **zero field differences**.

## Decisions

| Fork | Decision |
| --- | --- |
| Where the build runs | **FrameServer on the NUC** (`C:\Services\FrameServer`, `nuc.local:8095`), per the house architecture NUC = applications / NAS = data. Superseded the Pi-first build on 2026-08-16 when a second photo frame became real. The NAS was considered and rejected: Immich lives there, but the build's dominant cost is a one-time-per-asset fetch, not a recurring one, so co-location bought little. |
| Where derivatives live | **Local disk on the NUC**, not the NAS share. They are a *cache* (1.5 GB, regenerable from Immich), so they belong with the app that makes and serves them. This also avoided three problems: UNC paths do not authenticate from a non-interactive Windows session, Immich's external library would have indexed 2,000 resized JPEGs as new assets, and every served image would have crossed SMB. |
| Image resizing | **`sharp`** when the module is present, falling back to the `vipsthumbnail` / `sips` CLIs. sharp bundles libvips so Windows needs no system package; the CLI fallback is what keeps the Pi's dormant build working as the rollback. |
| Triggers | **Button + nightly timer.** A "Refresh photos" button in kitchen Settings, plus a nightly run (3am) so it stays current hands-off. |
| Google Places key | **Yes, on the Pi, restricted.** A key restricted to the Places API only goes in the Pi's `.env`, so new photos at new places keep POI-quality captions. |
| Immich key | Read-only / scoped API key created in Immich for the Pi. |

## Why this works with zero client changes

Both clients already poll the manifest every 5 minutes with no caching:

- Kitchen: `code/src/hooks/useImmichPhotos.js` (`REFRESH_MS`, `cache: 'no-store'`)
- Apple TV: `tvos/Sources/PhotosView.swift` re-fetches via
  `PhotoService.manifestURL` (which points at the Pi)

The Pi rebuilding `manifest.json` + `stub-photos/` in place is picked up by
both displays within 5 minutes. No front-end or tvOS photo-loading changes.

## Architecture

```
Immich (Synology NAS, 192.168.6.128)
        |  read-only API key + asset.download
        v
NUC: C:\Services\FrameServer\       <- scripts/ + lib/ pushed by deploy.sh
     .env                            <- IMMICH_URL, IMMICH_API_KEY,
     custom-places.json                 GOOGLE_API_KEY, plus the path
     art-metadata.json                  overrides STUB_PHOTOS_DIR /
     scripts/.location-cache.json       KIOSK_CUSTOM_PLACES_PATH /
        |                               ART_METADATA_PATH
        |  node --env-file=../.env build-photo-manifest.mjs
        |  (nightly 3:00am "FrameServer Nightly Build" scheduled task,
        |   or POST /api/photos/refresh from any Settings screen)
        v
NUC: C:\Services\FrameServer\photos\  <- manifest.json + derivative JPEGs
        |  served by server.mjs as the SmartDisplayFrameServer service (:8095)
        v
Kitchen Chromium + Apple TV (5-min manifest polls)
```

The kitchen Pi keeps `kiosk-server.py` on :8080 for its own app bundle,
`/api/state`, `/api/flags`, `/api/schoolcal`, `/api/lunch`, the Sonos proxy, and
its panel hardware (`wlr-randr`, `ddcutil`). Only photos moved.

Both clients reach the hub by mDNS (`nuc.local`), never a hard-coded IP - a
stale literal is exactly what broke the tvOS simulator when the Pi's lease moved
from `192.168.4.127` to `192.168.7.131`. Both hosts also hold eero DHCP
reservations.

Because the app is served by the Pi and the photos by the NUC, the manifest
fetch is cross-origin; `server.mjs` sends `Access-Control-Allow-Origin: *`. The
manifest stores app-relative `src` values, so `useImmichPhotos.js` absolutizes
them once on load and every consumer is untouched.

### What lands on the Pi

- **Node 20+** (script uses `fetch` and `--env-file`).
- **`libvips-tools`** (system package, installed on the Pi). The build resizes
  art via the `vipsthumbnail` CLI rather than an npm image library, so the build
  still has no npm image deps - vips is a system package, not a Node module. See
  "Hi-res art on the TV" below.
- **`code/scripts/`** (build script + `lib/`) and a minimal `node_modules`
  (`exifr` is the only dependency; pure JS, fine on ARM). Synced by deploy.
- **`.env`** with `IMMICH_URL`, `IMMICH_API_KEY` (read-only key),
  `GOOGLE_API_KEY` (Places-restricted key). Created once by hand on the Pi;
  never in git, never synced.
- **`custom-places.json`** - synced from the Mac (it changes when
  `flags-apply.mjs` runs there).
- **`.location-cache.json`** - the Pi's copy becomes authoritative since
  rebuilds happen there. Seed it once from the Mac's copy so existing
  coordinates never re-query. Mac dev rebuilds keep their own cache (it is
  only a cache; divergence is harmless).

## Required build-script change: atomic rebuild

`build-photo-manifest.mjs` today wipes all photo files first, then
re-downloads everything. Run in place against the live directory, the
slideshow would 404 for minutes during every rebuild. Change (needed
regardless of where the build runs):

1. Download new previews alongside existing files (filenames are stable per
   asset, so unchanged photos are simply overwritten or skipped).
2. Write `manifest.json` last, atomically (write to a temp name, rename).
3. Prune orphaned photo files (on disk but not in the new manifest) after
   the manifest is written.

The displays then never observe a torn state: the old manifest keeps
pointing at files that still exist until the new one lands in one rename.

## Hi-res art on the TV

The build treats ART assets specially. For art (the four `Art - <movement>`
albums, delivered via the Immich external library "Art (NAS)", separate from
the managed family library) it downloads the Immich ORIGINAL
(`GET /api/assets/{id}/original`) and downscales it to 3840px on the long edge
for the 4K TV, writing an `immich-<id>-hi.jpg` stub. Non-art assets still use
the ~1920px preview (`?size=preview`); the kitchen panel is ~1080p and
unaffected.

Resizing uses a CLI tool so the build stays free of npm image deps:
`vipsthumbnail` (libvips) on the Pi, `sips` on macOS dev. It only ever shrinks
(never upscales), so masters smaller than 3840 are left as-is. This is why the
build host needs `libvips-tools` (see "What lands on the Pi"), and why the Pi's
Immich API key was granted `asset.download` in addition to read access (needed
to fetch originals). First build after adding art is heavier (downloads the
originals once); stubs are reused by filename afterward, so nightly runs stay
fast.

## Triggers

### Refresh button (kitchen Settings)

`kiosk-server.py` gains:

- `POST /api/photos/refresh` - spawns the build script non-blocking.
  Single-flight: if a build is already running, return 409 (or
  `{"running": true}`) instead of stacking a second one.
- `GET /api/photos/refresh/status` - `{running, lastRun, lastResult,
  photoCount, error}` persisted to disk, so Settings can show "last
  refreshed Tue 3:02am, 412 photos" and a spinner while running.

Kitchen Settings gets a "Refresh photos" row wired to these two endpoints.

### Nightly timer

A systemd timer (preferred over cron for journal logging + catch-up
semantics) at **3:00am** runs the same script the endpoint spawns. Both
paths go through one shell wrapper (e.g. `photo-refresh.sh`) so behavior
and logging are identical.

## Source-of-truth flip (deploy changes)

Once the Pi rebuilds its own photos, the Mac's `stub-photos/` is stale by
definition. To prevent `npm run deploy` from clobbering fresher Pi photos
via `rsync --delete`:

- Add `--exclude stub-photos/` to the deploy rsync.
- Deploy additionally syncs `code/scripts/` -> `/home/pi/photo-build/` and
  `custom-places.json` -> the Pi, so build logic and place corrections ride
  along with every deploy.
- Mac development uses `samplePhotos` mode (no `IMMICH_*` env vars), which
  is unchanged.

## Corrections workflow hand-off

`docs/designs/photo-corrections-workflow.md` flow is unchanged through
`flags-apply.mjs`. Its final step changes from "now rebuild and deploy" to:

1. `scp custom-places.json pi@smartdisplay.local:/home/pi/photo-build/`
2. `curl -X POST http://smartdisplay.local:8080/api/photos/refresh`

One command on the Mac; corrections appear on both displays within ~5
minutes of the rebuild finishing.

## Setup checklist (one-time, manual) - all done 2026-06-09

- [x] Create a read-only API key in Immich for the Pi.
- [x] Create a Google Cloud API key restricted to "Places API (New)".
- [x] Node 20+ on the Pi (v20.19.2 was already installed).
- [x] Install `libvips-tools` on the Pi (for `vipsthumbnail`, art hi-res resize).
- [x] Grant the Pi's Immich API key `asset.download` (fetch originals for art).
- [x] Create `/home/pi/photo-build/.env` with the three values (chmod 600).
- [x] Seed `.location-cache.json` from the Mac's copy.
- [x] Install + enable the systemd service/timer (next run 3:01am).

## Caveat: refreshing right after a large import

A refresh fired immediately after an immich-go import races Immich's own
background jobs: previews 404 until thumbnailGeneration finishes (those
photos are skipped for that run) and GPS/date captions are empty until
metadataExtraction finishes. Observed live 2026-06-09: a refresh right after
the 2018-album import picked up only 12 of ~254 new photos. Not a corruption
risk (atomic rebuild just skips them); the fix is to wait for Immich's job
queues to drain (server Administration -> Jobs, or
`GET /api/jobs` with an admin key) and refresh again - or just let the
nightly 3am run catch everything.

The same race applies to the Immich EXTERNAL-LIBRARY scan for art. Right after
scanning newly-added art into the "Art (NAS)" library, Immich's
thumbnailGeneration jobs lag, so a refresh fired too soon skips any art whose
previews/thumbnails are not ready yet. Observed this session: a refresh caught
only 154 of 257 art assets until the thumbnails finished draining. Same fix -
wait for the job queue to drain, then refresh again.

## The migration (done 2026-08-16)

Superseded the 2026-06-09 plan, which named the Synology as the eventual build
host. The NUC won instead, because the house architecture is NUC = applications
/ NAS = data, and the co-location argument for the NAS turned out to be weak:
originals are fetched once per asset and then reused by filename, so the LAN
round trip is a one-time cost, not a recurring one.

What made the cutover cheap:

1. **Seed before building.** Copying the Pi's existing `stub-photos/` (1.5 GB,
   2,177 files) to the hub first meant the first build reported *0 downloaded,
   2,176 reused* instead of re-fetching 348 4K art originals.
2. **Carry `.location-cache.json`.** It is authoritative, and without it the
   build re-queries Google Places for every photo. With it: 1,656 cache hits,
   **0 API calls**.
3. **Diff before trusting.** Both manifests compared field-by-field before any
   client was repointed.

Rollback, valid while the Pi's build stays installed: re-enable
`photo-refresh.timer` on the Pi, set `PHOTOS.baseUrl` back to `''` in
`code/src/config.js`, redeploy, and revert `AppConfig.photosBase`.

### Sharp edges found during the migration

- **`FrameServer` is a built-in Windows service name** ("Windows Camera Frame
  Server"). The service is registered as `SmartDisplayFrameServer`; only the
  display name and directory use the bare product name.
- **UNC paths do not authenticate from a non-interactive session.** `Z:` maps
  are per-logon, and even `\\MissionControl\Media` failed over SSH. This is why
  derivatives are local.
- **The Private firewall profile is disabled on the NUC**, which is why :8095
  needed no rule (and why every other service there is LAN-reachable). Left
  as-is - enabling it would break Plex, Sonarr, Radarr, and SABnzbd.
- **`nuc.local` needed a `known_hosts` entry** before scripted `scp` would work
  under `BatchMode`; its key was verified against the one already trusted for
  `192.168.4.61`.
