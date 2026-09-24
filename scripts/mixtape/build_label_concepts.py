"""Mixtape label-layout concepts sheet (six layouts on two real tapes).

Composites the real app assets the way MixtapeView draws a seated tape (deck plate,
open well, tape sprite, dark window cavity with brown packs, hub sprites, label
content, closed door glass as a screen blend, door frame), at 3840x2160, then writes
a 1920x1080 JPEG per concept per tape and a 2x crop of the label (native 4K pixels).

Run from the project root with the system python3 (Pillow + numpy):

    python3 scripts/mixtape/build_label_concepts.py

Covers: art-src/mixtape/reference/covers/*.png (gpt-image-1, text free).
Output: _review/mockups/mixtape-label-concepts/*.jpg, and the page
_review/mockups/mixtape-label-concepts.html is written from PAGE below.
"""

import json
import math
import os

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RES = os.path.join(ROOT, "tvos", "Resources", "Mixtape")
OUT = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts")
PAGE = os.path.join(ROOT, "_review", "mockups", "mixtape-label-concepts.html")
COVERS = os.path.join(ROOT, "art-src", "mixtape", "reference", "covers")
CAVEAT = os.path.join(ROOT, "tvos", "Resources", "Fonts", "Caveat-Regular.ttf")
HNEUE = "/System/Library/Fonts/HelveticaNeue.ttc"  # 1 Bold, 10 Medium

W, H = 3840, 2160
F = 0.35  # wind fraction for the packs (supply fuller than take-up)

SHELLS = [
    {
        "id": "tdk_sax_printed",
        "name": "TDK SA-X (black shell)",
        "cover": "cover_night_city.png",
        "cover_focus": (0.5, 0.42),
        "artist": "Wandering Lights",
        "album": "Long Way Home",
        "song": "Golden Hour",
    },
    {
        "id": "sony_hf_blank",
        "name": "Sony HF (white shell), long names",
        "cover": "cover_warm_abstract.png",
        "cover_focus": (0.5, 0.5),
        "artist": "The Unreasonably Named Orchestra",
        "album": "Long Way Home",
        "song": "A Very Long Song Title That Tests The Label",
    },
]

CONCEPTS = [
    ("c1", "Full bleed",
     "The cover fills the whole paper, window punched through, song and artist in white "
     "over a dark scrim in the strip above the window.",
     "Biggest, most immersive art and the boldest text; the window cuts the cover in half "
     "and the label stops reading as paper."),
    ("c2", "Full bleed, blurred",
     "The cover blurred and darkened fills the paper; the crisp cover is the tallest "
     "square the strip allows, with white song and artist beside it.",
     "Every cover gets a matching colour field and text is always legible; the crisp "
     "art itself is only a little larger than today."),
    ("c3", "Tall art column",
     "The cover as a full-height column left of the window, song and artist in bold "
     "print in the strip above the window.",
     "Art runs the whole label height, but the space left of the window is narrow, so "
     "it is a portrait slice of the cover, not the whole square."),
    ("c4", "Wide banner",
     "The cover cropped wide across the entire strip above the window, bold white "
     "song and artist over a scrim on its lower part.",
     "Strong, poster-like and very legible; the cover is cropped to a letterbox, so "
     "faces or centred subjects can be cut."),
    ("c5", "Two-line hierarchy",
     "Today's layout, but the art as tall as the strip allows and only two lines: the "
     "song in Caveat at about 1.8x, the artist under it.",
     "The smallest change and still a mixtape you wrote by hand; the art grows only "
     "about 20%."),
    ("c6", "Sticker",
     "An oversized cover with a white border, stuck on at a 3 degree tilt with a soft "
     "shadow, overlapping the label edge into the shell; handwriting beside it.",
     "The most charming and the largest crisp square; it hides part of the shell and "
     "needs the tilt and shadow to look stuck on, not pasted."),
]


# ---------------------------------------------------------------- geometry

def load_manifest():
    m = json.load(open(os.path.join(RES, "mixtape-manifest.json")))
    return m, {t["id"]: t for t in m["tapes"]}


def px_rect(r):
    return (r["x"] * W, r["y"] * H, (r["x"] + r["w"]) * W, (r["y"] + r["h"]) * H)


def ir(b):
    return tuple(int(round(v)) for v in b)


