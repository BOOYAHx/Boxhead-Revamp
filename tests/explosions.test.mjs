import assert from 'node:assert/strict';
import test from 'node:test';

import { blastLayout, explosionKind } from '../client/src/render/Explosions.js';
import { WeaponID } from '../client/src/game/weapons.js';

test('each explosive gets its own kind of blast', () => {
  assert.equal(explosionKind(WeaponID.GRENADES), 'grenade');
  assert.equal(explosionKind(WeaponID.GRENADE_LAUNCHER), 'launcher');
  assert.equal(explosionKind(WeaponID.C4), 'c4');
  assert.equal(explosionKind(WeaponID.MINES), 'mine');
  assert.equal(explosionKind(WeaponID.AIRSTRIKE), 'airstrike');
  assert.equal(explosionKind(99), 'barrel');
});

test('blasts are laid out like the original', () => {
  const corners = blastLayout('corners', 30, () => 0.5);
  assert.equal(corners.length, 5); // Projectile.explode: the main one and four diagonals
  assert.deepEqual(corners.slice(1).map((b) => [Math.sign(b.dx), Math.sign(b.dy), b.altitude, b.delay]), [[-1, -1, 20, 100], [1, -1, 20, 100], [-1, 1, 20, 100], [1, 1, 20, 100]]);
  const airstrike = blastLayout('airstrike', 0, () => 0.5);
  assert.equal(airstrike.length, 37); // AirstrikeBeacon.explode: twelve spokes of three
  assert.ok(Math.max(...airstrike.map((b) => Math.hypot(b.dx, b.dy))) <= 5 * 1.15 + 1e-9);
  assert.equal(blastLayout('barrel').length, 4);
});
