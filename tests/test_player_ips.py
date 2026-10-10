"""IP forwarding and login tests using isolated files and real local TCP sockets.

The optional WebSocket package imports are stubbed; the bridge relay, TCP
connection, backend packet parser and login logger execute normally.
"""
import asyncio
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import uuid


class Socket:
    def __init__(self):
        self.packets = []

    def sendall(self, packet):
        self.packets.append(packet)

    def shutdown(self, _):
        pass

    def close(self):
        pass


class ServerFixture:
    def setUp(self):
        self.cwd = os.getcwd()
        root = Path(__file__).resolve().parents[1]
        self.temp = root / 'tests' / ('.player-ip-test-' + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        target = self.temp / 'bbh-server-hunter-fix_2.py'
        shutil.copyfile(root / target.name, target)
        spec = importlib.util.spec_from_file_location('ip_test_server', target)
        self.server = s = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(s)
        s.USER_DB['opeth'] = {field: '0' for field in s.USER_FIELDS}
        s.USER_DB['opeth'].update(username='Opeth', account_id='100', password_hash=s.md5_hash('secret'))
        self.host = SimpleNamespace(rooms={'_': self.lobby()})

    @staticmethod
    def lobby():
        return {'name': '_', 'players': set(), 'round_start': None, 'round_length': 630,
                'settings_string': '', 'crates': {}}

    def connection(self, peer='127.0.0.1'):
        handler = object.__new__(self.server.FlashGameHandler)
        handler.account_id = handler.username = None
        handler.server = self.host
        handler.request = Socket()
        handler.client_address = (peer, 1234)
        return handler

    def login(self, handler):
        handler.handle_packet('09Opeth;secret')
        return (self.temp / 'login_ips.log').read_text(encoding='utf-8')

    def clean_files(self):
        os.chdir(self.cwd)
        parent = Path(__file__).resolve().parent
        if self.temp.resolve().parent != parent or not self.temp.name.startswith('.player-ip-test-'):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)


class PlayerIPTests(ServerFixture, unittest.TestCase):
    def test_loopback_bridge_ip_is_logged_without_changing_transport_address(self):
        handler = self.connection()
        handler.handle_packet('@bridge-ip:198.51.100.24')
        self.assertIn('IP: 198.51.100.24', self.login(handler))
        self.assertEqual(handler.client_address[0], '127.0.0.1')

    def test_ipv6_player_and_loopback_bridge_addresses(self):
        handler = self.connection('::1')
        handler.handle_packet('@bridge-ip:2001:0db8:0:0:0:0:0:24')
        self.assertIn('IP: 2001:db8::24', self.login(handler))

    def test_remote_tcp_client_cannot_supply_forwarded_ip(self):
        handler = self.connection('203.0.113.20')
        handler.handle_packet('@bridge-ip:198.51.100.24')
        self.assertIn('IP: 203.0.113.20', self.login(handler))

    def test_later_headers_cannot_replace_bridge_ip_before_or_after_login(self):
        handler = self.connection()
        handler.handle_packet('@bridge-ip:198.51.100.24')
        handler.handle_packet('@bridge-ip:203.0.113.99')
        self.assertIn('IP: 198.51.100.24', self.login(handler))
        handler.handle_packet('@bridge-ip:203.0.113.99')
        self.assertEqual(handler.player_ip, '198.51.100.24')

    def test_metadata_after_a_failed_login_is_ignored(self):
        handler = self.connection()
        handler.handle_packet('09Opeth;wrong')
        handler.handle_packet('@bridge-ip:198.51.100.24')
        self.assertIn('IP: 127.0.0.1', self.login(handler))

    def test_invalid_address_cannot_inject_lines_into_log(self):
        handler = self.connection()
        handler.handle_packet('@bridge-ip:198.51.100.24\nFake log entry')
        log = self.login(handler)
        self.assertIn('IP: 127.0.0.1', log)
        self.assertEqual(len(log.splitlines()), 1)

    def test_ip_ban_checks_forwarded_player_address(self):
        (self.temp / 'banlist.txt').write_text('198.51.100.24\n', encoding='utf-8')
        handler = self.connection()
        handler.handle_packet('@bridge-ip:198.51.100.24')
        handler.handle_packet('09Opeth;secret')
        self.assertIsNone(handler.account_id)
        self.assertIn(b'10;0;Banned\x00', handler.request.packets)
        self.assertFalse((self.temp / 'login_ips.log').exists())

    def test_direct_legacy_login_keeps_original_ip(self):
        handler = self.connection('203.0.113.20')
        self.assertIn('IP: 203.0.113.20', self.login(handler))