def paper_rect(tape, sprite):
    """The whole label paper. labelRect, except on a dark shell where the printed
    paper visibly starts above it: measure the light paper in the sprite there."""
    lx0, ly0, lx1, ly1 = px_rect(tape["labelRect"])
    if tape.get("shell") != "black":
        return (lx0, ly0, lx1, ly1)
    sx0, sy0, _, _ = px_rect(tape["spriteRect"])
    lum = np.array(sprite.convert("L")).astype(int)
    cx = int(lx0 - sx0 + 40)
    col = np.where(lum[:, cx] > 110)[0]
    top = sy0 + col.min()
    return (lx0, min(ly0, top), lx1, ly1)


# ---------------------------------------------------------------- helpers

def rounded_mask(size, box, radius, scale=4):
    """Anti-aliased rounded-rect mask (L) of `size`, box in pixel coords."""
    w, h = size
    big = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle([v * scale for v in box], radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


def capsule_box(tape, grow=0):
    x0, y0, x1, y1 = px_rect(tape["windowRect"])
    return (x0 - grow, y0 - grow, x1 + grow, y1 + grow), (y1 - y0) / 2 + grow


def cover_crop(img, w, h, focus=(0.5, 0.5)):
    """Scale to cover w x h and crop around focus (fractions)."""
    w, h = int(round(w)), int(round(h))
    s = max(w / img.width, h / img.height)
    im = img.resize((max(w, int(math.ceil(img.width * s))), max(h, int(math.ceil(img.height * s)))), Image.LANCZOS)
    x = int(round((im.width - w) * focus[0]))
    y = int(round((im.height - h) * focus[1]))
    return im.crop((x, y, x + w, y + h))


def font(path, size, index=0):
    return ImageFont.truetype(path, int(round(size)), index=index)


def fit_text(text, path, size, maxw, index=0, min_scale=0.7):
    """Shrink to fit down to min_scale, then truncate with an ellipsis."""
    s = size
    while s > size * min_scale:
        f = font(path, s, index)
        if f.getlength(text) <= maxw:
            return text, f
        s -= 2
    f = font(path, size * min_scale, index)
    t = text
    while t and f.getlength(t.rstrip() + "…") > maxw:
        t = t[:-1]
    return t.rstrip() + "…", f


def draw_text(layer, xy, text, f, fill, shadow=0.0, shadow_r=10, anchor="ls"):
    """Text at a left-baseline anchor, with an optional soft dark halo."""
    if shadow > 0:
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(sh)
        d.text(xy, text, font=f, fill=(0, 0, 0, int(255 * shadow)), anchor=anchor)
        sh = sh.filter(ImageFilter.GaussianBlur(shadow_r))
        layer.alpha_composite(sh)
        layer.alpha_composite(sh)
    ImageDraw.Draw(layer).text(xy, text, font=f, fill=fill, anchor=anchor)


def paste_rgba(layer, img, xy, mask=None):
    im = img.convert("RGBA")
    if mask is not None:
        a = ImageChops.multiply(im.getchannel("A"), mask)
        im.putalpha(a)
    tmp = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    tmp.paste(im, (int(round(xy[0])), int(round(xy[1]))))
    layer.alpha_composite(tmp)


def gradient(w, h, stops, horizontal=False):
    """Alpha ramp (L) of w x h from a list of (t, alpha 0..1) stops."""
    n = w if horizontal else h
    t = np.linspace(0, 1, n)
    ts, vs = zip(*stops)
    a = (np.interp(t, ts, vs) * 255).astype(np.uint8)
    arr = np.tile(a, (h, 1)) if horizontal else np.tile(a[:, None], (1, w))
    return Image.fromarray(arr, "L")


def paper_grain(canvas, box):
    """High-pass of the tape's own paper, to lay over printed art."""
    reg = canvas.crop(ir(box)).convert("L")
    hp = np.array(reg).astype(float) - np.array(reg.filter(ImageFilter.GaussianBlur(18))).astype(float)
    return hp


def print_on_paper(img, grain, strength=0.9):
    a = np.array(img.convert("RGB")).astype(float)
    g = grain[: a.shape[0], : a.shape[1]]
    a = a + g[..., None] * strength
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- base scene

def build_base(manifest, tape):
    deck = manifest["deck"]
    canvas = Image.open(os.path.join(RES, "deck", "deck_empty.png")).convert("RGBA")
    well = Image.open(os.path.join(RES, "deck", "well_open.png")).convert("RGBA")
    dx0, dy0, dx1, dy1 = ir(px_rect(deck["door"]))
    canvas.alpha_composite(well.resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), (dx0, dy0))

    sprite = Image.open(os.path.join(RES, tape["files"]["tape"])).convert("RGBA")
    sx0, sy0, sx1, sy1 = px_rect(tape["spriteRect"])
    sprite_s = sprite.resize((int(round(sx1 - sx0)), int(round(sy1 - sy0))), Image.LANCZOS)
    canvas.alpha_composite(sprite_s, (int(round(sx0)), int(round(sy0))))

    # Window cavity + packs, clipped to the window capsule.
    cb, cr = capsule_box(tape)
    cap = rounded_mask((W, H), cb, cr)
    win = Image.new("RGBA", (W, H), (8, 8, 8, 255))
    cx, cy = (cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([cx - (cb[2] - cb[0]) * 0.4, cy - (cb[3] - cb[1]) * 0.45,
                                  cx + (cb[2] - cb[0]) * 0.4, cy + (cb[3] - cb[1]) * 0.45], fill=22)
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    win.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (255, 168, 76)).split(), glow)))

    r0, R = tape["packMinRadius"], tape["packMaxRadius"]
    rs = math.sqrt(R * R - F * (R * R - r0 * r0)) * W
    rt = math.sqrt(r0 * r0 + F * (R * R - r0 * r0)) * W
    pack = Image.open(os.path.join(RES, "deck", "pack_shared.png")).convert("RGBA")
    for hub, r, ang in ((tape["hubL"], rs, 17), (tape["hubR"], rt, 71)):
        d = int(round(2 * r))
        p = pack.resize((d, d), Image.LANCZOS).rotate(ang, Image.BICUBIC)
        rgb = p.convert("RGB")
        gray = ImageOps.grayscale(rgb).convert("RGB")
        rgb = Image.blend(gray, rgb, 0.72)
        arr = np.array(rgb).astype(float) + 26
        yy, xx = np.mgrid[0:d, 0:d]
        rr = np.hypot(xx - d / 2, yy - d / 2) / (d / 2)
        dark = np.interp(rr, [0, 0.5, 0.8, 1.0], [1, 1, 0.82, 0.58])
        hl = np.clip(1 - np.hypot(xx - d * 0.30, yy - d * 0.28) / (d * 0.62), 0, 1) * 0.30
        arr = arr * dark[..., None]
        amber = np.array([255, 168, 76], float)
        arr = 255 - (255 - arr) * (1 - hl[..., None] * amber / 255)
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        out.putalpha(p.getchannel("A"))
        win.alpha_composite(out, (int(round(hub["x"] * W - d / 2)), int(round(hub["y"] * H - d / 2))))
    win.putalpha(ImageChops.multiply(win.getchannel("A"), cap))
    canvas.alpha_composite(win)

    hubimg = Image.open(os.path.join(RES, tape["files"]["hub"])).convert("RGBA")
    hd = int(round(2 * tape["hubRadius"] * W))
    for hub, ang in ((tape["hubL"], 12), (tape["hubR"], 12 + 23)):
        h = hubimg.resize((hd, hd), Image.LANCZOS).rotate(ang, Image.BICUBIC)
        canvas.alpha_composite(h, (int(round(hub["x"] * W - hd / 2)), int(round(hub["y"] * H - hd / 2))))
    return canvas, sprite_s


