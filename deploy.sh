#!/usr/bin/env bash
# deploy.sh - push the Smart Display to the hub and the kitchen Pi.
#
# Topology since 2026-09-24 (docs/designs/echo-show-and-hub.md):
#
#   FrameServer (nuc.local:8095 = 192.168.4.61)
#       The hub every screen depends on. Serves the web app itself - the Echo
#       Show loads it by IP (Silk cannot resolve .local), laptops likewise -
#       and every shared service: photos + manifest, the settings registry,
#       house state (/api/state), lunch, the school calendar, the photo-flag
#       queue, and the Sonos proxy (/api/sonos, in front of the NUC's own
#       node-sonos-http-api).
#   Kitchen Pi (smartdisplay.local)
#       Serves the same bundle to its own Chromium on localhost:8080, plus the
#       panel's power and backlight (/api/display/*, loopback only). Its old
#       shared-service routes stay up for the rollback week. Also still holds
#       the DORMANT photo-build as the rollback path, so build inputs keep
#       syncing there too.
#
# `all` deploys the hub first, then the kitchen: the kitchen bundle reads
# everything from the hub, so the hub's routes must be live before it loads.
# One build serves both. `migrate` is a one-time step, never part of `all`.
#
# rsync is not available on Windows, so the FrameServer half uses scp.
#
# Test gate: every target below (hub, pi, migrate, all) first runs the pure
# library suite, `node --test` over frameserver/test/ (node:test, no network,
# no writes outside the OS temp dir). A red run dies before anything is
# touched. SKIP_TESTS=1 ./deploy.sh ... bypasses the gate, with a printed
# warning; do not ship on a red run you have not looked at.
#
# Usage:  ./deploy.sh [all | hub | pi | migrate]
#           all       hub, then pi (the default)
#           hub       FrameServer: build scripts + inputs, the web app, server
#                     + lib + dashboard; restart, then smoke-test over the LAN
#           pi        kitchen Pi: bundle, server + panel scripts, build inputs
#           migrate   one-time and idempotent, after `hub`: copy the Pi's
#                     photo-flag queue to the hub, compare the shared settings,
#                     repoint stale Sonos bases in the registry. Only reads
#                     from the Pi.
#           SKIP_TESTS=1 ./deploy.sh ...   ship without running the test gate
set -euo pipefail
cd "$(dirname "$0")"

PI_HOST=pi@smartdisplay.local
PI_URL=http://smartdisplay.local:8080
NUC_HOST=micro@nuc.local
NUC_KEY="$HOME/.ssh/sportsbox_nuc_ed25519"
NUC_DIR='C:/Services/FrameServer'
HUB_URL=http://nuc.local:8095
# sonos.apiBase for web screens that resolve mDNS (the kitchen, laptops). Not
# the Echo: it cannot resolve .local and derives its base from the page origin.
HUB_SONOS_BASE=http://nuc.local:8095/api/sonos
STALE_SONOS_BASE=http://localhost:5005
# The web app FrameServer serves, in upload order: index.html and build.json
# go last (see the hub target). Not stub-photos/: the hub serves photos from
# its own photos dir.
HUB_APP_FILES=(assets icons previews favicon.svg silence.wav silence.mp3 editor.html index.html build.json)
TARGET="${1:-all}"

case "$TARGET" in
  all|hub|pi|migrate) ;;
  *) echo "usage: $0 [all | hub | pi | migrate]" >&2; exit 2 ;;
esac

die() { echo "!! $*" >&2; exit 1; }
nuc_ssh() { ssh -i "$NUC_KEY" -o BatchMode=yes "$NUC_HOST" "$@"; }
nuc_scp() { scp -q -i "$NUC_KEY" -o BatchMode=yes "$@"; }
# curl for scripted calls: an HTTP error fails, with the response body still
# on stdout so the error message can show it.
api() { curl -sS --fail-with-body --max-time 20 "$@"; }

BUILT=
build_bundle() {
  [ -n "$BUILT" ] && return 0
  echo "==> Building the web bundle"
  (cd code && npm run build)
  BUILT=1
}

