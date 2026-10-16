#!/usr/bin/env python3
"""Mixtape polish round (2026-10-16): hub rims, door edges, spindles, tape counter.

All hand work in numpy / OpenCV / Pillow; no image generation, no API calls.

  rims      Per tape, rim_L.png / rim_R.png in tvos/Resources/Mixtape/tapes/<id>/:
            the shell material around each hub opening, cut from that tape's
            own tape.png (4K, same pixels), drawn by the app OVER the live
            packs so the packs sit behind the shell's window edge as on a real
            tape. Alpha is the app's window clip (the windowRect capsule, the
            same shape MixtapeView masks the packs with) minus the hub disc
            (r < hubRadius, where the live hub shows) minus the clear inner
            window between the hubs (where the pack must show). The inner
            window is found from the strongest edges between the hubs, with
            four overrides checked by eye (INNER_OVERRIDES). Clear and smoke
            shells (CLEAR_SHELLS) get a soft ring at 60% alpha over the pack's
            swept area, rising to opaque outside packMaxRadius, so the pack
            reads through the translucent plastic.
              -> rims.json (art-src/mixtape/tapes/) and the tvos manifest
                 key tapes[i].rims {left, right: {rect, file}}
              -> art-src/mixtape/polish/rims-check-*.png (app-style composite
                 before / after, and the rims over a flat dark disc)
  door      door_edge_top.png / door_edge_bottom.png in deck/: a lit edge strip
            (THICK = 0.004 of plate height, the door's full width) sampled
            from door_frame.png's chrome top rail and its bottom bar, with a
            vertical light gradient. Manifest deck.door_edges.
  spindles  deck_empty_v3.png = deck_empty_v2.png with both empty-well
            spindles moved onto the mean of the 14 tapes' hub centres. Each
            disc is cut with a feathered margin; the vacated area is repainted
            with a smooth quadratic fit of the surrounding cavity plus grain
            copied (high-pass) from the empty cavity between the spindles; the
            spindle is pasted at the target with the cavity's tone difference
            between the two places compensated. well_open.png carries the same
            spindles (it is the door rect of the plate, glass un-composited)
            and gets the same move. Verifies by diff that only the two spindle
            regions changed. Manifest deck.plates.deck_v3, deck.spindles.
  counter   A 3-digit mechanical tape counter above the OUTPUT label, built by
            hand: a chrome-rimmed recessed black bezel with a drop shadow and a
            round chrome RESET button, composited into v3 as
            deck_empty_v3_counter.png (byte-identical outside the housing).
            counter_digits.png is the roller strip (0..9 then 0 again, so
            scrolling 9 -> 0 wraps seamlessly), white Helvetica numerals on
            near-black drums; counter_glass.png is an optional overlay drawn
            over the digits (fixed cylinder shading, drum separators).
            Manifest deck.counter.
  manifest  Merges the deck keys into art-src/mixtape/plates/plate-manifest.json
            (so build_tape_assets.py carries them), runs
            build_tape_assets.py --manifest-only, then merges the per-tape rims
            from rims.json into tvos/Resources/Mixtape/mixtape-manifest.json
            (build_tape_assets.py rebuilds tape entries from the measurements
            and knows nothing of rims, so rerun `polish_assets.py manifest`
            after any build_tape_assets.py run).

    python3 scripts/mixtape/polish_assets.py all        # everything, in order
    python3 scripts/mixtape/polish_assets.py rims       # one stage
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "tvos" / "Resources" / "Mixtape"
DECK = RES / "deck"
MANIFEST = RES / "mixtape-manifest.json"
PLATE_MANIFEST = ROOT / "art-src" / "mixtape" / "plates" / "plate-manifest.json"
RIMS_JSON = ROOT / "art-src" / "mixtape" / "tapes" / "rims.json"
CHECK = ROOT / "art-src" / "mixtape" / "polish"
FW, FH = 3840, 2160


def rel(p):
    return os.path.relpath(p, ROOT)


def save_bgr(path, img):
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    print("wrote", rel(path), f"{img.shape[1]}x{img.shape[0]}")


def save_rgba(path, arr):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(arr), "RGBA").save(path, optimize=True)
    print("wrote", rel(path), f"{arr.shape[1]}x{arr.shape[0]}")


def rect_n(x0, y0, x1, y1):
    """Pixel-edge rect in the 4K frame -> normalised {x, y, w, h}."""
    return {"x": round(x0 / FW, 5), "y": round(y0 / FH, 5),
            "w": round((x1 - x0) / FW, 5), "h": round((y1 - y0) / FH, 5)}


def label(img, text):
    out = img.copy()
    cv2.putText(out, text, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(out, text, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def manifest():
    return json.loads(MANIFEST.read_text())


def smooth01(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


# =========================================================================== A. rims

# Clear inner window (tape.png px, pixel edges x0, y0, x1, y1) where the edge
# search lands on a ridge or a pack edge instead (checked by eye at 1:1).
INNER_OVERRIDES = {
    "memorex_dbs_printed": (615, 350, 948, 528),   # search hit the left pack's edge
    "basf_ce2_blank": (580, 340, 896, 447),         # search hit the moulded ridge below
    "fuji_dr_blank": (590, 355, 915, 468),          # search hit the light lip below
    "tdk_sax_blank": (586, 357, 912, 503),          # search hit the left hub's rim
}
# Translucent shells: the brief names basf (smoke) and test_clear. Fuji is
# tagged clear in the collection but came out opaque, so it is cut as opaque.
CLEAR_SHELLS = {"test_clear", "basf_ce2_printed", "basf_ce2_blank"}
CLEAR_ALPHA = 0.60
INNER_CORNER = 8.0      # px, the clear window's own corner rounding
CAP_GROW = 1.5         # px
HUB_FEATHER = 1.0       # px, edge of the transparent hub disc (opaque shells)


def capsule_cover(w, h, rect):
    """Anti-aliased coverage of SwiftUI Capsule() over rect (x, y, w, h), in a
    w x h canvas: a rounded rect whose corner radius is half the short side."""
    x, y, rw, rh = rect
    r = min(rw, rh) / 2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xx, x + r, x + rw - r)
    cy = np.clip(yy, y + r, y + rh - r)
    d = np.hypot(xx - cx, yy - cy)
    return np.clip(r - d + 0.5, 0, 1)


def rrect_cover(w, h, x0, y0, x1, y1, r, feather=1.0):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    cx = np.clip(xx, x0 + r, x1 - r)
    cy = np.clip(yy, y0 + r, y1 - r)
    d = np.hypot(xx - cx, yy - cy)
    return np.clip((r - d) / feather + 0.5, 0, 1)


def tape_geometry(t):
    """Everything in tape.png local px (= 4K frame px offset by the sprite)."""
    sr = t["spriteRect"]
    ox, oy = sr["x"] * FW, sr["y"] * FH
    w = t["windowRect"]
    return {
        "o": (ox, oy),
        "L": (t["hubL"]["x"] * FW - ox, t["hubL"]["y"] * FH - oy),
        "R": (t["hubR"]["x"] * FW - ox, t["hubR"]["y"] * FH - oy),
        "r": t["hubRadius"] * FW,
        "r0": t["packMinRadius"] * FW,
        "R1": t["packMaxRadius"] * FW,
        "win": (w["x"] * FW - ox, w["y"] * FH - oy, w["w"] * FW, w["h"] * FH),
    }


def find_inner_window(bgr, g):
    """The clear window between the hubs: strongest vertical edges over the
    middle rows (one each side of centre), then the strongest horizontal edges
    over those columns, away from the stadium's own top and bottom."""
    gray = cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32), (0, 0), 1.5)
    gx = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    (lx, ly), (rx, ry), r = g["L"], g["R"], g["r"]
    wx, wy, ww, wh = g["win"]
    cy = (ly + ry) / 2
    ys = slice(int(cy - 0.25 * wh), int(cy + 0.25 * wh))
    xa, xb = int(lx + 1.15 * r), int(rx - 1.15 * r)
    prof = gx[ys, xa:xb].mean(0)
    mid = (xb - xa) // 2
    x0 = xa + int(np.argmax(prof[:mid]))
    x1 = xa + mid + int(np.argmax(prof[mid:])) + 1
    ya, yb = int(wy + 0.07 * wh), int(wy + 0.93 * wh)
    p2 = gy[ya:yb, x0 + 15:x1 - 15].mean(1)
    m2, m3 = int(cy - 0.15 * wh) - ya, int(cy + 0.15 * wh) - ya
    y0 = ya + int(np.argmax(p2[:m2]))
    y1 = ya + m3 + int(np.argmax(p2[m3:])) + 1
    return x0, y0, x1, y1


