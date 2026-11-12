---
title: "Kitchen Frame Printed Parts"
created: 2026-10-24
modified: 2026-10-26
version: 1.2
author: Claude Fable 5.1 (claude-fable-5-1)
tags: [kitchen-display, hardware, frame, 3d-print, bambu]
---

# Kitchen Frame Printed Parts

Printed bezel and panel carrier for the Michaels Ashland shadow box that holds
the kitchen EVICIV panel. `frame_parts.py` generates every STL from the
measurements at the top of the file. The STLs and Bambu projects land in
`_review/frame-parts/` (gitignored, regenerate at will).

## The eight parts

Coordinates: Z=0 is the front face of the bezel, +Z toward the wall.

| Part | What it is | Print |
| --- | --- | --- |
| `bezel_side_L`, `bezel_side_R` | Full height side bars of the mat. 37 mm wide face, 308 mm long, mitered both ends. Exported rotated 45 degrees so they fit the 256 mm bed diagonally. | One per plate, face down |
| `bezel_top_L`, `bezel_top_R` | Top bar in two halves, 60 mm wide face. Meet at a 16 mm half lap at the center of the top edge. Tongues butt square at the seam. | Face down |
| `bezel_bot_L`, `bezel_bot_R` | Same as the top bar, mirrored. | Face down |
| `carrier_L`, `carrier_R` | Panel tray in two halves joined by a 14 mm lap with three M3 holes. 3 mm plate, 7 mm rim that wraps the panel on three sides, open on the right edge where the ports are. `carrier_R` carries the four countersunk M2.5 holes in the Pi 5 pattern, lower right. | Back face down, rim up |

Each bezel bar has three features:

- A tongue, 4.95 mm wide and 1.61 mm thick, that slides into the frame's old
  glass groove. The groove is 5.45 mm deep and 1.91 mm wide, so the tongue has
  0.5 mm of end play and 0.3 mm of thickness play.
- A 3 mm body that sits behind the frame's front lip and inside the liner
  walls. This is the part you see through the lip.
- A 45 degree bevel into the window. The back edge of the window is 339 x
  189 mm, 2.5 mm inside the panel's active area on every side, so the bevel
  hides the panel's own bezel and nothing of the LCD edge shows.

Corners are mitered from the outer corner to the window corner, so each bar's
ends are angled exactly like a cut mat. The corner joints are free: the
carrier pressing the panel forward holds everything flat against the lip.

The carrier is what everything else attaches to. The panel drops into the
pocket against the rim, the countersunk screws go in from the panel side and
sit flush, nylon standoffs thread onto them on the back, and the Pi mounts on
the standoffs with its cooler facing the wall through a window cut in the
frame's backing board.

## Printing

Bambu Lab P1S, 0.4 nozzle, 0.2 mm layers, matte white PLA, textured PEI
plate. The bezel bars print face down so the plate texture becomes the visible
surface. The bevel is a 45 degree overhang and needs no support. Two walls and
15 percent infill are fine; the parts are thin enough to be nearly solid.

The projects in `_review/frame-parts/bambu/` are one plate each, already
arranged and sliced for the P1S. Every file prints once. Letters match the
parts map in the build guide:

1. `plate3-left-side-bar-A` (print first: proves the tongue fit)
2. `plate4-right-side-bar-B`
3. `plate1-top-bar-C-D` (the two halves of the top bar, they join at the centre lap)
4. `plate2-bottom-bar-E-F` (the two halves of the bottom bar)
5. `plate5-carrier-left-G`
6. `plate6-carrier-right-H` (Pi holes and the open port edge)

## Assembly

The step by step build guide, with diagrams, is `_review/frame-build-guide.html`,
and the animated assembly is `_review/frame-assembly.html`. Both are plain HTML
files that open in any browser; the animation needs the network once for Three.js.

## Regenerating

The generator needs `manifold3d`, `numpy` and `trimesh`:

```bash
uv venv .venv-cad && uv pip install --python .venv-cad/bin/python manifold3d numpy trimesh
```

```bash
.venv-cad/bin/python scripts/frame/frame_parts.py --out _review/frame-parts
```

Then rebuild the Bambu projects with the Bambu Studio command line. The
presets have to be flattened user presets, not the system ones; see the
session notes in `BACKLOG.md` under the kitchen frame build.

## Measurements still assumed

Verify these against the real panel before printing the carrier or trusting
the window:

- `ACTIVE_W`, `ACTIVE_H`: the lit area, assumed 344.2 x 193.6 mm.
- `PANEL_W`, `PANEL_H`: the panel body, assumed 356 x 224 mm. Thickness is measured: 13.68 mm.
- `ACTIVE_DX`, `ACTIVE_DY`: how far the lit area is off the body's center.