TESTED=
# node --test frameserver/test/ would be the obvious spelling, but Node's
# test runner does not accept a bare directory as an argument (it tries to
# require() it and fails); the glob is the working equivalent, still scoped
# to this one directory. Runs once per invocation even though `all` reaches
# this from both the hub and the pi blocks below.
run_hub_tests() {
  [ -n "$TESTED" ] && return 0
  if [ "${SKIP_TESTS:-}" = 1 ]; then
    echo "==> Hub tests: SKIPPED (SKIP_TESTS=1); deploying without a green run" >&2
    TESTED=1
    return 0
  fi
  echo "==> Hub tests: node --test frameserver/test/"
  local out status=0
  out=$(node --test 'frameserver/test/**/*.test.mjs' 2>&1) || status=$?
  grep -E '^# (tests|pass|fail)' <<<"$out" | sed 's/^/    /' || true
  if [ "$status" -ne 0 ]; then
    echo "$out"
    die "hub test suite failed; fix frameserver/test/ or the libraries before deploying (or SKIP_TESTS=1 to bypass, not recommended)"
  fi
  TESTED=1
}

if [ "$TARGET" = all ] || [ "$TARGET" = hub ]; then
  run_hub_tests
  build_bundle
  # Check the whole app is there before touching the hub: its assets dir is
  # cleared below, so a half-shipped app would leave the Echo broken.
  app_src=()
  for f in "${HUB_APP_FILES[@]}"; do
    [ -e "code/dist/$f" ] || die "code/dist/$f is missing after the build; the hub was not touched"
    app_src+=("code/dist/$f")
  done

  echo "==> FrameServer: build scripts"
  # No --delete equivalent with scp, which is fine: these are overwrites, and
  # node_modules/ on the hub must survive (sharp lives there).
  nuc_scp code/scripts/*.mjs code/scripts/package.json "$NUC_HOST:$NUC_DIR/scripts/"
  nuc_scp code/scripts/lib/*.mjs "$NUC_HOST:$NUC_DIR/scripts/lib/"

  echo "==> FrameServer: build inputs"
  # NOT .location-cache.json: the hub's copy is authoritative now (it is the
  # only thing doing lookups), and overwriting it with a stale Mac copy would
  # re-query Google Places for everything it forgot.
  nuc_scp custom-places.json art-metadata.json "$NUC_HOST:$NUC_DIR/"

  echo "==> FrameServer: web app"
  # Vite content-hashes asset names, so every build adds files: clear the old
  # ones instead of letting them pile up. Upload order matters: index.html and
  # build.json last, because a screen reloads when build.json changes and the
  # assets the new index.html names must already be in place by then.
  nuc_ssh 'powershell -NoProfile -Command "Remove-Item -Recurse -Force C:/Services/FrameServer/app/assets -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force C:/Services/FrameServer/app/assets | Out-Null"'
  nuc_scp -r "${app_src[@]}" "$NUC_HOST:$NUC_DIR/app/"

  echo "==> FrameServer: service, lib + dashboard"
  # server.mjs imports ./lib/*.mjs, so lib/ ships with it (cmd.exe syntax).
  # secrets/ holds the Google Calendar service-account key (copied by hand,
  # never through git); countdown-art/ is the hub's synced Immich album.
  nuc_ssh 'if not exist C:\Services\FrameServer\lib mkdir C:\Services\FrameServer\lib'
  nuc_ssh 'if not exist C:\Services\FrameServer\secrets mkdir C:\Services\FrameServer\secrets'
  nuc_ssh 'if not exist C:\Services\FrameServer\countdown-art mkdir C:\Services\FrameServer\countdown-art'
  nuc_scp frameserver/lib/*.mjs "$NUC_HOST:$NUC_DIR/lib/"
  nuc_scp frameserver/server.mjs frameserver/admin.html "$NUC_HOST:$NUC_DIR/"
  nuc_ssh 'powershell -NoProfile -Command "Restart-Service SmartDisplayFrameServer; Start-Sleep -Seconds 2; (Invoke-WebRequest http://127.0.0.1:8095/healthz -UseBasicParsing).Content"'

  echo "==> FrameServer: smoke test over the LAN ($HUB_URL)"
  if ! page=$(api --retry 5 --retry-delay 1 --retry-connrefused "$HUB_URL/"); then
    die "GET $HUB_URL/ failed: $page"
  fi
  grep -q smart-display-hub <<<"$page" ||
    die "GET $HUB_URL/ has no smart-display-hub marker: FrameServer is not serving the app"
  echo "    GET / serves the app (smart-display-hub marker present)"
  if ! state=$(api --retry 5 --retry-delay 1 --retry-connrefused "$HUB_URL/api/state"); then
    die "GET $HUB_URL/api/state failed: $state"
  fi
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
except ValueError as e:
    sys.exit("not JSON (%s)" % e)
if not isinstance(d, dict) or "timer" not in d:
    sys.exit("no timer key")
print("    GET /api/state is JSON, timer = %s" % json.dumps(d["timer"]))
' <<<"$state" || die "GET $HUB_URL/api/state did not return JSON with a timer key: $state"
fi

if [ "$TARGET" = all ] || [ "$TARGET" = pi ]; then
  run_hub_tests
  build_bundle

  echo "==> Kitchen Pi: app bundle"
  # stub-photos/ is excluded: the Pi no longer owns photos, and --delete would
  # wipe the copy that is still there for rollback.
  rsync -a --delete --exclude stub-photos/ code/dist/ "$PI_HOST:/home/pi/kiosk/"

  echo "==> Kitchen Pi: server + panel scripts"
  rsync -a pi/kiosk-server.py pi/labwc-autostart pi/kiosk-restart.sh \
           pi/photo-refresh.sh pi/photo-refresh.service pi/photo-refresh.timer \
           "$PI_HOST:/home/pi/"

  echo "==> Kitchen Pi: build inputs (rollback path, kept current but dormant)"
  ssh "$PI_HOST" 'mkdir -p /home/pi/photo-build/scripts'
  rsync -a --delete --exclude .location-cache.json --exclude node_modules \
           code/scripts/ "$PI_HOST:/home/pi/photo-build/scripts/"
  rsync -a custom-places.json art-metadata.json "$PI_HOST:/home/pi/photo-build/"

  echo "==> Kitchen Pi: restart kiosk"
  ssh "$PI_HOST" 'chmod +x /home/pi/kiosk-restart.sh /home/pi/photo-refresh.sh && bash /home/pi/kiosk-restart.sh'
fi

if [ "$TARGET" = migrate ]; then
  run_hub_tests
  # One-time move of the Pi's shared data to the hub. Safe to re-run: only
  # flags the hub does not have yet are imported, the settings check only
  # reads, and only devices still holding the stale Sonos base are patched.
  # Run it after `hub`, then once more after `pi`: until its new bundle lands,
  # the kitchen still files photo flags on the Pi.

  echo "==> Migrate 1/3: photo-flag queue, Pi -> hub"
  if ! flags=$(api "$PI_URL/api/flags"); then
    die "could not read the Pi flag queue at $PI_URL/api/flags: $flags"
  fi
  if ! hub_flags=$(api "$HUB_URL/api/flags"); then
    die "could not read the hub flag queue at $HUB_URL/api/flags: $hub_flags"
  fi
  # Send only what the hub lacks: its import replaces an existing assetId
  # wholesale, so re-sending one would undo a resolve done on the hub since.
  plan=$(python3 -c '
import json, sys
pi, hub = json.loads(sys.argv[1]), json.loads(sys.argv[2])
if not isinstance(pi, list) or not isinstance(hub, list):
    sys.exit("expected two JSON lists")
have = {f.get("assetId") for f in hub if isinstance(f, dict)}
new = [f for f in pi if isinstance(f, dict) and f.get("assetId") and f.get("assetId") not in have]
print(len(pi), sum(1 for f in pi if isinstance(f, dict) and not f.get("resolved")), len(new))
print(json.dumps(new))
' "$flags" "$hub_flags") || die "the Pi and hub /api/flags did not both return JSON lists"
  { read -r pi_total pi_open new_count; read -r new_flags; } <<<"$plan"
  echo "    Pi: $pi_total flag(s), $pi_open unresolved; $((pi_total - new_count)) already on the hub"
  if [ "$new_count" -eq 0 ]; then
    echo "    nothing to import"
  else
    if ! resp=$(api -X POST -H 'Content-Type: application/json' --data-binary @- \
                  "$HUB_URL/api/flags/import" <<<"$new_flags"); then
      die "POST $HUB_URL/api/flags/import failed: $resp"
    fi
    echo "    imported $new_count; hub: $resp"
  fi

  echo "==> Migrate 2/3: shared settings, Pi /api/state vs hub /api/settings/shared (read-only)"
  if ! pi_state=$(api "$PI_URL/api/state"); then
    die "GET $PI_URL/api/state failed: $pi_state"
  fi
  if ! hub_shared=$(api "$HUB_URL/api/settings/shared"); then
    die "GET $HUB_URL/api/settings/shared failed: $hub_shared"
  fi
  python3 -c '
import json, sys
pi, hub = json.loads(sys.argv[1]), json.loads(sys.argv[2])
ABSENT = object()
def leaves(v, path, out):
    if isinstance(v, dict) and v:
        for k in sorted(v):
            leaves(v[k], path + "." + k, out)
    else:
        out[path] = v
    return out
def show(v):
    return "(absent)" if v is ABSENT else json.dumps(v)
differs = False
for key in ("school", "location"):
    a = leaves(pi.get(key, ABSENT), key, {})
    b = leaves(hub.get(key, ABSENT), key, {})
    rows = [p for p in sorted(set(a) | set(b)) if a.get(p, ABSENT) != b.get(p, ABSENT)]
    if not rows:
        print("    %s: same on the Pi and the hub" % key)
        continue
    differs = True
    print("    WARNING: %s differs" % key)
    for p in rows:
        print("      %-30s Pi %-14s hub %s" % (p, show(a.get(p, ABSENT)), show(b.get(p, ABSENT))))
if differs:
    print("    Nothing was changed. The hub is the source of truth now: if the Pi")
    print("    had it right, fix it in the dashboard (http://nuc.local:8095/admin).")
' "$pi_state" "$hub_shared" || die "could not compare the shared settings"

  echo "==> Migrate 3/3: stale Sonos base in the hub registry"
  # Only repoint screens at the hub proxy once it answers, with CORS: the
  # kitchen app is served from the Pi, so its Sonos calls are cross-origin.
  if ! zones=$(api -i "$HUB_URL/api/sonos/zones"); then
    die "the hub Sonos proxy is not answering, no screen was repointed: $zones"
  fi
  python3 -c '
import json, sys
head, _, body = sys.stdin.read().replace("\r\n", "\n").partition("\n\n")
if "access-control-allow-origin" not in head.lower():
    sys.exit("no Access-Control-Allow-Origin header on /api/sonos/zones")
try:
    zones = json.loads(body)
except ValueError as e:
    sys.exit("/api/sonos/zones is not JSON (%s)" % e)
if not isinstance(zones, list) or not zones:
    sys.exit("/api/sonos/zones returned no zones")
rooms = sorted({str(m.get("roomName")) for z in zones for m in (z.get("members") or [])})
print("    hub Sonos proxy answers: %d room(s): %s" % (len(rooms), ", ".join(rooms)))
' <<<"$zones" || die "the hub Sonos proxy is not usable, no screen was repointed"

  if ! devices=$(api "$HUB_URL/api/devices"); then
    die "GET $HUB_URL/api/devices failed: $devices"
  fi
  # Device report on stderr, the ids to patch on stdout.
  stale_ids=$(python3 -c '
import json, re, sys
stale = sys.argv[1]
for d in json.loads(sys.stdin.read()).get("devices") or []:
    did, kind = str(d.get("id") or ""), str(d.get("kind") or "")
    base = ((d.get("config") or {}).get("sonos") or {}).get("apiBase")
    if base != stale:
        why = base if base else "no Sonos base stored"
        print("    %s (%s): %s, left alone" % (did, kind, why), file=sys.stderr)
    elif not kind.startswith("web"):
        print("    %s (%s): %s, not a web screen, left alone" % (did, kind, base), file=sys.stderr)
    elif not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", did):
        print("    %r (%s): not an addressable device id, left alone" % (did, kind), file=sys.stderr)
    else:
        print(did)
' "$STALE_SONOS_BASE" <<<"$devices") || die "GET $HUB_URL/api/devices did not return the device registry"

  fixed=0
  for id in $stale_ids; do
    if ! resp=$(api -X PATCH -H 'Content-Type: application/json' \
                  -d "{\"sonos\":{\"apiBase\":\"$HUB_SONOS_BASE\"}}" \
                  "$HUB_URL/api/devices/$id/config"); then
      die "PATCH $HUB_URL/api/devices/$id/config failed: $resp"
    fi
    now=$(python3 -c '
import json, sys
print(((json.loads(sys.stdin.read()).get("config") or {}).get("sonos") or {}).get("apiBase"))
' <<<"$resp") || now='(unreadable response)'
    echo "    $id: sonos.apiBase $STALE_SONOS_BASE -> $now"
    fixed=$((fixed + 1))
  done
  echo "    repointed $fixed screen(s)"
fi

echo "==> Done"