def rimmed_pack_radii(g, inner):
    """Pack radii for use WITH the rims (px). With the shell drawn over them, the
    packs are only seen through the clear inner window, so they take a real
    cassette's proportions instead of the window height: a full C60/C90 pack is
    about 0.58 of the hub spacing, the bare spool about 0.26 (11 mm core at
    42.5 mm spacing). The empty spool is held just inside the window edge (an
    empty reel shows nothing in the window, as on a real tape), and the full
    pack never closes the gap to the other spool."""
    (lx, _), (rx, _) = g["L"], g["R"]
    spacing = rx - lx
    d_edge = min(inner[0] - lx, rx - inner[2])
    r0 = min(0.26 * spacing, d_edge - 3.0)
    R = min(0.58 * spacing, spacing - r0 - 0.08 * (inner[2] - inner[0]))
    return float(r0), float(R)


def rim_alpha(t, g, inner, shape, R):
    h, w = shape
    # the window capsule grown by CAP_GROW px: the app's own capsule mask is
    # anti-aliased, and a rim with the same soft edge would leave a faint dark
    # line where both half-cover a pixel. Outside the capsule the rim repeats
    # tape.png's own pixels, so the overlap is invisible.
    wx, wy, ww, wh = g["win"]
    cap = capsule_cover(w, h, (wx - CAP_GROW, wy - CAP_GROW, ww + 2 * CAP_GROW, wh + 2 * CAP_GROW))
    x0, y0, x1, y1 = inner
    hole = rrect_cover(w, h, x0, y0, x1, y1, INNER_CORNER, 1.5)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    a = cap * (1 - hole)
    clear = t["id"] in CLEAR_SHELLS
    for (cx, cy) in (g["L"], g["R"]):
        d = np.hypot(xx - cx, yy - cy)
        if clear:
            disc = 1 - smooth01((d - (g["r"] - 2.0)) / 4.0)          # soft inner edge
            ring = CLEAR_ALPHA + (1 - CLEAR_ALPHA) * smooth01((d - (R + 2)) / 14.0)
            a = a * (1 - disc) * ring
        else:
            disc = np.clip((g["r"] - d) / HUB_FEATHER + 0.5, 0, 1)
            a = a * (1 - disc)
    return a


def cut_rims(t, write=True):
    tape_path = RES / t["files"]["tape"]
    rgba = np.asarray(Image.open(tape_path).convert("RGBA"))
    bgr = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2BGR)
    g = tape_geometry(t)
    inner = INNER_OVERRIDES.get(t["id"]) or find_inner_window(bgr, g)
    r0, R = rimmed_pack_radii(g, inner)
    a = rim_alpha(t, g, inner, rgba.shape[:2], R) * (rgba[..., 3] / 255.0)
    split = (inner[0] + inner[2]) / 2
    out = {}
    for side, xs in (("left", slice(0, int(split))), ("right", slice(int(split), rgba.shape[1]))):
        sub = np.zeros_like(a)
        sub[:, xs] = a[:, xs]
        ys_, xs_ = np.nonzero(sub > 1 / 255)
        bx0, bx1, by0, by1 = xs_.min(), xs_.max() + 1, ys_.min(), ys_.max() + 1
        sprite = rgba[by0:by1, bx0:bx1].copy()
        sprite[..., 3] = np.round(sub[by0:by1, bx0:bx1] * 255).astype(np.uint8)
        name = "rim_L.png" if side == "left" else "rim_R.png"
        f = f"tapes/{t['id']}/{name}"
        if write:
            save_rgba(RES / f, sprite)
        ox, oy = g["o"]
        # sprite px are frame px; offsets keep the sub-pixel sprite origin
        out[side] = {"rect": {"x": round((ox + bx0) / FW, 5), "y": round((oy + by0) / FH, 5),
                              "w": round((bx1 - bx0) / FW, 5), "h": round((by1 - by0) / FH, 5)},
                     "file": f}
        out[side]["_px"] = (bx0, by0)
    out["_inner"] = [int(v) for v in inner]
    out["_radii"] = (r0, R)
    return out, rgba, g


