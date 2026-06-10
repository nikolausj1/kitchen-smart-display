---
title: "Google Photos to Immich Import - Run Log 2026-06-08"
created: 2026-06-08
modified: 2026-06-08
version: 1.0
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [immich, import, google-photos, kitchen-display, apple-tv]
---

# Google Photos to Immich Import - Run Log (2026-06-08)

Companion to `google-photos-takeout-import.md`. Records what actually happened
during the import session and what remains.

## Summary

The curated year-album batch (Justin's own Google Photos albums named by year,
2019 through 2025) was imported into Immich successfully. The import is complete
and verified. Publishing those albums to the kitchen and TV displays is NOT done
yet - it is paused on a decision (see Pending).

## What changed vs. the original plan

- **Binary:** the downloaded `~/Downloads/immich-go` was a FreeBSD arm64 build
  (won't run on macOS). Replaced with `immich-go_Darwin_arm64.tar.gz` v0.31.0.
- **Content:** the Takeout was not 2-5 topical albums but a self-selected set of
  year-named albums (a starting batch; more to come later).
- **Cleanup:** instead of deleting only the bad-date photos, Justin chose a full
  wipe of Immich for a clean slate before importing.

## Steps performed

1. Installed immich-go v0.31.0 (macOS arm64), verified `version`.
2. Created Immich API key `immich-go-import` (granted all permissions).
3. **Wiped Immich:** force-deleted all 270 pre-existing assets (the earlier
   bad-date import, dates wrongly stamped Feb-May 2026). Library confirmed empty.
4. Dry-run: 2430 assets found, 0 errors, albums detected.
5. Real import (pass 1): completed; a transient network blip dropped a handful at
   the very end (default on-errors=stop).
6. Healing re-run (pass 2, on-errors=continue): picked up the stragglers and
   reconciled album membership (Justin had manually deleted some empty albums
   mid-import; the re-run healed that).

## Final state in Immich (verified)

- **2,379 assets** (1,573 photos + 806 videos), 0 errors.
- 3 assets unimported (missing-metadata edge cases, ~9.5 MB) - negligible.
- **Capture dates correct** (no more today/future-date stamps).
- **GPS preserved on 2,238 / 2,379 (~98%)**, clustering around Seattle/WA.
- **Albums:** 2019 (262), 2020 (175), 2021 (400), 2022 (487), 2023 (398),
  2024 (419), 2025 (241). Plus a stray empty `Art 01` album to delete.

## Displays: NOT published yet (paused on a decision)

Both displays read a pre-built `code/public/stub-photos/manifest.json` that is
generated on the Mac (`scripts/build-photo-manifest.mjs`) and deployed to the Pi
(`npm run deploy`). The Pi has no Node/Immich creds, so this is manual - matches
the BACKLOG item "Automated Immich manifest rebuild (DECISION, BLOCKED)".

**The blocker:** the kitchen display's saved `slideshow.selectedAlbumIds` still
points at the two OLD (now-deleted) albums:

- old `2025` = `a826b0ff-f024-4a87-8748-de2b97fa58b4`
- `Wizarding World 2026` = `3d79e6ff-8236-487c-a1de-898cc921eec5`

The new import created albums with **new IDs**, and "Wizarding World 2026" was not
part of this Takeout. So the instant a new manifest is deployed, the slideshow
filters to album IDs that no longer exist and **goes blank** until albums are
re-selected. That selection lives in the kitchen browser's localStorage
(`kitchenDisplaySettings`); the kitchen is the sole writer and reads only its own
localStorage (see `code/src/lib/settings.js`), so it cannot be fixed remotely -
only in the kitchen Settings UI or via a code change.

Because of this, nothing was deployed. The displays are untouched and still show
the previous cached photos.

### Options to publish (pick one in the morning)

1. **Deploy + manual re-select** - rebuild manifest, `npm run deploy`, then in
   kitchen Settings > Photo slideshow tick the albums (also updates the TV via
   the Pi). ~15 sec of manual work.
2. **Stage only** - rebuild/verify the manifest, deploy together later.
3. **Deploy + auto-reset** - add a one-time migration in `settings.js` that resets
   `selectedAlbumIds` to "show all" when stored IDs aren't in the manifest, then
   build + deploy. No manual re-select, but needs a small tested code change.

To publish manually:
```bash
cd "code"
node --env-file=.env scripts/build-photo-manifest.mjs   # rebuild manifest + previews
npm run deploy                                           # build + rsync + restart Pi
```

## Pending / for Justin to review

- **Decide how to publish albums** (3 options above) - displays currently still
  show the old cached set.
- **Re-select albums** in kitchen Settings after any deploy (old selection is dead).
- **Delete the empty `Art 01` album** in Immich (stray, 0 assets).
- **API key hygiene:** the `immich-go-import` key was granted ALL permissions for
  this job. Pare it back or delete it in Immich now that the import is done.
- **Re-import the rest later:** only 2019-2025 year albums were done this round.
- **Keep the source safe:** retain `~/Downloads/takeout-20260609T041911Z-3-001.zip`
  and the extracted folder for ~a week. Google Photos source is untouched.

## Reference

- Import logs: `~/Downloads/immich-import.log`, `~/Downloads/immich-import-pass2.log`
- immich-go binary: `~/Downloads/immich-go` (v0.31.0, macOS arm64)
- Immich server: `http://192.168.6.128:2283`
