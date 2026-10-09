"""Verify profile refresh packets using the real server's room handlers."""
import importlib.util
import os
from pathlib import Path
import shutil
from types import SimpleNamespace
import unittest
import uuid


class Socket:
    def __init__(self):
        self.packets = []

    def sendall(self, packet):
        self.packets.append(packet)


class StatsSyncTests(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        parent = Path(__file__).resolve().parent
        self.temp = parent / ('.stats-test-' + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        source = parent.parent / 'bbh-server-hunter-fix_2.py'
        target = self.temp / source.name
        shutil.copyfile(source, target)
        spec = importlib.util.spec_from_file_location('stats_test_server', target)
        self.server = s = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(s)
        account = {field: '0' for field in s.USER_FIELDS}
        account.update(username='Hunter', account_id='100', level='1',
                       kills='33', deaths='12', wins='6', losses='3', bounty='15000')
        s.USER_DB['hunter'] = account
        self.socket = Socket()
        self.user = {'username': 'hunter', 'display_username': 'Hunter', 'socket': self.socket,
                     'slot': s.SLOTS.allocate('100'), 'room': 'Arena',
                     'stats': {'score': 25000, 'kills': 7, 'deaths': 3, 'bounty_points': 9}}
        s.USERS['100'] = self.user
        self.host = SimpleNamespace(rooms={
            '_': {'name': '_', 'players': set(), 'settings_string': '', 'crates': {}},
            'Arena': {'name': 'Arena', 'players': {'100'}, 'settings_string': 'A',
                      'round_length': 630, 'crates': {}},
        })
        self.handler = object.__new__(s.FlashGameHandler)
        self.handler.account_id = '100'
        self.handler.username = 'hunter'
        self.handler.request = self.socket
        self.handler.server = self.host

    def clean_files(self):
        os.chdir(self.cwd)
        parent = Path(__file__).resolve().parent
        if self.temp.resolve().parent != parent or not self.temp.name.startswith('.stats-test-'):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)

    def profile_packet(self, values):
        return ('U001' + 'Hunter'.rjust(20, '#') + ';'.join(map(str, values)) + ';10\x00').encode()

    def test_returning_to_lobby_sends_saved_profile_totals_in_lobby_layout(self):
        self.handler.handle_packet('03_')
        self.assertIn(self.profile_packet([33, 12, 6, 3, 15000]), self.socket.packets)
        self.assertEqual(self.socket.packets[0], b'C001\x00')
        self.assertEqual(self.server.USER_DB['hunter']['kills'], '33')
        self.assertEqual(self.user['stats']['kills'], 0)
        self.assertEqual(self.user['stats']['score'], 10000)

    def test_normal_lobby_refresh_includes_changed_or_reset_totals(self):
        self.handler.handle_packet('03_')
        self.socket.packets.clear()
        for field in ('kills', 'deaths', 'wins', 'losses', 'bounty'):
            self.server.USER_DB['hunter'][field] = '0'
        self.handler.handle_packet('01')
        self.assertEqual(self.socket.packets[0], self.profile_packet([0, 0, 0, 0, 0]))
        self.assertTrue(self.socket.packets[1].startswith(b'01'))
        self.assertFalse(any(packet.startswith(b'A') for packet in self.socket.packets))

    def test_room_list_request_in_a_game_never_sends_lobby_stats(self):
        self.handler.handle_packet('01')
        self.assertFalse(any(packet.startswith(b'U') for packet in self.socket.packets))
        self.assertEqual(self.user['stats']['kills'], 7)
        self.assertEqual(self.server.USER_DB['hunter']['kills'], '33')


if __name__ == '__main__':
    unittest.main()