# ---- verification: an app-style composite (MixtapeView's tape group)

def _disc_sprite(img_rgba, d, angle):
    im = Image.fromarray(img_rgba, "RGBA").resize((max(1, round(d)),) * 2, Image.LANCZOS)
    im = im.rotate(-angle, resample=Image.BICUBIC)
    return np.asarray(im).astype(np.float32)


def _over(dst, src, x, y):
    """src RGBA float over dst RGB float with top-left at float (x, y) rounded."""
    x, y = int(round(x)), int(round(y))
    h, w = src.shape[:2]
    X0, Y0 = max(0, x), max(0, y)
    X1, Y1 = min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if X1 <= X0 or Y1 <= Y0:
        return
    s = src[Y0 - y:Y1 - y, X0 - x:X1 - x]
    a = s[..., 3:4] / 255.0
    dst[Y0:Y1, X0:X1] = dst[Y0:Y1, X0:X1] * (1 - a) + s[..., :3] * a


def app_composite(t, rgba, g, rims, use_rims, rs, rt):
    """tape.png, then (masked by the window capsule) a near-black cavity and two
    live packs, then the hub sprites, then the rims. RGB float."""
    h, w = rgba.shape[:2]
    base = rgba[..., :3].astype(np.float32)
    layer = np.full_like(base, 0.03 * 255)
    pack = np.asarray(Image.open(RES / t["files"]["pack"]).convert("RGBA"))
    for (cx, cy), r, ang in ((g["L"], rs, 20.0), (g["R"], rt, 75.0)):
        s = _disc_sprite(pack, 2 * r, ang)
        gray = s[..., :3].mean(2, keepdims=True)
        s[..., :3] = np.clip((gray + (s[..., :3] - gray) * 0.72) + 0.10 * 255, 0, 255)
        yy, xx = np.mgrid[0:s.shape[0], 0:s.shape[1]].astype(np.float32) + 0.5
        dd = np.hypot(xx - s.shape[1] / 2, yy - s.shape[0] / 2) / r
        s[..., :3] *= (1 - 0.42 * smooth01((dd - 0.5) / 0.5))[..., None]
        _over(layer, s, cx - s.shape[1] / 2, cy - s.shape[0] / 2)
    cap = capsule_cover(w, h, g["win"])[..., None]
    out = base * (1 - cap) + layer * cap
    hub = np.asarray(Image.open(RES / t["files"]["hub"]).convert("RGBA"))
    hd = 2 * g["r"]
    for (cx, cy), ang in ((g["L"], 10.0), (g["R"], 33.0)):
        s = _disc_sprite(hub, hd, ang)
        _over(out, s, cx - hd / 2, cy - hd / 2)
    if use_rims:
        for side, name in (("left", "rim_L.png"), ("right", "rim_R.png")):
            s = np.asarray(Image.open(RES / f"tapes/{t['id']}/{name}").convert("RGBA")).astype(np.float32)
            bx0, by0 = rims[side]["_px"]
            _over(out, s, bx0, by0)
    return out


def stage_rims():
    m = manifest()
    store = {}
    rows = []
    discs = []
    for t in m["tapes"]:
        rims, rgba, g = cut_rims(t)
        store[t["id"]] = {"left": {k: rims["left"][k] for k in ("rect", "file")},
                          "right": {k: rims["right"][k] for k in ("rect", "file")},
                          "packMinRadius": round(rims["_radii"][0] / FW, 5),
                          "packMaxRadius": round(rims["_radii"][1] / FW, 5),
                          "innerWindowPx": rims["_inner"],
                          "clearShell": t["id"] in CLEAR_SHELLS}
        print(f"  {t['id']:22s} inner {rims['_inner']}{' (override)' if t['id'] in INNER_OVERRIDES else ''}"
              f"{' clear 60%' if t['id'] in CLEAR_SHELLS else ''}")
        wx, wy, ww, wh = g["win"]
        crop = (slice(int(wy) - 24, int(wy + wh) + 24), slice(int(wx) - 24, int(wx + ww) + 24))
        r0, R = rims["_radii"]
        rmid = float(np.sqrt((R * R + r0 * r0) / 2))
        cols = []
        for use, rs, rt, name in ((False, g["R1"], g["r0"], f"{t['id']} now"),
                                  (True, R, r0, "rims, start of side"),
                                  (True, rmid, rmid, "rims, half way")):
            img = app_composite(t, rgba, g, rims, use, rs, rt)
            cols.append(label(cv2.cvtColor(np.clip(img, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)[crop], name))
        rows.append(np.hstack(cols))
        # rims over a flat dark disc (the brief's check), plus the capsule outline
        dark = rgba[..., :3].astype(np.float32)
        cap = capsule_cover(rgba.shape[1], rgba.shape[0], g["win"])[..., None]
        flat = np.full_like(dark, 0.03 * 255)
        yy, xx = np.mgrid[0:rgba.shape[0], 0:rgba.shape[1]].astype(np.float32)
        for (cx, cy) in (g["L"], g["R"]):
            dmask = (np.hypot(xx - cx, yy - cy) < rims["_radii"][1] * 0.8)[..., None]
            flat = np.where(dmask, np.array([58, 40, 28], np.float32), flat)
        dark = dark * (1 - cap) + flat * cap
        for side, name in (("left", "rim_L.png"), ("right", "rim_R.png")):
            s = np.asarray(Image.open(RES / f"tapes/{t['id']}/{name}").convert("RGBA")).astype(np.float32)
            _over(dark, s, *rims[side]["_px"])
        discs.append(label(cv2.cvtColor(np.clip(dark, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)[crop], t["id"]))
    RIMS_JSON.write_text(json.dumps(store, indent=2) + "\n")
    print("wrote", rel(RIMS_JSON))
    wmax = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(cv2.resize(r, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA), 0, 6, 0,
                               round(wmax * 0.6) - round(r.shape[1] * 0.6), cv2.BORDER_CONSTANT) for r in rows]
    for k in range(0, len(rows), 4):
        save_bgr(CHECK / f"rims-check-{k // 4 + 1}.png", np.vstack(rows[k:k + 4]))
    save_bgr(CHECK / "rims-dark-disc.png", grid(discs, 2))


def grid(tiles, cols):
    """Tiles into a cols-wide grid, each padded to the largest tile."""
    th = max(t.shape[0] for t in tiles) + 6
    tw = max(t.shape[1] for t in tiles) + 6
    tiles = [cv2.copyMakeBorder(t, 0, th - t.shape[0], 0, tw - t.shape[1], cv2.BORDER_CONSTANT)
             for t in tiles]
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    return np.vstack([np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)])


