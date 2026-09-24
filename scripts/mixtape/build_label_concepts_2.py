"""Mixtape label-layout concepts, round 2 (eight layouts that use the whole label face).

Round 2 of build_label_concepts.py, reusing its compositor (deck, well, sprite, window
cavity with brown packs, hubs, closed door glass and frame), fonts, covers, shells and
metadata. New here: layouts that use the strip above the window, the columns beside it
and the band below it; every title rendered in both the bold sans and Caveat (the page
shows the better one and keeps the other as an "also tried"); a measured couch
legibility figure per render; a dominant-colour band; and a tall stack of the black
shell crops for chat.

Run from the project root with the system python3 (Pillow + numpy):

    python3 scripts/mixtape/build_label_concepts_2.py

Output: _review/mockups/mixtape-label-concepts-2/*.jpg and the page
_review/mockups/mixtape-label-concepts-2.html.
"""

import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_label_concepts as r1  # noqa: E402
from build_label_concepts import (  # noqa: E402
    CAVEAT, HNEUE, W, H, SHELLS, Ctx, build_base, capsule_box, cover_crop, draw_text,
    finish, font, gradient, ir, load_manifest, paper_grain, print_on_paper, px_rect,
    rounded_mask,
)

ROOT = r1.ROOT
OUT = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts-2")
PAGE = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts-2.html")

# Which title style reads better per concept, decided by looking at both renders
# (every concept is rendered in both; the other one is shown as "also tried").
PICK = {"c1": "sans", "c2": "sans", "c3": "hand", "c4": "sans",
        "c5": "sans", "c6": "sans", "c7": "hand", "c8": "sans"}

WHY = {
    "c1": "Bold sans: the handwriting next to a big photo print looked timid.",
    "c2": "Bold sans, for the same reason as 1.",
    "c3": "Caveat: on plain paper with a small print it is the most mixtape of the set, "
          "and at this size it reads fine.",
    "c4": "Bold sans: white Caveat on a photo scrim looks like a caption app, not a label.",
    "c5": "Bold sans: the right half is narrow, and Caveat wrapped sooner and looked cramped.",
    "c6": "Bold sans: the band is short, and the sans stays crisp at a smaller size.",
    "c7": "Caveat, as specified; the sans version is shown for comparison and reads "
          "more like a price tag.",
    "c8": "Bold sans: it matches the solid colour band, which is graphic rather than handmade.",
}

CONCEPTS = [
    ("c1", "Fit, left",
     "The crisp square cover at full label height, left-aligned with a 3 px white border "
     "and a faint shadow; the window punches through it, so the left reel sits over the art. "
     "Song title large and artist smaller to the right, in the strip above the window.",
     "The biggest uncropped cover of any concept (about 3.4x today) and a clear paper area "
     "for text; the reel cuts a bite out of the right third of the cover."),
    ("c2", "Fit, L-shape",
     "The same full-height square, masked to an L: the strip above the window plus the "
     "column left of it, never behind the reels. Text as in 1.",
     "Nothing competes with the reels and the cover still runs the whole height; the "
     "square's lower right quarter is simply missing, which reads as a design choice on "
     "some covers and as damage on others."),
    ("c3", "Under the wheels",
     "Plain paper. Song title large in the strip above the window with a small square "
     "print at strip height on its left; artist (left) and album (right) in the band "
     "below the window.",
     "The most like a real handwritten mixtape and every field gets its own home; the "
     "art stays small, so this is the text-first answer."),
    ("c4", "Fill width, top-anchored",
     "The cover scaled to the label width and anchored at the top, so the paper shows "
     "roughly its upper half; song and artist over a scrim in the strip; window through the art.",
     "Very immersive and never letterboxed, and the top of a cover is usually sky, "
     "space or a title zone; subjects that sit low in the cover are cut off."),
    ("c5", "Split",
     "The cover fills the left half of the label at full height (cropped to fit); title "
     "and artist in the right half above the window on paper, album in the band below "
     "the window on the right.",
     "A calm, magazine-like balance with a big picture and big text; the right half is "
     "narrow, so long titles wrap to two lines."),
    ("c6", "Poster, text below",
     "Round 1's full bleed kept clean of text: the cover over the whole label, song "
     "(left, bold) and artist (right) on one line in the band below the window, on a dark scrim.",
     "The cleanest art of the full-bleed family and the text sits under the reels like "
     "a caption; the band is short, so the text is smaller than in 1, 4 or 8."),
    ("c7", "Inverse",
     "Paper strip above the window with large Caveat handwriting (song, then artist, "
     "filling the strip); the cover as a wide crop filling the band below the window "
     "edge to edge.",
     "The handwriting is the hero and is very readable; the cover becomes a 10:1 sliver, "
     "so it is mood and colour, not a recognisable album cover."),
    ("c8", "Two-tone",
     "Concept 4 on top (the song title alone, since the artist moves down); below the "
     "window a solid band in the cover's dominant colour with artist and album in "
     "contrasting ink.",
     "Every cover gets a matching colour and the three fields are cleanly separated; "
     "the dominant colour can be muddy on dark or low-saturation covers."),
]

