"""Laser Tag rooms ("E"): only the Laser Gun (weapon 22) and the Railgun, nowhere else the Laser Gun."""
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

    def text(self):
        return b''.join(self.packets).decode()


class DeveloperWeaponTests(unittest.TestCase):
    def setUp(self):
        self.cwd = os.getcwd()
        parent = Path(__file__).resolve().parent
        self.temp = parent / ('.laser-test-' + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        source = parent.parent / 'bbh-server-hunter-fix_2.py'
        target = self.temp / source.name
        shutil.copyfile(source, target)
        os.chdir(self.temp)
        spec = importlib.util.spec_from_file_location('laser_test_server', target)
        self.server = s = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(s)
        s.update_most_wanted_xml = lambda: None
        self.host = SimpleNamespace(rooms={'_': {'name': '_', 'players': set(), 'settings_string': '', 'crates': {}}})
        self.sockets, self.handlers = {}, {}
        for account, name in (('201', 'Opeth'), ('202', 'bob'), ('203', 'cat')):
            self.add_user(account, name)
        self.handlers['201'].handle_packet('02A00ARENA;A')
        for account in ('202', '203'):
            self.handlers[account].handle_packet('03ARENA')
        for socket in self.sockets.values():
            socket.packets.clear()

    def clean_files(self):
        os.chdir(self.cwd)
        parent = Path(__file__).resolve().parent
        if self.temp.resolve().parent != parent or not self.temp.name.startswith('.laser-test-'):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)

    def add_user(self, account, name):
        s = self.server
        row = {field: '0' for field in s.USER_FIELDS}
        row.update(username=name, account_id=account)
        s.USER_DB[name.casefold()] = row
        self.sockets[account] = socket = Socket()
        s.USERS[account] = {'username': name.casefold(), 'display_username': name, 'socket': socket,
                            'slot': s.SLOTS.allocate(account), 'room': '_', 'hp': 100,
                            'stats': {'score': 10000, 'kills': 0, 'deaths': 0, 'bounty_points': 0}}
        self.host.rooms['_']['players'].add(account)
        handler = object.__new__(s.FlashGameHandler)
        handler.account_id = account
        handler.username = name.casefold()
        handler.request = socket
        handler.server = self.host
        self.handlers[account] = handler

    def laser_tag_room(self):
        """Opeth hosts a Laser Tag room ("E"), bob joins it."""
        self.handlers['201'].handle_packet('02E00LASERS;A')
        self.handlers['202'].handle_packet('03LASERS')
        for socket in self.sockets.values():
            socket.packets.clear()
        return self.host.rooms['LASERS']

    def test_a_normal_room_has_no_laser(self):
        self.handlers['202'].handle_packet('0q11')  # a Magnum in hand first
        self.handlers['202'].handle_packet('0q22')
        self.assertEqual(self.server.USERS['202']['weapon'], '11', 'still the Magnum')
        self.assertNotIn('0q22', self.sockets['201'].text() + self.sockets['203'].text())

    def test_other_weapons_still_switch_in_a_normal_room(self):
        self.handlers['202'].handle_packet('0q03')
        self.assertIn('M' + self.server.wire_id('202') + '0q03', self.sockets['203'].text())

    def test_laser_tag_has_the_laser_and_the_railgun_and_nothing_else(self):
        room = self.laser_tag_room()
        self.assertEqual(room['mode'], 'E')
        self.handlers['202'].handle_packet('0q22')
        self.assertIn('M' + self.server.wire_id('202') + '0q22', self.sockets['201'].text())
        self.handlers['202'].handle_packet('0q16')
        self.assertIn('M' + self.server.wire_id('202') + '0q16', self.sockets['201'].text())
        self.handlers['202'].handle_packet('0q11')
        self.assertEqual(self.server.USERS['202']['weapon'], '16', 'no Magnum in Laser Tag')
        self.assertNotIn('0q11', self.sockets['201'].text())

    def test_laser_tag_rounds_are_unranked(self):
        room = self.laser_tag_room()
        self.assertTrue(self.server.room_is_unranked(room))
        self.assertFalse(self.server.room_is_unranked(self.host.rooms['ARENA']), 'FFA stays ranked')

    def test_a_laser_hit_reported_as_99_plus_1_kills_on_the_server(self):
        self.laser_tag_room()
        self.handlers['202'].handle_packet('6' + self.server.wire_id('201') + '22' + '99')
        self.assertEqual(self.server.USERS['202']['hp'], 1)
        self.handlers['202'].handle_packet('6' + self.server.wire_id('201') + '22' + '01')
        self.assertEqual(self.server.USERS['202']['hp'], 0)
        self.assertEqual(self.server.USERS['202']['stats']['deaths'], 1)
        self.assertEqual(self.server.USERS['201']['stats']['kills'], 1)

if __name__ == '__main__':
    unittest.main()

