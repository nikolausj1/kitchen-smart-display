---
title: "Mixtape asset scripts"
created: 2026-09-23
modified: 2026-10-16
version: 1.5
author: Claude Opus 5.5 (claude-opus-5-5)
tags: [mixtape, blender, scripts, assets]
---

# Mixtape asset scripts

Headless Blender scripts that build the Mixtape cassette and decks and render its plates
and the look-development option matrix.
Design: `docs/designs/mixtape.md`. Everything is reproducible from these scripts;
nothing in the .blend is hand placed.

Blender: `/Applications/Blender.app/Contents/MacOS/Blender` (5.2.2 LTS), always run
with `-b` (background). The Blender MCP is not used.

## Run (phase 0)

From the project root:

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b --factory-startup --python scripts/mixtape/make_tape_pack_texture.py
$B -b --factory-startup --python scripts/mixtape/build_cassette.py
$B -b art-src/mixtape/cassette_base.blend --python scripts/mixtape/render_phase0.py
```

`render_phase0.py` takes an optional `-- --only plates|sprite|manifest` to redo one
part (for example the manifest alone, with no rendering).

## Run (work package B: label, materials, decks, option matrix)

From the project root, after phase 0:

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
python3 scripts/mixtape/make_label_decals.py                     # system python3: Pillow, numpy, rsvg-convert
$B -b art-src/mixtape/cassette_base.blend --python scripts/mixtape/lookdev_cassette.py
python3 scripts/mixtape/render_options.py --build                # builds the 3 decks, renders all 36
```

One deck by hand:

```sh
$B -b art-src/mixtape/cassette_look.blend --python scripts/mixtape/build_deck.py -- \
    --style silver70s --tape-scale 0.6 --door on --vu on --counter on --keys on
```

`render_options.py` flags: `--build` (rebuild the deck .blend files first), `--style <s>`
and `--match <substring of file name>` to render a subset; `index.json` and
`render-times.json` merge with what is already there.

| Script | What it does | Output |
|--------|--------------|--------|
| `label_layout.py` | Pure-Python shared numbers: strip and band rects (mm), 1:1 SVG mapping (88 x 17.6 mm SVG centred on the 87 mm strip, 0.5 mm bleed per side), SVG named-element parser (`art_slot`, `field_*`, `rule_1..3`, background), SVG to cassette-mm mapping, per-brand paper and wear level. Imported by both pythons. | none |
| `make_label_decals.py` | rsvg-convert each `label_<style>.svg` at 40 px/mm (1:1, no scaling or padding), crop the 0.5 mm bleed off each side, multiply paper grain, overlay grime, foxing and scuffs. Plus a plain band per brand. | `art-src/mixtape/textures/labels/<brand>_<style>_strip.png` (3480 x 704), `<brand>_band.png` (3480 x 252) |
| `mixtape_common.py` | bpy helpers: `set_tape_scale` (moves Cam_Front only, tight clip range), textured materials, `apply_tape`, `set_deck_parts`, manifest builders (reuse `render_phase0` projection helpers), 16:10 safe-zone check. | none |
| `lookdev_cassette.py` | Opens `cassette_base.blend`, replaces the 87 x 45 mm `Label` with `Label_Strip` + `Label_Band`, 12 strip + 6 band materials, materials pass (plastic grain, roughness from texture, clear coat, scuffed window, darker AO hub, metal screws, glossier pack), new `Shell_White` / `Shell_Clear`, real origins on transparent parts so BLENDED sorting works. | `art-src/mixtape/cassette_look.blend` |
| `build_deck.py` | Deck around the unchanged cassette + camera: faceplate, walnut cheeks (silver70s), shared well (lip overlapping the tape by 1 mm, cavity, spindles), optional collections `Deck_Door` (hinge empty at the bottom edge, closed), `Deck_Vu`, `Deck_Counter`, `Deck_Keys`. Objects tagged `mf` feed the manifest. | `art-src/mixtape/deck_<style>.blend` |
| `render_options.py` | Driver (python3) plus in-Blender renderer (same file). 36 renders, index, times, per-scale manifests. | `art-src/mixtape/renders/options/` |

