# Removes the baked VU needles from the 4K deck plate so MixtapeView can draw
# live ones. Input: art-src/mixtape/plates/deck_empty_4k.png.
# Output: tvos/Resources/Mixtape/deck/deck_empty.png.
#
# 1. Hough-detects each needle inside its face and masks a 34 px band along it,
#    from just below the scale numerals down to the dome top. (The band used to
#    start 25 px past the needle tip, which reached the "-10" numeral and smeared
#    its minus sign; it now stops at the numerals' baseline.)
# 2. Fills the band: on the face with a normalised blur of the plain face
#    around it (Telea smeared the arc's ink into a grey halo), below the face
#    edge (bezel, dome rim) with cv2.inpaint (Telea) on that strip alone.
# 3. Repairs what the needle hid, so no smudge is left near "-10":
#    - the scale arc: its centre radius and thickness are measured radially
#      (about the manifest's VU pivot) just outside the band on both sides and
#      interpolated across the gap, then redrawn antialiased;
#    - the "-10" major tick, which sits exactly under the resting needle: drawn
#      radially at the tick angle MixtapeView.vuAngle(-10) = -17.5 deg, with the
#      inner/outer radius, thickness and ink of the measured "-5" tick.
#    Flat band ends (no round caps up into the numerals), and the strip below
#    the face's bottom edge (bezel and dome rim) is inpainted on its own.
import cv2, numpy as np

src = 'art-src/mixtape/plates/deck_empty_4k.png'
dst = 'tvos/Resources/Mixtape/deck/deck_empty.png'
im = cv2.imread(src)
H, W = im.shape[:2]
gray0 = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)

# x, y, w, h of the face, dome y; pivot (scale-arc centre) from the manifest.
faces = {
    'left':  ((0.04366, 0.20202, 0.19557, 0.19351), 0.39341, (0.14713, 0.53057)),
    'right': ((0.76077, 0.20202, 0.19498, 0.19351), 0.39341, (0.85706, 0.52951)),
}
ANG = {-10: -17.5, -5: -8.4}   # dB -> degrees from vertical (MixtapeView.vuAngle)

mask = np.zeros((H, W), np.uint8)
info = {}
for k, ((x, y, w, h), domey, (px, py)) in faces.items():
    x0, y0, x1, y1 = int((x + 0.1 * w) * W), int((y + 0.1 * h) * H), int((x + 0.9 * w) * W), int((y + h) * H)
    g = gray0[y0:y1, x0:x1]
    dark = (g < 90).astype(np.uint8) * 255
    lines = cv2.HoughLinesP(dark, 1, np.pi / 720, 60, minLineLength=120, maxLineGap=8)
    best = None
    for l in lines.reshape(-1, 4):
        a, b, c, d = [int(v) for v in l]
        if b > d: a, b, c, d = c, d, a, b
        L = np.hypot(c - a, d - b); ang = np.degrees(np.arctan2(a - c, d - b))
        if 8 < abs(ang) < 60 and (best is None or L > best[0]): best = (L, a + x0, b + y0, c + x0, d + y0)
    _, a, b, c, d = best
    ux, uy = (c - a) / np.hypot(c - a, d - b), (d - b) / np.hypot(c - a, d - b)
    # Top of the band: just below the numerals (their bottom edge sits about
    # 0.276 H; the needle tip is below that), never up into "-10".
    ytop = max(int(b - uy * 25), int(0.2765 * H))
    t0 = (ytop - b) / uy
    top = (int(a + ux * t0), ytop)
    ybot = int((domey - 0.022) * H)
    t = (ybot - b) / uy
    bot = (int(a + ux * t), int(ybot))
    # The needle runs on past ybot over the bezel and into the dome's rim
    # (to about ybot + 12); draw the band long, then cut flat ends below.
    yface = ybot + 3
    t2 = (yface + 12 - b) / uy
    cv2.line(mask, top, (int(a + ux * t2), yface + 12), 255, 34)
    # The tip's shadow sits a few px right of the band's top edge.
    cv2.circle(mask, (int(a + ux * t0) + 14, ytop + 4), 11, 255, -1)
    mask[:ytop] = 0
    mask[yface + 12:] = 0
    info[k] = dict(pivot=(px * W, py * H), top=top, bot=bot, yface=yface)
    print(k, top, bot)

