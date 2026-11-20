"""The Laser Gun (weapon 22): every online player may hold it, and the room sees it."""
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

    def test_a_player_switches_to_the_laser_and_everyone_sees_it(self):
        self.handlers['201'].handle_packet('0q22')
        self.assertEqual(self.server.USERS['201']['weapon'], '22')
        self.assertIn('M' + self.server.wire_id('201') + '0q22', self.sockets['202'].text())

    def test_any_player_can_switch_to_the_laser(self):
        self.handlers['202'].handle_packet('0q22')
        self.assertEqual(self.server.USERS['202']['weapon'], '22')
        self.assertIn('M' + self.server.wire_id('202') + '0q22', self.sockets['203'].text())

    def test_other_weapons_still_switch_for_everyone(self):
        self.handlers['202'].handle_packet('0q03')
        self.assertIn('M' + self.server.wire_id('202') + '0q03', self.sockets['203'].text())

    def test_a_laser_hit_reported_as_99_plus_1_kills_on_the_server(self):
        self.handlers['202'].handle_packet('6' + self.server.wire_id('201') + '22' + '99')
        self.assertEqual(self.server.USERS['202']['hp'], 1)
        self.handlers['202'].handle_packet('6' + self.server.wire_id('201') + '22' + '01')
        self.assertEqual(self.server.USERS['202']['hp'], 0)
        self.assertEqual(self.server.USERS['202']['stats']['deaths'], 1)
        self.assertEqual(self.server.USERS['201']['stats']['kills'], 1)


if __name__ == '__main__':
    unittest.main()

