#!/usr/bin/env python3
# Kitchen Smart Display - kiosk HTTP server.
#
# Replaces `python3 -m http.server`. Serves the built React app from
# /home/pi/kiosk over HTTP on 127.0.0.1:8080, and adds two endpoints the
# kiosk uses to control the display panel power:
#
#   POST /api/display/off  -> shells out to wlr-randr --output <out> --off
#   POST /api/display/on   -> shells out to wlr-randr --output <out> --on
#   GET  /api/display/state -> {"on": true|false}
#
# The output name is auto-detected from wlr-randr at request time (so the
# server stays correct even if the cable is plugged into a different HDMI
# port between reboots).

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn

KIOSK_DIR = '/home/pi/kiosk'
# Shared settings state synced from the kitchen display to secondary clients
# (the Apple TV). The kitchen POSTs a subset of settings here on change; the
# TV polls GET /api/state and applies them. Persisted to disk so it survives
# Pi restarts.
STATE_FILE = '/home/pi/state.json'
PORT = 8080
# Bind on all interfaces so LAN clients (the Apple TV) can reach the kiosk
# app and the /api endpoints. The kitchen Chromium still loads via localhost.
BIND = '0.0.0.0'

# Upstream node-sonos-http-api (runs locally on the Pi). The TV reaches it
# through the /api/sonos/* proxy below, so node-sonos-http-api itself does
# not need to be exposed on the LAN.
SONOS_UPSTREAM = 'http://127.0.0.1:5005'


def detect_output():
    """Return the name of the real HDMI/DP output, or None.

    wlr-randr lists outputs in arbitrary order and includes a NOOP-N
    placeholder output that wlroots uses as a fallback when no real output
    is enabled. We must prefer real (HDMI/DP/eDP) outputs - if we send
    --off to NOOP-N, nothing visible happens; if we send --on to NOOP-N
    when the real HDMI is disabled, we get stuck (panel stays off).
    """
    try:
        out = subprocess.run(
            ['wlr-randr'],
            capture_output=True, text=True, timeout=5,
            env={**os.environ, 'WAYLAND_DISPLAY': os.environ.get('WAYLAND_DISPLAY', 'wayland-1')},
        ).stdout
    except Exception as e:
        print(f'wlr-randr failed: {e}', file=sys.stderr)
        return None
    # Output block headers are flush-left, non-empty lines. Collect them.
    names = []
    for line in out.splitlines():
        if line and not line.startswith(' ') and not line.startswith('\t'):
            names.append(line.split()[0])
    # Prefer real outputs over NOOP-*.
    real = [n for n in names if not n.startswith('NOOP')]
    if real:
        return real[0]
    return names[0] if names else None


def get_display_state(output):
    """Return True if the output is Enabled, False otherwise."""
    if not output:
        return None
    try:
        out = subprocess.run(
            ['wlr-randr', '--output', output],
            capture_output=True, text=True, timeout=5,
            env={**os.environ, 'WAYLAND_DISPLAY': os.environ.get('WAYLAND_DISPLAY', 'wayland-1')},
        ).stdout
    except Exception:
        return None
    m = re.search(r'Enabled:\s*(yes|no)', out, re.IGNORECASE)
    if not m:
        return None
    return m.group(1).lower() == 'yes'


def set_display(on):
    out = detect_output()
    if not out:
        return False, 'no output detected'
    cmd = ['wlr-randr', '--output', out, '--on' if on else '--off']
    try:
        r = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=5,
            env={**os.environ, 'WAYLAND_DISPLAY': os.environ.get('WAYLAND_DISPLAY', 'wayland-1')},
        )
        if r.returncode != 0:
            return False, r.stderr.strip()
        return True, out
    except Exception as e:
        return False, str(e)


def read_shared_state():
    """Return the persisted shared-state dict, or {} if absent/invalid."""
    try:
        with open(STATE_FILE, 'r') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception:
        return {}


def write_shared_state(obj):
    """Atomically persist the shared-state dict to STATE_FILE."""
    tmp = STATE_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f)
    os.replace(tmp, STATE_FILE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=KIOSK_DIR, **kwargs)

    def _json(self, code, body):
        payload = json.dumps(body).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def _write_state(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length else b'{}'
            obj = json.loads(raw.decode('utf-8') or '{}')
            if not isinstance(obj, dict):
                return self._json(400, {'ok': False, 'error': 'expected JSON object'})
            # MERGE the incoming top-level keys into the existing state rather
            # than replacing the whole document. The kitchen posts settings
            # (location/school/slideshow) and the live timer (timer) as separate
            # POSTs, so a replace would clobber whichever was posted last.
            merged = read_shared_state()
            merged.update(obj)
            write_shared_state(merged)
            return self._json(200, {'ok': True})
        except Exception as e:
            return self._json(500, {'ok': False, 'error': str(e)})

    def _proxy_sonos(self):
        # Forward /api/sonos/<rest> -> SONOS_UPSTREAM/<rest> (GET only).
        # rest keeps its leading slash and any query string.
        rest = self.path[len('/api/sonos'):]
        target = SONOS_UPSTREAM + (rest if rest else '/')
        try:
            with urllib.request.urlopen(target, timeout=6) as r:
                body = r.read()
                self.send_response(r.status)
                self.send_header('Content-Type', r.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            return self._json(502, {'ok': False, 'error': str(e)})

    def do_GET(self):
        if self.path == '/api/display/state':
            out = detect_output()
            state = get_display_state(out)
            return self._json(200, {'output': out, 'on': state})
        if self.path == '/api/state' or self.path.startswith('/api/state?'):
            return self._json(200, read_shared_state())
        if self.path == '/api/sonos' or self.path.startswith('/api/sonos/'):
            return self._proxy_sonos()
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/display/off':
            ok, info = set_display(False)
            return self._json(200 if ok else 500, {'ok': ok, 'output': info if ok else None, 'error': None if ok else info})
        if self.path == '/api/display/on':
            ok, info = set_display(True)
            return self._json(200 if ok else 500, {'ok': ok, 'output': info if ok else None, 'error': None if ok else info})
        if self.path == '/api/state':
            return self._write_state()
        self.send_response(404)
        self.end_headers()

    # Quieter log: skip the per-request line for static files and for the
    # high-frequency Sonos proxy polling (which would otherwise flood the log).
    def log_message(self, fmt, *args):
        if self.path.startswith('/api/') and not self.path.startswith('/api/sonos'):
            super().log_message(fmt, *args)


class ThreadedServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    server = ThreadedServer((BIND, PORT), Handler)
    print(f'kiosk-server listening on http://{BIND}:{PORT} serving {KIOSK_DIR}')
    out = detect_output()
    print(f'detected display output: {out}')
    server.serve_forever()


if __name__ == '__main__':
    main()
