---
title: "Photo-Refresh Automation - Pi-Self-Sufficient Build"
created: 2026-06-09
modified: 2026-06-16
version: 1.3
author: Claude Fable 5 (claude-fable-5)
tags: [design, photos, immich, raspberry-pi, automation, kitchen-display]
---

# Photo-Refresh Automation - Pi-Self-Sufficient Build

How new Immich photos (added to an album, or a new album) and caption
corrections reach the displays without a manual Mac-side manifest rebuild +
`npm run deploy`.

**Status: shipped + verified live 2026-06-09.** Decisions locked in
`BACKLOG.md` Decisions Log (2026-06-09). First live run: 1,573 photos,
0 re-downloaded (reuse path), button + 409 single-flight + status endpoint +
both API keys verified.

## Decisions

| Fork | Decision |
| --- | --- |
| Where the build runs | **Pi-first.** The kitchen Pi rebuilds its own manifest. NAS-centralized build (Synology container) is the designated multi-frame architecture; switch when a second photo frame is real. The script is portable, so the migration is an afternoon. |
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
Immich (Synology NAS)
        |  read-only API key
        v
Pi: /home/pi/photo-build/          <- scripts/ + lib/ synced by deploy
    .env                            <- IMMICH_URL, IMMICH_API_KEY,
    custom-places.json                 GOOGLE_API_KEY (Places-restricted)
    .location-cache.json            <- authoritative copy lives here now
        |  node build-photo-manifest.mjs
        v
Pi: /home/pi/kiosk/stub-photos/    <- manifest.json + preview JPEGs
        |  served by kiosk-server.py (:8080)
        v
Kitchen Chromium + Apple TV (5-min manifest polls)
```

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

## Future: NAS migration (when frame #2 arrives)

The Synology (always on, runs Immich, stores the photos) becomes the build
host: a Node container builds once and serves manifest + previews over LAN
HTTP; every frame points at the NAS URL. Carrying over: the same build
script, `.env`, `custom-places.json`, and location cache move to the
container; the kitchen app and `PhotoService.manifestURL` repoint to the
NAS; the refresh endpoint moves (or proxies) there. Logged in `BACKLOG.md`
Decisions Log 2026-06-09.