# Inpaint the face and the bezel/dome strip separately, so neither borrows
# the other's colour (that borrowing was the dark blob at the dome).
yface = min(d['yface'] for d in info.values())
out = im.copy()
out[:yface] = cv2.inpaint(im[:yface], mask[:yface], 7, cv2.INPAINT_TELEA)
out[yface:] = cv2.inpaint(im[yface:], mask[yface:], 3, cv2.INPAINT_TELEA)
out = out.astype(np.float32)
# On the face, Telea drags the dark scale arc into the band as a grey halo.
# Replace the band with a normalised blur of the plain (ink-free) face around
# it instead; the arc and tick are redrawn crisply on top below.
gface = gray0[:yface]
wgt = ((gface > 150) & (mask[:yface] == 0)).astype(np.float32)
num = cv2.GaussianBlur(im[:yface].astype(np.float32) * wgt[..., None], (0, 0), 7)
den = cv2.GaussianBlur(wgt, (0, 0), 7)[..., None]
bg = num / np.maximum(den, 1e-4)
blend = cv2.GaussianBlur((mask[:yface] > 0).astype(np.float32), (0, 0), 1.2)[..., None]
blend = np.where(mask[:yface, :, None] > 0, 1.0, blend) * (den > 0.02)
out[:yface] = out[:yface] * (1 - blend) + bg * blend


def radial_profile(img_gray, pv, deg, r0, r1):
    """Gray values along the ray at `deg` from vertical (clockwise +), r0..r1."""
    th = np.radians(deg)
    rs = np.arange(r0, r1, 0.5)
    xs = pv[0] + np.sin(th) * rs
    ys = pv[1] - np.cos(th) * rs
    vals = cv2.remap(img_gray, xs.astype(np.float32).reshape(1, -1), ys.astype(np.float32).reshape(1, -1),
                     cv2.INTER_LINEAR).ravel()
    return rs, vals


def dark_run(rs, vals):
    """Centre radius and width of the darkest run (the printed stroke)."""
    lo, hi = np.percentile(vals, 5), np.percentile(vals, 90)
    thr = (lo + hi) / 2
    i = int(np.argmin(vals))
    j0 = i
    while j0 > 0 and vals[j0 - 1] < thr: j0 -= 1
    j1 = i
    while j1 < len(vals) - 1 and vals[j1 + 1] < thr: j1 += 1
    return (rs[j0] + rs[j1]) / 2, rs[j1] - rs[j0] + 0.5


