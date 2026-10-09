"""Mixtape label concepts, round 3: the label as a printed asset.

Round 3 of build_label_concepts.py / build_label_concepts_2.py. Reuses round 1's
compositor (deck, well, tape sprite, window cavity with brown packs, hubs, closed door
glass and frame) and round 2's helpers. New here is one PRINT TREATMENT applied to
every concept, so art and type read as printed into the label paper, never stuck on:

1. Paper base: the tape's own label paper from the sprite (its grain and tint).
2. Art printed: resampled to its rect, desaturated to 0.9, multiplied over the
   normalised paper at 92% plus a soft-light pass of the paper grain, 1 px soft edge.
   Optional 3 px halftone screen at 6% (off by default; measured in the dot crop).
3. Text as ink: dark ink multiplied into the paper; white ink at 90% with the paper
   grain showing through; 0.4 px blur for ink spread. No shadows anywhere.
4. Ink choice per text block from the luminance behind it (see choose_ink); if no
   ink is readable a printed gradient band fades in from the nearest label edge.
5. Wear over art and ink together (light, medium, heavy), then the door glass.

Run from the project root with the system python3 (Pillow + numpy):

    python3 scripts/mixtape/build_label_concepts_3.py

Output: _review/mockups/mixtape-label-concepts-3/*.jpg (+ ink-log.json) and the page
_review/mockups/mixtape-label-concepts-3.html.
"""

import html
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_label_concepts as r1  # noqa: E402
import build_label_concepts_2 as r2  # noqa: E402
from build_label_concepts import (  # noqa: E402
    CAVEAT, HNEUE, W, H, Ctx, build_base, capsule_box, cover_crop, finish, ir,
    load_manifest, rounded_mask,
)

ROOT = r1.ROOT
OUT = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts-3")
PAGE = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts-3.html")
COVERS = r1.COVERS
TEX = os.path.join(ROOT, "art-src", "mixtape", "textures")
SUP = "/System/Library/Fonts/Supplemental"
AVN = "/System/Library/Fonts/Avenir Next.ttc"
AVC = "/System/Library/Fonts/Avenir Next Condensed.ttc"
BASK = os.path.join(SUP, "Baskerville.ttc")
AMTW = os.path.join(SUP, "AmericanTypewriter.ttc")
FUT = os.path.join(SUP, "Futura.ttc")
DIDOT = os.path.join(SUP, "Didot.ttc")

COVER_INFO = {
    "dark": ("cover_night_city.png", (0.5, 0.42), "dark night city"),
    "bright": ("cover_pale_sky.png", (0.5, 0.5), "bright pale sky"),
    "busy": ("cover_busy_pattern.png", (0.5, 0.5), "busy mid-tone pattern"),
    "warm": ("cover_warm_abstract.png", (0.5, 0.5), "warm abstract"),
}

META = {
    "tdk_sax_printed": {"name": "TDK SA-X, black shell", "short": "black TDK",
                        "song": "Golden Hour", "artist": "Wandering Lights", "album": "Long Way Home"},
    "sony_hf_blank": {"name": "Sony HF, white shell, long names", "short": "white Sony",
                      "song": "A Very Long Song Title That Tests The Label",
                      "artist": "The Unreasonably Named Orchestra", "album": "Long Way Home (Deluxe Edition)"},
}
BLACK, WHITE = "tdk_sax_printed", "sony_hf_blank"

# ------------------------------------------------------------------ typefaces

# (path, index, caps, tracking in em)
STYLES = {
    "grotesk": {"label": "Helvetica Neue Bold / Regular",
                "title": (HNEUE, 1, False, 0), "sub": (HNEUE, 0, False, 0), "album": (HNEUE, 0, False, 0)},
    "condensed": {"label": "Avenir Next Condensed Demi Bold, caps tracked",
                  "title": (AVC, 2, True, 0.06), "sub": (AVC, 5, False, 0.01), "album": (AVC, 5, True, 0.08)},
    "serif": {"label": "Baskerville SemiBold Italic / Regular",
              "title": (BASK, 5, False, 0), "sub": (BASK, 0, False, 0), "album": (BASK, 2, False, 0)},
    "typewriter": {"label": "American Typewriter Semibold / Regular",
                   "title": (AMTW, 3, False, 0), "sub": (AMTW, 0, False, 0), "album": (AMTW, 1, False, 0)},
    "geometric": {"label": "Futura Bold / Medium",
                  "title": (FUT, 2, False, 0), "sub": (FUT, 0, False, 0), "album": (FUT, 0, True, 0.1)},
    "didot": {"label": "Didot Bold / Italic (display)",
              "title": (DIDOT, 2, False, 0), "sub": (DIDOT, 1, False, 0), "album": (DIDOT, 0, True, 0.12)},
    "hand": {"label": "Caveat (handwritten)", "scale": 1.5,
             "title": (CAVEAT, 0, False, 0), "sub": (CAVEAT, 0, False, 0), "album": (CAVEAT, 0, False, 0)},
    "avenir": {"label": "Avenir Next Demi Bold / Regular",
               "title": (AVN, 2, False, 0), "sub": (AVN, 7, False, 0), "album": (AVN, 7, False, 0)},
}

_FONT_CACHE = {}


def fnt(path, idx, size):
    key = (path, idx, int(round(size)))
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(path, max(8, int(round(size))), index=idx)
    return _FONT_CACHE[key]


def cap_ratio(path, idx):
    f = fnt(path, idx, 200)
    return -f.getbbox("H", anchor="ls")[1] / 200


REF_CAP = cap_ratio(HNEUE, 1)


def spec_font(spec, px, style):
    """A size given in Helvetica Neue Bold cap units -> the same cap height in this face."""
    path, idx, _, _ = spec
    if "scale" in STYLES[style]:
        return fnt(path, idx, px * STYLES[style]["scale"])
    return fnt(path, idx, px * REF_CAP / cap_ratio(path, idx))


def tlen(f, text, tr):
    if not tr:
        return f.getlength(text)
    return sum(f.getlength(ch) for ch in text) + tr * f.size * (len(text) - 1)


def ellipsize(text, f, tr, maxw):
    t = text
    while t and tlen(f, t.rstrip() + "…", tr) > maxw:
        t = t[:-1]
    return t.rstrip() + "…"


def fit_lines(text, spec, px, style, maxw, max_lines):
    """One line shrinking to 0.82x; else two balanced lines down to 0.6x; else ellipsis."""
    _, _, caps, tr = spec
    text = text.upper() if caps else text
    s = px
    while s >= px * 0.82:
        f = spec_font(spec, s, style)
        if tlen(f, text, tr) <= maxw:
            return [text], f
        s -= 2
    words = text.split()
    if max_lines >= 2 and len(words) > 1:
        s = px * 0.86
        while s >= px * 0.6:
            f = spec_font(spec, s, style)
            best = None
            for i in range(1, len(words)):
                a, b = " ".join(words[:i]), " ".join(words[i:])
                wm = max(tlen(f, a, tr), tlen(f, b, tr))
                if wm <= maxw and (best is None or wm < best[0]):
                    best = (wm, [a, b])
            if best:
                return best[1], f
            s -= 2
        f = spec_font(spec, px * 0.6, style)
        line1 = []
        for w in words:
            if tlen(f, " ".join(line1 + [w]), tr) > maxw:
                break
            line1.append(w)
        rest = " ".join(words[len(line1):])
        return [" ".join(line1), ellipsize(rest, f, tr, maxw) if tlen(f, rest, tr) > maxw else rest], f
    f = spec_font(spec, px * 0.72, style)
    return [ellipsize(text, f, tr, maxw) if tlen(f, text, tr) > maxw else text], f


def _cap(f):
    return -f.getbbox("H", anchor="ls")[1]


def _desc(f):
    return f.getbbox("gjpqy", anchor="ls")[3]