### Styles

| Style | Faceplate | Door | Meters | Counter | Keys |
|-------|-----------|------|--------|---------|------|
| `silver70s` | brushed silver, walnut cheeks at the frame edges | silver frame, smoked glass | two cream VU meters, 19 x 18 mm, flanking the well (upper corners) | 3-wheel mechanical, right column, reset button | six satin piano keys with REW PLAY FF STOP PAUSE EJECT, PLAY latched |
| `black80s` | black anodised | black frame with finger notch, smoked glass | LED bar meter (2 x 20 segments) above the well | cyan 7-segment VFD "000" above the well | flat black push buttons with geometry symbols, green LED over PLAY |
| `hifi` | brushed dark aluminium | wide (122 mm) thin-framed smoked door | two small VU meters stacked in the right column | small mechanical counter, left column | slim key row with printed symbols above |

### Composition

At tape scale 0.6 the frame at the faceplate is about 166 x 94 mm; the 16:10 crop keeps
|x| <= 74.8 mm and the 6% bands leave |y| <= 41.1 mm, so there is only about 7 mm above
and below the well. Keys and the 80s displays sit in those bands; the larger meters go
in the side columns. The per-scale manifests carry a `safeZone` report: all inside at
0.5 and 0.6; at 0.7 meters, counters and keys fall outside the crop or the frame.

### Manifests

`renders/options/mixtape-manifest.scale-<50|60|70>.json` (schema draft-1): `tape` (hubs,
radii, `labelRect` = the top strip, `labelBandRect`, `labels.<brand>.<style>` with
`artSlotRect` and `textLines` derived from the SVG named elements; top-level
`artSlotRect` / `textLines` = TDK printed), `deck.<style>` (well, door, doorHinge,
counter, vu/ledMeter, vuNeedle pivots with sweep, key rects), `safeZone`, `hashCheck`.
Text lines: baseline on the printed rule, maxWidth = rule length, xHeight = 0.30 of the
rule pitch.

### Render times observed (2026-09-23, M1 Pro, Eevee 64 samples, 1920x1080)

| Output | Time |
|--------|------|
| Label decals (18 PNGs, python3) | 28 s |
| `lookdev_cassette.py` | about 3 s |
| `build_deck.py` per style | about 3 s |
| One option render | 4.5 to 9 s, mean 5.8 s (first render per process pays shader compile) |
| Full matrix, 36 renders incl. deck builds | 3 min 40 s wall (about 72 s per style process) |

Per-file seconds are in `renders/options/render-times.json`.

### Known limits (work package B)

- Resolved in work package C2: the label SVGs were 88 x 30 mm and had to be shrunk to
  0.587 and side-padded to fit the 17.6 mm strip. They are now authored at 88 x 17.6 mm
  and map 1:1 onto the strip (art slot about 11.2 to 11.5 mm square). The option
  renders in `renders/options/` predate this and still show the old padded labels
  until the matrix is re-rendered.
- View transform is Khronos PBR Neutral at -0.6 EV. Only emitters (LEDs, VFD) clip.
- Blank decal sides, flat lighting in the lower half of the black80s plate at scale 0.5,
  and CG-clean surfaces are expected under Eevee; Cycles comes after the pick.

## Scripts (phase 0)

