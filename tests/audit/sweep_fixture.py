"""Shared setup for the security sweep reproductions (docs/audits/).

Each test loads a private copy of the game server in a temporary folder (so
users.db, logs and SQLite files never touch the repository) and drives the
real packet handlers with fake sockets, like tests/test_infected.py does.

These tests are not part of the normal suite: the attack cases fail while
the defect they reproduce is present. Run them with
    python3 -m unittest discover -s tests/audit -p 'test_sweep_*.py'
"""
import importlib.util
import os
from pathlib import Path
import random
import shutil
from types import SimpleNamespace
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
PREFIX = '.sweep-test-'


class Socket:
    def __init__(self):
        self.packets = []
        self.closed = False

    def sendall(self, packet):
        self.packets.append(packet)

    def shutdown(self, _):
        self.closed = True

    def close(self):
        self.closed = True

    def text(self):
        return b''.join(self.packets).decode('utf-8', 'replace')


class ServerCase(unittest.TestCase):
    """A fresh server module per test, run from its own temporary folder."""

    def setUp(self):
        self.cwd = os.getcwd()
        here = Path(__file__).resolve().parent
        self.temp = here / (PREFIX + uuid.uuid4().hex)
        self.temp.mkdir()
        self.addCleanup(self.clean_files)
        target = self.temp / 'bbh-server-hunter-fix_2.py'
        shutil.copyfile(ROOT / 'bbh-server-hunter-fix_2.py', target)
        os.chdir(self.temp)
        spec = importlib.util.spec_from_file_location('sweep_server_' + uuid.uuid4().hex, target)
        self.server = s = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(s)
        s.update_most_wanted_xml = lambda: None
        self.host = SimpleNamespace(rooms={'_': {'name': '_', 'players': set(), 'settings_string': '', 'crates': {}}})
        self.sockets = {}
        self.handlers = {}
        random.seed(3)

    def clean_files(self):
        os.chdir(self.cwd)
        here = Path(__file__).resolve().parent
        if self.temp.resolve().parent != here or not self.temp.name.startswith(PREFIX):
            raise ValueError('Unexpected test cleanup path')
        shutil.rmtree(self.temp)

    # --- accounts --------------------------------------------------------------

    def fresh_connection(self, ip='203.0.113.5'):
        """A connection that has not logged in, as a raw TCP client would be."""
        handler = object.__new__(self.server.FlashGameHandler)
        handler.account_id = None
        handler.username = None
        handler.request = Socket()
        handler.client_address = (ip, 40000)
        handler.player_ip = ip
        handler.server = self.host
        return handler

    def register(self, name, password):
        handler = self.fresh_connection()
        handler.handle_packet(f'0a{name};{password}')
        self.assertIn('Z1', handler.request.text(), 'registration failed in the fixture')

    def login(self, name, password, ip='203.0.113.5'):
        handler = self.fresh_connection(ip)
        handler.handle_packet(f'09{name};{password}')
        return handler

    # --- players in a room ------------------------------------------------------

    def add_user(self, account, name):
        s = self.server
        row = {field: '0' for field in s.USER_FIELDS}
        row.update(username=name, account_id=account)
        s.USER_DB[name] = row
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

    def ffa_room(self):
        """ann creates a free-for-all room, bob and cat join it."""
        for account, name in (('201', 'ann'), ('202', 'bob'), ('203', 'cat')):
            self.add_user(account, name)
        self.handlers['201'].handle_packet('02A00ARENA;A')
        for account in ('202', '203'):
            self.handlers[account].handle_packet('03ARENA')
        self.clear()
        return self.host.rooms['ARENA']

    def clear(self):
        for socket in self.sockets.values():
            socket.packets.clear()

    def wire(self, account):
        return self.server.wire_id(account)

    def send(self, account, packet):
        self.handlers[account].handle_packet(packet)
