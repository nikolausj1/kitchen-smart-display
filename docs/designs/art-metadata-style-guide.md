---
title: "Art Metadata Style Guide - Tone + Rules for art-metadata.json"
created: 2026-06-15
modified: 2026-06-29
version: 1.5
author: Claude Opus 4.8 (claude-opus-4-8)
tags: [design, art, metadata, curation, style-guide, tone, apple-tv, kitchen-display]
---

# Art Metadata Style Guide

The editorial rulebook for `art-metadata.json` (project root): how each field is
written, what tone the fun facts take, and what makes a fact worth showing. It
also documents how source images are acquired, named, sized, and sorted (see
"Acquiring source images" below). This is the companion to
[art-albums.md](art-albums.md), which covers the technical pipeline (schema, NFC
keys, build join, rendering). When the two overlap, art-albums.md owns the
plumbing and this doc owns the words.

**This file is the source of truth for content decisions.** Justin edits it to
change the rules; Claude reads it before curating any new pieces.

## Where the words show up

Both displays read the same entry, so write once for both:

- **Kitchen placard** and **TV placard**: title, artist, year, movement.
- **TV rotating "Art Facts"** (shipped 2026-06-14, gated by the Art Facts
  toggle): the `facts` strings rotate on the mat under the canvas. Facts are
  read at a glance from across a room, sometimes aloud by kids. Write them to
  be read, not skimmed on a phone.

## Golden rules

1. **Accuracy over interest.** A fact you cannot verify does not go in. When in
   doubt, leave it out - this matters more, not less, at 5-10 facts per piece on
   a screen read aloud by kids.
2. **Earn the screen.** Never restate what the placard already shows (title,
   artist, year, movement). The fact should teach something the placard cannot.
3. **Plain, warm, confident.** Short declarative sentences. No art-critic
   adjectives standing in for facts ("a stunning masterpiece"). No hedging
   ("perhaps", "it is said") unless the uncertainty is the point.
4. **Family room, all ages.** A kid might read it out loud. Keep it
   age-appropriate and non-graphic; state hard history plainly and briefly, do
   not dwell or sensationalize.

## Field rules

### title
- Clean the filename into a proper title. Title-case, real punctuation.
- Keep a translation or location in parentheses if the filename has one:
  `In the Dunes (In de Duinen)`, `Une fenetre (A Window)`.
- Untitled works: `Untitled (Textile design no. IV)` - keep the descriptor the
  source gives, normalize "no IV" to "no. IV".

### artist
- Full, conventional display name: `Pierre-Auguste Renoir`, `Vincent van Gogh`.
- Initials form only where that is the standard usage: `J. M. W. Turner`.
- Preserve diacritics exactly: `Edouard Vuillard` is wrong, `Édouard Vuillard`
  is right. (The JSON file is authored in NFC; see art-albums.md.)
- Unknown artist: leave `""`. The date line collapses to nothing and the
  placard shows title only. Do not invent an attribution. Flag it for Justin.

### year (display string) + sortYear (hidden int)
- `year` is what shows on the placard; `sortYear` is an integer that only drives
  chronological ordering and is never displayed.