| Script | What it does | Output |
|--------|--------------|--------|
| `make_tape_pack_texture.py` | Numpy-generated top-down tape pack: brown disc, Archimedean spiral (not rings), per-wrap brightness and tangential streaks so rotation reads. Seeded, deterministic. | `art-src/mixtape/textures/tape_pack.png`, copied to `renders/phase0/tape_pack_texture.png` (1024 px, alpha outside the disc) |
| `build_cassette.py` | Builds the compact cassette (100.4 x 63.8 x 12 mm) from bmesh prisms and exact booleans: front/back shell halves, side walls, screw bosses, bottom trapezoid pad, wide clear window with two hub holes, raised blank `Label`, `Hub_L`/`Hub_R` (6 teeth, leader-clamp slot, origin at centre), `Pack_L`/`Pack_R`, guide rollers with pins, tape path, pressure pad, 5 screws. Materials for all three shells. 135 mm camera perpendicular to the face, 3-point area rig plus a reflection card, soft grey world, Eevee, 3840x2160, transparent film, Standard view transform. Stores the layout (mm) as JSON on the scene. | `art-src/mixtape/cassette_base.blend` |
| `render_phase0.py` | Swaps shell/window materials per variant and renders the plates, renders the hub sprite with an ortho camera, and writes the manifest by projecting scene geometry through the camera. | `art-src/mixtape/renders/phase0/*` |

## Geometry notes