def finish(canvas):
    """Closed door: glass as a screen blend (reflections only), then the frame."""
    glass = Image.open(os.path.join(RES, "deck", "door_glass.png")).convert("RGBA")
    frame = Image.open(os.path.join(RES, "deck", "door_frame.png")).convert("RGBA")
    base = np.array(canvas.convert("RGB")).astype(float) / 255
    g = np.array(glass).astype(float) / 255
    gs = g[..., :3] * g[..., 3:4]
    out = 1 - (1 - base) * (1 - gs)
    img = Image.fromarray((out * 255).astype(np.uint8), "RGB").convert("RGBA")
    img.alpha_composite(frame)
    return img.convert("RGB")


# ---------------------------------------------------------------- concepts

class Ctx:
    def __init__(self, manifest, tape, shell, canvas, sprite_s):
        self.m, self.t, self.s = manifest, tape, shell
        self.canvas = canvas
        self.P = paper_rect(tape, sprite_s)
        self.Wn = px_rect(tape["windowRect"])
        self.S = px_rect(tape["spriteRect"])
        self.cover = Image.open(os.path.join(COVERS, shell["cover"])).convert("RGB")
        self.ink = tape.get("inkColor", "#1d2a6b")
        # today's Caveat sizes: size so that the x-height matches the manifest
        cav = font(CAVEAT, 200)
        xh = -cav.getbbox("x", anchor="ls")[1] / 200
        self.cav_song_today = tape["textLines"][2]["xHeight"] * H / xh
        self.cav_artist_today = tape["textLines"][0]["xHeight"] * H / xh
        self.paper_radius = 22

    @property
    def strip(self):
        x0, y0, x1, _ = self.P
        return (x0, y0, x1, self.Wn[1])

    def label_mask(self, gap=0):
        """Paper minus the window capsule (grown by gap)."""
        m = rounded_mask((W, H), self.P, self.paper_radius)
        cb, cr = capsule_box(self.t, gap)
        hole = rounded_mask((W, H), cb, cr)
        return ImageChops.subtract(m, hole)

    def window_rim(self, layer, alpha=0.55, width=5):
        cb, cr = capsule_box(self.t, 2)
        rim = Image.new("L", (W, H), 0)
        ImageDraw.Draw(rim).rounded_rectangle(cb, radius=cr, outline=int(255 * alpha), width=width)
        rim = rim.filter(ImageFilter.GaussianBlur(2))
        layer.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (0, 0, 0)).split(), rim)))


