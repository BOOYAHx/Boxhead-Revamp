import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E } from '../client/src/game/Direction.js';
import { NavGrid, NpcBrain, createNpc } from '../client/src/game/npc.js';
import { MAX_MONEY, MIN_MONEY, QuickPlay, cleanSettings, loadQuickPlay, playableMaps, saveQuickPlay } from '../client/src/game/quickPlay.js';
import { WeaponID, parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';
import { parseMap } from '../client/src/game/world.js';

// Guns with simple stats; the heavy ones reload slowly, like the real ones.
const gun = (id, name, delay = 0.1, range = 20) =>
  `<weapon id="${id}" name="${name}" shortName="${name}"><ammo>Infinite</ammo><damage>10</damage><range>${range}</range><spread>0</spread><fireDelay>${delay}</fireDelay><moveSpeed>1</moveSpeed></weapon>`;
setWeaponStats(parseWeaponStats(`<data>${[
  gun(0, 'Pistol'), gun(2, 'Uzis'), gun(4, 'Minigun'), gun(13, 'AK47'), gun(14, 'M16'),
  gun(3, 'Shotgun', 1.5, 10), gun(15, 'Rifle', 1, 25), gun(21, 'Plasma Cannon', 1.2, 100),
].join('')}</data>`));

function seeded(seed = 1) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = String(v)) };
};

test('Quick Play settings are cleaned up: a known difficulty, $10k-$100k in $10k steps, map names', () => {
  assert.deepEqual(cleanSettings({}), { difficulty: 'Medium', money: MIN_MONEY, maps: [] });
  assert.deepEqual(cleanSettings({ difficulty: 'Hard', money: 46000, maps: ['Temple', 'Temple', '', 3] }), { difficulty: 'Hard', money: 50000, maps: ['Temple'] });
  assert.equal(cleanSettings({ money: 5 }).money, MIN_MONEY);
  assert.equal(cleanSettings({ money: 1e9 }).money, MAX_MONEY);
  assert.equal(cleanSettings({ money: 'lots' }).money, MIN_MONEY);
  assert.equal(cleanSettings({ difficulty: 'Insane' }).difficulty, 'Medium');
});

test('Quick Play settings are kept in the browser', () => {
  const storage = memory();
  saveQuickPlay({ difficulty: 'Easy', money: 70000, maps: ['Temple'] }, storage);
  Object.assign(QuickPlay, { difficulty: 'Medium', money: MIN_MONEY, maps: [] });
  loadQuickPlay(storage);
  assert.deepEqual({ ...QuickPlay }, { difficulty: 'Easy', money: 70000, maps: ['Temple'] });
  storage.setItem('bbh.quickplay', 'not json');
  assert.deepEqual({ ...loadQuickPlay(storage) }, { difficulty: 'Medium', money: MIN_MONEY, maps: [] });
});

test('rounds are played on the picked maps, or all of them when none (or only removed ones) are picked', () => {
  const maps = [{ name: 'Temple' }, { name: 'Suburbia' }, { name: 'The Woods' }];
  assert.deepEqual(playableMaps(maps, ['Suburbia']).map((m) => m.name), ['Suburbia']);
  assert.equal(playableMaps(maps, []).length, 3);
  assert.equal(playableMaps(maps, ['Gone Map']).length, 3);
});

test('each difficulty arms its bots differently', () => {
  const ids = (difficulty, seed) => createNpc(0, seeded(seed), new Set(), difficulty).weapons.map((w) => w.id);
  for (let seed = 1; seed < 20; seed++) {
    const easy = ids('Easy', seed);
    assert.equal(easy.length, 2);
    assert.ok(!easy.includes(WeaponID.MINIGUN) && !easy.includes(WeaponID.PLASMA));
    const hard = ids('Hard', seed);
    for (const id of [WeaponID.PLASMA, WeaponID.SHOTGUN, WeaponID.RIFLE]) assert.ok(hard.includes(id));
    assert.equal(hard.length, 5);
  }
});

function duel(difficulty, distance = 6) {
  const map = parseMap('130;20;;ffffff1b;;0');
  const nav = new NavGrid(map);
  const npc = createNpc(0, seeded(3), new Set(), difficulty);
  npc.respawn(4.5, 10.5);
  const enemy = new Character({ id: 'me', local: true });
  enemy.respawn(4.5 + distance, 10.5);
  const brain = new NpcBrain(npc, seeded(5), difficulty);
  return { npc, enemy, brain, world: (now, crates = []) => ({ map, nav, characters: [npc, enemy], crates, now }) };
}

test('Hard bots chain their guns: Plasma, then Shotgun, then Rifle, then the automatic', () => {
  const { npc, brain, world } = duel('Hard');
  brain.update(world(0));
  brain.update(world(100));
  assert.equal(npc.dir, E);
  assert.equal(npc.firing, true);
  assert.equal(npc.weapon.id, WeaponID.PLASMA);
  npc.weapon.timeSinceFire = 0; // the game fired it: reloading now
  brain.update(world(150));
  assert.equal(npc.weapon.id, WeaponID.SHOTGUN, 'the next loaded gun, at once');
  npc.weapon.timeSinceFire = 0;
  brain.update(world(200));
  assert.equal(npc.weapon.id, WeaponID.RIFLE);
  npc.weapon.timeSinceFire = 0;
  brain.update(world(250));
  assert.ok([WeaponID.AKIMBO_UZIS, WeaponID.AK47, WeaponID.M16, WeaponID.MINIGUN].includes(npc.weapon.id), 'the automatic while the heavy guns reload');
  npc.weaponByID(WeaponID.PLASMA).timeSinceFire = 999; // reloaded
  brain.update(world(300));
  assert.equal(npc.weapon.id, WeaponID.PLASMA);
});

test('Hard bots skip a heavy gun that cannot reach', () => {
  const { npc, brain, world } = duel('Hard', 14); // past the Shotgun's range
  npc.weaponByID(WeaponID.PLASMA).timeSinceFire = 0;
  brain.update(world(0));
  brain.update(world(100));
  assert.equal(npc.weapon.id, WeaponID.RIFLE);
});

test('Easy bots take longer to shoot than Hard ones', () => {
  const easy = duel('Easy');
  easy.brain.update(easy.world(0));
  easy.brain.update(easy.world(300));
  assert.equal(easy.npc.firing, false, 'still lining up');
  easy.brain.update(easy.world(800));
  assert.equal(easy.npc.firing, true);
});

test('money crates draw Hard bots unless a fight is right there; Easy bots ignore them', () => {
  const crate = { x: 4.5, y: 14.5 };
  const far = duel('Hard', 9);
  far.brain.update(far.world(0, [crate]));
  assert.deepEqual(far.brain.goal, crate, 'Hard: the crate first');
  const close = duel('Hard', 2);
  close.brain.update(close.world(0, [crate]));
  assert.notDeepEqual(close.brain.goal, crate, 'Hard: fight the enemy next to it first');
  const medium = duel('Medium', 9);
  medium.brain.update(medium.world(0, [crate]));
  assert.notDeepEqual(medium.brain.goal, crate, 'Medium: not while an enemy is in sight');
  const easy = duel('Easy', 9);
  easy.brain.update(easy.world(0, [crate]));
  assert.notDeepEqual(easy.brain.goal, crate);
});
