"""Build the base compact cassette scene for Mixtape (phase 0, work package A).

Run headless (after make_tape_pack_texture.py):
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/mixtape/build_cassette.py

Writes art-src/mixtape/cassette_base.blend. Everything is built from primitives and
bmesh by this script; nothing in the .blend is hand placed.

Conventions
- 1 Blender unit = 1 m; all dimensions below are in mm and go through mm().
- The cassette face looks at +Z. Image right = +X, image up = +Y. The camera sits on
  +Z looking straight down -Z, so the face is perpendicular to the lens axis.
- Origin = centre of the shell outline (100.4 x 63.8 mm) and the shell mid plane.
- Hub centres are 42.5 mm apart on the shell's horizontal centre line (y = 0), below
  the label's writing strip.
- The layout numbers are stored on the scene as JSON (scene["mixtape_layout"]) so the
  render/manifest script projects the same geometry without retyping numbers.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.join(ROOT, "art-src", "mixtape")
BLEND_PATH = os.path.join(ART, "cassette_base.blend")
TAPE_TEX = os.path.join(ART, "textures", "tape_pack.png")


def mm(v):
    return v * 0.001


# ---------------------------------------------------------------------------
# Layout (mm). Physical: IEC 60094 compact cassette.
# ---------------------------------------------------------------------------
L = {
    "shell": {"w": 100.4, "h": 63.8, "d": 12.0, "corner_r": 2.5, "wall": 1.5},
    "face_z": 6.0,  # front face plane
    "hub": {
        "spacing": 42.5,
        "y": 0.0,
        "r_outer": 11.0,  # empty-pack radius r0
        "r_bore": 4.4,
        "teeth": 6,
        "half_h": 3.25,
    },
    "pack": {"r_full": 25.0, "half_h": 1.9, "wind_fraction_rendered": 0.5},
    "window": {"x": 33.0, "y": 11.5, "r": 2.0},  # half extents
    "hub_hole_r": 6.5,
    "label": {"x0": -43.5, "x1": 43.5, "y0": -16.5, "y1": 28.5, "z0": 6.0, "z1": 6.12,
              "hole_x": 34.0, "hole_y": 12.5, "hole_r": 2.5},
    "pad": {"y_top": -19.5, "half_w_top": 29.0, "half_w_bottom": 34.0, "z1": 6.6},
    "screws": [[-46.5, 28.2], [46.5, 28.2], [-46.5, -28.2], [46.5, -28.2], [0.0, -25.5]],
    "screw_hole_r": 2.0,
    "rollers": {"x": 41.5, "y": -27.3, "r": 1.5},
    "tape_run_y": -28.8,
    # Label content layout (mm on the label plane), writing strip above the window.
    "art_slot": {"x0": -42.5, "x1": -28.5, "y0": 13.5, "y1": 27.5},
    "text": {
        "x0": -26.5, "x1": 42.5, "x_height": 2.0,
        "lines": [["artist", 24.4], ["album", 19.6], ["song", 14.8]],
    },
    "camera": {"lens": 135.0, "sensor_w": 36.0, "tape_frac_of_width": 0.60},
    "render": {"w": 3840, "h": 2160},
}


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------
def rounded_rect(hx, hy, r, seg=8, cx=0.0, cy=0.0):
    pts = []
    corners = [(hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180), (hx - r, -hy + r, 270)]
    for x, y, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            pts.append((cx + x + r * math.cos(a), cy + y + r * math.sin(a)))
    return pts


def rect_pts(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def circle_pts(r, seg=64, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(2 * math.pi * i / seg), cy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


def new_obj(name, bm, parent=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def add_prism(bm, pts_mm, z0, z1):
    """Closed prism from a CCW 2D polygon (mm), between z0 and z1 (mm)."""
    bot = [bm.verts.new((mm(x), mm(y), mm(z0))) for x, y in pts_mm]
    top = [bm.verts.new((mm(x), mm(y), mm(z1))) for x, y in pts_mm]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(pts_mm)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))


def add_annulus(bm, r_in, r_out, z0, z1, seg=96, cx=0.0, cy=0.0):
    rings = []
    for r, z in ((r_out, z0), (r_out, z1), (r_in, z1), (r_in, z0)):
        rings.append([bm.verts.new((mm(cx + r * math.cos(2 * math.pi * i / seg)),
                                    mm(cy + r * math.sin(2 * math.pi * i / seg)), mm(z))) for i in range(seg)])
    for k in range(4):
        a, b = rings[k], rings[(k + 1) % 4]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))


def add_box(bm, x0, y0, x1, y1, z0, z1):
    add_prism(bm, rect_pts(x0, y0, x1, y1), z0, z1)


def prism_obj(name, pts, z0, z1, parent=None):
    bm = bmesh.new()
    add_prism(bm, pts, z0, z1)
    return new_obj(name, bm, parent)


def cutter(name, pts, z0, z1):
    ob = prism_obj("CUT_" + name, pts, z0, z1)
    ob.hide_render = True
    ob.hide_viewport = True
    ob.display_type = "WIRE"
    return ob


def boolean(ob, cut, op="DIFFERENCE"):
    m = ob.modifiers.new("BOOL_" + cut.name, "BOOLEAN")
    m.operation = op
    m.solver = "EXACT"
    m.object = cut
    return m


def apply_modifiers(ob):
    """Bake modifiers into the mesh (keeps the .blend simple and bounds exact)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def principled(name, color, rough=0.4, metal=0.0, alpha=1.0, spec=0.5, coat=0.0, render_method="BLENDED"):
    mat = bpy.data.materials.new(name)
    mat.use_fake_user = True  # keep variant materials that are unassigned at save time
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Alpha"].default_value = alpha
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = spec
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    if alpha < 1.0:
        mat.surface_render_method = render_method
    return mat