# =========================================================================== B. door edges

THICK_PX = 9                       # 0.004 x 2160 = 8.6, rounded up to whole px
TOP_RAIL_ROWS = (299, 311)         # door_frame.png: the chrome top rail (rows 276..297 are its dark lip)
BOTTOM_BAR_ROWS = (1332, 1396)     # the brushed bottom bar above its printed lettering band


def edge_strip(frame, rows, gain_back, gain_front, arris):
    """Per-column material of `rows` (the horizontal brushing survives, the
    vertical detail is averaged out), THICK_PX rows tall, lit by a gradient
    from the back edge (row 0) to the front arris (last row) with a 1 px
    highlight on the arris."""
    band = frame[rows[0]:rows[1], :, :3].astype(np.float32)
    col = band.mean(0)                                   # (W, 3)
    # keep a little of the band's own row variation, squeezed to the strip
    rowvar = cv2.resize(band - col[None], (band.shape[1], THICK_PX), interpolation=cv2.INTER_AREA) * 0.5
    t = (np.arange(THICK_PX) + 0.5) / THICK_PX
    gain = gain_back + (gain_front - gain_back) * smooth01(t)
    strip = (col[None] + rowvar) * gain[:, None, None]
    strip[-1] = strip[-1] + arris
    return np.clip(strip, 0, 255)


def stage_door():
    m = manifest()
    door = m["deck"]["door"]
    frame = np.asarray(Image.open(DECK / "door_frame.png").convert("RGBA"))
    a = frame[..., 3]
    cols = np.nonzero((a[TOP_RAIL_ROWS[0] + 4] > 127))[0]
    x0, x1 = int(cols.min()), int(cols.max()) + 1
    fr = frame[:, x0:x1]
    top = edge_strip(fr, TOP_RAIL_ROWS, 0.62, 1.04, 22.0)            # lit from above
    bot = edge_strip(fr, BOTTOM_BAR_ROWS, 0.62, 0.40, 0.0)[::-1]     # underside, in shadow; arris on top
    bot[0] = np.clip(bot[0] * 1.25, 0, 255)
    alpha = np.full((THICK_PX, x1 - x0), 255, np.float32)
    alpha[:, 0] = alpha[:, -1] = 128                                 # 1 px soft ends
    for name, s in (("door_edge_top.png", top), ("door_edge_bottom.png", bot)):
        save_rgba(DECK / name, np.dstack([s.round().astype(np.uint8), alpha.astype(np.uint8)]))
    th = THICK_PX / FH
    y_top, y_bot = door["y"], door["y"] + door["h"]
    edges = {
        "top": {"x": round(x0 / FW, 5), "y": round(y_top - th, 5), "w": round((x1 - x0) / FW, 5), "h": round(th, 5)},
        "bottom": {"x": round(x0 / FW, 5), "y": round(y_bot, 5), "w": round((x1 - x0) / FW, 5), "h": round(th, 5)},
        "thicknessFraction": round(th, 5),
        "files": {"top": "deck/door_edge_top.png", "bottom": "deck/door_edge_bottom.png"},
        "note": ("rects are the strips at full thickness (sin(tilt) = 1), attached to the door rect: "
                 "top sits on the door's top edge and grows upward (its last row is the front arris), "
                 "bottom hangs from the door's bottom edge (its first row is the arris). Scale height by "
                 "sin(tilt) and move with the door's projected edge. For a bottom-hinged door tilting "
                 "out, only the top edge faces the camera; the bottom strip is for a hinge model that "
                 "shows it."),
    }
    merge_plate({"door_edges": edges})
    # check: the strips on the door at full and 0.5 thickness, 2x
    plate = cv2.imread(str(DECK / "deck_empty_v2.png")).astype(np.float32)
    canvas = plate.copy()
    fbgr = np.dstack([cv2.cvtColor(frame[..., :3], cv2.COLOR_RGB2BGR), frame[..., 3]]).astype(np.float32)
    _over(canvas, fbgr, 0, 0)
    tiles = []
    for k in (1.0, 0.5):
        c = canvas.copy()
        hh = max(1, round(THICK_PX * k))
        for s, y in ((top, round(y_top * FH) - hh), (bot, round(y_bot * FH))):
            spr = cv2.resize(np.dstack([s[..., ::-1], alpha]), (x1 - x0, hh), interpolation=cv2.INTER_AREA)
            _over(c, spr, x0, y)
        for (cx, cy) in ((x0 + 60, round(y_top * FH)), (x1 - 300, round(y_top * FH)),
                         (x0 + 60, round(y_bot * FH)), (x1 - 300, round(y_bot * FH))):
            crop = c[cy - 40:cy + 40, cx:cx + 240]
            tiles.append(label(cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST).clip(0, 255).astype(np.uint8),
                               f"sin {k} {'top' if cy < 1000 else 'bottom'}"))
    save_bgr(CHECK / "door-edges-check.png", grid(tiles, 4))


# =========================================================================== C. spindles

SPINDLE_V2 = [(1597.0, 773.0), (2282.0, 770.0)]   # measured on v2: radial-gradient fit of the outer rim, r 77
SPINDLE_CORE = 150.0      # window radius at full weight: the disc (rim r 77) and the bright
SPINDLE_FALL = 260.0      #   halo the inpaint pooled round it, which fades out by r 260
BG_ANNULUS = (230.0, 330.0)   # background fit annulus (about the move's midpoint)
BG_MAX_Y = 1060           # plate rows below this hold the head block: kept out of the fit
GRAIN_SIGMA = 3.0
WELL_OPEN_ORIGIN = (1024, 276)   # well_open.png's top-left on the plate (make_well_open.py)


