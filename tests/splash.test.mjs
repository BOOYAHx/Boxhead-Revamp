import assert from 'node:assert/strict';
import test from 'node:test';
import { gunSplash } from '../client/src/game/equipment.js';
import { SPLASH, WeaponID as ID } from '../client/src/game/weapons.js';
import { Character } from '../client/src/game/Character.js';
import { GameMap, HitRect } from '../client/src/game/world.js';

function character(id, x, y) {
  const ch = new Character({ id });
  ch.respawn(x, y);
  return ch;
}
function wall(map, x, y) {
  map.cellAt(x, y).prop = { height: 60, hit: new HitRect({ x: x + 0.5, y: y + 0.5 }, 0.5, 0.5) };
}
// A shot east along y = 5.5 from x = 2 that stopped `distance` tiles away.
const ray = (y = 5.5) => ({ start: { x: 2, y }, angle: 0, altitude: 20, range: 10 });

test('a magnum bullet splashes whoever stands near where it stopped, falling off with distance', () => {
  const map = new GameMap(40, 30);
  const close = character('002', 6.3, 5.9);
  const edge = character('003', 6, 6.7);
  const far = character('004', 6, 8);
  const hits = gunSplash(map, { damage: 45 }, SPLASH[ID.MAGNUM], [ray()], [4], [close, edge, far], new Set());
  const by = new Map(hits.map((h) => [h.victim, h.damage]));
  assert.equal(by.get(close), 18); // 40% of 45, inside the full-damage centre
  assert.ok(by.get(edge) > 0 && by.get(edge) < 18);
  assert.equal(by.has(far), false);
});

test('splash skips anyone the bullet hit directly, stops at walls, and counts once per shot', () => {
  const map = new GameMap(40, 30);
  const target = character('002', 6, 5.5);
  const behind = character('003', 6.5, 7.5);
  const beside = character('004', 6, 6);
  wall(map, 6, 6);
  wall(map, 6, 7);
  // Five shotgun pellets ending around the same spot.
  const pellets = [5.4, 5.45, 5.5, 5.55, 5.6].map((y) => ray(y));
  const hits = gunSplash(map, { damage: 6 }, SPLASH[ID.SHOTGUN], pellets, [3.6, 3.6, 3.6, 3.6, 3.6], [target, behind, beside], new Set([target]));
  assert.deepEqual(hits.map((h) => h.victim), [beside]);
  assert.equal(hits[0].damage, 3); // half a pellet, once
});