def c1_full_bleed(c):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    art = cover_crop(c.cover, x1 - x0, y1 - y0, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, c.P), 0.6)
    layer.paste(art, ir((x0, y0)))
    # Scrim over the strip, heaviest top-left where the text sits.
    sx0, sy0, sx1, sy1 = c.strip
    sw, sh = int(x1 - x0), int(sy1 - sy0 + 40)
    hor = np.array(gradient(sw, sh, [(0, 0.78), (0.55, 0.55), (1, 0.12)], horizontal=True)).astype(float)
    ver = np.array(gradient(sw, sh, [(0, 1.0), (0.75, 0.85), (1, 0.0)])).astype(float)
    a = Image.fromarray((hor * ver / 255).astype(np.uint8), "L")
    layer.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (sw, sh), (6, 6, 10)).split(), a)), ir((x0, y0)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), c.label_mask()))
    c.window_rim(layer)
    pad = 44
    maxw = (x1 - x0) - 2 * pad
    t, f = fit_text(c.s["song"], HNEUE, 104, maxw, 1)
    draw_text(layer, (x0 + pad, y0 + 34 + 76), t, f, (255, 255, 255, 255), shadow=0.6, shadow_r=8)
    t, f = fit_text(c.s["artist"], HNEUE, 64, maxw, 10)
    draw_text(layer, (x0 + pad, y0 + 34 + 76 + 74), t, f, (255, 255, 255, 235), shadow=0.6, shadow_r=8)
    return layer


def c2_blurred(c):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bg = cover_crop(c.cover, x1 - x0, y1 - y0, c.s["cover_focus"]).filter(ImageFilter.GaussianBlur(46))
    bg = Image.eval(bg, lambda v: int(v * 0.58))
    bg = print_on_paper(bg, paper_grain(c.canvas, c.P), 0.5)
    layer.paste(bg, ir((x0, y0)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), c.label_mask()))
    c.window_rim(layer, 0.4)
    sx0, sy0, sx1, sy1 = c.strip
    pad = 20
    side = int(sy1 - sy0 - 2 * pad)
    art = cover_crop(c.cover, side, side, c.s["cover_focus"])
    ax, ay = x0 + pad + 6, sy0 + pad
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle([ax + 4, ay + 8, ax + side + 4, ay + side + 8], fill=(0, 0, 0, 150))
    layer.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)))
    layer.paste(art, ir((ax, ay)))
    ImageDraw.Draw(layer).rectangle([ax - 1, ay - 1, ax + side, ay + side], outline=(255, 255, 255, 90), width=2)
    tx = ax + side + 40
    maxw = x1 - 36 - tx
    mid = (sy0 + sy1) / 2
    t, f = fit_text(c.s["song"], HNEUE, 96, maxw, 1)
    draw_text(layer, (tx, mid + 4), t, f, (255, 255, 255, 255), shadow=0.5, shadow_r=6)
    t, f = fit_text(c.s["artist"], HNEUE, 62, maxw, 10)
    draw_text(layer, (tx, mid + 4 + 74), t, f, (255, 255, 255, 220), shadow=0.5, shadow_r=6)
    return layer