# ------------------------------------------------------------------ text

STYLES = {
    # (title font, title index, sub font, sub index, size scale vs the sans sizes)
    "sans": (HNEUE, 1, HNEUE, 10, 1.0),
    "hand": (CAVEAT, 0, CAVEAT, 0, 1.38),
}


def _cap(f):
    return -f.getbbox("H", anchor="ls")[1]


def _desc(f):
    return f.getbbox("gjpqy", anchor="ls")[3]


def _ellipsize(text, f, maxw):
    t = text
    while t and f.getlength(t.rstrip() + "…") > maxw:
        t = t[:-1]
    return t.rstrip() + "…"


def fit_lines(text, path, idx, size, maxw, max_lines):
    """One line shrinking to 0.82x; else two balanced lines down to 0.6x; else ellipsis."""
    s = size
    while s >= size * 0.82:
        f = font(path, s, idx)
        if f.getlength(text) <= maxw:
            return [text], f
        s -= 2
    words = text.split()
    if max_lines >= 2 and len(words) > 1:
        s = size * 0.86
        while s >= size * 0.6:
            f = font(path, s, idx)
            best = None
            for i in range(1, len(words)):
                a, b = " ".join(words[:i]), " ".join(words[i:])
                wmax = max(f.getlength(a), f.getlength(b))
                if wmax <= maxw and (best is None or wmax < best[0]):
                    best = (wmax, [a, b])
            if best:
                return best[1], f
            s -= 2
        f = font(path, size * 0.6, idx)
        # two lines, the second ellipsized
        line1 = []
        for w in words:
            if f.getlength(" ".join(line1 + [w])) > maxw:
                break
            line1.append(w)
        rest = " ".join(words[len(line1):])
        return [" ".join(line1), _ellipsize(rest, f, maxw) if f.getlength(rest) > maxw else rest], f
    f = font(path, size * 0.7, idx)
    return [_ellipsize(text, f, maxw) if f.getlength(text) > maxw else text], f


