"""Mixtape proof of concept: camera projection of the Horizon HX-7 reference photo.

A crude 3D proxy of the deck is built from the same (orthographic, straight-on)
viewpoint as the photo, the photo is projected onto every proxy object with UVs
baked from the camera at the rest pose, and the proxy is animated (door tilts on
its bottom hinge, cassette lifts out, PLAY key presses) so the photo's pixels move
with the geometry. Surfaces the photo never saw get plain flat materials.

Two modes, one file:

  Blender (build + render):
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/mixtape/poc_projection.py
  System python3 (report, GIF, MP4, contact sheet; needs Pillow + numpy):
    python3 scripts/mixtape/poc_projection.py

Outputs go to art-src/mixtape/poc/ (gitignored).

Units: 1 BU = 1 mm. World X right, Y up, Z toward the camera. The faceplate front
is Z = 0. Photo pixel (px, py) (origin top-left, y down) maps to world
X = (px - CX) / K, Y = (CY - py) / K, independent of Z (orthographic camera).
"""

import os
import sys
import json
import math

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = os.path.join(ROOT, "art-src", "mixtape", "reference", "horizon_deck_reference.png")
OUT = os.path.join(ROOT, "art-src", "mixtape", "poc")

# ---------------------------------------------------------------------------
# Photo measurements (pixels in the 1672 x 941 reference, x0..x1 / y0..y1,
# origin top-left, y down). Read from gridded 3x / 4x zoom crops of the photo.
# ---------------------------------------------------------------------------
W, H = 1672, 941
CX, CY = W / 2.0, H / 2.0  # frame centre = camera axis

# Hole in the faceplate for the cassette well: outer edge of the dark border
# where the brushed silver stops (light edge line at x 430 / 1240, y 110 / 657).
WELL_HOLE = (430, 1240, 110, 657)

# Cassette shell as seen: left shell side at x 498, right at x 1170 (the label
# itself is x 523..1147). Width 672 px = 100.4 mm, so K = 6.693 px/mm; height
# 63.8 mm = 427 px from the visible top edge at y 150, which puts the bottom at
# y 577, exactly where the door's bottom bar starts to cover it.
CASSETTE = (498, 1170, 150, 577)
K = (CASSETTE[1] - CASSETTE[0]) / 100.4  # px per mm

# Door: silver top rail, four screwed brackets at the corners and the
# "PURE ANALOG SOUND" bar are opaque; the rest is glass (alpha 0, the photo's
# smoke tint stays baked into what is seen through it). Hinge = bottom edge.
DOOR = (446, 1222, 120, 648)
DOOR_OPAQUE = [
    (446, 1222, 120, 137),   # top rail with the light glass-edge line (y 128..135)
    (446, 486, 120, 222),    # left upper bracket (screw at 467, 160)
    (446, 486, 498, 578),    # left lower bracket (screw at 467, 560)
    (1182, 1222, 120, 222),  # right upper bracket (screw at 1203, 160)
    (1182, 1222, 498, 578),  # right lower bracket (screw at 1203, 560)
    (446, 1222, 578, 648),   # bottom bar "PURE ANALOG SOUND"
]
DOOR_HINGE_Y = DOOR[3]

# PLAY key: the dark housing opening in the faceplate, and the key cap itself
# (cap includes the amber lamp strip along its top at y 765..775).
KEY_HOLE = (500, 700, 752, 866)
KEY_CAP = (512, 686, 763, 857)

# Depths (mm, faceplate front = 0, toward camera positive).
Z_DOOR_FRONT, DOOR_THICK = -2.0, 1.5
Z_CAS_FRONT, CAS_THICK = -5.0, 12.0
Z_WELL_BACK = -25.0
Z_KEY_FRONT, KEY_DEPTH = 0.5, 8.0
Z_KEYWELL_BACK = -10.0

