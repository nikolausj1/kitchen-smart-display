---
title: "Photo Caption Corrections Workflow"
created: 2026-06-09
modified: 2026-06-09
version: 1.0
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [photos, captions, corrections, immich, custom-places, kitchen-display]
---

# Photo Caption Corrections Workflow

How wrong photo-location captions get fixed: flag on the wall, triage later,
encode as `custom-places.json` bubbles. Companion to
`location-resolution-strategy.md` (which defines how captions are resolved in
the first place).

## The loop

1. **Flag** (kitchen touchscreen) - long-press the photo on screen. The half you
   press is flagged on a portrait pair. A brief "Flagged: <caption>"
   confirmation shows, then back to ambient. Kitchen-only (the TV has no touch).
2. **Store** - the flag (`assetId` + the wrong caption + timestamp) is POSTed to
   the Pi and appended to `/home/pi/flags.json`.
3. **Triage** (Mac, with Claude) - generate a self-serve review page, fill in the
   correct labels, export, drop into `_inbox/`.
4. **Encode + apply** - append `custom-places.json` bubbles, rebuild the manifest,
   deploy, resolve the flags. One bubble fixes the **whole spot** (every photo
   taken inside its radius), not just the flagged photo.

Corrections appear on the next rebuild + deploy (the manual loop the
"photo-refresh automation" topic will eventually streamline).

## Why GPS is not in the manifest (privacy)

`manifest.json` is committed to git. Real home/friend coordinates must not be -
which is also why `custom-places.json` is gitignored. So a flag stores only the
`assetId` (already encoded in the photo filename `immich-<assetId>.jpg`) and the
wrong caption. Coordinates are recovered from Immich at triage time
(`GET /api/assets/{id}` -> `exifInfo.latitude/longitude`). The review page and the
filled export live in gitignored `_review/` / `_inbox/`.

## Components

| Piece | Location | Role |
|---|---|---|
| Long-press detector | `code/src/shell/DebugLog.jsx` | Fires `app-long-press` after ~550ms hold with little movement (never competes with a swipe). |
| Flag handler + toast | `code/src/views/PhotoSlideshow/PhotoSlideshow.jsx`, `overlays/FlagToast.jsx` | Reads the on-screen photo's `assetId`/caption, posts the flag, shows the confirmation. |
| `postPhotoFlag` | `code/src/lib/settings.js` | Best-effort `POST /api/flags` (TV-gated, silent on failure). |
| Pi endpoints | `pi/kiosk-server.py` | `POST /api/flags` (append, dedup by assetId), `GET /api/flags[?unresolved=1]`, `POST /api/flags/resolve`. Stored in `/home/pi/flags.json`. |
| Triage page generator | `code/scripts/flags-review.mjs` | Pulls flags, recovers GPS (Immich) + source (location cache), writes `_review/flag-review.html`. |
| Apply | `code/scripts/flags-apply.mjs` | Reads the filled export from `_inbox/`, appends `custom-places.json` bubbles. |

## Data shapes

Flag (on the Pi):
```json
{ "assetId": "uuid", "wrongCaption": "Magnolia, Seattle", "ts": "ISO8601", "resolved": false }
```
Review export (downloaded from the page, dropped into `_inbox/`):
```json
[{ "assetId": "uuid", "lat": 47.64, "lon": -122.40, "wrongCaption": "...", "correctLabel": "The Bergers", "category": "friend" }]
```
custom-places.json bubble (appended by flags-apply):
```json
{ "name": "The Bergers", "lat": 47.64, "lon": -122.40, "radius_m": 40, "category": "friend" }
```
Default radii by category: home/friend/family 40 m, restaurant/venue 50 m,
school 80 m, work 120 m, park 150 m, other 40 m.

## Running a triage cycle

```bash
cd code
node --env-file=.env scripts/flags-review.mjs      # -> _review/flag-review.html
# open it, fill in correct labels, Export, move flag-corrections.json into _inbox/
node scripts/flags-apply.mjs                        # appends custom-places.json bubbles
node --env-file=.env scripts/build-photo-manifest.mjs && npm run deploy
# flags-apply prints the resolve curl; run it to clear the applied flags
```

## Notes / future

- Flagged photos with **no GPS** appear in the review page disabled (can't place a
  bubble) - those need manual handling.
- The review page shows the resolving **source** (`google_places` vs `geocode`) and
  a Google Maps link as the memory aid. Nearby candidate suggestions (to pick the
  right business without typing) are a deferred enhancement - would need
  `googlePlaces.nearbySearch` extended to return the full candidate list.
- The whole loop is gated on the manual rebuild + deploy; automating that is the
  "photo-refresh automation" topic in BACKLOG.