def ink_for(on, style, role, c):
    if on == "dark":
        return (255, 255, 255, 255 if role == "title" else 228)
    if isinstance(on, tuple):  # solid band: ("solid", rgb)
        rgb = on[1]
        return (*rgb, 255 if role == "title" else 225)
    if style == "hand":
        rgb = tuple(int(c.ink.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
        return (*rgb, 255 if role == "title" else 235)
    return (24, 24, 28, 255) if role == "title" else (70, 70, 78, 255)


LEGIB = []  # (min cap px at 1080p) per render, filled while drawing


def text_block(layer, c, box, lines, style, on="paper", align="left", valign="center",
               title_lines=2):
    """lines: [(text, role, sans_px)]. Fits the whole block in box (width and height),
    wrapping the first line to two lines if it allows, shrinking uniformly otherwise."""
    tpath, tidx, spath, sidx, scale = STYLES[style]
    x0, y0, x1, y1 = box
    maxw, maxh = x1 - x0, y1 - y0
    k = 1.0
    for _ in range(40):
        laid = []
        for i, (text, role, size) in enumerate(lines):
            path, idx = (tpath, tidx) if role == "title" else (spath, sidx)
            s = size * k * scale
            ls, f = fit_lines(text, path, idx, s, maxw, title_lines if i == 0 else 1)
            for j, t in enumerate(ls):
                laid.append((t, f, role, j > 0))
        lead_same = 0.16 if style == "sans" else 0.05
        lead_new = 0.30 if style == "sans" else 0.12
        base = []
        yb = _cap(laid[0][1])
        base.append(yb)
        for (t, f, role, cont), prev in zip(laid[1:], laid[:-1]):
            lead = lead_same if cont else lead_new
            yb += _desc(prev[1]) * 0.55 + f.size * lead + _cap(f)
            base.append(yb)
        hgt = yb + _desc(laid[-1][1]) * 0.55
        if hgt <= maxh:
            break
        k *= 0.96
    if valign == "center":
        top = y0 + (maxh - hgt) / 2
    elif valign == "bottom":
        top = y1 - hgt
    else:
        top = y0
    anchor = {"left": "ls", "right": "rs", "center": "ms"}[align]
    ax = {"left": x0, "right": x1, "center": (x0 + x1) / 2}[align]
    for (t, f, role, _), b in zip(laid, base):
        col = ink_for(on, style, role, c)
        draw_text(layer, (ax, top + b), t, f, col,
                  shadow=0.55 if on == "dark" else 0.0, shadow_r=7, anchor=anchor)
        # couch check: cap height in 1080p pixels (x-height for Caveat lower case)
        LEGIB.append((role, _cap(f) / 2))
    return laid


# ------------------------------------------------------------------ geometry helpers

def zones(c):
    x0, y0, x1, y1 = c.P
    wx0, wy0, wx1, wy1 = c.Wn
    return {
        "strip": (x0, y0, x1, wy0),
        "band": (x0, wy1, x1, y1),
        "left": (x0, wy0, wx0, wy1),
        "right": (wx1, wy0, x1, wy1),
    }


def rect_mask(box):
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle(ir(box), fill=255)
    return m


def clip(layer, mask):
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))


def mounted_print(c, layer, art, xy, shape_mask, border=3, shadow=0.32):
    """A photo print: white border and faint shadow around shape_mask (L, full frame),
    art (full-frame RGBA) inside it; the paper's own grain laid over the art."""
    paper = c.label_mask()
    grown = shape_mask.filter(ImageFilter.MaxFilter(2 * border + 1))
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sa = grown.point(lambda v: int(v * shadow))
    sh.putalpha(sa)
    sh = ImageChops.offset(sh, 5, 9).filter(ImageFilter.GaussianBlur(9))
    clip(sh, paper)
    layer.alpha_composite(sh)
    wb = Image.new("RGBA", (W, H), (250, 249, 245, 255))
    wb.putalpha(ImageChops.multiply(grown, paper))
    layer.alpha_composite(wb)
    a = art.copy()
    a.putalpha(ImageChops.multiply(ImageChops.multiply(a.getchannel("A"), shape_mask), paper))
    layer.alpha_composite(a)


def full_frame(img, xy):
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), ir(xy))
    return out


def dominant_colour(cover):
    small = cover.resize((200, 200), Image.LANCZOS)
    hsv = np.array(small.convert("HSV")).reshape(-1, 3)
    rgb = np.array(small.convert("RGB")).reshape(-1, 3)
    sel = (hsv[:, 1] > 90) & (hsv[:, 2] > 60)
    if sel.sum() < 200:
        sel = hsv[:, 2] > 40
    return tuple(int(v) for v in np.median(rgb[sel], axis=0))


def contrast_ink(rgb):
    lin = [((v / 255) / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4) for v in rgb]
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return (18, 18, 22) if lum > 0.22 else (255, 255, 255)


def strip_scrim(c, layer, box, strength=0.8):
    x0, y0, x1, y1 = box
    sw, sh = int(x1 - x0), int(y1 - y0 + 30)
    hor = np.array(gradient(sw, sh, [(0, strength), (0.6, strength * 0.7), (1, 0.15)], horizontal=True)).astype(float)
    ver = np.array(gradient(sw, sh, [(0, 1.0), (0.8, 0.9), (1, 0.0)])).astype(float)
    a = Image.fromarray((hor * ver / 255).astype(np.uint8), "L")
    layer.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (sw, sh), (6, 6, 10)).split(), a)), ir((x0, y0)))


