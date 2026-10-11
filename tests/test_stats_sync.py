"""Verify profile refresh packets using the real server's room handlers."""
import importlib.util
import os
from pathlib import Path
import shutil
import time
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
        # The production leaderboard export writes to the deployed web root.
        s.update_most_wanted_xml = lambda: None
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

    def finishable_round(self, mode='A', header='A00'):
        room = self.host.rooms['Arena'] = {
            'name': 'Arena', 'players': {'100'}, 'settings_string': mode,
            'mode': mode, 'header': header, 'round_start': time.time() - 601,
            'round_length': 630, 'crates': {},
        }
        return room

    def assert_saved_round(self):
        totals = self.server.USER_DB['hunter']
        self.assertEqual([totals[field] for field in ('kills', 'deaths', 'wins', 'losses', 'bounty')],
                         ['40', '15', '7', '3', '15009'])
        packet = b'P' + self.server.auth_packet('100')[1:]
        self.assertIn(packet, self.socket.packets)
        return packet

    def test_ranked_round_pushes_committed_totals_once_without_a_new_login(self):
        room = self.finishable_round()
        self.handler.check_timer('Arena')
        packet = self.assert_saved_round()
        self.assertEqual(room['round_state'], 'ended')
        self.assertEqual(self.user['room'], 'Arena')
        self.assertFalse(any(p.startswith(b'A') for p in self.socket.packets))
        self.handler.check_timer('Arena')
        self.assertEqual(self.socket.packets.count(packet), 1)
        self.assert_saved_round()

    def test_player_returning_to_lobby_during_save_receives_fresh_totals(self):
        self.finishable_round()
        commit = self.server.commit_round_results

        def leave_then_save(round_id, players):
            self.handler.handle_packet('03_')
            return commit(round_id, players)

        self.server.commit_round_results = leave_then_save
        self.handler.check_timer('Arena')
        packet = self.assert_saved_round()
        self.assertEqual(self.user['room'], '_')
        stale_lobby_packet = self.profile_packet([33, 12, 6, 3, 15000])
        self.assertIn(stale_lobby_packet, self.socket.packets)
        self.assertLess(self.socket.packets.index(stale_lobby_packet), self.socket.packets.index(packet))

    def test_failed_save_does_not_publish_totals_and_retry_publishes_frozen_result(self):
        room = self.finishable_round()
        commit = self.server.commit_round_results

        def fail(*_):
            raise OSError('disk unavailable')

        self.server.commit_round_results = fail
        self.handler.check_timer('Arena')
        self.assertFalse(any(p.startswith(b'P') for p in self.socket.packets))
        self.assertEqual(self.server.USER_DB['hunter']['kills'], '33')
        self.server.commit_round_results = commit
        self.user['stats']['kills'] = 999
        room['round_retry_at'] = 0
        self.handler.check_timer('Arena')
        self.assert_saved_round()

    def test_private_and_other_unranked_rounds_do_not_publish_saved_increments(self):
        for mode, header in [('A', 'A01'), ('B', 'B00'), ('C', 'C00')]:
            with self.subTest(mode=mode, header=header):
                self.finishable_round(mode, header)
                self.handler.check_timer('Arena')
                self.assertFalse(any(p.startswith(b'P') for p in self.socket.packets))
                self.assertEqual(self.server.USER_DB['hunter']['kills'], '33')
                self.assertFalse((self.temp / 'users.db.rounds.sqlite3').exists())

    def test_client_profile_packet_is_never_relayed_to_a_peer(self):
        peer = Socket()
        self.server.USERS['101'] = {'username': 'Other', 'socket': peer, 'slot': 2, 'room': 'Arena'}
        self.host.rooms['Arena']['players'].add('101')
        self.handler.handle_packet('P002forged')
        self.assertEqual(peer.packets, [])
        self.assertEqual(self.server.USER_DB['hunter']['kills'], '33')


if __name__ == '__main__':
    unittest.main()