def c3_column(c):
    x0, y0, x1, y1 = c.P
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gap = 26
    cw = int(c.Wn[0] - gap - x0)
    art = cover_crop(c.cover, cw, y1 - y0, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, (x0, y0, x0 + cw, y1)), 0.6)
    layer.paste(art, ir((x0, y0)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), c.label_mask()))
    sx0, sy0, sx1, sy1 = c.strip
    tx = x0 + cw + 40
    maxw = x1 - 36 - tx
    mid = (sy0 + sy1) / 2
    ink = (24, 24, 28, 255)
    t, f = fit_text(c.s["song"], HNEUE, 96, maxw, 1)
    draw_text(layer, (tx, mid + 8), t, f, ink)
    t, f = fit_text(c.s["artist"], HNEUE, 62, maxw, 10)
    draw_text(layer, (tx, mid + 8 + 72), t, f, (60, 60, 66, 255))
    return layer


def c4_banner(c):
    x0, y0, x1, y1 = c.P
    sx0, sy0, sx1, sy1 = c.strip
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bh = int(sy1 - 16 - y0)
    art = cover_crop(c.cover, x1 - x0, bh, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, (x0, y0, x1, y0 + bh)), 0.6)
    layer.paste(art, ir((x0, y0)))
    sc = gradient(int(x1 - x0), bh, [(0, 0.0), (0.3, 0.12), (1, 0.8)])
    layer.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", sc.size, (6, 6, 10)).split(), sc)), ir((x0, y0)))
    m = rounded_mask((W, H), (x0, y0, x1, y0 + bh), c.paper_radius)
    m2 = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m2).rectangle([x0, y0 + bh - 30, x1, y0 + bh], fill=255)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), ImageChops.lighter(m, ImageChops.multiply(m2, c.label_mask()))))
    pad = 44
    maxw = (x1 - x0) - 2 * pad
    by = y0 + bh - 30
    t, f = fit_text(c.s["artist"], HNEUE, 62, maxw, 10)
    draw_text(layer, (x0 + pad, by), t, f, (255, 255, 255, 230), shadow=0.55, shadow_r=6)
    t, f = fit_text(c.s["song"], HNEUE, 100, maxw, 1)
    draw_text(layer, (x0 + pad, by - 70), t, f, (255, 255, 255, 255), shadow=0.55, shadow_r=6)
    return layer


def c5_two_line(c):
    x0, y0, x1, y1 = c.P
    sx0, sy0, sx1, sy1 = c.strip
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pad = 16
    side = int(sy1 - sy0 - 2 * pad)
    art = cover_crop(c.cover, side, side, c.s["cover_focus"])
    art = print_on_paper(art, paper_grain(c.canvas, (x0 + pad, sy0 + pad, x0 + pad + side, sy0 + pad + side)), 0.7)
    layer.paste(art, ir((x0 + pad + 6, sy0 + pad)))
    tx = x0 + pad + 6 + side + 40
    maxw = x1 - 30 - tx
    mid = (sy0 + sy1) / 2
    ink = c.ink
    t, f = fit_text(c.s["song"], CAVEAT, c.cav_song_today * 1.8, maxw)
    draw_text(layer, (tx, mid - 2), t, f, ink)
    t, f = fit_text(c.s["artist"], CAVEAT, c.cav_song_today * 1.4, maxw)
    draw_text(layer, (tx, mid + 84), t, f, ink)
    return layer


