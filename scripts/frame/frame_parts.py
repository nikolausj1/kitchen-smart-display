#!/usr/bin/env python3
"""Kitchen frame printed parts: bezel bars and panel carrier.

Generates STLs for the Michaels Ashland shadow box build. Everything is
parametric; the numbers at the top are the ones to check with a ruler before
printing. Run with a venv that has manifold3d, numpy and trimesh:

    python3 scripts/frame/frame_parts.py --out _review/frame-parts

Parts (all in mm, Z = toward the wall, Z=0 = front face):

  bezel_side_L / bezel_side_R   full-height side bars, exported at 45 deg
  bezel_top_L / bezel_top_R     top bar in two halves with a centre half-lap
  bezel_bot_L / bezel_bot_R     bottom bar, same
  carrier_L / carrier_R         panel tray halves, Pi holes, lap joint

Every STL is already in its print orientation: bezel bars face down, carrier
halves back face down with the rim up. Print the bezel bars on the textured PEI plate. The textured face
is the visible one and reads like mat board. The 45 degree window bevel is an
overhang that prints without support.
"""
import argparse
import math
import os

import numpy as np
import trimesh
from manifold3d import CrossSection, FillRule, Manifold

# ----------------------------------------------------------------------------
# Measured on the frame (2026-10-24). MEASURED_IS_GROOVE picks what the
# 15 7/8 x 11 3/4 measurement was: False = the hole you reach through (liner
# opening), True = groove to groove (the old glass size).
# ----------------------------------------------------------------------------
MEASURED_W = 15.875 * 25.4   # 403.2
MEASURED_H = 11.75 * 25.4    # 298.5
MEASURED_IS_GROOVE = False
GROOVE_DEPTH = 5.45          # how far the groove runs outward past the liner
GROOVE_GAP = 1.91            # groove thickness, measured on a glass shard 2026-10-24

# Panel. Active area is the standard 15.6 in 16:9 glass. Verify with a ruler.
ACTIVE_W, ACTIVE_H = 344.2, 193.6
PANEL_W, PANEL_H, PANEL_T = 356.0, 224.0, 13.68  # W, H still assumed; T measured 2026-10-24
ACTIVE_DX, ACTIVE_DY = 0.0, 0.0   # active-area centre offset from panel centre
WINDOW_INSET = 2.5                # window edge inside the active area, per side

# Bezel
BEZEL_T = 3.0          # body thickness behind the lip
TONGUE_CLEAR = 0.5     # tongue is this much shorter than the groove depth
TONGUE_FIT = 0.3       # tongue is this much thinner than the groove gap
LAP_LEN = 16.0         # half-lap length at the top and bottom centre seams
SEAM_CLEAR = 0.15      # clearance on lap faces

# Carrier
PLATE_T = 3.0
RIM_T = 3.0
RIM_H = 7.0            # less than PANEL_T so the rim never reaches the bezel
POCKET_CLEAR = 0.6     # total clearance around the panel in the pocket
OPEN_EDGE = "right"    # ports are on the right edge, low, as it hangs (measured 2026-10-24)
CARRIER_LAP = 14.0
SCREW_D = 3.4          # M3 clearance through the lap
# Pi 5 mount, hole pattern 58 x 49, M2.5 countersunk screws from the panel
# side into nylon standoffs on the back. Pattern centre on the plate (plate
# centre = 0,0) and rotation in degrees.
PI_X, PI_Y, PI_ROT = 60.0, -40.0, 90.0   # lower right, near the panel's ports
PI_HOLE, PI_CSK_D = 2.8, 5.6     # through hole and countersink diameter

BED = 256.0


def box(w, h, t, cx=0.0, cy=0.0, z0=0.0):
    return Manifold.cube([w, h, t], True).translate([cx, cy, z0 + t / 2])


def poly_prism(pts, z0, z1):
    cs = CrossSection([[(float(x), float(y)) for x, y in pts]], FillRule.EvenOdd)
    return cs.extrude(z1 - z0).translate([0, 0, z0])


def halfspace_x(xmin=None, xmax=None, size=2000.0):
    lo = -size if xmin is None else xmin
    hi = size if xmax is None else xmax
    return Manifold.cube([hi - lo, 2 * size, 2 * size], True).translate(
        [(lo + hi) / 2, 0, 0])


