#!/usr/bin/env python3
"""Mixtape deck plate, edit pass 2 (2026-10-09): wordmark, key glow, output knob.

Reads the needle-free 4K plate tvos/Resources/Mixtape/deck/deck_empty.png
(written by remove_needles.py) and never overwrites it. Everything is hand work
(cloning, Poisson blending, typesetting); no image generation.

  1. NIKOLAUS wordmark. HORIZON is erased by a Poisson (seamless) clone of the
     brushed faceplate directly below it (same horizontal brush; the gradient
     solve matches the patch to its border so there is no seam), then NIKOLAUS
     is typeset in SF Pro (the variable /System/Library/Fonts/SFNS.ttf at
     wdth 121, wght 610, i.e. between Semi Expanded and Expanded, Semibold),
     which fits HORIZON best of every face on this Mac (per-letter IoU 0.74;
     Futura Medium 0.43, Avenir Next Demi Bold 0.52, Gill Sans 0.63; no
     Eurostile / Microgramma here). Same cap height (45 px), baseline (y 202),
     left edge (x 210) and ink; tracking fitted to HORIZON's letter positions
     (13.2 px), then 2.5 px tighter so eight letters keep a 69 px gap to
     "STEREO" (HORIZON left 98), plus light kerning of LA and KO;
     near-black ink sampled from HORIZON, 0.45 px blur for the print softness.
       -> art-src/mixtape/plates/deck_empty_nikolaus.png
          art-src/mixtape/plates/wordmark-compare.png (2x, HORIZON over NIKOLAUS)
  2. Key glow as state. The PLAY key's amber strip (cap bevel, the glow in the
     gap above it, the warm line on the faceplate edge) is replaced by the FF
     key's same rows, x-remapped onto PLAY's cap edges and multiplied by a
     per-channel gain field interpolated between the two keys' tone just above
     and below the patch (a log-domain seamless clone), so PLAY keeps its own
     sheen. The lamp sprites are drawn source-over, NOT additively: an additive
     lit - unlit sprite was tried and rejected because the unlit cap has a white
     bevel highlight under the strip, which added light cannot turn amber (it
     blew out with colour fringes). glow_play.png is the lit rows themselves
     (opacity 1 reproduces the photo, mean error 0.2 levels); glow_pause.png is
     the same rows remapped onto the PAUSE cap (that cap is 345 px wide against
     PLAY's 394), with PAUSE's sheen on the metal and the lamp light unscaled.
       -> art-src/mixtape/plates/deck_empty_nikolaus_unlit.png
          tvos/Resources/Mixtape/deck/glow_play.png, glow_pause.png
          art-src/mixtape/plates/glow-compare.png (unlit / PLAY lit / PAUSE lit)
  3. OUTPUT knob. The rotating part is the cone-brushed top face (the chrome
     skirt and the dark rim stay in the plate: they are round, so they look the
     same at any rotation, and the skirt's lit side must not turn). knob.png is
     that face with the indicator dot, a centred disc with a 1 px feathered
     edge. Under it the plate gets the same face with the dot painted out
     (radial interpolation: the cone brushing is constant along radii), so the
     1 px feather lands on matching metal and the plate reads as a knob even
     with no sprite drawn.
       -> tvos/Resources/Mixtape/deck/knob.png, knob_dot.png (dot only, same
          canvas, for a static-face option), deck_empty_v2.png (final plate)
          art-src/mixtape/plates/knob-compare.png (0 / 50 / 100 % volume)

Finally merges "glows" and "knob" into art-src/mixtape/plates/plate-manifest.json.
Rerun this after
gen_deck_plate.py finish (which rewrites the manifest).

    python3 scripts/mixtape/edit_deck_plate.py

Needs numpy, opencv-python, Pillow (FreeType variable font support).
"""
import functools
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P = lambda *a: os.path.join(ROOT, *a)
SRC = P('tvos/Resources/Mixtape/deck/deck_empty.png')
PLATES = P('art-src/mixtape/plates')
DECK = P('tvos/Resources/Mixtape/deck')
MANIFEST = os.path.join(PLATES, 'plate-manifest.json')

