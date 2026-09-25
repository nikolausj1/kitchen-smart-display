#!/usr/bin/env python3
# Tests for the heartbeat in kiosk-server.py (stdlib only, runs on the Mac):
#
#   python3 -m unittest discover -s pi -v
#
# Not deployed: deploy.sh copies named files to the Pi, and this is not one.
# kiosk-server.py has a dash in its name, so it is loaded by path; importing it
# starts nothing (the server and the heartbeat start in main()).

import doctest
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('kiosk_server', os.path.join(HERE, 'kiosk-server.py'))
ks = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ks)

FLAG_NAMES = [name for _, name in ks.THROTTLE_BITS]


def load_tests(loader, tests, ignore):
    # The examples in the docstrings (decode_throttled, kmsg_dip_usec) too.
    tests.addTests(doctest.DocTestSuite(ks))
    return tests


class DecodeThrottledTest(unittest.TestCase):
    def test_kitchen_2026_09_22(self):
        # The value read seven minutes after the reset: undervoltage and
        # throttling have occurred since boot, nothing is happening now.
        d = ks.decode_throttled('throttled=0x50000')
        self.assertEqual(d['raw'], '0x50000')
        on = sorted(k for k in FLAG_NAMES if d[k])
        self.assertEqual(on, ['throttledOccurred', 'underVoltageOccurred'])

    def test_every_bit_alone(self):
        for bit, name in ks.THROTTLE_BITS:
            d = ks.decode_throttled(1 << bit)
            self.assertEqual(d['raw'], hex(1 << bit))
            self.assertEqual([k for k in FLAG_NAMES if d[k]], [name], f'bit {bit}')

    def test_all_and_none(self):
        self.assertTrue(all(ks.decode_throttled('throttled=0xf000f')[k] for k in FLAG_NAMES))
        zero = ks.decode_throttled('throttled=0x0')
        self.assertEqual(zero['raw'], '0x0')
        self.assertFalse(any(zero[k] for k in FLAG_NAMES))

    def test_undervoltage_now(self):
        d = ks.decode_throttled('0x50005')
        self.assertTrue(d['underVoltageNow'] and d['throttledNow'])
        self.assertTrue(d['underVoltageOccurred'] and d['throttledOccurred'])
        self.assertFalse(d['armFreqCappedNow'] or d['softTempLimitNow'])

    def test_bits_outside_the_eight_are_ignored(self):
        d = ks.decode_throttled('throttled=0x100000')  # bit 20: not decoded
        self.assertEqual(d['raw'], '0x100000')
        self.assertFalse(any(d[k] for k in FLAG_NAMES))

    def test_unreadable(self):
        for raw in (None, '', 'throttled=', 'garbage', 'throttled=0x', -1, True, 3.5, b'0x5'):
            self.assertIsNone(ks.decode_throttled(raw), repr(raw))


class KernelDipsTest(unittest.TestCase):
    def test_counts_undervoltage_records_incrementally(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'kmsg')
            with open(path, 'wb') as f:
                f.write(b'6,1,1000000,-;booting\n'
                        b'2,2,5000000,-;hwmon hwmon3: Undervoltage detected!\n'
                        b' SUBSYSTEM=hwmon\n'
                        b' DEVICE=+hwmon:hwmon3\n'
                        b'6,3,7000000,-;hwmon hwmon3: Voltage normalised\n')
            dips = ks.KernelDips(path)
            self.assertEqual(dips.poll(), (1, 5000000))
            self.assertEqual(dips.poll(), (1, 5000000))  # nothing new
            with open(path, 'ab') as f:
                f.write(b'2,4,9000000,-;hwmon hwmon3: Undervoltage detected!\n')
            self.assertEqual(dips.poll(), (2, 9000000))

    def test_no_kernel_log(self):
        self.assertEqual(ks.KernelDips('/nonexistent/kmsg').poll(), (None, None))


