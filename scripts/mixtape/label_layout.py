"""Two-part cassette label layout, shared by the decal builder and the Blender scripts.

Pure Python (no bpy, no PIL) so both the system python3 (make_label_decals.py) and
Blender's python (lookdev_cassette.py, render_options.py) import the same numbers.

The label artwork is an 880 x 300 SVG (0.1 mm units = 88 x 30 mm). The cassette only
has about 17.6 mm of face between the shell's top rim and the window, so the SVG is
scaled UNIFORMLY to the strip height (never squashed) and centred on the strip. The
strip is 87 mm wide like the old label; the rest of its width is filled by repeating
the SVG's right-hand edge column (background plus the full-width header rules), so
the printed rules run the full width of the tape.

Coordinates: mm on the cassette face, origin at the shell centre, x right, y up
(the same frame as build_cassette.py).
"""

import os
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.join(ROOT, "art-src", "mixtape")
LOGOS = os.path.join(ART, "logos")
LABEL_TEX = os.path.join(ART, "textures", "labels")

BRANDS = ["tdk", "maxell", "sony", "basf", "memorex", "fuji"]
STYLES = ["printed", "blank"]

SVG_W, SVG_H = 880.0, 300.0  # viewBox units (0.1 mm at 1:1)

# Paper strip above the window and the plain band below it (mm, cassette face).
# Window cut in the shell is +-33 x +-11.5; shell top edge at +31.9; the raised pad
# starts at y = -19.5.
STRIP = {"x0": -43.5, "x1": 43.5, "y0": 12.6, "y1": 30.2}
BAND = {"x0": -43.5, "x1": 43.5, "y0": -18.9, "y1": -12.6}
PAPER_Z0, PAPER_Z1 = 6.0, 6.12  # label paper sits on the shell face (z = 6)

STRIP_H = STRIP["y1"] - STRIP["y0"]
STRIP_W = STRIP["x1"] - STRIP["x0"]
SVG_SCALE = STRIP_H / (SVG_H * 0.1)  # uniform: SVG mm -> strip mm
SVG_W_MM = SVG_W * 0.1 * SVG_SCALE

# Decal raster: the SVG itself is rasterised 2000 px wide.
SVG_RASTER_W = 2000
PX_PER_MM = SVG_RASTER_W / SVG_W_MM
STRIP_PX = (int(round(STRIP_W * PX_PER_MM)), int(round(STRIP_H * PX_PER_MM)))
BAND_PX = (STRIP_PX[0], int(round((BAND["y1"] - BAND["y0"]) * PX_PER_MM)))

# Per brand: paper stock multiplied in and wear level (0 light .. 1 beat up).
LOOK = {
    "tdk": {"paper": "glossy-white", "wear": 0.35},
    "maxell": {"paper": "cream-clean", "wear": 0.5},
    "sony": {"paper": "cream-clean", "wear": 0.6},
    "basf": {"paper": "glossy-white", "wear": 0.8},
    "memorex": {"paper": "glossy-white", "wear": 0.7},
    "fuji": {"paper": "glossy-white", "wear": 0.45},
}


def svg_path(brand, style):
    return os.path.join(LOGOS, brand, "label_%s.svg" % style)


def strip_png(brand, style):
    return os.path.join(LABEL_TEX, "%s_%s_strip.png" % (brand, style))


def band_png(brand):
    return os.path.join(LABEL_TEX, "%s_band.png" % brand)


def _strip_ns(tag):
    return tag.split("}", 1)[-1]


def read_svg(brand, style):
    """Named elements of a label SVG, in viewBox units (y down).

    Returns {"background": "#RRGGBB", "art_slot": {x,y,w,h}, "lines": [...]}. Lines are
    field_artist / field_album / field_song for printed labels and rule_1..3 for
    blank ones, mapped to artist / album / song in that order.
    """
    tree = ET.parse(svg_path(brand, style))
    root = tree.getroot()
    bg = None
    named = {}
    for el in root.iter():
        tag = _strip_ns(el.tag)
        if bg is None and tag == "rect" and el.get("x") == "0" and el.get("y") == "0" \
                and el.get("width") == "880" and el.get("height") == "300":
            bg = el.get("fill")
        if el.get("id"):
            named[el.get("id")] = el
    a = named["art_slot"]
    art = {k: float(a.get(k)) for k in ("x", "y", "width", "height")}
    art = {"x": art["x"], "y": art["y"], "w": art["width"], "h": art["height"]}
    if style == "printed":
        ids = [("artist", "field_artist"), ("album", "field_album"), ("song", "field_song")]
    else:
        ids = [("artist", "rule_1"), ("album", "rule_2"), ("song", "rule_3")]
    lines = []
    for name, i in ids:
        e = named[i]
        lines.append({"name": name, "svgId": i, "x1": float(e.get("x1")), "x2": float(e.get("x2")),
                      "y": float(e.get("y1"))})
    return {"background": bg, "art_slot": art, "lines": lines}


def svg_to_mm(u, v):
    """SVG viewBox point -> cassette face mm (x right, y up)."""
    x = (u - SVG_W / 2) * 0.1 * SVG_SCALE
    y = STRIP["y1"] - v * 0.1 * SVG_SCALE
    return x, y


def label_items_mm(brand, style):
    """Art slot rect and text lines in cassette mm, derived from the SVG's named elements.

    Text: baseline sits 0.6 units above the printed rule (half its stroke), max width is
    the rule's length, x-height is 0.30 of the line pitch (so handwriting fills the gap
    between rules the way a person writes on a ruled line).
    """
    s = read_svg(brand, style)
    a = s["art_slot"]
    ax0, ay1 = svg_to_mm(a["x"], a["y"])
    ax1, ay0 = svg_to_mm(a["x"] + a["w"], a["y"] + a["h"])
    ys = [ln["y"] for ln in s["lines"]]
    pitch = (ys[-1] - ys[0]) / (len(ys) - 1)
    lines = []
    for ln in s["lines"]:
        x0, yb = svg_to_mm(ln["x1"], ln["y"] - 1.2)
        x1, _ = svg_to_mm(ln["x2"], ln["y"])
        lines.append({"name": ln["name"], "svgId": ln["svgId"], "x0": x0, "x1": x1, "y": yb,
                      "x_height": 0.30 * pitch * 0.1 * SVG_SCALE})
    return {"art": {"x0": ax0, "y0": ay0, "x1": ax1, "y1": ay1}, "lines": lines,
            "background": s["background"]}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