base = cv2.imread(SRC, cv2.IMREAD_COLOR)
H, W = base.shape[:2]
assert (W, H) == (3840, 2160), (W, H)


def save(path, img):
    cv2.imwrite(path, img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    print('wrote', os.path.relpath(path, ROOT), img.shape[1], 'x', img.shape[0])


def up2(img):
    return cv2.resize(img, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)


def label(img, text):
    out = img.copy()
    cv2.putText(out, text, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(out, text, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def rect_norm(x0, y0, x1, y1):
    """Pixel-edge rect -> normalised {x, y, w, h}."""
    return {'x': round(x0 / W, 5), 'y': round(y0 / H, 5), 'w': round((x1 - x0) / W, 5), 'h': round((y1 - y0) / H, 5)}


# ---------------------------------------------------------------- 1. wordmark
# HORIZON, measured on the plate: ink rows 157..202 (alpha > 0.5), letters'
# left ink edges below, near-black ink (BGR about 9, 12, 16).
HZ_LEFTS = [210, 274, 345, 410, 439, 495, 565]
CAP_TOP, CAP_PX = 157.0, 45.0          # continuous cap height
FONT = '/System/Library/Fonts/SFNS.ttf'
FONT_VAR = [121, 28, 400, 610]          # wdth, opsz, GRAD, wght
BLUR = 0.45
SS = 8                                  # supersampling for glyph rendering

# (a) erase: Poisson clone of the faceplate directly below the word.
ER = (198, 148, 624, 212)               # x0, y0, x1, y1 (pixel edges)
SHIFT = ER[3] - ER[1] + 2               # source rows start just below the patch
x0, y0, x1, y1 = ER
pad = 4
patch = base[y0 - pad + SHIFT:y1 + pad + SHIFT, x0 - pad:x1 + pad].copy()
mask = np.zeros(patch.shape[:2], np.uint8)
mask[pad:-pad, pad:-pad] = 255
center = ((x0 - pad + x1 + pad) // 2, (y0 - pad + y1 + pad) // 2)
erased = cv2.seamlessClone(patch, base, mask, center, cv2.NORMAL_CLONE)
# seamlessClone can land a pixel off; keep only our rect, feathered 3 px into it.
fe = np.zeros((H, W), np.float32)
fe[y0:y1, x0:x1] = 1
fe = cv2.GaussianBlur(fe, (0, 0), 1.5) * (fe > 0)
fe = cv2.GaussianBlur(fe, (0, 0), 1.0)
erased = (base * (1 - fe[..., None]) + erased * fe[..., None]).round().astype(np.uint8)

# (b) typeset. Size from the H cap height; tracking fitted to HORIZON's letter
# positions; the whole pipeline (render, 8x supersample, blur) is registered by
# rendering HORIZON and matching it to the plate's HORIZON before NIKOLAUS uses
# the same offsets.
def make_font(px):
    f = ImageFont.truetype(FONT, int(round(px * SS)))
    f.set_variation_by_axes(FONT_VAR)
    return f


def glyph_alpha(f, text, pad=20):
    """Supersampled alpha of text drawn with its pen origin at (pad, pad)*SS."""
    w = int(f.getlength(text)) + 2 * pad * SS
    img = Image.new('L', (w, int(f.size * 1.5) + 2 * pad * SS), 0)
    ImageDraw.Draw(img).text((pad * SS, pad * SS), text, font=f, fill=255)
    return np.asarray(img, np.float32) / 255


def ink_extent(a, axis):
    idx = np.nonzero(a.max(axis) > 0.5)[0]
    return idx.min(), idx.max() + 1


fH = make_font(100)
r0_, r1_ = ink_extent(glyph_alpha(fH, 'H'), 1)
size = 100 * CAP_PX / ((r1_ - r0_) / SS)
font = make_font(size)
CAP_OFF = (ink_extent(glyph_alpha(font, 'H'), 1)[0] / SS) - 20     # pen y -> cap top


@functools.lru_cache(maxsize=None)
def metrics(word):
    adv = [font.getlength(c) / SS for c in word]
    lsb = [ink_extent(glyph_alpha(font, c), 0)[0] / SS - 20 for c in word]
    return adv, lsb


adv, lsb = metrics('HORIZON')
cum = np.r_[0, np.cumsum(adv)[:-1]]
M = np.c_[np.ones(7), np.arange(7)]
(p0, TRACK), *_ = np.linalg.lstsq(M, np.array(HZ_LEFTS) - cum - np.array(lsb), rcond=None)
print(f'font size {size:.2f}px, tracking {TRACK:.2f}px (fitted to HORIZON)')

WORD = 'NIKOLAUS'
# Eight letters at HORIZON's tracking run to x 657, 50 px short of "STEREO"
# (HORIZON leaves 98). Tighten NIKOLAUS's tracking a little so the gap stays
# near 70 px, plus light optical kerning of the open pairs.
NIK_TRACK = TRACK - 2.5
KERN = {'LA': -4.0, 'KO': -1.5}
BX0, BY0, BX1, BY1 = 180, 140, 800, 225   # render box on the plate


def render_word(word, track, kern, left_ink, dx=0.0, dy=0.0):
    adv, lsb = metrics(word)
    pen = left_ink - lsb[0]
    img = Image.new('L', ((BX1 - BX0) * SS, (BY1 - BY0) * SS), 0)
    d = ImageDraw.Draw(img)
    for i, c in enumerate(word):
        d.text((round((pen + dx - BX0) * SS), round((CAP_TOP + dy - CAP_OFF - BY0) * SS)), c, font=font, fill=255)
        pen += adv[i] + track + (kern.get(word[i:i + 2], 0.0) if i + 1 < len(word) else 0.0)
    a = np.asarray(img, np.float32) / 255
    a = cv2.resize(a, (BX1 - BX0, BY1 - BY0), interpolation=cv2.INTER_AREA)
    a = cv2.GaussianBlur(a, (0, 0), BLUR)
    full = np.zeros((H, W), np.float32)
    full[BY0:BY1, BX0:BX1] = a
    return full


gray = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
A_hz = np.clip((165.0 - gray) / 157.0, 0, 1)[BY0:BY1, BX0:BX1]
best = None
for dx in np.arange(-2, 2.01, 0.25):
    for dy in np.arange(-2, 2.01, 0.25):
        a = render_word('HORIZON', TRACK, {}, p0 + lsb[0], dx, dy)[BY0:BY1, BX0:BX1]
        e = float(((a - A_hz) ** 2).mean())
        if best is None or e < best[0]:
            best = (e, dx, dy)
_, DX, DY = best
print(f'registration of rendered HORIZON: dx {DX} dy {DY} (mse {best[0]:.4f})')

# ink colour sampled from HORIZON's solid interior
hz = base[150:210, 205:615][gray[150:210, 205:615] < 25]
INK = np.median(hz, axis=0).astype(np.float32)
alpha = render_word(WORD, NIK_TRACK, KERN, p0 + lsb[0], DX, DY)
cols = np.nonzero(alpha.max(0) > 0.5)[0]
rows = np.nonzero(alpha.max(1) > 0.5)[0]
print(f'NIKOLAUS ink x {cols.min()}..{cols.max()} y {rows.min()}..{rows.max()} '
      f'(HORIZON x 210..609 y 157..202; STEREO starts at 707), ink BGR {INK}')
nik = (erased * (1 - alpha[..., None]) + INK * alpha[..., None]).round().astype(np.uint8)
save(os.path.join(PLATES, 'deck_empty_nikolaus.png'), nik)

cx0, cy0, cx1, cy1 = 140, 120, 780, 236
seam = erased[cy0:cy1, cx0:cx1]
save(os.path.join(PLATES, 'wordmark-compare.png'), np.vstack([
    label(up2(base[cy0:cy1, cx0:cx1]), 'original'),
    label(up2(seam), 'erased (seam check)'),
    label(up2(nik[cy0:cy1, cx0:cx1]), 'NIKOLAUS'),
]))

# ---------------------------------------------------------------- 2. key glow
# Column edges (dark gap | cap ... cap | dark gap), from dark runs at rows
# 1765, 1800 and 1900. The caps are not identical: PLAY 394 px, FF 384, PAUSE 345.
PLAY_X = [1147, 1151, 1177.5, 1572, 1606, 1610]
FF_X = [1683, 1687, 1717.5, 2102, 2134, 2138]
PAUSE_X = [2699, 2703, 2739.5, 3084.5, 3111, 3115]
GY0, GY1 = 1723, 1787        # rows replaced: faceplate edge line, gap, bevel, highlight
ys = np.arange(GY0, GY1)
lit = nik.astype(np.float32)


def take(img, ys_, xs_):
    X, Y = np.meshgrid(np.asarray(xs_, np.float32), np.asarray(ys_, np.float32))
    return cv2.remap(img, X, Y, cv2.INTER_LINEAR)


def tone(img, r0, r1, xs_):
    t_ = take(img, np.arange(r0, r1), xs_).mean(0)
    return cv2.GaussianBlur(t_[None], (0, 0), sigmaX=12, sigmaY=0.1)[0] + 1.0


def transfer(src, src_x, dst, dst_x, emissive=None):
    """The key rows GY0..GY1 of src's key, x-remapped from src_x onto dst_x
    edges, times a per-channel gain field (dst / src tone just above and just
    below the patch, lerped in log down the patch) so the patch takes the
    destination's own sheen. emissive (0..1 per pixel) exempts lamp light from
    the gain. Returns the patch and its feather weights (2 rows, 3 cols)."""
    xs_d = np.arange(dst_x[0], dst_x[-1])
    xs_s = np.interp(xs_d + 0.5, dst_x, src_x) - 0.5
    patch_ = take(src, ys, xs_s)
    g_top = tone(dst, 1712, 1722, xs_d) / tone(src, 1712, 1722, xs_s)
    g_bot = tone(dst, 1788, 1798, xs_d) / tone(src, 1788, 1798, xs_s)
    t_ = ((ys - GY0 + 0.5) / (GY1 - GY0))[:, None, None]
    lg = np.log(g_top)[None] * (1 - t_) + np.log(g_bot)[None] * t_
    if emissive is not None:
        lg = lg * (1 - emissive[..., None])
    patch_ = np.clip(patch_ * np.exp(lg), 0, 255)
    fy = np.ones(len(ys), np.float32)
    fy[:2], fy[-2:] = [0.33, 0.67], [0.67, 0.33]
    fx = np.ones(len(xs_d), np.float32)
    fx[:3], fx[-3:] = [0.25, 0.5, 0.75], [0.75, 0.5, 0.25]
    return patch_, fy[:, None] * fx[None]


# (a) unlit PLAY: FF's rows moved onto PLAY.
patch, wgt = transfer(lit, FF_X, lit, PLAY_X)
reg = (slice(GY0, GY1), slice(PLAY_X[0], PLAY_X[-1]))
unlit = lit.copy()
unlit[reg] = lit[reg] * (1 - wgt[..., None]) + patch * wgt[..., None]
unlit_u8 = unlit.round().astype(np.uint8)
save(os.path.join(PLATES, 'deck_empty_nikolaus_unlit.png'), unlit_u8)

# (b) the PLAY lamp. An additive (lit - unlit) sprite was tried first and
# rejected: under the amber strip the unlit cap has a bright bevel and a white
# highlight line, and adding light cannot turn white amber, so .plusLighter
# blew the strip out to white with red/blue fringes at the bevel edges. The
# sprite is therefore the lit key itself over the patch, drawn source-over:
# opacity 1 is exactly the photo's lit key, and fading opacity dims the lamp.
glow_play = np.dstack([nik[reg], (wgt * 255).round().astype(np.uint8)])
GLOW_PLAY = (PLAY_X[0], GY0)
save(os.path.join(DECK, 'glow_play.png'), glow_play)

# (c) PAUSE: PLAY's lit rows onto the PAUSE cap's edges, with PAUSE's sheen
# for the metal but the lamp light kept at full strength.
em = np.clip((lit[reg] - unlit[reg]).max(2) / 60.0, 0, 1)
em = cv2.GaussianBlur(em, (0, 0), 1.5)
xs_pause = np.arange(PAUSE_X[0], PAUSE_X[-1])
em_pause = take(em, np.arange(len(ys)), np.interp(xs_pause + 0.5, PAUSE_X, PLAY_X) - 0.5 - PLAY_X[0])
lit_play_only = unlit.copy()
lit_play_only[reg] = lit[reg]
ppatch, pw = transfer(lit_play_only, PLAY_X, unlit, PAUSE_X, emissive=em_pause)
glow_pause = np.dstack([ppatch.round().astype(np.uint8), (pw * 255).round().astype(np.uint8)])
GLOW_PAUSE = (PAUSE_X[0], GY0)
save(os.path.join(DECK, 'glow_pause.png'), glow_pause)


def over_at(plate, sprite_bgra, xy):
    out = plate.astype(np.float32).copy()
    x, y = xy
    h, w = sprite_bgra.shape[:2]
    s = sprite_bgra.astype(np.float32)
    a = s[..., 3:] / 255.0
    out[y:y + h, x:x + w] = out[y:y + h, x:x + w] * (1 - a) + s[..., :3] * a
    return np.clip(out, 0, 255).round().astype(np.uint8)


v_play = over_at(unlit_u8, glow_play, GLOW_PLAY)
v_pause = over_at(unlit_u8, glow_pause, GLOW_PAUSE)
err = np.abs(v_play.astype(int) - nik.astype(int))[reg].mean()
print(f'unlit + glow_play vs original lit: mean abs error {err:.2f} levels over the patch')
kx0, ky0, kx1, ky1 = 1100, 1600, 3180, 2000
crops = [label(cv2.resize(im_[ky0:ky1, kx0:kx1], None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA), t_)
         for im_, t_ in ((unlit_u8, 'unlit'), (v_play, 'PLAY lit'), (v_pause, 'PAUSE lit'))]
z = lambda im_, x0_: up2(im_[1700:1810, x0_:x0_ + 500])
zoom = np.vstack([np.hstack([label(z(nik, 1130), 'original PLAY 2x'), label(z(unlit_u8, 1130), 'unlit PLAY 2x')]),
                  np.hstack([label(z(unlit_u8, 2660), 'unlit PAUSE 2x'), label(z(v_pause, 2660), 'PAUSE lit 2x')])])
zoom = cv2.resize(zoom, (crops[0].shape[1], int(zoom.shape[0] * crops[0].shape[1] / zoom.shape[1])),
                  interpolation=cv2.INTER_AREA)
save(os.path.join(PLATES, 'glow-compare.png'), np.vstack(crops + [zoom]))

# ---------------------------------------------------------------- 3. knob
# Measured on the plate (grid search on the face edge's gradient; ticks by
# polar unwrap about the tick ring's centre):
FACE_C = (3178.0, 1276.0)       # pixel-index centre of the cone-brushed face
FACE_R = 131.5
TICK_C = (3168.0, 1270.0)       # centre of the printed tick ring (knob axis on the faceplate)
MIN_DEG, MAX_DEG = -147.6, 147.8   # MIN / MAX major ticks, clockwise from up
g32 = cv2.cvtColor(unlit_u8, cv2.COLOR_BGR2GRAY).astype(np.float32)

# indicator dot: darkest blob on the face
fx0, fy0 = int(FACE_C[0] - FACE_R), int(FACE_C[1] - FACE_R)
sub = g32[fy0:fy0 + int(2 * FACE_R), fx0:fx0 + int(2 * FACE_R)]
yy, xx = np.mgrid[:sub.shape[0], :sub.shape[1]]
inside = np.hypot(xx + fx0 - FACE_C[0], yy + fy0 - FACE_C[1]) < FACE_R - 12
dark = (sub < 50) & inside
n, lab, st, cen = cv2.connectedComponentsWithStats(dark.astype(np.uint8))
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
DOT = (cen[k][0] + fx0, cen[k][1] + fy0)
dot_r = np.sqrt(st[k, cv2.CC_STAT_AREA] / np.pi)
DOT_DEG = float(np.degrees(np.arctan2(DOT[0] - FACE_C[0], FACE_C[1] - DOT[1])))
print(f'knob face centre {FACE_C} r {FACE_R}; dot at ({DOT[0]:.1f}, {DOT[1]:.1f}) r {dot_r:.1f}px, '
      f'{DOT_DEG:.1f} deg from up; MIN {MIN_DEG} MAX {MAX_DEG}; '
      f'rest volume {(DOT_DEG - MIN_DEG) / (MAX_DEG - MIN_DEG) * 100:.1f}%')

# dot removal: along each radius the cone brushing is constant, so fill the
# dot (plus its soft shadow) by interpolating along the radius across it.
DOT_MASK_R = dot_r + 6
plate = unlit.copy()
R0 = int(np.ceil(DOT_MASK_R)) + 2
LX, LY = int(DOT[0]) - 80, int(DOT[1]) - 80          # local crop: sampling the full plate is slow
local = np.ascontiguousarray(unlit[LY:LY + 160, LX:LX + 160])
for py in range(int(DOT[1]) - R0, int(DOT[1]) + R0 + 1):
    for px in range(int(DOT[0]) - R0, int(DOT[0]) + R0 + 1):
        dd = np.hypot(px - DOT[0], py - DOT[1])
        if dd > DOT_MASK_R:
            continue
        vx, vy = px - FACE_C[0], py - FACE_C[1]
        r = np.hypot(vx, vy)
        ux, uy = vx / r, vy / r
        # radial distance from this pixel to the mask edge, inward and outward
        b = ux * (FACE_C[0] - DOT[0]) + uy * (FACE_C[1] - DOT[1])
        c = (FACE_C[0] - DOT[0]) ** 2 + (FACE_C[1] - DOT[1]) ** 2 - (DOT_MASK_R + 1.5) ** 2
        disc = b * b - c
        s1, s2 = -b - np.sqrt(max(disc, 0)), -b + np.sqrt(max(disc, 0))
        pin = (FACE_C[0] + ux * s1, FACE_C[1] + uy * s1)
        pout = (FACE_C[0] + ux * s2, FACE_C[1] + uy * s2)
        def samp(p):
            return cv2.getRectSubPix(local, (3, 3), (p[0] - LX, p[1] - LY)).reshape(-1, 3).mean(0)
        w_ = (r - s1) / max(s2 - s1, 1e-6)
        val = samp(pin) * (1 - w_) + samp(pout) * w_
        a_ = np.clip(DOT_MASK_R + 0.5 - dd, 0, 1)
        plate[py, px] = plate[py, px] * (1 - a_) + val * a_
v2 = plate.round().astype(np.uint8)
save(os.path.join(DECK, 'deck_empty_v2.png'), v2)

# knob.png: the face with its dot, from the unlit plate, 1 px feathered disc,
# centred (the face centre is the sprite centre).
HALF = int(np.ceil(FACE_R)) + 2
SZ = 2 * HALF
src_x, src_y = FACE_C[0] - HALF + 0.5, FACE_C[1] - HALF + 0.5   # continuous top-left
Mk = np.float32([[1, 0, -src_x + 0.5], [0, 1, -src_y + 0.5]])
face = cv2.warpAffine(unlit_u8, Mk, (SZ, SZ), flags=cv2.INTER_LINEAR)
yy, xx = np.mgrid[:SZ, :SZ]
rr = np.hypot(xx + 0.5 - HALF, yy + 0.5 - HALF)
a_face = np.clip(FACE_R + 0.5 - rr, 0, 1)
knob = np.dstack([face, (a_face * 255).round().astype(np.uint8)])
save(os.path.join(DECK, 'knob.png'), knob)
# knob_dot.png: the same canvas, only the dot (difference against the dotless face)
face_nodot = cv2.warpAffine(v2, Mk, (SZ, SZ), flags=cv2.INTER_LINEAR).astype(np.float32)
dk = np.clip(face_nodot - face.astype(np.float32), 0, 255).max(2)   # darkening amount
a_dot = np.clip(dk / np.maximum(face_nodot.max(2), 1), 0, 1)          # multiply-to-black alpha
dot_rgba = np.dstack([np.full((SZ, SZ, 3), 0, np.uint8), (a_dot * 255).round().astype(np.uint8)])
save(os.path.join(DECK, 'knob_dot.png'), dot_rgba)


def over(plate_u8, sprite, center_px, rot_cw_deg):
    """Composite a centred sprite rotated clockwise by rot_cw_deg (normal over)."""
    s = sprite.astype(np.float32)
    Mr = cv2.getRotationMatrix2D((HALF, HALF), -rot_cw_deg, 1.0)
    s = cv2.warpAffine(s, Mr, (SZ, SZ), flags=cv2.INTER_CUBIC, borderValue=0)
    s = np.clip(s, 0, 255)
    out = plate_u8.astype(np.float32).copy()
    x, y = int(round(center_px[0] + 0.5 - HALF)), int(round(center_px[1] + 0.5 - HALF))
    a = s[..., 3:] / 255.0
    out[y:y + SZ, x:x + SZ] = out[y:y + SZ, x:x + SZ] * (1 - a) + s[..., :3] * a
    return out.round().astype(np.uint8)


# Row 1: knob.png rotated (as specified). Row 2: the face left static and only
# knob_dot.png rotated, which keeps the cone-brushed highlights where the
# light puts them (a real knob's sheen does not turn with it).
qx0, qy0, qx1, qy1 = 2980, 1060, 3370, 1480
rows_ = []
for sprite, name, first in ((knob, 'knob.png', 'plate v2 (no sprite)'), (dot_rgba, 'knob_dot.png', 'original plate')):
    strip = [label((v2 if sprite is knob else nik)[qy0:qy1, qx0:qx1], first)]
    for vol in (0.0, 0.5, 1.0):
        ang = MIN_DEG + vol * (MAX_DEG - MIN_DEG)
        comp = over(v2, sprite, FACE_C, ang - DOT_DEG)
        strip.append(label(comp[qy0:qy1, qx0:qx1], f'{name} {int(vol * 100)}% ({ang:.0f})'))
    rows_.append(np.hstack(strip))
save(os.path.join(PLATES, 'knob-compare.png'), np.vstack(rows_))

# ---------------------------------------------------------------- manifest
man = json.load(open(MANIFEST))
gp, gpa = GLOW_PLAY, GLOW_PAUSE
man['plates']['deck_v2'] = 'tvos/Resources/Mixtape/deck/deck_empty_v2.png'
man['glows'] = {
    'play': rect_norm(gp[0], gp[1], gp[0] + glow_play.shape[1], gp[1] + glow_play.shape[0]),
    'pause': rect_norm(gpa[0], gpa[1], gpa[0] + glow_pause.shape[1], gpa[1] + glow_pause.shape[0]),
}
man['knob'] = {
    'center': {'x': round((FACE_C[0] + 0.5) / W, 5), 'y': round((FACE_C[1] + 0.5) / H, 5)},
    'radius': round(FACE_R / H, 5),
    'spriteSize': round(SZ / H, 5),
    'dotAngleDeg': round(DOT_DEG, 1),
    'minAngleDeg': MIN_DEG,
    'maxAngleDeg': MAX_DEG,
    'tickCenter': {'x': round((TICK_C[0] + 0.5) / W, 5), 'y': round((TICK_C[1] + 0.5) / H, 5)},
}
notes = [n for n in man.get('notes', []) if not n.startswith(('glows:', 'knob:'))]
notes += [
    'glows: glow_play.png / glow_pause.png are the lit key rows (lamp strip, the glow in the gap above '
    'it, the warm faceplate edge) drawn NORMAL (source-over) at the rect over deck_empty_v2, whose PLAY '
    'is unlit. Opacity 1 = the photo lit key; animate opacity to fade the lamp. Not additive: see '
    'scripts/mixtape/edit_deck_plate.py.',
    'knob: knob.png is the face only (radius and spriteSize are fractions of the plate HEIGHT; '
    'the sprite is centred on center). Rotate it clockwise by (target - dotAngleDeg), where target = '
    'minAngleDeg + volume * (maxAngleDeg - minAngleDeg). The plate under it is the same face without '
    'the dot. Alternative: leave the face static and rotate knob_dot.png (same canvas) instead, which '
    'keeps the cone-brushed highlights fixed as on a real knob.',
]
man['notes'] = notes
with open(MANIFEST, 'w') as fh:
    json.dump(man, fh, indent=2)
    fh.write('\n')
print('updated', os.path.relpath(MANIFEST, ROOT))