def bezel_parts():
    if MEASURED_IS_GROOVE:
        groove_w, groove_h = MEASURED_W, MEASURED_H
    else:
        groove_w = MEASURED_W + 2 * GROOVE_DEPTH
        groove_h = MEASURED_H + 2 * GROOVE_DEPTH
    hole_w, hole_h = groove_w - 2 * GROOVE_DEPTH, groove_h - 2 * GROOVE_DEPTH

    outer_w = groove_w - 2 * TONGUE_CLEAR
    outer_h = groove_h - 2 * TONGUE_CLEAR
    tongue_t = GROOVE_GAP - TONGUE_FIT
    tongue_w = GROOVE_DEPTH - TONGUE_CLEAR
    body_w, body_h = hole_w - 0.6, hole_h - 0.6   # clears the liner walls

    win_w = ACTIVE_W - 2 * WINDOW_INSET
    win_h = ACTIVE_H - 2 * WINDOW_INSET
    face_w, face_h = win_w + 2 * BEZEL_T, win_h + 2 * BEZEL_T

    tongue = box(outer_w, outer_h, tongue_t)
    body = box(body_w, body_h, BEZEL_T)
    frame = tongue + body
    # 45 degree bevel: wide at the front face, win_w x win_h at the back.
    window = CrossSection.square([face_w, face_h], True).extrude(
        BEZEL_T + 0.02, 0, 0.0, [win_w / face_w, win_h / face_h]
    ).translate([0, 0, -0.01])
    frame = frame - window

    # Miter lines run from each outer corner to the matching window corner.
    # The outer points are pushed outward along that line so the split
    # prisms fully cover the bar ends without moving the miter.
    ow, oh = outer_w / 2, outer_h / 2
    ww, wh = win_w / 2, win_h / 2

    def ext(cx, cy):
        wx, wy = math.copysign(ww, cx), math.copysign(wh, cy)
        return (cx + (cx - wx) * 0.2, cy + (cy - wy) * 0.2)

    zlo, zhi = -1, BEZEL_T + 1
    regions = {
        "top": [ext(-ow, oh), ext(ow, oh), (ww, wh), (-ww, wh)],
        "bot": [ext(-ow, -oh), (-ww, -wh), (ww, -wh), ext(ow, -oh)],
        "left": [ext(-ow, oh), (-ww, wh), (-ww, -wh), ext(-ow, -oh)],
        "right": [ext(ow, oh), ext(ow, -oh), (ww, -wh), (ww, wh)],
    }
    bars = {k: frame ^ poly_prism(v, zlo, zhi) for k, v in regions.items()}

    def split_with_lap(bar, y_body_lo, y_body_hi, y_tongue_lo, y_tongue_hi):
        half = LAP_LEN / 2
        zmid = BEZEL_T / 2
        bh = y_body_hi - y_body_lo + 2
        yc = (y_body_hi + y_body_lo) / 2
        th = abs(y_tongue_hi - y_tongue_lo) + 2
        tc = (y_tongue_hi + y_tongue_lo) / 2
        # Half-lap over the full zone [-half, half]: left keeps the front
        # half of the body, right keeps the back half. Tongues butt at x=0.
        left = bar ^ halfspace_x(xmax=half)
        left = left - box(LAP_LEN, bh, BEZEL_T, cx=0, cy=yc,
                          z0=zmid - SEAM_CLEAR / 2)
        left = left - box(half + 1, th, BEZEL_T + 2, cx=half / 2 + 0.5,
                          cy=tc, z0=-1)
        right = bar ^ halfspace_x(xmin=-half)
        right = right - box(LAP_LEN, bh, zmid + SEAM_CLEAR / 2,
                            cx=0, cy=yc, z0=-0.01)
        right = right - box(half + 1, th, BEZEL_T + 2, cx=-half / 2 - 0.5,
                            cy=tc, z0=-1)
        return left, right

    top_L, top_R = split_with_lap(bars["top"], wh, body_h / 2, body_h / 2,
                                  outer_h / 2)
    bot_L, bot_R = split_with_lap(bars["bot"], -body_h / 2, -wh,
                                  -outer_h / 2, -body_h / 2)
    info = dict(groove_w=groove_w, groove_h=groove_h, hole_w=hole_w,
                hole_h=hole_h, outer_w=outer_w, outer_h=outer_h,
                tongue_t=tongue_t, tongue_w=tongue_w, win_w=win_w, win_h=win_h,
                side_bar_w=(outer_w - win_w) / 2,
                top_bar_w=(outer_h - win_h) / 2)
    return {
        "bezel_side_L": bars["left"], "bezel_side_R": bars["right"],
        "bezel_top_L": top_L, "bezel_top_R": top_R,
        "bezel_bot_L": bot_L, "bezel_bot_R": bot_R,
    }, info