# Fake perspective for the orthographic camera: an object moved dz toward the
# camera is scaled by D / (D - dz) about the camera axis, as a pinhole this far
# away would show it. 450 mm is roughly a 65 mm lens framing this 250 mm deck.
EYE_D = 450.0

# Flat fills (linear emission colours) for surfaces the photo never saw.
FLAT_WELL = (0.006, 0.006, 0.006)
FLAT_CAS_SIDE = (0.012, 0.011, 0.010)
FLAT_CAS_TOP = (0.030, 0.028, 0.026)
FLAT_DOOR_EDGE = (0.30, 0.29, 0.27)
FLAT_KEY_SIDE = (0.22, 0.21, 0.19)

# Animation (frame numbers of the 12-frame eject).
DOOR_OPEN_DEG = 35.0
EJECT_FRAMES = 12
KEY_PRESS_MM = [0.0, 1.5, 3.0, 1.5]

RENDER_SAMPLES = 32
FILTER_SIZE = 0.50  # px; small so the still reproduces the photo, >0 for AA on motion


def px_to_world(px, py):
    return (px - CX) / K, (CY - py) / K


def world_to_uv(x, y):
    px = x * K + CX
    py = CY - y * K
    return px / W, 1.0 - py / H


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# ===========================================================================
# Blender side
# ===========================================================================

