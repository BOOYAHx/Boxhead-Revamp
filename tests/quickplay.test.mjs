import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E, W } from '../client/src/game/Direction.js';
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
  gun(11, 'Magnum', { delay: 0.8, range: 20, cost: 30000, ammo: 20, ammoCost: 250 }),
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

test('bots start with the Pistol, a full Shotgun and no money, then buy Rifle, Plasma and Magnum as the crates pay', () => {
  const { npc, brain, bought } = bot('Medium');
  assert.deepEqual(npc.weapons.map((w) => w.id).sort(), [WeaponID.PISTOL, WeaponID.SHOTGUN].sort());
  assert.equal(npc.weapon.id, WeaponID.PISTOL, 'the Pistol in hand: the default');
  assert.equal(npc.weaponByID(WeaponID.SHOTGUN).ammo.count, 35);
  assert.equal(brain.goShopping(), null, 'nothing to spend');
  npc.stats.money = 8499;
  assert.equal(brain.goShopping(), null, 'not enough for the Rifle yet');
  npc.stats.money = 9000;
  brain.goShopping();
  assert.deepEqual(bought, ['Rifle']);
  assert.equal(npc.stats.money, 500, 'paid the shop price');
  npc.stats.money += 23000;
  brain.goShopping();
  npc.stats.money += 30000;
  brain.goShopping();
  assert.deepEqual(bought, ['Rifle', 'Plasma Cannon', 'Magnum']);
  assert.equal(npc.stats.money, 500);
  npc.stats.money = 1e6;
  brain.goShopping();
  assert.equal(bought.length, 3, 'nothing more after the Magnum');
});

test('every difficulty starts with the Shotgun and buys in the same order', () => {
  for (const difficulty of ['Easy', 'Medium', 'Hard']) {
    const { npc, brain, bought } = bot(difficulty, 1e6);
    assert.ok(npc.weaponByID(WeaponID.SHOTGUN), difficulty);
    for (let i = 0; i < 6; i++) brain.goShopping();
    assert.deepEqual(bought, ['Rifle', 'Plasma Cannon', 'Magnum'], difficulty);
  }
});

test('the Shotgun runs out of shells, and bots buy more when they can afford it', () => {
  const { npc, brain } = bot('Medium');
  const shotgun = npc.weaponByID(WeaponID.SHOTGUN);
  shotgun.ammo.setCount(0);
  assert.equal(shotgun.available, false);
  assert.equal(brain.goShopping(), null, 'no money for ammo');
  npc.stats.money = 2000;
  assert.equal(brain.goShopping(), shotgun);
  assert.equal(shotgun.ammo.count, 35);
  assert.equal(npc.stats.money, 2000 - 35 * 50);
});

