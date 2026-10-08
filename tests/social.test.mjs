import assert from 'node:assert/strict';
import test from 'node:test';

import { Social } from '../client/src/game/social.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('friends and blocked players are kept by name, ignoring case', () => {
  const storage = memoryStorage();
  const social = new Social(storage);
  social.setFriend('Bob', true);
  social.setBlocked('eve', true);
  const again = new Social(storage); // a new visit
  assert.equal(again.isFriend('bob'), true);
  assert.equal(again.isBlocked('Eve'), true);
  again.setFriend('BOB', false);
  assert.equal(new Social(storage).isFriend('Bob'), false);
});

test('the player list puts you first, then friends, moderators, wanted, others and blocked', () => {
  const social = new Social(memoryStorage());
  const me = { name: 'Zed' };
  const users = [{ name: 'Carl' }, { name: 'Eve' }, { name: 'Mod', level: 1 }, { name: 'Ann' }, { name: 'Bob' }, { name: 'Wes', wanted: true }];
  social.setFriend('Bob', true);
  social.setBlocked('Eve', true);
  assert.deepEqual(social.order([...users, me], me).map((u) => u.name), ['Zed', 'Bob', 'Mod', 'Wes', 'Ann', 'Carl', 'Eve']);
  assert.equal(social.icon(users[1], me), 'Ignore');
  assert.equal(social.icon(users[4], me), 'Friend');
  assert.equal(social.icon(me, me), 'Local');
});