g0 = gray0.astype(np.float32)
for k, d in info.items():
    pv = d['pivot']
    # Angular extent of the band on the arc (about r = 530).
    ang_of = lambda p: np.degrees(np.arctan2(p[0] - pv[0], pv[1] - p[1]))
    ys, xs = np.nonzero(mask)
    sel = (np.hypot(xs - pv[0], ys - pv[1]) > 480) & (np.hypot(xs - pv[0], ys - pv[1]) < 580) \
        & (np.abs(xs - pv[0]) < 400)
    angs = np.degrees(np.arctan2(xs[sel] - pv[0], pv[1] - ys[sel]))
    amin, amax = angs.min() - 0.6, angs.max() + 0.6
    # Arc samples just outside the band on each side.
    samp = []
    for a in list(np.linspace(amin - 2.0, amin, 5)) + list(np.linspace(amax, amax + 2.0, 5)):
        rs, v = radial_profile(g0, pv, a, 480, 590)
        rc, wd = dark_run(rs, v)
        samp.append((a, rc, wd))
    samp = np.array(samp)
    cr = np.polyfit(samp[:, 0], samp[:, 1], 1)
    thick = float(np.median(samp[:, 2]))
    # Ink colour: darkest pixels on the sampled arc.
    ink_pts = []
    for a, rc, _ in samp:
        th = np.radians(a)
        ink_pts.append(im[int(round(pv[1] - np.cos(th) * rc)), int(round(pv[0] + np.sin(th) * rc))])
    ink = np.median(np.array(ink_pts, np.float32), axis=0)

    # "-5" tick: radial extent and width. Search a little around the nominal
    # angle for the ray that stays dark longest (the tick crosses the arc, so
    # the run is taken through the arc), then measure the width across it.
    arc_r = np.polyval(cr, ANG[-5])
    bestrun = None
    for a5 in np.linspace(ANG[-5] - 1.5, ANG[-5] + 1.5, 61):
        rs, v = radial_profile(g0, pv, a5, arc_r - 70, arc_r + 70)
        thr = (np.percentile(v, 3) + np.percentile(v, 90)) / 2
        isd = v < thr
        i = int(np.argmin(np.abs(rs - arc_r)))
        if not isd[i]: continue
        j0 = i
        while j0 > 0 and isd[j0 - 1]: j0 -= 1
        j1 = i
        while j1 < len(isd) - 1 and isd[j1 + 1]: j1 += 1
        if bestrun is None or rs[j1] - rs[j0] > bestrun[0]:
            bestrun = (rs[j1] - rs[j0], a5, rs[j0], rs[j1])
    _, a5, t_in, t_out = bestrun
    # width: angular profile at a radius between the arc and the outer end
    rm = (arc_r + thick + t_out) / 2
    angs_w = np.linspace(a5 - 2.5, a5 + 2.5, 400)
    vals = np.array([cv2.getRectSubPix(g0, (1, 1), (float(pv[0] + np.sin(np.radians(q)) * rm),
                                                   float(pv[1] - np.cos(np.radians(q)) * rm)))[0, 0] for q in angs_w])
    thr_w = (vals.min() + np.percentile(vals, 90)) / 2
    tw = (vals < thr_w).sum() * (angs_w[1] - angs_w[0]) * np.pi / 180 * rm
    print(k, 'arc r(a)=%.3fa+%.1f thick %.1f' % (cr[0], cr[1], thick), 'tick r %.0f..%.0f w %.1f' % (t_in, t_out, tw),
          'ink', ink.round())

    # Paint, antialiased, only inside a slightly grown band.
    region = cv2.dilate(mask, np.ones((7, 7), np.uint8))
    yy, xx = np.nonzero(region)
    near = np.hypot(xx - pv[0], yy - pv[1])
    keep = (near > 460) & (near < 620) & (np.abs(xx - pv[0]) < 400)
    yy, xx = yy[keep], xx[keep]
    rr = np.hypot(xx - pv[0], yy - pv[1])
    aa = np.degrees(np.arctan2(xx - pv[0], pv[1] - yy))
    # arc coverage
    d_arc = np.abs(rr - np.polyval(cr, aa))
    cov = np.clip(thick / 2 + 0.5 - d_arc, 0, 1)
    # tick coverage (segment along the -10 angle)
    th = np.radians(ANG[-10])
    ux, uy = np.sin(th), -np.cos(th)
    proj = (xx - pv[0]) * ux + (yy - pv[1]) * uy
    perp = np.abs((xx - pv[0]) * uy - (yy - pv[1]) * ux)
    along = np.clip(np.maximum(t_in - proj, proj - t_out), 0, None)
    d_tick = np.hypot(perp, along)
    cov = np.maximum(cov, np.clip(tw / 2 + 0.5 - d_tick, 0, 1))
    cov = cov[:, None] * 0.95
    out[yy, xx] = out[yy, xx] * (1 - cov) + ink[None, :] * cov


cv2.imwrite(dst, np.clip(out + 0.5, 0, 255).astype(np.uint8))
