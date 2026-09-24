"""Shared bpy helpers for the Mixtape look-development scripts (work package B).

Imported by lookdev_cassette.py, build_deck.py and render_options.py (all run inside
headless Blender). Geometry helpers come from build_cassette.py and the projection
helpers from render_phase0.py, so there is one implementation of each.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import build_cassette as BC  # noqa: E402  (module level only defines helpers + layout)
import label_layout as LL  # noqa: E402
import render_phase0 as RP  # noqa: E402

ROOT = BC.ROOT
ART = BC.ART
TEX = os.path.join(ART, "textures")
LOOK_BLEND = os.path.join(ART, "cassette_look.blend")
OPTIONS_OUT = os.path.join(ART, "renders", "options")

mm = BC.mm

# Tapes shown in the options round. shell / window are material names made by
# lookdev_cassette.py; style is the label style.
TAPES = {
    "tdk": {"shell": "Shell_Black", "window": "Window_Clear", "style": "printed", "sku": "TDK SA-X 90"},
    "sony": {"shell": "Shell_White", "window": "Window_Clear", "style": "blank", "sku": "Sony HF 90"},
    "basf": {"shell": "Shell_Clear", "window": "Window_Clear", "style": "printed", "sku": "BASF Chrome Extra II 90"},
    "maxell": {"shell": "Shell_Black", "window": "Window_Clear", "style": "printed", "sku": "Maxell UDXL II 90"},
    "memorex": {"shell": "Shell_Black", "window": "Window_Smoke", "style": "printed", "sku": "Memorex dBS 90"},
    "fuji": {"shell": "Shell_White", "window": "Window_Clear", "style": "printed", "sku": "Fuji DR 90"},
}

TAPE_SCALES = (0.5, 0.6, 0.7)


def layout():
    return json.loads(bpy.context.scene["mixtape_layout"])


# ---------------------------------------------------------------------------
# Camera: tape scale = fraction of frame width spanned by the shell at its face
# ---------------------------------------------------------------------------
def camera_distance(frac):
    c = BC.L["camera"]
    view_w = BC.L["shell"]["w"] / frac
    return view_w * c["lens"] / c["sensor_w"]


def set_tape_scale(frac, sc=None):
    """Move Cam_Front along its axis (objects never move) so the tape spans frac."""
    sc = sc or bpy.context.scene
    cam = bpy.data.objects["Cam_Front"]
    d = camera_distance(frac)
    cam.location = (0.0, 0.0, mm(BC.L["face_z"] + d))
    cam.rotation_euler = (0, 0, 0)
    # Tight clip range: the scene is only ~30 mm deep, and a wide range z-fights the
    # printed legends that sit a fraction of a mm above their surfaces.
    cam.data.clip_start = mm(d - 60.0)
    cam.data.clip_end = mm(d + 80.0)
    sc.camera = cam
    sc["tape_scale"] = frac
    bpy.context.view_layer.update()
    return d


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
_img_cache = {}


def image(path, non_color=False):
    key = (path, non_color)
    if key in _img_cache and _img_cache[key].name in bpy.data.images:
        return _img_cache[key]
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = "Non-Color"
    _img_cache[key] = im
    return im


def image_mean(im):
    """Mean luminance of an image (for normalising grain textures to 1.0)."""
    import numpy as np
    px = np.empty(len(im.pixels), dtype=np.float32)
    im.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    return float((px[:, 0] * 0.2126 + px[:, 1] * 0.7152 + px[:, 2] * 0.0722).mean())


def new_material(name):
    old = bpy.data.materials.get(name)
    if old:
        old.name = name + "_old"
    mat = bpy.data.materials.new(name)
    mat.use_fake_user = True
    mat.use_nodes = True
    return mat


def tex_grain(nt, path, tile_mm, amount, coords="Object", non_color=True, rot_z=0.0):
    """Texture luminance normalised to mean 1, then pulled towards 1 by (1 - amount).

    Returns the output socket (a float around 1.0). Object coords are in metres, so
    Mapping scale = 1 / tile size.
    """
    im = image(path, non_color)
    mean = max(image_mean(im), 1e-4)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    s = 1.0 / mm(tile_mm)
    mp.inputs["Scale"].default_value = (s, s, s)
    mp.inputs["Rotation"].default_value = (0, 0, rot_z)
    # Offset so no tile edge crosses the frame centre; MIRROR hides the seams of the
    # generated (not quite tileable) textures.
    mp.inputs["Location"].default_value = (0.37, 0.61, 0.0)
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = im
    tx.extension = "MIRROR"
    nt.links.new(tc.outputs[coords], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tx.inputs["Vector"])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(tx.outputs["Color"], bw.inputs["Color"])
    # 1 + amount * (x / mean - 1)
    m1 = nt.nodes.new("ShaderNodeMath")
    m1.operation = "MULTIPLY_ADD"
    m1.inputs[1].default_value = amount / mean
    m1.inputs[2].default_value = 1.0 - amount
    nt.links.new(bw.outputs["Val"], m1.inputs[0])
    return m1.outputs[0], tx


def textured_principled(name, color, tex=None, tile_mm=60.0, grain=0.5, rough=0.4, rough_var=0.0,
                        metal=0.0, coat=0.0, coat_rough=0.08, alpha=1.0, spec=0.5,
                        color_tex=False, rot_z=0.0, emission=None, blend=False):
    """Principled material, optionally modulated by a surface texture.

    color_tex=True uses the texture's own colour (times color) as base colour; otherwise
    its normalised luminance only adds grain. rough_var adds texture-driven roughness
    variation (scratches read as rougher).
    """
    mat = new_material(name)
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    b.inputs["Specular IOR Level"].default_value = spec
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1.0)
        b.inputs["Emission Strength"].default_value = emission[1]
    if tex:
        g, tx = tex_grain(nt, tex, tile_mm, grain, non_color=not color_tex, rot_z=rot_z)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.inputs[6].default_value = (*color, 1.0)
        if color_tex:
            nt.links.new(tx.outputs["Color"], mul.inputs[7])
        else:
            nt.links.new(g, mul.inputs[7])
        nt.links.new(mul.outputs[2], b.inputs["Base Color"])
        if rough_var:
            r = nt.nodes.new("ShaderNodeMath")
            r.operation = "MULTIPLY_ADD"
            r.use_clamp = True
            r.inputs[1].default_value = rough_var
            r.inputs[2].default_value = rough - rough_var
            nt.links.new(g, r.inputs[0])
            nt.links.new(r.outputs[0], b.inputs["Roughness"])
    if alpha < 1.0:
        # BLENDED for large, frontmost glass (no dither noise at 64 samples);
        # DITHERED (order independent) otherwise.
        mat.surface_render_method = "BLENDED" if blend else "DITHERED"
    return mat


def origin_to_center(ob):
    """Move an object's origin to its bounding-box centre without moving the mesh.

    Eevee sorts BLENDED surfaces per object by origin depth, so glass that was built
    in world coordinates (origin at 0) must get a real origin to sort correctly.
    """
    from mathutils import Matrix
    me = ob.data
    c = sum((Vector(v.co) for v in me.vertices), Vector()) / max(len(me.vertices), 1)
    me.transform(Matrix.Translation(-c))
    ob.matrix_world = ob.matrix_world @ Matrix.Translation(c)


def image_material(name, path, rough=0.6, spec=0.3, coat=0.0):
    """Material that maps an image across the object's bounding box (Generated coords)."""
    mat = new_material(name)
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular IOR Level"].default_value = spec
    b.inputs["Coat Weight"].default_value = coat
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = image(path)
    tx.extension = "EXTEND"
    tx.interpolation = "Cubic"
    nt.links.new(tc.outputs["Generated"], tx.inputs["Vector"])
    nt.links.new(tx.outputs["Color"], b.inputs["Base Color"])
    return mat


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------------------------------------------------------------------------
# Tape variants
# ---------------------------------------------------------------------------
def apply_tape(brand):
    t = TAPES[brand]
    sm = bpy.data.materials[t["shell"]]
    wm = bpy.data.materials[t["window"]]
    for ob in bpy.data.objects:
        if ob.get("shell_part"):
            ob.data.materials[0] = sm
        if ob.get("window_part"):
            ob.data.materials[0] = wm
    bpy.data.objects["Label_Strip"].data.materials[0] = bpy.data.materials["Label_%s_%s" % (brand, t["style"])]
    bpy.data.objects["Label_Band"].data.materials[0] = bpy.data.materials["LabelBand_%s" % brand]