# ------------------------------------------------------------------ concepts

PAD = 40


def _fit_square(c):
    x0, y0, x1, y1 = c.P
    inset = 10
    side = int(round(y1 - y0 - 2 * inset))
    ax, ay = x0 + inset, y0 + inset
    art = full_frame(cover_crop(c.cover, side, side, c.s["cover_focus"]), (ax, ay))
    return art, (ax, ay, ax + side, ay + side)


def _title_artist_right_of(c, layer, style, sq_right):
    z = zones(c)["strip"]
    box = (sq_right + 40, z[1] + 16, z[2] - 32, z[3] - 16)
    text_block(layer, c, box, [(c.s["song"], "title", 100), (c.s["artist"], "sub", 62)], style)


def c1_fit_left(c, style):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    art, sq = _fit_square(c)
    mounted_print(c, layer, art, sq[:2], rect_mask(sq))
    c.window_rim(layer, 0.5)
    _title_artist_right_of(c, layer, style, sq[2])
    return layer


def c2_fit_l(c, style):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    art, sq = _fit_square(c)
    g = 22
    wx0, wy0 = c.Wn[0], c.Wn[1]
    L = ImageChops.lighter(rect_mask((sq[0], sq[1], sq[2], wy0 - g)),
                           rect_mask((sq[0], sq[1], wx0 - g, sq[3])))
    L = ImageChops.multiply(L, rect_mask(sq))
    # soften the inner corner so the L looks cut, not clipped
    L = L.filter(ImageFilter.GaussianBlur(0.8))
    mounted_print(c, layer, art, sq[:2], L)
    _title_artist_right_of(c, layer, style, sq[2])
    return layer


def c3_under_wheels(c, style):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    z = zones(c)
    sx0, sy0, sx1, sy1 = z["strip"]
    pad = 18
    side = int(sy1 - sy0 - 2 * pad)
    ax, ay = sx0 + pad + 8, sy0 + pad
    art = full_frame(cover_crop(c.cover, side, side, c.s["cover_focus"]), (ax, ay))
    mounted_print(c, layer, art, (ax, ay), rect_mask((ax, ay, ax + side, ay + side)), border=2, shadow=0.25)
    text_block(layer, c, (ax + side + 40, sy0 + 14, sx1 - 32, sy1 - 14),
               [(c.s["song"], "title", 112)], style)
    bx0, by0, bx1, by1 = z["band"]
    band = (bx0 + PAD, by0 + 10, bx1 - PAD, by1 - 12)
    _band_pair(c, layer, band, c.s["artist"], c.s["album"], style, 60, on="paper")
    return layer


def _band_pair(c, layer, band, left, right, style, size, on, left_role="sub", left_size=None):
    """Two fields on one line in the band: left-aligned and right-aligned, splitting the
    width in proportion to their natural lengths when both do not fit."""
    tpath, tidx, spath, sidx, scale = STYLES[style]
    f = font(spath, size * scale, sidx)
    fl = font(tpath, (left_size or size) * scale, tidx) if left_role == "title" else f
    gap = 60
    wl, wr = fl.getlength(left), f.getlength(right)
    avail = band[2] - band[0] - gap
    if wl + wr > avail:
        al = max(avail * 0.3, avail * wl / (wl + wr))
        ar = avail - al
    else:
        al, ar = wl + 1, wr + 1
    text_block(layer, c, (band[0], band[1], band[0] + al, band[3]), [(left, left_role, left_size or size)], style, on=on,
               title_lines=1)
    text_block(layer, c, (band[2] - ar, band[1], band[2], band[3]), [(right, "sub", size)], style,
               on=on, align="right", title_lines=1)