def tape_pack_material():
    mat = bpy.data.materials.new("TapePack")
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.38
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    img = nt.nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(TAPE_TEX)
    img.extension = "CLIP"
    # Object coords (m) -> 0..1 across the pack diameter. The driver of scale is
    # the object's custom prop "pack_r_m" (radius in metres), set per pack below.
    mp.vector_type = "POINT"
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], img.inputs["Vector"])
    nt.links.new(img.outputs["Color"], b.inputs["Base Color"])
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "OBJECT"
    attr.attribute_name = "pack_r_m"
    # scale = 1 / (2 r), location = 0.5: built with math nodes so each pack's own
    # radius drives it.
    div = nt.nodes.new("ShaderNodeMath")
    div.operation = "DIVIDE"
    div.inputs[0].default_value = 0.5
    nt.links.new(attr.outputs["Fac"], div.inputs[1])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for k in range(3):
        nt.links.new(div.outputs[0], comb.inputs[k])
    nt.links.new(comb.outputs[0], mp.inputs["Scale"])
    mp.inputs["Location"].default_value = (0.5, 0.5, 0.0)
    return mat


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    sc.unit_settings.length_unit = "MILLIMETERS"
    return sc


def build_shell(mats):
    s = L["shell"]
    hx, hy, r = s["w"] / 2, s["h"] / 2, s["corner_r"]
    fz, wall = L["face_z"], s["wall"]
    outline = rounded_rect(hx, hy, r)
    inner = rounded_rect(hx - wall, hy - wall, max(r - wall, 0.5))

    root = bpy.data.objects.new("Cassette", None)
    bpy.context.scene.collection.objects.link(root)

    w = L["window"]
    win_pts = rounded_rect(w["x"], w["y"], w["r"])
    hub_x = L["hub"]["spacing"] / 2
    hub_y = L["hub"]["y"]
    cut_window = cutter("window", win_pts, fz - 3, fz + 3)
    cut_hubs = []
    for sx in (-1, 1):
        cut_hubs.append(cutter("hubhole_%d" % sx, circle_pts(L["hub_hole_r"], 64, sx * hub_x, hub_y), -10, 10))
    cut_screws = [cutter("screw_%d" % i, circle_pts(L["screw_hole_r"], 32, x, y), 4.8, 10)
                  for i, (x, y) in enumerate(L["screws"])]

    front = prism_obj("Shell_Front", outline, fz - wall, fz, root)
    boolean(front, cut_window)
    for c in cut_screws:
        boolean(front, c)

    back = prism_obj("Shell_Back", outline, -fz, -fz + wall, root)
    for c in cut_hubs:
        boolean(back, c)

    bm = bmesh.new()
    add_prism(bm, outline, -fz + wall, fz - wall)
    walls = new_obj("Shell_Walls", bm, root)
    cut_inner = cutter("inner", inner, -fz, fz)
    boolean(walls, cut_inner)

    # Screw bosses (visible through the smoked shell).
    bm = bmesh.new()
    for x, y in L["screws"]:
        add_annulus(bm, 0.9, 2.6, -fz + wall, fz - wall, 32, x, y)
    bosses = new_obj("Shell_Bosses", bm, root)

    p = L["pad"]
    pad_pts = [(-p["half_w_bottom"], -hy), (p["half_w_bottom"], -hy), (p["half_w_top"], p["y_top"]),
               (-p["half_w_top"], p["y_top"])]
    pad = prism_obj("Shell_Pad", pad_pts, fz - 0.1, p["z1"], root)
    boolean(pad, cut_screws[4])

    window = prism_obj("Window", win_pts, fz - wall + 0.1, fz - 0.05, root)
    for c in cut_hubs:
        boolean(window, c)

    lb = L["label"]
    label = prism_obj("Label", rect_pts(lb["x0"], lb["y0"], lb["x1"], lb["y1"]), lb["z0"], lb["z1"], root)
    cut_label = cutter("labelhole", rounded_rect(lb["hole_x"], lb["hole_y"], lb["hole_r"]), fz - 3, fz + 3)
    boolean(label, cut_label)

    for ob in (front, back, walls, bosses, pad, window, label):
        apply_modifiers(ob)
    for ob in list(bpy.data.objects):
        if ob.name.startswith("CUT_"):
            bpy.data.objects.remove(ob)

    for ob in (front, back, walls, bosses, pad):
        assign(ob, mats["Shell_Black"])
        ob["shell_part"] = True
    assign(window, mats["Window_Clear"])
    window["window_part"] = True
    assign(label, mats["Label_Paper"])

    # Screws: head recessed in its countersink, with a cross slot.
    for i, (x, y) in enumerate(L["screws"]):
        top = p["z1"] - 0.25 if i == 4 else fz - 0.2
        bm = bmesh.new()
        add_prism(bm, circle_pts(1.75, 32), top - 1.0, top)
        head = new_obj("Screw_%d" % i, bm, root)
        head.location = (mm(x), mm(y), 0)
        slot_a = cutter("slot_a", rect_pts(-1.3, -0.22, 1.3, 0.22), top - 0.5, top + 1)
        slot_b = cutter("slot_b", rect_pts(-0.22, -1.3, 0.22, 1.3), top - 0.5, top + 1)
        slot_a.location = slot_b.location = head.location
        boolean(head, slot_a)
        boolean(head, slot_b)
        apply_modifiers(head)
        bpy.data.objects.remove(slot_a)
        bpy.data.objects.remove(slot_b)
        assign(head, mats["Screw"])
    return root