# ---------------------------------------------------------------------------
# Manifest (normalised frame coordinates, via render_phase0's projection helpers)
# ---------------------------------------------------------------------------
def world_rect(sc, cam, obs):
    pts = []
    for ob in obs:
        mw = ob.matrix_world
        if ob.type == "MESH":
            for v in ob.data.vertices:
                pts.append(RP.project(sc, cam, mw @ v.co))
        else:
            for c in ob.bound_box:
                pts.append(RP.project(sc, cam, mw @ Vector(c)))
    return RP.rect_from_points(pts)


def tape_manifest(sc):
    """Shared tape geometry at the current camera: hubs, packs, label strip, per-label items."""
    cam = bpy.data.objects["Cam_Front"]
    bpy.context.view_layer.update()
    L = BC.L
    hub, pack = L["hub"], L["pack"]
    shell = [o for o in bpy.data.objects if o.get("shell_part")]
    out = {"spriteRect": world_rect(sc, cam, shell),
           "windowRect": world_rect(sc, cam, [bpy.data.objects["Window"]])}
    for name in ("Hub_L", "Hub_R"):
        ob = bpy.data.objects[name]
        cx, cy = ob.matrix_world.translation.x * 1000, ob.matrix_world.translation.y * 1000
        c, rx, ry = RP.radius_norm(sc, cam, cx, cy, hub["r_outer"], hub["half_h"])
        _, px, py = RP.radius_norm(sc, cam, cx, cy, pack["r_full"], pack["half_h"])
        out["hub" + name[-1]] = {"x": c[0], "y": c[1]}
        out["hubRadius"] = {"w": rx, "h": ry}
        out["fullPackRadius"] = {"w": px, "h": py}
    out["emptyPackRadius"] = out["hubRadius"]
    z = LL.PAPER_Z1
    s, bd = LL.STRIP, LL.BAND
    out["labelRect"] = RP.plane_rect(sc, cam, s["x0"], s["y0"], s["x1"], s["y1"], z)
    out["labelBandRect"] = RP.plane_rect(sc, cam, bd["x0"], bd["y0"], bd["x1"], bd["y1"], z)
    labels = {}
    for brand in LL.BRANDS:
        labels[brand] = {}
        for style in LL.STYLES:
            it = LL.label_items_mm(brand, style)
            a = it["art"]
            lines = []
            for ln in it["lines"]:
                left = RP.project(sc, cam, (mm(ln["x0"]), mm(ln["y"]), mm(z)))
                right = RP.project(sc, cam, (mm(ln["x1"]), mm(ln["y"]), mm(z)))
                xh = RP.project(sc, cam, (mm(ln["x0"]), mm(ln["y"] + ln["x_height"]), mm(z)))
                lines.append({"name": ln["name"], "svgId": ln["svgId"], "x": left[0], "baselineY": left[1],
                              "maxWidth": right[0] - left[0], "xHeight": left[1] - xh[1]})
            labels[brand][style] = {
                "artSlotRect": RP.plane_rect(sc, cam, a["x0"], a["y0"], a["x1"], a["y1"], z),
                "textLines": lines,
            }
    out["labels"] = labels
    # Top-level art slot and lines = the TDK printed label, for consumers that want one.
    out["artSlotRect"] = labels["tdk"]["printed"]["artSlotRect"]
    out["textLines"] = labels["tdk"]["printed"]["textLines"]
    out["renderedWindFraction"] = pack["wind_fraction_rendered"]
    out["pxPerMmAtFace"] = out["spriteRect"]["w"] * sc.render.resolution_x / L["shell"]["w"]
    out["labelMm"] = {"strip": LL.STRIP, "band": LL.BAND, "svgScale": LL.SVG_SCALE,
                      "svgWidthOnStripMm": LL.SVG_W_MM}
    return out


