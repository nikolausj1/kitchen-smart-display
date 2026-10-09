"""Label print assets for the tvOS Mixtape label renderer (MixtapeLabelRenderer.swift).

Copies the three wear masks and bakes two paper-grain soft-light maps into
tvos/Resources/Mixtape/label/, all at 1024 px. Mirrors round 3
(build_label_concepts_3.py): grain = clip(high-pass of the paper stock, +-0.06) * 1.2,
then the soft-light map b = clip(0.5 + grain * 3), so the app can draw it with
a plain soft-light blend.

    python3 scripts/mixtape/build_label_assets.py
"""

import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "art-src", "mixtape", "textures")
OUT = os.path.join(ROOT, "tvos", "Resources", "Mixtape", "label")
SIZE = 1024
# Round 3 blurred the stock by 10 px after scaling it to cover a ~1400 px label;
# at 1024 px that is about 7.3 px.
BLUR = 7.3


def grain(name, out):
    im = Image.open(os.path.join(TEX, "paper", name)).convert("L").resize((SIZE, SIZE), Image.LANCZOS)
    t = np.asarray(im).astype(np.float32) / 255
    tb = np.asarray(im.filter(ImageFilter.GaussianBlur(BLUR))).astype(np.float32) / 255
    g = np.clip(t - tb, -0.06, 0.06) * 1.2
    b = np.clip(0.5 + g * 3.0, 0, 1)
    Image.fromarray((b * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(OUT, out), optimize=True)


def mask(name, out, mode):
    im = Image.open(os.path.join(TEX, "wear", name)).convert(mode).resize((SIZE, SIZE), Image.LANCZOS)
    im.save(os.path.join(OUT, out), optimize=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    grain("aged-yellowed.png", "grain-aged.png")
    grain("cream-clean.png", "grain-cream.png")
    mask("grime-fingerprint-mask.png", "grime.png", "L")
    mask("scuff-scratch-mask.png", "scuff.png", "L")
    mask("foxing-stain-mask.png", "foxing.png", "RGB")
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == "__main__":
    main()
