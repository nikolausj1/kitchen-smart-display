#!/bin/bash
# photo-refresh.sh - rebuild the kiosk photo manifest from Immich, on the Pi.
#
# The single entry point for every refresh trigger (see
# docs/designs/photo-refresh-automation.md):
#   - kiosk-server.py POST /api/photos/refresh  -> photo-refresh.sh button
#   - photo-refresh.timer (nightly 3am)         -> photo-refresh.sh timer
#   - by hand over ssh                          -> photo-refresh.sh
#
# Single-flight via flock; a second invocation while one runs exits 0 without
# touching anything. Owns refresh-status.json (read by the kitchen Settings
# "Refresh photos" row via GET /api/photos/refresh/status) and refresh.log
# (one run's worth, truncated at start).
#
# Expects /home/pi/photo-build/ to hold: scripts/ (synced by deploy),
# custom-places.json (synced by deploy), .env (secrets, created by hand:
# IMMICH_URL, IMMICH_API_KEY, GOOGLE_API_KEY).

set -u

BUILD_DIR=/home/pi/photo-build
KIOSK_PHOTOS=/home/pi/kiosk/stub-photos
STATUS_FILE=$BUILD_DIR/refresh-status.json
LOG_FILE=$BUILD_DIR/refresh.log
TRIGGER=${1:-manual}
NODE_BIN=${NODE_BIN:-$(command -v node || echo /usr/bin/node)}

exec 9>"$BUILD_DIR/.refresh.lock"
flock -n 9 || exit 0  # another refresh is already running

STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
FINALIZED=0

# Always write status as JSON via python3 so error text with quotes can't
# produce a corrupt file. Atomic via tmp+rename (kiosk-server reads this).
write_status() { # running ok error photoCount
    R="$1" OK="$2" ERR="$3" COUNT="$4" STARTED="$STARTED" TRIGGER="$TRIGGER" \
    python3 - "$STATUS_FILE" <<'EOF'
import json, os, sys, datetime
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
running = os.environ['R'] == '1'
status = {
    'running': running,
    'startedAt': os.environ['STARTED'],
    'trigger': os.environ['TRIGGER'],
}
if not running:
    status['finishedAt'] = now
    status['lastRun'] = now
    status['ok'] = os.environ['OK'] == '1'
    status['error'] = os.environ['ERR'] or None
    status['photoCount'] = int(os.environ['COUNT'] or 0) or None
tmp = sys.argv[1] + '.tmp'
with open(tmp, 'w') as f:
    json.dump(status, f)
os.replace(tmp, sys.argv[1])
EOF
}

# Belt + braces: if the build dies in a way that skips the normal finalize
# (kill, crash), still record a failed run so the UI never spins forever.
finalize_failure() {
    [ "$FINALIZED" = 1 ] && return
    write_status 0 0 "refresh interrupted (see refresh.log)" ""
}
trap finalize_failure EXIT

write_status 1 0 "" ""

cd "$BUILD_DIR"
if [ ! -f "$BUILD_DIR/.env" ]; then
    write_status 0 0 "missing $BUILD_DIR/.env (Immich/Google keys)" ""
    FINALIZED=1
    exit 1
fi
set -a
# shellcheck disable=SC1091
. "$BUILD_DIR/.env"
set +a
if [ -z "${IMMICH_URL:-}" ] || [ -z "${IMMICH_API_KEY:-}" ]; then
    write_status 0 0 "IMMICH_URL / IMMICH_API_KEY not set - fill $BUILD_DIR/.env" ""
    FINALIZED=1
    exit 1
fi

STUB_PHOTOS_DIR=$KIOSK_PHOTOS \
KIOSK_CUSTOM_PLACES_PATH=$BUILD_DIR/custom-places.json \
"$NODE_BIN" "$BUILD_DIR/scripts/build-photo-manifest.mjs" >"$LOG_FILE" 2>&1
RC=$?

COUNT=$(grep -oE 'Wrote [0-9]+ entries' "$LOG_FILE" | grep -oE '[0-9]+' | tail -1)
if [ "$RC" = 0 ]; then
    write_status 0 1 "" "${COUNT:-}"
else
    ERR=$(tail -3 "$LOG_FILE" | tr '\n' ' ' | cut -c1-300)
    write_status 0 0 "${ERR:-build failed (rc=$RC)}" "${COUNT:-}"
fi
FINALIZED=1
exit "$RC"
