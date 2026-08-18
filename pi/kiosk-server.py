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
#   POST /api/display/brightness {"value": 0-100} -> DDC/CI backlight
#   GET  /api/display/brightness -> {"value": N}
#
# The output name is auto-detected from wlr-randr at request time (so the
# server stays correct even if the cable is plugged into a different HDMI
# port between reboots).

import datetime
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

KIOSK_DIR = '/home/pi/kiosk'
# Shared settings state synced from the kitchen display to secondary clients
# (the Apple TV). The kitchen POSTs a subset of settings here on change; the
# TV polls GET /api/state and applies them. Persisted to disk so it survives
# Pi restarts.
STATE_FILE = '/home/pi/state.json'
# Photo-location correction flags. The kitchen long-press-flags a photo whose
# caption is wrong; flags accumulate here as a list and get triaged later on
# the Mac. Persisted to disk so they survive Pi restarts.
FLAGS_FILE = '/home/pi/flags.json'
# Photo-refresh: the Pi rebuilds its own photo manifest from Immich (see
# docs/designs/photo-refresh-automation.md). photo-refresh.sh owns the status
# file (flock single-flight, works for both the button and the systemd timer);
# the endpoints here just spawn it / report it.
#   POST /api/photos/refresh        -> start a rebuild (409 if one is running)
#   GET  /api/photos/refresh/status -> contents of refresh-status.json
REFRESH_SCRIPT = '/home/pi/photo-refresh.sh'
REFRESH_STATUS_FILE = '/home/pi/photo-build/refresh-status.json'
# A build that claims to be running for longer than this is a crashed wrapper
# (the wrapper traps EXIT, so this should never trigger in practice).
REFRESH_STALE_SECS = 45 * 60
PORT = 8080
# Bind on all interfaces so LAN clients (the Apple TV) can reach the kiosk
# app and the /api endpoints. The kitchen Chromium still loads via localhost.
BIND = '0.0.0.0'

# Upstream node-sonos-http-api (runs locally on the Pi). The TV reaches it
# through the /api/sonos/* proxy below, so node-sonos-http-api itself does
# not need to be exposed on the LAN.
SONOS_UPSTREAM = 'http://127.0.0.1:5005'

# School-schedule data sources, fetched server-side (the kiosk browser would
# hit CORS) and cached in memory.
#   GET /api/lunch?school=<slug>  -> today-ish lunch menu, parsed + compact
#   GET /api/schoolcal            -> no-school ranges + first/last day, from the
#                                    SPS "School Year Dates" iCal feed
MEALVIEWER_BASE = 'https://api.mealviewer.com/api/v4/school'
DEFAULT_SCHOOL_SLUG = 'Lawton'
SPS_ICS_URL = 'https://www.seattleschools.org/dates/ics/'
HTTP_TIMEOUT = 10
HTTP_UA = 'KitchenSmartDisplay/1.0 (+kiosk)'
LUNCH_TTL = 6 * 3600          # menu changes at most daily
CAL_TTL = 7 * 24 * 3600       # school calendar is static across the year

_cache_lock = threading.Lock()
_lunch_cache = {'data': None, 'at': 0.0, 'slug': None}
_cal_cache = {'data': None, 'at': 0.0}


