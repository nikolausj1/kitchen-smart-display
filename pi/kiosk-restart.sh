#!/bin/sh
# Kitchen Smart Display - post-deploy restart script.
#
# Called from `npm run deploy` via SSH after the new kiosk app and server
# files have been rsynced over. Does the minimum needed to pick up the new
# code without a reboot:
#   1. Install the latest autostart into ~/.config/labwc (so the next labwc
#      restart still works).
#   2. Free TCP :8080 (kills whatever Python server is currently bound -
#      `fuser -k` doesn't care whether it's the old http.server, our new
#      kiosk-server, or anything else).
#   3. Start kiosk-server.py detached, with the running Wayland session's
#      socket auto-detected so wlr-randr can actually reach the compositor.
#   4. Kill Chromium so the original autostart's `while true` loop
#      relaunches it pointing at the just-restarted server.
#   5. Clear the Chromium HTTP cache to avoid stale-asset weirdness.

set -e

# 1. Install autostart.
mkdir -p /home/pi/.config/labwc
cp /home/pi/labwc-autostart /home/pi/.config/labwc/autostart
chmod +x /home/pi/.config/labwc/autostart

# 5. Clear cache (cheap, do it now while no clients depend on cache files).
rm -rf /home/pi/.cache/chromium /home/pi/.config/chromium/Default/Cache

# 2. Free port 8080. Suppress output - the new server will rebind.
fuser -k 8080/tcp >/dev/null 2>&1 || true
sleep 1

# 3. Detect the active Wayland socket. labwc usually creates wayland-0 or
# wayland-1; we just grab the first matching one for this user's runtime
# dir. Without WAYLAND_DISPLAY set correctly, wlr-randr in the server's
# /api/display endpoints will fail with "compositor doesn't support" etc.
WAYLAND_SOCK="$(ls /run/user/$(id -u)/wayland-* 2>/dev/null | grep -v '\.lock$' | head -n1 | xargs -n1 basename)"
if [ -z "$WAYLAND_SOCK" ]; then
  echo "warning: no wayland-* socket found in /run/user/$(id -u)/" >&2
  WAYLAND_SOCK="wayland-0"
fi
echo "starting kiosk-server with WAYLAND_DISPLAY=$WAYLAND_SOCK"

# Append, do not truncate. Killing 8080 and restarting can race with labwc's
# autostart relaunching the server too; the loser dies with "Address already in
# use". With `>` the loser's traceback overwrote the winner's startup output,
# which hid a genuine diagnostic (the DDC panel-wake line) during the 2026-08-18
# hardware-dimming work. Losing a race is harmless; losing the log is not.
{ echo; echo "=== kiosk-server start $(date "+%F %T") ==="; } >>/tmp/kiosk-server.log
setsid env WAYLAND_DISPLAY="$WAYLAND_SOCK" python3 /home/pi/kiosk-server.py \
  >>/tmp/kiosk-server.log 2>&1 </dev/null &
disown 2>/dev/null || true

# 4. Bounce Chromium. The existing autostart's `while true; do chromium...
# sleep 2; done` loop will restart it within ~2s.
pkill -f chromium >/dev/null 2>&1 || true

# Done. Exit cleanly so SSH doesn't hang.
exit 0
