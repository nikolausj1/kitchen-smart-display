#!/usr/bin/env python3
"""Generate Mixtape surface textures with the OpenAI Images API.

Surfaces only: no lettering, logos or brand names (those are hand-made).

Usage:
    set -a; source ~/.secrets/api-keys.env; set +a
    python3 scripts/mixtape/gen_textures.py                 # generate missing files
    python3 scripts/mixtape/gen_textures.py --only paper/cream-clean wear/scuff-mask
    python3 scripts/mixtape/gen_textures.py --force          # regenerate everything

Reads OPENAI_API_KEY from the environment. Writes PNGs under
art-src/mixtape/textures/<category>/<name>.png and merges an entry per file
into art-src/mixtape/textures/prompts.json (prompt, model, size, usage).
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art-src" / "mixtape" / "textures"
API = "https://api.openai.com/v1/images/generations"
MODEL = os.environ.get("MIXTAPE_IMAGE_MODEL", "gpt-image-1")
SIZE = "1024x1024"

# Shared suffix: keeps every swatch flat, even and free of text or objects.
STYLE = (
    " Flat, evenly lit, orthographic top-down view filling the entire frame edge to edge,"
    " seamless tileable texture swatch, photoreal macro material photography, soft diffuse"
    " lighting with no directional shadows, no vignette. Absolutely no text, no letters,"
    " no numbers, no logos, no labels, no brand marks, no objects, no borders, no frame."
)

TEXTURES = {
    # paper
    "paper/cream-clean": "Clean pale off-white cream label paper stock, only a very light warm ivory tint, matte uncoated, visible fine paper fibre grain and subtle tooth, new and unmarked.",
    "paper/aged-yellowed": "Aged yellowed paper label stock from the 1980s, uneven warm yellowing, faint mottling and slight discolouration toward random patches, fine paper fibres, no writing.",
    "paper/glossy-white": "Glossy coated white label paper, smooth bright surface with a faint soft sheen and very fine coating texture, clean.",
    "paper/kraft-brown": "Brown kraft paper, visible natural fibres and flecks, slightly uneven tone, matte.",
    # wear masks
    "wear/scuff-scratch-mask": "Scuff and scratch mask: bright pure white scratches, hairline scuffs, short gouges and small scuffed abrasion patches scattered evenly and randomly over a pure solid black #000000 background, crisp high contrast black and white mask, marks clearly visible and bright.",
    "wear/grime-fingerprint-mask": "Grime and fingerprint mask: clearly visible mid grey and light grey smudges, several partial fingerprint whorls with visible ridges, and soft dirt patches scattered evenly over a pure solid black #000000 background, grayscale mask for texturing.",
    "wear/foxing-stain-mask": "Foxing and stain mask: small brown foxing spots, a few faint tea-coloured water stain rings and soft age blotches distributed evenly across the whole frame, on a uniform plain pure white #FFFFFF background right to the edges, no darkened edges, for use as a multiply overlay.",
    "wear/peeling-edge": "Close-up of a paper label edge lifting and peeling away from a flat smooth surface, the curled paper edge casting a tiny soft shadow, frayed torn fibres, flat solid muted grey background surface, plain blank paper with nothing printed.",
    # plastic
    "plastic/black-scratched": "Macro of black injection-moulded cassette plastic, fine hairline scratches, tiny specks of dust and faint micro swirl marks, slight satin sheen.",
    "plastic/smoked-transparent": "Smoked dark grey transparent tinted acrylic plastic, like a cassette case window, with soft broad glossy reflection streaks and highlights sweeping across it, faint gradient sheen, very fine surface scratches and a little dust.",
    "plastic/white-yellowed": "White plastic that has lightly yellowed with age, subtle uneven cream-yellow tint, fine matte moulded texture, a few faint scuffs.",
    # deck
    "deck/brushed-aluminium-silver": "Brushed aluminium faceplate, silver, fine straight horizontal brushing lines, even satin metallic finish, 1970s hi-fi.",
    "deck/black-anodised-aluminium": "Black anodised aluminium faceplate, fine horizontal brushed grain under the dark anodised finish, subtle satin sheen, 1980s hi-fi.",
    "deck/walnut-veneer": "Dark walnut wood veneer, straight fine grain with subtle figure, oiled satin finish, vintage hi-fi cabinet side panel.",
    "deck/smoked-glass-door": "Dark smoked tinted glass panel, near black with a faint soft diagonal reflection streak and slight gloss, very subtle dust.",
    # pack
    "pack/wound-tape-a": "Tightly wound brown magnetic audio tape seen from directly above, the flat edge of a wound tape reel showing extremely fine concentric spiral lines, glossy chocolate brown oxide tone with subtle ring banding.",
    "pack/wound-tape-b": "Macro top-down view of the edge of a tightly wound reel of dark brown magnetic recording tape, very fine concentric circular layers with a faint spiral, soft satin sheen, slightly uneven layer shading.",
}


def generate(key, name, prompt):
    body = json.dumps({
        "model": MODEL,
        "prompt": prompt + STYLE,
        "size": SIZE,
        "n": 1,
        "quality": "medium",
        "output_format": "png",
    }).encode()
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {msg[:400]}")
    item = data["data"][0]
    if "b64_json" in item:
        png = base64.b64decode(item["b64_json"])
    else:
        with urllib.request.urlopen(item["url"], timeout=120) as r:
            png = r.read()
    path = OUT / f"{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    force_opaque(path)
    return data.get("usage")


def force_opaque(path):
    """Swatches must be opaque. The model sometimes returns near-zero alpha when a
    prompt says 'transparent'; keep the RGB and drop the alpha (needs Pillow)."""
    try:
        from PIL import Image
    except ImportError:
        return
    im = Image.open(path)
    if im.mode == "RGBA" and im.getextrema()[3][0] < 250:
        im.convert("RGB").save(path)
        print(f"  flattened alpha on {path.name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="names like paper/cream-clean")
    ap.add_argument("--force", action="store_true", help="regenerate existing files")
    args = ap.parse_args()

    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        sys.exit("OPENAI_API_KEY is not set")

    names = args.only or list(TEXTURES)
    manifest_path = OUT / "prompts.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for name in names:
        if name not in TEXTURES:
            print(f"skip unknown {name}")
            continue
        path = OUT / f"{name}.png"
        if path.exists() and not (args.force or args.only):
            print(f"exists {name}")
            continue
        t = time.time()
        try:
            usage = generate(key, name, TEXTURES[name])
        except Exception as e:  # report and keep going
            print(f"FAIL {name}: {e}")
            continue
        manifest[f"{name}.png"] = {
            "prompt": TEXTURES[name] + STYLE,
            "model": MODEL,
            "size": SIZE,
            "quality": "medium",
            "usage": usage,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"ok {name} ({time.time() - t:.0f}s) usage={usage}")


if __name__ == "__main__":
    main()