def carrier_parts():
    pw, ph = PANEL_W + POCKET_CLEAR, PANEL_H + POCKET_CLEAR
    ow, oh = pw + 2 * RIM_T, ph + 2 * RIM_T
    plate = box(ow, oh, PLATE_T)
    rim = box(ow, oh, RIM_H, z0=-RIM_H) - box(pw, ph, RIM_H + 2, z0=-RIM_H - 1)
    # open the port edge
    cut = {
        "left": box(RIM_T + 2, oh + 2, RIM_H + 2, cx=-ow / 2 + RIM_T / 2,
                    z0=-RIM_H - 1),
        "right": box(RIM_T + 2, oh + 2, RIM_H + 2, cx=ow / 2 - RIM_T / 2,
                     z0=-RIM_H - 1),
        "top": box(ow + 2, RIM_T + 2, RIM_H + 2, cy=oh / 2 - RIM_T / 2,
                   z0=-RIM_H - 1),
        "bottom": box(ow + 2, RIM_T + 2, RIM_H + 2, cy=-oh / 2 + RIM_T / 2,
                      z0=-RIM_H - 1),
    }[OPEN_EDGE]
    rim = rim - cut
    tray = plate + rim

    # Pi 5 holes through the plate, countersunk on the panel side (z=0) so
    # flat-head M2.5 screws sit flush under the panel. Standoffs go on the back.
    holes = Manifold()
    csk_h = (PI_CSK_D - PI_HOLE) / 2
    for dx in (-29, 29):
        for dy in (-24.5, 24.5):
            h = Manifold.cylinder(PLATE_T + 2, PI_HOLE / 2, PI_HOLE / 2, 24
                                  ).translate([0, 0, -1])
            csk = Manifold.cylinder(csk_h + 0.01, PI_CSK_D / 2, PI_HOLE / 2, 32
                                    ).translate([0, 0, -0.01])
            holes = holes + (h + csk).translate([dx, dy, 0])
    holes = holes.rotate([0, 0, PI_ROT]).translate([PI_X, PI_Y, 0])
    tray = tray - holes

    # split at x=0 with a lap: left keeps the back half of the plate across
    # the lap, right keeps the front half. Three M3 holes through the lap.
    half = CARRIER_LAP / 2
    zmid = PLATE_T / 2
    # left keeps the back half of the plate (and any bosses) across the lap
    left = tray ^ halfspace_x(xmax=half)
    left = left - box(CARRIER_LAP, oh + 2,
                      RIM_H + 1 + zmid + SEAM_CLEAR / 2, cx=0, z0=-RIM_H - 1)
    # right keeps the front half of the plate plus the rim across the lap
    right = tray ^ halfspace_x(xmin=-half)
    right = right - box(CARRIER_LAP, oh + 2, PLATE_T + 2,
                        cx=0, z0=zmid - SEAM_CLEAR / 2)
    for y in (-ph / 2 + 20, 0, ph / 2 - 20):
        hole = Manifold.cylinder(PLATE_T + 20, SCREW_D / 2, SCREW_D / 2, 24
                                 ).translate([0, y, -10])
        left = left - hole
        right = right - hole
    info = dict(carrier_w=ow, carrier_h=oh, pocket_w=pw, pocket_h=ph,
                half_w=ow / 2 + half)
    # Print orientation: flat back face on the bed, rim and pocket facing up.
    left = left.rotate([180, 0, 0])
    right = right.rotate([180, 0, 0])
    return {"carrier_L": left, "carrier_R": right}, info


def export(name, m, out):
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3]
    f = np.asarray(mesh.tri_verts)
    tm = trimesh.Trimesh(vertices=v, faces=f, process=True)
    path = os.path.join(out, f"{name}.stl")
    tm.export(path)
    lo, hi = v.min(axis=0), v.max(axis=0)
    size = hi - lo
    diag_ok = max(size[0], size[1]) <= BED or \
        (max(size[0], size[1]) + min(size[0], size[1])) <= BED * math.sqrt(2)
    flat_ok = size[0] <= BED and size[1] <= BED
    fit = "fits flat" if flat_ok else ("fits rotated 45 deg" if diag_ok
                                       else "TOO BIG")
    print(f"{name:14s} {size[0]:7.1f} x {size[1]:7.1f} x {size[2]:5.1f} mm  "
          f"{fit}  watertight={tm.is_watertight}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_review/frame-parts")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bez, binfo = bezel_parts()
    car, cinfo = carrier_parts()
    print("bezel:", {k: round(v, 2) for k, v in binfo.items()})
    print("carrier:", {k: round(v, 2) for k, v in cinfo.items()})
    for name, m in {**bez, **car}.items():
        if name.startswith("bezel_side"):
            m = m.rotate([0, 0, 45])   # diagonal on the 256 mm bed
        export(name, m, a.out)


if __name__ == "__main__":
    main()
