---
title: "Mixtape asset scripts"
created: 2026-09-23
modified: 2026-09-23
version: 1.2
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
