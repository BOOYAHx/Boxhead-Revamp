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