- Exact year: `"1888"`, `sortYear 1888`.
- Known month: `"February 1890"`. Decade: `"1870s"`, `sortYear` = first year.
- Range: `"1930-1934"`, `sortYear` = first year.
- **Estimated** year: prefix `c.` (or `ca.` to match a source that uses it):
  `"c. 1872"`. Only estimate when you have a sound art-historical basis (a known
  period in the artist's career, a documented series). Set `sortYear` to the
  estimate.
- **Unknown** year: fall back to the artist's lifespan as the displayed year,
  e.g. `"1841-1919"`, so the placard reads "Pierre-Auguste Renoir, 1841-1919"
  (the museum-label convention) instead of showing the artist alone. Set
  `sortYear` to a best-guess mid-career year so ordering stays sane. Never
  fabricate a precise work date to fill the slot. Leave `year` `""` only when
  the artist is also unknown.

### movement
- Use an established label. Common ones in this collection: Impressionism,
  Post-Impressionism, Neo-Impressionism, Romanticism, Realism, Naturalism,
  Fauvism, Expressionism, Orphism, Synchromism, Modernism.
- Regional or period labels are fine when they fit better than a global -ism:
  `Greek Modernism`, `Early Dutch period`.

### facts
- **Count:** aim for up to 5-10 where the material genuinely supports it (famous
  works will); never pad to hit the count - obscure works may have only 2-3 solid
  facts, and that is fine. Quality gates quantity.
- **Length:** one sentence each, roughly 15 to 35 words. Two short clauses max.
- **Self-contained:** each fact stands alone (they rotate independently).
- **No trailing source citations** in the string. Verify privately, then write
  the clean sentence.

## What makes a good fun fact

Aim for one of these angles (in rough order of preference):

- **The story of this work**: who it was made for, where, the moment it
  captures. *"Painted as a gift for his newborn nephew, to hang over the baby's
  bed."*
- **Technique or method**, named and explained briefly. *"Constable called his
  open-air sky sketching 'skying.'"*
- **The artist's role in the movement**. *"Russell co-founded Synchromism, one
  of the first American abstract movements."*
- **A concrete place or subject fact**. *"Ciboure is a Basque fishing village on
  France's Atlantic coast."*
- **A surprising biographical hook** tied to the work or its making.

Avoid:

- Restating the placard (title/artist/year/movement).
- Empty praise or mood words as if they were facts.
- Unverifiable legends or anecdotes presented as true.
- Auction prices and market trivia (unless genuinely a point of interest).
- Long, multi-clause sentences that lose a reader mid-mat.
- Graphic or upsetting detail. Hard facts (a death, a war) are stated once,
  plainly, and kept brief.

## Sourcing and dates

- These images are largely from **Artvee.com** (public-domain scans). The
  Artvee artwork page lists a date and often the collection; use that date as
  the primary source for `year`/`sortYear`.
- For everything else, verify against a museum/collection page or a reliable
  reference before asserting. A search-result snippet alone is not enough to
  pin a generic title (many works share a title like "Les Arbres" or "Summer
  Landscape").
- If the date cannot be verified, follow the **Unknown** year rule above rather
  than guessing.

## Worked examples

**Good** (van Gogh, Almond Blossom, 1890):
> Painted as a gift for his newborn nephew, also named Vincent, to hang over the
> baby's bed.

Specific, warm, tells the story, adds nothing the placard already has.

**Weak, do not ship:**
> A beautiful Post-Impressionist painting of blossoms by a famous Dutch artist.

Empty praise; repeats artist and movement; teaches nothing.

## Acquiring source images

Where art comes from, by copyright status, and the tool for each. Always download
to a staging folder under `_inbox/art-downloads/` (gitignored, transient) - never
straight into Immich.

**Public-domain works** (artist died >95 years ago, or published pre-1929) -
prefer a clean open-access original:
- **Wikimedia Commons** - use the direct `upload.wikimedia.org/...` original-file
  URL (from the Commons file page). Wikimedia's CDN blocks default curl and HEAD
  requests, so download with a real browser User-Agent and a normal GET, and set
  `--connect-timeout` / `--max-time` so one stalled connection cannot hang a
  whole batch.
- **Owning-museum open access** (NGA, Art Institute of Chicago, Met, Rijksmuseum,
  ...) when Commons has only a small file.

**Google Arts & Culture** (the high-zoom "gigapixel" pages) - use `dezoomify-rs`,
the Rust CLI (`brew install dezoomify-rs`). The web / browser-extension version
of dezoomify CANNOT decrypt GA&C images and silently errors; that is the usual
cause of "dezoomify failed." Usage:
- `dezoomify-rs -l "<artsandculture URL>" "out.jpg"` - `-l` auto-selects the
  largest zoom level.
- JPEG caps at 65535 px per side. For larger images add `--max-width 65000` (or
  `--max-height 65000`) to grab the largest encodable level instead of failing.
- If a re-download reports "File exists", delete the partial/zero-byte file
  first - dezoomify-rs will not overwrite.

**Auction-house lot pages** (Christie's, Sotheby's, ...) - the best source for
**contemporary / in-copyright** works, which open archives do not cover. Lot
images are typically **3000 px+ on the long edge and unwatermarked** - far better
than the gallery/retailer fallback below. Christie's image pattern is
`christies.com/img/LotImages/<year>/<sale>/<file>.jpg`. To get it:
- WebFetch is blocked, so scrape the lot page with a real browser User-Agent
  (`curl -A "...Safari..."`); the `LotImages/...jpg` URLs are inline in the HTML.
- The **bare image URL already serves the source's full size.** Size query params
  (`?mode=max`, `?w=4000`, `?maxwidth=4000`) do **not** increase resolution - they
  just re-encode the same pixels smaller. Download the URL as-is.
- A lot page often has multiple views (`_0313_000`, `_0313_001`, ...); the `_000`
  is usually the work itself, later indices are framed/installation shots.
- Lot metadata for naming sits in the page's `og:description` / `description`
  meta tag (title, medium, dimensions, "Executed in <year>").

**Commercial / living-artist prints** (e.g. Bev Doolittle) - when no auction or
open source exists, the work was never digitized openly. Best available is
web-display imagery (~600-1500 px, often watermarked) from gallery/retailer
sites. The real route to quality is the artist's printed art books.

## File naming

Source files follow: `[Title] - [Artist] [Year].ext`
- Separator is space-hyphen-space (` - `) between title and artist; a single
  space before the year.
- **Title**: cleaned and title-cased; keep a parenthetical translation. Sanitize
  characters that are illegal or awkward in filenames - replace `/` and `:` with
  ` - `, drop `?`.
- **Artist**: full conventional name (`Claude Monet`, `J. M. W. Turner`).
- **Year**: the display string - exact (`1908`), `c. 1881`, `ca. 1845`, or a
  range (`1910-1915`, slash converted to dash). Undated work -> the artist's
  lifespan (`1841-1919`); omit the year entirely only when the artist is also
  unknown (e.g. `Untitled - Robert Delaunay.jpg`).

These mirror the `title` / `artist` / `year` field rules above, so a well-named
file maps straight onto its `art-metadata.json` entry.

## Sizing for the displays

Keep the full-resolution master on the NAS - do **not** pre-shrink masters. They
are the archive, and the build derives everything it needs from them. Art is
delivered via an Immich external library on the NAS (see
[art-collection-lifecycle.md](art-collection-lifecycle.md)).

What the screens actually receive (shipped 2026-06-16): for **art assets only**,
the build downloads the Immich original and downscales it to a 3840 px long edge,
writing an `immich-<id>-hi.jpg` stub so the 4K TV gets real detail. **Non-art**
photos keep using Immich's smaller server-side preview (~1920 px). The kitchen
panel is ~1080p and unaffected; only the 4K TV benefits. The downscale happens at
build time using a CLI tool (no npm image deps): `vipsthumbnail` (libvips) on the
Pi, `sips` on macOS dev. It only ever shrinks, never upscales, so a master smaller
than 3840 is left as-is. Because the build does this from the master, there is no
reason to downscale originals by hand - the only thing you store on the NAS is the
full-res master.

## Copyright and organization

This is a personal display only the household views, so copyrighted and
public-domain art are treated identically - both archived, indexed, and shown.
There is no copyright-based folder split. Art is organized by **movement** on the
NAS into four albums - `Art - Impressionism & Post-Impressionism`, `Art -
Romantic, Symbolist & Landscape`, `Art - Early Modern & Abstraction (pre-1945)`,
and `Art - Postwar & Contemporary (1945+)` - which become the Immich albums; see
[art-collection-lifecycle.md](art-collection-lifecycle.md).

Optionally record copyright status in `art-metadata.json` via a `rights` field
(`"public-domain"` / `"in-copyright"`) so the knowledge is retained without
affecting display. Rule of thumb: public domain if the artist died >95 years ago
or the work was published before ~1929 (EU adds life+70, so e.g. Mondrian, d.1944,
is PD since 2015).

## Editing this guide

Change the rules here and bump `modified` + `version` in the frontmatter (no em
dashes anywhere). Claude reads this file at the start of any curation pass and
follows it. The recurring curation workflow itself lives in
[art-albums.md](art-albums.md#curation-workflow-recurring).