def c6_sticker(c):
    x0, y0, x1, y1 = c.P
    sx0, sy0, sx1, sy1 = c.strip
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cb, cr = capsule_box(c.t, 10)
    hole = np.array(rounded_mask((W, H), cb, cr)) > 8
    Sx0, Sy0, Sx1, Sy1 = c.S
    strip_h = sy1 - sy0
    border = 16
    best = None
    for scale in np.arange(1.45, 1.0, -0.03):
        side = int(strip_h * scale)
        full = side + 2 * border
        st = Image.new("RGBA", (full, full), (250, 248, 242, 255))
        st.paste(cover_crop(c.cover, side, side, c.s["cover_focus"]), (border, border))
        rot = st.rotate(3, Image.BICUBIC, expand=True)
        a = np.array(rot.getchannel("A")) > 8
        rh, rw = a.shape
        # search positions: top-left inside the sprite, as far up-left as allowed
        for yy in range(int(Sy0 + 14), int(sy1), 6):
            ok = None
            for xx in range(int(Sx0 + 20), int(x0 + 60), 6):
                if yy + rh > H or xx + rw > c.Wn[0] + (c.Wn[2] - c.Wn[0]) / 2:
                    continue
                sub = hole[yy:yy + rh, xx:xx + rw]
                if not (sub & a).any():
                    ok = xx
                    break
            if ok is not None:
                best = (rot, ok, yy, side)
                break
        if best:
            break
    rot, bx, by, side = best
    c.sticker_scale = side / strip_h
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
    shadow.putalpha(rot.getchannel("A").point(lambda v: int(v * 0.55)))
    sh.alpha_composite(shadow, (bx + 6, by + 12))
    layer.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
    layer.alpha_composite(rot, (bx, by))
    tx = bx + rot.width + 34
    maxw = x1 - 30 - tx
    mid = (sy0 + sy1) / 2
    t, f = fit_text(c.s["song"], CAVEAT, c.cav_song_today * 1.8, maxw)
    draw_text(layer, (tx, mid - 2), t, f, c.ink)
    t, f = fit_text(c.s["artist"], CAVEAT, c.cav_song_today * 1.4, maxw)
    draw_text(layer, (tx, mid + 84), t, f, c.ink)
    return layer


FUNCS = {"c1": c1_full_bleed, "c2": c2_blurred, "c3": c3_column,
         "c4": c4_banner, "c5": c5_two_line, "c6": c6_sticker}


# ---------------------------------------------------------------- page

def build_page(meta):
    cards = []
    for cid, name, what, trade in CONCEPTS:
        fulls = "".join(
            f'<figure><button class="shot" data-src="mixtape-label-concepts/{cid}_{s["id"]}.jpg" '
            f'aria-label="Enlarge {name} on {s["name"]}"><img loading="lazy" '
            f'src="mixtape-label-concepts/{cid}_{s["id"]}.jpg" alt="{name} on {s["name"]}"></button>'
            f'<figcaption>{s["name"]}</figcaption></figure>' for s in SHELLS)
        zooms = "".join(
            f'<figure><button class="shot" data-src="mixtape-label-concepts/{cid}_{s["id"]}_zoom.jpg" '
            f'aria-label="Enlarge label crop"><img loading="lazy" '
            f'src="mixtape-label-concepts/{cid}_{s["id"]}_zoom.jpg" alt="{name} label crop, {s["name"]}"></button>'
            f'<figcaption>Label at 2x</figcaption></figure>' for s in SHELLS)
        extra = meta.get(cid, "")
        cards.append(f"""
<section class="concept" id="{cid}">
  <header><span class="num">{cid[1]}</span><h2>{name}</h2></header>
  <p class="what">{what}</p>
  <div class="pair">{fulls}</div>
  <div class="pair zoom">{zooms}</div>
  <p class="trade"><strong>Trade-off:</strong> {trade}{extra}</p>
</section>""")
    picks = "".join(
        f"""<fieldset data-name="{name}"><legend>{cid[1]}. {name}</legend>
  <label><input type="radio" name="{cid}" value="Love it"> Love it</label>
  <label><input type="radio" name="{cid}" value="Maybe"> Maybe</label>
  <label><input type="radio" name="{cid}" value="No"> No</label></fieldset>"""
        for cid, name, _, _ in CONCEPTS)
    html = TEMPLATE.replace("{{CARDS}}", "".join(cards)).replace("{{PICKS}}", picks)
    open(PAGE, "w").write(html)


