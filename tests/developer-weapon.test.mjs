// The developer's Laser Gun: only Opeth carries it, others see it in Opeth's hands.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { ALL_WEAPON_IDS, NUM_WEAPONS, Weapon, WeaponID, isDeveloper, parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';

setWeaponStats(parseWeaponStats(fs.readFileSync(new URL('../client/assets/game/constants.xml', import.meta.url), 'utf8')));

test('the Laser Gun: a hard-hitting red beam through everyone in line, unlimited, never sold', () => {
  const laser = new Weapon(WeaponID.LASER);
  assert.equal(laser.name, 'Laser Gun');
  assert.equal(laser.ammo, null, 'unlimited');
  assert.equal(laser.penetrates, true);
  assert.equal(laser.tracerColor, 0xff1a1a, 'a red beam');
  assert.ok(laser.damage >= new Weapon(WeaponID.RAILGUN).damage);
  assert.equal(laser.price.cost, 0);
  assert.equal(laser.portraitID, WeaponID.RAILGUN, 'the slider shows the Railgun picture');
  assert.equal(NUM_WEAPONS, 22, 'the shop and Weapon Banks screen keep the original 22');
});

test('only the developer account is the developer', () => {
  for (const name of ['Opeth', 'opeth', 'OPETH']) assert.equal(isDeveloper(name), true, name);
  for (const name of ['Opeth2', 'Hunter', '', undefined, null]) assert.equal(isDeveloper(name), false, String(name));
});

test("other players' characters can show the Laser Gun when the developer switches to it", () => {
  const remote = new Character({ id: '002', name: 'Opeth' });
  remote.pickupRemoteWeapons();
  assert.ok(ALL_WEAPON_IDS.includes(WeaponID.LASER));
  assert.ok(remote.selectWeaponByID(WeaponID.LASER));
  assert.equal(remote.weapon.id, WeaponID.LASER);
});

test('the Laser Gun draws a thick glowing beam that lasts longer; other guns keep the thin tracer', () => {
  const laser = new Weapon(WeaponID.LASER);
  const shot = { tracers: [{ angle: 0 }] };
  const [line] = laser.tracerLines({ shot, distances: [10], muzzle: { x: 1, y: 1 } });
  assert.ok(line.beam.width >= 3 && line.beam.glow > line.beam.width && line.beam.time > 80);
  const [rifle] = new Weapon(WeaponID.RIFLE).tracerLines({ shot, distances: [10], muzzle: { x: 1, y: 1 } });
  assert.equal(rifle.beam, null);
});