def spindle_targets():
    m = manifest()
    L = np.array([[t["hubL"]["x"] * FW, t["hubL"]["y"] * FH] for t in m["tapes"]]).mean(0)
    R = np.array([[t["hubR"]["x"] * FW, t["hubR"]["y"] * FH] for t in m["tapes"]]).mean(0)
    # pixel-index centres: frame coordinate minus half a pixel
    return [(float(L[0] - 0.5), float(L[1] - 0.5)), (float(R[0] - 0.5), float(R[1] - 0.5))]


def move_spindles(img, olds, news, origin=(0, 0)):
    """Each spindle and its halo moved old -> new (pixel-index centres in img).

    The area round a spindle is split into a smooth background B (quadratic
    per channel, fitted on a far annulus where the halo has faded) and the
    feature F = img - B (disc, halo, grain). The feature moves under a wide
    radial window w (1 inside SPINDLE_CORE, smooth to 0 at SPINDLE_FALL):
        out = img - w_old * F + w_new * shift(F)
    so the halo travels with the spindle and nothing is left at the old place
    but the background; the cavity grain the vacated area loses is put back
    from a high-pass of the same pixels' surroundings."""
    out = img.astype(np.float32).copy()
    oy0 = origin[1]
    for (ox, oy), (nx_, ny_) in zip(olds, news):
        mx, my = (ox + nx_) / 2, (oy + ny_) / 2
        half = int(BG_ANNULUS[1]) + 10
        bx, by = int(mx - half), int(my - half)
        box = img[by:by + 2 * half, bx:bx + 2 * half].astype(np.float32)
        yy, xx = np.mgrid[by:by + 2 * half, bx:bx + 2 * half].astype(np.float32)
        d_mid = np.hypot(xx - mx, yy - my)
        keep = (d_mid > BG_ANNULUS[0]) & (d_mid < BG_ANNULUS[1]) & (yy + oy0 < BG_MAX_Y)
        X, Y = (xx - mx) / half, (yy - my) / half
        A = np.stack([np.ones_like(X), X, Y, X * X, X * Y, Y * Y], -1)
        B = np.zeros_like(box)
        for c in range(3):
            coef, *_ = np.linalg.lstsq(A[keep], box[..., c][keep], rcond=None)
            B[..., c] = A @ coef
        F = box - B

        def win(cx, cy):
            d = np.hypot(xx - cx, yy - cy)
            return (1 - smooth01((d - SPINDLE_CORE) / (SPINDLE_FALL - SPINDLE_CORE)))[..., None]

        M = np.float32([[1, 0, nx_ - ox], [0, 1, ny_ - oy]])
        Fs = cv2.warpAffine(F, M, (2 * half, 2 * half), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        w_old, w_new = win(ox, oy), win(nx_, ny_)
        # the vacated disc itself (not the halo) loses its grain: put grain back there
        hp = F - cv2.GaussianBlur(F, (0, 0), GRAIN_SIGMA)
        donor = cv2.warpAffine(hp, np.float32([[1, 0, 0], [0, 1, -(2 * SPINDLE_CORE)]]), (2 * half, 2 * half),
                               borderMode=cv2.BORDER_REFLECT)   # rows from well above the disc
        d_old = np.hypot(xx - ox, yy - oy)
        d_new = np.hypot(xx - nx_, yy - ny_)
        vac = ((1 - smooth01((d_old - 80) / 16)) * smooth01((d_new - 80) / 16))[..., None]
        res = box - w_old * F + w_new * Fs + vac * donor
        out[by:by + 2 * half, bx:bx + 2 * half] = res
    return np.clip(out, 0, 255).round().astype(np.uint8)


def check_only_spindles(a, b, olds, news):
    """Every changed pixel lies inside the two moves' windows (old or new
    centre, r <= SPINDLE_FALL). Returns (changed px, bbox per spindle)."""
    d = np.abs(a.astype(int) - b.astype(int)).max(2) > 0
    yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    allowed = np.zeros(d.shape, bool)
    boxes = []
    for (ox, oy), (nx_, ny_) in zip(olds, news):
        zone = (np.hypot(xx - ox, yy - oy) <= SPINDLE_FALL) | (np.hypot(xx - nx_, yy - ny_) <= SPINDLE_FALL)
        allowed |= zone
        ys_, xs_ = np.nonzero(d & zone)
        boxes.append((int(xs_.min()), int(ys_.min()), int(xs_.max()) + 1, int(ys_.max()) + 1))
    assert not (d & ~allowed).any(), "pixels changed outside the spindle regions"
    return int(d.sum()), boxes


def changed_boxes(a, b):
    d = (np.abs(a.astype(int) - b.astype(int)).max(2) > 0).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(d, np.ones((9, 9), np.uint8)))
    return [tuple(int(v) for v in st[k, :4]) for k in range(1, n)], int(d.sum())