def _http_get(url):
    req = urllib.request.Request(url, headers={'User-Agent': HTTP_UA, 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return r.read()


# --- Lunch menu (MealViewer) ------------------------------------------------

def _food_items(line):
    fil = line.get('foodItemList') or {}
    items = fil.get('data') if isinstance(fil, dict) else fil
    return items if isinstance(items, list) else []


def fetch_lunch(slug):
    """Fetch a small window around today and return a compact per-date map."""
    today = datetime.date.today()
    start = today - datetime.timedelta(days=1)
    end = today + datetime.timedelta(days=8)
    url = f'{MEALVIEWER_BASE}/{slug}/{start:%m-%d-%Y}/{end:%m-%d-%Y}'
    doc = json.loads(_http_get(url).decode('utf-8'))
    days = {}
    for day in doc.get('menuSchedules') or []:
        di = day.get('dateInformation') or {}
        dk = str(di.get('dateKey') or '')
        if len(dk) != 8:
            continue
        datekey = f'{dk[0:4]}-{dk[4:6]}-{dk[6:8]}'
        entrees, grab, items = [], [], []
        for block in day.get('menuBlocks') or []:
            if (block.get('blockName') or '').lower() != 'lunch':
                continue
            cll = block.get('cafeteriaLineList') or {}
            lines = cll.get('data') if isinstance(cll, dict) else cll
            for line in (lines or []):
                for it in _food_items(line):
                    name = (it.get('item_Name') or '').strip()
                    cat = (it.get('item_Type') or '').strip().lower()
                    if not name:
                        continue
                    items.append(name)
                    if cat == 'entree':
                        entrees.append(name)
                    elif cat.startswith('grab'):
                        grab.append(name)
        days[datekey] = {'entrees': entrees, 'grabAndGo': grab, 'items': items}
    return {'days': days, 'fetchedAt': datetime.datetime.now().isoformat()}


def get_lunch(slug):
    now = time.time()
    with _cache_lock:
        c = _lunch_cache
        if c['data'] and c['slug'] == slug and now - c['at'] < LUNCH_TTL:
            return c['data']
    data = fetch_lunch(slug)
    with _cache_lock:
        _lunch_cache.update(data=data, at=now, slug=slug)
    return data


# --- School calendar (SPS iCal "School Year Dates" feed) ---------------------

def _ics_unfold(text):
    # RFC 5545 line folding: CRLF + space/tab continues the previous line.
    return re.sub(r'\r?\n[ \t]', '', text)


def _ics_date(val):
    m = re.search(r'(\d{8})', val or '')
    if not m:
        return None
    s = m.group(1)
    try:
        return datetime.date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def fetch_school_cal():
    """Parse all-day VEVENTs; keep 'No School ...' ranges + first/last days.

    DTEND is exclusive for all-day events, so the inclusive end is DTEND - 1 day.
    """
    text = _ics_unfold(_http_get(SPS_ICS_URL).decode('utf-8', 'replace'))
    ranges, first_days, last_days = [], [], []
    for chunk in text.split('BEGIN:VEVENT')[1:]:
        body = chunk.split('END:VEVENT')[0]
        sm = re.search(r'\nSUMMARY:(.+)', body)
        ds = re.search(r'\nDTSTART[^:\n]*:([0-9T]+)', body)
        de = re.search(r'\nDTEND[^:\n]*:([0-9T]+)', body)
        if not sm or not ds:
            continue
        summary = sm.group(1).strip()
        start = _ics_date(ds.group(1))
        if not start:
            continue
        end = _ics_date(de.group(1)) if de else None
        inc_end = (end - datetime.timedelta(days=1)) if end else start
        low = summary.lower()
        if low.startswith('no school'):
            ranges.append({'start': start.isoformat(), 'end': inc_end.isoformat(),
                           'summary': summary})
        if 'first day of school' in low:
            first_days.append(start.isoformat())
        if 'last day of school' in low:
            last_days.append(start.isoformat())
    return {'noSchoolRanges': ranges, 'firstDays': sorted(first_days),
            'lastDays': sorted(last_days),
            'fetchedAt': datetime.datetime.now().isoformat()}


def get_school_cal():
    now = time.time()
    with _cache_lock:
        if _cal_cache['data'] and now - _cal_cache['at'] < CAL_TTL:
            return _cal_cache['data']
    data = fetch_school_cal()
    with _cache_lock:
        _cal_cache.update(data=data, at=now)
    return data


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


# --- DDC/CI backlight --------------------------------------------------------
# The panel's REAL backlight, commanded over the HDMI cable with ddcutil - the
# same control as its physical brightness buttons. Until now "dimming" was a
# black CSS overlay painted over a panel still running at 100%: it glows in a
# dark kitchen, blacks read grey, and it draws full power all night.
#
# Why this is safe where the wlr-randr DPMS path was not: `setvcp 10` lowers the
# backlight WITHOUT disabling the output, so wlroots keeps delivering input
# events to clients and touch-to-wake still works. Disabling the output is what
# broke it before.
#
#   POST /api/display/brightness  {"value": 0-100}
#   GET  /api/display/brightness  -> {"value": N}
#
# Verified on this panel 2026-06-22 and again 2026-08-18: Realtek controller,
# VCP 2.2, /dev/i2c-13, clean read/write both directions, and the Pi 5 setvcp
# bug (ddcutil #356) does not affect it. Runs as `pi` - no sudo, no new privs.
DDC_TIMEOUT = 8          # a flaky I2C bus must never hang the server
DDC_MIN_BRIGHTNESS = 1   # never drive to 0 over DDC; the overlay guarantees black
_ddc_bus = None          # cached bus number, re-detected on failure


def detect_ddc_bus(force=False):
    """Return the I2C bus number the panel answers DDC/CI on, or None.

    Never hardcode this. The ddcutil docs say i2c-11, this panel is on i2c-13,
    and the number can drift across kernel updates - so detect once, cache, and
    re-detect if a write ever fails.
    """
    global _ddc_bus
    if _ddc_bus is not None and not force:
        return _ddc_bus
    try:
        out = subprocess.run(
            ['ddcutil', 'detect', '--brief'],
            capture_output=True, text=True, timeout=20,
        ).stdout
    except Exception as e:
        print(f'ddcutil detect failed: {e}', file=sys.stderr)
        _ddc_bus = None
        return None
    m = re.search(r'/dev/i2c-(\d+)', out)
    _ddc_bus = int(m.group(1)) if m else None
    if _ddc_bus is None:
        print('ddcutil detect: no I2C bus found', file=sys.stderr)
    return _ddc_bus


def get_brightness():
    """Current backlight 0-100, or None if DDC is unavailable."""
    bus = detect_ddc_bus()
    if bus is None:
        return None
    try:
        r = subprocess.run(
            ['ddcutil', '--bus', str(bus), 'getvcp', '10', '--brief'],
            capture_output=True, text=True, timeout=DDC_TIMEOUT,
        )
        if r.returncode != 0:
            return None
        # --brief prints: "VCP 10 C <current> <max>"
        parts = r.stdout.split()
        return int(parts[3]) if len(parts) >= 4 else None
    except Exception:
        return None


def set_brightness(value):
    """Set the backlight. Returns (ok, info) like set_display.

    Clamped to DDC_MIN_BRIGHTNESS..100 so a bad caller can never black the panel
    out over DDC alone - "off" is the overlay's job, and it is recoverable by
    touch. One retry with a forced re-detect covers bus-number drift.
    """
    try:
        v = int(value)
    except (TypeError, ValueError):
        return False, 'value must be a number'
    v = max(DDC_MIN_BRIGHTNESS, min(100, v))

    for attempt in (0, 1):
        bus = detect_ddc_bus(force=(attempt == 1))
        if bus is None:
            continue
        try:
            r = subprocess.run(
                ['ddcutil', '--bus', str(bus), 'setvcp', '10', str(v)],
                capture_output=True, text=True, timeout=DDC_TIMEOUT,
            )
            if r.returncode == 0:
                return True, v
            if attempt == 1:
                return False, (r.stderr or r.stdout).strip()[:200]
        except Exception as e:
            if attempt == 1:
                return False, str(e)
    return False, 'ddc unavailable'


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


def read_flags():
    """Return the persisted photo-correction flags list, or [] if absent."""
    try:
        with open(FLAGS_FILE, 'r') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception:
        return []


def write_flags(items):
    """Atomically persist the flags list to FLAGS_FILE."""
    tmp = FLAGS_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(items, f)
    os.replace(tmp, FLAGS_FILE)


def read_refresh_status():
    """Return the photo-refresh status dict written by photo-refresh.sh.

    Downgrades a stale 'running' claim (crashed wrapper) so the Settings UI
    never shows a spinner forever.
    """
    try:
        with open(REFRESH_STATUS_FILE, 'r') as f:
            status = json.load(f)
        if not isinstance(status, dict):
            return {}
    except FileNotFoundError:
        return {'running': False, 'lastRun': None}
    except Exception:
        return {}
    if status.get('running'):
        try:
            started = datetime.datetime.fromisoformat(
                str(status.get('startedAt', '')).replace('Z', '+00:00'))
            age = (datetime.datetime.now(datetime.timezone.utc) - started).total_seconds()
            if age > REFRESH_STALE_SECS:
                status['running'] = False
                status['ok'] = False
                status['error'] = 'previous run never finished (stale)'
        except Exception:
            pass
    return status


def start_refresh(trigger):
    """Spawn photo-refresh.sh detached. Returns (started, status_or_error).

    The wrapper's flock is the real single-flight guarantee (it also covers
    timer-started runs); the status check here just gives the caller a clean
    409 instead of a silently no-op'd spawn.
    """
    status = read_refresh_status()
    if status.get('running'):
        return False, status
    if not os.path.exists(REFRESH_SCRIPT):
        return False, {'error': f'{REFRESH_SCRIPT} not found'}
    subprocess.Popen(
        [REFRESH_SCRIPT, trigger],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return True, None


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

    def _append_flag(self):
        # Append a photo-location correction flag, deduped on assetId so the
        # same photo long-pressed twice just refreshes the existing flag.
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length else b'{}'
            obj = json.loads(raw.decode('utf-8') or '{}')
            asset_id = obj.get('assetId') if isinstance(obj, dict) else None
            if not asset_id:
                return self._json(400, {'ok': False, 'error': 'assetId required'})
            now = obj.get('ts') or (datetime.datetime.utcnow().isoformat() + 'Z')
            flags = read_flags()
            existing = next(
                (f for f in flags
                 if f.get('assetId') == asset_id and not f.get('resolved')),
                None,
            )
            if existing:
                existing['ts'] = now
                existing['wrongCaption'] = obj.get('wrongCaption', existing.get('wrongCaption', ''))
            else:
                flags.append({
                    'assetId': asset_id,
                    'wrongCaption': obj.get('wrongCaption', ''),
                    'ts': now,
                    'resolved': False,
                })
            write_flags(flags)
            unresolved = len([f for f in flags if not f.get('resolved')])
            return self._json(200, {'ok': True, 'unresolved': unresolved})
        except Exception as e:
            return self._json(500, {'ok': False, 'error': str(e)})

    def _resolve_flags(self):
        # Mark the given assetIds resolved (called after corrections are
        # applied + redeployed) so they drop out of the triage list.
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length else b'{}'
            obj = json.loads(raw.decode('utf-8') or '{}')
            ids = obj.get('assetIds') if isinstance(obj, dict) else None
            if not isinstance(ids, list):
                return self._json(400, {'ok': False, 'error': 'assetIds must be a list'})
            idset = set(ids)
            flags = read_flags()
            n = 0
            for f in flags:
                if f.get('assetId') in idset and not f.get('resolved'):
                    f['resolved'] = True
                    n += 1
            write_flags(flags)
            return self._json(200, {'ok': True, 'resolved': n})
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
        if self.path == '/api/display/brightness':
            v = get_brightness()
            return self._json(200, {'value': v, 'available': v is not None})
        if self.path == '/api/state' or self.path.startswith('/api/state?'):
            return self._json(200, read_shared_state())
        if self.path == '/api/flags' or self.path.startswith('/api/flags?'):
            q = parse_qs(urlparse(self.path).query)
            flags = read_flags()
            if (q.get('unresolved') or ['0'])[0] in ('1', 'true'):
                flags = [f for f in flags if not f.get('resolved')]
            return self._json(200, flags)
        if self.path == '/api/photos/refresh/status':
            return self._json(200, read_refresh_status())
        if self.path == '/api/sonos' or self.path.startswith('/api/sonos/'):
            return self._proxy_sonos()
        if self.path == '/api/schoolcal' or self.path.startswith('/api/schoolcal?'):
            try:
                return self._json(200, get_school_cal())
            except Exception as e:
                if _cal_cache['data']:                   # serve stale on error
                    return self._json(200, _cal_cache['data'])
                return self._json(502, {'error': str(e), 'noSchoolRanges': [],
                                        'firstDays': [], 'lastDays': []})
        if self.path == '/api/lunch' or self.path.startswith('/api/lunch?'):
            q = parse_qs(urlparse(self.path).query)
            slug = (q.get('school') or [DEFAULT_SCHOOL_SLUG])[0] or DEFAULT_SCHOOL_SLUG
            try:
                return self._json(200, get_lunch(slug))
            except Exception as e:
                if _lunch_cache['data']:                 # serve stale on error
                    return self._json(200, _lunch_cache['data'])
                return self._json(502, {'error': str(e), 'days': {}})
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/display/off':
            ok, info = set_display(False)
            return self._json(200 if ok else 500, {'ok': ok, 'output': info if ok else None, 'error': None if ok else info})
        if self.path == '/api/display/on':
            ok, info = set_display(True)
            return self._json(200 if ok else 500, {'ok': ok, 'output': info if ok else None, 'error': None if ok else info})
        if self.path == '/api/display/brightness':
            try:
                length = int(self.headers.get('Content-Length') or 0)
                body = json.loads(self.rfile.read(length) or b'{}')
            except Exception as e:
                return self._json(400, {'ok': False, 'error': f'bad body: {e}'})
            ok, info = set_brightness(body.get('value'))
            # 200 with ok:false rather than 5xx: the client treats a failure as
            # "fall back to the CSS overlay", not as an error worth surfacing.
            return self._json(200, {'ok': ok, 'value': info if ok else None,
                                    'error': None if ok else info})
        if self.path == '/api/state':
            return self._write_state()
        if self.path == '/api/flags':
            return self._append_flag()
        if self.path == '/api/flags/resolve':
            return self._resolve_flags()
        if self.path == '/api/photos/refresh':
            try:
                started, status = start_refresh('button')
                if started:
                    return self._json(200, {'ok': True, 'started': True})
                if status.get('running'):
                    return self._json(409, {'ok': False, 'running': True})
                return self._json(500, {'ok': False, 'error': status.get('error', 'unknown')})
            except Exception as e:
                return self._json(500, {'ok': False, 'error': str(e)})
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