class Block:
    """A group of lines that share one ink. Coordinates are label-local 4K pixels."""

    def __init__(self, name, lines, box, align="left", valign="center", style="grotesk",
                 title_lines=2, baseline=None, ink=None, min_contrast=None):
        self.name, self.lines, self.box = name, lines, box
        self.align, self.valign, self.style = align, valign, style
        self.title_lines, self.baseline, self.ink = title_lines, baseline, ink
        small = all(r == "album" for _, r, _ in lines)
        self.min_contrast = min_contrast or (4.5 if small else 3.0)
        self.extra = None  # callable(draw, laid) for printed marks sharing the ink

    def layout(self):
        st = STYLES[self.style]
        x0, y0, x1, y1 = self.box
        maxw, maxh = x1 - x0, y1 - y0
        k = 1.0
        hand = self.style == "hand"
        for _ in range(50):
            laid = []
            for i, (text, role, px) in enumerate(self.lines):
                spec = st[role]
                ls, f = fit_lines(text, spec, px * k, self.style, maxw,
                                  self.title_lines if role == "title" else 1)
                for j, t in enumerate(ls):
                    laid.append([t, f, spec[3], role, j > 0])
            base = [_cap(laid[0][1])]
            yb = base[0]
            for cur, prev in zip(laid[1:], laid[:-1]):
                lead = (0.05 if cur[4] else 0.12) if hand else (0.14 if cur[4] else 0.30)
                yb += _desc(prev[1]) * 0.55 + cur[1].size * lead + _cap(cur[1])
                base.append(yb)
            hgt = yb + _desc(laid[-1][1]) * 0.55
            if hgt <= maxh or self.baseline is not None:
                break
            k *= 0.96
        if self.baseline is not None:
            top = self.baseline - base[0]
        elif self.valign == "center":
            top = y0 + (maxh - hgt) / 2
        elif self.valign == "bottom":
            top = y1 - hgt
        else:
            top = y0
        ax = {"left": x0, "right": x1, "center": (x0 + x1) / 2}[self.align]
        self.laid = [(t, f, tr, role, ax, top + b) for (t, f, tr, role, _), b in zip(laid, base)]
        # bounding box of the ink
        bb = None
        for t, f, tr, role, x, yb in self.laid:
            w = tlen(f, t, tr)
            lx = {"left": x, "right": x - w, "center": x - w / 2}[self.align]
            r = (lx, yb - _cap(f) * 1.02, lx + w, yb + max(4, _desc(f) * 0.6))
            bb = r if bb is None else (min(bb[0], r[0]), min(bb[1], r[1]), max(bb[2], r[2]), max(bb[3], r[3]))
        self.bbox = bb
        return self

    def draw(self, d):
        for t, f, tr, role, x, yb in self.laid:
            w = tlen(f, t, tr)
            lx = {"left": x, "right": x - w, "center": x - w / 2}[self.align]
            if not tr:
                d.text((lx, yb), t, font=f, fill=255, anchor="ls")
            else:
                cx = lx
                for ch in t:
                    d.text((cx, yb), ch, font=f, fill=255, anchor="ls")
                    cx += f.getlength(ch) + tr * f.size
        if self.extra:
            self.extra(d, self)

    def caps_1080(self):
        return {role: round(_cap(f) / 2) for _, f, _, role, _, _ in self.laid}


# ------------------------------------------------------------------ colour maths

