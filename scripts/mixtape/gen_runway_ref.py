#!/usr/bin/env python3
"""Generate Runway text-to-video motion-reference clips for the Mixtape eject/insert.

Reference only, never shipped. Reads RUNWAYML_API_KEY from the environment:
    set -a; source ~/.secrets/api-keys.env; set +a
    python3 scripts/mixtape/gen_runway_ref.py 1 2

Writes art-src/mixtape/reference/runway_eject_<n>.mp4 and a sidecar
runway_eject_<n>.json with the task id, model and prompt.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

API = "https://api.dev.runwayml.com"
VERSION = "2024-11-06"
MODEL = "gen4.5"
RATIO = "1280:720"
DURATION = 5

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "art-src" / "mixtape" / "reference"

PROMPTS = {
    1: (
        "Locked-off straight-on close-up of the front panel of a black vintage 1980s "
        "cassette deck, static camera. The smoked plastic cassette door tilts open, "
        "a hand lifts the cassette up out of the well and away, the well is briefly "
        "empty, then the hand pushes a new cassette down into the well and the door "
        "closes. Realistic mechanical motion, soft studio light, no text, no logos."
    ),
    2: (
        "Locked-off straight-on close-up of a silver late-1970s hi-fi cassette deck "
        "front panel with two analog VU meters and a mechanical tape counter, static "
        "camera. The cassette door tilts open, a hand lifts the cassette out of the "
        "well and away, the well is briefly empty, then the hand pushes a new cassette "
        "down into the well, the door closes and the tape reels begin turning. "
        "Realistic mechanical motion, soft studio light, no text, no logos."
    ),
}


def call(method, path, body=None):
    key = os.environ.get("RUNWAYML_API_KEY", "")
    if not key:
        sys.exit("RUNWAYML_API_KEY is not set")
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {key}",
            "X-Runway-Version": VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {method} {path}: {e.read().decode(errors='replace')[:500]}")


def generate(n):
    prompt = PROMPTS[n]
    task = call("POST", "/v1/text_to_video", {
        "model": MODEL, "promptText": prompt, "ratio": RATIO, "duration": DURATION,
    })
    tid = task["id"]
    print(f"[{n}] task {tid} submitted")
    while True:
        time.sleep(6)
        t = call("GET", f"/v1/tasks/{tid}")
        st = t.get("status")
        print(f"[{n}] {st} {t.get('progress', '')}")
        if st == "SUCCEEDED":
            break
        if st in ("FAILED", "CANCELLED"):
            sys.exit(f"[{n}] task {tid} {st}: {t.get('failure')} {t.get('failureCode')}")
    OUT.mkdir(parents=True, exist_ok=True)
    mp4 = OUT / f"runway_eject_{n}.mp4"
    urllib.request.urlretrieve(t["output"][0], mp4)
    meta = {"task_id": tid, "model": MODEL, "ratio": RATIO, "duration": DURATION,
            "prompt": prompt, "createdAt": t.get("createdAt")}
    (OUT / f"runway_eject_{n}.json").write_text(json.dumps(meta, indent=2))
    print(f"[{n}] saved {mp4}")


if __name__ == "__main__":
    for arg in sys.argv[1:] or ["1", "2"]:
        generate(int(arg))