- Units: 1 BU = 1 m; the layout table in `build_cassette.py` is in mm.
- Face looks at +Z, camera on +Z. Origin = centre of the shell outline.
- Hubs: centres 42.5 mm apart on y = 0 (the shell's horizontal centre line), outer
  radius 11 mm (= empty pack r0). Full pack R = 25 mm. These match the reel physics
  in the design (about 0.7 rev/s at r0 and 0.3 rev/s at R for 4.76 cm/s).
- Label: 87 x 45 mm, window hole cut out; the writing strip above the window holds
  the art slot (14 mm square, left) and three text baselines (artist, album, song).
- Plates render the packs at wind fraction 0.5.
- Camera distance (627.5 mm to the face) is computed so the tape is 60% of the frame
  width. Change `tape_frac_of_width` for the 50 / 70% options.

## Manifest

`mixtape-manifest.draft.json`: normalised 0..1 of the frame, origin top-left, y down.
Radii are given twice, as a fraction of width (`w`) and of height (`h`). Hub centres
and radius are projected at the hub front face, the full-pack radius at the pack
front face, label items at the label surface. `hashCheck` is FNV-1a 32-bit over the
UTF-8 bytes of `landslide|fleetwood mac|`.

## Render times observed (2026-09-23, M1 Pro, Eevee, 64 samples)

| Output | Time |
|--------|------|
| cassette_shell_black.png (3840x2160) | 7.1 s |
| cassette_shell_clear.png (3840x2160) | 11.4 s |
| cassette_shell_white.png (3840x2160) | 7.0 s |
| hub_sprite.png (1024x1024) | 1.2 s |

Whole pipeline (texture, build, all renders, manifest) runs in about 45 s. Per-run
times are also written to `renders/phase0/render-times.json`.

## Known limits (phase 0)

- Not photoreal: flat materials, no wear, no liner sheet, no head/pinch openings in
  the bottom edge (not visible straight on anyway).
- The smoked shell renders with partial alpha at its edges (you see through the walls),
  which is physically right but means the plate is not opaque at its border.
- Transparent materials use Eevee's Blended mode; overlapping smoked parts are sorted
  per object, fine straight on but worth checking once the door and deck arrive.

## Upscaling the reference plate (2026-09-23)

`upscale_vtsr.swift` upscales an image 4x with Apple's VideoToolbox
super-resolution (macOS 26; the model downloads itself on first use). Chosen
after a bake-off against Lanczos, sips, OpenCV FSRCNN / EDSR and Real-ESRGAN:
it keeps the brushed-metal grain and sharpens lettering without inventing
detail, in about 3 s. Real-ESRGAN smeared the metal; EDSR was 40x slower.

    swiftc -O scripts/mixtape/upscale_vtsr.swift -o /tmp/vtsr
    /tmp/vtsr art-src/mixtape/reference/horizon_deck_reference.png out_4x.png

Then resize to 3840x2160 with Lanczos (PIL) and crop the odd row.

## Deck plate edit pass 2: wordmark, key lamp, output knob (2026-10-09)

`edit_deck_plate.py` (system python3: numpy, opencv-python, Pillow) reads the
needle-free 4K plate `tvos/Resources/Mixtape/deck/deck_empty.png`, leaves it
untouched, and writes a new final plate plus sprites. Hand work only (cloning,
Poisson blending, typesetting), no image generation. About 20 s.

    python3 scripts/mixtape/edit_deck_plate.py

| Step | How | Output |
|------|-----|--------|
| NIKOLAUS wordmark | HORIZON erased by a Poisson clone of the brushed faceplate just below it; NIKOLAUS set in SF Pro (variable `SFNS.ttf`, wdth 121, wght 610), the closest face on this Mac to HORIZON (per-letter IoU 0.74; Futura Medium 0.43, Avenir Next Demi Bold 0.52, no Eurostile here). Same cap height (45 px), baseline, left edge and ink as HORIZON; tracking fitted to HORIZON then tightened 2.5 px so the 8 letters keep a 69 px gap to STEREO. | `art-src/mixtape/plates/deck_empty_nikolaus.png`, `wordmark-compare.png` |
| Unlit PLAY | FF's top rows (gap, bevel, highlight) remapped onto PLAY's cap edges, toned by a per-channel gain field so PLAY keeps its own sheen. | `art-src/mixtape/plates/deck_empty_nikolaus_unlit.png` |
| Key lamp sprites | The lit PLAY rows as an RGBA overlay, and the same rows remapped onto the narrower PAUSE cap. Drawn source-over (see below). | `deck/glow_play.png`, `deck/glow_pause.png`, `art-src/mixtape/plates/glow-compare.png` |
| Output knob | The cone-brushed top face (not the chrome skirt or rim, which are round and must not turn) cut as a centred disc with a 1 px feather; the plate under it gets the same face with the dot painted out radially; the dot alone as a second sprite. | `deck/knob.png`, `deck/knob_dot.png`, `deck/deck_empty_v2.png`, `art-src/mixtape/plates/knob-compare.png` |

`deck_empty_v2.png` is the final plate: NIKOLAUS, PLAY unlit, knob face without
its dot. It sits beside `deck_empty.png`; the app switches when the lead decides.

New `plate-manifest.json` keys (normalised like the rest; merged in, so rerun this
after `gen_deck_plate.py finish`, then `build_tape_assets.py --manifest-only` to
copy them into `mixtape-manifest.json`):

- `glows.play`, `glows.pause`: x, y, w, h of each lamp sprite. Not additive: under
  the amber strip the unlit cap has a white bevel highlight, and adding light cannot
  turn white amber (a `.plusLighter` difference sprite blew out with colour
  fringes). Draw normally; opacity 1 is the photo's lit key, fade opacity to dim.
- `knob.center` (x, y), `knob.radius` and `knob.spriteSize` (fractions of plate
  HEIGHT): the face disc and the square sprite centred on it.
- `knob.dotAngleDeg` 43.2 (the dot at rest, clockwise from up), `knob.minAngleDeg`
  -147.6 and `knob.maxAngleDeg` 147.8 (the MIN and MAX major ticks). For volume v:
  target = min + v (max - min); rotate the sprite clockwise by target - dotAngleDeg.
  The photo's knob rests at 64.6%.
- `knob.tickCenter`: the printed tick ring's centre (about 10 px up-left of the
  face, which stands proud of the plate). Reference only.
- Prefer rotating `knob_dot.png` over a static face: a real cone-brushed knob's
  highlights stay put as it turns, while rotating `knob.png` turns them too
  (visible at 100% in `knob-compare.png`, row 1 against row 2).

## Polish round: hub rims, door edges, spindles, tape counter (2026-10-16)

