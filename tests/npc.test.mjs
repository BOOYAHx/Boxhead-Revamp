import assert from 'node:assert/strict';
import test from 'node:test';

import { E, SE } from '../client/src/game/Direction.js';
import { MAX_NPCS, NavGrid, NpcBrain, bestLine, clearShot, createNpc } from '../client/src/game/npc.js';
import { Character } from '../client/src/game/Character.js';
import { parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';
import { parseMap } from '../client/src/game/world.js';

// Every gun an NPC can carry, with simple stats.
const gun = (id, name) => `<weapon id="${id}" name="${name}" shortName="${name}"><ammo>Infinite</ammo><damage>10</damage><range>20</range><spread>0</spread><fireDelay>0.1</fireDelay><moveSpeed>1</moveSpeed></weapon>`;
setWeaponStats(parseWeaponStats(`<data>${[[0, 'Pistol'], [2, 'Uzis'], [3, 'Shotgun'], [4, 'Minigun'], [11, 'Magnum'], [13, 'AK47'], [14, 'M16'], [15, 'Rifle'], [16, 'Railgun']].map(([id, n]) => gun(id, n)).join('')}</data>`));

function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

test('up to 15 computer players, each with its own made-up name, a costume and unlimited guns', () => {
  const used = new Set();
  const random = seeded(7);
  for (let i = 0; i < MAX_NPCS; i++) {
    const npc = createNpc(i, random, used);
    assert.ok(!used.has(npc.name), `${npc.name} used twice`);
    used.add(npc.name);
    assert.equal(npc.npc, true);
    assert.ok(npc.look.bodyModel >= 0 && npc.look.bodyModel < 12);
    assert.equal(npc.weapons.length, 3);
    assert.ok(npc.weapons.every((w) => w.ammo === null), 'NPC guns never run dry');
  }
  assert.equal(used.size, MAX_NPCS);
});

test('the best firing line is the facing closest to the target', () => {
  assert.equal(bestLine({ x: 0, y: 0 }, { x: 5, y: 0.2 }).dir, E);
  const diagonal = bestLine({ x: 0, y: 0 }, { x: 3, y: 3.1 });
  assert.equal(diagonal.dir, SE);
  assert.ok(diagonal.offset < 0.1);
});

test('routes go round walls and never through them', () => {
  // A 10x10 map with a wall of crates down x = 5, open only at the bottom row.
  const wall = '5c1' + '9c1'.repeat(8); // skip counts: x = 5 on rows 0 to 8
  const map = parseMap(`110;10;${wall};ffffff1b;;0`);
  const nav = new NavGrid(map);
  assert.equal(nav.walkable(5, 4), false);
  assert.equal(nav.walkable(5, 9), true);
  assert.equal(clearShot(map, { x: 2.5, y: 4.5 }, { x: 8.5, y: 4.5 }), false);
  let pos = { x: 2.5, y: 4.5 };
  for (let i = 0; i < 40 && Math.floor(pos.x) !== 8; i++) {
    pos = nav.nextStep(pos, 8, 4, 0);
    assert.ok(pos && nav.walkable(Math.floor(pos.x), Math.floor(pos.y)), 'every step is on open ground');
  }
  assert.equal(Math.floor(pos.x), 8);
});

test('a computer player lines up, waits a moment and fires at an enemy in sight', () => {
  const map = parseMap('120;20;;ffffff1b;;0');
  const nav = new NavGrid(map);
  const npc = createNpc(0, seeded(3));
  npc.respawn(4.5, 10.5);
  const enemy = new Character({ id: 'me', local: true });
  enemy.respawn(12.5, 10.5);
  const brain = new NpcBrain(npc, seeded(5));
  const world = (now) => ({ map, nav, characters: [npc, enemy], now });
  brain.update(world(0));
  assert.equal(brain.target, enemy);
  assert.equal(npc.dir, E);
  assert.equal(npc.firing, false, 'a short reaction time first');
  brain.update(world(500));
  assert.equal(npc.firing, true);
  enemy.die();
  brain.update(world(600));
  assert.equal(npc.firing, false, 'no shooting at the dead');
});
