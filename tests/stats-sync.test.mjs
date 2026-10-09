import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, ServerEvent, User } from '../client/src/net/Connection.js';
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { LobbyScreen } = await import('../client/src/ui/lobby.js');

const lobbyPacket = (id, name, values, level = 1, wanted = false) =>
  `U${id}${name.padStart(20, '#')}${values.join(';')};${level}${wanted ? 1 : 0}`;

function session() {
  const c = new Connection();
  c.clientID = '001';
  c.authenticated = true;
  c.room = '_';
  c.localUser = new User('001');
  c.localUser.name = 'Hunter';
  c.localUser.level = 1;
  c.localUser.headModel = 3;
  c.localUser.stats = { kills: 15, deaths: 10, wins: 5, losses: 2, bounty: 2500 };
  return c;
}

test('own lobby handshake updates cached stats, including a reset, without authenticating again', () => {
  const c = session(), user = c.localUser, changes = [];
  let logins = 0;
  c.on(ServerEvent.AUTHENTICATE, () => logins++);
  c.on(ServerEvent.HANDSHAKE, (event) => changes.push(event));
  c.handleMessage(lobbyPacket('001', 'Hunter', [16, 11, 6, 2, 3000], 1, true));
  assert.deepEqual(c.localUser.stats, { kills: 16, deaths: 11, wins: 6, losses: 2, bounty: 3000 });
  c.handleMessage(lobbyPacket('001', 'Hunter', [0, 0, 0, 0, 0]));
  assert.deepEqual(c.localUser.stats, { kills: 0, deaths: 0, wins: 0, losses: 0, bounty: 0 });
  assert.equal(c.localUser, user);
  assert.equal(c.localUser.headModel, 3);
  assert.equal(c.localUser.level, 1);
  assert.equal(c.localUser.wanted, false);
  assert.equal(c.authenticated, true);
  assert.equal(c.room, '_');
  assert.equal(logins, 0);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].user, user);
});

test('game handshakes and the old server lobby self packet do not overwrite career totals', () => {
  const c = session(), before = { ...c.localUser.stats };
  const ownGamePacket = 'U00100100' + 'Hunter'.padStart(20, '#') + '1' + '03000000' + '0' + '10000;0;0;0;0';
  c.handleMessage(ownGamePacket); // old servers sent this while joining the lobby
  assert.deepEqual(c.localUser.stats, before);
  c.room = 'Arena';
  c.handleMessage(ownGamePacket);
  c.handleMessage(lobbyPacket('001', 'Hunter', [0, 0, 0, 0, 0]));
  assert.deepEqual(c.localUser.stats, before);
});

test('peer lobby stats still update without changing the local player', () => {
  const c = session(), before = { ...c.localUser.stats };
  const peer = new User('002');
  c.peers.push(peer);
  c.handleMessage(lobbyPacket('002', 'Other', [3, 4, 1, 2, 500], 0));
  assert.deepEqual(peer.stats, { kills: 3, deaths: 4, wins: 1, losses: 2, bounty: 500 });
  assert.deepEqual(c.localUser.stats, before);
});

test('an already open stats panel redraws on a fresh server handshake', () => {
  const c = session(), fields = new Map();
  for (const name of ['_nameField', '_statsField', '_valuesField']) fields.set(name, { text: '', box: { style: {} } });
  const screen = Object.create(LobbyScreen.prototype);
  screen.user = c.localUser;
  screen.players = [c.localUser];
  screen.userPages = [];
  screen.social = { order: (players) => players };
  screen.showUsers = screen.placeOnlineTab = () => {};
  screen.interfaceEnabled = true;
  screen.statsPopup = { visible: false, child: (name) => fields.get(name) };
  screen.closeUserPopups = () => { screen.statsPopup.visible = false; };
  screen.placePopup = (popup) => { popup.visible = true; };
  screen.showUserStats(c.localUser, 10, 10);
  assert.equal(fields.get('_valuesField').text, '2500\n15\n10\n5\n7');
  c.on(ServerEvent.HANDSHAKE, () => screen.setPlayers([c.localUser]));
  c.handleMessage(lobbyPacket('001', 'Hunter', [0, 0, 0, 0, 0]));
  assert.equal(fields.get('_valuesField').text, '0\n0\n0\n0\n0');
  assert.equal(screen.statsPopup.visible, true);
});
