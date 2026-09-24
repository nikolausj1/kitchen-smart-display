#!/usr/bin/env python3
"""Generate Mixtape tape variants in place on the Horizon HX-7 reference photo.

Work package H: a masked image edit (OpenAI /v1/images/edits, gpt-image-1)
replaces only the cassette inside the deck well, keeping the camera, the smoked
door and the warm light. The label is left blank (the app prints it) and the
hubs / packs are later measured and cut into sprites (measure_tape_variants.py).

Usage:
    set -a; source ~/.secrets/api-keys.env; set +a
    python3 scripts/mixtape/gen_tape_variants.py                  # all variants, 2 candidates each
    python3 scripts/mixtape/gen_tape_variants.py --only black_shell --n 1
    python3 scripts/mixtape/gen_tape_variants.py --force          # overwrite existing candidates

Reads OPENAI_API_KEY from the environment (never printed). Writes
art-src/mixtape/tapes/test/<variant>_candidate<n>.png (full 1672x941 frame) and
merges prompt / usage into art-src/mixtape/tapes/test/prompts.json.

Geometry: the API only accepts 1536x1024 / 1024x1536 / 1024x1024, and the frame is
1672x941 (16:9). To avoid a non-uniform squash we send a 3:2 crop of the real
photo centred on the cassette (1411x941), then scale the 1536x1024 result back
by exactly 1411/1536 and drop it into the frame at the same offset. Pixels
outside the crop are the untouched reference.
"""

import argparse
import base64
import io
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
REF = ROOT / "art-src" / "mixtape" / "reference" / "horizon_deck_reference.png"
OUT = ROOT / "art-src" / "mixtape" / "tapes" / "test"
API = "https://api.openai.com/v1/images/edits"
MODEL = os.environ.get("MIXTAPE_IMAGE_MODEL", "gpt-image-1")

W, H = 1672, 941
CASSETTE = (498, 1170, 150, 577)  # x0, x1, y0, y1 (poc_projection.py)
MASK_PAD = 4
OUT_SIZE = (1536, 1024)
CROP_W, CROP_H = 1411, 941  # 3:2, full height
CAS_CX = (CASSETTE[0] + CASSETTE[1]) // 2  # 834
CROP_X0 = CAS_CX - CROP_W // 2  # 129
CROP_Y0 = 0

GEOMETRY = (
    "Edit ONLY the cassette tape inside the transparent masked area; everything else in the"
    " picture stays pixel-identical. Same camera, same straight-on orthographic viewpoint,"
    " same position, same size: the new cassette exactly fills the same rectangle as the"
    " original cassette, its outer shell edges exactly where the old shell edges were, fully"
    " seated in the deck's cassette well, not tilted, not rotated, not lifted. A standard"
    " compact audio cassette, 100 x 64 mm proportions. The label covers the full upper face;"
    " the tape window is a horizontal slot through the middle of the label, and the two"
    " round hubs sit in the window on the cassette's horizontal centre line, symmetric about"
    " the vertical centre line, the same spacing and size as in the original. Brown tape"
    " packs wound around both hubs, roughly half and half. Keep the dark smoked glass door in"
    " front of the tape with its faint reflections, and the same warm amber glow and lighting."
    " ABSOLUTELY NO text, no letters, no numbers, no words, no lettering, no logo, no 'A' side"
    " marking, no brand name, no printing, no artwork, no picture anywhere on the label or the"
    " shell: the label is completely blank paper (the app prints on it later)."
)

VARIANTS = [
    {
        "id": "black_shell",
        "prompt": (
            "Replace the cassette with a black opaque cassette: matte black injection-moulded"
            " plastic shell with subtle fine texture. A full-face cream matte paper label: a"
            " plain empty square art area at the left of the label (blank cream paper, just a"
            " thin faint border), three blank thin ruled lines at the right of the label for"
            " handwriting, and the window cut through the middle showing brown tape packs and"
            " light grey plastic hubs with their teeth. " + GEOMETRY
        ),
    },
    {
        "id": "clear_shell",
        "prompt": (
            "Replace the cassette with a smoke-clear transparent cassette: a tinted see-through"
            " grey plastic shell where the internal tape path, the small guide rollers and the"
            " screws are visible through the plastic below and around the label. A full-face"
            " bright white matte paper label: a plain empty square art area at the left of the"
            " label (blank white paper, just a thin faint border), three blank thin ruled lines"
            " at the right of the label for handwriting, and the window cut through the middle"
            " showing brown tape packs and light grey plastic hubs with their teeth. " + GEOMETRY
        ),
    },
]


