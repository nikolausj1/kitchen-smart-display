#!/usr/bin/env python3
"""Cut the measured Mixtape tape keepers into app sprites and write the app manifest.

Input per tape: a keeper frame (1672x941, the reference photo with one cassette
regenerated in place, already pasted back outside the edit mask) plus its entry in
a measurements.json written by measure_tape_variants.py.

Output per tape, in tvos/Resources/Mixtape/tapes/<id>/:
  tape.png  the shell rect cut out of the frame, rounded corners masked to alpha,
            upscaled 2.297x (3840/1672) with the Apple VideoToolbox SR tool so it
            matches the 3840x2160 deck plate; RGB and alpha go through SR separately
            and are recombined (as gen_deck_plate.py does)
  hub.png   the left visible toothed hub ring, cut with alpha, upscaled the same way
  pack.png  a 512 px square wound-tape tile, alpha outside the disc. The generated
            pack is only visible in the window slot (never a whole disc), so it is
            always synthesised from art-src/mixtape/textures/tape_pack.png tinted to
            the generated pack's mean colour.

Plus tvos/Resources/Mixtape/mixtape-manifest.json (written atomically: temp file
then rename), all coordinates normalised 0..1 of the 3840x2160 frame, origin top
left, radii as fractions of frame width. Source px map to the plate by a uniform
scale S = 3840/1672 on both axes with no top offset (gen_deck_plate.py PLATE_TOP),
so x_n = x / 1672 and y_n = y * S / 2160.

Usage (project root):
    python3 scripts/mixtape/build_tape_assets.py                 # all tapes
    python3 scripts/mixtape/build_tape_assets.py --only test_black test_clear
    python3 scripts/mixtape/build_tape_assets.py --manifest-only # no image work
    python3 scripts/mixtape/build_tape_assets.py --contact-sheet # also the review sheet
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure_tape_variants as mt  # noqa: E402
from gen_tape_variants import COLLECTION  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TAPES_SRC = ROOT / "art-src" / "mixtape" / "tapes"
PLATE_MANIFEST = ROOT / "art-src" / "mixtape" / "plates" / "plate-manifest.json"
PACK_SRC = ROOT / "art-src" / "mixtape" / "textures" / "tape_pack.png"
OUT = ROOT / "tvos" / "Resources" / "Mixtape"
MANIFEST = OUT / "mixtape-manifest.json"
VTSR_SRC = ROOT / "scripts" / "mixtape" / "upscale_vtsr.swift"
VTSR_BIN = Path("/tmp/vtsr")

W, H = mt.W, mt.H  # 1672x941 source frame
FW, FH = 3840, 2160  # app frame
S = FW / W  # 2.2967, same on both axes
CORNER_R = 9.0  # shell corner radius, px at 1672 (about 1.3 mm)
PACK_TILE = 512

HASH_CHECK = {"algorithm": "fnv1a32", "input": "landslide|fleetwood mac|", "expected": 190110897}

# The two package H test tapes (art-src/mixtape/tapes/test/). They have ruled
# lines on the label (that prompt asked for them); the collection does not.
TEST_TAPES = [
    {"id": "test_black", "variant": "black_shell", "brand": "Test", "sku": "test black shell",
     "labelStyle": "blank", "shell": "black", "wear": "medium", "logoDir": None,
     "inkColor": "#1d2a6b"},
    {"id": "test_clear", "variant": "clear_shell", "brand": "Test", "sku": "test clear shell",
     "labelStyle": "blank", "shell": "clear", "wear": "medium", "logoDir": None,
     "inkColor": "#1b1b1f"},
]


def fnv1a32(s):
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


# --------------------------------------------------------------------------- units

def nx(x):
    return round(x / W, 5)


def ny(y):
    return round(y * S / FH, 5)


def nr(r):
    return round(r / W, 5)


def nrect(x, y, w, h):
    return {"x": nx(x), "y": ny(y), "w": nr(w), "h": round(h * S / FH, 5)}


# --------------------------------------------------------------------------- SR

def ensure_vtsr():
    if not VTSR_BIN.exists() or VTSR_BIN.stat().st_mtime < VTSR_SRC.stat().st_mtime:
        subprocess.run(["swiftc", "-O", str(VTSR_SRC), "-o", str(VTSR_BIN)], check=True)


def vtsr_rgb(img, size, tmp):
    """4x VideoToolbox SR, then Lanczos down to `size` (= source size x S)."""
    src, dst = tmp / "in.png", tmp / "out.png"
    img.convert("RGB").save(src)
    subprocess.run([str(VTSR_BIN), str(src), str(dst)], check=True, stdout=subprocess.DEVNULL)
    return Image.open(dst).convert("RGB").resize(size, Image.LANCZOS)


def upscale_rgba(img, tmp):
    w, h = img.size
    size = (round(w * S), round(h * S))
    rgb = vtsr_rgb(img, size, tmp)
    a = img.getchannel("A")
    a_up = vtsr_rgb(Image.merge("RGB", (a, a, a)), size, tmp).getchannel("R")
    rgb.putalpha(a_up)
    return rgb


# --------------------------------------------------------------------------- cuts

def shell_rect(bgr):
    """Shell edges near the nominal cassette rect (10 px out, 18 px in), from the strongest
    perpendicular gradient over the middle of each side; nominal if weak."""
    g = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32), (3, 3), 0)
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    x0, x1, y0, y1 = mt.CASSETTE
    ys = slice(y0 + 90, y1 - 90)
    xs = slice(x0 + 120, x1 - 120)

    def pick(profile, base, lo):
        """Strongest edge in the window (checked by eye on light, clear and dark
        shells: the model sometimes draws the shell up to 19 px inside the nominal
        rect); nominal if nothing stands out."""
        i = int(np.argmax(profile))
        return lo + i if profile[i] > 2.5 * (np.median(profile) + 1) else base

    o, i = 10, 18  # search 10 px outward and 18 px inward of the nominal edge
    left = pick(gx[ys, x0 - o:x0 + i + 1].mean(axis=0), x0, x0 - o)
    right = pick(gx[ys, x1 - i:x1 + o + 1].mean(axis=0), x1, x1 - i)
    top = pick(gy[y0 - o:y0 + i + 1, xs].mean(axis=1), y0, y0 - o)
    bot = pick(gy[y1 - i:y1 + o + 1, xs].mean(axis=1), y1, y1 - i)
    return int(left), int(right), int(top), int(bot)


def rounded_alpha(w, h, r):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xx, r, w - r)
    cy = np.clip(yy, r, h - r)
    d = np.hypot(xx - cx, yy - cy)
    return (np.clip(r - d + 0.5, 0, 1) * 255).astype(np.uint8)


def cut_tape(rgb, rect):
    x0, x1, y0, y1 = rect
    # gradient peak sits on the edge pixel; include it, drop the deck beyond
    crop = rgb.crop((x0, y0, x1 + 1, y1 + 1))
    a = rounded_alpha(crop.width, crop.height, CORNER_R)
    crop.putalpha(Image.fromarray(a, "L"))
    return crop, (x0, y0)


def cut_hub(rgb, hub):
    cx, cy = hub["centre"]
    r = hub["ringOuterRadius"]
    s = int(np.ceil(r)) + 2
    x0, y0 = int(round(cx)) - s, int(round(cy)) - s
    crop = rgb.crop((x0, y0, x0 + 2 * s + 1, y0 + 2 * s + 1))
    yy, xx = np.mgrid[0:crop.height, 0:crop.width].astype(np.float32)
    d = np.hypot(xx + x0 - cx, yy + y0 - cy)
    a = (np.clip(r + 0.5 - d, 0, 1) * 255).astype(np.uint8)
    crop.putalpha(Image.fromarray(a, "L"))
    return crop


def pack_colour(bgr, window, hubs):
    """Mean colour (RGB) of the brown wound tape visible in the window."""
    wx, wy, ww, wh = window
    crop = bgr[wy:wy + wh, wx:wx + ww]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    brown = (hsv[..., 0] >= 3) & (hsv[..., 0] <= 25) & (hsv[..., 1] > 70) & \
            (hsv[..., 2] > 25) & (hsv[..., 2] < 200)
    yy, xx = np.mgrid[0:wh, 0:ww]
    for hb in hubs:
        hx, hy = hb["centre"]
        brown &= np.hypot(xx + wx - hx, yy + wy - hy) > hb["ringOuterRadius"] + 10
    if brown.sum() < 200:
        return None, float(brown.mean())
    m = crop[brown].mean(axis=0)
    return [float(m[2]), float(m[1]), float(m[0])], float(brown.mean())


def synth_pack(rgb_mean):
    src = Image.open(PACK_SRC).convert("RGBA").resize((PACK_TILE, PACK_TILE), Image.LANCZOS)
    arr = np.asarray(src).astype(np.float32)
    a = arr[..., 3]
    lum = arr[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    inside = a > 128
    lum_n = lum / max(1e-3, lum[inside].mean())
    target = np.array(rgb_mean, np.float32)
    out = np.clip(lum_n[..., None] * target[None, None, :], 0, 255)
    return Image.fromarray(np.dstack([out, a]).round().astype(np.uint8), "RGBA")


# --------------------------------------------------------------------------- label layout

# Caveat-Regular: x-height 0.40 em, mean advance about 0.37 em = 0.93 x-height.
CAVEAT_ADV_PER_X = 0.93
FIT_CHARS = 22  # "longest reasonable text", fitted at the app's 60% shrink floor
REF_XH = {"artist": 0.030, "album": 0.022, "song": 0.022}  # reference label, frac of H
CAPTION_W = 0.035  # frac of frame width reserved for a printed caption


def find_rules(bgr, x0, x1, y0, y1):
    """Printed / ruled lines inside [x0, x1) x [y0, y1): rows whose longest dark
    horizontal run (black-hat > 40) is 60 px or more. Returns [(y, left, right)]
    with y the top of the line (text sits on it)."""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9)))
    band = bh[y0:y1, x0:x1] > 40
    rows = []
    for r in range(band.shape[0]):
        row = band[r].astype(np.int8)
        d = np.diff(np.r_[0, row, 0])
        st, en = np.where(d == 1)[0], np.where(d == -1)[0]
        if len(st):
            k = int(np.argmax(en - st))
            if en[k] - st[k] >= 60:
                rows.append((r + y0, st[k] + x0, en[k] + x0))
    rules, cur = [], []
    for r in rows:
        if cur and r[0] - cur[-1][0] > 1:
            rules.append(cur)
            cur = []
        cur.append(r)
    if cur:
        rules.append(cur)
    return [(c[0][0], min(v[1] for v in c), max(v[2] for v in c)) for c in rules]


def label_layout(bgr, label, window, printed):
    """Reference ("Neon Avenue") proportions: the art slot square fills the label
    strip above the window minus a small margin; three lines to its right fill the
    same height, evenly spaced, artist larger. Where the generated label carries
    ruled lines right of the art, baselines sit ON the rules (y = the rule's top,
    x = its left end when the rule is long) and the rules' spacing caps the
    x-height at 0.7 of it. Px in the 1672 frame; returns the art rect, the lines
    (normalised) and a note."""
    lx, ly, lw, lh = label
    wy = window[1]
    band = wy - ly
    m = max(3.0, 0.06 * band)
    s = band - 2 * m
    ax, ay = lx + m + 0.01 * lw, ly + m
    gap = 0.12 * s
    tx = ax + s + gap
    right = lx + lw - max(m, 0.03 * lw)
    p = s / 3.0
    base = [ay + p * (k + 0.78) for k in range(3)]
    xs = [tx] * 3
    ends = [right] * 3
    rules = [r for r in find_rules(bgr, int(tx), int(right), int(ly + 4), int(wy - 4))]
    note = "even"
    if len(rules) >= 3:
        rules = rules[:3]
        base = [r[0] - 0.5 for r in rules]
        avail = right - tx
        for k, (_, rl, rr) in enumerate(rules):
            if rr - rl >= 0.5 * avail:
                xs[k] = max(tx, rl)
                ends[k] = min(right, rr) if rr > rl else right
        note = "on rules"
    elif rules:
        # Too few rules to carry all three lines: keep the even layout, but a rule
        # that would cross a line's x-height band pulls that baseline onto itself.
        for (ry, rl, rr) in rules:
            for k in range(3):
                if base[k] - 0.5 * p < ry < base[k]:
                    base[k] = ry - 0.5
        note = f"even ({len(rules)} partial rule(s) checked)"
    spacing = min(base[1] - base[0], base[2] - base[1])
    lines = []
    for k, field in enumerate(("artist", "album", "song")):
        x = xs[k]
        cap_x = None
        if printed:
            cap_x = x
            x = x + CAPTION_W * W
        max_w = ends[k] - x
        scale = 0.56 if field == "artist" else 0.56 * REF_XH["album"] / REF_XH["artist"]
        xh = min(scale * p, REF_XH[field] * FH / S,          # even fill, reference cap
                 max_w / (FIT_CHARS * CAVEAT_ADV_PER_X * 0.6))  # still fits at 60%
        if note == "on rules":
            xh = min(xh, 0.7 * spacing * (1.0 if field == "artist" else 0.85))
        line = {"field": field, "x": nx(x), "baselineY": ny(base[k]), "maxWidth": nr(max_w),
                "xHeight": round(xh * S / FH, 5)}
        if printed:
            line["captionX"] = nx(cap_x)
            line["captionBaselineY"] = ny(base[k])
        lines.append(line)
    return (ax, ay, s, s), lines, {"layout": note, "rules": [list(map(int, r)) for r in rules]}


# --------------------------------------------------------------------------- per tape

def build_tape(meta, keeper_png, meas, do_images, tmp):
    bgr = cv2.imread(str(keeper_png))
    rgb = Image.open(keeper_png).convert("RGB")
    hubs = meas["hubs"]
    label, window = meas["labelRectPx"], meas["windowRectPx"]
    rect = shell_rect(bgr)
    tape, (tx0, ty0) = cut_tape(rgb, rect)
    out_dir = OUT / "tapes" / meta["id"]
    colour, cover = pack_colour(bgr, window, hubs)
    notes = []
    if colour is None:
        colour = [92.0, 52.0, 30.0]
        notes.append("no brown pack pixels found in the window; pack tinted to a default brown")
    if do_images:
        out_dir.mkdir(parents=True, exist_ok=True)
        upscale_rgba(tape, tmp).save(out_dir / "tape.png", optimize=True)
        upscale_rgba(cut_hub(rgb, hubs[0]), tmp).save(out_dir / "hub.png", optimize=True)
        synth_pack(colour).save(out_dir / "pack.png", optimize=True)
    sw, sh = tape.size
    ring = float(np.mean([h["ringOuterRadius"] for h in hubs]))
    cy = float(np.mean([h["centre"][1] for h in hubs]))
    wx, wy, ww, wh = window
    pack_max = min(cy - wy, wy + wh - cy) - 1.0
    pack_min = ring + 0.2 * ring  # the dark gap between the ring and the pack
    if pack_min >= pack_max - 4:
        notes.append(f"pack range tight: min {pack_min:.1f} px vs max {pack_max:.1f} px")
    printed = meta["labelStyle"] == "printed"
    art, lines, lay = label_layout(bgr, label, window, printed)
    tid = meta["id"]
    entry = {
        "id": tid, "brand": meta["brand"], "sku": meta["sku"], "labelStyle": meta["labelStyle"],
        "shell": meta["shell"], "wear": meta["wear"], "logoDir": meta["logoDir"],
        "files": {"tape": f"tapes/{tid}/tape.png", "hub": f"tapes/{tid}/hub.png",
                  "pack": f"tapes/{tid}/pack.png"},
        "spriteRect": {"x": nx(tx0), "y": ny(ty0), "w": round(round(sw * S) / FW, 5),
                       "h": round(round(sh * S) / FH, 5)},
        "hubL": {"x": nx(hubs[0]["centre"][0]), "y": ny(hubs[0]["centre"][1])},
        "hubR": {"x": nx(hubs[1]["centre"][0]), "y": ny(hubs[1]["centre"][1])},
        "hubRadius": nr(ring),
        "packMinRadius": nr(pack_min), "packMaxRadius": nr(pack_max),
        "windowRect": nrect(*window), "labelRect": nrect(*label), "artSlotRect": nrect(*art),
        "textLines": lines,
        "printedFields": printed,
        "inkColor": meta["inkColor"], "font": "Caveat-Regular",
    }
    info = {"shellRectPx": [rect[0], rect[2], rect[1] - rect[0] + 1, rect[3] - rect[2] + 1],
            "packMeanRGB": [round(c, 1) for c in colour], "packCoverage": round(cover, 3),
            "packRangePx": [round(pack_min, 1), round(pack_max, 1)], "labelLayout": lay,
            "notes": notes}
    return entry, info


def tape_sources():
    """(meta, keeper png, measurement) for every tape that has been measured."""
    out = []
    tm = TAPES_SRC / "test" / "measurements.json"
    if tm.exists():
        m = json.loads(tm.read_text())
        for meta in TEST_TAPES:
            if meta["variant"] in m:
                out.append((meta, TAPES_SRC / "test" / f"{meta['variant']}.png", m[meta["variant"]]))
    cm = TAPES_SRC / "collection" / "measurements.json"
    if cm.exists():
        m = json.loads(cm.read_text())
        for spec in COLLECTION:
            if spec["id"] in m:
                meta = {k: spec[k] for k in ("id", "brand", "sku", "labelStyle", "shell", "wear",
                                             "logoDir", "inkColor")}
                out.append((meta, TAPES_SRC / "collection" / f"{spec['id']}.png", m[spec["id"]]))
    return out


def write_manifest(entries):
    assert fnv1a32(HASH_CHECK["input"]) == HASH_CHECK["expected"]
    deck = json.loads(PLATE_MANIFEST.read_text())
    man = {
        "frame": {"w": FW, "h": FH},
        "units": ("all positions normalised 0..1 of the 3840x2160 frame, origin top-left, y down;"
                  " rects {x, y, w, h}; radii, maxWidth and x as fractions of frame width;"
                  " baselineY and xHeight as fractions of frame height"),
        "deck": deck,
        "hashCheck": HASH_CHECK,
        "tapes": entries,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=OUT, prefix=".mixtape-manifest.", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(man, f, indent=2)
        f.write("\n")
    json.loads(Path(tmp).read_text())  # valid before it replaces anything
    os.chmod(tmp, 0o644)
    os.replace(tmp, MANIFEST)


SHEET_DIR = TAPES_SRC / "contact"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DECK_4K = ROOT / "art-src" / "mixtape" / "plates" / "deck_empty_4k.png"
SHEET_CROP = (1000, 270, 2840, 1400)  # the well, in 4K px


def seat_tile(entry, deck):
    """The tape seated in the empty deck at 4K, measurement overlay drawn, cropped
    to the well and scaled to 920 px wide."""
    from PIL import ImageDraw
    frame = deck.copy()
    tape = Image.open(OUT / entry["files"]["tape"]).convert("RGBA")
    sr = entry["spriteRect"]
    frame.alpha_composite(tape, (round(sr["x"] * FW), round(sr["y"] * FH)))
    d = ImageDraw.Draw(frame)

    def px(p):
        return p["x"] * FW, p["y"] * FH

    def rect(r, col, w=4):
        d.rectangle([r["x"] * FW, r["y"] * FH, (r["x"] + r["w"]) * FW, (r["y"] + r["h"]) * FH],
                    outline=col, width=w)

    rect(entry["labelRect"], (0, 200, 255), 3)
    rect(entry["windowRect"], (255, 40, 40), 3)
    rect(entry["artSlotRect"], (60, 220, 60), 4)
    for ln in entry["textLines"]:
        x0, y0 = ln["x"] * FW, ln["baselineY"] * FH
        d.line([x0, y0, x0 + ln["maxWidth"] * FW, y0], fill=(255, 0, 255), width=3)
        xh = ln["xHeight"] * FH
        d.line([x0, y0 - xh, x0 + 60, y0 - xh], fill=(255, 0, 255), width=2)
    for key in ("hubL", "hubR"):
        cx, cy = px(entry[key])
        for rad, col, w in ((entry["hubRadius"], (255, 230, 0), 5),
                            (entry["packMinRadius"], (0, 255, 200), 2),
                            (entry["packMaxRadius"], (0, 255, 200), 3)):
            r = rad * FW
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=w)
        d.line([cx - 22, cy, cx + 22, cy], fill=(255, 230, 0), width=4)
        d.line([cx, cy - 22, cx, cy + 22], fill=(255, 230, 0), width=4)
    crop = frame.crop(SHEET_CROP).convert("RGB")
    return crop.resize((920, round(920 * crop.height / crop.width)), Image.LANCZOS)


def contact_sheet(entries):
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    deck = Image.open(DECK_4K).convert("RGBA")
    keep_path = TAPES_SRC / "collection" / "keepers.json"
    keep = json.loads(keep_path.read_text()) if keep_path.exists() else {}
    cells = []
    for e in entries:
        seat_tile(e, deck).save(SHEET_DIR / f"{e['id']}.jpg", quality=88)
        k = keep.get(e["id"])
        status = ("test tape" if k is None else
                  ("PASS" if k["pass"] else "FLAGGED: " + "; ".join(k["reasons"])))
        cls = "ok" if k and k["pass"] else ("test" if k is None else "flag")
        ring = e["hubRadius"] * FW
        sp = (e["hubR"]["x"] - e["hubL"]["x"]) * FW
        nums = (f"hubs ({e['hubL']['x']:.4f}, {e['hubL']['y']:.4f}) ({e['hubR']['x']:.4f},"
                f" {e['hubR']['y']:.4f}) &middot; spacing {sp:.0f} px &middot; ring r {ring:.0f} px"
                f" &middot; pack {e['packMinRadius'] * FW:.0f} to {e['packMaxRadius'] * FW:.0f} px")
        cells.append(f"""<figure><img src="contact/{e['id']}.jpg"><figcaption>
