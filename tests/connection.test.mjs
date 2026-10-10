import test from 'node:test';
import assert from 'node:assert/strict';
import { Connection, ServerEvent, User } from '../client/src/net/Connection.js';

test('a peer leaving the room reports their name', () => {
  const c = new Connection();
  c.clientID = '001';
  const peer = new User('002');
  peer.name = 'Aubrey';
  c.peers.push(peer);
  const left = [];
  c.on(ServerEvent.PEER_DISCONNECTED, (event) => left.push(event));
  c.handleMessage('D002');
  assert.deepEqual(left, [{ id: '002', name: 'Aubrey' }]);
  assert.equal(c.peers.length, 0);
});

test('duplicate create packets do not announce another join, but a real rejoin does', () => {
  const c = new Connection();
  c.clientID = '001';
  const joins = [];
  c.on(ServerEvent.PEER_JOINED, (event) => joins.push(event));
  c.handleMessage('C002');
  const user = c.peers[0];
  user.name = 'Hunter';
  c.handleMessage('C002');
  assert.deepEqual(joins, [{ id: '002' }]);
  assert.equal(c.peers.length, 1);
  assert.equal(c.peers[0], user);
  c.handleMessage('D002');
  c.handleMessage('C002');
  assert.deepEqual(joins, [{ id: '002' }, { id: '002' }]);
  assert.notEqual(c.peers[0], user);
});
