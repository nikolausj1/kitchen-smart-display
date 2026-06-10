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
        if self.path == '/api/state' or self.path.startswith('/api/state?'):
            return self._json(200, read_shared_state())
        if self.path == '/api/flags' or self.path.startswith('/api/flags?'):
            q = parse_qs(urlparse(self.path).query)
            flags = read_flags()
            if (q.get('unresolved') or ['0'])[0] in ('1', 'true'):
                flags = [f for f in flags if not f.get('resolved')]
            return self._json(200, flags)
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
        if self.path == '/api/state':
            return self._write_state()
        if self.path == '/api/flags':
            return self._append_flag()
        if self.path == '/api/flags/resolve':
            return self._resolve_flags()
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