def blender_main():
    import bpy
    import bmesh
    import numpy as np
    from mathutils import Vector

    os.makedirs(OUT, exist_ok=True)

    # -- clean scene ---------------------------------------------------------
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    sc = bpy.context.scene

    # -- images --------------------------------------------------------------
    photo = bpy.data.images.load(REF)
    photo.colorspace_settings.name = "sRGB"

    def rect_mask(rects, invert_of=None):
        m = np.zeros((H, W), dtype=bool)
        for x0, x1, y0, y1 in rects:
            m[y0:y1, x0:x1] = True
        return m

    def to_image(name, m):
        img = bpy.data.images.new(name, W, H, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        a = np.flipud(m.astype(np.float32))
        rgba = np.stack([a, a, a, np.ones_like(a)], axis=-1)
        img.pixels.foreach_set(rgba.ravel())
        img.pack()
        return img

    cas_m = rect_mask([CASSETTE])
    door_op_m = rect_mask(DOOR_OPAQUE)
    keycap_m = rect_mask([KEY_CAP])
    # Well back wall: the photo saw it only where neither the cassette nor the
    # door's opaque parts were in front of it.
    wellback_vis = to_image("mask_wellback", ~cas_m & ~door_op_m)
    door_alpha = to_image("mask_door", door_op_m)
    keyback_vis = to_image("mask_keyback", ~keycap_m)

    # -- materials -----------------------------------------------------------
    def new_mat(name):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        return m, nt, out

    def tex(nt, img, interp="Linear"):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = interp
        t.extension = "EXTEND"
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "Projected"
        nt.links.new(uv.outputs[0], t.inputs[0])
        return t

    def flat_mat(name, col):
        m, nt, out = new_mat(name)
        e = nt.nodes.new("ShaderNodeEmission")
        e.inputs["Color"].default_value = (*col, 1.0)
        nt.links.new(e.outputs[0], out.inputs["Surface"])
        return m

    def photo_mat(name, vis_mask=None, flat=FLAT_WELL, alpha_mask=None):
        """Emission of the projected photo. vis_mask: where 0, show `flat`
        instead (the photo did not see that surface). alpha_mask: where 0,
        fully transparent."""
        m, nt, out = new_mat(name)
        t = tex(nt, photo)
        e = nt.nodes.new("ShaderNodeEmission")
        col = t.outputs["Color"]
        if vis_mask is not None:
            mt = tex(nt, vis_mask)
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.inputs["B"].default_value = (*flat, 1.0)
            nt.links.new(mt.outputs["Color"], mix.inputs["Factor"])
            mix.inputs["A"].default_value = (*flat, 1.0)
            nt.links.new(col, mix.inputs["B"])
            col = mix.outputs["Result"]
        nt.links.new(col, e.inputs["Color"])
        shader = e.outputs[0]
        if alpha_mask is not None:
            at = tex(nt, alpha_mask)
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            ms = nt.nodes.new("ShaderNodeMixShader")
            nt.links.new(at.outputs["Color"], ms.inputs["Fac"])
            nt.links.new(tr.outputs[0], ms.inputs[1])
            nt.links.new(shader, ms.inputs[2])
            shader = ms.outputs[0]
            m.surface_render_method = "DITHERED"
        nt.links.new(shader, out.inputs["Surface"])
        return m

    M_PHOTO = photo_mat("Photo")
    M_WELLBACK = photo_mat("Photo_WellBack", vis_mask=wellback_vis, flat=FLAT_WELL)
    M_KEYBACK = photo_mat("Photo_KeyBack", vis_mask=keyback_vis, flat=FLAT_WELL)
    M_DOOR = photo_mat("Photo_Door", alpha_mask=door_alpha)
    M_WELL_FLAT = flat_mat("Flat_Well", FLAT_WELL)
    M_CAS_SIDE = flat_mat("Flat_CassetteSide", FLAT_CAS_SIDE)
    M_CAS_TOP = flat_mat("Flat_CassetteTop", FLAT_CAS_TOP)
    M_DOOR_EDGE = flat_mat("Flat_DoorEdge", FLAT_DOOR_EDGE)
    M_KEY_SIDE = flat_mat("Flat_KeySide", FLAT_KEY_SIDE)

    # -- geometry helpers ------------------------------------------------------
    def finish(name, bm, mats, origin_world=(0, 0, 0)):
        """bm verts are in world mm. Bake projected UVs at this rest pose, then
        move the origin to origin_world without moving the geometry."""
        uvl = bm.loops.layers.uv.new("Projected")
        for f in bm.faces:
            for lp in f.loops:
                lp[uvl].uv = world_to_uv(lp.vert.co.x, lp.vert.co.y)
        o = Vector(origin_world)
        for v in bm.verts:
            v.co -= o
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        ob.location = o
        sc.collection.objects.link(ob)
        return ob

    def add_quad(bm, pts, mat_index):
        vs = [bm.verts.new(p) for p in pts]
        f = bm.faces.new(vs)
        f.material_index = mat_index
        return f

    def box(rect_px, z0, z1, front_mat, side_mat, top_mat=None, back_mat=None):
        """Box over a pixel rect, z0 (back) .. z1 (front). Material indices:
        0 front, 1 sides+bottom, 2 top, 3 back."""
        x0, y1w = px_to_world(rect_px[0], rect_px[2])  # top-left -> (x0, ytop)
        x1, y0w = px_to_world(rect_px[1], rect_px[3])
        bm = bmesh.new()
        P = lambda x, y, z: (x, y, z)
        add_quad(bm, [P(x0, y0w, z1), P(x1, y0w, z1), P(x1, y1w, z1), P(x0, y1w, z1)], 0)  # front
        add_quad(bm, [P(x1, y0w, z0), P(x0, y0w, z0), P(x0, y1w, z0), P(x1, y1w, z0)], 3)  # back
        add_quad(bm, [P(x0, y1w, z1), P(x1, y1w, z1), P(x1, y1w, z0), P(x0, y1w, z0)], 2)  # top
        add_quad(bm, [P(x0, y0w, z0), P(x1, y0w, z0), P(x1, y0w, z1), P(x0, y0w, z1)], 1)  # bottom
        add_quad(bm, [P(x0, y0w, z0), P(x0, y0w, z1), P(x0, y1w, z1), P(x0, y1w, z0)], 1)  # left
        add_quad(bm, [P(x1, y0w, z1), P(x1, y0w, z0), P(x1, y1w, z0), P(x1, y1w, z1)], 1)  # right
        mats = [front_mat, side_mat, top_mat or side_mat, back_mat or side_mat]
        return bm, mats

    # -- faceplate: plane at z 0 with holes for the well and the PLAY key -------
    M = 40  # margin in px beyond the frame (texture EXTEND repeats the border)
    xs = sorted({-M, WELL_HOLE[0], WELL_HOLE[1], KEY_HOLE[0], KEY_HOLE[1], W + M})
    ys = sorted({-M, WELL_HOLE[2], WELL_HOLE[3], KEY_HOLE[2], KEY_HOLE[3], H + M})

    def inside(r, px, py):
        return r[0] <= px <= r[1] and r[2] <= py <= r[3]

    bm = bmesh.new()
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            mx, my = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if inside(WELL_HOLE, mx, my) or inside(KEY_HOLE, mx, my):
                continue
            (ax, ay), (bx, by) = px_to_world(xs[i], ys[j + 1]), px_to_world(xs[i + 1], ys[j])
            add_quad(bm, [(ax, ay, 0), (bx, ay, 0), (bx, by, 0), (ax, by, 0)], 0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    finish("Faceplate", bm, [M_PHOTO])

    # -- well recess: back wall (projected where seen) + four flat side walls ---
    bm, mats = box(WELL_HOLE, Z_WELL_BACK, 0.0, M_WELL_FLAT, M_WELL_FLAT)
    # Open box: drop the front face, flip the rest inward, back wall = photo.
    front = [f for f in bm.faces if f.material_index == 0]
    bmesh.ops.delete(bm, geom=front, context="FACES_ONLY")
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.material_index = 0 if f.material_index == 3 else 1
    finish("WellRecess", bm, [M_WELLBACK, M_WELL_FLAT])

    # -- key well behind the PLAY key --------------------------------------------
    bm, mats = box(KEY_HOLE, Z_KEYWELL_BACK, 0.0, M_WELL_FLAT, M_WELL_FLAT)
    front = [f for f in bm.faces if f.material_index == 0]
    bmesh.ops.delete(bm, geom=front, context="FACES_ONLY")
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    for f in bm.faces:
        f.material_index = 0 if f.material_index == 3 else 1
    finish("KeyWell", bm, [M_KEYBACK, M_WELL_FLAT])

    # -- cassette: 100.4 x 63.8 x 12 mm, front = photo, other faces flat --------
    bm, mats = box(CASSETTE, Z_CAS_FRONT - CAS_THICK, Z_CAS_FRONT,
                   M_PHOTO, M_CAS_SIDE, M_CAS_TOP, M_CAS_SIDE)
    ccx, ccy = px_to_world((CASSETTE[0] + CASSETTE[1]) / 2, (CASSETTE[2] + CASSETTE[3]) / 2)
    cas = finish("Cassette", bm, mats, (ccx, ccy, Z_CAS_FRONT - CAS_THICK / 2))

    # -- door: thin box, origin on the bottom hinge line ------------------------
    bm, mats = box(DOOR, Z_DOOR_FRONT - DOOR_THICK, Z_DOOR_FRONT,
                   M_DOOR, M_DOOR_EDGE, M_DOOR_EDGE, M_DOOR)  # back face masked too, or the glass shows it
    _, hinge_y = px_to_world(0, DOOR_HINGE_Y)
    dcx, _ = px_to_world((DOOR[0] + DOOR[1]) / 2, 0)
    door = finish("Door", bm, mats, (dcx, hinge_y, Z_DOOR_FRONT - DOOR_THICK / 2))

    # -- PLAY key ------------------------------------------------------------------
    bm, mats = box(KEY_CAP, Z_KEY_FRONT - KEY_DEPTH, Z_KEY_FRONT, M_PHOTO, M_KEY_SIDE)
    kcx, kcy = px_to_world((KEY_CAP[0] + KEY_CAP[1]) / 2, (KEY_CAP[2] + KEY_CAP[3]) / 2)
    key = finish("KeyPlay", bm, mats, (kcx, kcy, Z_KEY_FRONT))

    # -- camera (orthographic, straight on) ----------------------------------------
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    cd.ortho_scale = W / K
    cd.sensor_fit = "HORIZONTAL"
    cd.clip_start = 1.0
    cd.clip_end = 3000.0
    cam = bpy.data.objects.new("Cam", cd)
    cam.location = (0, 0, 1000.0)
    sc.collection.objects.link(cam)
    sc.camera = cam

    # -- render settings -------------------------------------------------------------
    sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = RENDER_SAMPLES
    sc.render.filter_size = FILTER_SIZE
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.pixel_aspect_x = sc.render.pixel_aspect_y = 1.0
    sc.render.film_transparent = False
    sc.render.dither_intensity = 0.0
    sc.render.use_motion_blur = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0, 0, 0, 1)

    # -- pose helpers ------------------------------------------------------------------
    cas_rest = cas.location.copy()
    key_rest = key.location.copy()

    def fake_persp(ob, rest, dx, dy, dz):
        """Place ob at rest + (dx, dy, dz) and scale it as a pinhole camera at
        EYE_D would: s = D / (D - dz), positions scaled about the camera axis."""
        s = EYE_D / (EYE_D - dz)
        ob.location = ((rest.x + dx) * s, (rest.y + dy) * s, rest.z + dz)
        ob.scale = (s, s, s)
        return s

    def set_rest():
        door.rotation_euler = (0, 0, 0)
        fake_persp(cas, cas_rest, 0, 0, 0)
        fake_persp(key, key_rest, 0, 0, 0)

    def render(path):
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    times = {}
    import time

    # 1. still
    set_rest()
    t = time.time()
    render(os.path.join(OUT, "still.png"))
    times["still.png"] = round(time.time() - t, 2)

    # 2. eject, 12 frames
    #   0..3  door tilts 0 -> 35 deg on the bottom hinge (top toward the camera)
    #   3..9  cassette comes forward (mostly in 3..5) and rises
    #   9..11 cassette keeps rising, out of frame
    poses = []
    for f in range(EJECT_FRAMES):
        ang = DOOR_OPEN_DEG * smooth(f / 3.0)
        if f <= 3:
            dy, dz = 0.0, 0.0
        elif f <= 9:
            u = (f - 3) / 6.0
            dz = 13.0 * smooth(min(1.0, (f - 3) / 2.0))  # forward first: -5 -> +8 mm
            dy = 34.0 * (u ** 1.6)                         # then up, easing in
        else:
            u = (f - 9) / 2.0
            dz = 13.0 + 4.0 * u
            dy = 34.0 + 70.0 * u
        door.rotation_euler = (math.radians(ang), 0, 0)  # +X rotation: top comes toward +Z (camera)
        s = fake_persp(cas, cas_rest, 0.0, dy, dz)
        fake_persp(key, key_rest, 0, 0, 0)
        name = "eject_%02d.png" % f
        t = time.time()
        render(os.path.join(OUT, name))
        times[name] = round(time.time() - t, 2)
        poses.append({"frame": f, "door_deg": round(ang, 2), "cassette_dy_mm": round(dy, 2),
                      "cassette_dz_mm": round(dz, 2), "cassette_scale": round(s, 4)})

    # 3. key press, 4 frames
    set_rest()
    key_poses = []
    for f, mm in enumerate(KEY_PRESS_MM):
        s = fake_persp(key, key_rest, 0, 0, -mm)
        name = "key_%02d.png" % f
        t = time.time()
        render(os.path.join(OUT, name))
        times[name] = round(time.time() - t, 2)
        key_poses.append({"frame": f, "press_mm": mm, "key_scale": round(s, 5)})

    # 4. still at 3840 x 2160 (same framing; the 1672 px photo stretched 2.30x)
    set_rest()
    sc.render.resolution_x, sc.render.resolution_y = 3840, 2160
    # keep the same film filter in output pixels relative to the source: scale it
    sc.render.filter_size = FILTER_SIZE * 3840 / W
    t = time.time()
    render(os.path.join(OUT, "still_4k.png"))
    times["still_4k.png"] = round(time.time() - t, 2)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "poc_projection.blend"))

    meta = {
        "k_px_per_mm": K,
        "rects_px": {"well_hole": WELL_HOLE, "cassette": CASSETTE, "door": DOOR,
                     "door_opaque": DOOR_OPAQUE, "key_hole": KEY_HOLE, "key_cap": KEY_CAP},
        "depths_mm": {"door_front": Z_DOOR_FRONT, "cassette_front": Z_CAS_FRONT,
                      "well_back": Z_WELL_BACK, "key_front": Z_KEY_FRONT},
        "eye_distance_mm": EYE_D, "filter_px": FILTER_SIZE, "samples": RENDER_SAMPLES,
        "eject_poses": poses, "key_poses": key_poses, "render_seconds": times,
    }
    with open(os.path.join(OUT, "render_meta.json"), "w") as fh:
        json.dump(meta, fh, indent=2)
    print("POC renders done:", times)