`polish_assets.py` (system python3: numpy, opencv-python, Pillow). Hand work
only, no image generation, no API cost. Stages run in this order (`all` runs
them all, about 40 s); each reads only files on disk:

    python3 scripts/mixtape/polish_assets.py all
    python3 scripts/mixtape/polish_assets.py rims       # or door, spindles, counter, manifest

| Stage | What | Output |
|-------|------|--------|
| `rims` | Per tape, the shell around each hub opening cut from that tape's own `tape.png` (same 4K pixels). Alpha = the app's window clip (the `windowRect` capsule, grown 1.5 px so its soft edge does not leave a dark line) minus the hub disc (r < `hubRadius`) minus the clear inner window between the hubs (strongest edges between the hubs; four tapes overridden by eye in `INNER_OVERRIDES`). Clear / smoke shells (`test_clear`, both `basf_ce2`) are cut at 60% alpha over the pack's swept area, opaque outside it. Fuji is tagged clear but came out opaque and is cut as opaque. | `tapes/<id>/rim_L.png`, `rim_R.png`, `art-src/mixtape/tapes/rims.json`, `art-src/mixtape/polish/rims-check-*.png`, `rims-dark-disc.png` |
| `door` | 9 px (0.00417 of plate height) edge strips, the door's full width, sampled per column from `door_frame.png`'s chrome top rail (rows 299 to 311) and its bottom bar (rows 1332 to 1396), lit by a vertical gradient with a 1 px arris highlight. Top is lit, bottom is the shadowed underside. | `deck/door_edge_top.png`, `deck/door_edge_bottom.png`, `polish/door-edges-check.png` |
| `spindles` | Both empty-well spindles moved onto the mean of the 14 tapes' hub centres (left +6, +34 px; right -54, +38 px at 4K). The area is split into a quadratic background (fitted on an annulus r 230 to 330, head block excluded) and the feature (disc, the light pooled round it, grain); the feature moves under a wide radial window (full to r 150, gone by r 260) and grain is put back in the vacated disc. The diff is asserted to stay inside the two spindle windows. `well_open.png` carries the same spindles and gets the same move (its pre-move copy is kept as `art-src/mixtape/plates/well_open_v2spindles.png` and is the input on reruns). | `deck/deck_empty_v3.png`, `deck/well_open.png`, `polish/spindles-check.png`, `spindles-zoom-2x.png` |
| `counter` | A 3-digit mechanical counter above the OUTPUT legend, centred over the knob: chrome rim (160 x 76 px) with a drop shadow, a recessed black bezel, a 132 x 50 window of three blank drums (40 px, 6 px apart), and a round chrome RESET button to its right. Built in numpy; the plate is byte-identical outside the housing box (asserted). Digits: Helvetica numerals at 60% of the drum height, white on near-black, subtle per-cell cylinder shading. | `deck/deck_empty_v3_counter.png`, `deck/counter_digits.png` (40 x 550, 11 cells), `deck/counter_glass.png`, `polish/counter-compare.png`, `counter-placement.png` |
| `manifest` | Deck keys are merged into `plate-manifest.json` by each stage; this runs `build_tape_assets.py --manifest-only`, then merges the per-tape rims from `rims.json` into `mixtape-manifest.json`. | `tvos/Resources/Mixtape/mixtape-manifest.json` |

`build_tape_assets.py` rebuilds tape entries from the measurements and knows
nothing of rims: **rerun `polish_assets.py manifest` after any
`build_tape_assets.py` run**, or the rims drop out of the app manifest.

New manifest keys (normalised like the rest):

- `tapes[i].rims.left` / `.right`: `rect` (x, y, w, h of the sprite in the frame)
  and `file` (relative to the manifest). Draw OVER the live packs, under or over
  the hub sprites (they do not overlap the hub disc).
- `tapes[i].rims.packMinRadius` / `packMaxRadius` (fractions of frame width) and
  `clearShell`. With the rims on, the packs are seen only through the clear inner
  window, and the old window-limited radii (`packMaxRadius` 0.028 to 0.035) put the
  whole pack behind the shell. These take real cassette proportions instead: full
  pack 0.58 of the hub spacing, bare spool held just short of the inner window
  edge (as on a real tape, an empty reel shows nothing in the window), so the full
  pack reaches about two thirds across the window. Keep clipping to the capsule.
