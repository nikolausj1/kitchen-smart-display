#!/usr/bin/env python3
"""Mixtape work package G: the static deck plate with an EMPTY well, plus the door
split into its own glass and frame layers, all at 3840x2160.

Stages (run in order; each is reproducible and reads only files on disk):

  edit     OpenAI Images EDIT (gpt-image-1) removes the cassette from the well.
           Needs OPENAI_API_KEY in the environment:
               set -a; source ~/.secrets/api-keys.env; set +a
               python3 scripts/mixtape/gen_deck_plate.py edit
           The request is a 840x560 crop around the well scaled to 1536x1024
           (same 3:2 aspect, so nothing is distorted and the model sees the well at
           1.83x), with a mask that is transparent over the cassette rect plus a
           6 px margin. N candidates come back in one call; each is scaled back,
           scored for registration outside the mask, and feathered back into the
           untouched reference. Writes plates/candidates/cand_<i>_raw.png (the
           model's 1536x1024 output), cand_<i>.png (1672x941 composite) and
           candidates.json (prompt, usage, registration numbers).
  finish   --pick <i>: builds deck_empty.png from that candidate, the door layers
           door_glass.png / door_frame.png (1672x941), upscales all three with
           upscale_vtsr.swift + Lanczos to 3840x2160 (*_4k.png), and writes
           plate-manifest.json with every rect normalised to 0..1.

Outputs: art-src/mixtape/plates/ (art-src is gitignored).
Needs Pillow, numpy, requests; `finish` needs swiftc (macOS 26 for VideoToolbox SR).
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "art-src" / "mixtape" / "reference" / "horizon_deck_reference.png"
OUT = ROOT / "art-src" / "mixtape" / "plates"
CAND = OUT / "candidates"
VTSR_SRC = ROOT / "scripts" / "mixtape" / "upscale_vtsr.swift"
VTSR_BIN = Path("/tmp/vtsr")

# Ground truth rects from poc_projection.py (x0, x1, y0, y1 in 1672x941 pixels).
sys.path.insert(0, str(ROOT / "scripts" / "mixtape"))
from poc_projection import (  # noqa: E402  (plain constants, no bpy needed at import)
    W, H, WELL_HOLE, CASSETTE, DOOR, DOOR_OPAQUE, DOOR_HINGE_Y, KEY_HOLE, KEY_CAP,
)

TARGET = (3840, 2160)

# Edit crop: 3:2 box centred on the well, scaled 1536/840 = 1.829x for the API.
CROP = (415, 103, 1255, 663)  # left, top, right, bottom
API_SIZE = (1536, 1024)
MARGIN = 6
# Mask rect (x0, x1, y0, y1): cassette plus margin, bottom clipped at the door's
# opaque bottom bar (y 578) so the bar is never repainted.
MASK_RECT = (CASSETTE[0] - MARGIN, CASSETTE[1] + MARGIN, CASSETTE[2] - MARGIN, 578)
FEATHER = 6

MODEL = "gpt-image-1"
PROMPT = (
    "Photograph of a vintage silver front-loading stereo cassette deck, straight-on. "
    "Fill ONLY the transparent masked area: it is the inside of the cassette well, "
    "seen through the smoked tinted glass of the closed cassette door, and the well is "
    "EMPTY, there is no cassette in it. Show what a real empty cassette compartment "
    "looks like: a dark matte black cavity, the back wall of the tape transport; two "
    "round metal reel spindles (capstan hubs with small drive teeth) standing out of "
    "the back wall at the height and spacing where a cassette's two reel hubs would "
    "sit; near the bottom edge the tape transport with the chrome capstan pin and the "
    "black rubber pressure roller, and the silver playback head block with its small "
    "rectangular head in the middle of the bottom; small screws and dark metal "
    "brackets at the sides. Same warm amber lighting and the same soft glass "
    "reflections and smoky darkening as the rest of the photo, subtle depth, "
    "photorealistic, sharp, matching the original camera. No cassette, no tape, no "
    "label, no text, no letters, no logos. Do not change anything outside the mask."
)

# Key caps measured from the reference (x0, x1, y0, y1). PLAY is KEY_CAP.
KEY_CAPS = {
    "rew": (327, 473, 763, 858),
    "play": KEY_CAP,
    "ff": (748, 917, 763, 858),
    "stop": (973, 1133, 763, 858),
    "pause": (1190, 1343, 763, 857),
}
# VU meter faces: the lit amber card inside the black bezel, below the LEFT /
# RIGHT title strip, down to the bottom of the hub dome.
VU_FACES = {
    "left": (73, 400, 190, 372),
    "right": (1272, 1598, 190, 372),
}
# Needle pivots: circle through three points of each scale arc (the -20 corner,
# the 0 tick, the +6 end), radius ~232 px. The true pivot sits BELOW the face,
# hidden by the hub dome, as on a real meter; the dome centre is given too.
VU_PIVOTS = {
    "left": (246, 499),
    "right": (1433, 498),
}
VU_ARC_RADIUS = 232
VU_HUBS = {
    "left": (242, 370),
    "right": (1430, 370),
}


# --------------------------------------------------------------------------- utils

def load_ref():
    return Image.open(REF).convert("RGB")


def mask_full(soft=False):
    """Float mask 0..1 over the full frame, 1 = repaint area."""
    m = np.zeros((H, W), np.float32)
    x0, x1, y0, y1 = MASK_RECT
    m[y0:y1, x0:x1] = 1.0
    if soft:
        im = Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FEATHER / 2))
        m = np.asarray(im, np.float32) / 255.0
        # keep the core fully replaced; the feather only extends outward
        m[y0:y1, x0:x1] = 1.0
        m[578:, :] = np.minimum(m[578:, :], 0.0)  # never touch the bottom bar
    return m


def api_inputs(ref):
    crop = ref.crop(CROP).resize(API_SIZE, Image.LANCZOS)
    sx = API_SIZE[0] / (CROP[2] - CROP[0])
    sy = API_SIZE[1] / (CROP[3] - CROP[1])
    x0, x1, y0, y1 = MASK_RECT
    alpha = np.full((API_SIZE[1], API_SIZE[0]), 255, np.uint8)
    ax0, ax1 = int((x0 - CROP[0]) * sx), int(np.ceil((x1 - CROP[0]) * sx))
    ay0, ay1 = int((y0 - CROP[1]) * sy), int(np.ceil((y1 - CROP[1]) * sy))
    alpha[ay0:ay1, ax0:ax1] = 0
    rgba = np.dstack([np.asarray(crop), alpha])
    return crop, Image.fromarray(rgba, "RGBA")


def back_to_full(ref, api_img):
    """Scale an API-sized image back into its crop box on a copy of the reference."""
    full = ref.copy()
    small = api_img.convert("RGB").resize((CROP[2] - CROP[0], CROP[3] - CROP[1]), Image.LANCZOS)
    full.paste(small, CROP[:2])
    return full


def mad_outside(a, b):
    """Mean absolute difference (0..255 levels) inside the crop box, outside the mask."""
    a = np.asarray(a, np.float32)
    b = np.asarray(b, np.float32)
    sel = np.zeros((H, W), bool)
    sel[CROP[1]:CROP[3], CROP[0]:CROP[2]] = True
    x0, x1, y0, y1 = MASK_RECT
    sel[y0 - 3:y1 + 3, x0 - 3:x1 + 3] = False
    return float(np.abs(a - b)[sel].mean())


def composite(ref, full_edit):
    m = mask_full(soft=True)[..., None]
    out = np.asarray(ref, np.float32) * (1 - m) + np.asarray(full_edit, np.float32) * m
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))


# --------------------------------------------------------------------------- edit

def stage_edit(n):
    import requests

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY is not set")
    CAND.mkdir(parents=True, exist_ok=True)
    ref = load_ref()
    crop, masked = api_inputs(ref)
    ib, mb = io.BytesIO(), io.BytesIO()
    crop.save(ib, "PNG")
    masked.save(mb, "PNG")
    masked.save(CAND / "api_mask.png")
    crop.save(CAND / "api_input.png")

    t = time.time()
    r = requests.post(
        "https://api.openai.com/v1/images/edits",
        headers={"Authorization": f"Bearer {key}"},
        files={
            "image": ("image.png", ib.getvalue(), "image/png"),
            "mask": ("mask.png", mb.getvalue(), "image/png"),
        },
        data={
            "model": MODEL,
            "prompt": PROMPT,
            "n": str(n),
            "size": f"{API_SIZE[0]}x{API_SIZE[1]}",
            "quality": "high",
            "input_fidelity": "high",
        },
        timeout=600,
    )
    if r.status_code != 200:
        sys.exit(f"API error {r.status_code}: {r.text[:500]}")
    body = r.json()
    print(f"edit returned {len(body['data'])} images in {time.time() - t:.0f}s")

    # Baseline: what the crop-resize round trip alone costs outside the mask.
    baseline = mad_outside(ref, back_to_full(ref, crop))
    report = {
        "model": MODEL, "prompt": PROMPT, "crop": CROP, "api_size": API_SIZE,
        "mask_rect_x0x1y0y1": MASK_RECT, "feather_px": FEATHER,
        "usage": body.get("usage"), "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "roundtrip_mad_baseline": round(baseline, 3), "candidates": [],
    }
    for i, d in enumerate(body["data"], 1):
        raw = Image.open(io.BytesIO(base64.b64decode(d["b64_json"])))
        raw.save(CAND / f"cand_{i}_raw.png")
        full = back_to_full(ref, raw)
        mad = mad_outside(ref, full)
        comp = composite(ref, full)
        comp.save(CAND / f"cand_{i}.png")
        report["candidates"].append({"i": i, "mad_outside_mask": round(mad, 3)})
        print(f"cand {i}: MAD outside mask {mad:.2f} levels (round-trip baseline {baseline:.2f})")
    (CAND / "candidates.json").write_text(json.dumps(report, indent=2) + "\n")
    print("usage:", body.get("usage"))


# --------------------------------------------------------------------------- door

def rect_mask(rects, shape=(H, W)):
    m = np.zeros(shape, bool)
    for x0, x1, y0, y1 in rects:
        m[y0:y1, x0:x1] = True
    return m


def door_layers(ref):
    arr = np.asarray(ref, np.float32)
    opaque = rect_mask(DOOR_OPAQUE)
    door = rect_mask([DOOR])
    glass = door & ~opaque

    # Frame: opaque parts cut from the reference.
    frame = np.dstack([arr, opaque * 255.0]).astype(np.uint8)

    # Glass reflections. A straight high-pass of the glass region keeps the tape
    # (the white label is the strongest high-frequency content there), so the
    # streaks are estimated from the brushed faceplate right above and below the
    # well instead: the photo's lights paint vertical bright bands across the metal
    # (peaks near x 660, 960, 1100) and the glass sits in the same light. Column
    # luminance profiles are taken just above the well (y 100..108) and just below
    # it (y 660..675), high-passed along x (minus a wide blur), and interpolated
    # down the door, so the bands keep the slight slant they have on the metal.
    lum = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]

    def hp_profile(y0, y1):
        prof = np.median(lum[y0:y1], axis=0)
        k = np.exp(-0.5 * (np.arange(-240, 241) / 80.0) ** 2)
        k /= k.sum()
        pad = np.pad(prof, 240, mode="edge")
        low = np.convolve(pad, k, mode="same")[240:-240]
        return np.clip(prof - low, 0, None)

    top, bot = hp_profile(100, 108), hp_profile(660, 675)
    t = np.clip((np.arange(H) - 104) / (667 - 104), 0, 1)[:, None]
    hp = top[None, :] * (1 - t) + bot[None, :] * t
    hp = np.clip(hp / 60.0, 0, 1)  # ~60 levels above the local mean = full streak
    # a soft diagonal fade so the glass is brighter at the top, like the photo
    yy = (np.arange(H)[:, None] - DOOR[2]) / (DOOR[3] - DOOR[2])
    hp = hp * (1.0 - 0.45 * np.clip(yy, 0, 1))
    tint = 0.25                    # 25% black smoke
    streak_op = 0.20 * hp          # reflections at low opacity, warm white
    # Composite "white streak over black tint" into one straight-alpha RGBA:
    a = tint + streak_op * (1 - tint)
    rgb_val = np.where(a > 0, (streak_op * 255.0) / np.maximum(a, 1e-6), 0)
    # warm the white a touch to match the lamp-lit glass
    rgb = np.dstack([rgb_val, rgb_val * 0.96, rgb_val * 0.88])
    alpha = np.where(glass, a, 0.0)
    rgb = np.where(glass[..., None], rgb, 0.0)
    glass_img = np.dstack([rgb, alpha * 255.0])
    return (Image.fromarray(np.clip(glass_img + 0.5, 0, 255).astype(np.uint8), "RGBA"),
            Image.fromarray(frame, "RGBA"))


# --------------------------------------------------------------------------- upscale

def ensure_vtsr():
    if not VTSR_BIN.exists() or VTSR_BIN.stat().st_mtime < VTSR_SRC.stat().st_mtime:
        subprocess.run(["swiftc", "-O", str(VTSR_SRC), "-o", str(VTSR_BIN)], check=True)


def vtsr(img_rgb, tmpdir):
    """4x VideoToolbox SR of an RGB image, then Lanczos to exactly 3840x2160.
    1672x941 x4 = 6688x3764; 3764 * 3840/6688 = 2161.1, so resize to 3840x2162
    (same scale both axes) and drop one row top and bottom."""
    src, dst = tmpdir / "sr_in.png", tmpdir / "sr_out.png"
    img_rgb.convert("RGB").save(src)
    subprocess.run([str(VTSR_BIN), str(src), str(dst)], check=True)
    up = Image.open(dst).convert("RGB")
    return fit_4k(up)


def fit_4k(img, resample=Image.LANCZOS):
    w, h = img.size
    nh = round(h * TARGET[0] / w)
    r = img.resize((TARGET[0], nh), resample)
    extra = nh - TARGET[1]
    top = extra // 2  # 1 extra row here, so top = 0 (see PLATE_TOP)
    return r.crop((0, top, TARGET[0], top + TARGET[1]))


def upscale_rgba(img, tmpdir):
    """The SR tool writes RGBA8 but renders from a CIImage of the RGB buffer, so
    alpha is not carried. RGB and alpha go through the SR pass separately (alpha
    as a grey image, then its red channel) and are recombined."""
    rgb = vtsr(img.convert("RGB"), tmpdir)
    a = img.getchannel("A")
    a_up = vtsr(Image.merge("RGB", (a, a, a)), tmpdir).getchannel("R")
    out = rgb.copy()
    out.putalpha(a_up)
    return out


# --------------------------------------------------------------------------- manifest

# Source pixel -> 4k plate: uniform scale 3840/1672 on both axes, then fit_4k
# crops the extra rows (941 * 3840/1672 = 2161.2 -> 2161, one row dropped at the
# bottom, none at the top: a single odd row cannot be split symmetrically).
PLATE_SCALE = TARGET[0] / W
PLATE_TOP = 0


def _nx(x):
    return round(x * PLATE_SCALE / TARGET[0], 5)


def _ny(y):
    return round((y * PLATE_SCALE - PLATE_TOP) / TARGET[1], 5)


def norm_rect(r):
    x0, x1, y0, y1 = r
    return {"x": _nx(x0), "y": _ny(y0), "w": _nx(x1 - x0),
            "h": round((y1 - y0) * PLATE_SCALE / TARGET[1], 5)}


def norm_pt(p):
    return {"x": _nx(p[0]), "y": _ny(p[1])}


def write_manifest(pick):
    man = {
        "source": "art-src/mixtape/reference/horizon_deck_reference.png",
        "source_size": [W, H],
        "plate_size": list(TARGET),
        "units": "normalised 0..1 of the plate (x right, y down); rects are x, y, w, h",
        "plates": {
            "deck_empty": "deck_empty_4k.png",
            "door_frame": "door_frame_4k.png",
            "door_glass": "door_glass_4k.png",
        },
        "empty_well_candidate": pick,
        "well": norm_rect(WELL_HOLE),
        "cassette_seat": norm_rect(CASSETTE),
        "door": norm_rect(DOOR),
        "door_opaque_parts": [norm_rect(r) for r in DOOR_OPAQUE],
        "door_hinge_y": _ny(DOOR_HINGE_Y),
        "play_key_hole": norm_rect(KEY_HOLE),
        "key_caps": {k: norm_rect(v) for k, v in KEY_CAPS.items()},
        "vu_faces": {k: norm_rect(v) for k, v in VU_FACES.items()},
        "vu_needle_pivots": {k: norm_pt(v) for k, v in VU_PIVOTS.items()},
        "vu_arc_radius_h": round(VU_ARC_RADIUS * PLATE_SCALE / TARGET[1], 5),
        "vu_hub_domes": {k: norm_pt(v) for k, v in VU_HUBS.items()},
        "notes": [
            "deck_empty keeps the door's frame and smoke baked in, as the photo saw it.",
            "door_frame / door_glass redraw the door over a tape; over the empty well the "
            "glass would tint twice, so draw them only when a tape is shown or the door moves.",
            "VU pivots are the scale-arc centres, below the faces (hidden by the hub dome); "
            "draw the needle from the pivot and clip it to the face.",
        ],
    }
    (OUT / "plate-manifest.json").write_text(json.dumps(man, indent=2) + "\n")


# --------------------------------------------------------------------------- finish

def stage_finish(pick):
    ref = load_ref()
    cand = CAND / f"cand_{pick}.png"
    if not cand.exists():
        sys.exit(f"missing {cand}; run the edit stage first")
    deck = Image.open(cand).convert("RGB")
    # Outside the feathered mask the composite must be byte-identical to the reference.
    m = mask_full(soft=True) > 0
    same = np.array_equal(np.asarray(deck)[~m], np.asarray(ref)[~m])
    print(f"outside feathered mask identical to reference: {same}")
    deck.save(OUT / "deck_empty.png")

    glass, frame = door_layers(ref)
    glass.save(OUT / "door_glass.png")
    frame.save(OUT / "door_frame.png")

    ensure_vtsr()
    tmp = OUT / ".tmp"
    tmp.mkdir(exist_ok=True)
    vtsr(deck, tmp).save(OUT / "deck_empty_4k.png")
    upscale_rgba(frame, tmp).save(OUT / "door_frame_4k.png")
    upscale_rgba(glass, tmp).save(OUT / "door_glass_4k.png")
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    write_manifest(pick)
    for n in ("deck_empty_4k.png", "door_frame_4k.png", "door_glass_4k.png"):
        im = Image.open(OUT / n)
        print(n, im.size, im.mode)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="stage", required=True)
    e = sub.add_parser("edit")
    e.add_argument("-n", type=int, default=3)
    f = sub.add_parser("finish")
    f.add_argument("--pick", type=int, required=True)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.stage == "edit":
        stage_edit(args.n)
    else:
        stage_finish(args.pick)


if __name__ == "__main__":
    main()
