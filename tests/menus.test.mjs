// Menu helpers that run without a browser: saved options and Flash geometry.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FOOTSTEPS, Preferences, loadPreferences, resetPreferences, savePreferences } from '../client/src/game/preferences.js';
import { transformBounds } from '../client/src/ui/flash.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), data };
}

test('options start at the original defaults', () => {
  resetPreferences();
  assert.equal(Preferences.volume, 0.7);
  assert.equal(Preferences.showFPS, false);
  assert.equal(Preferences.autoReload, false);
  assert.equal(Preferences.footsteps, FOOTSTEPS.ON);
  for (const key of ['shadows', 'blood', 'shells', 'smoke', 'shake', 'autoShop']) assert.equal(Preferences[key], true, key);
});

test('options are saved and loaded, ignoring unknown or mistyped values', () => {
  resetPreferences();
  const storage = memoryStorage({ 'bbh.preferences': JSON.stringify({ blood: false, volume: 0.25, shake: 'no', hacked: true }) });
  loadPreferences(storage);
  assert.equal(Preferences.blood, false);
  assert.equal(Preferences.volume, 0.25);
  assert.equal(Preferences.shake, true); // wrong type: default kept
  assert.equal('hacked' in Preferences, false);
  Preferences.showFPS = true;
  savePreferences(storage);
  assert.equal(JSON.parse(storage.data['bbh.preferences']).showFPS, true);
  resetPreferences();
});

test('unreadable or missing storage keeps the defaults', () => {
  resetPreferences();
  loadPreferences(memoryStorage({ 'bbh.preferences': '{not json' }));
  assert.equal(Preferences.blood, true);
  loadPreferences(null);
  savePreferences({ setItem() { throw new Error('blocked'); } });
  assert.equal(Preferences.volume, 0.7);
});

test('bounds through a Flash matrix', () => {
  assert.deepEqual(transformBounds([0, 0, 10, 20], [1, 0, 0, 1, 5, 6]), [5, 6, 15, 26]);
  assert.deepEqual(transformBounds([0, 0, 10, 20], [2, 0, 0, 0.5, 0, 0]), [0, 0, 20, 10]);
  // Flipped and rotated 90 degrees: still an axis-aligned box.
  assert.deepEqual(transformBounds([0, 0, 10, 20], [-1, 0, 0, 1, 0, 0]), [-10, 0, 0, 20]);
  assert.deepEqual(transformBounds([0, 0, 10, 20], [0, 1, -1, 0, 0, 0]), [-20, 0, 0, 10]);
  assert.equal(transformBounds(null, [1, 0, 0, 1, 0, 0]), null);
});