def _width_art(c, bottom=None):
    x0, y0, x1, y1 = c.P
    w = int(round(x1 - x0))
    im = c.cover.resize((w, int(round(c.cover.height * w / c.cover.width))), Image.LANCZOS)
    im = print_on_paper(im.crop((0, 0, w, int(round((bottom or y1) - y0)))), paper_grain(c.canvas, c.P), 0.6)
    return im


def c4_fill_top(c, style, title_only=False, art_bottom=None):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(_width_art(c, art_bottom), ir((x0, y0)))
    z = zones(c)["strip"]
    strip_scrim(c, layer, z, 0.8)
    clip(layer, c.label_mask())
    c.window_rim(layer)
    box = (x0 + PAD + 4, y0 + 18, x1 - PAD, z[3] - 18)
    if title_only:
        text_block(layer, c, box, [(c.s["song"], "title", 118)], style, on="dark")
    else:
        text_block(layer, c, box, [(c.s["song"], "title", 104), (c.s["artist"], "sub", 64)], style, on="dark")
    return layer


def c5_split(c, style):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    xm = (x0 + x1) / 2
    art = cover_crop(c.cover, xm - x0, y1 - y0, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, (x0, y0, xm, y1)), 0.6)
    layer.paste(art, ir((x0, y0)))
    clip(layer, c.label_mask())
    c.window_rim(layer, 0.45)
    z = zones(c)
    text_block(layer, c, (xm + 40, y0 + 16, x1 - 32, z["strip"][3] - 14),
               [(c.s["song"], "title", 92), (c.s["artist"], "sub", 58)], style)
    bx0, by0, bx1, by1 = z["band"]
    text_block(layer, c, (xm + 40, by0 + 10, bx1 - PAD, by1 - 12), [(c.s["album"], "sub", 58)], style,
               align="right")
    return layer


def c6_poster_below(c, style):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    art = cover_crop(c.cover, x1 - x0, y1 - y0, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, c.P), 0.6)
    layer.paste(art, ir((x0, y0)))
    bx0, by0, bx1, by1 = zones(c)["band"]
    top = by0 - 60
    sc = gradient(int(x1 - x0), int(y1 - top), [(0, 0.0), (0.35, 0.55), (1, 0.85)])
    layer.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", sc.size, (6, 6, 10)).split(), sc)), ir((x0, top)))
    clip(layer, c.label_mask())
    c.window_rim(layer)
    _band_pair(c, layer, (bx0 + PAD + 4, by0 + 8, bx1 - PAD, by1 - 12), c.s["song"], c.s["artist"],
               style, 60, on="dark", left_role="title", left_size=84)
    return layer


def c7_inverse(c, style):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bx0, by0, bx1, by1 = zones(c)["band"]
    art = cover_crop(c.cover, bx1 - bx0, by1 - by0, (0.5, 0.55))
    art = print_on_paper(art, paper_grain(c.canvas, (bx0, by0, bx1, by1)), 0.6)
    layer.paste(art, ir((bx0, by0)))
    m = ImageChops.multiply(rect_mask((bx0, by0, bx1, by1)), c.label_mask())
    clip(layer, m)
    sx0, sy0, sx1, sy1 = zones(c)["strip"]
    text_block(layer, c, (sx0 + PAD + 4, sy0 + 10, sx1 - PAD, sy1 - 10),
               [(c.s["song"], "title", 150), (c.s["artist"], "sub", 118)], style, title_lines=1)
    return layer


def c8_two_tone(c, style):
    layer = c4_fill_top(c, style, title_only=True, art_bottom=c.Wn[3])
    x0, y0, x1, y1 = c.P
    bx0, by0, bx1, by1 = zones(c)["band"]
    col = dominant_colour(c.cover)
    ink = contrast_ink(col)
    c.band_colour = col
    band = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    grain = paper_grain(c.canvas, (bx0, by0, bx1, by1))
    solid = print_on_paper(Image.new("RGB", ir((bx1 - bx0, by1 - by0)), col), grain, 0.8)
    band.paste(solid.convert("RGBA"), ir((bx0, by0)))
    clip(band, ImageChops.multiply(rect_mask((bx0, by0, bx1, by1)), c.label_mask()))
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(band)
    out.alpha_composite(layer)
    c.window_rim(out, 0.4)
    _band_pair(c, out, (bx0 + PAD + 4, by0 + 10, bx1 - PAD, by1 - 12), c.s["artist"], c.s["album"],
               style, 60, on=("solid", ink))
    return out