def build_inputs():
    ref = Image.open(REF).convert("RGBA")
    assert ref.size == (W, H), ref.size
    crop = ref.crop((CROP_X0, CROP_Y0, CROP_X0 + CROP_W, CROP_Y0 + CROP_H))
    mask = np.full((CROP_H, CROP_W, 4), 255, np.uint8)
    x0 = CASSETTE[0] - MASK_PAD - CROP_X0
    x1 = CASSETTE[1] + MASK_PAD - CROP_X0
    y0 = CASSETTE[2] - MASK_PAD - CROP_Y0
    y1 = CASSETTE[3] + MASK_PAD - CROP_Y0
    mask[y0:y1 + 1, x0:x1 + 1, 3] = 0  # transparent = edit here
    mask_img = Image.fromarray(mask, "RGBA")

    def png(img):
        b = io.BytesIO()
        img.save(b, "PNG")
        return b.getvalue()

    return ref, png(crop), png(mask_img)


def call_edit(key, image_png, mask_png, prompt):
    files = {
        "image": ("image.png", image_png, "image/png"),
        "mask": ("mask.png", mask_png, "image/png"),
    }
    data = {
        "model": MODEL,
        "prompt": prompt,
        "size": f"{OUT_SIZE[0]}x{OUT_SIZE[1]}",
        "quality": "high",
        "input_fidelity": "high",
        "n": "1",
    }
    for attempt in range(3):
        r = requests.post(API, headers={"Authorization": f"Bearer {key}"},
                          files=files, data=data, timeout=600)
        if r.status_code == 200:
            return r.json()
        print(f"  HTTP {r.status_code}: {r.text[:400]}", file=sys.stderr)
        if r.status_code in (429, 500, 502, 503):
            time.sleep(10 * (attempt + 1))
            continue
        break
    raise SystemExit("edit request failed")


def to_frame(ref, b64):
    out = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
    assert out.size == OUT_SIZE, out.size
    out = out.resize((CROP_W, CROP_H), Image.LANCZOS)
    frame = ref.copy()
    frame.paste(out, (CROP_X0, CROP_Y0))
    return frame.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--n", type=int, default=2, help="candidates per variant")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise SystemExit("OPENAI_API_KEY not set")
    OUT.mkdir(parents=True, exist_ok=True)
    log_path = OUT / "prompts.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {}

    ref, image_png, mask_png = build_inputs()
    (OUT / "_mask_sent.png").write_bytes(mask_png)

    for spec in VARIANTS:
        if args.only and spec["id"] not in args.only:
            continue
        for n in range(1, args.n + 1):
            dst = OUT / f"{spec['id']}_candidate{n}.png"
            if dst.exists() and not args.force:
                print(f"skip {dst.name}")
                continue
            print(f"generating {dst.name} ...", flush=True)
            t0 = time.time()
            res = call_edit(key, image_png, mask_png, spec["prompt"])
            to_frame(ref, res["data"][0]["b64_json"]).save(dst)
            log[dst.name] = {
                "variant": spec["id"], "model": MODEL, "size": data_size(),
                "crop": [CROP_X0, CROP_Y0, CROP_W, CROP_H], "mask_pad": MASK_PAD,
                "prompt": spec["prompt"], "usage": res.get("usage"),
                "seconds": round(time.time() - t0, 1),
            }
            print(f"  done in {log[dst.name]['seconds']} s, usage {res.get('usage')}")
            log_path.write_text(json.dumps(log, indent=2))


def data_size():
    return f"{OUT_SIZE[0]}x{OUT_SIZE[1]}"


if __name__ == "__main__":
    main()