def stage_spindles():
    news = spindle_targets()
    v2 = cv2.imread(str(DECK / "deck_empty_v2.png"))
    v3 = move_spindles(v2, SPINDLE_V2, news)
    save_bgr(DECK / "deck_empty_v3.png", v3)
    npx, boxes = check_only_spindles(v2, v3, SPINDLE_V2, news)
    print(f"  v2 -> v3: {npx} px changed, all inside the two spindle regions, bboxes (x0, y0, x1, y1) {boxes}")
    for (ox, oy), (nx_, ny_) in zip(SPINDLE_V2, news):
        print(f"  spindle ({ox:.0f}, {oy:.0f}) -> ({nx_:.1f}, {ny_:.1f})  d = ({nx_ - ox:+.1f}, {ny_ - oy:+.1f}) px")
    # well_open.png: the same spindles in door-rect coordinates
    keep = ROOT / "art-src" / "mixtape" / "plates" / "well_open_v2spindles.png"
    if not keep.exists():   # first run: keep the pre-move well_open (it is regenerated in place)
        cv2.imwrite(str(keep), cv2.imread(str(DECK / "well_open.png")))
    wo = cv2.imread(str(keep))
    ox0, oy0 = WELL_OPEN_ORIGIN
    olds_w = [(x - ox0, y - oy0) for x, y in SPINDLE_V2]
    news_w = [(x - ox0, y - oy0) for x, y in news]
    wo2 = move_spindles(wo, olds_w, news_w, origin=WELL_OPEN_ORIGIN)
    wnpx, wboxes = check_only_spindles(wo, wo2, olds_w, news_w)
    print(f"  well_open: {wnpx} px changed, all inside the two spindle regions, bboxes {wboxes}")
    save_bgr(DECK / "well_open.png", wo2)
    merge_plate({"plates": {"deck_v3": "tvos/Resources/Mixtape/deck/deck_empty_v3.png"},
                 "spindles": {"left": {"x": round((news[0][0] + 0.5) / FW, 5), "y": round((news[0][1] + 0.5) / FH, 5)},
                              "right": {"x": round((news[1][0] + 0.5) / FW, 5), "y": round((news[1][1] + 0.5) / FH, 5)},
                              "note": "empty-well spindle centres in deck_empty_v3 and well_open.png: the mean "
                                      "of the 14 tapes' hubL / hubR"}})
    # check: before / after with the mean hub centres marked, plus a diff map
    tiles = []
    for img, name in ((v2, "v2"), (v3, "v3")):
        c = img[600:1000, 1380:2500].copy()
        for (x, y) in news:
            cv2.drawMarker(c, (round(x - 1380), round(y - 600)), (0, 255, 255), cv2.MARKER_CROSS, 30, 1)
        tiles.append(label(c, f"{name} (cross = mean tape hub centre)"))
    diff = (np.abs(v2.astype(int) - v3.astype(int)).max(2) * 4).clip(0, 255).astype(np.uint8)
    tiles.append(label(cv2.cvtColor(cv2.resize(diff, (1120, 630)), cv2.COLOR_GRAY2BGR), "diff x4, whole plate"))
    w2 = wo2[300:720, 350:1500].copy()
    tiles.append(label(w2, "well_open.png after"))
    save_bgr(CHECK / "spindles-check.png", grid(tiles, 2))
    z = [cv2.resize(im[680:900, 1480:1720], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST) for im in (v2, v3)]
    z += [cv2.resize(im[680:900, 2120:2360], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST) for im in (v2, v3)]
    save_bgr(CHECK / "spindles-zoom-2x.png", grid([label(a, n) for a, n in zip(z, ("L v2", "L v3", "R v2", "R v3"))], 2))


# =========================================================================== D. tape counter

# Placement (4K px, pixel edges): the clear brushed band between the right VU
# bezel (its shadow ends about y 888) and the OUTPUT legend (cap top y 1003),
# centred over the OUTPUT knob (x 3178). Inside the 16:10 crop (x 192..3648).
CNT_RIM = (3062, 907, 3222, 983)       # chrome rim, outer edge (160 x 76)
CNT_RIM_W = 4                          # chrome rim width
CNT_WIN = (3076, 920, 3208, 970)       # digit window (132 x 50)
CNT_CELL_W, CNT_GAP = 40, 6            # three drums 40 px wide, 6 px apart
RESET_C, RESET_R, RESET_HOLE = (3252.0, 945.0), 13.0, 17.0
DIGIT_FONT = "/System/Library/Fonts/Helvetica.ttc"
DIGIT_CAP = 0.60                       # numeral height / cell height
DRUM_RGB = np.array([20, 19, 18], np.float32)
INK_RGB = np.array([238, 234, 224], np.float32)


def cells():
    x0, y0, x1, y1 = CNT_WIN
    return [(x0 + k * (CNT_CELL_W + CNT_GAP), y0, x0 + k * (CNT_CELL_W + CNT_GAP) + CNT_CELL_W, y1) for k in range(3)]


def drum_shade(h):
    """Brightness across a drum's visible face: a cylinder seen straight on."""
    t = (np.arange(h) + 0.5) / h * 2 - 1
    return 1 - 0.55 * t * t


