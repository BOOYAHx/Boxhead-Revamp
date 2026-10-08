import assert from 'node:assert/strict';
import test from 'node:test';

import { UpdateWatcher } from '../client/src/net/updates.js';

const answer = (version) => async () => (version === null ? { ok: false } : { ok: true, json: async () => ({ version }) });

test('a new version is announced, but only once the player is out of a round', async () => {
  let version = 'aaa';
  let busy = true;
  let shown = 0;
  const watcher = new UpdateWatcher({ fetch: (...a) => answer(version)(...a), every: 1e9, busy: () => busy, notify: () => shown++ });
  assert.equal(await watcher.start(), true);
  await watcher.tick();
  assert.equal(shown, 0); // nothing new
  version = 'bbb';
  await watcher.tick();
  assert.equal(watcher.pending, true);
  assert.equal(shown, 0); // mid-match: wait
  busy = false;
  await watcher.tick();
  await watcher.tick();
  assert.equal(shown, 1);
  watcher.stop();
});

test('a web server without the version check keeps the watcher quiet', async () => {
  const watcher = new UpdateWatcher({ fetch: answer(null), notify: () => assert.fail('no notice') });
  assert.equal(await watcher.start(), false);
  const offline = new UpdateWatcher({ fetch: async () => { throw new Error('offline'); }, notify: () => assert.fail('no notice') });
  assert.equal(await offline.start(), false);
});
