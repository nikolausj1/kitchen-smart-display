"""Rasterise the label SVGs into finished label-paper decals for the cassette.

Run with the system python3 (needs Pillow, numpy and rsvg-convert on PATH):
    python3 scripts/mixtape/make_label_decals.py

For every brand x style (printed, blank) writes
    art-src/mixtape/textures/labels/<brand>_<style>_strip.png   top strip, 87 x 17.6 mm
and for every brand
    art-src/mixtape/textures/labels/<brand>_band.png            plain band below the window

Pipeline per strip: rsvg-convert the 88 x 17.6 mm SVG at 40 px/mm (1:1 with the strip,
see label_layout.py), crop the 0.5 mm bleed off each side to the 87 mm strip,
multiply in the brand's paper grain, then overlay wear: grime (multiply),
foxing (multiply) and scuffs (lighten towards bare paper). The band is the SVG
background colour through the same paper and wear. Deterministic (fixed tile offsets
per brand).
"""

import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import label_layout as LL  # noqa: E402

TEX = os.path.join(LL.ART, "textures")


def load(rel):
    return np.asarray(Image.open(os.path.join(TEX, rel)).convert("RGB"), dtype=np.float32) / 255.0


def tile(img, w, h, tile_px, off):
    """Tile a square texture to w x h with each tile tile_px wide, offset (ox, oy)."""
    t = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((tile_px, tile_px), Image.LANCZOS),
                   dtype=np.float32) / 255.0
    ys = (np.arange(h) + off[1]) % tile_px
    xs = (np.arange(w) + off[0]) % tile_px
    return t[ys][:, xs]


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def rasterise(svg, width, height):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        out = f.name
    subprocess.run(["rsvg-convert", "-w", str(width), "-h", str(height), svg, "-o", out], check=True)
    im = np.asarray(Image.open(out).convert("RGB"), dtype=np.float32) / 255.0
    os.unlink(out)
    return im


def weather(rgb, brand, seed):
    """Paper grain and wear on an RGB float image (0..1)."""
    h, w = rgb.shape[:2]
    look = LL.LOOK[brand]
    wear = look["wear"]
    tpx = int(40 * LL.PX_PER_MM)  # one texture tile per 40 mm of label
    paper = tile(load("paper/%s.png" % look["paper"]), w, h, tpx, (seed * 131, seed * 71))
    g = lum(paper)
    grain = 1.0 + 0.9 * (g / g.mean() - 1.0)
    out = rgb * grain[..., None]
    grime = lum(tile(load("wear/grime-fingerprint-mask.png"), w, h, tpx, (seed * 53, seed * 29)))
    out *= (1.0 - 0.22 * wear * grime)[..., None]
    fox = lum(tile(load("wear/foxing-stain-mask.png"), w, h, tpx, (seed * 17, seed * 97)))
    fox_tint = np.array([0.93, 0.86, 0.72], dtype=np.float32)
    k = (np.clip(1.0 - fox, 0, 1) * (0.6 * wear))[..., None]
    out = out * (1 - k) + out * fox_tint * k
    scuff = lum(tile(load("wear/scuff-scratch-mask.png"), w, h, tpx, (seed * 211, seed * 7)))
    bare = np.array([0.90, 0.88, 0.82], dtype=np.float32)  # exposed paper fibre
    s = (np.clip(scuff, 0, 1) * 0.55 * wear)[..., None]
    out = out * (1 - s) + bare * s
    return np.clip(out, 0, 1)


def save(a, path):
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path, optimize=True)


def main():
    os.makedirs(LL.LABEL_TEX, exist_ok=True)
    sw, sh = LL.STRIP_PX
    for bi, brand in enumerate(LL.BRANDS):
        for style in LL.STYLES:
            art = rasterise(LL.svg_path(brand, style), LL.SVG_RASTER_W, sh)
            assert art.shape[0] == sh, "SVG raster height %d != strip %d" % (art.shape[0], sh)
            canvas = art[:, LL.CROP_X0:LL.CROP_X0 + sw]
            out = weather(canvas, brand, bi + 1)
            p = LL.strip_png(brand, style)
            save(out, p)
            print("strip", p, out.shape[1], "x", out.shape[0])
        bg = LL.hex_rgb(LL.read_svg(brand, "printed")["background"])
        bw, bh = LL.BAND_PX
        band = np.ones((bh, bw, 3), dtype=np.float32) * np.array(bg, dtype=np.float32)
        out = weather(band, brand, bi + 11)
        save(out, LL.band_png(brand))
        print("band ", LL.band_png(brand), bw, "x", bh)
    print("svg scale %.4f (1:1), svg %.1f mm wide, %.2f mm bleed per side cropped, %.1f px/mm"
          % (LL.SVG_SCALE, LL.SVG_W_MM, LL.BLEED_MM, LL.PX_PER_MM))


if __name__ == "__main__":
    main()
