---
title: "Art Collection Lifecycle - Storage Topology + Workflow"
created: 2026-06-15
modified: 2026-06-29
version: 2.1
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [design, art, immich, nas, storage, lifecycle, curation, apple-tv, kitchen-display]
---

# Art Collection Lifecycle

How the growing art collection is stored, organized, and moved from download to
screen. This doc owns the **storage topology and ops**; its companions own the
other halves:

- [art-albums.md](art-albums.md) - the pipeline plumbing (schema, NFC keys, build
  join, rendering).
- [art-metadata-style-guide.md](art-metadata-style-guide.md) - the words +
  acquisition, naming, and sizing of source images.

**Current state:** 257 works curated and live, metadata complete (one entry per
piece, 0 orphans).

## Source-of-truth map

Four stages, each owning one thing. Nothing owns everything.

| Location | Role | Source of truth for |
|---|---|---|
| `_inbox/art-downloads/` (Mac) | Staging / scratch | nothing (disposable) |
| NAS `Art/` (Immich external library) | The art collection | **the image bytes** |
| `art-metadata.json` (git) | Editorial | **the words** (title/artist/year/movement/facts) |
| Immich albums | Index + delivery | rebuildable from the NAS folder (re-scan) |
| Screens (Apple TV + Pi) | Consumers | nothing (pure view) |

The NAS `Art/` folder is the source of truth for the **bytes**;
`art-metadata.json` is the source of truth for the **words**; Immich is a
**rebuildable join** of the two. Lose Immich and you re-scan the NAS folder; the
metadata re-joins automatically by filename. This is why the
`Title - Artist Year.ext` naming convention is load-bearing: the NAS filename ==
the Immich `originalFileName` == the `art-metadata.json` key. (NFC normalization
on both sides handles macOS/Immich Unicode differences; see art-albums.md.)

## One copy, no duplication: Immich external library

Art is delivered through an **Immich external library** pointed at the NAS `Art/`
folder. Immich indexes the files **in place** (read-only - it never moves or
deletes them), generates its own previews, and the build pulls those previews
(or, for art, the original - see "Hi-res art on the TV"). There is exactly **one
full-resolution copy** of each artwork (in the NAS folder), no separate "display"
copy.

The folder lives at NAS `/volume1/Media/Art` (mounted on the Mac at
`/Volumes/Media/Art`, and inside the Immich container at `/mnt/media/Art`,
read-only). The 257 works are organized into **four movement-based albums**, plus
a `_culled/` holding folder that Immich ignores:

```
NAS  /volume1/Media/Art/                          # single source of truth for art bytes
  Art - Impressionism & Post-Impressionism/       # 97  (subfolder name == Immich album name; matches /^Art\b/)
  Art - Romantic, Symbolist & Landscape/          # 67
  Art - Early Modern & Abstraction (pre-1945)/     # 45
  Art - Postwar & Contemporary (1945+)/           # 48
  _culled/                                         # 14  confirmed dupes + junk; recoverable, NOT imported (excluded via **/_culled/**)
```

Why this and not managed import: `immich-go` (the family-photo path) makes Immich
keep its *own* copy, which would mean two copies of every artwork on the same NAS.
The external library avoids that while still letting Immich generate previews.

## Two Immich libraries, side by side

Immich runs both library types at once; they are independent.

- **Art** -> external library on NAS `Art/` (this doc).
- **Family / travel photos** -> existing `immich-go` bulk import + iOS
  auto-backup, a separate **managed** library (unchanged; see BACKLOG "Add new
  photos from Google Photos").

Both feed the same manifest build. The build's `/^Art\b/` album-name match is what
flags art, regardless of which library an album came from - so adding the external
library changes nothing about the family-photo flow.

## Album strategy: by movement (the "4B" scheme)

Albums are named `Art - <Movement>` (the `\b` in `/^Art\b/` keeps non-art names
like "Artisan Market" out). The collection is split into the four movement albums
listed above rather than by subject theme (Landscapes / Cityscapes / ...) or by
numbered batch.

Why movements: the screens' only curation lever is `selectedAlbumIds` (which
albums are shown), so the album names have to make a meaningful picker. The four
buckets fall into two representational albums plus two modern ones:

- The **representational** work splits by temperament -
  *Impressionism & Post-Impressionism* (the brighter, looser canvases) vs
  *Romantic, Symbolist & Landscape* (the older, moodier ones).
