#!/usr/bin/env bash
# deploy.sh - push the Smart Display to both hosts.
#
# Since the 2026-08 migration there are two targets, not one:
#
#   Kitchen Pi (smartdisplay.local)  the React kiosk bundle + its own panel
#                                    hardware control. Also still holds the
#                                    DORMANT photo-build as the rollback path,
#                                    so build inputs keep syncing there too.
#   FrameServer (nuc.local:8095)     the photo build + manifest + derivatives
#                                    that every screen reads.
#
# rsync is not available on Windows, so the FrameServer half uses scp.
#
# Usage:  ./deploy.sh            everything
#         ./deploy.sh pi         kitchen Pi only
#         ./deploy.sh hub        FrameServer only
set -euo pipefail
cd "$(dirname "$0")"

PI_HOST=pi@smartdisplay.local
NUC_HOST=micro@nuc.local
NUC_KEY="$HOME/.ssh/sportsbox_nuc_ed25519"
NUC_DIR='C:/Services/FrameServer'
TARGET="${1:-all}"

nuc_ssh() { ssh -i "$NUC_KEY" -o BatchMode=yes "$NUC_HOST" "$@"; }
nuc_scp() { scp -q -i "$NUC_KEY" -o BatchMode=yes "$@"; }

if [ "$TARGET" = all ] || [ "$TARGET" = pi ]; then
  echo "==> Building the kitchen bundle"
  (cd code && npm run build)

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

if [ "$TARGET" = all ] || [ "$TARGET" = hub ]; then
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

  echo "==> FrameServer: service + dashboard"
  nuc_scp frameserver/server.mjs frameserver/admin.html "$NUC_HOST:$NUC_DIR/"
  nuc_ssh 'powershell -NoProfile -Command "Restart-Service SmartDisplayFrameServer; Start-Sleep -Seconds 2; (Invoke-WebRequest http://127.0.0.1:8095/healthz -UseBasicParsing).Content"'
fi

echo "==> Done"
