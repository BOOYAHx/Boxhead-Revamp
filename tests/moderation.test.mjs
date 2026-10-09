import test from 'node:test';
import assert from 'node:assert/strict';
import { moderatorHelp, runModeratorCommand } from '../client/src/game/moderation.js';
import { Connection, ServerEvent, User } from '../client/src/net/Connection.js';

function session(level = 1) {
  const sent = [], notices = [];
  const connection = {
    clientID: '001', localUser: { id: '001', name: 'Mod', level },
    peers: [{ id: '002', name: 'Hunter' }], authenticated: true, connected: true,
    sendRaw: (packet) => sent.push(packet),
  };
  return { connection, sent, notices, run: (text) => runModeratorCommand(connection, text, (line) => notices.push(line)) };
}

test('only moderators see help and regular players cannot send either command', () => {
  assert.deepEqual(moderatorHelp({ level: 0 }), []);
  assert.equal(moderatorHelp({ level: 1 }).length, 3);
  for (const level of [0, undefined, 'invalid', -1]) {
    const s = session(level);
    if (level === undefined) s.connection.localUser.level = undefined;
    assert.equal(s.run('/warn Hunter Stop'), true);
    assert.equal(s.run('/ban Hunter 10 Stop'), true);
    assert.deepEqual(s.sent, []);
    assert.equal(s.notices.length, 2);
  }
});

test('warnings and timed bans use private moderator packets and preserve message case', () => {
  const s = session();
  assert.equal(s.run('/WARN hunter Please Stop'), true);
  assert.equal(s.run('/ban HUNTER 960 Repeated Spam; final warning'), true);
  assert.deepEqual(s.sent, ['0g002Please Stop', '0e002;960;Repeated Spam; final warning']);
  assert.deepEqual(s.notices, []); // success comes from the server acknowledgement
});

test('invalid durations, self bans, missing players and empty reasons are consumed locally', () => {
  for (const text of [
    '/ban Hunter 0 Stop', '/ban Hunter -1 Stop', '/ban Hunter 961 Stop',
    '/ban Hunter 1.5 Stop', '/ban Hunter 1e2 Stop', '/ban Hunter 10minutes Stop',
    '/ban Mod 10 Stop', '/ban Nobody 10 Stop', '/warn Nobody Stop',
    '/warn Hunter', '/ban Hunter 10', '/ban', '/warn',
    '/warn Hunter ' + 'x'.repeat(241),
  ]) {
    const s = session();
    assert.equal(s.run(text), true, text);
    assert.deepEqual(s.sent, [], text);
    assert.equal(s.notices.length, 1, text);
  }
});

test('commands are rejected while disconnected or unauthenticated', () => {
  for (const field of ['authenticated', 'connected']) {
    const s = session();
    s.connection[field] = false;
    assert.equal(s.run('/warn Hunter Stop'), true);
    assert.deepEqual(s.sent, []);
  }
});

test('ordinary chat still follows the existing chat path and control characters cannot add packets', () => {
  const s = session();
  assert.equal(s.run('Hello Hunter'), false);
  assert.equal(s.run('/warning Hunter'), false);
  assert.equal(s.run('/warn Hunter Stop\0\x7f now'), true);
  assert.deepEqual(s.sent, ['0g002Stop now']);
});

test('server-only ban and result packets are decoded; peer chat cannot impersonate them', () => {
  const c = new Connection();
  const events = [];
  c.on(ServerEvent.WARNING, (event) => events.push(['warn', event]));
  c.on(ServerEvent.BANNED, (event) => events.push(['ban', event]));
  c.on(ServerEvent.MODERATION_RESULT, (event) => events.push(['result', event]));
  c.handleMessage('M0020e10; forged');
  c.handleMessage('0einvalid; broken');
  c.handleMessage('0e0; broken');
  assert.deepEqual(events, []);
  c.receive('0gPlease stop\0' + '0tBanned Hunter\0' + '0e10; Repeated spam; final warning\0');
  assert.deepEqual(events, [
    ['warn', { message: 'Please stop' }],
    ['result', { message: 'Banned Hunter' }],
    ['ban', { minutes: 10, reason: 'Repeated spam; final warning' }],
  ]);
});

test('authentication provides the moderator role rather than granting it by default', () => {
  const c = new Connection();
  c.localUser = new User(null);
  c.handleMessage('A001' + 'Mod'.padStart(20, '#') + '11' + '00000000' + '0;0;0;0;00');
  assert.equal(c.localUser.level, 1);
  c.endSession();
  assert.equal(c.localUser, null);
  assert.equal(c.authenticated, false);
});

test('a ban clears the session and ignores queued authentication from the closed socket', () => {
  const previous = globalThis.WebSocket;
  class FakeSocket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.listeners = new Map(); this.closed = false; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    close() { this.closed = true; }
    event(type, data = {}) { this.listeners.get(type)?.(data); }
  }
  globalThis.WebSocket = FakeSocket;
  try {
    const c = new Connection();
    c.connect('ws://test');
    const socket = c.socket;
    socket.event('open');
    const auth = 'A001' + 'Mod'.padStart(20, '#') + '11' + '00000000' + '0;0;0;0;00';
    socket.event('message', { data: auth + '\0' });
    assert.equal(c.authenticated, true);
    let bans = 0;
    c.on(ServerEvent.BANNED, () => bans++);
    socket.event('message', { data: '0e10; Stop\0' + auth + '\0' });
    socket.event('message', { data: auth + '\0' });
    assert.equal(bans, 1);
    assert.equal(c.authenticated, false);
    assert.equal(c.localUser, null);
    assert.equal(c.socket, null);
    assert.equal(socket.closed, true);
  } finally {
    if (previous === undefined) delete globalThis.WebSocket;
    else globalThis.WebSocket = previous;
  }
});