FUNCS = {"c1": c1_fit_left, "c2": c2_fit_l, "c3": c3_under_wheels, "c4": c4_fill_top,
         "c5": c5_split, "c6": c6_poster_below, "c7": c7_inverse, "c8": c8_two_tone}


# ------------------------------------------------------------------ outputs

def zoom_box(c):
    x0, y0, x1, y1 = c.S
    return ir((x0 - 20, y0 - 10, x1 + 20, c.P[3] + 50))


def build_stack(names):
    tiles = []
    for cid, name, _, _ in CONCEPTS:
        im = Image.open(os.path.join(OUT, f"{cid}_{SHELLS[0]['id']}_zoom.jpg")).convert("RGB")
        w = 1100
        im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        fb = font(HNEUE, 46, 1)
        fm = font(HNEUE, 30, 10)
        label = f"{cid[1]}"
        d.rounded_rectangle((18, 16, 86, 84), radius=34, fill=(232, 162, 74))
        d.text((52, 51), label, font=fb, fill=(26, 18, 6), anchor="mm")
        tw = fm.getlength(name)
        d.rounded_rectangle((96, 30, 96 + tw + 28, 72), radius=21, fill=(0, 0, 0, 200))
        d.text((110, 51), name, font=fm, fill=(255, 255, 255), anchor="lm")
        tiles.append(im)
    gap = 14
    out = Image.new("RGB", (tiles[0].width, sum(t.height for t in tiles) + gap * (len(tiles) - 1)), (20, 18, 16))
    y = 0
    for t in tiles:
        out.paste(t, (0, y))
        y += t.height + gap
    out.save(os.path.join(OUT, "all-concepts-stack.jpg"), quality=86)


