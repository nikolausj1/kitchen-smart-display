"""Render the phase 0 cassette plates and write the draft manifest.

Run headless on the .blend written by build_cassette.py:
    /Applications/Blender.app/Contents/MacOS/Blender -b \
        art-src/mixtape/cassette_base.blend \
        --python scripts/mixtape/render_phase0.py [-- --only manifest|plates|sprite]

Writes to art-src/mixtape/renders/phase0/:
    cassette_shell_black.png, cassette_shell_clear.png, cassette_shell_white.png
    hub_sprite.png
    mixtape-manifest.draft.json

Every manifest number is computed by projecting scene geometry through Cam_Front
(bpy_extras world_to_camera_view). Nothing is hand typed. Normalised coordinates:
0..1 of the frame, origin top-left, x right, y down.
"""

import json
import os
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "art-src", "mixtape", "renders", "phase0")

VARIANTS = [
    # file suffix, shell material, window material
    ("black", "Shell_Black", "Window_Clear"),
    ("clear", "Shell_Smoke", "Window_Smoke"),
    ("white", "Shell_Cream", "Window_Clear"),
]


def mm(v):
    return v * 0.001


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
    return only


def fnv1a32(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


# ---------------------------------------------------------------------------
# Projection helpers
# ---------------------------------------------------------------------------
def project(sc, cam, co):
    v = world_to_camera_view(sc, cam, Vector(co))
    return v.x, 1.0 - v.y  # top-left origin


def rect_from_points(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {"x": min(xs), "y": min(ys), "w": max(xs) - min(xs), "h": max(ys) - min(ys)}


def object_screen_rect(sc, cam, obs):
    pts = []
    for ob in obs:
        mw = ob.matrix_world
        for v in ob.data.vertices:
            pts.append(project(sc, cam, mw @ v.co))
    return rect_from_points(pts)


def plane_rect(sc, cam, x0, y0, x1, y1, z):
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return rect_from_points([project(sc, cam, (mm(x), mm(y), mm(z))) for x, y in corners])


def radius_norm(sc, cam, cx, cy, r, z):
    """Projected radius, as fractions of frame width and height (mean of 4 dirs)."""
    c = project(sc, cam, (mm(cx), mm(cy), mm(z)))
    rx = (project(sc, cam, (mm(cx + r), mm(cy), mm(z)))[0] - project(sc, cam, (mm(cx - r), mm(cy), mm(z)))[0]) / 2
    ry = (project(sc, cam, (mm(cx), mm(cy - r), mm(z)))[1] - project(sc, cam, (mm(cx), mm(cy + r), mm(z)))[1]) / 2
    return c, rx, ry


def rnd(d, n=5):
    if isinstance(d, dict):
        return {k: rnd(v, n) for k, v in d.items()}
    if isinstance(d, list):
        return [rnd(v, n) for v in d]
    if isinstance(d, float):
        return round(d, n)
    return d


def build_manifest(sc, L):
    cam = bpy.data.objects["Cam_Front"]
    W, H = sc.render.resolution_x, sc.render.resolution_y
    bpy.context.view_layer.update()

    shell = [o for o in bpy.data.objects if o.get("shell_part")]
    tape_rect = object_screen_rect(sc, cam, shell)
    label_ob = bpy.data.objects["Label"]
    label_rect = object_screen_rect(sc, cam, [label_ob])
    window_rect = object_screen_rect(sc, cam, [bpy.data.objects["Window"]])

    hub = L["hub"]
    pack = L["pack"]
    hubs = {}
    hub_r = None
    for name in ("Hub_L", "Hub_R"):
        ob = bpy.data.objects[name]
        cx, cy = ob.matrix_world.translation.x * 1000, ob.matrix_world.translation.y * 1000
        # Hub sprite plane = hub front face; pack plane = pack front face.
        c, rx, ry = radius_norm(sc, cam, cx, cy, hub["r_outer"], hub["half_h"])
        _, px, py = radius_norm(sc, cam, cx, cy, pack["r_full"], pack["half_h"])
        hubs[name] = {"x": c[0], "y": c[1]}
        hub_r = {"w": rx, "h": ry}
        full_r = {"w": px, "h": py}

    lz = L["label"]["z1"]
    a = L["art_slot"]
    art_rect = plane_rect(sc, cam, a["x0"], a["y0"], a["x1"], a["y1"], lz)
    t = L["text"]
    lines = []
    for name, y_mm in t["lines"]:
        left = project(sc, cam, (mm(t["x0"]), mm(y_mm), mm(lz)))
        right = project(sc, cam, (mm(t["x1"]), mm(y_mm), mm(lz)))
        xh = project(sc, cam, (mm(t["x0"]), mm(y_mm + t["x_height"]), mm(lz)))
        lines.append({
            "name": name,
            "x": left[0],
            "baselineY": left[1],
            "maxWidth": right[0] - left[0],
            "xHeight": left[1] - xh[1],
        })

    shell_w_px = tape_rect["w"] * W
    manifest = {
        "schema": "mixtape-manifest/draft-0",
        "generatedBy": "scripts/mixtape/render_phase0.py",
        "coordinates": "normalised 0..1 of the full frame; origin top-left, x right, y down. "
                       "Radii are given as a fraction of frame width (w) and of frame height (h).",
        "frame": {"w": W, "h": H},
        "camera": {
            "lensMm": L["camera"]["lens"],
            "sensorWidthMm": L["camera"]["sensor_w"],
            "distanceToFaceMm": L["derived"]["camera_distance_to_face_mm"],
            "projection": "perspective, perpendicular to the shell face, centred",
        },
        "tape": {
            "spriteRect": tape_rect,
            "windowRect": window_rect,
            "hubL": hubs["Hub_L"],
            "hubR": hubs["Hub_R"],
            "hubRadius": hub_r,
            "fullPackRadius": full_r,
            "emptyPackRadius": hub_r,
            "labelRect": label_rect,
            "artSlotRect": art_rect,
            "textLines": lines,
            "renderedWindFraction": pack["wind_fraction_rendered"],
            "pxPerMmAtFace": shell_w_px / L["shell"]["w"],
            "physicalMm": {
                "shell": [L["shell"]["w"], L["shell"]["h"], L["shell"]["d"]],
                "hubSpacing": hub["spacing"],
                "hubRadius": hub["r_outer"],
                "fullPackRadius": pack["r_full"],
            },
            "notes": "Hub centres/radius projected at the hub front face, pack radius at the "
                     "pack front face, label items at the label surface, spriteRect over all "
                     "shell geometry (includes the slight perspective of the side walls).",
        },
        "hashCheck": {
            "algorithm": "fnv1a32",
            "input": "landslide|fleetwood mac|",
            "expected": fnv1a32("landslide|fleetwood mac|"),
        },
    }
    manifest = rnd(manifest)
    path = os.path.join(OUT, "mixtape-manifest.draft.json")
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print("MIXTAPE manifest", path)
    return manifest


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def set_variant(shell_mat, window_mat):
    sm = bpy.data.materials[shell_mat]
    wm = bpy.data.materials[window_mat]
    for ob in bpy.data.objects:
        if ob.get("shell_part"):
            ob.data.materials[0] = sm
        if ob.get("window_part"):
            ob.data.materials[0] = wm


def render_to(sc, path):
    sc.render.filepath = path
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0
    print("MIXTAPE rendered %s in %.1f s" % (os.path.basename(path), dt))
    return dt


def render_plates(sc):
    times = {}
    sc.camera = bpy.data.objects["Cam_Front"]
    sc.render.resolution_x, sc.render.resolution_y = 3840, 2160
    for suffix, sm, wm in VARIANTS:
        set_variant(sm, wm)
        name = "cassette_shell_%s.png" % suffix
        times[name] = render_to(sc, os.path.join(OUT, name))
    set_variant("Shell_Black", "Window_Clear")
    return times


def render_hub_sprite(sc, L):
    hub = bpy.data.objects["Hub_L"]
    cam = bpy.data.objects["Cam_Sprite"]
    cam.location = (hub.matrix_world.translation.x, hub.matrix_world.translation.y, 0.2)
    cam.rotation_euler = (0, 0, 0)
    hidden = []
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob != hub and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    sc.camera = cam
    old = sc.render.resolution_x, sc.render.resolution_y
    sc.render.resolution_x = sc.render.resolution_y = 1024
    dt = render_to(sc, os.path.join(OUT, "hub_sprite.png"))
    for ob in hidden:
        ob.hide_render = False
    sc.render.resolution_x, sc.render.resolution_y = old
    sc.camera = bpy.data.objects["Cam_Front"]
    return {"hub_sprite.png": dt}


def main():
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    L = json.loads(sc["mixtape_layout"])
    only = args()
    times = {}
    if only in (None, "plates"):
        times.update(render_plates(sc))
    if only in (None, "sprite"):
        times.update(render_hub_sprite(sc, L))
    if only in (None, "manifest"):
        build_manifest(sc, L)
    if times:
        with open(os.path.join(OUT, "render-times.json"), "w") as f:
            json.dump({k: round(v, 1) for k, v in times.items()}, f, indent=2)
            f.write("\n")


if __name__ == "__main__":
    main()
