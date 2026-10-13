"""Infected and Team Deathmatch rules, using the real server's room handlers."""
import importlib.util
import os
from pathlib import Path
import random
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

    def text(self):
        return b''.join(self.packets).decode()


class InfectedTests(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        parent = Path(__file__).resolve().parent
        self.temp = parent / ('.infected-test-' + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        source = parent.parent / 'bbh-server-hunter-fix_2.py'
        target = self.temp / source.name
        shutil.copyfile(source, target)
        spec = importlib.util.spec_from_file_location('infected_test_server', target)
        self.server = s = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(s)
        s.update_most_wanted_xml = lambda: None
        self.host = SimpleNamespace(rooms={'_': {'name': '_', 'players': set(), 'settings_string': '', 'crates': {}}})
        self.sockets = {}
        self.handlers = {}
        for account, name in (('201', 'ann'), ('202', 'bob'), ('203', 'cat')):
            self.add_user(account, name)
        random.seed(3)

    def clean_files(self):
        os.chdir(self.cwd)
        parent = Path(__file__).resolve().parent
        if self.temp.resolve().parent != parent or not self.temp.name.startswith('.infected-test-'):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)

    def add_user(self, account, name):
        s = self.server
        account_row = {field: '0' for field in s.USER_FIELDS}
        account_row.update(username=name, account_id=account)
        s.USER_DB[name] = account_row
        self.sockets[account] = socket = Socket()
        s.USERS[account] = {'username': name, 'display_username': name, 'socket': socket,
                            'slot': s.SLOTS.allocate(account), 'room': '_', 'hp': 100,
                            'stats': {'score': 10000, 'kills': 0, 'deaths': 0, 'bounty_points': 0}}
        self.host.rooms['_']['players'].add(account)
        handler = object.__new__(s.FlashGameHandler)
        handler.account_id = account
        handler.username = name
        handler.request = socket
        handler.server = self.host
        self.handlers[account] = handler

    def room(self, mode='C'):
        """ann creates the room, bob and cat join it."""
        self.handlers['201'].handle_packet('02' + mode + '00ARENA;A')
        for account in ('202', '203'):
            self.handlers[account].handle_packet('03ARENA')
        for socket in self.sockets.values():
            socket.packets.clear()
        return self.host.rooms['ARENA']

    def team(self, account):
        return self.server.USERS[account].get('team')

    def wire(self, account):
        return self.server.wire_id(account)

    def end_preparation(self, room):
        room['round_start'] = time.time() - 61

    def kill(self, victim, attacker):
        """The victim's client reports two 99-damage hits from the attacker."""
        for _ in range(2):
            self.handlers[victim].handle_packet('6' + self.wire(attacker) + '00' + '99')

    def test_everyone_starts_as_a_survivor_and_nobody_is_infected_during_the_preparation(self):
        room = self.room()
        self.assertEqual([self.team(a) for a in ('201', '202', '203')], [self.server.SURVIVORS] * 3)
        self.handlers['201'].handle_packet('1001000010000')
        self.assertFalse(any(self.team(a) == self.server.INFECTED for a in ('201', '202', '203')))
        # Hits are ignored during the preparation.
        self.handlers['202'].handle_packet('6' + self.wire('201') + '00' + '50')
        self.assertEqual(self.server.USERS['202']['hp'], 100)
        self.assertFalse(room.get('outbreak'))

    def test_the_infection_starts_on_one_player_after_the_preparation(self):
        room = self.room()
        self.end_preparation(room)
        self.handlers['202'].handle_packet('1001000010000')
        infected = [a for a in ('201', '202', '203') if self.team(a) == self.server.INFECTED]
        self.assertEqual(len(infected), 1)
        self.assertTrue(room['outbreak'])
        announcement = f'M{self.wire(infected[0])}0k3\x00'
        for socket in self.sockets.values():
            self.assertIn(announcement, socket.text())
        # Further packets do not infect anyone else.
        self.handlers['203'].handle_packet('1001000010000')
        self.assertEqual(sum(self.team(a) == self.server.INFECTED for a in ('201', '202', '203')), 1)

    def test_one_player_alone_is_never_infected(self):
        self.handlers['201'].handle_packet('02C00SOLO;A')
        room = self.host.rooms['SOLO']
        self.end_preparation(room)
        self.handlers['201'].handle_packet('1001000010000')
        self.assertEqual(self.team('201'), self.server.SURVIVORS)

    def test_dead_survivors_join_the_infected_and_the_round_ends_when_nobody_is_left(self):
        room = self.room()
        self.end_preparation(room)
        self.handlers['201'].handle_packet('1001000010000')
        zombie = next(a for a in ('201', '202', '203') if self.team(a) == self.server.INFECTED)
        first, last = [a for a in ('201', '202', '203') if a != zombie]
        self.kill(first, zombie)
        self.assertEqual(self.team(first), self.server.INFECTED)
        text = self.sockets[last].text()
        # The death is announced before the infection.
        self.assertLess(text.index(f'M{self.wire(first)}7'), text.index(f'M{self.wire(first)}0k3'))
        self.assertEqual(room['round_state'], 'active')
        # Infected cannot hurt each other.
        self.server.USERS[first]['hp'] = 100
        self.handlers[first].handle_packet('6' + self.wire(zombie) + '00' + '50')
        self.assertEqual(self.server.USERS[first]['hp'], 100)
        self.kill(last, first)
        self.assertEqual(self.team(last), self.server.INFECTED)
        self.assertEqual(room['round_state'], 'ended')
        for socket in self.sockets.values():
            self.assertIn('0r', socket.text())

    def test_late_joiners_are_infected_only_while_someone_is_left_to_infect(self):
        room = self.room()
        self.end_preparation(room)
        self.handlers['201'].handle_packet('1001000010000')
        self.add_user('204', 'dan')
        self.handlers['204'].handle_packet('03ARENA')
        self.assertEqual(self.team('204'), self.server.INFECTED)
        for account in ('201', '202', '203'):
            self.server.USERS[account]['team'] = self.server.INFECTED
        self.add_user('205', 'eve')
        self.handlers['205'].handle_packet('03ARENA')
        self.assertEqual(self.team('205'), self.server.SURVIVORS)

    def test_map_load_sync_reports_the_servers_side_and_cannot_change_it(self):
        room = self.room()
        self.handlers['202'].handle_packet('0k3')
        self.assertEqual(self.team('202'), self.server.SURVIVORS)
        self.assertIn(f'M{self.wire("202")}0k2\x00', self.sockets['201'].text())
        self.assertIn(f'M{self.wire("202")}0k2\x00', self.sockets['202'].text())

    def test_a_new_round_makes_everyone_a_survivor_again(self):
        room = self.room()
        self.end_preparation(room)
        self.handlers['201'].handle_packet('1001000010000')
        room['round_state'] = 'ended'
        room['round_results_until'] = time.time() - 1
        for socket in self.sockets.values():
            socket.packets.clear()
        self.handlers['201'].check_timer('ARENA')
        self.assertEqual([self.team(a) for a in ('201', '202', '203')], [self.server.SURVIVORS] * 3)
        self.assertFalse(room['outbreak'])
        for account in ('201', '202', '203'):
            self.assertIn(f'M{self.wire(account)}0k2\x00', self.sockets['202'].text())
        # Survivors cannot hurt each other either.
        self.assertTrue(self.server.same_team(room, '201', '202'))

    def test_team_deathmatch_picks_and_no_friendly_fire(self):
        room = self.room('B')
        self.handlers['201'].handle_packet('0k2')
        self.handlers['202'].handle_packet('0k3')
        self.handlers['203'].handle_packet('0k2')
        self.assertEqual([self.team(a) for a in ('201', '202', '203')], [2, 3, 2])
        # A team is kept for the stay in the room; the map-load sync ("0k0") reports it.
        self.handlers['203'].handle_packet('0k3')
        self.handlers['203'].handle_packet('0k0')
        self.assertEqual(self.team('203'), 2)
        self.handlers['203'].handle_packet('6' + self.wire('201') + '00' + '50')
        self.assertEqual(self.server.USERS['203']['hp'], 100)
        self.handlers['202'].handle_packet('6' + self.wire('201') + '00' + '50')
        self.assertEqual(self.server.USERS['202']['hp'], 50)
        self.assertNotIn('outbreak', {k for k, v in room.items() if v})


if __name__ == '__main__':
    unittest.main()
