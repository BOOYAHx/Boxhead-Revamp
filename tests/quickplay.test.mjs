import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E } from '../client/src/game/Direction.js';
import { NavGrid, NpcBrain, createNpc } from '../client/src/game/npc.js';
import { MAX_MONEY, MIN_MONEY, QuickPlay, cleanSettings, loadQuickPlay, playableMaps, saveQuickPlay } from '../client/src/game/quickPlay.js';
import { WeaponID, parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';
import { parseMap } from '../client/src/game/world.js';

// Guns with simple stats and the shop's prices; the heavy ones reload slowly, like the real ones.
const gun = (id, name, { delay = 0.1, range = 20, cost = 0, ammo = 0, ammoCost = 0 } = {}) =>
  `<weapon id="${id}" name="${name}" shortName="${name}"><ammo>${ammo || 'Infinite'}</ammo><ammoIncrement>${ammo}</ammoIncrement><damage>10</damage><range>${range}</range><spread>0</spread>` +
  `<fireDelay>${delay}</fireDelay><moveSpeed>1</moveSpeed><cost>${cost}</cost><ammoCost>${ammoCost}</ammoCost></weapon>`;
setWeaponStats(parseWeaponStats(`<data>${[
  gun(0, 'Pistol'), gun(2, 'Dual Uzis', { cost: 6500, ammo: 250, ammoCost: 5 }), gun(4, 'Minigun', { cost: 27000, ammo: 200, ammoCost: 25 }),
  gun(13, 'AK47', { cost: 17500, ammo: 100, ammoCost: 12 }), gun(14, 'M16', { cost: 17500, ammo: 300, ammoCost: 12 }),
  gun(3, 'Shotgun', { delay: 1.5, range: 10, cost: 7000, ammo: 35, ammoCost: 50 }), gun(15, 'Rifle', { delay: 1, range: 25, cost: 8500, ammo: 35, ammoCost: 90 }),
  gun(21, 'Plasma Cannon', { delay: 1.2, range: 100, cost: 23000, ammo: 15, ammoCost: 300 }),
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

function bot(difficulty, money = 0) {
  const npc = createNpc(0, seeded(3));
  npc.stats = { money, score: 10000 };
  const brain = new NpcBrain(npc, seeded(5), difficulty);
  const bought = [];
  brain.onBuy = (ch, weapon) => bought.push(weapon.name);
  return { npc, brain, bought };
}

test('bots start with the Pistol and no money, and buy guns as the crates pay for them', () => {
  const { npc, brain, bought } = bot('Hard');
  assert.deepEqual(npc.weapons.map((w) => w.id), [WeaponID.PISTOL]);
  assert.equal(brain.goShopping(), null, 'nothing to spend');
  npc.stats.money = 6999;
  assert.equal(brain.goShopping(), null, 'not enough for the Shotgun yet');
  npc.stats.money = 9000;
  brain.goShopping();
  assert.deepEqual(bought, ['Shotgun']);
  assert.equal(npc.stats.money, 2000, 'paid the shop price');
  assert.ok(npc.weaponByID(WeaponID.SHOTGUN));
  npc.stats.money += 8500 + 23000;
  brain.goShopping();
  brain.goShopping();
  assert.deepEqual(bought, ['Shotgun', 'Rifle', 'Plasma Cannon'], 'Hard saves up for its chain first');
});

test('each difficulty saves up for its own list of guns', () => {
  const easy = bot('Easy', 1e6);
  const medium = bot('Medium', 1e6);
  for (let i = 0; i < 8; i++) easy.brain.goShopping(), medium.brain.goShopping();
  assert.deepEqual(easy.bought, ['Dual Uzis', 'Shotgun', 'AK47']);
  assert.deepEqual(medium.bought, ['Dual Uzis', 'Shotgun', 'Rifle', 'AK47', 'Minigun']);
});

test('bought guns run out of ammo, and bots buy more when they can afford it', () => {
  const { npc, brain } = bot('Medium', 6500);
  brain.goShopping();
  const uzis = npc.weaponByID(WeaponID.AKIMBO_UZIS);
  assert.equal(uzis.ammo.count, 250);
  uzis.ammo.setCount(0);
  assert.equal(uzis.available, false);
  assert.equal(brain.goShopping(), null, 'no money for ammo');
  npc.stats.money = 2000;
  assert.equal(brain.goShopping(), uzis);
  assert.equal(uzis.ammo.count, 250);
  assert.equal(npc.stats.money, 2000 - 250 * 5);
});

function duel(difficulty, distance = 6) {
  const map = parseMap('130;20;;ffffff1b;;0');
  const nav = new NavGrid(map);
  const npc = createNpc(0, seeded(3));
  npc.stats = { money: 1e6, score: 10000 }; // rich: owns every gun on its list
  npc.respawn(4.5, 10.5);
  const enemy = new Character({ id: 'me', local: true });
  enemy.respawn(4.5 + distance, 10.5);
  const brain = new NpcBrain(npc, seeded(5), difficulty);
  for (let i = 0; i < 6; i++) brain.goShopping();
  npc.stats.money = 0;
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
