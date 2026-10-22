#!/bin/bash
# wifi-selfheal.sh - put the kitchen Pi's Wi-Fi profile back if a power loss
# ate it. Runs as root at every boot (wifi-selfheal.service, after
# NetworkManager has started); also runnable by hand: `sudo wifi-selfheal.sh`.
#
# Why: on 2026-10-20 a boot lasted 17 s before the underpowered Pi browned
# out again, right while NetworkManager was rewriting its connection files.
# ext4 left them zero bytes, so every boot after that came up with no Wi-Fi
# profile at all, no way to reach the hub, and no way to say so. The screen
# stayed dark for a day until someone ran an Ethernet cable to it
# (BACKLOG, "Kitchen Pi is underpowered"). This script makes that failure
# heal itself on the next boot.
#
# What it does:
#   1. Moves any zero-byte NetworkManager keyfile or netplan file out of the
#      way (into BACKUP_DIR) - a truncated file is never valid and only
#      confuses the netplan generator.
#   2. If NetworkManager already has a Wi-Fi profile, stops there.
#   3. Otherwise reads the SSID and password from the cloud-init
#      network-config on the boot partition (what the Imager wrote at setup;
#      FAT, written once, never rewritten, so it survives what the root
#      filesystem does not) and recreates the profile with nmcli, then
#      brings it up. The password stays on the Pi: nothing here prints it.
#
# Every run writes one line to the journal (tag wifi-selfheal) and appends
# the same line to LOG_FILE, so `journalctl -t wifi-selfheal` or the log
# shows what each boot found. Exit 0 whenever nothing is wrong; non-zero only
# when a heal was needed and could not be done, so the unit shows as failed.
#
#   wifi-selfheal.sh          heal if needed
#   wifi-selfheal.sh --check  report what it would do, change nothing

set -u

NETWORK_CONFIG=${NETWORK_CONFIG:-/boot/firmware/network-config}
KEYFILE_DIR=/etc/NetworkManager/system-connections
NETPLAN_DIR=/etc/netplan
BACKUP_DIR=${BACKUP_DIR:-/home/pi/wifi-selfheal-backup}
LOG_FILE=${LOG_FILE:-/home/pi/wifi-selfheal.log}
IFACE=${IFACE:-wlan0}
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

log() {
  local line="$(date '+%F %T') $*"
  echo "$line"
  logger -t wifi-selfheal -- "$*" 2>/dev/null || true
  if [ "$CHECK" = 0 ]; then
    { echo "$line" >>"$LOG_FILE"; } 2>/dev/null || true
  fi
}

# 1. Truncated files out of the way. Only zero-byte files; anything with
# content is left for NetworkManager to judge.
moved=0
for f in "$KEYFILE_DIR"/*.nmconnection "$NETPLAN_DIR"/*.yaml; do
  [ -f "$f" ] || continue
  [ -s "$f" ] && continue
  if [ "$CHECK" = 1 ]; then
    log "would move empty file $f"
  else
    mkdir -p "$BACKUP_DIR"
    mv -f "$f" "$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)-$(basename "$f")" && moved=$((moved + 1))
  fi
done
[ "$moved" -gt 0 ] && log "moved $moved empty connection file(s) to $BACKUP_DIR"

# NetworkManager must be answering before we can ask it anything. At boot the
# unit orders after NetworkManager.service, but give D-Bus a moment anyway.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  nmcli -t general status >/dev/null 2>&1 && break
  sleep 1
done
if ! nmcli -t general status >/dev/null 2>&1; then
  log "NetworkManager not answering; nothing done"
  exit 1
fi

# If we moved files, NetworkManager still holds whatever it parsed at start.
[ "$moved" -gt 0 ] && nmcli connection reload >/dev/null 2>&1

# 2. A Wi-Fi profile already there? Then this boot is fine.
have=$(nmcli -t -f NAME,TYPE connection show 2>/dev/null | awk -F: '$2 == "802-11-wireless" { print $1 }' | head -n1)
if [ -n "$have" ]; then
  log "ok: wifi profile present ($have)"
  exit 0
fi

# 3. No profile. Rebuild it from the Imager's network-config.
if [ ! -r "$NETWORK_CONFIG" ]; then
  log "HEAL FAILED: no wifi profile and $NETWORK_CONFIG is missing"
  exit 1
fi

# The file is small, fixed-shape YAML written by Raspberry Pi Imager:
#   wifis: wlan0: access-points: "<ssid>": password: "<psk>"
# Parse it without PyYAML (not installed on the kiosk image). The SSID is the
# quoted key under access-points; the password is the first `password:` after
# it. Printed as two lines, SSID then password, consumed by read below.
creds=$(python3 -I - "$NETWORK_CONFIG" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r'access-points:\s*\n\s*"((?:[^"\\]|\\.)*)"\s*:\s*\n\s*password:\s*("((?:[^"\\]|\\.)*)"|\S+)', text)
if not m:
    sys.exit(2)
ssid = m.group(1).encode().decode("unicode_escape")
pw = m.group(3) if m.group(3) is not None else m.group(2)
if m.group(3) is not None:
    pw = pw.encode().decode("unicode_escape")
print(ssid)
print(pw)
PY
) || { log "HEAL FAILED: could not read an SSID and password from $NETWORK_CONFIG"; exit 1; }
SSID=$(printf '%s\n' "$creds" | sed -n 1p)
PSK=$(printf '%s\n' "$creds" | sed -n 2p)
unset creds
if [ -z "$SSID" ] || [ -z "$PSK" ]; then
  log "HEAL FAILED: empty SSID or password in $NETWORK_CONFIG"
  exit 1
fi

if [ "$CHECK" = 1 ]; then
  log "would recreate wifi profile '$SSID' on $IFACE from $NETWORK_CONFIG"
  exit 0
fi

# Same shape as the profile rebuilt by hand on 2026-10-22: autoconnect, keep
# retrying forever (the eero may come up after the Pi), DHCP.
if nmcli connection add type wifi ifname "$IFACE" con-name "$SSID" ssid "$SSID" \
     wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK" \
     connection.autoconnect yes connection.autoconnect-priority 10 \
     connection.autoconnect-retries 0 ipv4.method auto ipv6.method auto >/dev/null 2>&1; then
  unset PSK
  log "HEALED: recreated wifi profile '$SSID' on $IFACE from $NETWORK_CONFIG"
else
  unset PSK
  log "HEAL FAILED: nmcli could not add the '$SSID' profile"
  exit 1
fi

# Bring it up now rather than waiting for autoconnect. Not fatal if the
# network is out of range this second; autoconnect keeps trying.
if nmcli connection up "$SSID" >/dev/null 2>&1; then
  log "connected to '$SSID'"
else
  log "profile saved; '$SSID' not up yet (autoconnect will keep trying)"
fi
exit 0