def build_hub(name, x, y, mats, root):
    h = L["hub"]
    bm = bmesh.new()
    add_annulus(bm, h["r_bore"], h["r_outer"], -h["half_h"], h["half_h"], 96)
    ob = new_obj(name, bm, root)
    # Leader clamp slot in the rim (makes rotation read even at the rim). Cut before
    # the teeth are added: the exact boolean drops overlapping loose parts.
    slot = cutter("clamp", rect_pts(8.6, -1.1, 11.5, 1.1), -h["half_h"] - 1, h["half_h"] + 1)
    boolean(ob, slot)
    apply_modifiers(ob)
    bpy.data.objects.remove(slot)

    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # Six drive teeth pointing into the bore.
    for k in range(h["teeth"]):
        a = 2 * math.pi * k / h["teeth"] + math.pi / 2
        box = rect_pts(-0.65, h["r_bore"] - 1.3, 0.65, h["r_bore"] + 0.3)
        rot = [(px * math.cos(a) - py * math.sin(a), px * math.sin(a) + py * math.cos(a)) for px, py in box]
        add_prism(bm, rot, -h["half_h"] + 0.4, h["half_h"] - 0.2)
    # Raised inner collar on the face.
    add_annulus(bm, h["r_bore"] + 0.01, 6.2, h["half_h"] - 0.1, h["half_h"] + 0.35, 96)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob.location = (mm(x), mm(y), 0)
    assign(ob, mats["Hub"])
    return ob


def pack_radius(f, r0, R):
    """Take-up and supply pack radii for wind fraction f (conserved tape area)."""
    r_s = math.sqrt(R * R - f * (R * R - r0 * r0))
    r_t = math.sqrt(r0 * r0 + f * (R * R - r0 * r0))
    return r_s, r_t


