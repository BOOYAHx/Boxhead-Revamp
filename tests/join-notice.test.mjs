import assert from 'node:assert/strict';
import test from 'node:test';
import { Connection, ServerEvent, User } from '../client/src/net/Connection.js';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');

const handshake = (id, name, kills = 0) =>
  'U' + id + '00100' + name.padStart(20, '#') + '1' + '00000000' + '0' + `10000;${kills};0;0;0`;

function setup() {
  const connection = new Connection();
  connection.clientID = '001';
  connection.localUser = new User('001');
  connection.localUser.name = 'You';
  connection.room = connection.joiningRoom = 'Arena';
  const scene = new GameScene();
  scene.init({ mode: 'online', app: { connection, maps: [] }, room: 'Arena' });
  const messages = [];
  scene.hud = { addMessage: (text, options) => messages.push({ text, options }) };
  scene.map = {}; // map drawing is irrelevant to the network/chat path
  scene.setStatus = scene.setRoundTime = scene.updateScores = () => {};
  scene.time = { addEvent() {} };
  scene.ensureRemote = (user) => {
    if (!scene.remotes.has(user.id)) scene.remotes.set(user.id, { character: { name: user.name, stats: {} } });
    return scene.remotes.get(user.id);
  };
  scene.startOnline();
  const ready = () => connection.emit(ServerEvent.ROOM_INFO, { roundTime: 600, mapID: 0 });
  return { connection, scene, messages, ready };
}

test('a live join waits for the name, prints once and still applies the game handshake', () => {
  const s = setup();
  s.ready();
  s.connection.receive('C002\0');
  assert.deepEqual(s.messages, []);
  s.connection.receive(handshake('002', 'Hunter', 3) + '\0');
  assert.deepEqual(s.messages, [{ text: 'Hunter has joined the game', options: { chat: true } }]);
  assert.equal(s.scene.remotes.get('002').character.stats.kills, 3);
  s.connection.receive('C002\0' + handshake('002', 'Hunter', 4) + '\0');
  assert.equal(s.messages.length, 1);
  assert.equal(s.scene.remotes.get('002').character.stats.kills, 4);
});

test('the initial player roster and your own join do not produce join notices', () => {
  const s = setup();
  s.connection.receive('C001A\0C002\0' + handshake('002', 'AlreadyHere') + '\0');
  s.ready();
  s.connection.receive(handshake('002', 'AlreadyHere') + '\0');
  assert.deepEqual(s.messages, []);
});

test('joins during map loading are still announced after the roster is received', () => {
  const s = setup();
  s.ready();
  s.scene.map = null;
  s.connection.receive('C002\0' + handshake('002', 'Hunter') + '\0');
  assert.equal(s.messages[0].text, 'Hunter has joined the game');
  assert.equal(s.scene.remotes.size, 0);
});

test('an incomplete name waits for the next handshake instead of printing an empty notice', () => {
  const s = setup();
  s.ready();
  s.connection.receive('C002\0' + handshake('002', '') + '\0');
  assert.deepEqual(s.messages, []);
  s.connection.receive(handshake('002', 'Hunter') + '\0');
  assert.equal(s.messages[0].text, 'Hunter has joined the game');
});

test('leaving and rejoining announces both transitions once', () => {
  const s = setup();
  s.ready();
  s.connection.receive('C002\0' + handshake('002', 'Hunter') + '\0D002\0C002\0' + handshake('002', 'Hunter') + '\0');
  assert.deepEqual(s.messages.map((m) => m.text), [
    'Hunter has joined the game', 'Hunter has left the game', 'Hunter has joined the game',
  ]);
});

test('leaving before the handshake cancels the pending join, even when the slot is reused', () => {
  const s = setup();
  s.ready();
  s.connection.receive('C002\0D002\0' + handshake('002', 'Gone') + '\0');
  assert.deepEqual(s.messages, []);
  assert.equal(s.scene.pendingJoins.size, 0);
  s.connection.receive('C002\0' + handshake('002', 'NewPlayer') + '\0');
  assert.equal(s.messages[0].text, 'NewPlayer has joined the game');
});
