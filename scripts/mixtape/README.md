---
title: "Mixtape asset scripts"
created: 2026-09-23
modified: 2026-09-23
version: 1.0
author: Claude Opus 5.5 (claude-opus-5-5)
tags: [mixtape, blender, scripts, assets]
---

# Mixtape asset scripts

Headless Blender scripts that build the Mixtape cassette and render its plates.
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

## Scripts

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
