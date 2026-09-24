#!/usr/bin/env python3
"""Measure Mixtape tape variants produced by gen_tape_variants.py (work package H).

For each keeper (<variant>_candidate<n>.png, chosen by eye) this:
  1. checks registration outside the edit mask against the reference, and pastes
     the reference back outside the mask with a 6 px feather if the mean abs diff
     is above 2 levels; the result is written as <variant>.png;
  2. finds both hubs (HoughCircles for a seed, dark bore blob for the centre,
     radial brightness profile for the light hub ring radius);
  3. finds the label rect (bright low-saturation paper) and the window rect (the
     largest hole in the label);
  4. cuts <variant>_hub_sprite.png and <variant>_pack_texture.png;
  5. draws <variant>_hubs_debug.png and writes measurements.json.

The reference photo is measured the same way as a baseline.

Usage:
    python3 scripts/mixtape/measure_tape_variants.py black_shell=2 clear_shell=1
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "art-src" / "mixtape" / "reference" / "horizon_deck_reference.png"
DIR = ROOT / "art-src" / "mixtape" / "tapes" / "test"  # --dir overrides (collection run)

W, H = 1672, 941
CASSETTE = (498, 1170, 150, 577)
MASK_PAD = 4
FEATHER = 6
K = (CASSETTE[1] - CASSETTE[0]) / 100.4  # px per mm
CAS_CX = (CASSETTE[0] + CASSETTE[1]) / 2.0  # 834
CAS_CY = (CASSETTE[2] + CASSETTE[3]) / 2.0  # 363.5
EXP_SPACING = 42.5 * K  # 284.4
EXP_HUB_R = 11.0 * K  # 73.6
EXP_PACK_R = 25.0 * K  # 167.3
EXP_HUBS = [(CAS_CX - EXP_SPACING / 2, CAS_CY), (CAS_CX + EXP_SPACING / 2, CAS_CY)]

# Screening (collection run). The model consistently seats the hubs about 10 px
# above the shell's geometric centre line: both package H keepers measured 353.5
# (and the inpainted deck spindles sit higher still), so the collection is screened
# against that height, not CAS_CY, to keep every tape on the same spindles.
SCREEN_HUB_Y = 353.5
SCREEN_SPACING = 284.5
MAX_SHIFT_PX = 1.0
MAX_HUB_DY_PX = 3.0
MAX_SPACING_DEV_PX = 6.0


def mask_rect():
    return (CASSETTE[0] - MASK_PAD, CASSETTE[1] + MASK_PAD,
            CASSETTE[2] - MASK_PAD, CASSETTE[3] + MASK_PAD)


def edit_alpha():
    """1 inside the padded mask rect, ramping to 0 over FEATHER px outside it."""
    x0, x1, y0, y1 = mask_rect()
    inside = np.zeros((H, W), np.uint8)
    inside[y0:y1 + 1, x0:x1 + 1] = 255
    dist = cv2.distanceTransform(255 - inside, cv2.DIST_L2, 5)
    return np.clip(1.0 - dist / FEATHER, 0.0, 1.0).astype(np.float32)


def registration(img, ref):
    x0, x1, y0, y1 = mask_rect()
    outside = np.ones((H, W), bool)
    outside[y0:y1 + 1, x0:x1 + 1] = False
    diff = np.abs(img.astype(np.int16) - ref.astype(np.int16)).mean(axis=2)
    # band just outside the mask (the door frame / well): where a shift would show
    band = np.zeros((H, W), bool)
    band[y0 - 60:y1 + 61, x0 - 60:x1 + 61] = True
    band &= outside
    # global shift estimate of the regenerated area vs the reference (outside mask)
    g1 = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g2 = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    win = (slice(40, 900), slice(140, 1530))
    m = outside[win].astype(np.float32)
    shift, resp = cv2.phaseCorrelate(g1[win] * m, g2[win] * m)
    return {
        "meanAbsDiffOutsideMask": round(float(diff[outside].mean()), 3),
        "meanAbsDiffBand60pxAroundMask": round(float(diff[band].mean()), 3),
        "p99AbsDiffOutsideMask": round(float(np.percentile(diff[outside], 99)), 2),
        "phaseCorrShiftPx": [round(shift[0], 3), round(shift[1], 3)],
        "phaseCorrResponse": round(float(resp), 3),
    }


def _fit_circle(pts):
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    c = np.linalg.lstsq(A, x * x + y * y, rcond=None)[0]
    return c[0], c[1], float(np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2))


def ring_fit(g, cx, cy, rmin=30, rmax=43):
    """Refine a hub centre on the outer edge of the visible toothed ring: along 180
    rays find the strongest bright-to-dark step between rmin and rmax, least-squares
    circle through the stronger 60%, trimmed of outliers, three rounds. The bore
    blob alone drifts on generated hubs whose bore is off-centre or shadowed."""
    gf = cv2.GaussianBlur(g.astype(np.float32), (3, 3), 0)
    ang = np.linspace(0, 2 * np.pi, 180, endpoint=False)
    rs = np.arange(rmin, rmax, 0.5)
    r, n = None, 0
    for _ in range(3):
        X = (cx + np.outer(np.cos(ang), rs)).astype(np.float32)
        Y = (cy + np.outer(np.sin(ang), rs)).astype(np.float32)
        v = cv2.remap(gf, X, Y, cv2.INTER_LINEAR)
        d = v[:, :-2] - v[:, 2:]
        i = np.argmax(d, axis=1)
        strength = d[np.arange(len(ang)), i]
        re = rs[i + 1]
        keep = strength > np.percentile(strength, 40)
        pts = np.c_[cx + np.cos(ang) * re, cy + np.sin(ang) * re][keep]
        for _ in range(3):
            fx, fy, r = _fit_circle(pts)
            res = np.abs(np.hypot(pts[:, 0] - fx, pts[:, 1] - fy) - r)
            pts = pts[res < max(1.5, np.percentile(res, 70))]
        cx, cy, n = fx, fy, len(pts)
    return float(cx), float(cy), r, n


def find_hubs(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    ox, oy = 540, 250
    roi = cv2.medianBlur(g[oy:480, ox:1130], 5)
    c = cv2.HoughCircles(roi, cv2.HOUGH_GRADIENT, dp=1, minDist=150, param1=120,
                         param2=40, minRadius=25, maxRadius=90)
    seeds = sorted([(x + ox, y + oy, r) for x, y, r in c[0][:2]]) if c is not None else []
    if len(seeds) < 2:
        seeds = [(EXP_HUBS[0][0], EXP_HUBS[0][1], 45), (EXP_HUBS[1][0], EXP_HUBS[1][1], 45)]
    hubs = []
    for sx, sy, sr in seeds:
        # dark bore: darkest blob within 30 px of the seed
        R = 45
        x0, y0 = int(sx - R), int(sy - R)
        patch = cv2.GaussianBlur(g[y0:y0 + 2 * R, x0:x0 + 2 * R], (5, 5), 0)
        thr = min(60, int(np.percentile(patch, 20)) + 10)
        dark = (patch < thr).astype(np.uint8)
        n, lab, stats, cents = cv2.connectedComponentsWithStats(dark)
        best, bd = None, 1e9
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] < 150:
                continue
            d = np.hypot(cents[i][0] - R, cents[i][1] - R)
            if d < bd:
                best, bd = i, d
        if best is not None:
            bmask = (lab == best).astype(np.uint8)
            cnts, _ = cv2.findContours(bmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            (bx, by), br = cv2.minEnclosingCircle(max(cnts, key=cv2.contourArea))
            cx, cy = cents[best][0] + x0, cents[best][1] + y0
            bore_r = float(br)
        else:
            cx, cy, bore_r = sx, sy, None
        # radial brightness profile: the light hub ring, then its outer edge
        ang = np.linspace(0, 2 * np.pi, 360, endpoint=False)
        prof = []
        for r in range(0, 95):
            xs = np.clip((cx + r * np.cos(ang)).astype(int), 0, W - 1)
            ys = np.clip((cy + r * np.sin(ang)).astype(int), 0, H - 1)
            prof.append(float(np.median(g[ys, xs])))
        prof = np.array(prof)
        rr = np.arange(0, 95)  # prof[i] is radius i
        # the light hub ring is the first bright band outside the dark bore; beyond it
        # comes the dark window / pack, then the label paper (ignored)
        b0 = int(bore_r or 25) - 5
        lo, hi = b0 + 1, b0 + 22
        peak = lo + int(np.argmax(prof[lo:hi]))
        trough = peak + int(np.argmin(prof[peak:peak + 20]))
        half = (prof[peak] + prof[trough]) / 2.0
        edge_i = peak
        while edge_i < trough and prof[edge_i + 1] >= half:
            edge_i += 1
        fx, fy, fr, fn = ring_fit(g, cx, cy)
        hubs.append({
            "houghSeed": [round(float(sx), 1), round(float(sy), 1), round(float(sr), 1)],
            "boreCentre": [round(float(cx), 2), round(float(cy), 2)],
            "centre": [round(fx, 2), round(fy, 2)],
            "ringFitPoints": int(fn),
            "boreRadius": None if bore_r is None else round(bore_r, 1),
            "ringPeakRadius": int(rr[peak]),
            "profileRingOuterRadius": round(float(rr[edge_i]) + 0.5, 1),
            "ringOuterRadius": round(fr, 1),
        })
    return hubs


def _label_and_window_paper(img):
    x0, x1, y0, y1 = CASSETTE
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sub = hsv[y0:y1, x0:x1]
    paper = ((sub[..., 2] > 150) & (sub[..., 1] < 90)).astype(np.uint8)
    paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(paper)
    if n <= 1:
        return None, None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx, ly, lw, lh = stats[i, :4]
    lab_mask = (lab == i).astype(np.uint8)
    # close thin ruled lines / text so they do not count as holes
    closed = cv2.morphologyEx(lab_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    holes = (closed == 0).astype(np.uint8)
    holes[:ly, :] = 0
    holes[ly + lh:, :] = 0
    holes[:, :lx] = 0
    holes[:, lx + lw:] = 0
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(holes)
    wins = []
    for j in range(1, n2):
        bx, by, bw, bh, a = st2[j]
        touches = bx <= lx or by <= ly or bx + bw >= lx + lw or by + bh >= ly + lh
        if not touches and a > 2000:
            wins.append((a, bx, by, bw, bh))
    label = [int(lx + x0), int(ly + y0), int(lw), int(lh)]
    window = None
    if wins:
        a, bx, by, bw, bh = max(wins)
        window = [int(bx + x0), int(by + y0), int(bw), int(bh)]
    return label, window


def _plausible_label(r):
    return r is not None and 520 <= r[2] <= 660 and 235 <= r[3] <= 320


def _label_by_edges(img):
    """Fallback for shells the paper mask cannot separate from the label (white or
    yellowed shells): strongest straight edges in the bands where a label border
    can sit. Left / right are sampled above the window, top / bottom outside the
    hubs' columns."""
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32), (5, 5), 0)
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    # bands start 20+ px inside the shell's outer edge so the rim never wins
    top = 175 + int(np.argmax(gy[175:250, 600:1070].mean(axis=1)))
    bot = 430 + int(np.argmax(gy[430:520, 600:1070].mean(axis=1)))
    rows = slice(top + 15, top + 90)
    left = 525 + int(np.argmax(gx[rows, 525:600].mean(axis=0)))
    right = 1070 + int(np.argmax(gx[rows, 1070:1148].mean(axis=0)))
    return [left, top, right - left, bot - top]