def build_tape(mats, root):
    h, p = L["hub"], L["pack"]
    hub_x = h["spacing"] / 2
    r_s, r_t = pack_radius(p["wind_fraction_rendered"], h["r_outer"], p["r_full"])
    packs = {}
    for name, sx, r in (("Pack_L", -1, r_s), ("Pack_R", 1, r_t)):
        bm = bmesh.new()
        add_annulus(bm, h["r_outer"] - 0.1, r, -p["half_h"], p["half_h"], 128)
        ob = new_obj(name, bm, root)
        ob.location = (mm(sx * hub_x), mm(h["y"]), 0)
        ob["pack_r_m"] = mm(r)
        assign(ob, mats["TapePack"])
        packs[name] = (sx * hub_x, h["y"], r)

    ro = L["rollers"]
    for sx, nm in ((-1, "Roller_L"), (1, "Roller_R")):
        bm = bmesh.new()
        add_annulus(bm, 0.5, ro["r"], -2.6, 2.6, 32, sx * ro["x"], ro["y"])
        roller = new_obj(nm, bm, root)
        assign(roller, mats["Hub"])
        bm = bmesh.new()
        add_prism(bm, circle_pts(0.5, 16, sx * ro["x"], ro["y"]), -4.5, 4.5)
        pin = new_obj(nm + "_Pin", bm, root)
        assign(pin, mats["Screw"])

    # Tape path: pack -> roller (outer tangent), then the run along the bottom.
    bm = bmesh.new()
    th = 0.12
    for name, sx, _ in (("Pack_L", -1, 0), ("Pack_R", 1, 0)):
        cx, cy, r1 = packs[name]
        c2 = (sx * ro["x"], ro["y"])
        dx, dy = c2[0] - cx, c2[1] - cy
        D = math.hypot(dx, dy)
        phi = math.atan2(dy, dx)
        alpha = math.acos((r1 - ro["r"]) / D)
        cands = []
        for ang in (phi + alpha, phi - alpha):
            u = (math.cos(ang), math.sin(ang))
            cands.append(((cx + r1 * u[0], cy + r1 * u[1]), (c2[0] + ro["r"] * u[0], c2[1] + ro["r"] * u[1])))
        # Outer tangent: the candidate furthest towards the shell's side edge.
        p1, p2 = min(cands, key=lambda c: -sx * c[0][0])
        ex, ey = p2[0] - p1[0], p2[1] - p1[1]
        ln = math.hypot(ex, ey)
        nx, ny = -ey / ln * th / 2, ex / ln * th / 2
        quad = [(p1[0] - nx, p1[1] - ny), (p2[0] - nx, p2[1] - ny), (p2[0] + nx, p2[1] + ny), (p1[0] + nx, p1[1] + ny)]
        # ensure CCW
        area = sum(quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1] for i in range(4))
        if area < 0:
            quad.reverse()
        add_prism(bm, quad, -p["half_h"], p["half_h"])
    y = L["tape_run_y"]
    add_box(bm, -ro["x"], y - th / 2, ro["x"], y + th / 2, -p["half_h"], p["half_h"])
    tape = new_obj("Tape_Path", bm, root)
    assign(tape, mats["TapePlain"])

    # Pressure pad (felt) and its spring, behind the tape at the head opening.
    bm = bmesh.new()
    add_box(bm, -3.0, y + 0.08, 3.0, y + 1.6, -1.8, 1.8)
    felt = new_obj("PressurePad", bm, root)
    assign(felt, mats["Felt"])
    bm = bmesh.new()
    add_box(bm, -6.0, y + 1.6, 6.0, y + 1.9, -1.5, 1.5)
    spring = new_obj("PadSpring", bm, root)
    assign(spring, mats["Screw"])
    return packs, (r_s, r_t)


