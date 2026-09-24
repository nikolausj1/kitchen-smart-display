"""Build one Mixtape tape-deck scene around the look-dev cassette (work package B).

Run headless on the look-dev cassette (after lookdev_cassette.py):
    /Applications/Blender.app/Contents/MacOS/Blender -b art-src/mixtape/cassette_look.blend \
        --python scripts/mixtape/build_deck.py -- --style silver70s [--tape-scale 0.6] \
        [--door on|off] [--vu on|off] [--counter on|off] [--keys on|off]

Styles: silver70s, black80s, hifi. Writes art-src/mixtape/deck_<style>.blend.

The cassette, its camera and its lights come from cassette_look.blend untouched, so the
manifest's hub positions stay valid in every deck. The deck is built around the
cassette's frame (mm, origin at the shell centre, tape face at z = 6):

- shared well: a lip whose opening is the shell outline inset 1 mm (it overlaps the
  tape edges like a real deck), a dark cavity with a back wall 1 mm behind the tape
  and two reel spindles seen through the hub bores. Faceplate front at z = 10.
- optional parts, each in its own collection so render scripts can toggle them:
  Deck_Door (smoked door, hinged at its bottom edge, closed), Deck_Vu (meters),
  Deck_Counter, Deck_Keys.

Composition (design doc, "Resolution and crop safety"): at tape scale 0.6 the frame at
the faceplate is about 166 x 94 mm. Everything that matters stays inside a centred
16:10 crop (|x| <= 74.8 mm) and out of the outer 6% top and bottom (|y| <= 41.1 mm).
With the tape 64 mm tall that leaves a 7 mm band above and below the well, so keys and
counters live in those bands and the bigger meters flank the well in the side columns
(x 54 to 74 mm). At scale 0.7 the side columns and bands fall outside the frame.
"""

import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cassette as BC  # noqa: E402
import mixtape_common as MC  # noqa: E402

mm = BC.mm
T = MC.TEX

FACE_Z = 10.0  # faceplate front
PLATE_Z0 = 8.0  # faceplate back
LIP_Z0, LIP_Z1 = 6.9, 8.0  # well lip, just in front of the tape's raised pad (6.6)
WELL_BACK_Z = -7.0  # 1 mm behind the tape's back face
TAPE_HX, TAPE_HY = BC.L["shell"]["w"] / 2, BC.L["shell"]["h"] / 2
LIP_IN = (TAPE_HX - 1.0, TAPE_HY - 1.0, 2.0)  # opening overlaps the tape by 1 mm

STYLES = {
    "silver70s": {
        "hole": (52.5, 34.0, 3.0),  # faceplate well hole half extents + corner r
        "plate": (78.0, 80.0),  # faceplate half extents (walnut cheeks outside)
        "cheeks": (78.0, 112.0),
        "door_border": 4.0,
        "glass_alpha": 0.45,
    },
    "black80s": {"hole": (52.5, 34.0, 1.5), "plate": (135.0, 80.0), "cheeks": None, "door_border": 2.6,
                 "glass_alpha": 0.5},
    "hifi": {"hole": (61.0, 34.5, 1.0), "plate": (135.0, 80.0), "cheeks": None, "door_border": 1.6,
             "glass_alpha": 0.42},
}


# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {"style": "silver70s", "tape_scale": 0.6, "door": True, "vu": True, "counter": True, "keys": True}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip("-").replace("-", "_")
        v = argv[i + 1]
        if k == "style":
            a["style"] = v
        elif k == "tape_scale":
            a["tape_scale"] = float(v)
        elif k in MC.DECK_PARTS:
            a[k] = v.lower() in ("on", "1", "true", "yes")
        else:
            raise SystemExit("unknown argument --%s" % k)
        i += 2
    if a["style"] not in STYLES:
        raise SystemExit("--style must be one of %s" % ", ".join(STYLES))
    if a["tape_scale"] not in MC.TAPE_SCALES:
        raise SystemExit("--tape-scale must be one of %s" % (MC.TAPE_SCALES,))
    return a


# ---------------------------------------------------------------------------
# Object helpers
# ---------------------------------------------------------------------------
@contextmanager
def part(coll_name):
    """Everything created inside the block is moved into collection coll_name."""
    coll = bpy.data.collections.get(coll_name)
    if not coll:
        coll = bpy.data.collections.new(coll_name)
        bpy.context.scene.collection.children.link(coll)
    before = set(bpy.data.objects.keys())
    yield coll
    for name in set(bpy.data.objects.keys()) - before:
        ob = bpy.data.objects[name]
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        coll.objects.link(ob)


