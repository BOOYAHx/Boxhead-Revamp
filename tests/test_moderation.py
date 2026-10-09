"""Exercise actual packet handlers with isolated account files and sockets.

    python -m unittest discover -s tests -p test_moderation.py
"""
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import threading
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch


class Socket:
    def __init__(self):
        self.packets = []
        self.closed = False

    def sendall(self, packet):
        if self.closed:
            raise OSError('closed')
        self.packets.append(packet)

    def shutdown(self, _):
        self.closed = True

    def close(self):
        self.closed = True


class ModerationTests(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        source = Path(__file__).resolve().parents[1] / 'bbh-server-hunter-fix_2.py'
        self.temp = source.parent / ('tests/.moderation-test-' + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        target = self.temp / source.name
        shutil.copyfile(source, target)
        spec = importlib.util.spec_from_file_location('moderation_test_server', target)
        self.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.server)
        self.host = SimpleNamespace(rooms={'_': self.room('_'), 'Arena': self.room('Arena')})
        self.mod = self.player('100', 'Mod', 1, '_')
        self.target = self.player('200', 'Hunter', 0, 'Arena')
        self.other = self.player('300', 'Other', 0, 'Arena')
        self.handler = self.connection('100')

    def clean_files(self):
        os.chdir(self.cwd)
        # Verify the generated cleanup target remains under this test directory.
        parent = Path(__file__).resolve().parent
        if self.temp.resolve().parent != parent or not self.temp.name.startswith('.moderation-test-'):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)

    @staticmethod
    def room(name):
        return {'name': name, 'players': set(), 'round_start': None, 'round_length': 630,
                'settings_string': '', 'crates': {}, 'deployables': {}, 'dep_health': {}}

    def player(self, account, name, level, room):
        s = self.server
        key = name.casefold()
        s.USER_DB[key] = {field: '0' for field in s.USER_FIELDS}
        s.USER_DB[key].update(username=name, account_id=account, level=str(level), password_hash=s.md5_hash('secret'))
        user = {'username': key, 'display_username': name, 'socket': Socket(),
                'slot': s.SLOTS.allocate(account), 'room': room, 'session_id': account}
        s.USERS[account] = user
        self.host.rooms[room]['players'].add(account)
        return user

    def connection(self, account=None):
        handler = object.__new__(self.server.FlashGameHandler)
        handler.account_id = account
        handler.server = self.host
        handler.request = self.server.USERS[account]['socket'] if account else Socket()
        handler.username = self.server.USERS[account]['username'] if account else None
        handler.client_address = ('203.0.113.9', 1234)
        return handler

    def target_wire(self):
        return self.server.wire_id('200')

    def ban(self, minutes=10, reason='Repeated spam'):
        self.handler.handle_packet(f'0e{self.target_wire()};{minutes};{reason}')

    def test_regular_player_cannot_warn_or_ban_even_with_forged_session_level(self):
        self.other['level'] = 9  # only the account database may authorize this
        handler = self.connection('300')
        for packet in [f'0g{self.target_wire()}Stop', f'0e{self.target_wire()};10;Stop']:
            handler.handle_packet(packet)
        self.assertEqual(self.target['socket'].packets, [])
        self.assertFalse(self.target['socket'].closed)
        self.assertIsNone(self.server.active_account_ban('200'))
        self.assertTrue(all(b'Only moderators' in p for p in handler.request.packets))

    def test_pre_auth_and_stale_session_cannot_send_moderation(self):
        handler = self.connection()
        handler.handle_packet(f'0e{self.target_wire()};10;Stop')
        handler.handle_packet(f'0g{self.target_wire()}Stop')
        stale = self.connection('100')
        stale.request = Socket()
        stale.handle_packet(f'0e{self.target_wire()};10;Stop')
        self.assertEqual(self.target['socket'].packets, [])
        self.assertIsNone(self.server.active_account_ban('200'))

    def test_warning_reaches_only_target_and_acknowledges_to_moderator(self):
        self.handler.handle_packet(f'0g{self.target_wire()}Stop\x01\x7f; please')
        self.assertEqual(self.target['socket'].packets, [b'0gStop; please\x00'])
        self.assertEqual(self.other['socket'].packets, [])
        self.assertIn(b'Warning sent to Hunter', self.mod['socket'].packets[-1])
        self.assertFalse(self.target['socket'].closed)

    def test_revoked_moderator_is_denied_and_configured_moderator_is_allowed(self):
        self.server.USER_DB['mod']['level'] = '0'
        self.handler.handle_packet(f'0g{self.target_wire()}Stop')
        self.assertEqual(self.target['socket'].packets, [])
        self.server.MODERATOR_USERNAMES = frozenset({'MoD'})
        self.handler.handle_packet(f'0g{self.target_wire()}Stop')
        self.assertEqual(self.target['socket'].packets, [b'0gStop\x00'])

    def test_ban_disconnects_only_target_and_cleans_room_deployables_and_slot(self):
        wire = self.target_wire()
        room = self.host.rooms['Arena']
        room['deployables'] = {1: 'n' + wire + '001000000', 2: 'n003001000000'}
        room['dep_health'] = {1: 100, 2: 100}
        self.ban()
        self.assertEqual(self.target['socket'].packets, [b'0e10; Repeated spam\x00'])
        self.assertTrue(self.target['socket'].closed)
        self.assertFalse(self.other['socket'].closed)
        self.assertFalse(self.mod['socket'].closed)
        self.assertEqual(self.other['socket'].packets, [f'D{wire}\x00'.encode()])
        self.assertNotIn('200', self.server.USERS)
        self.assertNotIn('200', self.server.SLOTS.used)
        self.assertNotIn('200', room['players'])
        self.assertEqual(set(room['deployables']), {2})
        self.assertEqual(set(room['dep_health']), {2})
        self.assertEqual(self.server.active_account_ban('200')['minutes'], 10)

    def test_ban_rejects_reconnect_with_different_name_case_and_ip(self):
        self.ban()
        login = self.connection()
        login.client_address = ('198.51.100.77', 5555)
        login.handle_packet('09hUnTeR;secret')
        self.assertEqual(login.request.packets, [b'00;1\x00', b'0e10; Repeated spam\x00'])
        self.assertIsNone(login.account_id)
        self.assertNotIn('200', self.server.USERS)
        # Another account on the same IP can log in.
        self.server.USER_DB['other']['password_hash'] = self.server.md5_hash('secret')
        fresh = self.connection()
        fresh.handle_packet('09Other;secret')
        self.assertEqual(fresh.account_id, '300')

    def test_ban_survives_reload_and_login_succeeds_after_expiry(self):
        self.ban()
        now = self.server.time.time()
        self.assertEqual(self.server.active_account_ban('200', now + 599)['minutes'], 1)
        # Reload the module, like a process restart, retaining only its host files.
        spec = importlib.util.spec_from_file_location('restarted_moderation_server', self.server.__file__)
        restarted = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(restarted)
        self.assertEqual(restarted.active_account_ban('200')['reason'], 'Repeated spam')
        with patch.object(self.server.time, 'time', return_value=now + 601):
            login = self.connection()
            login.handle_packet('09Hunter;secret')
        self.assertEqual(login.account_id, '200')
        self.assertIsNone(self.server.active_account_ban('200'))

    def test_invalid_duration_self_ban_empty_reason_and_missing_target_do_nothing(self):
        wire = self.target_wire()
        for duration in ['0', '-1', '961', '1.5', '1e2', 'nan', '９', '99999999']:
            self.handler.handle_packet(f'0e{wire};{duration};Stop')
        self.handler.handle_packet(f"0e{self.server.wire_id('100')};10;Stop")
        for packet in [f'0e{wire};10;', '0e999;10;Stop', f'0g{wire}', '0gabcStop']:
            self.handler.handle_packet(packet)
        self.assertEqual(self.target['socket'].packets, [])
        self.assertFalse(self.mod['socket'].closed)
        self.assertFalse(self.target['socket'].closed)
        self.assertIsNone(self.server.active_account_ban('200'))

    def test_ban_storage_failure_does_not_disconnect_target_or_report_success(self):
        with patch.object(self.server, 'save_account_ban', side_effect=sqlite3.OperationalError('read only')):
            self.ban()
        self.assertFalse(self.target['socket'].closed)
        self.assertEqual(self.target['socket'].packets, [])
        self.assertIn(b'could not be saved', self.mod['socket'].packets[-1])

    def test_ban_store_failure_does_not_admit_a_login(self):
        with patch.object(self.server, 'active_account_ban', side_effect=sqlite3.DatabaseError('broken')):
            login = self.connection()
            login.handle_packet('09Hunter;secret')
        self.assertIsNone(login.account_id)
        self.assertIn(b'Unable to check', login.request.packets[-1])

    def test_result_packets_cannot_be_forged_and_private_messages_keep_peer_envelope(self):
        handler = self.connection('300')
        handler.handle_packet('0tBanned everyone')
        handler.handle_packet(f'00{self.target_wire()}0e10;Fake ban')
        self.assertEqual(self.target['socket'].packets, [b'M0030e10;Fake ban\x00'])
        self.assertFalse(self.target['socket'].closed)
        self.assertEqual(self.mod['socket'].packets, [])

    def test_login_and_ban_are_serialized(self):
        saved, release = threading.Event(), threading.Event()
        original_save = self.server.save_account_ban
        def paused_save(*args):
            original_save(*args)
            saved.set()
            self.assertTrue(release.wait(5))
        login = self.connection()
        with patch.object(self.server, 'save_account_ban', side_effect=paused_save):
            ban_thread = threading.Thread(target=self.ban)
            ban_thread.start()
            self.assertTrue(saved.wait(5))
            login_thread = threading.Thread(target=lambda: login.handle_packet('09Hunter;secret'))
            login_thread.start()
            release.set()
            ban_thread.join(5)
            login_thread.join(5)
        self.assertFalse(ban_thread.is_alive())
        self.assertFalse(login_thread.is_alive())
        self.assertIsNone(login.account_id)
        self.assertNotIn('200', self.server.USERS)
        self.assertIn(b'0e10;', login.request.packets[-1])


if __name__ == '__main__':
    unittest.main()