def _window_by_hubs(img, hubs, label):
    """Fallback window: the dark slot between the hubs, widened to take in both hub
    holes (ring + 12 px) and at least as tall as a hub hole."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    (lx, ly), (rx, ry) = hubs[0]["centre"], hubs[1]["centre"]
    ring = max(h["ringOuterRadius"] for h in hubs) + 12
    cy = (ly + ry) / 2
    x0, x1 = int(lx + ring), int(rx - ring)
    ya, yb = int(cy - 90), int(cy + 90)
    dark = (g[ya:yb, x0:x1] < 90).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(dark)
    top, bot = cy - ring, cy + ring
    mid = lab[int(cy) - ya, (x1 - x0) // 2]
    if mid > 0:
        top = min(top, ya + st[mid, cv2.CC_STAT_TOP])
        bot = max(bot, ya + st[mid, cv2.CC_STAT_TOP] + st[mid, cv2.CC_STAT_HEIGHT])
    wx0, wx1 = int(round(lx - ring)), int(round(rx + ring))
    return [wx0, int(round(top)), wx1 - wx0, int(round(bot - top))]


def label_and_window(img, hubs=None):
    label, window = _label_and_window_paper(img)
    if not _plausible_label(label):
        label = _label_by_edges(img)
        window = None
    if window is None or not (60 <= window[3] <= 135 and 250 <= window[2] <= 430):
        if hubs is None:
            hubs = find_hubs(img)
        window = _window_by_hubs(img, hubs, label)
    return label, window


def write_sprites(img, variant, hubs, window):
    # hub sprite: left hub, radius = ring outer radius, alpha outside the circle
    h = hubs[0]
    cx, cy = h["centre"]
    r = h["ringOuterRadius"]
    s = int(np.ceil(r)) + 2
    x0, y0 = int(round(cx)) - s, int(round(cy)) - s
    crop = img[y0:y0 + 2 * s + 1, x0:x0 + 2 * s + 1]
    yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
    d = np.hypot(xx + x0 - cx, yy + y0 - cy)
    a = np.clip((r + 0.5 - d), 0, 1) * 255
    sprite = np.dstack([crop, a.astype(np.uint8)])
    cv2.imwrite(str(DIR / f"{variant}_hub_sprite.png"), sprite)
    # pack texture: brown pixels inside the window, outside both hub circles
    wx, wy, ww, wh = window
    crop = img[wy:wy + wh, wx:wx + ww]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    brown = (hsv[..., 0] >= 3) & (hsv[..., 0] <= 25) & (hsv[..., 1] > 70) & \
            (hsv[..., 2] > 25) & (hsv[..., 2] < 170)
    yy, xx = np.mgrid[0:wh, 0:ww]
    for hb in hubs:
        hx, hy = hb["centre"]
        brown &= np.hypot(xx + wx - hx, yy + wy - hy) > hb["ringOuterRadius"] + 14  # skip the hub flange
    brown = cv2.morphologyEx(brown.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    tex = np.dstack([crop, (brown * 255).astype(np.uint8)])
    cv2.imwrite(str(DIR / f"{variant}_pack_texture.png"), tex)
    return {"hubSprite": {"sizePx": [int(sprite.shape[1]), int(sprite.shape[0])],
                          "originPx": [x0, y0], "radiusPx": r},
            "packTexture": {"sizePx": [ww, wh], "originPx": [wx, wy],
                            "brownCoverage": round(float(brown.mean()), 3)}}


def debug_image(img, variant, hubs, label, window):
    d = img.copy()
    cv2.rectangle(d, (CASSETTE[0], CASSETTE[2]), (CASSETTE[1], CASSETTE[3]), (0, 255, 0), 1)
    for ex, ey in EXP_HUBS:
        cv2.circle(d, (int(round(ex)), int(round(ey))), int(round(EXP_HUB_R)), (255, 0, 255), 1)
        cv2.drawMarker(d, (int(round(ex)), int(round(ey))), (255, 0, 255), cv2.MARKER_CROSS, 16, 1)
    cv2.line(d, (CASSETTE[0], int(CAS_CY)), (CASSETTE[1], int(CAS_CY)), (255, 0, 255), 1)
    for h in hubs:
        c = (int(round(h["centre"][0])), int(round(h["centre"][1])))
        cv2.circle(d, c, int(round(h["ringOuterRadius"])), (0, 255, 255), 2)
        if h["boreRadius"]:
            cv2.circle(d, c, int(round(h["boreRadius"])), (0, 128, 255), 1)
        cv2.drawMarker(d, c, (0, 255, 255), cv2.MARKER_TILTED_CROSS, 12, 2)
    lx, ly, lw, lh = label
    cv2.rectangle(d, (lx, ly), (lx + lw, ly + lh), (255, 200, 0), 2)
    if window:
        wx, wy, ww, wh = window
        cv2.rectangle(d, (wx, wy), (wx + ww, wy + wh), (0, 0, 255), 2)
    crop = d[100:670, 420:1250]
    cv2.imwrite(str(DIR / f"{variant}_hubs_debug.png"), crop)


def norm_pt(p):
    return [round(p[0] / W, 5), round(p[1] / H, 5)]


def norm_rect(r):
    return None if r is None else {"x": round(r[0] / W, 5), "y": round(r[1] / H, 5),
                                   "w": round(r[2] / W, 5), "h": round(r[3] / H, 5)}


def measure(variant, img, ref, is_ref=False):
    out = {}
    if not is_ref:
        reg = registration(img, ref)
        out["registrationRaw"] = reg
        if reg["meanAbsDiffOutsideMask"] > 2.0:
            a = edit_alpha()[..., None]
            img = (img.astype(np.float32) * a + ref.astype(np.float32) * (1 - a)).round().astype(np.uint8)
            out["pasteBack"] = {"featherPx": FEATHER, "maskRect": list(mask_rect())}
            out["registrationAfterPasteBack"] = registration(img, ref)
        cv2.imwrite(str(DIR / f"{variant}.png"), img)
    hubs = find_hubs(img)
    label, window = label_and_window(img, hubs)
    (lx, ly), (rx, ry) = hubs[0]["centre"], hubs[1]["centre"]
    spacing = float(np.hypot(rx - lx, ry - ly))
    mid = ((lx + rx) / 2, (ly + ry) / 2)
    for h, e in zip(hubs, EXP_HUBS):
        h["deltaFromExpected"] = [round(h["centre"][0] - e[0], 2), round(h["centre"][1] - e[1], 2)]
        h["centreNorm"] = norm_pt(h["centre"])
        h["ringOuterRadiusNormW"] = round(h["ringOuterRadius"] / W, 5)
    out.update({
        "hubs": hubs,
        "hubSpacingPx": round(spacing, 2),
        "hubSpacingMm": round(spacing / K, 2),
        "hubSpacingDeviationPx": round(spacing - EXP_SPACING, 2),
        "hubMidpoint": [round(mid[0], 2), round(mid[1], 2)],
        "hubMidpointDeviationFromCassetteCentre": [round(mid[0] - CAS_CX, 2), round(mid[1] - CAS_CY, 2)],
        "hubTiltDeg": round(float(np.degrees(np.arctan2(ry - ly, rx - lx))), 3),
        "labelRectPx": label, "labelRectNorm": norm_rect(label),
        "windowRectPx": window, "windowRectNorm": norm_rect(window),
    })
    if not is_ref and window:
        out["sprites"] = write_sprites(img, variant, hubs, window)
    debug_image(img, variant, hubs, label, window)
    return out


def _text_rows(boxes):
    """Chains of glyph-sized boxes on a shared baseline (the shape of a word or a
    line of print); scattered grime and scratches do not chain."""
    n = len(boxes)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a in range(n):
        xa, ya, wa, ha = boxes[a]
        for b in range(a + 1, n):
            xb, yb, wb, hb = boxes[b]
            hm = max(ha, hb)
            if abs((ya + ha) - (yb + hb)) > 0.35 * hm or abs(ha - hb) > 0.6 * hm:
                continue
            gap = max(xb - (xa + wa), xa - (xb + wb))
            if gap <= 1.2 * hm:
                parent[find(a)] = find(b)
    sizes = {}
    for a in range(n):
        sizes[find(a)] = sizes.get(find(a), 0) + 1
    return sorted((v for v in sizes.values() if v >= 4), reverse=True)


def label_blankness(img, label, window, hubs):
    """Text-likeness of the label paper (no OCR available): dark thin strokes that
    stand out of the paper (black-hat > 50), grouped into connected components.
    Glyph-sized components that chain along a shared baseline (4 or more in a
    row) read as print or handwriting; long thin horizontal components read as
    ruled lines. Either makes the label not blank. The window slot (dilated) and
    the hubs are excluded; grime and scuffs are scattered and do not chain."""
    if label is None:
        return {"blank": False, "reason": "no label found"}
    lx, ly, lw, lh = label
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k)
    roi = np.zeros(g.shape, bool)
    roi[ly + 8:ly + lh - 8, lx + 8:lx + lw - 8] = True
    if window:
        wx, wy, ww, wh = window
        roi[max(0, wy - 14):wy + wh + 14, max(0, wx - 14):wx + ww + 14] = False
    yy, xx = np.mgrid[0:H, 0:W]
    for h in hubs:
        cx, cy = h["centre"]
        roi &= np.hypot(xx - cx, yy - cy) > 60
    ink = ((bh > 50) & roi).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    boxes, rules = [], 0
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if w >= 50 and h <= 6 and a >= 0.6 * w:
            rules += 1
        elif 8 <= a <= 600 and 4 <= h <= 34 and w <= 60:
            boxes.append((int(x), int(y), int(w), int(h)))
    rows = _text_rows(boxes)
    frac = float(ink.sum()) / max(1, int(roi.sum()))
    blank = not rows and rules == 0
    return {"blank": bool(blank), "glyphLikeComponents": len(boxes), "textRows": rows,
            "ruledLines": int(rules), "inkFraction": round(frac, 4)}


def screen(variant, img, ref):
    """Automatic accept / reject for one generated candidate (raw, before paste back)."""
    reg = registration(img, ref)
    shift = float(np.hypot(*reg["phaseCorrShiftPx"]))
    hubs = find_hubs(img)
    label, window = label_and_window(img, hubs)
    (lx, ly), (rx, ry) = hubs[0]["centre"], hubs[1]["centre"]
    spacing = float(np.hypot(rx - lx, ry - ly))
    dys = [ly - SCREEN_HUB_Y, ry - SCREEN_HUB_Y]
    blank = label_blankness(img, label, window, hubs)
    reasons = []
    if shift > MAX_SHIFT_PX:
        reasons.append(f"slice shifted {shift:.2f} px")
    for side, dy in zip("LR", dys):
        if abs(dy) > MAX_HUB_DY_PX:
            reasons.append(f"hub {side} {dy:+.1f} px off height {SCREEN_HUB_Y}")
    if abs(spacing - SCREEN_SPACING) > MAX_SPACING_DEV_PX:
        reasons.append(f"spacing {spacing:.1f} px ({spacing - SCREEN_SPACING:+.1f})")
    if window is None:
        reasons.append("no window found")
    if not blank["blank"]:
        reasons.append("label not blank " + json.dumps({k: v for k, v in blank.items() if k != "blank"}))
    # lower is better; used to pick the best when every candidate fails
    score = (shift * 4 + max(abs(d) for d in dys) + abs(spacing - SCREEN_SPACING) / 2
             + sum(blank.get("textRows", [10])) + blank.get("ruledLines", 5) * 3
             + (20 if window is None else 0))
    return {"variant": variant, "pass": not reasons, "reasons": reasons, "score": round(score, 2),
            "shiftPx": round(shift, 3), "hubY": [round(ly, 2), round(ry, 2)],
            "spacingPx": round(spacing, 2), "labelRectPx": label, "windowRectPx": window,
            "blankness": blank}


def main():
    global DIR
    args = sys.argv[1:]
    if args[:1] == ["--dir"]:
        DIR = Path(args[1]).resolve()
        args = args[2:]
    ref = cv2.imread(str(REF))
    if args[:1] == ["--screen"]:
        for f in args[1:]:
            print(json.dumps(screen(Path(f).stem, cv2.imread(f), ref)))
        return
    keepers = DIR / "keepers.json"
    if args:
        picks = dict(a.split("=") for a in args)
    elif keepers.exists():
        picks = {k: v["candidate"] for k, v in json.loads(keepers.read_text()).items()}
    else:
        picks = {"black_shell": "2", "clear_shell": "1"}
    result = {
        "frame": {"w": W, "h": H},
        "units": "px in the 1672x941 frame, origin top-left, y down; *Norm = 0..1 of w/h; rects [x, y, w, h]",
        "expected": {
            "cassetteRectPx": list(CASSETTE), "pxPerMm": round(K, 4),
            "hubSpacingPx": round(EXP_SPACING, 2), "hubRadiusPx": round(EXP_HUB_R, 2),
            "fullPackRadiusPx": round(EXP_PACK_R, 2),
            "hubCentresPx": [[round(x, 2), y] for x, y in EXP_HUBS],
            "hubCentresNorm": [norm_pt(p) for p in EXP_HUBS],
            "screenHubY": SCREEN_HUB_Y, "screenSpacingPx": SCREEN_SPACING,
        },
        "reference": measure("reference", ref, ref, is_ref=True),
    }
    for variant, n in picks.items():
        img = cv2.imread(str(DIR / f"{variant}_candidate{n}.png"))
        r = measure(variant, img, ref)
        r["keeper"] = f"{variant}_candidate{n}.png"
        result[variant] = r
    (DIR / "measurements.json").write_text(json.dumps(result, indent=2))
    print(json.dumps({k: {"hubs": [h["centre"] for h in v["hubs"]], "ring": [h["ringOuterRadius"] for h in v["hubs"]],
                          "spacing": v["hubSpacingPx"], "label": v["labelRectPx"], "window": v["windowRectPx"]}
                      for k, v in result.items() if isinstance(v, dict) and "hubs" in v}, indent=1))


if __name__ == "__main__":
    main()