<b>{e['id']}</b> <span>{e['brand']} {e['sku']} &middot; {e['shell']} shell &middot; {e['wear']} wear
&middot; {e['labelStyle']}</span><br><small>{nums}</small><br><em class="{cls}">{status}</em>
</figcaption></figure>""")
    html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Mixtape tapes</title>
<style>
body{{margin:0;padding:20px 24px;background:#16140f;color:#e8e2d4;font:13px/1.35 -apple-system,Helvetica,sans-serif}}
h1{{font-size:20px;margin:0 0 4px}} p.k{{margin:0 0 14px;color:#b9b09a}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}}
figure{{margin:0;background:#221f18;border-radius:6px;overflow:hidden}}
img{{width:100%;display:block}} figcaption{{padding:6px 8px 8px}} small{{color:#a89f88}}
em{{font-style:normal;font-weight:600}} .ok{{color:#7fd67f}} .flag{{color:#ffb454}} .test{{color:#9fb4ff}}
i.c{{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 3px 0 10px;vertical-align:-1px}}
</style></head><body>
<h1>Mixtape tape collection: {len(entries)} tapes seated in the Horizon HX-7 (4K plate)</h1>
<p class="k">Overlay from mixtape-manifest.json:
<i class="c" style="background:#ffe600"></i>hub ring (hubRadius) and centre
<i class="c" style="background:#00ffc8"></i>packMinRadius / packMaxRadius
<i class="c" style="background:#ff2828"></i>windowRect
<i class="c" style="background:#00c8ff"></i>labelRect
<i class="c" style="background:#3cdc3c"></i>artSlotRect
<i class="c" style="background:#ff00ff"></i>text baselines (maxWidth) and x-height tick</p>
<div class="grid">{''.join(cells)}</div></body></html>"""
    page = TAPES_SRC / "contact-sheet.html"
    page.write_text(html)
    png = TAPES_SRC / "contact-sheet.png"
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
                    f"--screenshot={png}", "--window-size=1600,2400", f"file://{page}"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {page.relative_to(ROOT)} and {png.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="rebuild images for these ids only")
    ap.add_argument("--manifest-only", action="store_true")
    ap.add_argument("--contact-sheet", action="store_true")
    args = ap.parse_args()
    if not args.manifest_only:
        ensure_vtsr()
    entries, infos = [], {}
    with tempfile.TemporaryDirectory() as td:
        for meta, png, meas in tape_sources():
            do_img = not args.manifest_only and (not args.only or meta["id"] in args.only)
            entry, info = build_tape(meta, png, meas, do_img, Path(td))
            entries.append(entry)
            infos[meta["id"]] = info
            print(f"{meta['id']:24s} {'built' if do_img else 'manifest'}  {json.dumps(info)}", flush=True)
    write_manifest(entries)
    (TAPES_SRC / "build-info.json").write_text(json.dumps(infos, indent=2) + "\n")
    print(f"wrote {MANIFEST.relative_to(ROOT)} with {len(entries)} tapes")
    if args.contact_sheet:
        contact_sheet(entries)


if __name__ == "__main__":
    main()