# ===========================================================================
# System python side: difference report, softness, GIF / MP4, contact sheet
# ===========================================================================

def post_main():
    import subprocess
    import numpy as np
    from PIL import Image

    ref = np.asarray(Image.open(REF).convert("RGB")).astype(np.int16)
    still = np.asarray(Image.open(os.path.join(OUT, "still.png")).convert("RGB")).astype(np.int16)
    d = np.abs(still - ref)
    per_px = d.max(axis=2)
    report = {
        "still_vs_reference": {
            "mean_abs_diff_levels": round(float(d.mean()), 3),
            "p99_abs_diff_levels": float(np.percentile(per_px, 99)),
            "max_abs_diff_levels": int(d.max()),
            "pct_pixels_over_8_levels": round(float((per_px > 8).mean() * 100), 3),
        }
    }
    # Where are the big differences? Bounding boxes of >16 levels.
    ys, xs = np.nonzero(per_px > 16)
    report["still_vs_reference"]["pixels_over_16_levels"] = int(len(xs))
    Image.fromarray(np.clip(per_px * 8, 0, 255).astype(np.uint8)).save(os.path.join(OUT, "still_diff_x8.png"))

    # Key frames: how many pixels change, and by how much, vs key_00.
    k0 = np.asarray(Image.open(os.path.join(OUT, "key_00.png")).convert("RGB")).astype(np.int16)
    kr = {}
    for f in range(1, len(KEY_PRESS_MM)):
        kf = np.asarray(Image.open(os.path.join(OUT, "key_%02d.png" % f)).convert("RGB")).astype(np.int16)
        dd = np.abs(kf - k0).max(axis=2)
        kr["key_%02d" % f] = {"press_mm": KEY_PRESS_MM[f], "pixels_changed_over_8": int((dd > 8).sum()),
                              "mean_abs_diff_in_key_hole": round(float(np.abs(kf - k0)[KEY_HOLE[2]:KEY_HOLE[3], KEY_HOLE[0]:KEY_HOLE[1]].mean()), 3)}
    report["key_press"] = kr

    # 4K softness: 10-90% rise of the sharp horizontal edge at the top of the
    # door bar (photo y 577 dark -> y 579 highlight), averaged over x 700..900.
    # The window is kept tight so it spans only the dark gap and the highlight.
    def rise(img, y_lo, y_hi, x_lo, x_hi):
        g = np.asarray(img.convert("L")).astype(np.float64)[y_lo:y_hi, x_lo:x_hi].mean(axis=1)
        lo, hi = g.min(), g.max()
        a = np.argmax(g >= lo + 0.1 * (hi - lo))
        b = np.argmax(g >= lo + 0.9 * (hi - lo))
        return int(b - a), [round(v, 1) for v in g]

    s4 = Image.open(os.path.join(OUT, "still_4k.png"))
    sc = 3840 / W
    r_ref, prof_ref = rise(Image.open(REF), 576, 580, 700, 900)
    r_4k, prof_4k = rise(s4, int(576 * sc), int(580 * sc) + 1, int(700 * sc), int(900 * sc))
    # Gradient energy per unit of picture width: a true 4K image of this scene
    # would carry detail up to 3840 px; this one carries at most 1672.
    gref = np.asarray(Image.open(REF).convert("L")).astype(np.float64)
    g4 = np.asarray(s4.convert("L")).astype(np.float64)
    grad = lambda g: float(np.abs(np.diff(g, axis=1)).mean() + np.abs(np.diff(g, axis=0)).mean())
    report["still_4k"] = {
        "scale_factor": round(sc, 4),
        "source_px_per_4k_px": round(1 / sc, 4),
        "edge_rise_10_90_px_reference": r_ref,
        "edge_rise_10_90_px_4k": r_4k,
        "edge_rise_4k_in_4k_px_expected_if_sharp": 1,
        "edge_profile_reference": prof_ref,
        "edge_profile_4k": prof_4k,
        "mad_vs_bicubic_upscale_of_reference": round(float(np.abs(g4 - np.asarray(Image.open(REF).convert("L").resize((3840, 2160), Image.BICUBIC)).astype(np.float64)).mean()), 3),
        "mean_abs_gradient_reference": round(grad(gref), 3),
        "mean_abs_gradient_4k": round(grad(g4), 3),
        "gradient_ratio_4k_over_reference": round(grad(g4) / grad(gref), 3),
    }
    # Crop pair for eyeballing: the label title at native 4K pixels.
    s4.crop((int(700 * sc), int(195 * sc), int(700 * sc) + 900, int(195 * sc) + 500)).save(
        os.path.join(OUT, "still_4k_crop_label.png"))

    meta_p = os.path.join(OUT, "render_meta.json")
    if os.path.exists(meta_p):
        report["render_meta"] = json.load(open(meta_p))

    with open(os.path.join(OUT, "report.json"), "w") as fh:
        json.dump(report, fh, indent=2)
    print(json.dumps(report["still_vs_reference"], indent=2))
    print(json.dumps(report["still_4k"], indent=2))
    print(json.dumps(report["key_press"], indent=2))

    # GIF (hold the first and last frames a little) and MP4.
    frames = [Image.open(os.path.join(OUT, "eject_%02d.png" % f)).convert("RGB") for f in range(EJECT_FRAMES)]
    small = [fr.resize((1003, 564), Image.LANCZOS) for fr in frames]
    durs = [500] + [83] * (EJECT_FRAMES - 2) + [600]
    small[0].save(os.path.join(OUT, "eject.gif"), save_all=True, append_images=small[1:],
                  duration=durs, loop=0, optimize=True)
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "12",
                        "-i", os.path.join(OUT, "eject_%02d.png"),
                        "-vf", "scale=1672:940", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        os.path.join(OUT, "eject.mp4")], check=True)
    except Exception as e:  # ffmpeg is optional
        print("ffmpeg failed:", e)

    # Contact sheet, 4 x 3.
    tw, th = 556, 313
    sheet = Image.new("RGB", (tw * 4, th * 3), (20, 20, 20))
    for i, fr in enumerate(frames):
        sheet.paste(fr.resize((tw, th), Image.LANCZOS), ((i % 4) * tw, (i // 4) * th))
    sheet.save(os.path.join(OUT, "eject_sheet.png"))


if __name__ == "__main__":
    try:
        import bpy  # noqa: F401
        IN_BLENDER = True
    except ImportError:
        IN_BLENDER = False
    if IN_BLENDER:
        blender_main()
    else:
        post_main()