- The **modern** work splits at **1945** - *Early Modern & Abstraction (pre-1945)*
  vs *Postwar & Contemporary (1945+)*. The 1945 line both balances the bucket
  sizes and gives a clean "hide the modern stuff" toggle (deselect the two modern
  albums and the screens stay entirely representational).

Numbered batches ("Art 01 / Art 02") were rejected as a useless selection menu. A
piece may live in several albums; it shows if any selected album contains it.

## Immich external library: as configured

The external library is live. As set up:

- **Container mount:** the immich-server service in the Synology Container Manager
  compose mounts the NAS folder read-only -
  `- /volume1/Media/Art:/mnt/media/Art:ro`.
- **External Library "Art (NAS)":** import path `/mnt/media/Art`, exclusion
  pattern `**/_culled/**` (so the holding folder is indexed by nobody).
- **Scan:** 257 assets were scanned in; each `originalFileName` matches its
  on-disk filename.
- **Albums:** the four `Art - <Movement>` albums were created and every asset
  assigned by its folder.
- **Old managed album retired:** the previous managed-upload "Art 01" album was
  deleted and its 90 superseded assets trashed, leaving the external library as
  the single art path.

## Hi-res art on the TV

For **art assets only**, the build fetches the Immich **original**
(`GET /api/assets/{id}/original`) and downscales it to a 3840px long edge, writing
an `immich-<id>-hi.jpg` stub - so the 4K TV shows true high-resolution art.
Non-art photos still use the ~1920px preview (`?size=preview`); the kitchen panel
is ~1080p and unaffected.

Downscaling uses a CLI tool to keep the build free of npm image deps:
`vipsthumbnail` (libvips) on the Pi, `sips` on macOS for dev. It only ever shrinks
(never upscales), so masters smaller than 3840px are left as-is. Two dependencies
make this work: the **build host needs `libvips-tools`** installed (done on the
Pi), and the Pi's `pi-photo-refresh` Immich API key was granted **`asset.download`**
(needed to pull originals). The first build after adding art is heavier (it
downloads originals once); stubs are reused by filename afterward, so nightly runs
stay fast. (Implementation: `downloadOriginal()` in
`code/scripts/lib/immich.mjs`; a `resizeMaxEdge` helper plus the art hi-res path,
with a safe fallback to the preview, in
`code/scripts/build-photo-manifest.mjs`.)

## Per-piece lifecycle

1. **Acquire** into `_inbox/art-downloads/` (never straight to the NAS). Tools per
   the style guide "Acquiring source images": `dezoomify-rs` for Google Arts &
   Culture, browser-UA GET for Wikimedia originals, browser-UA scrape of
   auction-house lot pages (Christie's / Sotheby's) for contemporary works.
2. **Rename + propose:** canonical `Title - Artist Year.ext`, plus a proposed
   movement and draft title/artist/year. The name is frozen from here on.
3. **Review gate (the user):** Claude generates a self-contained HTML contact
   sheet in `_review/art-review.html` (thumbnail + filename + proposed movement +
   copyright + draft metadata per piece). The user reviews the images in staging,
   culls rejects, and confirms or adjusts movements; decisions export to
   `_inbox/art-decisions.json`. **Nothing leaves staging until approved.**
4. **File** approved pieces into the right NAS
   `Art/Art - <Movement>/` folder. Full-res; no downscaling at the source (only
   cap a true gigapixel monster if Immich's thumbnailer struggles - see the style
   guide "Sizing"). The build does its own 3840px downscale for the TV at
   manifest time (see "Hi-res art on the TV").
5. **Immich scan** picks them up into the matching album.
6. **Curate metadata:** from `code/`,
   `node --env-file=.env scripts/art-metadata-check.mjs` lists missing pieces;
   author entries per the style guide; re-run until clean. Optionally set a
   `rights` field (`"public-domain"` / `"in-copyright"`) to retain copyright
   knowledge - display-neutral.
7. **Refresh:** kitchen Settings "Refresh photos" or the nightly 3am run; both
   screens update within ~5 min.
8. **Empty staging.**

## Copyright

This is a personal display only the household views, so copyrighted and
public-domain art are treated identically - both archived, indexed, and shown. No
copyright-based separation. The optional `rights` metadata field is the only place
copyright status is recorded, and it does not affect display.

## Future

When a second frame arrives, the build host migrates from the Pi to the NAS (see
[photo-refresh-automation.md](photo-refresh-automation.md)) - the NAS already
holds Immich and the art masters, so the external library and this folder layout
carry over unchanged.