TEMPLATE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mixtape Label Concepts</title>
<style>
:root{--bg:#141210;--card:#1d1a17;--ink:#f1ebe2;--muted:#b3a898;--line:#352f29;--accent:#e8a24a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif}
main{max-width:1560px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:34px;margin:0 0 6px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:980px;margin:0 0 20px}
.lede b{color:var(--ink)}
ol.toc{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px 24px;padding:0;margin:0 0 28px;list-style:none;counter-reset:c}
ol.toc li{counter-increment:c}
ol.toc a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line)}
ol.toc li::before{content:counter(c) ". ";color:var(--accent);font-weight:600}
.today{display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:28px}
.today img{max-width:520px;width:100%;border-radius:6px}
.today p{margin:0;color:var(--muted);flex:1;min-width:240px}
.concept{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 28px}
.concept header{display:flex;align-items:center;gap:12px}
.num{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--accent);color:#1a1206;font-weight:700}
h2{margin:0;font-size:24px}
.what{color:var(--muted);margin:8px 0 14px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}
figure{margin:0}
figcaption{font-size:13px;color:var(--muted);margin-top:4px}
.shot{display:block;padding:0;border:0;background:none;cursor:zoom-in;width:100%}
.shot img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
.trade{margin:6px 0 0;padding:10px 12px;border-left:3px solid var(--accent);background:#221e1a;border-radius:0 8px 8px 0}
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
<h1>Mixtape label concepts</h1>
<p class="lede">Your note from the TV: the tape looks great, but the <b>album art must be much larger</b> and the
<b>song and artist bigger</b>. Six label layouts, each composited from the real app assets (deck plate, open well,
tape sprite, live brown packs and hubs, closed door glass and frame) at 4K, shown at 1080p. Left: the black TDK with
"Golden Hour" by Wandering Lights. Right: the white Sony with deliberately long names, to show shrink to fit and the
ellipsis. Under each pair is the label at 2x. Click any image to enlarge. Covers are generated, text free stand-ins.</p>
<ol class="toc">
<li><a href="#c1">Full bleed</a></li><li><a href="#c2">Full bleed, blurred</a></li><li><a href="#c3">Tall art column</a></li>
<li><a href="#c4">Wide banner</a></li><li><a href="#c5">Two-line hierarchy</a></li><li><a href="#c6">Sticker</a></li>
</ol>
<div class="today"><img src="mixtape-label-concepts/today_zoom.jpg" alt="Today's label">
<p><b>Today, for comparison.</b> Art 170 px tall at 4K, three lines of Caveat at 23 to 32 px x-height. The strip above
the window is only about 230 px tall at 4K (115 px at 1080p), which is the real constraint on every concept below:
anything bigger either covers the whole paper, borrows the window's sides, or spills onto the shell.</p></div>
{{CARDS}}
<section id="picks"><h2>Your picks</h2>
{{PICKS}}
<label for="notes"><b>Notes</b> (mix and match, sizes, fonts, anything)</label>
<textarea id="notes" placeholder="e.g. 4 on dark shells, 6 on white shells, text 10% bigger"></textarea>
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
  const lines=['Mixtape label concepts, picks:'];
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
    os.makedirs(OUT, exist_ok=True)
    manifest, tapes = load_manifest()
    meta = {}
    for shell in SHELLS:
        tape = tapes[shell["id"]]
        base, sprite_s = build_base(manifest, tape)
        for cid, name, _, _ in CONCEPTS:
            c = Ctx(manifest, tape, shell, base, sprite_s)
            layer = FUNCS[cid](c)
            img = base.copy()
            img.alpha_composite(layer)
            final = finish(img)
            final.resize((1920, 1080), Image.LANCZOS).save(
                os.path.join(OUT, f"{cid}_{shell['id']}.jpg"), quality=90)
            x0, y0, x1, y1 = c.S
            crop = final.crop(ir((x0 - 20, y0 - 10, x1 + 20, c.P[3] + 50)))
            crop.save(os.path.join(OUT, f"{cid}_{shell['id']}_zoom.jpg"), quality=90)
            if cid == "c6" and shell is SHELLS[0]:
                meta["c6"] = f" (Here the sticker is {c.sticker_scale:.2f}x the strip height, the largest that clears the window.)"
            print("wrote", cid, shell["id"])
    today = os.path.join(ROOT, "_review", "mixtape", "final2", "01-seated-printed-early.png")
    if os.path.exists(today):
        t = tapes["tdk_sax_printed"]
        x0, y0, x1, y1 = px_rect(t["spriteRect"])
        Image.open(today).convert("RGB").crop(ir((x0 - 20, y0 - 10, x1 + 20, px_rect(t["labelRect"])[3] + 50))).save(
            os.path.join(OUT, "today_zoom.jpg"), quality=90)
    build_page(meta)
    print("page", PAGE)


if __name__ == "__main__":
    main()
