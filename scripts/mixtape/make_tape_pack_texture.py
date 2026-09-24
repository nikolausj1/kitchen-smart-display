"""Generate the top-down tape pack texture (brown disc with a faint spiral).

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python scripts/mixtape/make_tape_pack_texture.py

Writes:
    art-src/mixtape/textures/tape_pack.png          (used by build_cassette.py)
    art-src/mixtape/renders/phase0/tape_pack_texture.png

The disc fills the 1024 px square (radius 512 px) and is transparent outside it.
The winding is an Archimedean spiral, not concentric rings, and each wrap gets its
own slight brightness plus a few tangential streaks, so rotation is visible when the
app spins the disc. Deterministic: fixed RNG seed.
"""

import os
import shutil

import bpy
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX_DIR = os.path.join(ROOT, "art-src", "mixtape", "textures")
OUT_DIR = os.path.join(ROOT, "art-src", "mixtape", "renders", "phase0")
SIZE = 1024
TURNS = 70  # spiral wraps from centre to rim (visual density, not physical)
SEED = 1979


def smooth_noise_1d(rng, n, length, smooth):
    """Periodic, smoothed random series of `length` samples (values around 0)."""
    raw = rng.normal(0.0, 1.0, n)
    xs = np.linspace(0, n, length, endpoint=False)
    i0 = np.floor(xs).astype(int) % n
    i1 = (i0 + 1) % n
    t = xs - np.floor(xs)
    t = t * t * (3 - 2 * t)
    out = raw[i0] * (1 - t) + raw[i1] * t
    if smooth > 1:
        k = np.ones(smooth) / smooth
        out = np.convolve(np.concatenate([out[-smooth:], out, out[:smooth]]), k, "same")[smooth:-smooth]
    return out


def build():
    rng = np.random.default_rng(SEED)
    c = (SIZE - 1) / 2.0
    yy, xx = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    dx, dy = xx - c, yy - c
    r_px = np.hypot(dx, dy)
    rn = r_px / (SIZE / 2.0)  # 0 at centre, 1 at rim
    theta = np.arctan2(dy, dx)  # -pi..pi
    tn = (theta + np.pi) / (2 * np.pi)  # 0..1

    # Archimedean spiral phase: constant along one wrap of tape.
    s = rn * TURNS - tn
    wrap = np.floor(s).astype(int)
    frac = s - np.floor(s)

    # Per-wrap brightness (tape layers never sit perfectly even).
    per_wrap = rng.normal(0.0, 1.0, TURNS + 4)
    per_wrap = np.convolve(per_wrap, np.ones(3) / 3, "same")
    layer = per_wrap[np.clip(wrap + 2, 0, TURNS + 3)]

    # Faint dark seam where one wrap meets the next.
    seam = np.exp(-((frac - 0.5) ** 2) / (2 * 0.12**2))
    seam = 1.0 - seam  # 0 in the middle of a wrap, 1 at the seam

    # Tangential streaks: low-frequency noise in angle, varying with radius band.
    ang_n = 720
    streak = np.zeros_like(rn)
    for band in range(6):
        series = smooth_noise_1d(rng, 24, ang_n, 9)
        idx = (tn * ang_n).astype(int) % ang_n
        centre = 0.2 + 0.13 * band
        weight = np.exp(-((rn - centre) ** 2) / (2 * 0.05**2))
        streak += series[idx] * weight

    base = np.array([0.30, 0.17, 0.09])  # sRGB-coded brown (byte image)
    lum = 1.0 + 0.05 * layer - 0.10 * seam + 0.045 * streak
    # Subtle sheen band towards the outer third and darker inner/outer edges.
    lum *= 1.0 + 0.06 * np.exp(-((rn - 0.72) ** 2) / (2 * 0.12**2))
    lum *= 1.0 - 0.18 * np.clip((rn - 0.96) / 0.04, 0, 1)

    rgb = np.clip(base[None, None, :] * lum[..., None], 0, 1)
    alpha = np.clip((SIZE / 2.0 - r_px) + 0.5, 0, 1)  # 1 px antialiased rim

    rgba = np.dstack([rgb, alpha])
    rgba[alpha == 0, :3] = 0
    # Blender pixel rows start at the bottom.
    return np.flipud(rgba).astype(np.float32)


def main():
    os.makedirs(TEX_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    rgba = build()
    img = bpy.data.images.new("tape_pack", SIZE, SIZE, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(rgba.ravel())
    path = os.path.join(TEX_DIR, "tape_pack.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    shutil.copyfile(path, os.path.join(OUT_DIR, "tape_pack_texture.png"))
    print("MIXTAPE wrote", path)


if __name__ == "__main__":
    main()
