"""Render the Mixtape look-development option matrix (work package B).

Driver (system python3, from the project root):
    python3 scripts/mixtape/render_options.py [--build] [--style silver70s] [--match door-on]

--build first rebuilds the three deck .blend files with build_deck.py. --style and
--match (substring of the output file name) render a subset, for quick iterations;
the index and times files are then merged with any existing entries.

The driver starts one headless Blender per deck style running this same file:
    Blender -b art-src/mixtape/deck_<style>.blend --python render_options.py -- --jobs <json>

Matrix (1920x1080, Eevee, 64 samples), TDK tape unless noted:
- 3 styles x door on/off x extras {none, counter, counter+keys, counter+keys+vu} at
  tape scale 0.6 = 24
- door on, all extras, tape scale 0.5 and 0.7 = 6
- door on, all extras, scale 0.6, Sony white and BASF clear tapes = 6

Writes to art-src/mixtape/renders/options/:
    <style>_door-<on|off>_vu-<>_counter-<>_keys-<>_scale-<50|60|70>_<tape>.png
    index.json                      every render with its parameters
    render-times.json               seconds per render, per style process, total
    mixtape-manifest.scale-<NN>.json  tape + per-deck geometry for that camera
"""

import json
import os
import subprocess
import sys
import time

try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art-src", "mixtape")
OUT = os.path.join(ART, "renders", "options")
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
STYLES = ["silver70s", "black80s", "hifi"]
EXTRAS = [  # (vu, counter, keys)
    (False, False, False),
    (False, True, False),
    (False, True, True),
    (True, True, True),
]


def onoff(b):
    return "on" if b else "off"


def job_name(j):
    return "%s_door-%s_vu-%s_counter-%s_keys-%s_scale-%d_%s.png" % (
        j["style"], onoff(j["door"]), onoff(j["vu"]), onoff(j["counter"]), onoff(j["keys"]),
        round(j["scale"] * 100), j["tape"])


def matrix():
    jobs = []
    for style in STYLES:
        for door in (True, False):
            for vu, counter, keys in EXTRAS:
                jobs.append({"style": style, "door": door, "vu": vu, "counter": counter, "keys": keys,
                             "scale": 0.6, "tape": "tdk", "set": "extras"})
        for scale in (0.5, 0.7):
            jobs.append({"style": style, "door": True, "vu": True, "counter": True, "keys": True,
                         "scale": scale, "tape": "tdk", "set": "scale"})
        for tape in ("sony", "basf"):
            jobs.append({"style": style, "door": True, "vu": True, "counter": True, "keys": True,
                         "scale": 0.6, "tape": tape, "set": "tapes"})
    for j in jobs:
        j["file"] = job_name(j)
    return jobs