- `deck.door_edges`: `top` and `bottom` rects at full thickness (sin(tilt) = 1)
  attached to the door rect's top edge (growing up; its last row is the arris)
  and bottom edge (hanging down; its first row is the arris), `thicknessFraction`,
  `files`. Scale the height by sin(tilt). For a bottom-hinged door tilting out
  only the top edge faces the camera; the bottom strip is there if the door model
  shows it.
- `deck.plates.deck_v3`, `deck.plates.deck_v3_counter`; `deck.spindles.left` /
  `.right` (the new spindle centres).
- `deck.counter`: `housing`, `window`, `digitCells` (three rects), `digitStripFile`,
  `digitStripCells` 11, `digitHeightFraction` (one cell = one window height, of
  plate height), `glassFile` / `glassRect` (draw over the digits: fixed cylinder
  shading and the drum separators), `resetButton`. To show drum value v (0 <= v < 10,
  fractional while rolling) offset the strip up by v x cell height inside the cell
  and clip; the trailing 0 makes 9 to 0 roll without a jump.

## Tape collection (2026-09-23)

The 12 app tapes (6 brands x 2 label styles) plus the two package H test tapes,
generated in place on the reference photo, screened, measured, cut and upscaled.
From the project root:

```sh
set -a; source ~/.secrets/api-keys.env; set +a
python3 scripts/mixtape/gen_tape_variants.py --collection          # 2 candidates each, auto-screened
python3 scripts/mixtape/gen_tape_variants.py --collection --rescreen   # no API calls: re-screen, re-pick
python3 scripts/mixtape/measure_tape_variants.py --dir art-src/mixtape/tapes/collection
python3 scripts/mixtape/build_tape_assets.py --contact-sheet
```

| Script | What it does | Output |
|--------|--------------|--------|
| `gen_tape_variants.py --collection` | `COLLECTION` (ids, brand, SKU, shell per SKU, wear 4 light / 4 medium / 4 heavy, ink colour, `logoDir`) and one prompt per tape: period shell look, blank label, wear, no logo or text. Two candidates per tape in parallel (4 workers); each is screened; if both fail a third is made; the best (lowest score, passing first) goes in `keepers.json`, flagged when it failed. Stops before logged spend would pass $15. | `art-src/mixtape/tapes/collection/<id>_candidate<n>.png`, `prompts.json` (prompt, usage, cost), `screening.json`, `keepers.json` |
| `measure_tape_variants.py` | `--screen <png>...` prints the screening verdict. `--dir <folder>` measures the keepers listed in that folder's `keepers.json` (paste back outside the mask, hubs, label, window, sprites, debug image). Label falls back to an edge search when the paper mask cannot separate label from shell (white or yellowed shells); window falls back to the dark slot between the hubs. | `<dir>/<id>.png` (pasted back keeper), `<dir>/measurements.json`, `<id>_hubs_debug.png` |
| `build_tape_assets.py` | Cuts every measured tape (test + collection) into the app contract below and writes the manifest atomically (temp file, rename). `--only <ids>` rebuilds those images, `--manifest-only` skips image work, `--contact-sheet` renders the review sheet. | `tvos/Resources/Mixtape/tapes/<id>/{tape,hub,pack}.png`, `tvos/Resources/Mixtape/mixtape-manifest.json`, `art-src/mixtape/tapes/contact-sheet.{html,png}`, `art-src/mixtape/tapes/build-info.json` |

### Screening (automatic rejection)

A candidate fails when any of these hold (px at 1672 wide):