test('Medium bots pick the gun for the range from what they own', () => {
  const near = duel('Medium', 2);
  near.brain.update(near.world(0));
  assert.equal(near.npc.weapon.id, WeaponID.SHOTGUN);
  const mid = duel('Medium', 6);
  mid.brain.update(mid.world(0));
  assert.equal(mid.npc.weapon.id, WeaponID.PLASMA);
  const fresh = bot('Medium');
  const map = parseMap('130;20;;ffffff1b;;0');
  fresh.npc.respawn(4.5, 10.5);
  const enemy = new Character({ id: 'me', local: true });
  enemy.respawn(12.5, 10.5);
  const world = (now) => ({ map, nav: new NavGrid(map), characters: [fresh.npc, enemy], crates: [], now });
  fresh.brain.update(world(0));
  assert.equal(fresh.npc.weapon.id, WeaponID.SHOTGUN, 'only the Shotgun so far');
  fresh.npc.weaponByID(WeaponID.SHOTGUN).ammo.setCount(0);
  fresh.brain.update(world(1000));
  assert.equal(fresh.npc.weapon.id, WeaponID.PISTOL, 'out of shells and money: the Pistol');
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

test('Hard bots chain their guns: Plasma, then Shotgun, then Rifle, then Magnum, then the Pistol', () => {
  const { npc, brain, world } = duel('Hard');
  brain.update(world(0));
  brain.update(world(100));
  assert.equal(npc.firing, false, 'a moment to aim first');
  brain.update(world(200));
  assert.equal(npc.dir, E);
  assert.equal(npc.firing, true);
  assert.equal(npc.weapon.id, WeaponID.PLASMA);
  npc.weapon.timeSinceFire = 0; // the game fired it: reloading now
  brain.update(world(300));
  assert.equal(npc.weapon.id, WeaponID.PLASMA, 'changing guns takes a moment');
  brain.update(world(400));
  assert.equal(npc.weapon.id, WeaponID.SHOTGUN, 'then the next loaded gun');
  npc.weapon.timeSinceFire = 0;
  brain.update(world(600));
  assert.equal(npc.weapon.id, WeaponID.RIFLE);
  npc.weapon.timeSinceFire = 0;
  brain.update(world(800));
  assert.equal(npc.weapon.id, WeaponID.MAGNUM);
  npc.weapon.timeSinceFire = 0;
  brain.update(world(1000));
  assert.equal(npc.weapon.id, WeaponID.PISTOL, 'the Pistol while the rest reload');
  npc.weaponByID(WeaponID.PLASMA).timeSinceFire = 999; // reloaded
  brain.update(world(1200));
  assert.equal(npc.weapon.id, WeaponID.PLASMA);
});

test('Hard bots skip a heavy gun that cannot reach', () => {
  const { npc, brain, world } = duel('Hard', 14); // past the Shotgun's range
  npc.weaponByID(WeaponID.PLASMA).timeSinceFire = 0;
  brain.update(world(0));
  brain.update(world(200));
  assert.equal(npc.weapon.id, WeaponID.RIFLE);
});

test('Easy bots aim like the original practice bots: a short moment, then they fire', () => {
  const easy = duel('Easy');
  easy.brain.update(easy.world(0));
  easy.brain.update(easy.world(60));
  assert.equal(easy.npc.firing, false, 'still lining up');
  easy.brain.update(easy.world(200));
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

test('the Pistol stays the default: bots only take out a bought gun to fight', () => {
  for (const difficulty of ['Medium', 'Hard']) {
    const { npc, brain } = duel(difficulty, 30); // owns every gun
    assert.ok(npc.weaponByID(WeaponID.MAGNUM));
    const map = parseMap('130;20;;ffffff1b;;0');
    brain.update({ map, nav: new NavGrid(map), characters: [npc], crates: [], now: 0 });
    assert.equal(npc.weapon.id, WeaponID.PISTOL, `${difficulty}: nobody to fight`);
  }
  const hard = duel('Hard', 30);
  hard.npc.selectWeapon(hard.npc.weaponByID(WeaponID.MAGNUM));
  hard.brain.update(hard.world(0));
  assert.equal(hard.npc.weapon.id, WeaponID.PISTOL, 'Hard walks with the Pistol, not the Magnum');
});

test('Super Hard bots start with Shotgun and Rifle, aim like a person and chain guns without a pause', () => {
  const { npc } = bot('Super Hard');
  assert.ok(npc.weaponByID(WeaponID.SHOTGUN) && npc.weaponByID(WeaponID.RIFLE));
  assert.equal(cleanSettings({ difficulty: 'Super Hard' }).difficulty, 'Super Hard');
  const { npc: s, brain, world } = duel('Super Hard');
  brain.update(world(0));
  brain.update(world(50));
  brain.update(world(100));
  brain.update(world(150));
  assert.equal(s.firing, false, 'no instant shot: it reacts like a person');
  brain.update(world(250));
  assert.equal(s.firing, true, 'a fifth of a second later it fires');
  assert.equal(s.weapon.id, WeaponID.PLASMA);
  s.weapon.timeSinceFire = 0;
  brain.update(world(260));
  assert.equal(s.weapon.id, WeaponID.SHOTGUN, 'the next gun straight away');
});

test('Super Hard bots shoot where you were a moment ago: strafing off the line beats them', () => {
  const { npc, enemy, brain, world } = duel('Super Hard');
  for (let t = 0; t <= 300; t += 50) brain.update(world(t));
  assert.equal(npc.firing, true);
  assert.equal(npc.dir, E);
  enemy.setPosition(enemy.pos.x, enemy.pos.y + 3); // stepped off the line (the bot is at x 4.5, the enemy 6 cells east)
  brain.update(world(350));
  assert.equal(npc.dir, E, 'still shooting at the old spot');
  assert.equal(npc.firing, true);
  for (let t = 400; t <= 500; t += 50) brain.update(world(t));
  assert.notEqual(npc.dir, E, 'then it turns to where you went');
  assert.equal(npc.firing, false, 'and has to line up again');
});

test('Super Hard bots flank: they close in from the side, not down the line you face', () => {
  const { enemy, brain, world } = duel('Super Hard');
  enemy.dir = W; // facing the bot, which is west of it on the same row
  brain.update(world(0));
  const goal = brain.goal;
  assert.ok(Math.abs(goal.y - enemy.pos.y) > 1, `goal ${JSON.stringify(goal)}: off the row the enemy faces down (a side or diagonal line)`);
  const hard = duel('Hard');
  hard.enemy.dir = W;
  hard.brain.update(hard.world(0));
  assert.ok(Math.abs(hard.brain.goal.y - hard.enemy.pos.y) < 0.01, 'Hard bots still walk straight down the line');
});

test('Super Hard bots need a moment to notice a gun pointed at them before they dodge', () => {
  const { enemy, brain, world } = duel('Super Hard');
  enemy.dir = W; // lined up on the bot
  let dodged = null;
  for (let t = 0; t <= 1000 && dodged === null; t += 50) {
    brain.update(world(t));
    if (brain.dodgeUntil > 0) dodged = t;
  }
  assert.ok(dodged !== null, 'it does dodge');
  assert.ok(dodged >= 200, `not before a person could react (dodged at ${dodged} ms)`);
});

test('Super Hard bots: every gun, quick respawn; same health, damage and speed as a player', () => {
  const { npc } = bot('Super Hard');
  assert.deepEqual(npc.weapons.map((w) => w.id).sort((a, b) => a - b),
    [WeaponID.PISTOL, WeaponID.SHOTGUN, WeaponID.RIFLE, WeaponID.PLASMA, WeaponID.MAGNUM].sort((a, b) => a - b));
  const hard = bot('Hard').npc;
  assert.equal(npc.hurt(20), 20, 'full damage');
  assert.equal(npc.speed, hard.speed, 'normal speed');
  assert.equal(npc.maxHp, hard.maxHp, 'normal health');

  const { npc: s, brain, world } = duel('Super Hard', 30);
  s.hurt(1000);
  brain.update(world(0));
  assert.ok(s.respawnTime <= 2500, 'back twice as fast');
  const h = duel('Hard', 30);
  h.npc.hurt(1000);
  h.brain.update(h.world(0));
  assert.equal(h.npc.respawnTime, 5000, 'Hard bots wait the normal time');
});