# ---------------------------------------------------------------------------
# Inside Blender
# ---------------------------------------------------------------------------
def blender_main():
    sys.path.insert(0, HERE)
    import mixtape_common as MC

    argv = sys.argv[sys.argv.index("--") + 1:]
    jobs_path = argv[argv.index("--jobs") + 1]
    with open(jobs_path) as f:
        spec = json.load(f)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.eevee.taa_render_samples = 64
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    result = {"renders": [], "manifests": {}, "safe": {}}
    jobs = sorted(spec["jobs"], key=lambda j: (j["scale"], j["tape"]))
    for scale in sorted({j["scale"] for j in spec["jobs"]} | set(spec.get("manifest_scales", []))):
        MC.set_tape_scale(scale)
        key = "%d" % round(scale * 100)
        result["manifests"][key] = {
            "camera": {"distanceToFaceMm": MC.camera_distance(scale), "cameraZmm": bpy.data.objects["Cam_Front"].location.z * 1000},
            "tape": MC.tape_manifest(sc),
            "deck": MC.deck_manifest(sc),
        }
        MC.set_deck_parts(door=True, vu=True, counter=True, keys=True)
        result["safe"][key] = MC.safe_zone_check(sc)
    for j in jobs:
        MC.set_tape_scale(j["scale"])
        MC.apply_tape(j["tape"])
        MC.set_deck_parts(door=j["door"], vu=j["vu"], counter=j["counter"], keys=j["keys"])
        path = os.path.join(OUT, j["file"])
        sc.render.filepath = path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        dt = time.time() - t0
        print("MIXTAPE rendered %s in %.1f s" % (j["file"], dt))
        r = dict(j)
        r["seconds"] = round(dt, 2)
        result["renders"].append(r)
    with open(spec["result"], "w") as f:
        json.dump(result, f, indent=2)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def driver():
    args = sys.argv[1:]
    only_style = args[args.index("--style") + 1] if "--style" in args else None
    match = args[args.index("--match") + 1] if "--match" in args else None
    os.makedirs(OUT, exist_ok=True)
    if "--build" in args:
        for style in STYLES:
            if only_style and style != only_style:
                continue
            subprocess.run([BLENDER, "-b", os.path.join(ART, "cassette_look.blend"), "--python",
                            os.path.join(HERE, "build_deck.py"), "--", "--style", style], check=True,
                           stdout=subprocess.DEVNULL)
    jobs = [j for j in matrix() if (not only_style or j["style"] == only_style) and (not match or match in j["file"])]
    index = {j["file"]: j for j in load_json(os.path.join(OUT, "index.json"), {"renders": []})["renders"]}
    times = load_json(os.path.join(OUT, "render-times.json"), {"renders": {}, "processes": {}})
    manifests = {}
    t_all = time.time()
    for style in STYLES:
        sj = [j for j in jobs if j["style"] == style]
        if not sj:
            continue
        tmp = os.path.join(OUT, ".jobs_%s.json" % style)
        res = os.path.join(OUT, ".result_%s.json" % style)
        with open(tmp, "w") as f:
            json.dump({"jobs": sj, "result": res, "manifest_scales": [0.5, 0.6, 0.7]}, f)
        t0 = time.time()
        subprocess.run([BLENDER, "-b", os.path.join(ART, "deck_%s.blend" % style), "--python", __file__, "--",
                        "--jobs", tmp], check=True, stdout=subprocess.DEVNULL)
        wall = time.time() - t0
        with open(res) as f:
            r = json.load(f)
        os.unlink(tmp)
        os.unlink(res)
        for rr in r["renders"]:
            index[rr["file"]] = rr
            times["renders"][rr["file"]] = rr["seconds"]
        times["processes"][style] = {"renders": len(r["renders"]), "wallSeconds": round(wall, 1)}
        for key, m in r["manifests"].items():
            man = manifests.setdefault(key, {"tape": m["tape"], "camera": m["camera"], "deck": {}, "safeZone": {}})
            man["deck"][style] = m["deck"]
            man["safeZone"][style] = r["safe"][key] or "all inside"
        print("style %s: %d renders, %.1f s wall" % (style, len(r["renders"]), wall))
    times["lastRunWallSeconds"] = round(time.time() - t_all, 1)
    secs = list(times["renders"].values())
    times["summary"] = {"count": len(secs), "meanSeconds": round(sum(secs) / max(len(secs), 1), 2),
                        "maxSeconds": max(secs) if secs else 0, "sumSeconds": round(sum(secs), 1)}
    ordered = [index[j["file"]] for j in matrix() if j["file"] in index]
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump({
            "generatedBy": "scripts/mixtape/render_options.py",
            "resolution": [1920, 1080],
            "engine": "Eevee, 64 samples, AgX Medium High Contrast",
            "fields": "style, door/vu/counter/keys booleans, scale = tape width as a fraction of frame width, "
                      "tape = brand key, set = extras | scale | tapes (which part of the matrix), file, seconds",
            "manifests": {k: "mixtape-manifest.scale-%s.json" % k for k in ("50", "60", "70")},
            "renders": ordered,
        }, f, indent=2)
        f.write("\n")
    with open(os.path.join(OUT, "render-times.json"), "w") as f:
        json.dump(times, f, indent=2)
        f.write("\n")
    sys.path.insert(0, HERE)
    for key, man in manifests.items():
        path = os.path.join(OUT, "mixtape-manifest.scale-%s.json" % key)
        old = load_json(path, {})
        deck = old.get("deck", {})
        deck.update(man["deck"])
        safe = old.get("safeZone", {})
        safe.update(man["safeZone"])
        doc = {
            "schema": "mixtape-manifest/draft-1",
            "generatedBy": "scripts/mixtape/render_options.py (projection via render_phase0.py helpers)",
            "coordinates": "normalised 0..1 of the full frame; origin top-left, x right, y down. Radii as a "
                           "fraction of frame width (w) and height (h).",
            "frame": {"w": 3840, "h": 2160, "alsoValidFor": "1920x1080 and a centred 16:10 crop (normalised)"},
            "tapeScale": int(key) / 100.0,
            "camera": dict(man["camera"], lensMm=135.0, sensorWidthMm=36.0,
                           projection="perspective, perpendicular to the shell face, centred on the shell"),
            "tape": man["tape"],
            "deck": deck,
            "safeZone": safe,
            "hashCheck": {"algorithm": "fnv1a32", "input": "landslide|fleetwood mac|", "expected": 190110897},
        }
        doc = rnd(doc)
        with open(path, "w") as f:
            json.dump(doc, f, indent=2)
            f.write("\n")
    print("done: %d renders this run, %.1f s" % (len(jobs), time.time() - t_all))


def rnd(d, n=5):
    if isinstance(d, dict):
        return {k: rnd(v, n) for k, v in d.items()}
    if isinstance(d, list):
        return [rnd(v, n) for v in d]
    if isinstance(d, float):
        return round(d, n)
    return d


if __name__ == "__main__":
    if IN_BLENDER:
        blender_main()
    else:
        driver()
