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
DIR = ROOT / "art-src" / "mixtape" / "tapes" / "test"

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
        hubs.append({
            "houghSeed": [round(float(sx), 1), round(float(sy), 1), round(float(sr), 1)],
            "centre": [round(float(cx), 2), round(float(cy), 2)],
            "boreRadius": None if bore_r is None else round(bore_r, 1),
            "ringPeakRadius": int(rr[peak]),
            "ringOuterRadius": round(float(rr[edge_i]) + 0.5, 1),
        })
    return hubs


def label_and_window(img):
    x0, x1, y0, y1 = CASSETTE
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    sub = hsv[y0:y1, x0:x1]
    paper = ((sub[..., 2] > 150) & (sub[..., 1] < 90)).astype(np.uint8)
    paper = cv2.morphologyEx(paper, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(paper)
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
    label, window = label_and_window(img)
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


def main():
    picks = dict(a.split("=") for a in sys.argv[1:]) or {"black_shell": "2", "clear_shell": "1"}
    ref = cv2.imread(str(REF))
    result = {
        "frame": {"w": W, "h": H},
        "units": "px in the 1672x941 frame, origin top-left, y down; *Norm = 0..1 of w/h; rects [x, y, w, h]",
        "expected": {
            "cassetteRectPx": list(CASSETTE), "pxPerMm": round(K, 4),
            "hubSpacingPx": round(EXP_SPACING, 2), "hubRadiusPx": round(EXP_HUB_R, 2),
            "fullPackRadiusPx": round(EXP_PACK_R, 2),
            "hubCentresPx": [[round(x, 2), y] for x, y in EXP_HUBS],
            "hubCentresNorm": [norm_pt(p) for p in EXP_HUBS],
        },
        "reference": measure("reference", ref, ref, is_ref=True),
    }
    for variant, n in picks.items():
        img = cv2.imread(str(DIR / f"{variant}_candidate{n}.png"))
        r = measure(variant, img, ref)
        r["keeper"] = f"{variant}_candidate{n}.png"
        result[variant] = r
    (DIR / "measurements.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