- the slice shifted more than 1 px (phase correlation outside the edit mask);
- a hub centre is more than 3 px off y = 353.5 (the height both package H keepers
  measured; the model never seats hubs on the shell's geometric centre line 363.5);
- the hub spacing is more than 6 px off 284.5;
- no window found;
- the label is not blank. No OCR, so a text-likeness heuristic: black-hat strokes
  (> 50 levels) inside the label, minus the window and hubs; glyph-sized components
  that chain along a shared baseline (4 or more) read as print, long thin horizontal
  components read as ruled lines. Grime and scuffs are scattered and do not chain.
  The keepers are also checked by eye on the contact sheet.

### App contract (`mixtape-manifest.json`)

All positions normalised 0..1 of the 3840x2160 frame, origin top-left, y down; x,
widths, radii and `maxWidth` as fractions of frame width; y, heights, `baselineY` and
`xHeight` as fractions of frame height. Source px map with the plate's uniform scale
S = 3840/1672 and no top offset: `x_n = x / 1672`, `y_n = y * S / 2160`.

- `frame`, `deck` (a verbatim copy of `plate-manifest.json`, already normalised),
  `hashCheck` (FNV-1a 32 of `landslide|fleetwood mac|` = 190110897), `tapes[]`.
- Per tape: `id`, `brand`, `sku`, `labelStyle` (printed / blank), `shell`, `wear`,
  `logoDir` (the vector header folder for that brand, not applied to the art),
  `files` (`tape`, `hub`, `pack`, relative to the manifest), `spriteRect`, `hubL`,
  `hubR`, `hubRadius` (the visible toothed ring, fitted on its outer edge by `ring_fit`), `packMinRadius` (ring x 1.2) and
  `packMaxRadius` (the largest pack centred on the hub that fits inside the window's
  height), `windowRect`, `labelRect`, `artSlotRect`, `textLines` (artist, album, song:
  `x`, `baselineY`, `maxWidth`, `xHeight`), `printedFields`, `inkColor`, `font`.
- Label layout is derived, not measured (collection labels are blank), in the
  reference ("Neon Avenue") proportions: the art slot square fills the label strip
  above the window minus a 6% margin; the three lines to its right fill the same
  height, evenly spaced (baselines at 26 / 59 / 93% of the art height), artist
  x-height 0.56 of the line pitch and album / song 0.73 of that, capped at the
  reference's 0.030 / 0.022 of frame height and so 22 characters still fit
  `maxWidth` at the app's 60% shrink floor (Caveat: x-height 0.40 em, mean advance
  0.93 x-height).
- Ruled labels (the test tapes, `maxell_udxl2_blank`): dark horizontal lines 60 px
  or longer right of the art slot are detected. With three or more, the baselines
  sit ON the rules (y = the rule's top, x = its left end when the rule spans at
  least half the line) and x-height is capped at 0.7 of the rule spacing (0.6 for
  album and song). With one or two, the even layout stays, and a rule that would
  cross a line's x-height band pulls that baseline onto itself.
- `printedFields: true` lines also carry `captionX` / `captionBaselineY`: the
  caption sits at the line's start on the same baseline and the value's `x` moves
  right by 0.035 of frame width (`maxWidth` shrinks by the same).
- Shell rect: strongest perpendicular edge within 10 px outside / 18 px inside the
  nominal cassette rect, per side (the model sometimes draws the shell up to 19 px
  inside it); nominal when no edge stands out.
- `tape.png` = the shell rect cut from the pasted back keeper, 9 px (at 1672)
  rounded corners masked to alpha, upscaled 4x with `upscale_vtsr.swift` and Lanczos
  to exactly S x the crop (RGB and alpha through SR separately). The generated packs,
  hubs and the door's smoke are baked in; the window is opaque.
- `hub.png` = the left hub's visible ring, alpha outside the ring, upscaled the same way.
- `pack.png` = 512 px tile, alpha outside the disc, always synthesised from
  `art-src/mixtape/textures/tape_pack.png` tinted to the mean colour of the generated
  pack (the generated pack only shows in the window slot, never as a whole disc).