class BuildPayloadTest(unittest.TestCase):
    KEYS = ['id', 'at', 'uptimeS', 'throttled', 'tempC', 'load1', 'memFreeMb', 'diskFreeGb',
            'kernel', 'model', 'build', 'underVoltageDips', 'lastDipAgoS']

    def test_shape_and_size(self):
        p = ks.build_payload()
        self.assertEqual(list(p), self.KEYS)
        self.assertEqual(p['id'], ks.DEVICE_ID)
        self.assertRegex(p['at'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
        # The hub refuses a report over 1 KB; a full one from the Pi is ~560 bytes.
        body = json.dumps(p, separators=(',', ':'))
        self.assertLess(len(body.encode()), 1024)

    @unittest.skipIf(shutil.which('vcgencmd'), 'this machine has vcgencmd')
    def test_no_vcgencmd_gives_nulls(self):
        p = ks.build_payload()
        self.assertIsNone(p['throttled'])
        if not os.path.exists('/proc/uptime'):   # a Mac: no Linux readings at all
            for k in ('uptimeS', 'memFreeMb', 'model', 'underVoltageDips', 'lastDipAgoS'):
                self.assertIsNone(p[k], k)


class _Hub(BaseHTTPRequestHandler):
    """A stand-in hub: records POSTs, answers with the class's status."""
    status = 204
    received = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        type(self).received.append((self.path, self.headers.get('Content-Type'), json.loads(body)))
        self.send_response(self.status)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def log_message(self, *args):
        pass


class HeartbeatTest(unittest.TestCase):
    def setUp(self):
        _Hub.status, _Hub.received = 204, []
        self.hub = HTTPServer(('127.0.0.1', 0), _Hub)
        threading.Thread(target=self.hub.serve_forever, daemon=True).start()
        self.live = f'http://127.0.0.1:{self.hub.server_address[1]}'
        # Nothing listens on port 1: a fast "connection refused".
        self.dead = 'http://127.0.0.1:1'
        self.saved = ks.HUB_URLS

    def tearDown(self):
        ks.HUB_URLS = self.saved
        self.hub.shutdown()
        self.hub.server_close()

    def test_falls_back_to_the_second_address(self):
        ks.HUB_URLS = [self.dead, self.live]
        outcome = ks.post_heartbeat({'id': 'kitchen', 'uptimeS': 5})
        self.assertEqual(outcome, f'ok, {self.live} answered 204')
        path, ctype, body = _Hub.received[0]
        self.assertEqual(path, f'/api/devices/{ks.DEVICE_ID}/health')
        self.assertEqual(ctype, 'application/json')
        self.assertEqual(body, {'id': 'kitchen', 'uptimeS': 5})

    def test_an_error_answer_is_final(self):
        _Hub.status = 404
        ks.HUB_URLS = [self.live, self.dead]
        self.assertEqual(ks.post_heartbeat({}), f'{self.live} answered 404')

    def test_unreachable(self):
        ks.HUB_URLS = [self.dead]
        self.assertTrue(ks.post_heartbeat({}).startswith('hub unreachable (http://127.0.0.1:1: '))

    def test_logs_once_per_change(self):
        lines = []
        note = lambda msg, level=None: lines.append(msg)
        ks.HUB_URLS = [self.dead]
        last = {}
        for _ in range(3):
            last = ks.heartbeat_step(last, note)
        unreachable = [m for m in lines if 'hub unreachable' in m]
        self.assertEqual(len(unreachable), 1, lines)
        self.assertEqual(len([m for m in lines if m.startswith('throttled: ')]), 1, lines)
        ks.HUB_URLS = [self.live]
        for _ in range(3):
            last = ks.heartbeat_step(last, note)
        self.assertEqual(len([m for m in lines if ': ok, ' in m]), 1, lines)
        self.assertEqual(len(_Hub.received), 3)
        self.assertEqual(len(lines), 3, lines)


class HealthRouteTest(unittest.TestCase):
    def test_get_api_health(self):
        server = ks.ThreadedServer(('127.0.0.1', 0), ks.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            url = f'http://127.0.0.1:{server.server_address[1]}/api/health'
            with urllib.request.urlopen(url, timeout=10) as r:
                self.assertEqual(r.status, 200)
                self.assertEqual(r.headers['Content-Type'], 'application/json')
                p = json.loads(r.read())
            self.assertEqual(list(p), BuildPayloadTest.KEYS)
            self.assertEqual(p['id'], ks.DEVICE_ID)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