def box(name, x0, y0, x1, y1, z0, z1, mat, r=0.0):
    pts = BC.rounded_rect((x1 - x0) / 2, (y1 - y0) / 2, r, 6, (x0 + x1) / 2, (y0 + y1) / 2) if r > 0 \
        else BC.rect_pts(x0, y0, x1, y1)
    ob = BC.prism_obj(name, pts, z0, z1)
    BC.assign(ob, mat)
    return ob


def ring(name, outer, inner, z0, z1, mat, cx=0.0, cy=0.0):
    """Rounded-rect frame: outer/inner = (hx, hy, r)."""
    ob = BC.prism_obj(name, BC.rounded_rect(outer[0], outer[1], outer[2], 8, cx, cy), z0, z1)
    cut = BC.cutter(name + "_in", BC.rounded_rect(inner[0], inner[1], inner[2], 8, cx, cy), z0 - 1, z1 + 1)
    BC.boolean(ob, cut)
    BC.apply_modifiers(ob)
    bpy.data.objects.remove(cut)
    BC.assign(ob, mat)
    return ob


def cyl_x(name, cx, cy, cz, r, length, mat, seg=48):
    """Cylinder with its axis along X (counter wheels)."""
    bm = bmesh.new()
    pts = BC.circle_pts(r, seg)
    BC.add_prism(bm, pts, -length / 2, length / 2)
    ob = BC.new_obj(name, bm)
    ob.rotation_euler = (0, math.radians(90), 0)
    ob.location = (mm(cx), mm(cy), mm(cz))
    BC.assign(ob, mat)
    return ob


def disc(name, cx, cy, r, z0, z1, mat, seg=48):
    ob = BC.prism_obj(name, BC.circle_pts(r, seg, cx, cy), z0, z1)
    BC.assign(ob, mat)
    return ob


def poly(name, pts, z0, z1, mat):
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts)))
    if area < 0:
        pts = list(reversed(pts))
    ob = BC.prism_obj(name, pts, z0, z1)
    BC.assign(ob, mat)
    return ob