def build_page(meta):
    cards = []
    for cid, name, what, trade in CONCEPTS:
        pick = PICK[cid]
        other = "hand" if pick == "sans" else "sans"
        nice = {"sans": "bold sans", "hand": "Caveat"}
        fulls = "".join(
            f'<figure><button class="shot" data-src="mixtape-label-concepts-2/{cid}_{s["id"]}.jpg" '
            f'aria-label="Enlarge {name} on {s["name"]}"><img '
            f'src="mixtape-label-concepts-2/{cid}_{s["id"]}.jpg" alt="{name} on {s["name"]}"></button>'
            f'<figcaption>{s["name"]}</figcaption></figure>' for s in SHELLS)
        zooms = "".join(
            f'<figure><button class="shot" data-src="mixtape-label-concepts-2/{cid}_{s["id"]}_zoom.jpg" '
            f'aria-label="Enlarge label crop"><img loading="lazy" '
            f'src="mixtape-label-concepts-2/{cid}_{s["id"]}_zoom.jpg" alt="{name} label crop, {s["name"]}"></button>'
            f'<figcaption>Label at 2x</figcaption></figure>' for s in SHELLS)
        alts = "".join(
            f'<figure><button class="shot" data-src="mixtape-label-concepts-2/{cid}_{s["id"]}_zoom_{other}.jpg" '
            f'aria-label="Enlarge alternative font crop"><img loading="lazy" '
            f'src="mixtape-label-concepts-2/{cid}_{s["id"]}_zoom_{other}.jpg" '
            f'alt="{name} in {nice[other]}, {s["name"]}"></button>'
            f'<figcaption>{nice[other]}, {s["name"].split(",")[0]}</figcaption></figure>' for s in SHELLS)
        m = meta[cid]
        cards.append(f"""
<section class="concept" id="{cid}">
  <header><span class="num">{cid[1]}</span><h2>{name}</h2><span class="font">Title: {nice[pick]}</span></header>
  <p class="what">{what}</p>
  <div class="pair">{fulls}</div>
  <div class="pair zoom">{zooms}</div>
  <p class="trade"><strong>Trade-off:</strong> {trade}</p>
  <p class="note"><strong>Font:</strong> {WHY[cid]} <strong>Couch check</strong> (at 1080p, the TV's 50%):
  title caps {m['title']:.0f} px, smallest line {m['min']:.0f} px.{m.get('extra', '')}</p>
  <details><summary>Also tried: the title in {nice[other]}</summary><div class="pair">{alts}</div></details>
</section>""")
    picks = "".join(
        f"""<fieldset data-name="{cid[1]}. {name}"><legend>{cid[1]}. {name}</legend>
  <label><input type="radio" name="{cid}" value="Love it"> Love it</label>
  <label><input type="radio" name="{cid}" value="Maybe"> Maybe</label>
  <label><input type="radio" name="{cid}" value="No"> No</label></fieldset>"""
        for cid, name, _, _ in CONCEPTS)
    toc = "".join(f'<li><a href="#{cid}">{name}</a></li>' for cid, name, _, _ in CONCEPTS)
    html = (TEMPLATE.replace("{{CARDS}}", "".join(cards)).replace("{{PICKS}}", picks)
            .replace("{{TOC}}", toc))
    open(PAGE, "w").write(html)


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mixtape Label Concepts 2</title>
<style>
:root{--bg:#141210;--card:#1d1a17;--ink:#f1ebe2;--muted:#b3a898;--line:#352f29;--accent:#e8a24a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{max-width:1560px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:34px;margin:0 0 6px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:1000px;margin:0 0 20px}
.lede b{color:var(--ink)}
ol.toc{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 24px;padding:0;margin:0 0 28px;list-style:none;counter-reset:c}
ol.toc li{counter-increment:c}
ol.toc a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
ol.toc li::before{content:counter(c) ". ";color:var(--accent);font-weight:600}
.today{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:28px}
.today img{max-width:520px;width:100%;border-radius:6px}
.today p{margin:0;color:var(--muted);flex:1;min-width:240px}
.concept{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 28px}
.concept header{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.num{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--accent);color:#1a1206;font-weight:700}
.font{margin-left:auto;font-size:13px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
h2{margin:0;font-size:24px}
.what{color:var(--muted);margin:8px 0 14px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}
figure{margin:0}
figcaption{font-size:13px;color:var(--muted);margin-top:4px}
.shot{display:block;padding:0;border:0;background:none;cursor:zoom-in;width:100%}
.shot img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
.trade{margin:6px 0 0;padding:10px 12px;border-left:3px solid var(--accent);background:#221e1a;border-radius:0 8px 8px 0}
.note{margin:10px 0 0;color:var(--muted);font-size:14px}
.note strong{color:var(--ink)}
details{margin-top:10px}
summary{cursor:pointer;color:var(--accent);font-size:14px;margin-bottom:10px}
#picks{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
#picks h2{margin-bottom:12px}
fieldset{border:1px solid var(--line);border-radius:10px;margin:0 0 10px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center}
legend{padding:0 6px;font-weight:600}
textarea{width:100%;min-height:110px;background:#12100e;color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit}
button.copy{margin-top:12px;background:var(--accent);color:#1a1206;border:0;border-radius:999px;padding:10px 20px;font-weight:700;font-size:15px;cursor:pointer}
#copied{margin-left:10px;color:var(--muted)}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.92);display:none;align-items:center;justify-content:center;z-index:9;cursor:zoom-out}
#lb.on{display:flex}
#lb img{max-width:98vw;max-height:96vh}
@media (max-width:760px){.pair{grid-template-columns:1fr}h1{font-size:26px}}
</style></head>
<body><main>
<h1>Mixtape label concepts, round 2</h1>
<p class="lede">Your round 1 notes: <b>fit the square art left-aligned with a small border</b>, <b>put some data
under the wheels</b>, <b>fill the art to the label width and let it run off the bottom</b>, and more ideas like
these. The key change from round 1: the whole label face is in play, not just the strip above the window. The
paper also has two columns beside the window and a band below it (about 135 px tall at 4K on the TDK, 155 px on
the Sony). The reels stay fully visible in every concept. Same method as round 1: composited from the real app
assets at 4K, shown at 1080p, the label at 2x underneath. Left: black TDK, "Golden Hour" by Wandering Lights.
Right: white Sony with deliberately long names. Each title was rendered in both the bold sans and Caveat; the
better one is shown and the other is under "Also tried". Click any image to enlarge.</p>
<ol class="toc">{{TOC}}</ol>
<div class="today"><img src="mixtape-label-concepts-2/today_zoom.jpg" alt="Today's label">
<p><b>Today, for comparison.</b> Art 170 px tall at 4K, three lines of Caveat. The couch check under each concept
gives cap heights at 1080p (half the 4K pixels): today's song and album lines have an x-height of about 12 px (caps about 17). Around 20 px and up reads
comfortably from the couch; under 14 px is squinting.</p></div>
{{CARDS}}
<section id="picks"><h2>Your picks</h2>
{{PICKS}}
<label for="notes"><b>Notes</b> (mix and match, sizes, fonts, anything)</label>
<textarea id="notes" placeholder="e.g. 1 with 3's band below, Caveat everywhere, 8 on white shells"></textarea>
<button class="copy" id="copy">Copy decisions</button><span id="copied" aria-live="polite"></span>
</section>
</main>
<div id="lb" role="dialog" aria-modal="true" aria-label="Enlarged image"><img alt=""></div>
<script>
const lb=document.getElementById('lb'),lbi=lb.querySelector('img');
document.querySelectorAll('.shot').forEach(b=>b.addEventListener('click',()=>{lbi.src=b.dataset.src;lbi.alt=b.querySelector('img').alt;lb.classList.add('on')}));
lb.addEventListener('click',()=>lb.classList.remove('on'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on')});
document.getElementById('copy').addEventListener('click',async()=>{
  const lines=['Mixtape label concepts round 2, picks:'];
  document.querySelectorAll('#picks fieldset').forEach(fs=>{
    const c=fs.querySelector('input:checked');lines.push('- '+fs.dataset.name+': '+(c?c.value:'no pick'));});
  const n=document.getElementById('notes').value.trim();if(n)lines.push('Notes: '+n);
  const txt=lines.join('\\n');const out=document.getElementById('copied');
  try{await navigator.clipboard.writeText(txt);out.textContent='Copied.'}
  catch(e){const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();
    try{document.execCommand('copy');out.textContent='Copied.'}catch(_){out.textContent='Copy failed; select the text manually.'}t.remove()}
});
</script>
</body></html>
"""


def main():
    only = sys.argv[1:]  # optional concept ids, for iterating
    os.makedirs(OUT, exist_ok=True)
    manifest, tapes = load_manifest()
    meta = {}
    for shell in SHELLS:
        tape = tapes[shell["id"]]
        base, sprite_s = build_base(manifest, tape)
        for cid, name, _, _ in CONCEPTS:
            if only and cid not in only:
                continue
            for style in ("sans", "hand"):
                c = Ctx(manifest, tape, shell, base, sprite_s)
                LEGIB.clear()
                layer = FUNCS[cid](c, style)
                img = base.copy()
                img.alpha_composite(layer)
                final = finish(img)
                crop = final.crop(zoom_box(c))
                crop.save(os.path.join(OUT, f"{cid}_{shell['id']}_zoom_{style}.jpg"), quality=90)
                if style == PICK[cid]:
                    final.resize((1920, 1080), Image.LANCZOS).save(
                        os.path.join(OUT, f"{cid}_{shell['id']}.jpg"), quality=90)
                    crop.save(os.path.join(OUT, f"{cid}_{shell['id']}_zoom.jpg"), quality=90)
                    if shell is SHELLS[0]:
                        titles = [v for r, v in LEGIB if r == "title"]
                        meta[cid] = {"title": min(titles) if titles else 0,
                                     "min": min(v for _, v in LEGIB)}
                        if cid == "c8":
                            meta[cid]["extra"] = (" Band colour for this cover: rgb" +
                                                  str(c.band_colour) + ".")
                print("wrote", cid, shell["id"], style)
    src = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts", "today_zoom.jpg")
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, "today_zoom.jpg"))
    if not only:
        build_stack(None)
        build_page(meta)
        print("page", PAGE)


if __name__ == "__main__":
    main()
