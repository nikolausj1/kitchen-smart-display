"""Build _review/mockups/mixtape-options.html plus its image folder from index.json."""
import json, os, shutil
from PIL import Image

ROOT = "/Users/justinnikolaus/_Developer/Smart Display"
SRC = os.path.join(ROOT, "art-src/mixtape/renders/options")
REF = os.path.join(ROOT, "art-src/mixtape/reference")
OUT = os.path.join(ROOT, "_review/mockups/mixtape-options")
HTML = os.path.join(ROOT, "_review/mockups/mixtape-options.html")

idx = json.load(open(os.path.join(SRC, "index.json")))
os.makedirs(OUT, exist_ok=True)
renders, missing = [], []
for e in idx["renders"]:
    src = os.path.join(SRC, e["file"])
    if not os.path.exists(src):
        missing.append(e["file"])
        continue
    jpg = os.path.splitext(e["file"])[0] + ".jpg"
    dst = os.path.join(OUT, jpg)
    im = Image.open(src).convert("RGB")
    h = round(im.height * 1280 / im.width)
    im.resize((1280, h), Image.LANCZOS).save(dst, "JPEG", quality=85, optimize=True)
    r = {k: e[k] for k in ("style", "door", "vu", "counter", "keys", "scale", "tape", "set")}
    r["src"] = "mixtape-options/" + jpg
    renders.append(r)
for n in ("runway_eject_1.mp4", "runway_eject_2.mp4"):
    shutil.copy2(os.path.join(REF, n), os.path.join(OUT, n))

tpl = open(os.path.join(os.path.dirname(__file__), "options_sheet_template.html")).read()
open(HTML, "w").write(tpl.replace("/*DATA*/null", json.dumps(renders)))
print("renders", len(renders), "missing", missing)
