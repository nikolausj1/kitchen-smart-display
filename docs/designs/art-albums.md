---
title: "Art Albums - Museum Placards + Shadow-Box Rendering"
created: 2026-06-10
modified: 2026-06-10
version: 1.0
author: Claude Fable 5 (claude-fable-5)
tags: [design, art, photos, immich, apple-tv, kitchen-display, curation]
---

# Art Albums - Museum Placards + Shadow-Box Rendering

Immich albums whose name starts with **"Art"** (regex `^Art\b`: "Art 01",
"Art - Landscapes", ...) hold professional copies of famous artworks. Their
photos display as gallery art instead of family photos:

- **Museum placard** instead of location/date captions: title, artist, year,
  movement.
- **Never cropped** - the whole canvas always shows, on both displays.
- **Shadow box on the TV** (decided from HTML comps 2026-06-10): fixed mat
  opening, blurred wash of the painting filling it, the crisp canvas floating
  centered with a soft drop shadow - the Framed Now Playing treatment.
- **Fun facts** are curated per piece but not displayed yet (backlog).

## Why curation instead of filename parsing

Filenames are loosely "Title - Artist Year.jpg" but far too inconsistent to
parse ("Claude Monetcirca 1872", "Lee Krasner1946" with (c) noise, years in
parentheses mid-title, kebab-case, no separators at all). Instead,
**`art-metadata.json`** at the project root is the curated source of truth,
keyed by Immich `originalFileName`. Curation also fixes wrong filename data
(e.g. a Ziem labeled 1821 - the artist's birth year, not the painting's).

Keys are **NFC-normalized** on both sides at lookup time: macOS uploads land
in Immich NFD-decomposed ("e" + combining accent), while JSON authored here
is NFC. ~15% of the current filenames are affected.

## Schema

```json
{ "pieces": { "<originalFileName>": {
    "title": "Regattas at Argenteuil",
    "artist": "Claude Monet",
    "year": "c. 1872",          // display string ("June 1888", "c. 1870s")
    "sortYear": 1872,            // int; drives chronological ordering
    "movement": "Impressionism",
    "facts": ["1-3 short curated strings (not displayed yet)"]
} } }
```

## Data flow

`build-photo-manifest.mjs` (runs on the Pi, see
`photo-refresh-automation.md`) detects art albums by name, and for their
photos:

- **Skips GPS resolution and the face fetch** entirely (face boxes on painted
  figures would drag the smart crop around a canvas).
- Joins `art-metadata.json` by NFC originalFileName:
  - hit -> `exif.location` = title, `exif.date` = "artist, year",
    `exif.album` = movement (so the kitchen renders a placard with zero
    component changes), plus a structured `art: {title, artist, year,
    movement, facts}` field, and `sortKey = Date.UTC(sortYear, 0, 1)` so
    date-taken ordering doubles as art-history chronology.
  - miss -> build-log warning (`! art asset missing from art-metadata.json`),
    photo shows with empty captions until the curation is updated.
- `ART_METADATA_PATH` env override; on the Pi, `photo-refresh.sh` points it
  at `/home/pi/photo-build/art-metadata.json` (synced by deploy).

## Rendering

**Apple TV** (`tvos/Sources/PhotosView.swift`):
- `ArtStage` replaces `PhotoStage` for art photos when the mat is on:
  blurred `scaledToFill` wash of the painting clipped to the mat opening +
  dark wash, crisp canvas `scaledToFit` at 95% of the opening with a soft
  shadow, normal `MatBorderOverlay` above.
- Placard on the mat (Caveat, pencil ink): **title over artist bottom-left**
  (the existing photo-caption slots), **year over movement bottom-right**
  (the music block's slots). While Sonos plays, the music block keeps the
  right corner and year/movement step aside.
- Art photos never pair (`SlideshowEngine.pickNext` emits them solo) and
  never crop (`CroppedPhoto.plan` forces fit when the mat is off).
- Sim debug: `defaults write <bundle> debug.forceArt -bool YES` filters the
  slideshow to art only.

**Kitchen** (`code/src/views/PhotoSlideshow/PhotoSlideshow.jsx`):
- `resolveCell` forces fit (full canvas over the blurred backdrop) for art,
  whatever the display-mode setting; art never pairs (mirrors tvOS).
- The caption pill needs no changes: title / "artist, year" / movement arrive
  via the exif fields.

## Curation workflow (recurring)

1. Add artworks to an "Art *" album in Immich (filename should contain at
   least title + artist; year helps).
2. Run `node --env-file=.env scripts/art-metadata-check.mjs` (from `code/`) -
   it diffs Immich against `art-metadata.json` and lists missing/orphaned
   pieces (`--json` for machine-readable output; exit 1 if missing).
3. Tell Claude to curate the missing pieces: identify each from its filename,
   verify title/artist/year, add movement + sortYear + 1-3 facts, append to
   `art-metadata.json`. Re-run the check until clean.
4. `npm run deploy` (syncs the metadata to the Pi) + "Refresh photos" (or
   the nightly run). Both displays update within ~5 min of the rebuild.

## Future (backlogged)

- **Display the fun facts** (rotate per showing was the leading idea).
- Custom-cut mat rendering variant was prototyped in comps and dropped in
  favor of the shadow box; revisit only if the shadow box wears thin.
