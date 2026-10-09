// Step 10 rules: key bindings (Input) and weapon banks (WeaponInfo banks).
import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { KeyState, NO_KEY, defaultBindings, getBind, isKey, keyName, loadBindings, saveBindings, setBind } from '../client/src/game/controls.js';
import { Weapon, WeaponID, defaultBanks, loadBanks, saveBanks, setBankLayout, weaponBank } from '../client/src/game/weapons.js';

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = String(v)) };
};

test('default keys are the original ones, two per action', () => {
  defaultBindings();
  assert.deepEqual([getBind('up'), getBind('up', false)], [38, 87]); // Up, W
  assert.deepEqual([getBind('fire'), getBind('fire', false)], [32, 74]); // Space, J
  assert.ok(isKey('shop', 66) && isKey('shop', 78)); // B, N
  assert.ok(isKey('spin', 67)); // C
  assert.equal(getBind('weaponUp', false), NO_KEY);
  assert.ok(!isKey('weaponUp', NO_KEY));
  assert.deepEqual([keyName(38), keyName(32), keyName(46), keyName(NO_KEY), keyName(70)], ['Up', 'Space', 'Del', '', 'F']);
});

test('Q is the next weapon and E the previous; older saves are switched over unless changed', () => {
  const storage = memory();
  defaultBindings();
  assert.equal(getBind('weaponUp'), 81); // Q: next
  assert.equal(getBind('weaponDown'), 69); // E: previous
  const v5 = (up, down) => {
    defaultBindings();
    setBind('weaponUp', true, up);
    setBind('weaponDown', true, down);
    saveBindings(storage);
    const saved = JSON.parse(storage.getItem('bbh.keys'));
    storage.setItem('bbh.keys', JSON.stringify({ ...saved, version: 5 }));
    defaultBindings();
    loadBindings(storage);
    return [getBind('weaponUp'), getBind('weaponDown')];
  };
  assert.deepEqual(v5(69, 81), [81, 69]); // the old defaults: swapped
  assert.deepEqual(v5(90, 88), [90, 88]); // the player's own keys: kept
  defaultBindings();
});

test('bindings are saved and loaded; old or broken saves are ignored', () => {
  const storage = memory();
  defaultBindings();
  setBind('fire', true, 70); // F
  saveBindings(storage);
  defaultBindings();
  loadBindings(storage);
  assert.equal(getBind('fire'), 70);
  storage.setItem('bbh.keys', JSON.stringify({ version: 4, bindings: [1, 2, 3] }));
  loadBindings(storage);
  assert.equal(getBind('up'), 38);
  storage.setItem('bbh.keys', '{oops');
  loadBindings(storage);
  assert.equal(getBind('fire'), 32);
});

test('weapon banks can be rearranged, saved, and characters re-sort theirs', () => {
  const storage = memory();
  defaultBanks();
  assert.equal(weaponBank(WeaponID.SHOTGUN), 2);
  const ch = new Character({ id: '001', local: true });
  for (const id of [WeaponID.SHOTGUN, WeaponID.AK47]) ch.pickupWeapon(new Weapon(id));
  // Shotgun alone in bank 4, AK47 first in bank 1.
  setBankLayout([[], [WeaponID.AK47, WeaponID.PISTOL], [], [], [WeaponID.SHOTGUN]]);
  saveBanks(storage);
  defaultBanks();
  loadBanks(storage);
  assert.equal(weaponBank(WeaponID.SHOTGUN), 4);
  ch.rebuildBanks();
  assert.deepEqual(ch.banks[1].map((w) => w.id), [WeaponID.AK47, WeaponID.PISTOL]);
  assert.deepEqual(ch.banks[4].map((w) => w.id), [WeaponID.SHOTGUN]);
  assert.equal(ch.selectWeaponBank(4).id, WeaponID.SHOTGUN);
  defaultBanks();
});

test('a key still held when the window gets focus back works again', () => {
  const target = new EventTarget();
  const keys = new KeyState(target);
  const key = (type, repeat = false) => target.dispatchEvent(Object.assign(new Event(type), { keyCode: 32, repeat }));
  key('keydown');
  assert.ok(keys.isDown('fire') && keys.newPress('fire'));
  keys.endTick();
  target.dispatchEvent(new Event('blur')); // focus lost: keyups would be missed, so all keys are let go
  assert.ok(!keys.isDown('fire'));
  key('keydown', true); // the held key's auto-repeat after focus comes back
  assert.ok(keys.isDown('fire'));
  assert.ok(!keys.newPress('fire'));
  key('keyup');
  assert.ok(!keys.isDown('fire'));
});