def load_bridge():
    names = ['websockets', 'websockets.asyncio', 'websockets.asyncio.server',
             'websockets.exceptions', 'websockets.datastructures', 'websockets.http11']
    modules = {name: ModuleType(name) for name in names}
    modules['websockets.asyncio.server'].serve = lambda *args, **kwargs: None
    modules['websockets.exceptions'].ConnectionClosed = type('ConnectionClosed', (Exception,), {})
    modules['websockets.datastructures'].Headers = object
    modules['websockets.http11'].Response = object
    source = Path(__file__).resolve().parents[1] / 'BBHServer.py'
    spec = importlib.util.spec_from_file_location('ip_test_bridge', source)
    bridge = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(bridge)
    return bridge


class Browser:
    def __init__(self, address, messages):
        self.remote_address = address
        self.messages = messages
        self.reply = asyncio.Event()
        self.packets = []
        self.closed = None
        self.request = SimpleNamespace(headers={'X-Forwarded-For': '203.0.113.99'})

    async def __aiter__(self):
        for message in self.messages:
            yield message
        await self.reply.wait()

    async def send(self, packet):
        self.packets.append(packet)
        if b'10;1;' in packet or b'10;0;' in packet:
            self.reply.set()

    async def close(self, **kwargs):
        self.closed = kwargs
        self.reply.set()


class BridgeIPTests(ServerFixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge = load_bridge()
        self.logged = threading.Event()
        original_log = self.server.log_player_ip

        def log(username, address):
            original_log(username, address)
            self.logged.set()

        self.server.log_player_ip = log
        self.tcp = self.server.ThreadedTCPServer(('127.0.0.1', 0), self.server.FlashGameHandler)
        self.tcp.rooms = self.host.rooms
        self.thread = threading.Thread(target=self.tcp.serve_forever, daemon=True)
        self.thread.start()

    async def asyncTearDown(self):
        await asyncio.to_thread(self.tcp.shutdown)
        self.tcp.server_close()
        self.thread.join(timeout=2)

    async def check_login(self, address, messages, expected):
        browser = Browser(address, messages)
        await asyncio.wait_for(self.bridge.relay(browser, self.tcp.server_address[1]), 3)
        self.assertTrue(await asyncio.to_thread(self.logged.wait, 2))
        self.assertIn(b'10;1;', b''.join(browser.packets))
        log = (self.temp / 'login_ips.log').read_text(encoding='utf-8')
        self.assertIn('IP: ' + expected, log)
        self.assertNotIn('IP: 127.0.0.1', log)
        self.assertNotIn('IP: 203.0.113.99', log)

    async def test_text_login_uses_network_peer_address(self):
        await self.check_login(('198.51.100.24', 1234), ['09Opeth;secret\x00'], '198.51.100.24')

    async def test_binary_fragmented_login_cannot_override_bridge_metadata(self):
        await self.check_login(('198.51.100.24', 1234),
                               [b'@bridge-ip:203.0.113.99\x00', b'09Op', b'eth;secret\x00'],
                               '198.51.100.24')

    async def test_ipv6_browser_address_is_preserved_over_local_ipv4_tcp(self):
        await self.check_login(('2001:db8::24', 1234, 0, 0), ['09Opeth;secret\x00'], '2001:db8::24')

    async def test_missing_peer_address_is_rejected(self):
        browser = Browser(None, ['09Opeth;secret\x00'])
        await self.bridge.relay(browser, self.tcp.server_address[1])
        self.assertEqual(browser.closed['code'], 1011)
        self.assertFalse((self.temp / 'login_ips.log').exists())


if __name__ == '__main__':
    unittest.main()