def build_housing(plate_bgr):
    """Hand-built housing composited into the plate (BGR uint8 in, out)."""
    out = plate_bgr.astype(np.float32).copy()
    X0, Y0, X1, Y1 = CNT_RIM[0] - 40, CNT_RIM[1] - 30, RESET_C[0] + RESET_HOLE + 30, CNT_RIM[3] + 30
    X0, Y0, X1, Y1 = int(X0), int(Y0), int(X1), int(Y1)
    reg = out[Y0:Y1, X0:X1]
    h, w = reg.shape[:2]
    # faceplate tone around the housing, for tinting the chrome
    face = plate_bgr[CNT_RIM[1] - 14:CNT_RIM[1] - 4, CNT_RIM[0]:CNT_RIM[2]].reshape(-1, 3).astype(np.float32).mean(0)
    tint = face / face.mean()
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32) + 0.5
    rx0, ry0, rx1, ry1 = [v - o for v, o in zip(CNT_RIM, (X0, Y0, X0, Y0))]
    rim = rrect_cover(w, h, rx0, ry0, rx1, ry1, 8.0, 1.0)
    # 1. soft drop shadow of the raised rim (light from above): darken the plate
    sh = cv2.GaussianBlur(np.roll(rim, 3, axis=0), (0, 0), 3.5)
    reg *= (1 - 0.45 * sh)[..., None]
    # 2. chrome rim: vertical chrome profile, brushed, tinted like the faceplate
    ty = np.clip((yy - ry0) / (ry1 - ry0), 0, 1)
    prof = np.interp(ty, [0, 0.06, 0.35, 0.55, 0.72, 0.94, 1], [250, 228, 168, 150, 205, 128, 92])
    rng = np.random.default_rng(7)
    brush = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), sigmaX=18, sigmaY=0.6) * 22
    chrome = (prof + brush)[..., None] * tint[None, None]
    reg[:] = reg * (1 - rim[..., None]) + chrome * rim[..., None]
    # 3. recessed black bezel inside the rim, darker under its top lip
    bx0, by0, bx1, by1 = rx0 + CNT_RIM_W, ry0 + CNT_RIM_W, rx1 - CNT_RIM_W, ry1 - CNT_RIM_W
    bez = rrect_cover(w, h, bx0, by0, bx1, by1, 5.0, 1.0)
    tb = np.clip((yy - by0) / (by1 - by0), 0, 1)
    bez_v = 9 + 15 * tb + 10 * np.exp(-((yy - (by1 - 2)) / 1.5) ** 2)     # lit lower lip
    bez_v *= 1 - 0.5 * np.exp(-(yy - by0) / 3.0) * (yy >= by0)             # shadow under the top lip
    reg[:] = reg * (1 - bez[..., None]) + (bez_v[..., None] * np.array([1.0, 1.0, 1.06])) * bez[..., None]
    # 4. the digit window: three blank drums (no digits), separators, deep shadow at top
    wx0, wy0, wx1, wy1 = [v - o for v, o in zip(CNT_WIN, (X0, Y0, X0, Y0))]
    win = rrect_cover(w, h, wx0, wy0, wx1, wy1, 2.0, 1.0)
    shade = np.interp(yy, wy0 + np.arange(wy1 - wy0) + 0.5, drum_shade(wy1 - wy0))
    drum = DRUM_RGB[::-1][None, None] * shade[..., None]
    for k in range(2):
        sx = wx0 + (k + 1) * CNT_CELL_W + k * CNT_GAP
        sep = ((xx >= sx) & (xx < sx + CNT_GAP)).astype(np.float32)
        drum = drum * (1 - 0.6 * sep[..., None])
    drum *= (1 - 0.55 * np.exp(-(yy - wy0) / 4.0) * (yy >= wy0))[..., None]
    reg[:] = reg * (1 - win[..., None]) + drum * win[..., None]
    # 5. RESET button: a dark ring in the plate, a domed chrome cap, light from upper left
    cx, cy = RESET_C[0] - X0, RESET_C[1] - Y0
    d = np.hypot(xx - cx, yy - cy)
    hole = np.clip(RESET_HOLE - d + 0.5, 0, 1)
    hsh = cv2.GaussianBlur(np.roll(hole, 2, axis=0), (0, 0), 2.5)
    reg *= (1 - 0.35 * hsh * (1 - hole))[..., None]
    hole_v = 14 + 10 * np.clip((yy - (cy - RESET_HOLE)) / (2 * RESET_HOLE), 0, 1)
    reg[:] = reg * (1 - hole[..., None]) + hole_v[..., None] * hole[..., None]
    cap = np.clip(RESET_R - d + 0.5, 0, 1)
    nx_, ny_ = (xx - cx) / RESET_R, (yy - cy) / RESET_R
    nz = np.sqrt(np.clip(1 - nx_ ** 2 - ny_ ** 2, 0, 1))
    L = np.array([-0.45, -0.6, 0.66]); L /= np.linalg.norm(L)
    lam = np.clip(nx_ * L[0] + ny_ * L[1] + nz * L[2], 0, 1)
    spec = np.clip(nx_ * L[0] + ny_ * L[1] + nz * L[2], 0, 1) ** 24
    capv = 70 + 140 * lam + 90 * spec + cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 1.2) * 4
    capv *= 1 - 0.35 * np.clip((d - (RESET_R - 2.5)) / 2.5, 0, 1)            # dark bevel at the edge
    reg[:] = reg * (1 - cap[..., None]) + (capv[..., None] * tint[None, None]) * cap[..., None]
    out[Y0:Y1, X0:X1] = reg
    res = np.clip(out, 0, 255).round().astype(np.uint8)
    return res, (X0, Y0, X1, Y1)


def build_digit_strip():
    """11 cells (0..9, then 0) of CNT_CELL_W x cell height, RGBA (opaque)."""
    ch = CNT_WIN[3] - CNT_WIN[1]
    ss = 8
    n = 11
    font = ImageFont.truetype(DIGIT_FONT, 100 * ss)
    probe = Image.new("L", (200 * ss, 200 * ss), 0)
    ImageDraw.Draw(probe).text((10 * ss, 10 * ss), "0", font=font, fill=255)
    bb = probe.getbbox()
    size = 100 * DIGIT_CAP * ch / ((bb[3] - bb[1]) / ss)
    font = ImageFont.truetype(DIGIT_FONT, int(round(size * ss)))
    W_, H_ = CNT_CELL_W * ss, ch * n * ss
    ink = Image.new("L", (W_, H_), 0)
    dr = ImageDraw.Draw(ink)
    for k in range(n):
        ch_ = str(k % 10)
        tb = dr.textbbox((0, 0), ch_, font=font)
        x = (W_ - (tb[2] - tb[0])) / 2 - tb[0]
        y = k * ch * ss + (ch * ss - (tb[3] - tb[1])) / 2 - tb[1]
        dr.text((x, y), ch_, font=font, fill=255)
    a = cv2.resize(np.asarray(ink, np.float32) / 255, (CNT_CELL_W, ch * n), interpolation=cv2.INTER_AREA)
    shade = np.tile(drum_shade(ch), n)[:, None]
    shade = 1 - (1 - shade) * 0.35          # subtle per-cell cylinder shading (the glass carries the rest)
    rgb = (DRUM_RGB[None, None] * (1 - a[..., None]) + INK_RGB[None, None] * a[..., None]) * shade[..., None]
    return np.dstack([np.clip(rgb, 0, 255).round().astype(np.uint8), np.full(a.shape, 255, np.uint8)])


def build_glass():
    """Overlay for the window (drawn over the digits): fixed cylinder shading,
    drum separators, a faint highlight under the top lip."""
    x0, y0, x1, y1 = CNT_WIN
    w, h = x1 - x0, y1 - y0
    t = (np.arange(h) + 0.5) / h * 2 - 1
    dark = np.clip(0.75 * np.abs(t) ** 2.2, 0, 1)[:, None] * np.ones((1, w))
    dark = np.maximum(dark, 0.6 * np.exp(-(np.arange(h)[:, None] + 0.5) / 4.0))
    for k in range(2):
        sx = (k + 1) * CNT_CELL_W + k * CNT_GAP
        dark[:, sx:sx + CNT_GAP] = 0.92
    rgb = np.zeros((h, w, 3), np.float32)
    hl = np.exp(-((np.arange(h) - 5.0) / 1.2) ** 2)[:, None] * np.ones((1, w)) * 0.10
    rgb[:] = 255 * (hl / np.maximum(dark + hl, 1e-3))[..., None]
    a = np.clip(dark + hl, 0, 1)
    return np.dstack([rgb.round().astype(np.uint8), (a * 255).round().astype(np.uint8)])