def build_materials():
    return {
        "Shell_Black": principled("Shell_Black", (0.012, 0.012, 0.013), rough=0.32, spec=0.6),
        "Shell_Smoke": principled("Shell_Smoke", (0.06, 0.055, 0.05), rough=0.08, alpha=0.42, spec=0.7),
        "Shell_Cream": principled("Shell_Cream", (0.78, 0.74, 0.62), rough=0.38, spec=0.5),
        "Window_Clear": principled("Window_Clear", (0.02, 0.02, 0.02), rough=0.04, alpha=0.06, spec=0.8),
        "Window_Smoke": principled("Window_Smoke", (0.08, 0.075, 0.07), rough=0.04, alpha=0.30, spec=0.8),
        "Label_Paper": principled("Label_Paper", (0.86, 0.80, 0.64), rough=0.85, spec=0.2),
        "Hub": principled("Hub", (0.70, 0.70, 0.68), rough=0.35),
        "Screw": principled("Screw", (0.55, 0.55, 0.56), rough=0.3, metal=1.0),
        "TapePack": tape_pack_material(),
        "TapePlain": principled("TapePlain", (0.10, 0.05, 0.025), rough=0.35),
        "Felt": principled("Felt", (0.5, 0.45, 0.35), rough=0.95, spec=0.1),
    }


def build_camera_and_lights(sc):
    c = L["camera"]
    cam_data = bpy.data.cameras.new("Cam_Front")
    cam_data.lens = c["lens"]
    cam_data.sensor_width = c["sensor_w"]
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.clip_start = 0.01
    cam_data.clip_end = 10.0
    cam = bpy.data.objects.new("Cam_Front", cam_data)
    sc.collection.objects.link(cam)
    # Distance so the tape width is tape_frac_of_width of the frame at the face plane.
    view_w = L["shell"]["w"] / c["tape_frac_of_width"]
    dist = view_w * c["lens"] / c["sensor_w"]
    cam.location = (0, 0, mm(L["face_z"] + dist))
    cam.rotation_euler = (0, 0, 0)
    sc.camera = cam

    # Orthographic sprite camera for the hub sprite, placed over Hub_L at render time.
    sp = bpy.data.cameras.new("Cam_Sprite")
    sp.type = "ORTHO"
    sp.ortho_scale = mm(2 * L["hub"]["r_outer"] + 0.2)
    sp.clip_start = 0.001
    sp.clip_end = 1.0
    spo = bpy.data.objects.new("Cam_Sprite", sp)
    sc.collection.objects.link(spo)
    spo.location = (0, 0, 0.2)

    def area(name, loc, power, size, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = power
        ld.size = size
        ld.color = color
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        d = Vector((0, 0, 0)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        return lo

    # 3-point rig. Key high left, fill low right, rim/top from above-behind.
    area("Key", (-0.35, 0.30, 0.45), 3.0, 0.30, (1.0, 0.97, 0.92))
    area("Fill", (0.40, -0.15, 0.40), 1.0, 0.45, (0.92, 0.96, 1.0))
    area("Rim", (0.05, 0.45, 0.12), 1.5, 0.20)
    # Soft reflection card: sits near the mirror direction of the face so the glossy
    # plastic and the window pick up a broad highlight towards the upper left.
    card = area("Reflect", (-0.16, 0.13, 0.62), 1.2, 0.35)
    card.data.shape = "RECTANGLE"
    card.data.size_y = 0.12

    w = bpy.data.worlds.new("SoftGrey")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1)
    bg.inputs["Strength"].default_value = 0.6
    sc.world = w
    return cam, dist


def setup_render(sc):
    r = L["render"]
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = r["w"]
    sc.render.resolution_y = r["h"]
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.eevee.taa_render_samples = 64
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"


def main():
    if not os.path.exists(TAPE_TEX):
        raise SystemExit("Missing %s: run make_tape_pack_texture.py first" % TAPE_TEX)
    sc = reset_scene()
    mats = build_materials()
    root = build_shell(mats)
    hx = L["hub"]["spacing"] / 2
    build_hub("Hub_L", -hx, L["hub"]["y"], mats, root)
    build_hub("Hub_R", hx, L["hub"]["y"], mats, root)
    _, radii = build_tape(mats, root)
    cam, dist = build_camera_and_lights(sc)
    setup_render(sc)
    layout = dict(L)
    layout["derived"] = {"camera_distance_to_face_mm": dist, "pack_r_supply_mm": radii[0],
                         "pack_r_takeup_mm": radii[1]}
    sc["mixtape_layout"] = json.dumps(layout)
    os.makedirs(ART, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("MIXTAPE saved", BLEND_PATH, "camera distance to face %.1f mm" % dist)


if __name__ == "__main__":
    main()