def srgb_to_lin(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def rel_lum(rgb):
    lin = srgb_to_lin(np.clip(rgb, 0, 1))
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def contrast(la, lb):
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


BUSY_MAX = 0.035  # band-pass local contrast of the art behind a block above which it is busy
DARK_INK = np.array([0.075, 0.07, 0.08])
BALLPOINT = np.array([0.16, 0.22, 0.60])
WHITE_INK_OPACITY = 0.90


def dominant_vivid(cover):
    return np.array(r2.dominant_colour(cover), float) / 255


# ------------------------------------------------------------------ wear masks

_TEX = {}


def tex(name, mode="L"):
    key = (name, mode)
    if key not in _TEX:
        _TEX[key] = Image.open(os.path.join(TEX, name)).convert(mode)
    return _TEX[key]


def tex_region(name, w, h, seed, mode="L", scale=1.45, rot=0):
    im = tex(name, mode)
    if rot:
        im = im.rotate(rot, Image.BICUBIC, expand=False)
    s = max(w / im.width, h / im.height) * scale
    big = im.resize((int(im.width * s) + 2, int(im.height * s) + 2), Image.LANCZOS)
    rng = np.random.RandomState(seed)
    ox = rng.randint(0, max(1, big.width - w))
    oy = rng.randint(0, max(1, big.height - h))
    a = np.asarray(big.crop((ox, oy, ox + w, oy + h))).astype(np.float32) / 255
    return a


# ------------------------------------------------------------------ the label

class Label:
    """One label face, composited in label-local float RGB, then put back on the deck."""

    def __init__(self, ctx, cover_key=None, wear="light", printed=True, dot=False, seed=7):
        self.c = ctx
        self.P = ir(ctx.P)
        x0, y0, x1, y1 = self.P
        self.w, self.h = x1 - x0, y1 - y0
        self.printed, self.dot, self.wear, self.seed = printed, dot, wear, seed
        self.paper = np.asarray(ctx.canvas.convert("RGB").crop(self.P)).astype(np.float32) / 255
        self.mask = np.asarray(ctx.label_mask().crop(self.P)).astype(np.float32) / 255
        lum = self.paper.mean(axis=2)
        inside = self.mask > 0.9
        self.white_level = float(np.percentile(lum[inside], 95))
        self.paper_n = np.clip(self.paper / self.white_level, 0, 1.05)
        # Paper grain: the sprite's own fine fibre (a tight high-pass, clipped so the
        # window bevel and label edge do not print into the art) plus the matching
        # paper stock texture, since the sprite paper was upscaled and is smooth.
        L = Image.fromarray((lum * 255).astype(np.uint8), "L")
        blur = np.asarray(L.filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
        own = np.clip(lum - blur, -0.025, 0.025)
        stock = "paper/aged-yellowed.png" if ctx.t.get("shell") == "black" else "paper/cream-clean.png"
        t = tex_region(stock, self.w, self.h, seed + 1, scale=1.0)
        tb = np.asarray(Image.fromarray((t * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(10))).astype(np.float32) / 255
        self.grain = own + np.clip(t - tb, -0.06, 0.06) * 1.2
        self.art = np.zeros((self.h, self.w, 3), np.float32)
        self.art_a = np.zeros((self.h, self.w), np.float32)
        self.cover = None
        if cover_key:
            fn, focus, desc = COVER_INFO[cover_key]
            self.cover = Image.open(os.path.join(COVERS, fn)).convert("RGB")
            self.focus, self.cover_desc = focus, desc
        self.marks = []   # printed marks: (alpha HxW, rgb) multiplied before text
        self.blocks = []
        self.bands = {}   # edge -> dict(alpha, y0, y1, mode, rgb)
        self.log = []
        wx0, wy0, wx1, wy1 = ctx.Wn
        self.win = (wx0 - x0, wy0 - y0, wx1 - x0, wy1 - y0)

    # zones, label-local
    @property
    def strip_h(self):
        return self.win[1]

    @property
    def band_y(self):
        return self.win[3]

    def add_art(self, img, box):
        bx0, by0, bx1, by1 = [int(round(v)) for v in box]
        img = img.convert("RGB").resize((bx1 - bx0, by1 - by0), Image.LANCZOS)
        a = np.zeros((self.h, self.w), np.float32)
        a[max(0, by0):min(self.h, by1), max(0, bx0):min(self.w, bx1)] = 1
        arr = np.asarray(img).astype(np.float32) / 255
        sy0, sx0 = max(0, -by0), max(0, -bx0)
        dy0, dx0 = max(0, by0), max(0, bx0)
        hh = min(self.h, by1) - dy0
        ww = min(self.w, bx1) - dx0
        self.art[dy0:dy0 + hh, dx0:dx0 + ww] = arr[sy0:sy0 + hh, sx0:sx0 + ww]
        if self.printed:  # 1 px soft edge
            a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(
                ImageFilter.GaussianBlur(0.7))).astype(np.float32) / 255
        self.art_a = np.maximum(self.art_a, a)

    def cover_fill(self, box, focus=None):
        x0, y0, x1, y1 = box
        self.add_art(cover_crop(self.cover, x1 - x0, y1 - y0, focus or self.focus), box)

    def cover_width_top(self):
        w = self.w
        im = self.cover.resize((w, int(round(self.cover.height * w / self.cover.width))), Image.LANCZOS)
        self.add_art(im.crop((0, 0, w, self.h)), (0, 0, w, self.h))

    # -------------------------------------------------------------- print stages
    def _print_art(self, art):
        if not self.printed:
            return art
        g = art.mean(axis=2, keepdims=True)
        a = g + (art - g) * 0.9                       # slight desaturation
        a = 0.05 + a * 0.93                           # ink density limit: blacks print as dark ink, not void
        m = a * self.paper_n                          # multiply over paper
        a = a * 0.08 + m * 0.92
        b = np.clip(0.5 + self.grain[..., None] * 3.0, 0, 1)  # soft light with the grain
        a = (1 - 2 * b) * a * a + 2 * b * a
        if self.dot:
            yy, xx = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
            p = 3.0
            u, v = (xx + yy) / math.sqrt(2), (xx - yy) / math.sqrt(2)
            dots = 0.5 + 0.5 * np.cos(2 * np.pi * u / p) * np.cos(2 * np.pi * v / p)
            a = a * (1 - 0.06 * dots[..., None])
        return np.clip(a, 0, 1)

    def _apply_bands(self, art):
        out = art.copy()
        yy = np.arange(self.h, dtype=np.float32)[:, None]
        for edge, b in self.bands.items():
            if edge == "top":
                a = np.where(yy <= b["y1"], 1 - 0.15 * yy / max(1, b["y1"]),
                             0.85 * (1 - smoothstep(b["y1"], b["y1"] + 120, yy)))
            else:
                d = self.h - yy
                span = self.h - b["y0"]
                a = np.where(d <= span, 1 - 0.15 * d / max(1, span),
                             0.85 * (1 - smoothstep(span, span + 120, d)))
            a = (a * b["alpha"])[..., None]
            out = out * (1 - a) + b["rgb"][None, None, :] * a
        return out

    def compose_art(self):
        art = self._apply_bands(self.art)
        if self.printed:
            base = self.paper.copy()
        else:
            base = self.paper.copy()
        pr = self._print_art(art)
        a = self.art_a[..., None]
        out = base * (1 - a) + pr * a
        # printed keyline where the art meets the window cut
        if self.art_a.max() > 0:
            ring = Image.new("L", (self.w, self.h), 0)
            wx0, wy0, wx1, wy1 = self.win
            r = (wy1 - wy0) / 2
            ImageDraw.Draw(ring).rounded_rectangle((wx0 - 3, wy0 - 3, wx1 + 3, wy1 + 3), radius=r + 3,
                                                   outline=255, width=5)
            ring = np.asarray(ring.filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255
            ring = ring * self.art_a * 0.35
            out = out * (1 - ring[..., None])
        for alpha, rgb in self.marks:
            out = out * (1 - alpha[..., None] * (1 - rgb[None, None, :]))
        return np.clip(out, 0, 1)

    # -------------------------------------------------------------- ink
    def _block_region(self, b):
        x0, y0, x1, y1 = b.bbox
        pad = 10
        x0, y0 = max(0, int(x0 - pad)), max(0, int(y0 - pad))
        x1, y1 = min(self.w, int(x1 + pad)), min(self.h, int(y1 + pad))
        return x0, y0, x1, y1

    def _busyness(self, x0, y0, x1, y1, sel):
        """Local contrast of the ART behind a block (after any band): mean absolute
        band-pass (2 px to 12 px blur) of perceptual luminance. Smooth gradients and the
        paper's own grain and tonal steps do not count; a dense pattern does."""
        art = self._apply_bands(self.art)[y0:y1, x0:x1]
        lum = rel_lum(art) ** (1 / 2.2)
        im = Image.fromarray((np.clip(lum, 0, 1) * 255).astype(np.uint8), "L")
        a = np.asarray(im.filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
        b = np.asarray(im.filter(ImageFilter.GaussianBlur(12))).astype(np.float32) / 255
        w = self.art_a[y0:y1, x0:x1] * sel
        return float((np.abs(a - b) * w).sum() / max(1.0, w.sum()))

    def _analyse(self, b, comp):
        x0, y0, x1, y1 = self._block_region(b)
        sel = self.mask[y0:y1, x0:x1] > 0.6
        region = comp[y0:y1, x0:x1][sel]
        cov = float(self.art_a[y0:y1, x0:x1][sel].mean()) if sel.any() else 0
        L = rel_lum(region)
        p10, p90, mean = float(np.percentile(L, 10)), float(np.percentile(L, 90)), float(L.mean())
        white_col = np.clip(0.93 + 0.0, 0, 1)
        lw = float(rel_lum(np.array([WHITE_INK_OPACITY * white_col + (1 - WHITE_INK_OPACITY) * 0.5] * 3)))
        c_white = contrast(lw, p90)
        # dark ink multiplies the background: worst case is the lightest ink on the darkest bg
        ld_on = float(rel_lum(DARK_INK * np.percentile(region, 90, axis=0)))
        c_dark = contrast(p10, ld_on)
        std = self._busyness(x0, y0, x1, y1, sel)
        return {"coverage": cov, "p10": p10, "p90": p90, "mean": mean, "std": std, "busy": std > BUSY_MAX,
                "c_white": c_white, "c_dark": c_dark, "region": region}

    def choose_ink(self, b, comp, allow_band=True):
        """Returns (decision dict, needs_band). Rules, in order:
        R1 paper: the block sits on plain paper (<15% art behind it) -> dark ink.
        R2 white: white ink reaches the contrast target against the 90th percentile.
        R3 dark: dark ink reaches it against the 10th percentile.
        Busy: if the local contrast behind the block (band-pass of the art's luminance) is over
           BUSY_MAX, R2 and R3 are not allowed even if the mean contrast passes.
        R4 band: neither does -> a printed gradient band from the nearest label edge
           (darkening toward the cover's own shadow colour for white ink, or fading
           to paper for dark ink), strengthened until the better ink passes.
        Target contrast: 3.0 for the large title/artist, 4.5 for the small album line.
        Forced inks (art-influenced colour, ballpoint) log their own rule."""
        a = self._analyse(b, comp)
        edge = "top" if (b.bbox[1] + b.bbox[3]) / 2 < (self.win[1] + self.win[3]) / 2 else "bottom"
        d = {"block": b.name, "coverage": round(a["coverage"], 2), "bg_mean": round(a["mean"], 3),
             "bg_p10": round(a["p10"], 3), "bg_p90": round(a["p90"], 3),
             "c_white": round(a["c_white"], 2), "c_dark": round(a["c_dark"], 2), "target": b.min_contrast,
             "local_contrast": round(a["std"], 3)}
        band = self.bands.get(edge)
        banded = band is not None and b.name in band["blocks"]
        if b.ink and b.ink[0] in ("colour", "ballpoint"):
            kind, rgb = b.ink[0], b.ink[1]
            bg = np.median(a["region"], axis=0)
            c_ink = contrast(float(rel_lum(bg)), float(rel_lum(rgb * bg)))
            d.update(ink=kind, rgb=rgb, rule=b.ink[2] if len(b.ink) > 2 else kind, contrast=round(c_ink, 2))
            return d, False
        if a["coverage"] < 0.15:
            d.update(ink="dark", rule="R1 paper: dark ink", contrast=round(a["c_dark"], 2))
            return d, False
        if a["busy"]:  # too much local contrast behind the block: no ink reads, whatever the mean
            ink, c = None, max(a["c_white"], a["c_dark"])
        elif a["c_white"] >= b.min_contrast and a["c_white"] >= a["c_dark"]:
            ink, c = "white", a["c_white"]
        elif a["c_dark"] >= b.min_contrast:
            ink, c = "dark", a["c_dark"]
        else:
            ink, c = None, max(a["c_white"], a["c_dark"])
        if ink:
            rule = {"white": "R2 white ink on dark art", "dark": "R3 dark ink on light art"}[ink]
            if banded:
                rule = f"R4 band ({band['mode']}, {int(band['alpha'] * 100)}%) then {ink} ink"
            d.update(ink=ink, rule=rule, contrast=round(c, 2))
            return d, False
        if allow_band:
            mode = "darken" if a["c_white"] >= a["c_dark"] else "lighten"
            d.update(edge=edge, mode=mode)
            return d, True
        ink = "white" if a["c_white"] >= a["c_dark"] else "dark"
        d.update(ink=ink, rule=f"R5 best effort ({ink}; band at max)", contrast=round(c, 2))
        return d, False

    def _band_colour(self, mode):
        if mode == "lighten":
            return np.clip(np.median(self.paper[self.mask > 0.9], axis=0) / self.white_level, 0, 1)
        # the cover's own shadow: dominant hue, very dark
        dom = dominant_vivid(self.cover) if self.cover is not None else np.array([0.1, 0.1, 0.1])
        return np.clip(dom * 0.16 + 0.015, 0, 1)

    def resolve_inks(self):
        for b in self.blocks:
            b.layout()
        decisions = None
        for _ in range(14):
            comp = self.compose_art()
            decisions, pending = [], False
            for b in self.blocks:
                band = self.bands.get("top" if (b.bbox[1] + b.bbox[3]) / 2 < (self.win[1] + self.win[3]) / 2
                                      else "bottom")
                maxed = band is not None and band["alpha"] >= 0.92
                d, need = self.choose_ink(b, comp, allow_band=not maxed)
                if need:
                    pending = True
                    e = d["edge"]
                    bd = self.bands.get(e)
                    if bd is None:
                        bd = {"alpha": 0.35, "mode": d["mode"], "rgb": self._band_colour(d["mode"]),
                              "y0": b.bbox[1], "y1": b.bbox[3], "blocks": set()}
                        self.bands[e] = bd
                    else:
                        bd["alpha"] = min(0.92, bd["alpha"] + 0.08)
                        bd["y0"], bd["y1"] = min(bd["y0"], b.bbox[1]), max(bd["y1"], b.bbox[3])
                    bd["blocks"].add(b.name)
                decisions.append(d)
            if not pending:
                break
        self.comp = comp
        self.decisions = decisions
        for d in decisions:
            d.pop("region", None)
        return decisions

    def ink(self, out):
        for b, d in zip(self.blocks, self.decisions):
            m = Image.new("L", (self.w, self.h), 0)
            b.draw(ImageDraw.Draw(m))
            if self.printed:
                m = m.filter(ImageFilter.GaussianBlur(0.4))
            a = np.asarray(m).astype(np.float32) / 255
            ink = d["ink"]
            if ink == "white":
                if self.printed:
                    wcol = np.clip(0.95 + self.grain * 3.0, 0, 1)[..., None] * self.paper_n.mean(
                        axis=(0, 1), keepdims=True) ** 0.25
                    k = a[..., None] * WHITE_INK_OPACITY
                else:
                    wcol, k = np.ones(3, np.float32), a[..., None]
                out = out * (1 - k) + wcol * k
            else:
                rgb = {"dark": DARK_INK}.get(ink, d.get("rgb"))
                rgb = np.asarray(rgb, np.float32)
                if ink == "ballpoint" and self.printed:
                    n = tex_region("wear/grime-fingerprint-mask.png", self.w, self.h, self.seed + 3, scale=0.6)
                    a = a * (0.86 + 0.14 * (1 - n))
                if self.printed:
                    out = out * (1 - a[..., None] * (1 - rgb))       # multiplied into the paper
                else:
                    out = out * (1 - a[..., None]) + rgb * a[..., None]
            d["caps_1080"] = b.caps_1080()
        return out

    # -------------------------------------------------------------- wear
    def apply_wear(self, out):
        if not self.printed or self.wear == "none":
            return out
        w, h, s = self.w, self.h, self.seed
        lvl = {"light": 0, "medium": 1, "heavy": 2}[self.wear]
        grime = tex_region("wear/grime-fingerprint-mask.png", w, h, s)
        g = (0.10, 0.17, 0.24)[lvl] * grime
        tint = np.array([0.85, 0.95, 1.15], np.float32)
        out = out * (1 - g[..., None] * tint)
        # grime also flattens contrast a touch: a greasy lift toward paper mid
        out = out * (1 - g[..., None] * 0.25) + 0.55 * g[..., None] * 0.25
        if lvl >= 1:
            sc = tex_region("wear/scuff-scratch-mask.png", w, h, s + 11)
            if lvl == 2:
                sc = np.maximum(sc, tex_region("wear/scuff-scratch-mask.png", w, h, s + 29, rot=90) * 0.8)
            sc = np.clip(sc * (0.55 if lvl == 1 else 0.8), 0, 1)[..., None]
            bare = np.clip(self.paper_n * 0.96 + 0.03, 0, 1)   # ink rubbed back to paper fibre
            out = out * (1 - sc) + bare * sc
        if lvl == 2:
            fox = tex_region("wear/foxing-stain-mask.png", w, h, s + 5, mode="RGB")
            out = out * (1 - 0.75 * (1 - fox))
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            dmin = np.full((h, w), 1e9, np.float32)
            for cx, cy in ((0, 0), (w, 0), (0, h), (w, h)):
                dmin = np.minimum(dmin, np.hypot(xx - cx, yy - cy))
            edge = np.minimum.reduce([xx, yy, w - xx, h - yy])
            a = 0.55 * (1 - smoothstep(0, h * 0.75, dmin)) + 0.25 * (1 - smoothstep(0, 60, edge))
            yel = np.array([1.0, 0.86, 0.62], np.float32)
            out = out * (1 - a[..., None] * (1 - yel))
        return np.clip(out, 0, 1)

    # -------------------------------------------------------------- final
    def render(self):
        self.resolve_inks()
        out = self.ink(self.comp.copy())
        out = self.apply_wear(out)
        canvas = self.c.canvas.copy()
        region = np.asarray(canvas.convert("RGB").crop(self.P)).astype(np.float32) / 255
        m = self.mask[..., None]
        mixed = region * (1 - m) + out * m
        tile = Image.fromarray((np.clip(mixed, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").convert("RGBA")
        canvas.alpha_composite(tile, self.P[:2])
        return finish(canvas)


# ------------------------------------------------------------------ layouts

PAD = 40
T_PX, A_PX, AL_PX = 112, 66, 46   # title, artist, album sizes (Helvetica Neue Bold cap units)


def meta_of(L):
    return META[L.c.t["id"]]


def album_block(L, align, x0=None, style="grotesk", ink=None):
    m = meta_of(L)
    y0, y1 = L.band_y + 12, L.h - 14
    x0 = PAD if x0 is None else x0
    return Block("album", [(m["album"], "album", AL_PX)], (x0, y0, L.w - PAD, y1), align=align,
                 style=style, title_lines=1, ink=ink)


def concept_A(L, style="grotesk", title_ink=None, sub_ink=None):
    m = meta_of(L)
    side = L.h
    L.cover_fill((0, 0, side, side))
    tx = side + 44
    L.blocks.append(Block("title + artist", [(m["song"], "title", T_PX), (m["artist"], "sub", A_PX)],
                          (tx, 22, L.w - PAD, L.strip_h - 18), style=style, ink=title_ink))
    L.blocks.append(album_block(L, "left", tx, style))
    return f"{STYLES[style]['label']}"


def split_title_artist(L, style, same_baseline, title_share=0.62):
    """Title top-left and artist top-right on one baseline."""
    m = meta_of(L)
    avail = L.w - 2 * PAD - 60
    st = STYLES[style]
    ft = spec_font(st["title"], T_PX, style)
    fa = spec_font(st["sub"], A_PX, style)
    wt, wa = tlen(ft, m["song"], st["title"][3]), tlen(fa, m["artist"], st["sub"][3])
    if wt + wa > avail:
        at = max(avail * title_share, avail - wa) if wa < avail * (1 - title_share) else avail * title_share
        aa = avail - at
    else:
        at, aa = wt + 2, wa + 2
    base = same_baseline
    L.blocks.append(Block("title", [(m["song"], "title", T_PX)], (PAD, 18, PAD + at, L.strip_h - 16),
                          style=style, title_lines=1, baseline=base))
    L.blocks.append(Block("artist", [(m["artist"], "sub", A_PX)], (L.w - PAD - aa, 18, L.w - PAD, L.strip_h - 16),
                          align="right", style=style, title_lines=1, baseline=base))


def concept_B(L, style="grotesk"):
    m = meta_of(L)
    L.cover_width_top()
    L.blocks.append(Block("title + artist", [(m["song"], "title", T_PX + 6), (m["artist"], "sub", A_PX)],
                          (PAD, 20, L.w - PAD, L.strip_h - 16), style=style, valign="center"))
    L.blocks.append(album_block(L, "left", style=style))
    return STYLES[style]["label"]


def concept_B_centred(L, style="grotesk"):
    """B with every line centred: title across the top, artist under it, album under the wheels."""
    m = meta_of(L)
    L.cover_width_top()
    L.blocks.append(Block("title + artist", [(m["song"], "title", T_PX + 6), (m["artist"], "sub", A_PX)],
                          (PAD, 20, L.w - PAD, L.strip_h - 16), align="center", style=style, valign="center"))
    L.blocks.append(album_block(L, "center", style=style))
    return STYLES[style]["label"] + ", centred"


def main_bc():
    """Only the centred Fill width variant: python3 build_label_concepts_3.py bc"""
    os.makedirs(OUT, exist_ok=True)
    scene = Scene()
    for sh, cov in ((BLACK, "dark"), (WHITE, "bright")):
        render(scene, f"Bc_{sh}", sh, cov, concept_B_centred)
    for key, lbl, sh, cov in INK_TESTS:
        render(scene, "Bc_" + key[2:], sh, cov, concept_B_centred)


def concept_C(L, style="grotesk"):
    m = meta_of(L)
    L.cover_width_top()
    sh = L.strip_h
    L.blocks.append(Block("title", [(m["song"], "title", T_PX + 6)], (PAD, 16, L.w - PAD, sh * 0.60),
                          align="center", style=style, valign="top", title_lines=1))
    L.blocks.append(Block("artist", [(m["artist"], "sub", A_PX - 6)], (PAD, sh * 0.64, L.w * 0.62, sh - 12),
                          style=style, valign="bottom", title_lines=1))
    L.blocks.append(album_block(L, "right", style=style))
    return STYLES[style]["label"]


def concept_D(L, style="grotesk"):
    L.cover_width_top()
    split_title_artist(L, style, same_baseline=L.strip_h * 0.64)
    L.blocks.append(album_block(L, "center", style=style))
    return STYLES[style]["label"]


def concept_E(L, style="serif"):
    m = meta_of(L)
    xm = L.w // 2
    L.cover_fill((0, 0, xm, L.h))
    L.blocks.append(Block("title + artist", [(m["song"], "title", T_PX - 12), (m["artist"], "sub", A_PX - 6)],
                          (xm + 40, 20, L.w - PAD, L.strip_h - 14), style=style))
    L.blocks.append(album_block(L, "right", xm + 40, style))
    return STYLES[style]["label"]


def concept_F(L, style="condensed"):
    L.cover_fill((0, 0, L.w, L.h))
    split_title_artist(L, style, same_baseline=L.strip_h * 0.60)
    L.blocks.append(album_block(L, "left", style=style))
    return STYLES[style]["label"]


def ruled_lines(L, ys, x0, x1):
    m = Image.new("L", (L.w, L.h), 0)
    d = ImageDraw.Draw(m)
    for y in ys:
        d.line((x0, y, x1, y), fill=255, width=3)
    a = np.asarray(m.filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255 * 0.55
    L.marks.append((a, np.array([0.55, 0.66, 0.86], np.float32)))


def fallback_hand(L, radio=False):
    m = meta_of(L)
    sh = L.strip_h
    title = "KEXP 90.3 FM" if radio else m["song"]
    sub = "taped off the radio, Friday night" if radio else m["artist"]
    album = "Sept 24, 2026" if radio else m["album"]
    bl1, bl2 = sh * 0.50, sh * 0.86
    ruled_lines(L, [bl1 + 4, bl2 + 4, L.h - 36], PAD, L.w - PAD)
    ink = ("ballpoint", BALLPOINT, "ballpoint (fixed; plain paper)")
    L.blocks.append(Block("title", [(title, "title", 118)], (PAD + 16, 8, L.w - PAD, bl1), style="hand",
                          title_lines=1, baseline=bl1, ink=ink))
    L.blocks.append(Block("artist", [(sub, "sub", 84)], (PAD + 16, bl1 + 8, L.w - PAD, bl2), style="hand",
                          title_lines=1, baseline=bl2, ink=ink))
    L.blocks.append(Block("album", [(album, "album", 70)], (PAD + 16, L.band_y + 8, L.w - PAD, L.h - 36),
                          style="hand", title_lines=1, baseline=L.h - 40, ink=ink))
    return "Caveat, blue ballpoint, printed ruling"


def fallback_typeset(L):
    m = meta_of(L)
    L.blocks.append(Block("title + artist", [(m["song"], "title", T_PX), (m["artist"], "sub", A_PX)],
                          (PAD + 10, 22, L.w - PAD, L.strip_h - 18)))
    L.blocks.append(album_block(L, "left", PAD + 10))
    wx0, wy0, wx1, wy1 = L.win
    cx, cy = (wx1 + L.w) / 2, (wy0 + wy1) / 2

    def stereo(d, blk):
        f = fnt(HNEUE, 1, 30)
        tr = 0.2
        tw = tlen(f, "STEREO", tr)
        bx0, by0 = cx - tw / 2 - 16, cy - 26
        d.rounded_rectangle((bx0, by0, bx0 + tw + 32, by0 + 52), radius=8, outline=255, width=4)
        x = cx - tw / 2
        for ch in "STEREO":
            d.text((x, cy + 11), ch, font=f, fill=255, anchor="ls")
            x += f.getlength(ch) + tr * f.size
    L.blocks[-1].extra = stereo
    return "Helvetica Neue, printed STEREO mark"


CONCEPTS = [
    ("A", "Fit left", concept_A, "grotesk",
     "The square cover at full label height, printed flush to the left edge; the window cuts through it. "
     "Title and artist in two lines in the paper strip to the right; album small under the wheels, "
     "sharing the title's left edge."),
    ("B", "Fill width, layout 1", concept_B, "grotesk",
     "The cover at label width, top-anchored, so the paper carries its upper part behind everything. "
     "Title top-left, artist under it; album under the wheels, left."),
    ("C", "Fill width, layout 2", concept_C, "grotesk",
     "Same art as B. Title centred across the top, artist at the bottom-left of the strip just above the "
     "window; album under the wheels, right."),
    ("D", "Fill width, layout 3", concept_D, "grotesk",
     "Same art as B. Title top-left and artist top-right on one baseline; album centred under the wheels."),
    ("E", "Split", concept_E, "serif",
     "The cover fills the left half at full height; title and artist on paper in the right half; album "
     "under the wheels, right. Set in Baskerville to show a magazine voice."),
    ("F", "Poster", concept_F, "condensed",
     "The cover full bleed over the whole label (centre crop). Title top-left, artist top-right; album "
     "under the wheels. Set in Avenir Next Condensed caps for a gig-poster voice."),
]

# Alternate covers so every concept is seen on a dark and a bright cover.
def cover_for(i, shell):
    """Black shell with the dark cover, white shell with the bright one; the ink test
    row puts the bright and busy covers on the black shell too."""
    return "dark" if shell == BLACK else "bright"


# ------------------------------------------------------------------ rendering

class Scene:
    def __init__(self):
        self.manifest, self.tapes = load_manifest()
        self.bases = {}

    def ctx(self, shell):
        if shell not in self.bases:
            self.bases[shell] = build_base(self.manifest, self.tapes[shell])
        base, sprite_s = self.bases[shell]
        fake = {"cover": COVER_INFO["dark"][0]}
        return Ctx(self.manifest, self.tapes[shell], fake, base, sprite_s)

    def tape_wear(self, shell):
        return self.tapes[shell].get("wear", "light")


LOG = {}
CAPTIONS = {}


def rules_text(decisions):
    return "; ".join(f"{d['block']}: {d['rule']} ({d['contrast']}:1)" for d in decisions)


def render(scene, key, shell, cover, fn, wear=None, printed=True, dot=False, zoom=True, full=True, **kw):
    c = scene.ctx(shell)
    L = Label(c, cover, wear or scene.tape_wear(shell), printed=printed, dot=dot)
    face = fn(L, **kw)
    img = L.render()
    if full:
        img.resize((1920, 1080), Image.LANCZOS).save(os.path.join(OUT, f"{key}.jpg"), quality=90)
    crop = img.crop(r2.zoom_box(c))
    if zoom:
        crop.save(os.path.join(OUT, f"{key}_zoom.jpg"), quality=90)
    LOG[key] = {"shell": shell, "cover": cover, "wear": L.wear if printed else "none",
                "printed": printed, "face": face, "inks": L.decisions,
                "bands": {e: {"mode": b["mode"], "alpha": round(b["alpha"], 2)} for e, b in L.bands.items()}}
    print(f"{key:28s} {rules_text(L.decisions)}")
    return img, c


def to_json(o):
    if isinstance(o, np.ndarray):
        return [round(float(v), 3) for v in o]
    if isinstance(o, set):
        return sorted(o)
    return str(o)


# ------------------------------------------------------------------ extras

def dot_crop(scene):
    """The print dot at native 4K vs 1080p, and a numeric visibility check."""
    imgs = {}
    for dot in (False, True):
        c = scene.ctx(BLACK)
        L = Label(c, "bright", "none", dot=dot)
        concept_A(L)
        imgs[dot] = L.render()
    x0, y0 = int(c.P[0]) + 120, int(c.P[1]) + 150
    box4 = (x0, y0, x0 + 320, y0 + 180)
    a4 = np.asarray(imgs[True].crop(box4)).astype(float)
    b4 = np.asarray(imgs[False].crop(box4)).astype(float)
    small = {k: v.resize((1920, 1080), Image.LANCZOS) for k, v in imgs.items()}
    box1 = tuple(v // 2 for v in box4)
    a1 = np.asarray(small[True].crop(box1)).astype(float)
    b1 = np.asarray(small[False].crop(box1)).astype(float)

    def ripple(a):
        g = a.mean(axis=2)
        return float(np.abs(g - np.asarray(Image.fromarray(g.astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(3))).astype(float)).mean())

    stats = {"diff_4k_mean": round(float(np.abs(a4 - b4).mean()), 2),
             "diff_1080_mean": round(float(np.abs(a1 - b1).mean()), 2),
             "ripple_4k_dot": round(ripple(a4), 2), "ripple_4k_plain": round(ripple(b4), 2),
             "ripple_1080_dot": round(ripple(a1), 2), "ripple_1080_plain": round(ripple(b1), 2)}
    tiles = [imgs[False].crop(box4).resize((960, 540), Image.NEAREST),
             imgs[True].crop(box4).resize((960, 540), Image.NEAREST),
             small[True].crop(box1).resize((960, 540), Image.NEAREST)]
    names = ["4K, no dot (3x)", "4K, 3 px dot at 6% (3x)", "1080p, with dot (6x)"]
    out = Image.new("RGB", (960 * 3 + 40, 600), (20, 18, 16))
    d = ImageDraw.Draw(out)
    for i, (t, n) in enumerate(zip(tiles, names)):
        out.paste(t, (i * 980, 50))
        d.text((i * 980 + 6, 34), n, font=fnt(HNEUE, 1, 28), fill=(240, 235, 225), anchor="ls")
    out.save(os.path.join(OUT, "print_dot_crop.jpg"), quality=92)
    return stats


def build_stack(order):
    tiles = []
    fb = fnt(HNEUE, 1, 46)
    fm = fnt(HNEUE, 10, 30)

    def tag(im, num, name):
        d = ImageDraw.Draw(im)
        wide = max(68, fb.getlength(num) + 34)
        d.rounded_rectangle((18, 16, 18 + wide, 84), radius=34, fill=(232, 162, 74))
        d.text((18 + wide / 2, 51), num, font=fb, fill=(26, 18, 6), anchor="mm")
        tw = fm.getlength(name)
        d.rounded_rectangle((28 + wide, 30, 28 + wide + tw + 28, 72), radius=21, fill=(0, 0, 0))
        d.text((42 + wide, 51), name, font=fm, fill=(255, 255, 255), anchor="lm")
        return im

    row = []
    for key, num, name, half in order:
        im = Image.open(os.path.join(OUT, f"{key}_zoom.jpg")).convert("RGB")
        w = 545 if half else 1100
        im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
        if half:
            bar = Image.new("RGB", (w, im.height + 100), (20, 18, 16))
            bar.paste(im, (0, 100))
            im = tag(bar, num, name)
            row.append(im)
            if len(row) == 2:
                r = Image.new("RGB", (1100, row[0].height), (20, 18, 16))
                r.paste(row[0], (0, 0))
                r.paste(row[1], (555, 0))
                tiles.append(r)
                row = []
        else:
            tiles.append(tag(im, num, name))
    if row:
        r = Image.new("RGB", (1100, row[0].height), (20, 18, 16))
        r.paste(row[0], (0, 0))
        tiles.append(r)
    gap = 14
    out = Image.new("RGB", (1100, sum(t.height for t in tiles) + gap * (len(tiles) - 1)), (20, 18, 16))
    y = 0
    for t in tiles:
        out.paste(t, (0, y))
        y += t.height + gap
    out.save(os.path.join(OUT, "all-concepts-stack.jpg"), quality=86)


# ------------------------------------------------------------------ page

def esc(s):
    return html.escape(str(s), quote=True)


def fig(key, alt, cap, zoom=True, full=True):
    parts = []
    if zoom:
        parts.append(f'<button class="shot" data-src="mixtape-label-concepts-3/{key}_zoom.jpg" '
                     f'aria-label="Enlarge {esc(alt)}"><img loading="lazy" '
                     f'src="mixtape-label-concepts-3/{key}_zoom.jpg" alt="{esc(alt)}"></button>')
    links = f' <a class="full" href="mixtape-label-concepts-3/{key}.jpg" data-src="mixtape-label-concepts-3/{key}.jpg">1080p frame</a>' if full else ""
    return f'<figure>{"".join(parts)}<figcaption>{cap}{links}</figcaption></figure>'


def cap_for(key, extra=""):
    lg = LOG[key]
    inks = "<br>".join(f'<span class="rule">{esc(d["block"])}</span> {esc(d["rule"])} '
                       f'<span class="cr">{d["contrast"]}:1</span>' for d in lg["inks"])
    wear = lg["wear"]
    cov = COVER_INFO[lg["cover"]][2] if lg["cover"] else "no art"
    return (f'<b>{esc(META[lg["shell"]]["short"])}</b>, {esc(cov)} cover{esc(extra)}<br>'
            f'<span class="k">Type</span> {esc(lg["face"])}<br><span class="k">Wear</span> {esc(wear)}<br>{inks}')


def build_page(dot_stats):
    S = []
    toc = []

    def section(sid, title, lede, body):
        toc.append(f'<li><a href="#{sid}">{esc(title)}</a></li>')
        S.append(f'<section class="block" id="{sid}"><h2>{esc(title)}</h2><p class="what">{lede}</p>{body}</section>')

    # Concepts
    for i, (cid, name, fn, style, what) in enumerate(CONCEPTS):
        figs = "".join(fig(f"{cid}_{sh}", f"{name} on {META[sh]['name']}", cap_for(f"{cid}_{sh}"))
                       for sh in (BLACK, WHITE))
        toc.append(f'<li><a href="#{cid}">{cid}. {esc(name)}</a></li>')
        S.append(f'<section class="block concept" id="{cid}"><header><span class="num">{cid}</span>'
                 f'<h2>{esc(name)}</h2></header><p class="what">{esc(what)}</p>'
                 f'<div class="pair">{figs}</div></section>')

    items = "".join(fig(f"T{n}", lbl, f'<b>{n}. {esc(lbl)}</b><br>' + cap_for(f"T{n}"), full=True)
                    for n, lbl, _, _ in VARIETY)
    section("variety", "Typeset variety",
            "Concept A on the black TDK with the dark cover, one layout in several printed voices. 1 to 4 are the "
            "four asked for; 5 and 6 are extra tries (Futura, Didot). 7 and 8 are art-influenced: the title ink "
            "takes the cover's dominant colour when it reaches 3:1 on the paper, else a darker shade of it, else "
            "falls back to black.", f'<div class="grid4">{items}</div>')

    items = "".join(fig(f"W_{lv}", f"Wear {lv}", f"<b>{lv.title()}</b><br>" + cap_for(f"W_{lv}"))
                    for lv in ("light", "medium", "heavy"))
    section("wear", "Wear on the art",
            "Concept A, black TDK, dark cover. Wear is applied after the ink, so it crosses art and type alike. "
            "Light: faint grime and fingerprints. Medium: grime plus scuffs rubbing ink back to paper fibre. "
            "Heavy: stronger grime, scuffs in two directions, foxing spots and yellowed corners and edges.",
            f'<div class="grid3">{items}</div>')

    items = "".join(fig(f"{h}_{sh}", f"{lbl} on {META[sh]['name']}",
                        f"<b>{h}. {esc(lbl)}</b><br>" + cap_for(f"{h}_{sh}"))
                    for h, lbl, _ in FALLBACKS for sh in (BLACK, WHITE))
    section("fallback", "No art: fallbacks",
            "For radio and tracks with no cover. H1 is the homemade tape: Caveat in blue ballpoint (multiplied "
            "into the paper, with slight pressure variation) on printed ruling. H2 is the typeset plain label with "
            "a small printed STEREO mark beside the window. H3 is H1 for radio, with the station as the title and "
            "the date under the wheels.", f'<div class="grid2">{items}</div>')

    items = "".join(fig(k, lbl, f"<b>{esc(lbl)}</b><br>" + cap_for(k)) for k, lbl, _, _ in INK_TESTS)
    section("inktest", "Ink test",
            "Concept B on the hard covers. The rule that fired and the measured contrast are under each image; the "
            "gradient band, when it fires, is printed into the art (a smooth fade from the nearest label edge "
            "toward the cover's own shadow colour, or toward the paper), never a shadow behind the letters.",
            f'<div class="grid3">{items}</div>')

    ba = (fig("BA_before", "Before: no print treatment",
              "<b>Before</b>: art pasted on, flat opaque type, no wear<br>" + cap_for("BA_before")) +
          fig("BA_after", "After: print treatment",
              "<b>After</b>: printed art, ink type, light wear<br>" + cap_for("BA_after")))
    dot = (f'<figure class="wide"><button class="shot" data-src="mixtape-label-concepts-3/print_dot_crop.jpg" '
           f'aria-label="Enlarge print dot crop"><img loading="lazy" src="mixtape-label-concepts-3/print_dot_crop.jpg" '
           f'alt="Print dot at 4K and 1080p"></button><figcaption><b>Print dot</b> (3 px period, 45 degree '
           f'screen, 6%), on the bright cover where it would show most. Mean pixel change: '
           f'{dot_stats["diff_4k_mean"]} levels at 4K, {dot_stats["diff_1080_mean"]} at 1080p. Fine-grain '
           f'ripple (difference from a 3 px blur): {dot_stats["ripple_4k_plain"]} to {dot_stats["ripple_4k_dot"]} '
           f'at 4K, {dot_stats["ripple_1080_plain"]} to {dot_stats["ripple_1080_dot"]} at 1080p. '
           f'{DOT_VERDICT}</figcaption></figure>')
    section("beforeafter", "Before and after the print treatment",
            "Concept A on the black TDK with the dark cover. Same layout, same ink rule; the only change is the "
            "treatment.", f'<div class="pair">{ba}</div>{dot}')

    picks = []
    for cid, name, *_ in CONCEPTS:
        picks.append((f"{cid}", f"{cid}. {name}"))
    for n, lbl, _, _ in VARIETY:
        picks.append((f"T{n}", f"Type {n}. {lbl}"))
    for lv in ("light", "medium", "heavy"):
        picks.append((f"W_{lv}", f"Wear: {lv}"))
    for h, lbl, _ in FALLBACKS:
        picks.append((h, f"{h}. {lbl}"))
    picks.append(("band", "Gradient band fallback"))
    picks.append(("print", "Print treatment overall"))
    ph = "".join(
        f'<fieldset data-name="{esc(n)}"><legend>{esc(n)}</legend>'
        f'<label><input type="radio" name="{k}" value="Love it"> Love it</label>'
        f'<label><input type="radio" name="{k}" value="Maybe"> Maybe</label>'
        f'<label><input type="radio" name="{k}" value="No"> No</label>'
        f'<input class="note" type="text" aria-label="Note for {esc(n)}" placeholder="note"></fieldset>'
        for k, n in picks)
    page = (TEMPLATE.replace("{{TOC}}", "".join(toc)).replace("{{SECTIONS}}", "".join(S))
            .replace("{{PICKS}}", ph))
    open(PAGE, "w").write(page)


DOT_VERDICT = ""

TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mixtape Label Concepts 3</title>
<style>
:root{--bg:#141210;--card:#1d1a17;--ink:#f1ebe2;--muted:#b3a898;--line:#352f29;--accent:#e8a24a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{max-width:1560px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:34px;margin:0 0 6px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:1040px;margin:0 0 14px}
.lede b{color:var(--ink)}
ol.steps{max-width:1040px;color:var(--muted);margin:0 0 20px;padding-left:22px}
ol.steps b{color:var(--ink)}
ol.toc{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 24px;padding:0;margin:0 0 28px;list-style:none}
ol.toc a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
.block{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 28px}
.block header{display:flex;align-items:center;gap:12px}
.num{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--accent);color:#1a1206;font-weight:700}
h2{margin:0;font-size:24px}
.what{color:var(--muted);margin:8px 0 14px;max-width:1100px}
.pair,.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
figure{margin:0}
figure.wide{margin-top:16px}
figcaption{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.45}
figcaption b{color:var(--ink)}
.k{color:var(--accent)}
.rule{color:var(--ink)}
.cr{color:var(--accent);white-space:nowrap}
a.full{color:var(--accent);font-size:12px;white-space:nowrap}
.shot{display:block;padding:0;border:0;background:none;cursor:zoom-in;width:100%}
.shot img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
#picks{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
#picks h2{margin-bottom:12px}
fieldset{border:1px solid var(--line);border-radius:10px;margin:0 0 8px;padding:6px 12px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
legend{padding:0 6px;font-weight:600}
input.note{flex:1;min-width:180px;background:#12100e;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:5px 8px;font:inherit;font-size:14px}
textarea{width:100%;min-height:110px;background:#12100e;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit}
button.copy{margin-top:12px;background:var(--accent);color:#1a1206;border:0;border-radius:999px;padding:10px 20px;font-weight:700;font-size:15px;cursor:pointer}
#copied{margin-left:10px;color:var(--muted)}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:9;cursor:zoom-out}
#lb.on{display:flex}
#lb img{max-width:98vw;max-height:96vh}
@media (max-width:1100px){.grid4{grid-template-columns:1fr 1fr}.grid3{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.pair,.grid2,.grid3,.grid4{grid-template-columns:1fr}h1{font-size:26px}}
</style></head>
<body><main>
<h1>Mixtape label concepts, round 3</h1>
<p class="lede">Your round 2 notes: the art and text must look <b>printed into the label, not stuck on</b>; title and
artist large; the album always present but small, <b>under the wheels</b>; continue Fit left, Fill width
(several text layouts), Split and Poster; typeset, with <b>variety between tapes</b>; handwriting only as the
no-art fallback; and wear on the art at three levels. Every image below goes through one print treatment,
implemented once:</p>
<ol class="steps">
<li><b>Paper base.</b> The tape's own label paper from the sprite, with its grain, tint and tonal banding.</li>
<li><b>Art printed.</b> The cover resampled to its rect, desaturated to 0.9, multiplied over the paper at 92% (the
paper normalised to its white, so its tint carries into the art and yellowed paper warms it), then a soft-light
pass of the paper grain so fibre shows in the darks. A 1 px soft edge, no border, no shadow; a faint printed
keyline where art meets the window cut.</li>
<li><b>Text as ink.</b> Dark ink is near black multiplied into the paper; white ink is 90% white with the grain
showing through; a 0.4 px blur for ink spread. No shadows, ever.</li>
<li><b>Ink choice, per text block.</b> R1: on plain paper, dark ink. R2: white if it reaches 3:1 (4.5:1 for the small
album line) against the 90th percentile of the luminance behind the block. R3: dark if it reaches it against the
10th percentile. R4: neither, so a printed gradient band fades in from the nearest label edge (toward the cover's
own shadow colour, or toward the paper) and strengthens until the better ink passes. The rule and the contrast are
under every image.</li>
<li><b>Wear.</b> The tape's wear level over art and ink together, from the wear masks; then the closed door glass
and frame as in the app.</li>
</ol>
<p class="lede">All renders are the real app assets at 4K; thumbnails are the label at 2x, and each caption links the
full 1080p frame. Black TDK: "Golden Hour" by Wandering Lights. White Sony: deliberately long names. The black TDK
carries the dark cover and the white Sony the bright pale one; the ink test puts the bright and busy covers on the
black shell. See <a href="#beforeafter" style="color:var(--accent)">before and after</a> for what the
treatment does.</p>
<ol class="toc">{{TOC}}</ol>
{{SECTIONS}}
<section id="picks"><h2>Your picks</h2>
{{PICKS}}
<label for="notes"><b>Notes</b></label>
<textarea id="notes" placeholder="e.g. A for dark covers, D for bright; condensed and serif in the rotation; medium wear default"></textarea>
<button class="copy" id="copy">Copy decisions</button><span id="copied" aria-live="polite"></span>
</section>
</main>
<div id="lb" role="dialog" aria-modal="true" aria-label="Enlarged image"><img alt=""></div>
<script>
const lb=document.getElementById('lb'),lbi=lb.querySelector('img');
function open_(src,alt){lbi.src=src;lbi.alt=alt||'';lb.classList.add('on')}
document.querySelectorAll('.shot').forEach(b=>b.addEventListener('click',()=>open_(b.dataset.src,b.querySelector('img').alt)));
document.querySelectorAll('a.full').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();open_(a.dataset.src,'1080p frame')}));
lb.addEventListener('click',()=>lb.classList.remove('on'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on')});
document.getElementById('copy').addEventListener('click',async()=>{
  const lines=['Mixtape label concepts round 3, picks:'];
  document.querySelectorAll('#picks fieldset').forEach(fs=>{
    const c=fs.querySelector('input:checked');const n=fs.querySelector('input.note').value.trim();
    if(!c&&!n)return;
    lines.push('- '+fs.dataset.name+': '+(c?c.value:'no pick')+(n?' ('+n+')':''));});
  const n=document.getElementById('notes').value.trim();if(n)lines.push('Notes: '+n);
  if(lines.length===1)lines.push('(nothing picked)');
  const txt=lines.join('\\n');const out=document.getElementById('copied');
  try{await navigator.clipboard.writeText(txt);out.textContent='Copied.'}
  catch(e){const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();
    try{document.execCommand('copy');out.textContent='Copied.'}catch(_){out.textContent='Copy failed; select the text manually.'}t.remove()}
});
</script>
</body></html>
"""


# ------------------------------------------------------------------ rows

def art_influenced(cover_key):
    def fn(L):
        cov = Image.open(os.path.join(COVERS, COVER_INFO[cover_key][0])).convert("RGB")
        dom = dominant_vivid(cov)
        paper = np.median(L.paper[L.mask > 0.9], axis=0)
        lp = float(rel_lum(paper))
        chosen, rule = None, None
        for k, tagtxt in ((1.0, "dominant colour"), (0.72, "dominant colour, darkened"),
                          (0.5, "dominant colour, darkened more")):
            col = np.clip(dom * k, 0, 1)
            if contrast(lp, float(rel_lum(col * paper))) >= 3.4:
                chosen, rule = col, tagtxt
                break
        rgbtxt = "rgb(" + ",".join(str(int(v * 255)) for v in dom) + ")"
        if chosen is None:
            ink = ("colour", DARK_INK, f"art-influenced: fell back to black ({rgbtxt} too light)")
        else:
            ink = ("colour", chosen, f"art-influenced: {rule} {rgbtxt}")
        return concept_A(L, "grotesk", title_ink=ink).replace(
            "Helvetica Neue Bold / Regular", "Helvetica Neue Bold / Regular, title in cover colour")
    return fn


VARIETY = [
    (1, "Grotesk", "grotesk", None),
    (2, "Condensed caps", "condensed", None),
    (3, "Serif italic", "serif", None),
    (4, "Typewriter", "typewriter", None),
    (5, "Geometric (extra)", "geometric", None),
    (6, "Didot display (extra)", "didot", None),
    (7, "Art-influenced, dark cover", None, "dark"),
    (8, "Art-influenced, warm cover", None, "warm"),
]

FALLBACKS = [
    ("H1", "Homemade, handwritten", lambda L: fallback_hand(L)),
    ("H2", "Typeset plain paper", fallback_typeset),
    ("H3", "Radio, handwritten", lambda L: fallback_hand(L, radio=True)),
]

INK_TESTS = [
    ("I_busy_black", "B on the busy cover, black TDK", BLACK, "busy"),
    ("I_bright_black", "B on the bright cover, black TDK", BLACK, "bright"),
    ("I_busy_white", "B on the busy cover, white Sony (long names)", WHITE, "busy"),
]


def main():
    global DOT_VERDICT
    os.makedirs(OUT, exist_ok=True)
    scene = Scene()
    for i, (cid, name, fn, style, _) in enumerate(CONCEPTS):
        for sh in (BLACK, WHITE):
            render(scene, f"{cid}_{sh}", sh, cover_for(i, sh), fn, style=style)
    for n, lbl, style, cov in VARIETY:
        if style:
            render(scene, f"T{n}", BLACK, "dark", concept_A, style=style)
        else:
            render(scene, f"T{n}", BLACK, cov, art_influenced(cov))
    for lv in ("light", "medium", "heavy"):
        render(scene, f"W_{lv}", BLACK, "dark", concept_A, wear=lv)
    for h, lbl, fn in FALLBACKS:
        for sh in (BLACK, WHITE):
            render(scene, f"{h}_{sh}", sh, None, fn)
    for key, lbl, sh, cov in INK_TESTS:
        render(scene, key, sh, cov, concept_B)
    render(scene, "BA_before", BLACK, "dark", concept_A, printed=False)
    render(scene, "BA_after", BLACK, "dark", concept_A)
    stats = dot_crop(scene)
    visible = stats["ripple_1080_dot"] - stats["ripple_1080_plain"]
    DOT_VERDICT = ("At 1080p the screen is filtered out in the downscale (it is finer than a 1080p pixel), so "
                   "it is not visible; at 4K it adds a faint texture only up close. Left off by default."
                   if visible < 0.3 else
                   "It survives the 1080p downscale as a faint texture.")
    print("dot", stats, DOT_VERDICT)
    order = [(f"{cid}_{BLACK}", cid, name, False) for cid, name, *_ in CONCEPTS]
    order += [(f"T{n}", f"T{n}", lbl, True) for n, lbl, _, _ in VARIETY]
    order += [(f"W_{lv}", "W", f"Wear {lv}", True) for lv in ("light", "medium", "heavy")]
    build_stack(order)
    json.dump({"inks": LOG, "print_dot": stats}, open(os.path.join(OUT, "ink-log.json"), "w"),
              indent=1, default=to_json)
    build_page(stats)
    print("page", PAGE)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "bc":
        main_bc()
    else:
        main()