def draw_digits(img_bgr, strip_rgba, glass_rgba, values):
    """values: three floats (drum positions 0..10, fractional = mid-roll)."""
    out = img_bgr.astype(np.float32).copy()
    ch = CNT_WIN[3] - CNT_WIN[1]
    s = strip_rgba.astype(np.float32)
    s = np.dstack([s[..., 2::-1], s[..., 3:]])
    for (x0, y0, x1, y1), v in zip(cells(), values):
        off = (v % 10) * ch
        M = np.float32([[1, 0, 0], [0, 1, -off]])
        cell = cv2.warpAffine(s, M, (CNT_CELL_W, ch), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        _over(out, cell, x0, y0)
    g = glass_rgba.astype(np.float32)
    _over(out, np.dstack([g[..., 2::-1], g[..., 3:]]), CNT_WIN[0], CNT_WIN[1])
    return np.clip(out, 0, 255).round().astype(np.uint8)


def stage_counter():
    v3 = cv2.imread(str(DECK / "deck_empty_v3.png"))
    plate, box = build_housing(v3)
    save_bgr(DECK / "deck_empty_v3_counter.png", plate)
    bxs, npx = changed_boxes(v3, plate)
    print(f"  v3 -> v3_counter: {npx} px changed in {bxs} (housing box {box})")
    X0, Y0, X1, Y1 = box
    outside = plate.copy()
    outside[Y0:Y1, X0:X1] = v3[Y0:Y1, X0:X1]
    assert np.array_equal(outside, v3), "pixels changed outside the housing box"
    strip = build_digit_strip()
    save_rgba(DECK / "counter_digits.png", strip)
    glass = build_glass()
    save_rgba(DECK / "counter_glass.png", glass)
    ch = CNT_WIN[3] - CNT_WIN[1]
    counter = {
        "housing": rect_n(*CNT_RIM),
        "window": rect_n(*CNT_WIN),
        "digitCells": [rect_n(*c) for c in cells()],
        "digitStripFile": "deck/counter_digits.png",
        "digitStripCells": 11,
        "digitHeightFraction": round(ch / FH, 5),
        "glassFile": "deck/counter_glass.png",
        "glassRect": rect_n(*CNT_WIN),
        "resetButton": rect_n(RESET_C[0] - RESET_HOLE, RESET_C[1] - RESET_HOLE,
                              RESET_C[0] + RESET_HOLE, RESET_C[1] + RESET_HOLE),
        "note": ("counter_digits.png is 11 cells (0..9 then 0); show drum value v (0 <= v < 10, "
                 "fractional while rolling) by offsetting the strip up by v * cell height inside each "
                 "digitCell (clip to the cell). The extra 0 makes 9 -> 0 roll seamlessly. Draw "
                 "counter_glass.png over the digits at glassRect (fixed cylinder shading and drum "
                 "separators). The housing is baked into deck_empty_v3_counter.png."),
    }
    merge_plate({"plates": {"deck_v3_counter": "tvos/Resources/Mixtape/deck/deck_empty_v3_counter.png"},
                 "counter": counter})
    # comparison: context, then housing empty / 000 / 147 / mid-roll 149.5 -> 150 at 2x
    cx0, cy0, cx1, cy1 = 3020, 880, 3300, 1010
    rows = [label(plate[760:1340, 2780:3700].copy(), "placement (1x)")]
    zs = []
    for vals, name in ((None, "housing, empty"), ((0, 0, 0), "000"), ((1, 4, 7), "147"),
                       ((1, 4.5, 9.5), "rolling 149 -> 150")):
        img = plate if vals is None else draw_digits(plate, strip, glass, vals)
        zs.append(label(cv2.resize(img[cy0:cy1, cx0:cx1], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), name + " (2x)"))
    save_bgr(CHECK / "counter-compare.png", grid(zs, 2))
    save_bgr(CHECK / "counter-placement.png", rows[0])


# =========================================================================== manifest

def merge_plate(keys):
    """Merge deck keys into plate-manifest.json (build_tape_assets.py copies it
    into the app manifest's "deck"). Nested dicts merge one level deep."""
    man = json.loads(PLATE_MANIFEST.read_text())
    for k, v in keys.items():
        if isinstance(v, dict) and isinstance(man.get(k), dict) and k == "plates":
            man[k].update(v)
        else:
            man[k] = v
    PLATE_MANIFEST.write_text(json.dumps(man, indent=2) + "\n")
    print("  merged", ", ".join(keys), "into", rel(PLATE_MANIFEST))


def stage_manifest():
    subprocess.run([sys.executable, str(ROOT / "scripts" / "mixtape" / "build_tape_assets.py"), "--manifest-only"],
                   check=True, stdout=subprocess.DEVNULL)
    rims = json.loads(RIMS_JSON.read_text())
    man = json.loads(MANIFEST.read_text())
    for t in man["tapes"]:
        r = rims.get(t["id"])
        if r:
            t["rims"] = {"left": r["left"], "right": r["right"],
                         "packMinRadius": r["packMinRadius"], "packMaxRadius": r["packMaxRadius"],
                         "clearShell": r["clearShell"]}
    man.setdefault("deck", {}).setdefault("notes", [])
    man["deck"]["notes"] = [n for n in man["deck"]["notes"] if not n.startswith("rims:")] + [
        "rims: tapes[i].rims.left / right (rect, file) are the shell around each hub, drawn OVER the live "
        "packs (after the packs, before or after the hub sprites: they do not overlap the hub disc). With "
        "them the packs are only seen through the clear inner window, so use rims.packMinRadius / "
        "packMaxRadius (real cassette proportions) instead of the window-limited packMinRadius / "
        "packMaxRadius; the packs still clip to the windowRect capsule."]
    fd, tmp = tempfile.mkstemp(dir=RES, prefix=".mixtape-manifest.", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(man, f, indent=2)
        f.write("\n")
    json.loads(Path(tmp).read_text())
    os.chmod(tmp, 0o644)
    os.replace(tmp, MANIFEST)
    print("wrote", rel(MANIFEST), f"({sum('rims' in t for t in man['tapes'])} tapes with rims)")


# =========================================================================== stages

STAGES = {"rims": stage_rims, "door": stage_door, "spindles": stage_spindles,
          "counter": stage_counter, "manifest": stage_manifest}


def main():
    args = sys.argv[1:] or ["all"]
    order = list(STAGES)
    todo = order if args == ["all"] else args
    for s in todo:
        if s not in STAGES:
            sys.exit(f"unknown stage {s}; one of {', '.join(order)} or all")
        print(f"== {s}")
        STAGES[s]()


if __name__ == "__main__":
    main()