def deck_manifest(sc):
    """Per deck style items: every object tagged mf=<key> contributes a rect."""
    cam = bpy.data.objects["Cam_Front"]
    bpy.context.view_layer.update()
    groups = {}
    for ob in bpy.data.objects:
        k = ob.get("mf")
        if k:
            groups.setdefault(k, []).append(ob)
    out = {}
    for k, obs in sorted(groups.items()):
        out[k] = world_rect(sc, cam, obs)
    for ob in bpy.data.objects:
        if ob.get("mf_pivot"):
            p = RP.project(sc, cam, ob.matrix_world.translation)
            out[ob["mf_pivot"]] = {"x": p[0], "y": p[1], "sweepDeg": list(ob["sweep_deg"]),
                                   "restDeg": ob["rest_deg"]}
    hinge = bpy.data.objects.get("Door_Hinge")
    if hinge:
        p = RP.project(sc, cam, hinge.matrix_world.translation)
        out["doorHinge"] = {"edge": "bottom", "y": p[1]}
    return out


def safe_zone_check(sc, keys=("vu", "led", "counter", "key", "well")):
    """Which deck items fall outside the centred 16:10 crop (x 0.05..0.95) or the 6% bands."""
    d = deck_manifest(sc)
    bad = {}
    for k, r in d.items():
        if "w" not in r or not any(k.startswith(p) for p in keys):
            continue
        issues = []
        if r["x"] < 0.05 or r["x"] + r["w"] > 0.95:
            issues.append("x %.3f..%.3f" % (r["x"], r["x"] + r["w"]))
        if r["y"] < 0.06 or r["y"] + r["h"] > 0.94:
            issues.append("y %.3f..%.3f" % (r["y"], r["y"] + r["h"]))
        if issues:
            bad[k] = issues
    return bad


# ---------------------------------------------------------------------------
# Deck part toggles (collections made by build_deck.py)
# ---------------------------------------------------------------------------
DECK_PARTS = ("door", "vu", "counter", "keys")


def set_deck_parts(**flags):
    """set_deck_parts(door=True, vu=False, ...): show or hide the deck's optional parts."""
    for part in DECK_PARTS:
        if part in flags:
            coll = bpy.data.collections.get("Deck_" + part.capitalize())
            if coll:
                coll.hide_render = not flags[part]
                coll.hide_viewport = not flags[part]
    bpy.context.view_layer.update()