def text(name, body, x, y, z, size, mat, align="CENTER", valign="CENTER", rot=0.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = mm(size)
    cu.align_x = align
    cu.align_y = valign
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (mm(x), mm(y), mm(z))
    ob.rotation_euler = (0, 0, rot)
    return ob


def symbol(name, kind, cx, cy, s, z, mat):
    """Transport symbols from geometry (the built-in font lacks the glyphs)."""
    t = 0.12
    obs = []

    def tri(dx, direction, w=0.5 * s, h=0.62 * s):
        x0 = cx + dx
        if direction == "right":
            p = [(x0 - w / 2, cy - h / 2), (x0 + w / 2, cy), (x0 - w / 2, cy + h / 2)]
        elif direction == "left":
            p = [(x0 + w / 2, cy - h / 2), (x0 + w / 2, cy + h / 2), (x0 - w / 2, cy)]
        else:  # up
            p = [(x0 - h / 2, cy - 0.05 * s), (x0 + h / 2, cy - 0.05 * s), (x0, cy + 0.42 * s)]
        obs.append(poly("%s_%d" % (name, len(obs)), p, z, z + t, mat))

    if kind == "play":
        tri(0.05 * s, "right", 0.55 * s, 0.66 * s)
    elif kind == "rew":
        tri(-0.22 * s, "left")
        tri(0.22 * s, "left")
    elif kind == "ff":
        tri(-0.22 * s, "right")
        tri(0.22 * s, "right")
    elif kind == "stop":
        obs.append(box(name + "_sq", cx - 0.28 * s, cy - 0.28 * s, cx + 0.28 * s, cy + 0.28 * s, z, z + t, mat))
    elif kind == "pause":
        for i, dx in enumerate((-0.17, 0.17)):
            obs.append(box("%s_b%d" % (name, i), cx + (dx - 0.09) * s, cy - 0.3 * s, cx + (dx + 0.09) * s,
                           cy + 0.3 * s, z, z + t, mat))
    elif kind == "eject":
        tri(0, "up")
        obs.append(box(name + "_bar", cx - 0.31 * s, cy - 0.36 * s, cx + 0.31 * s, cy - 0.2 * s, z, z + t, mat))
    return obs


def tag(ob, key):
    ob["mf"] = key
    return ob


def pivot(name, x, y, z, key, rest, sweep=(-40.0, 40.0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = (mm(x), mm(y), mm(z))
    e["mf_pivot"] = key
    e["rest_deg"] = rest
    e["sweep_deg"] = list(sweep)
    return e


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def materials(style):
    D = os.path.join(T, "deck")
    P = os.path.join(T, "plastic")
    M = {}
    tp = MC.textured_principled
    if style == "silver70s":
        M["face"] = tp("D_Face", (0.78, 0.78, 0.77), tex=os.path.join(D, "brushed-aluminium-silver.png"),
                       tile_mm=90, grain=0.9, rough=0.3, rough_var=0.08, metal=0.85, color_tex=True)
        M["doorframe"] = M["face"]
        # Satin aluminium caps: part diffuse so they catch the key light (a pure mirror
        # facing the camera only shows the dark lower environment and hides the legends).
        M["key"] = tp("D_KeyChrome", (0.9, 0.9, 0.9), tex=os.path.join(D, "brushed-aluminium-silver.png"),
                      tile_mm=30, grain=0.9, rough=0.3, metal=0.45, color_tex=True)
        M["walnut"] = tp("D_Walnut", (1, 1, 1), tex=os.path.join(D, "walnut-veneer.png"), tile_mm=60, grain=1.0,
                         rough=0.42, rough_var=0.05, coat=0.35, color_tex=True, rot_z=math.radians(90))
        M["legend"] = tp("D_Legend", (0.012, 0.012, 0.012), rough=0.6, spec=0.2)
    elif style == "black80s":
        M["face"] = tp("D_Face", (0.9, 0.9, 0.9), tex=os.path.join(D, "black-anodised-aluminium.png"),
                       tile_mm=90, grain=1.0, rough=0.36, rough_var=0.08, metal=0.7, color_tex=True)
        M["doorframe"] = tp("D_DoorFrame", (0.018, 0.018, 0.02), tex=os.path.join(P, "black-scratched.png"),
                            tile_mm=45, grain=0.5, rough=0.35, rough_var=0.1, spec=0.3)
        M["key"] = tp("D_KeyBlack", (0.02, 0.02, 0.022), tex=os.path.join(P, "black-scratched.png"),
                      tile_mm=30, grain=0.5, rough=0.4, rough_var=0.1, spec=0.3)
        M["legend"] = tp("D_Legend", (0.55, 0.55, 0.56), rough=0.5)
    else:  # hifi: brushed dark aluminium
        M["face"] = tp("D_Face", (0.2, 0.2, 0.21), tex=os.path.join(D, "brushed-aluminium-silver.png"),
                       tile_mm=90, grain=0.9, rough=0.3, rough_var=0.08, metal=0.9, color_tex=True)
        M["doorframe"] = M["face"]
        M["key"] = tp("D_KeyDark", (0.34, 0.34, 0.35), tex=os.path.join(D, "brushed-aluminium-silver.png"),
                      tile_mm=30, grain=0.9, rough=0.28, metal=0.9, color_tex=True)
        M["legend"] = tp("D_Legend", (0.5, 0.5, 0.5), rough=0.5)
    M["well"] = tp("D_Well", (0.012, 0.012, 0.013), tex=os.path.join(P, "black-scratched.png"), tile_mm=40,
                   grain=0.5, rough=0.6, rough_var=0.1)
    M["lip"] = tp("D_Lip", (0.016, 0.016, 0.017), tex=os.path.join(P, "black-scratched.png"), tile_mm=40,
                  grain=0.5, rough=0.42, rough_var=0.1)
    M["spindle"] = tp("D_Spindle", (0.7, 0.7, 0.68), rough=0.35)
    M["bezel"] = tp("D_Bezel", (0.015, 0.015, 0.016), rough=0.25, coat=0.3)
    # Smoked glass: the texture carries the faint diagonal streak and dust.
    g = tp("D_Glass", (0.012, 0.011, 0.01), tex=os.path.join(D, "smoked-glass-door.png"), tile_mm=110,
           grain=0.35, rough=0.05, rough_var=0.03, alpha=STYLES[style]["glass_alpha"], spec=0.5, blend=True)
    M["glass"] = g
    M["meterface"] = tp("D_MeterFace", (0.66, 0.6, 0.44), tex=os.path.join(T, "paper", "cream-clean.png"),
                        tile_mm=30, grain=0.4, rough=0.7, emission=((1.0, 0.78, 0.45), 0.12))
    M["ink"] = tp("D_Ink", (0.02, 0.02, 0.02), rough=0.6)
    M["red"] = tp("D_InkRed", (0.55, 0.03, 0.02), rough=0.6)
    M["needle"] = tp("D_Needle", (0.01, 0.01, 0.01), rough=0.4)
    M["wheel"] = tp("D_Wheel", (0.02, 0.02, 0.02), rough=0.35)
    M["digit"] = tp("D_Digit", (0.85, 0.85, 0.82), rough=0.5)
    M["led_off"] = tp("D_LedOff", (0.012, 0.02, 0.012), rough=0.2, emission=((0.15, 1.0, 0.2), 0.02))
    M["led_g"] = tp("D_LedG", (0.05, 0.5, 0.1), rough=0.3, emission=((0.15, 1.0, 0.2), 2.2))
    M["led_y"] = tp("D_LedY", (0.6, 0.35, 0.05), rough=0.3, emission=((1.0, 0.55, 0.05), 2.2))
    M["led_r"] = tp("D_LedR", (0.6, 0.05, 0.02), rough=0.3, emission=((1.0, 0.08, 0.03), 2.2))
    M["vfd"] = tp("D_Vfd", (0.1, 0.5, 0.45), rough=0.3, emission=((0.2, 1.0, 0.85), 2.2))
    M["vfd_off"] = tp("D_VfdOff", (0.008, 0.015, 0.015), rough=0.3, emission=((0.2, 1.0, 0.85), 0.012))
    M["display"] = tp("D_Display", (0.004, 0.006, 0.006), rough=0.08, spec=0.8, coat=0.5)
    return M


# ---------------------------------------------------------------------------
# Shared well
# ---------------------------------------------------------------------------
def build_well(style, M):
    hole = STYLES[style]["hole"]
    obs = []
    obs.append(ring("Well_Lip", (hole[0] + 0.5, hole[1] + 0.5, hole[2]), LIP_IN, LIP_Z0, LIP_Z1, M["lip"]))
    back = box("Well_Back", -hole[0] - 4, -hole[1] - 4, hole[0] + 4, hole[1] + 4, WELL_BACK_Z - 1.0, WELL_BACK_Z,
               M["well"])
    obs.append(back)
    # cavity side walls behind the lip
    obs.append(ring("Well_Walls", (hole[0] + 4, hole[1] + 4, 1.0), (hole[0] + 3, hole[1] + 3, 1.0),
                    WELL_BACK_Z, LIP_Z0, M["well"]))
    hx = BC.L["hub"]["spacing"] / 2
    for sx, nm in ((-1, "L"), (1, "R")):
        obs.append(disc("Spindle_" + nm, sx * hx, 0.0, 2.8, WELL_BACK_Z, 2.5, M["spindle"]))
        obs.append(disc("Spindle_%s_Base" % nm, sx * hx, 0.0, 5.0, WELL_BACK_Z, WELL_BACK_Z + 0.6, M["lip"]))
    op = BC.prism_obj("Well_Opening", BC.rounded_rect(*LIP_IN), LIP_Z1, LIP_Z1 + 0.01)
    op.hide_render = True
    tag(op, "well")
    return obs


def build_faceplate(style, M):
    s = STYLES[style]
    hole = s["hole"]
    px, py = s["plate"]
    plate = BC.prism_obj("Faceplate", BC.rect_pts(-px, -py, px, py), PLATE_Z0, FACE_Z)
    cut = BC.cutter("wellhole", BC.rounded_rect(*hole), PLATE_Z0 - 1, FACE_Z + 1)
    BC.boolean(plate, cut)
    BC.apply_modifiers(plate)
    bpy.data.objects.remove(cut)
    BC.assign(plate, M["face"])
    if s["cheeks"]:
        x0, x1 = s["cheeks"]
        for sx, nm in ((-1, "L"), (1, "R")):
            a, b = sorted((sx * x0, sx * x1))
            box("Cheek_" + nm, a, -py, b, py, PLATE_Z0 - 20, FACE_Z + 4.0, M["walnut"], r=0.0)
            # dark shadow gap between plate and cheek
            g0, g1 = sorted((sx * (x0 - 0.6), sx * x0))
            box("CheekGap_" + nm, g0, -py, g1, py, PLATE_Z0, FACE_Z - 0.2, M["well"])
    return plate


# ---------------------------------------------------------------------------
# Optional parts
# ---------------------------------------------------------------------------
def build_door(style, M):
    s = STYLES[style]
    hole = s["hole"]
    ox, oy = hole[0] - 0.4, hole[1] - 0.4
    bd = s["door_border"]
    hinge = bpy.data.objects.new("Door_Hinge", None)
    bpy.context.scene.collection.objects.link(hinge)
    hinge.location = (0, mm(-oy), mm(PLATE_Z0 + 0.3))
    frame = ring("Door_Frame", (ox, oy, max(hole[2] - 0.4, 0.3)), (ox - bd, oy - bd, 1.0), PLATE_Z0 + 0.3,
                 FACE_Z + 0.3, M["doorframe"])
    tag(frame, "door")
    glass = box("Door_Glass", -ox + bd - 0.2, -oy + bd - 0.2, ox - bd + 0.2, oy - bd + 0.2, FACE_Z - 1.2,
                FACE_Z - 0.6, M["glass"])
    MC.origin_to_center(glass)
    parts = [frame, glass]
    if style == "black80s":
        # finger notch at the top of the door frame
        parts.append(box("Door_Notch", -9, oy - bd + 0.1, 9, oy - 0.6, FACE_Z + 0.3, FACE_Z + 0.35, M["lip"], r=0.5))
    for ob in parts:
        mw = ob.matrix_world.copy()
        ob.parent = hinge
        ob.matrix_parent_inverse = hinge.matrix_world.inverted()
        ob.matrix_world = mw
    return hinge


def vu_meter(name, cx, cy, w, h, M, rest, key):
    """Analogue VU meter: bezel, cream backlit face, printed scale, black needle."""
    border = 1.3
    ring(name + "_Bezel", (w / 2, h / 2, 1.2), (w / 2 - border, h / 2 - border, 0.6), FACE_Z, FACE_Z + 2.0,
         M["bezel"], cx, cy)
    tag(bpy.data.objects[name + "_Bezel"], key)
    fw, fh = w - 2 * border, h - 2 * border
    fz = FACE_Z + 0.4  # meter face sits in the bezel, 1.6 mm below its rim
    box(name + "_Face", cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2, FACE_Z, fz, M["meterface"])
    pz = fz + 0.06
    SW = 34.0  # half sweep, degrees
    pvx, pvy = cx, cy - fh / 2 - 0.06 * fh  # pivot hidden under the bezel's bottom border
    R = 0.72 * fh
    # scale: -20 .. +3 VU mapped to -SW .. +SW degrees; red arc from 0 VU
    marks = [(d * SW / 40.0, lab) for d, lab in
             [(-40, "-20"), (-24, "-10"), (-12, "-5"), (0, "-3"), (9, ""), (18, "0"), (29, "+2"), (40, "+3")]]
    red_from = 18 * SW / 40.0
    arc = []
    for i in range(41):
        a = math.radians(-SW + 2 * SW * i / 40)
        arc.append((pvx + R * math.sin(a), pvy + R * math.cos(a)))
    # arc line as thin quads
    for i in range(40):
        (x0, y0), (x1, y1) = arc[i], arc[i + 1]
        deg = -SW + 2 * SW * (i + 0.5) / 40
        red = deg >= red_from
        th = 0.22 if red else 0.1
        nx, ny = (y1 - y0), -(x1 - x0)
        ln = math.hypot(nx, ny)
        nx, ny = nx / ln * th, ny / ln * th
        poly("%s_Arc%d" % (name, i), [(x0, y0), (x1, y1), (x1 + nx, y1 + ny), (x0 + nx, y0 + ny)], fz + 0.02, pz,
             M["red"] if red else M["ink"])
    for deg, lab in marks:
        a = math.radians(deg)
        r0, r1 = R, R + (0.11 * fh if lab else 0.07 * fh)
        sx_, cx_ = math.sin(a), math.cos(a)
        tw = 0.09
        p = [(pvx + r0 * sx_ - tw * cx_, pvy + r0 * cx_ + tw * sx_), (pvx + r0 * sx_ + tw * cx_, pvy + r0 * cx_ - tw * sx_),
             (pvx + r1 * sx_ + tw * cx_, pvy + r1 * cx_ - tw * sx_), (pvx + r1 * sx_ - tw * cx_, pvy + r1 * cx_ + tw * sx_)]
        red = deg >= red_from
        poly("%s_Tick%d" % (name, round(deg + 40)), p, fz + 0.02, pz, M["red"] if red else M["ink"])
        if lab:
            rl = R + 0.17 * fh
            text("%s_Num%d" % (name, round(deg + 40)), lab, pvx + rl * sx_, pvy + rl * cx_, pz, 0.08 * fh,
                 M["red"] if red else M["ink"], rot=-a)
    text(name + "_VU", "VU", cx, cy - 0.2 * fh, pz, 0.18 * fh, M["ink"])
    # needle
    ln = R + 0.1 * fh
    nd = box(name + "_Needle", -0.09, 0.0, 0.09, ln, 0, 0.1, M["needle"])
    nd.location = (mm(pvx), mm(pvy), mm(fz + 0.3))
    nd.rotation_euler = (0, 0, math.radians(-rest))
    pivot(name + "_Pivot", pvx, pvy, fz + 0.3, key.replace("vu", "vuNeedle"), rest, (-SW, SW))


def mech_counter(name, cx, cy, digit_h, M, reset=True):
    """Three rolling digit wheels in a black window, white digits (reads 000)."""
    dw = digit_h * 0.72
    w = 3 * dw + 1.2 * 2 + 0.3 * 2
    h = digit_h + 2.4
    ring(name + "_Bezel", (w / 2, h / 2, 0.8), (w / 2 - 1.2, h / 2 - 1.2, 0.3), FACE_Z, FACE_Z + 2.0, M["bezel"],
         cx, cy)
    tag(bpy.data.objects[name + "_Bezel"], "counter")
    box(name + "_Back", cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, FACE_Z, FACE_Z + 0.05, M["well"])
    r = digit_h * 0.95
    wz = FACE_Z + 1.3  # wheel fronts, 0.7 mm below the bezel rim
    for i in range(3):
        x = cx + (i - 1) * dw
        cyl_x("%s_Wheel%d" % (name, i), x, cy, wz - r, r, dw - 0.25, M["wheel"])
        text("%s_Digit%d" % (name, i), "0", x, cy, wz + 0.06, digit_h * 0.9, M["digit"])
    if reset:
        disc(name + "_Reset", cx + w / 2 + 2.2, cy, 1.1, FACE_Z, FACE_Z + 1.2, M["bezel"])


def seven_seg(name, digit, cx, cy, h, z, on, off):
    """One 7-segment digit, lit segments in `on`, ghost segments in `off`."""
    segs = {"a": (0, 1), "b": (1, 0.5), "c": (1, -0.5), "d": (0, -1), "e": (-1, -0.5), "f": (-1, 0.5), "g": (0, 0)}
    lit = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
           "7": "abc", "8": "abcdefg", "9": "abcdfg"}[digit]
    w = 0.55 * h
    t = 0.13 * h
    skew = 0.12
    for k, (sx, sy) in segs.items():
        if sx == 0:
            x0, x1 = cx - w / 2 + t * 0.6, cx + w / 2 - t * 0.6
            y = cy + sy * h / 2
            p = [(x0, y - t / 2), (x1, y - t / 2), (x1, y + t / 2), (x0, y + t / 2)]
        else:
            x = cx + sx * w / 2
            y0 = cy + sy * h / 2 - h / 4 + t * 0.6
            y1 = cy + sy * h / 2 + h / 4 - t * 0.6
            p = [(x - t / 2, y0), (x + t / 2, y0), (x + t / 2, y1), (x - t / 2, y1)]
        p = [(px + skew * (py - cy), py) for px, py in p]
        poly("%s_%s" % (name, k), p, z, z + 0.03, on if k in lit else off)


def build_extras_silver70s(M):
    with part("Deck_Vu"):
        for sx, nm, rest in ((-1, "L", -14.0), (1, "R", -6.0)):
            vu_meter("VU_" + nm, sx * 64.0, 26.0, 19.0, 18.0, M, rest, "vu" + nm)
            text("VU_%s_Label" % nm, "LEFT" if sx < 0 else "RIGHT", sx * 64.0, 15.3, FACE_Z + 0.01, 1.5, M["legend"])
    with part("Deck_Counter"):
        mech_counter("Counter", 64.0, 7.0, 4.6, M)
        text("Counter_Label", "TAPE COUNTER", 62.0, 1.4, FACE_Z + 0.01, 1.2, M["legend"])
    with part("Deck_Keys"):
        names = [("REW", "rew"), ("PLAY", "play"), ("FF", "ff"), ("STOP", "stop"), ("PAUSE", "pause"),
                 ("EJECT", "eject")]
        kw, gap, kh = 13.6, 0.8, 5.4
        total = 6 * kw + 5 * gap
        yc = -38.0
        box("Keys_Slot", -total / 2 - 1.0, yc - kh / 2 - 0.8, total / 2 + 1.0, yc + kh / 2 + 0.8, FACE_Z - 0.2,
            FACE_Z + 0.02, M["well"], r=0.6)
        for i, (lab, k) in enumerate(names):
            x0 = -total / 2 + i * (kw + gap)
            pressed = k == "play"
            z1 = FACE_Z + (1.2 if pressed else 2.8)
            key = box("Key_" + k, x0, yc - kh / 2, x0 + kw, yc + kh / 2, FACE_Z - 3, z1, M["key"], r=0.5)
            tag(key, "key_" + k)
            text("Key_%s_Label" % k, lab, x0 + kw / 2, yc, z1 + 0.1, 1.7, M["legend"])


def build_extras_black80s(M):
    with part("Deck_Vu"):
        # LED bar meter window above the well, right of centre
        x0, x1, y0, y1 = -8.0, 52.0, 34.9, 40.7
        ring("Led_Bezel", ((x1 - x0) / 2, (y1 - y0) / 2, 0.6), ((x1 - x0) / 2 - 0.7, (y1 - y0) / 2 - 0.7, 0.3),
             FACE_Z, FACE_Z + 1.0, M["bezel"], (x0 + x1) / 2, (y0 + y1) / 2)
        tag(bpy.data.objects["Led_Bezel"], "ledMeter")
        box("Led_Glass", x0, y0, x1, y1, FACE_Z, FACE_Z + 0.2, M["display"])
        n, seg_w, seg_gap = 20, 2.05, 0.55
        sx0 = x0 + 4.2
        for row, (yy, lit_n) in enumerate(((38.8, 14), (36.8, 12))):
            text("Led_Ch%d" % row, "LR"[row], x0 + 2.0, yy, FACE_Z + 0.22, 1.3, M["legend"])
            for i in range(n):
                xx = sx0 + i * (seg_w + seg_gap)
                col = "led_g" if i < 14 else ("led_y" if i < 17 else "led_r")
                m = M[col] if i < lit_n else M["led_off"]
                box("Led_%d_%d" % (row, i), xx, yy - 0.6, xx + seg_w, yy + 0.6, FACE_Z + 0.2, FACE_Z + 0.25, m)
    with part("Deck_Counter"):
        x0, x1, y0, y1 = -50.0, -26.0, 34.9, 40.7
        ring("Counter_Bezel", ((x1 - x0) / 2, (y1 - y0) / 2, 0.6), ((x1 - x0) / 2 - 0.7, (y1 - y0) / 2 - 0.7, 0.3),
             FACE_Z, FACE_Z + 1.0, M["bezel"], (x0 + x1) / 2, (y0 + y1) / 2)
        tag(bpy.data.objects["Counter_Bezel"], "counter")
        box("Counter_Glass", x0, y0, x1, y1, FACE_Z, FACE_Z + 0.2, M["display"])
        for i in range(3):
            seven_seg("Counter_D%d" % i, "0", -41.0 + i * 3.4, 37.8, 3.6, FACE_Z + 0.21, M["vfd"], M["vfd_off"])
        text("Counter_Label", "CNT", -47.5, 37.8, FACE_Z + 0.21, 1.2, M["vfd"])
    with part("Deck_Keys"):
        kinds = ["rew", "play", "ff", "stop", "pause", "eject"]
        kw, gap, kh = 11.0, 2.2, 4.4
        total = 6 * kw + 5 * gap
        yc = -38.4
        for i, k in enumerate(kinds):
            x0 = -total / 2 + i * (kw + gap)
            pressed = k == "play"
            z1 = FACE_Z + (0.5 if pressed else 1.2)
            key = box("Key_" + k, x0, yc - kh / 2, x0 + kw, yc + kh / 2, FACE_Z - 1, z1, M["key"], r=0.7)
            tag(key, "key_" + k)
            symbol("Key_%s_Sym" % k, k, x0 + kw / 2, yc, 2.4, z1 + 0.005, M["legend"])
        # play indicator LED on the faceplate above the play key
        xp = -total / 2 + 1 * (kw + gap) + kw / 2
        disc("Key_play_Led", xp, yc + kh / 2 + 1.1, 0.45, FACE_Z, FACE_Z + 0.25, M["led_g"], 24)


def build_extras_hifi(M):
    with part("Deck_Vu"):
        for i, (nm, rest) in enumerate((("L", -16.0), ("R", -9.0))):
            vu_meter("VU_" + nm, 68.0, 26.5 - i * 12.5, 12.0, 11.0, M, rest, "vu" + nm)
    with part("Deck_Counter"):
        mech_counter("Counter", -67.5, 26.0, 3.4, M, reset=False)
        disc("Counter_Reset", -67.5, 21.2, 0.9, FACE_Z, FACE_Z + 0.8, M["key"])
    with part("Deck_Keys"):
        kinds = ["rew", "play", "ff", "stop", "pause", "eject"]
        kw, gap, kh = 9.0, 1.6, 2.6
        total = 6 * kw + 5 * gap
        yc = -39.2
        for i, k in enumerate(kinds):
            x0 = -total / 2 + i * (kw + gap)
            pressed = k == "play"
            z1 = FACE_Z + (0.25 if pressed else 0.7)
            key = box("Key_" + k, x0, yc - kh / 2, x0 + kw, yc + kh / 2, FACE_Z - 1, z1, M["key"], r=0.4)
            tag(key, "key_" + k)
            symbol("Key_%s_Sym" % k, k, x0 + kw / 2, yc + kh / 2 + 1.5, 1.5, FACE_Z + 0.005, M["legend"])


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
def world_and_render(style):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("DeckStudio")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.3
    mr.inputs["From Max"].default_value = 0.5
    nt.links.new(sep.outputs["Y"], mr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    lo, hi = ((0.10, 0.10, 0.11), (0.62, 0.61, 0.58)) if style != "hifi" else ((0.06, 0.06, 0.07), (0.5, 0.5, 0.5))
    mix.inputs[6].default_value = (*lo, 1)
    mix.inputs[7].default_value = (*hi, 1)
    nt.links.new(mr.outputs["Result"], mix.inputs["Factor"])
    nt.links.new(mix.outputs[2], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    sc.world = w
    sc.render.film_transparent = False
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.eevee.taa_render_samples = 64
    sc.view_settings.view_transform = "Khronos PBR Neutral"
    sc.view_settings.look = "None"
    # -0.6 EV: with the door off, the TDK label (#C9CBCE) otherwise clips to white.
    sc.view_settings.exposure = -0.6
    # Soft top light across the whole faceplate (the phase 0 rig only covers the tape).
    ld = bpy.data.lights.new("DeckTop", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 0.6, 0.2
    ld.energy = 8.0
    ld.color = (1.0, 0.97, 0.93)
    lo_ = bpy.data.objects.new("DeckTop", ld)
    sc.collection.objects.link(lo_)
    lo_.location = (-0.05, 0.35, 0.5)
    lo_.rotation_euler = (Vector((0, 0, 0)) - Vector(lo_.location)).to_track_quat("-Z", "Y").to_euler()


def main():
    a = parse_args()
    style = a["style"]
    sc = bpy.context.scene
    M = materials(style)
    with part("Deck"):
        build_faceplate(style, M)
        build_well(style, M)
    with part("Deck_Door"):
        build_door(style, M)
    {"silver70s": build_extras_silver70s, "black80s": build_extras_black80s, "hifi": build_extras_hifi}[style](M)
    world_and_render(style)
    MC.set_tape_scale(a["tape_scale"])
    MC.set_deck_parts(**{k: a[k] for k in MC.DECK_PARTS})
    sc["deck_style"] = style
    for k in MC.DECK_PARTS:
        sc["deck_" + k] = a[k]
    bad = MC.safe_zone_check(sc)
    print("MIXTAPE safe-zone check at scale %.1f: %s" % (a["tape_scale"], bad or "all inside"))
    out = os.path.join(MC.ART, "deck_%s.blend" % style)
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print("MIXTAPE saved", out)


if __name__ == "__main__":
    main()
