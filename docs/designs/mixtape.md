---
title: "Mixtape - Cassette Deck Now Playing"
created: 2026-09-23
modified: 2026-10-09
version: 1.7
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [design, apple-tv, kitchen-display, music, now-playing, mixtape, blender]
---

# Mixtape - Cassette Deck Now Playing

## Purpose

A new Now Playing style: a photoreal cassette sitting in a tape deck, seen straight
on, filling the whole screen. The reels turn like the tape is really playing, the
label carries the album art and handwritten metadata, and every time the song changes
it looks like somebody ejected one tape and put in another. There is a collection of
tapes (real vintage brands, different label styles, different amounts of wear), so it
is not the same cassette for every song.

Status: **DESIGN, decided 2026-09-23, reviewed (v1.1). Phase 0 done and the look picked 2026-09-23 (see "The chosen look"); BUILT overnight 2026-09-23/24 on `feature/mixtape` and installed on the Living Room Apple TV; awaiting Justin's on-device review. Not merged.**
Apple TV first; the kitchen Pi follows as its own, more interactive, experience (see
"Phase 2: the kitchen Pi").

Reference image (Justin's inspiration, 2026-09-23): a tilted cassette with a
printed ARTIST / ALBUM / SONG TITLE label, album art on the label, turning hubs, and
a "Now Playing" inset. We keep the tape, label and reels; we drop the inset and the
tilt, and we replace the abstract background with a real deck.

## Decisions (2026-09-23)

| # | Decision |
|---|----------|
| 1 | Both screens, **Apple TV first**. The Pi is a later phase with its own UX. |
| 2 | The tape sits **in a tape deck**. Smoked cassette door **with and without** gets shown as options before choosing. |
| 3 | Mixtape **replaces the mat**: full-bleed, the deck is its own frame. |
| 4 | **One tape per song.** Every song change is a full eject and insert. (The v1.0 hybrid, album-keyed with a rewind whir between songs, was dropped in review: Justin wants to see the eject often. Revisit only if it gets annoying.) |
| 5 | **Eject and insert animation** on every song change, and an eject to an **empty well when playback stops**. |
| 6 | **Real brand logos**: TDK, Maxell, Sony, BASF, Memorex, Fuji. Private in-home use only; never ship this publicly or sell it. |
| 7 | **Label styles are a mix**: pre-printed fields (ARTIST / ALBUM / SONG) and blank ruled lines. Long titles **shrink** to fit. |
| 8 | **Claude makes the assets.** Blender (MCP), OpenAI image generation for textures, Runway and Meshy via their APIs as optional helpers. |
| 9 | **Camera: straight on**, not tilted. |
| 10 | **Radio / missing art**: handwriting only, station name in the album slot. |
| 11 | **Wear range: lightly used to beat up.** Nothing looks brand new. |
| 12 | **No sound.** Audio is on Sonos, not the TV. All "mechanical" feedback is visual. |
| 13 | **Settings / remote**: Mixtape is the 9th stop in the Framed backdrop cycle (center button on the music screen), available when the music mat is Framed. |
| 14 | **Transport key press on the TV**: the deck's own play/pause key visibly goes down when play/pause is pressed on the Siri Remote. Decoration only. |
| 15 | **First batch: 12 tapes** = 6 brands x 2 label styles. |
| 16 | **The tape packs double as a progress bar.** The wind fraction sweeps most of the reel over one song, which a real 45-minute side would not do. Chosen on purpose: it is readable from the couch and fun. The honest alternative (about 9% per song) is noted and rejected. |

Still open, decided by looking at options (see "Look development"): deck style and
era, door on/off, which panel extras (VU meters, tape counter, transport keys)
appear, and how large the tape sits in the frame.

This reverses part of the 2026-08-31 Theatrium decision ("retro visualiser objects
fight the framed-art aesthetic"). The distinction we are drawing: the iPod and
mirrorball were novelty props floating over the art; Mixtape is a photographed still
life that replaces the frame entirely and is opt-in from the backdrop cycle.

## The chosen look (2026-09-23)

Justin answered the options sheet with a reference image he generated in ChatGPT,
kept at `art-src/mixtape/reference/horizon_deck_reference.png` (1672x941): a
straight-on **silver late-70s deck** with walnut cheeks, the tape behind a **framed
smoked door**, two **lamp-lit VU meters**, a row of **transport keys** (REW, PLAY,
FF, STOP, PAUSE) with the PLAY key lit, an output knob and phones jack, no tape
counter, the tape at roughly **50% of frame width**, and a warm amber glow through
the reels. The deck brand is fictional (**Horizon HX-7**), which keeps real logos to
the tapes only. The label is **full-face**: album art at the left, artist / album /
song at the right, the window cut through the middle.

Consequence: Blender renders will not reach this. The plates come from the
photograph; Blender's job becomes geometry and motion, see "Camera projection".

## Camera projection (pipeline pivot, proof of concept 2026-09-23)

The photo is projected from a fixed camera onto a crude 3D proxy (faceplate, well
recess, bottom-hinged door, cassette box, keys). Rendered from that camera the
proxy reproduces the photo; animating the proxy (cassette lifting, door tilting,
key pressing) moves the photo's pixels with the geometry, in the photo's own
lighting. Surfaces the photo never saw (the cassette's underside, the well behind
the door) are filled once by an image-edit inpaint or a flat material. Tape
variants: Blender geometry plus a masked image-edit pass styled on the reference,
with the label and hubs left blank for the vector header, art, handwriting and the
code-driven reels. The 1672 px source needs an upscale to 3840 (bake-off in
progress). Only valid from this one viewpoint, which is the decision anyway.

### Proven 2026-09-23 (packages POC, G, H)

- **Projection holds.** Still matches the photo to 0.95 levels; cassette, door frame
  and key pixels travel with the proxies. Orthographic camera, UVs baked once from
  the camera (a per-frame UV Project modifier makes pixels slide). Remaining
  polish: fake a keystone on the door so it reads as a tilt not a slide; the key
  press needs a shading change to be visible straight on.
- **Deck plate**: empty well inpainted (crop-based edit, pasted back so every
  pixel outside the mask is byte-identical), door split into `door_frame` and
  `door_glass` layers, all at 3840x2160 via Apple VideoToolbox super-resolution.
  Known flaw: the inpainted spindles sit about 30 px high of the tape's hubs;
  hidden by a seated tape, only visible mid-eject. `plate-manifest.json` holds
  keys, meter faces, needle pivots and the well.
- **Tape variants**: masked edits (`gpt-image-1`, `input_fidelity=high`, a 3:2
  slice around the cassette scaled to 1536x1024 and back) place a new shell in
  the same well convincingly. **Geometry drifts per variant** (hub x by up to
  10 px, spacing by 2.6 mm, label edges by up to 19 px at 1672 wide), so the
  manifest carries hub centres, hub radius, window and label rects **per
  variant**, measured automatically by `measure_tape_variants.py`. Reject
  candidates whose slice shifted more than 1 px or whose hubs are more than
  3 px off height or 6 px off spacing. The visible toothed hub ring is about
  5.8 mm, not the 11 mm core; the reel code takes r0 from the measurement.
- Costs this round: about $0.95 (deck) + $1.26 (two tapes); 12 variants at two
  candidates each will be roughly $7.50.

## What the viewer sees

Straight-on view of a deck's cassette well with a tape seated in it. Depending on
the options round, some of: the smoked door over the tape, VU meters, a mechanical
tape counter, a row of piano-key transport buttons. The deck fills the screen; the
tape is the focal point (scale chosen in the options round, somewhere between 50%
and 70% of screen width).

- **Reels**: hubs turn, the brown tape packs grow and shrink with song progress.
- **Label**: album art stuck or printed on the label, artist / album / song in
  handwriting (or print, per variant), long titles shrink.
- **Paused**: reels ease to a stop in about 0.3 s; the deck's pause key is latched.
- **Song change**: eject, brief empty well, new tape inserted with its label already
  written.
- **Stopped**: the tape is ejected and the well stays empty until music starts.

## States

| State | Trigger (from `SonosState`) | What shows |
|-------|-----------------------------|------------|
| Cold start, nothing playing | `loaded && track == nil` | Empty well, door closed, keys up, counter 000. |
| Cold start, music playing | first poll has a track | Tape **already seated**, reels turning. No eject on first appearance. |
| Playing | `playing` | Reels turn, packs track progress, play key latched. |
| Paused | `paused` | Reels stop (ease out 0.3 s), pause key latched, tape stays seated. |
| Song change | tape key changes while a tape is seated | Full eject and insert. |
| Stopped | neither playing nor paused for a **5 s grace** (Sonos briefly reports TRANSITIONING between tracks; the grace avoids a spurious eject in that gap) | Eject, well stays empty. |
| Music starts from empty | a track appears while the well is empty | Insert only (no eject). |
| Loading / unreachable | `!loaded` | Whatever was last shown, frozen. Never animate on a dead server. |

**Rapid skips coalesce.** If the tape key changes again while an eject or insert is
running, the current eject finishes and the insert uses the *latest* track. At most
one eject and one insert per burst.

### The tape key

One string decides "is this a new tape": `title | artist | stationName`, all
lowercased and trimmed. A change in the key is a song change. Blank titles fall back
to the URI-less artist and station so radio without metadata still holds one tape.

## Scene composition

Photorealism comes from pre-rendered plates; only the parts that move on a real tape
move in code. To keep the compositor cheap, the render script **flattens** the scene
into three static plates per combination and a handful of small sprites. Never
composite ten full-screen layers at runtime.

Back to front:

| # | Element | Source | Moves? |
|---|---------|--------|--------|
| 1 | **Deck plate**: faceplate, empty cassette well, everything static on the deck | Blender render, one per deck style, full frame | No |
| 2 | **Tape packs** (supply + take-up) | Code: textured discs, radius from progress | Radius changes, rotates |
| 3 | **Hub sprites** (the toothed spindles) | Blender sprite, shared, small | Rotates |
| 4 | **Tape plate**: interior, guide rollers, shell, window glare, label paper, wear, all flattened; windows and label content area transparent | Blender render, one per variant, **cropped to the tape's bounding box** | As one unit on eject |
| 5 | **Label content**: album art, handwriting or print | Code, inside the manifest's label rect | With tape |
| 6 | **Label wear overlay**, multiply blend, so scuffs cross the ink | Blender / OpenAI texture, per variant, cropped to the label | With tape |
| 7 | **Door plate** (if chosen): tint + reflection, plus a 16-frame swing sequence | Blender, per deck style | Opens and closes on eject |
| 8 | Deck extras: counter digits, VU needles, key states | Blender sprites + code | Yes |

Elements 2 to 6 form the **tape group**, which moves as one unit during eject and
insert. Static plates sit outside the animation subtree; only the tape group, the
door and the extras live under the `TimelineView`, the same isolation Drift uses
for its post-blur transform.

Auto-dim (the existing `Dimmer`) applies on top of everything, as it does today.

### Resolution and crop safety

- Render every plate at **3840x2160**; the Apple TV 4K composes at that size and
  the mat metrics already use that frame. The Pi downsamples.
- The living-room ROADOM screen is **1280x800 (16:10)**, so the deck is composed to
  survive a centred 16:10 crop: tape, meters, counter and keys sit inside the crop,
  and the outer 6% top and bottom carry nothing that matters.

### The variant manifest

Positions are never hand-tuned in Swift or CSS. The Blender render script exports
`mixtape-manifest.json` alongside the images. **All coordinates are normalised**
(0 to 1 of the full plate's width and height), so 3840x2160, 1920x1080 and a 16:10
crop all read the same file.

- per deck style: well rect, door rect and hinge edge, counter rect, VU needle
  pivots and sweep, key rects;
- shared tape geometry: both hub centers, hub radius, full-pack radius, tape sprite
  rect (where the cropped tape plate sits), label rect, art slot rect, text line
  baselines, x-height and max widths per label style;
- per variant: id, brand, SKU it emulates, label style, wear level, ink color, font,
  image file names;
- `hashCheck`: an input string and its expected FNV-1a value, so both renderers can
  prove they pick the same tape.

Both apps read this same manifest. That is what makes the later Pi port cheap: the
art and the geometry are shared, only the renderer differs.

## Reel physics

A real deck pulls tape past the head at a constant 4.76 cm/s, so a reel's turning
speed depends on how much tape is wound on it: omega = v / r. The nearly empty reel
spins fast, the full one slowly. This is the single most important detail for the
motion reading as real, so we model it rather than spinning both hubs at one speed.

- Map song progress `p = elapsedMs / durationMs` to a wind fraction
  `f = 0.15 + 0.7 * p` (never fully empty or full). This is the deliberate
  exaggeration of decision 16.
- Pack radii from conserved tape area, with `r0` = hub radius and `R` = full pack:
  - supply (left): `r_s = sqrt(R^2 - f * (R^2 - r0^2))`
  - take-up (right): `r_t = sqrt(r0^2 + f * (R^2 - r0^2))`
- Each hub's angular velocity = `v / r` for its own pack, with `v` chosen so the
  take-up hub near empty turns about 0.7 rev/s (a real hub at 4.76 cm/s), and the
  full pack about 0.3 rev/s.
- Reuse `NowPlayingView.smoothProgress` for the interpolated `elapsedMs` between
  the 1.5 s Sonos polls; resync on each poll.
- **Radio / unknown duration** (`durationMs == 0`): hold `f = 0.5`, reels still turn.
- The pack discs rotate with their hubs. A pack texture with a faint tape-edge
  spiral, not concentric rings, is what makes that rotation visible.

## The label

- The label is flat in the straight-on render, so dynamic content is a plain 2D
  overlay inside the manifest's label rect. No perspective warp.
- **Album art**: per variant, either printed into the label (normal blend with the
  paper grain overlaid at low opacity; multiply washes out light covers) or a small
  photo stuck on with a paper edge and a slight rotation.
- **Art must be prefetched.** `AsyncImage` loads on appear, which is after insert.
  Prefetch with `URLSession` when the track changes and gate the insert on it (cap
  1.5 s, then insert with a blank slot and fade the art in).
- **Text**: artist, album, song. Handwritten variants use a hand font and an ink
  color from the manifest (blue ballpoint, black marker, pencil). Fonts, all OFL or
  Apache so bundling is fine: Caveat (already bundled as `HandFont`), Permanent
  Marker, Kalam, Homemade Apple, Shadows Into Light. Printed-field variants print
  the field names and handwrite the values, like the reference.
- **Shrink to fit**: each line has a max width from the manifest; shrink the font
  down to **60% of nominal**, then truncate with an ellipsis.
- **Wear overlay** goes on top of the text so scuffs cross the ink.
- **Radio**: no art; the station name goes in the album line, the song line holds the
  current title if Sonos reports one.

## The label, v2 (decided 2026-10-09 after three concept rounds)

Justin's review on the TV: the tape is great, the label is too small. Three
concept rounds on real deck pixels (`_review/mockups/mixtape-label-concepts*.html`,
builders in `scripts/mixtape/build_label_concepts*.py`) settled this:

- **Printed, not stuck on.** Art and text are ink in the paper: the cover is
  multiplied and soft-lit into the paper grain with its blacks lifted to about
  5% (print density), text is dark ink multiplied or translucent white ink,
  there are no drop shadows or sticker borders anywhere, and the tape's wear
  (light / medium / heavy) crosses art and ink alike. The before/after pair in
  round 3 is the reference.
- **Three layouts rotate per tape**, picked by a slice of the same FNV-1a hash
  that picks the shell: **Fit left** (default, about half the time: the square
  cover at full paper height on the left, title and artist on paper above the
  window, album under the wheels), **Split** (cover fills the left half, text
  right) and **Fill width** (the cover's upper part behind everything, ink
  chosen by luminance and detail behind each text block, with a printed
  gradient band as the fallback, never a shadow).
- **Typeset, four families rotating** per tape: grotesk, condensed caps, serif
  italic, typewriter (all tvOS system fonts). Title largest, artist about 60%,
  album about 45%. The handwriting survives only in the fallback.
- **Album line always present** (station name for radio), small, under the
  wheels. Omitted only when empty or identical to the title.
- **No-art fallback** (missing cover, radio): the homemade handwritten tape,
  Caveat in blue ballpoint on ruled lines, title wrapping before shrinking.
- Dropped on the way: the L-shape, Inverse and Two-tone concepts, the sticker,
  the brand header strip on art labels (the brand lives on the shell), and the
  round 1 manifest `artSlotRect` / `textLines` layout, which is superseded.
- Wear: medium by default; heavy reserved for about two of the fourteen.

## Choosing the tape

- `variant = fnv1a32(tapeKey) mod variantCount`. **FNV-1a over UTF-8 bytes**,
  implemented identically in Swift and JS. Swift's `hashValue` is randomised per
  process and must not be used. The manifest's `hashCheck` is the shared test vector.
- Same song, same tape, on both screens, across launches.
- Avoid the **same variant twice in a row**: if the next song hashes to the current
  variant, step to the next index.

## Eject and insert

Target total of about 2 s, on every song change:

1. **Door open** (if the door exists): a 16-frame swing sequence rendered in Blender
   per deck style, about 0.5 s. The door is **hinged at the bottom** and falls toward
   the camera, as on a real front-loading deck (confirmed in the Runway reference). Rendered rather than `rotation3DEffect`, because a
   flat door plate rotated in 3D has no edge thickness and reads as paper.
2. **Eject**: the tape group rises out of the well, scales up a few percent toward
   the camera and picks up a little motion blur, about 0.5 s, then leaves frame.
3. **Empty well** for about 0.25 s, or until the new art is ready (cap 1.5 s).
4. **Insert**: the new tape comes down into the well, settles with a small overshoot,
   about 0.6 s. Counter resets to 000.
5. **Door close** about 0.5 s, then the reels start.

Metadata swaps while the tape is out of frame, so no label ever visibly rewrites
itself. On stop, steps 1 and 2 run and the well stays empty; when music starts from
empty, steps 4 and 5 run alone.

A Runway clip of a real eject may be generated first purely as a motion reference
for timing and easing; it is not used in the app, because a pre-made video cannot
carry the per-song label.

## Deck extras (pending the options round)

- **Transport keys**: when chosen, their state follows playback (play latched while
  playing, pause latched when paused, all up when stopped), and a Siri Remote
  play/pause press animates the key going down (decision 14). `RootView.handlePlayPause`
  calls Sonos directly today; route a signal to `MixtapeView` the way `photoRemote`
  already does for PhotosView.
- **Tape counter**: three mechanical rolling digits driven by elapsed time, so it is
  honest. Resets to 000 on insert.
- **VU meters**: Sonos exposes no audio levels, so needles would be ambient motion
  driven by play state, not the music. Same honesty question as the `bars` backdrop.
  If chosen, say so in the code comment, and revisit if the BPM lookup
  (BACKLOG, "Tempo-locked backdrops") ever lands.

## Settings and remote

- Add `FramedBackdrop.mixtape = 8` in `TVSettings.swift`. The center button on the
  music screen already steps `framedBackdrop` with wrap (`RootView.handleSelect`), so
  Mixtape joins the cycle: ... Marble, Mixtape, Still.
- When `musicMatMode == .framed` and `framedBackdrop == .mixtape`, `NowPlayingView`
  renders `MixtapeView` full-screen instead of the mat.
- The transient backdrop-name label shows "Mixtape" like the others.
- **Hub sync, verified 2026-09-23**: `framedBackdrop` rides `TVSettingsHubSync` as an
  Int; FrameServer deep-merges without clamping, and the TV ignores any raw value it
  cannot decode. A value of 8 cannot revert anyone. What does need doing: the
  **Music backdrop dropdown in `frameserver/admin.html` is stale** (it still lists the
  pre-2026-06-11 order) and needs the current enum plus Mixtape = 8. Logged in BACKLOG.

## Asset pipeline

Everything reproducible from source; nothing hand-placed in a way that cannot be
re-rendered.

- **Blender (via the Blender MCP)**: one cassette model, one camera, straight on.
  Each variant is a material set on the same model. Each deck style is its own model
  sharing the same well geometry. A render script (`scripts/mixtape/render.py`, run
  in Blender) renders and flattens every plate for every variant and writes the
  manifest. Blender is a single running app, so only one agent drives it at a time.
  **Eevee for the options round, Cycles for finals** (Cycles at 4K across 12 variants
  is hours on a Mac; do not spend that before the look is chosen).
- **Period-correct SKUs.** Each variant emulates a named tape the brand actually made,
  so nobody invents a shell colour that never existed. Starting list, two label
  styles each: TDK SA-X 90, Maxell UDXL II 90, Sony HF 90, BASF Chrome Extra II 90,
  Memorex dBS 90, Fuji DR 90. The manifest records the SKU per variant.
- **Logos**: recreated by hand as clean vectors and applied as decals in Blender.
  **Never generate logos with AI image tools**; they garble lettering.
- **OpenAI image generation** (`OPENAI_API_KEY`): surfaces only, meaning label paper
  stock, grime and scuff maps, plastic wear, background surfaces around the deck.
- **Meshy** (API, optional): a starting mesh for a deck body if hand modelling is
  slow; expect cleanup. The cassette itself is modelled by hand.
- **Runway** (API, optional): motion-reference clips for the eject, and mood clips for
  the options round.
- **Source files**: `.blend` files and raw textures are large binaries; keep them
  gitignored like `frame mat.psd`, under `art-src/mixtape/` (add `art-src/` to
  `.gitignore`). Rendered outputs and the manifest are committed.
- **Outputs**: TV in `tvos/Resources/Mixtape/` (folder reference, so the manifest
  and images stay together), PNG with alpha. Pi later: WebP in `code/public/mixtape/`.
- **Budget**: with tape plates cropped to the tape's bounding box, roughly 3 to 6 MB
  per variant at 4K; 12 variants plus one deck under about 80 MB. Fine for tvOS;
  check Pi load time when we get there.

## Look development (before any app code)

An options sheet in `_review/mockups/mixtape-options.html`, stills only:

- 3 or 4 deck styles by era (for example silver late-70s, black 80s, brushed-aluminium
  hi-fi), each **with and without the smoked door**;
- panel extras shown as combinations: bare well, + counter, + transport keys, + VU
  meters;
- **tape scale** at 50 / 60 / 70% of screen width, because a big tape and visible
  meters compete for the frame;
- 2 or 3 sample tapes in each, so the collection's range reads;
- optional Runway mood clips for the eject.

Justin picks. Nothing downstream starts until he does.

## Build phases (Apple TV)

| Phase | Output | Checkpoint |
|-------|--------|------------|
| 0. Look development | Base cassette model, deck options, options sheet | **Justin chooses** deck style, door, extras, tape scale |
| 1. Hero tape | One variant end to end in `MixtapeView`: the 4K deck plate, door layers, one generated tape with its measured manifest, reel physics on the cut hub sprites, label printing, key press, pause, states | **Justin reviews** simulator video and screenshots |
| 2. Transitions | Eject / insert, stop to empty, coalescing, variant selection | Review |
| 3. Collection | All 12 variants generated in place (6 brands x 2 label styles, shell colours per SKU), measured, manifest complete | **Justin reviews** a contact sheet of all 12 |
| 4. Integration | Settings cycle, admin dropdown, dimming, polish | On-device test on the real TV |

## Phase 2: the kitchen Pi (future topic, not designed yet)

The Pi is a touchscreen, so the deck becomes a real control surface. Ideas to design
later, not decisions:

- **Eject = the station picker**: pressing eject opens a shelf or case of tapes, one
  per Jukebox station; picking one inserts it.
- **Fast-forward / rewind keys** = next / previous track; press-and-hold might seek.
- **Play, pause, stop keys** are the real transport.
- Maybe a volume slider or knob on the deck, and tapping the tape to flip sides.

Same assets and manifest; a React renderer instead of SwiftUI. The living-room
ROADOM screen is 16:10, covered by the crop-safe composition. Tracked in BACKLOG
under the kitchen section.

## Risks and open questions

- **Photoreal is judged by eye.** The options round and the hero tape checkpoint exist
  so taste decisions stay with Justin, not an agent.
- **Eject fatigue.** Per-song eject is what Justin asked to see; if it wears thin, the
  v1.0 hybrid (album-keyed tape, rewind whir between songs) is the fallback design.
- **API keys** live in `~/.secrets/api-keys.env` (`OPENAI_API_KEY`, `RUNWAYML_API_KEY`,
  `MESHY_API_KEY`); load with `set -a; source ~/.secrets/api-keys.env; set +a` and read
  from the environment. Values never go in files, commits, logs or chat.
- **Frame TV burn-in**: long static sessions of a mostly still deck. The Frame is
  QLED, so low risk; the "pixel shift" backlog item would cover it anyway.

## Phase 0 run log

- **2026-09-23, packages A, C, D, E done (Opus 5.5 workers, Fable lead).**
  - A: `scripts/mixtape/build_cassette.py` + `render_phase0.py`, headless Blender
    5.2.2 (the interactive MCP server timed out, so the whole pipeline is CLI;
    the MCP is optional for peeking). Eevee plate renders take 7 to 11 s at 4K.
    Hub radius 11 mm, full pack 25 mm, hubs 42.5 mm apart on the centre line.
    Manifest is projected, not typed; FNV-1a check value for
    `landslide|fleetwood mac|` is 190110897.
  - C: 18 hand-built SVGs (`art-src/mixtape/logos/`), lettering from outlined
    system fonts or hand-drawn paths. TDK and Fuji emblems and the Maxell and
    Sony wordmarks are close approximations; refine after the look is chosen.
  - D: 17 textures via `gpt-image-1` for about $0.95. The two wound-tape packs
    have a centre moire; the pack disc comes from A's numpy generator instead.
  - E: two Runway `gen4.5` clips, 120 credits. Useful for timing only.
- B: three deck styles (`build_deck.py --style silver70s|black80s|hifi`), each with
  toggleable door / VU / counter / keys and a tape-scale camera move; 36 option
  renders at 1920x1080 in about 3.5 min (`render_options.py`). The label became
  two parts: a printed top strip and a plain band below the window. Finding: at
  tape scale 0.7 the extras fall outside the 16:10 crop, and a 16:10 crop of 16:9
  trims 5% left and right (not 6% top and bottom), so both limits are applied.
- C2: the label face between rim and window is only **17.6 mm** tall, so all 12
  strips were re-authored at 88 x 17.6 mm (art slot 11.2 to 11.5 mm, smallest
  type 0.93 mm cap height, handwriting lines 3.7 mm apart). Decals map 1:1.
- F: `build_options_sheet.py` produces `_review/mockups/mixtape-options.html`
  (36 renders, door wipe, lightbox, picks form with copy-to-clipboard).
- **Checkpoint reached**: Justin picks deck style, door, extras and tape scale.
  Phase 1 does not start before that.

## Overnight build log (2026-09-23 to 24, Fable lead, Opus workers)

What shipped to the branch and the TV:
- `tvos/Sources/Mixtape/` (`MixtapeManifest`, `MixtapeModel`, `MixtapeView`):
  the deck plate as a plain Image outside the animation subtree; the tape group
  (tape sprite, live packs and hubs clipped to the window, label content) inside
  a TimelineView; door frame and glass tilting 72 degrees on the manifest hinge
  with perspective (a keystone, no Blender sequence needed); PLAY / PAUSE key glow
  and press; ambient VU needles. `FramedBackdrop.mixtape = 8` joins the center
  button cycle. About 11 to 14% CPU on the simulator, no per-frame plate redraw.
- The States table as written, plus two refinements found in testing: music
  starting from an empty well opens the door before the insert (a tape cannot
  pass through a closed door), and coalescing waits 0.8 s for the track to
  settle (cap 4 s) so a burst of skips gives exactly one eject and one insert.
- `tvos/Resources/Mixtape/` (59 MB, a folder reference so the manifest and
  tape folders ship as files): `deck/deck_empty.png` (needles painted out, the
  app draws them), `door_frame.png`, `door_glass.png`, `well_open.png`, and 14
  tapes with per-tape geometry in `mixtape-manifest.json`.
- Sim-only debug flags on the app's defaults: `debug.fakeMusic`,
  `debug.fakeMusicSequence` (six tracks, a pause, a radio entry, a stop gap),
  `debug.fakeMusicRapid`, `debug.noHubSync` (the simulator otherwise pulls the
  real TV's settings). Recipe in the `FakeMusicSequence` comment.
- `frameserver/admin.html` backdrop list corrected, Mixtape added.
- Xcode 27 needed `xcodebuild -downloadComponent MetalToolchain` before
  `Backdrop.metal` would compile; done on this Mac.

Tape generation, honestly: none of the 12 brand tapes passed the automatic
geometry screen (the model draws the hubs 2 to 4 mm too close together and
shifts the slice a pixel or two), so every keeper is the best of its candidates
with its own measured hub positions. That is invisible in use because the
manifest is per tape; the only trace is that hubs do not land exactly on the
inpainted spindles mid-eject. Fuji came out opaque rather than clear and the
manifest says so. Spend: $11.38 for the batch, about $15.50 in image credits for
the whole feature, 120 Runway credits.

Known gaps for the on-device review:
- The live packs cover the tapes' own hub rims, so every shell reads as a clear
  window (most visible on the white Sony and the square-cut Maxell blank).
- The label strip above the window is only 0.09 to 0.12 of frame height, so the
  three lines cannot be as large as the reference's "Neon Avenue" without
  overlapping; they are as large as the strip allows.
- "Printed" tapes carry no printed brand header yet; the vector logos in
  `art-src/mixtape/logos/` are not applied to the generated labels. The printed
  look is the code captions only.
- No label wear overlay (element 6) and no edge thickness on the tilting door.
- Real-remote key press and the true frame rate are unverified until the TV is
  awake; the simulator recording's small hitches were the 4K encoder.

## Review log

- **v1.1, 2026-09-23 (Fable review).** Per-song eject replaces the album hybrid;
  States section added (empty well on stop, coalescing, no eject on first
  appearance); tape key defined; FNV-1a stable hash; normalised manifest coordinates,
  4K plates, 16:10 crop safety; scene flattened to three plates plus sprites with the
  moving parts isolated; art prefetch; door swing rendered in Blender; hub sync risk
  corrected after reading `server.mjs` (the real item is the stale admin dropdown);
  period-correct SKU list; fonts; shrink floor; asset budget corrected; Eevee for
  options, Cycles for finals.
