import assert from 'node:assert/strict';
import test from 'node:test';
import { EquipmentWorld, blastDamage, parsePlacement, encodeDeployableDamage } from '../client/src/game/equipment.js';
import { Weapon, WeaponID as ID, setWeaponStats } from '../client/src/game/weapons.js';
import { Character } from '../client/src/game/Character.js';
import { GameMap, HitRect, traceShot } from '../client/src/game/world.js';
import { E } from '../client/src/game/Direction.js';
import { Connection } from '../client/src/net/Connection.js';

const stats = Object.fromEntries([ID.GRENADES, ID.BARRELS, ID.BARRICADES, ID.C4, ID.MINES, ID.AIRSTRIKE, ID.SPY, ID.GRENADE_LAUNCHER, ID.PLASMA].map((id) => [id, { name: 'Equipment', shortName: 'Equipment', damage: 80, ammo: id === ID.SPY ? null : 10, ammoIncrement: 2, range: 10, spread: 0, fireDelay: 0.5, moveSpeed: 1, cost: 1000, ammoCost: 500, upgrades: [] }]));
setWeaponStats(stats);

function character(id, x, y, local = false) {
  const ch = new Character({ id, local });
  ch.respawn(x, y); ch.dir = E;
  return ch;
}
function setup({ online = false } = {}) {
  const map = new GameMap(40, 30);
  const local = character('001', 5.5, 5.5, true);
  const remote = character('002', 12.5, 5.5);
  const hits = [], sent = [], effects = [], activations = [], placements = [];
  const world = new EquipmentWorld(map, { localID: local.id, online, characters: () => [local, remote], hurt: (owner, weapon) => hits.push({ owner, weapon }), send: (s) => sent.push(s), activate: (s) => activations.push(s), effect: (e) => effects.push(e), placed: (d) => placements.push(d) });
  return { world, map, local, remote, hits, sent, effects, activations, placements };
}
function wall(map, x, y, height = 60) {
  // One cell-wide wall, directly installed to isolate collision behavior.
  const prop = { height, hit: new HitRect({ x: x + 0.5, y: y + 0.5 }, 0.5, 0.5) };
  map.cellAt(x, y).prop = prop; return prop;
}
function plant(s, kind, ownerID = s.local.id, index = 0, x = 8, y = 5) {
  return s.world.place({ ownerID, index, kind, x, y });
}
function shot(s, id, owner = s.remote, param = 65) {
  const w = new Weapon(id); owner.selectWeapon(owner.pickupWeapon(w));
  s.world.fire(owner, w, w.shoot(owner, owner.dir.radians, param));
  return s.world.projectiles.at(-1);
}

test('throws charge while held, fire once on release, and cancel when input is captured or holstered', () => {
  for (const id of [ID.GRENADES, ID.GRENADE_LAUNCHER, ID.AIRSTRIKE]) {
    const w = new Weapon(id);
    for (let i = 0; i < 10; i++) assert.equal(w.fireInput(true, i === 0), false);
    assert.equal(w.fireInput(false, false), true);
    const ch = character('001', 2, 2, true);
    w.shoot(ch, 0, w.fireParam());
    assert.equal(w.fireInput(false, false), false);
    w.timeSinceFire = 999; w.fireInput(true, true);
    assert.equal(w.fireInput(false, false, false), false);
    assert.equal(w.charge, 0);
    w.fireInput(true, true); w.process(false);
    assert.equal(w.charge, 0);
  }
  const w = new Weapon(ID.GRENADES);
  w.charge = 1; const short = w.fireParam(Math.random, 0.2);
  w.charge = 15; assert.ok(w.fireParam(Math.random, 0.2) > short);
});

test('C4 and spy use press edges; a planted last charge remains selectable without ammo', () => {
  const s = setup();
  const w = s.local.pickupWeapon(new Weapon(ID.C4));
  const d = plant(s, 2);
  w.ammo.setCount(0);
  assert.equal(w.chargePack, d);
  assert.equal(w.available, true);
  assert.equal(w.fireInput(true, false), false);
  assert.equal(w.fireInput(true, true), true);
  s.world.detonate(d);
  assert.equal(w.available, false);
  assert.equal(w.display, 'ChargePackHeld');
  assert.equal(new Weapon(ID.SPY).fireInput(true, false), false);
});

test('placement records, damage packets and snapshots validate fixed fields', () => {
  assert.deepEqual(parsePlacement('001205008005'), { ownerID: '001', kind: 2, index: 5, x: 8, y: 5 });
  assert.equal(parsePlacement('00120500800501').hp, 1);
  assert.equal(parsePlacement('001905008005'), null);
  assert.equal(parsePlacement('00120500800x'), null);
  assert.equal(encodeDeployableDamage(5, '002', 7), 'o0500207');
  assert.equal(encodeDeployableDamage(5, '002', 900), 'o0500299');
});

test('duplicate placements spend once, snapshot restores HP silently, and zero HP removes once', () => {
  const s = setup();
  s.world.serverMessage('n001105008005');
  s.world.serverMessage('n001105008005');
  assert.equal(s.placements.length, 1);
  s.world.serverMessage('r00110500800525');
  assert.equal(s.world.deployables.get(5).hp, 25);
  assert.equal(s.placements.length, 1);
  s.world.serverMessage('o0500');
  s.world.serverMessage('o0500');
  assert.equal(s.world.deployables.size, 0);
  assert.equal(s.effects.length, 1);
});

test('snapshots replace stale objects without explosions and reject malformed whole snapshots', () => {
  const s = setup(); plant(s, 0);
  s.world.serverMessage('r00110500800525bad');
  assert.equal(s.world.deployables.size, 1);
  s.world.serverMessage('r');
  assert.equal(s.world.deployables.size, 0);
  assert.equal(s.effects.length, 0);
});

test('network placement buffer survives loading and resets between rooms', () => {
  const c = new Connection();
  c.handleMessage('n001005008005'); c.handleMessage('o0512');
  assert.deepEqual(c.equipmentMessages, ['n001005008005', 'o0512']);
  c.joinRoom('test');
  assert.deepEqual(c.equipmentMessages, []);
});

test('new cover lets its planter walk out, then blocks return and incoming shots', () => {
  const s = setup();
  const d = plant(s, 1, s.local.id, 0, 5, 5);
  s.local.moveDir = E;
  for (let i = 0; i < 10; i++) s.local.move(s.map);
  assert.ok(s.local.pos.x > 7);
  s.local.moveDir = { dx: -1, dy: 0 };
  for (let i = 0; i < 10; i++) s.local.move(s.map);
  assert.ok(s.local.pos.x > d.pos.x + 0.9);
  const ray = traceShot(s.map, { x: 2, y: 5.5 }, 0, 18, 10, [s.local], null);
  assert.equal(ray.deployables[0].target, d);
  assert.equal(ray.characters.length, 0);
  assert.ok(ray.distance < 4);
  assert.equal(s.world.canPlace(character('003', 5.5, 5.5)), false);
  wall(s.map, 6, 6);
  assert.equal(s.world.canPlace(character('003', 6.5, 6.5)), false);
});

test('only a deployable owner reports damage; C4/mines ignore bullets and wait for confirmed destruction', () => {
  const s = setup({ online: true });
  const own = plant(s, 0), other = plant(s, 0, s.remote.id, 1, 9);
  s.world.damage(other, s.local, 10); assert.equal(s.sent.length, 0);
  s.world.damage(own, s.remote, 30); s.world.damage(own, s.remote, 30);
  assert.deepEqual(s.sent, ['o0000230']);
  assert.equal(s.effects.length, 0);
  s.world.serverMessage('o00002'); // original server's killer-ID form
  assert.equal(s.effects.length, 1);
  const mine = plant(s, 3, s.local.id, 2, 11);
  s.world.damage(mine, s.remote, 99);
  assert.equal(s.sent.length, 1);
  s.world.detonate(mine);
  assert.equal(s.sent.at(-1), 'o0200101');
});

test('mines ignore their owner, trigger on an enemy, signal once and detonate after one second', () => {
  const s = setup({ online: true });
  const d = plant(s, 3, s.local.id, 0, 5, 5);
  s.world.tick(); assert.equal(d.countdown, null);
  s.remote.setPosition(5.5, 5.5);
  s.world.tick(); assert.deepEqual(s.activations, ['a0']);
  assert.equal(s.world.activateMine(0, '003'), false);
  for (let i = 0; i < 19; i++) s.world.tick();
  assert.equal(s.sent.length, 0);
  s.world.tick(); assert.deepEqual(s.sent, ['o0000101']);
  s.world.tick(); assert.equal(s.sent.length, 1);
});

test('barrel chain reactions terminate and blast damage includes self damage but respects solid cover', () => {
  const s = setup();
  plant(s, 0, s.local.id, 0, 6, 5); plant(s, 0, s.local.id, 1, 7, 5);
  s.world.damage(s.world.deployables.get(0), s.local, 20);
  assert.equal(s.world.deployables.size, 0);
  assert.equal(s.effects.length, 2);
  assert.ok(s.hits.some((h) => h.owner === s.local));
  s.hits.length = 0; s.local.setPosition(8.5, 5.5); wall(s.map, 7, 5);
  s.world.explode({ pos: { x: 6.5, y: 5.5 }, altitude: 0, radius: 3, inner: 1.5, damage: 80, owner: s.remote, weaponID: ID.GRENADES });
  assert.equal(s.hits.length, 0);
  assert.equal(blastDamage(80, 1, 3, 1.5), 80);
  assert.ok(blastDamage(80, 2.5, 3, 1.5) < 40);
  assert.equal(blastDamage(80, 3, 3, 1.5), 0);
});

test('grenades bounce off walls and explode once at the 1.5 second fuse', () => {
  const s = setup(); s.remote.setPosition(8.3, 5.5); wall(s.map, 9, 5);
  const p = shot(s, ID.GRENADES, s.remote, 60);
  s.world.tick(); assert.ok(p.vx < 0);
  for (let i = 1; i < 29; i++) s.world.tick();
  assert.equal(s.effects.filter((e) => e.type === 'explosion').length, 0);
  s.world.tick(); s.world.tick();
  assert.equal(s.effects.filter((e) => e.type === 'explosion').length, 1);
  assert.equal(s.world.projectiles.length, 0);
});

test('launcher grenades explode on impact and can pass over low cover', () => {
  const s = setup(); s.remote.setPosition(8, 5.5); wall(s.map, 9, 5);
  shot(s, ID.GRENADE_LAUNCHER); s.world.tick();
  assert.equal(s.effects.filter((e) => e.type === 'explosion').length, 1);
  s.effects.length = 0; s.map.cellAt(9, 5).prop.height = 20;
  const p = shot(s, ID.GRENADE_LAUNCHER); s.world.tick();
  assert.equal(p.dead, false);
  for (let i = 0; i < 100; i++) s.world.tick();
  assert.equal(s.effects.filter((e) => e.type === 'explosion').length, 1);
});

test('plasma crosses characters once, cannot hurt its owner, and its burst spares whoever it went through', () => {
  const s = setup(); s.remote.setPosition(2, 5.5); s.local.setPosition(5.5, 5.5);
  wall(s.map, 7, 5);
  shot(s, ID.PLASMA);
  for (let i = 0; i < 15; i++) s.world.tick();
  assert.equal(s.hits.length, 1);
  assert.equal(s.hits[0].weapon.id, ID.PLASMA);
  assert.equal(s.effects.filter((e) => e.type === 'plasma').length, 1);
  s.hits.length = 0; shot(s, ID.PLASMA, s.local);
  for (let i = 0; i < 15; i++) s.world.tick();
  assert.equal(s.hits.length, 0);
});

test('the plasma orb bursts where it ends: half damage close by, nothing beyond two tiles or behind cover', () => {
  // Fired east from (2, 5.5), the orb flies along the shoulder's line (y = 5.8) into a wall at x = 7;
  // the local player stands beside its path, out of its reach.
  const burst = (x, y, cover = false) => {
    const s = setup(); s.remote.setPosition(2, 5.5); s.local.setPosition(x, y); wall(s.map, 7, 5);
    if (cover) wall(s.map, 6, 6);
    shot(s, ID.PLASMA); for (let i = 0; i < 15; i++) s.world.tick();
    return s.hits;
  };
  const near = burst(6.4, 7);
  assert.equal(near.length, 1);
  assert.ok(near[0].weapon.damage > 0 && near[0].weapon.damage <= 40); // up to half of 80
  assert.equal(burst(6.4, 8.5).length, 0);
  assert.equal(burst(6.4, 7, true).length, 0);
});

test('plasma damage is swept and respects cover even if its field reaches behind a wall', () => {
  const s = setup(); s.remote.setPosition(2, 5.5); s.local.setPosition(4.05, 5.5); wall(s.map, 3, 5);
  shot(s, ID.PLASMA); for (let i = 0; i < 3; i++) s.world.tick();
  assert.equal(s.hits.length, 0);
});

test('airstrikes remain at the beacon and detonate after 2.5 seconds with a wider blast', () => {
  const s = setup(); s.remote.setPosition(2, 5.5); s.local.setPosition(5.5, 5.5);
  const p = shot(s, ID.AIRSTRIKE); const start = { ...p.pos };
  for (let i = 0; i < 49; i++) s.world.tick();
  assert.deepEqual(p.pos, start); assert.equal(s.hits.length, 0);
  s.world.tick(); assert.equal(s.hits[0].weapon.damage, 80);
  assert.equal(s.effects.at(-1).radius, 6);
});

test('a departed owner removes objects silently and long-lived projectiles are bounded', () => {
  const s = setup(); plant(s, 0, s.remote.id);
  s.world.removeOwner(s.remote.id);
  assert.equal(s.world.deployables.size, 0); assert.equal(s.effects.length, 0);
  shot(s, ID.PLASMA);
  for (let i = 0; i < 210; i++) s.world.tick();
  assert.equal(s.world.projectiles.length, 0);
});

// Exercise the real scene's fire/placement/hit paths without creating a renderer.
globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');

function scene(id = '001', otherID = '002') {
  const connection = new Connection(); connection.clientID = id;
  const g = new GameScene();
  g.init({ mode: 'online', app: { connection } });
  g.map = new GameMap(30, 30);
  g.player = character(id, 5.5, 5.5, true);
  const peer = character(otherID, 10.5, 5.5); peer.pickupRemoteWeapons();
  g.remotes.set(otherID, { character: peer, ping: 0 });
  g.effects = { playSound() {}, equipmentEffect() {}, addBlood() {}, soundLength: () => 0, stopSound() {} };
  g.hud = { showWarning() {} };
  g.cameras = { main: { shake() {} } };
  g.healthChanged = (ch, before, change) => change();
  g.equipment = new EquipmentWorld(g.map, { localID: id, online: true, characters: () => [g.player, peer], hurt: (...args) => g.localHurt(...args), send: (message) => g.outQueue.push(message), placed: (d) => g.deployablePlaced(d) });
  return g;
}

test('scene waits for the placement acknowledgement, consumes the last C4 once, and sends detonation without another shot', () => {
  const g = scene();
  const w = g.player.pickupWeapon(new Weapon(ID.C4)); w.ammo.setCount(1); g.player.selectWeapon(w);
  g.fireLocal();
  assert.equal(w.ammo.count, 1); assert.equal(w.placementPending, 40);
  assert.match(g.outQueue[0], /^4/);
  g.equipment.serverMessage('n001200005005');
  g.equipment.serverMessage('n001200005005');
  assert.equal(w.ammo.count, 0); assert.equal(w.placementPending, 0); assert.equal(w.available, true);
  const before = g.outQueue.length; g.fireLocal();
  assert.equal(g.outQueue.length, before + 1); assert.equal(g.outQueue.at(-1), 'o0000101');
  assert.equal(g.player.checkAutoSwitch(), null);
  // The blast itself is exercised above; move out of range before the server reply.
  g.player.setPosition(12, 12); g.equipment.serverMessage('o0000');
  assert.equal(w.chargePack, null); assert.ok(g.player.checkAutoSwitch());
});

test('scene rejects occupied placement without spending ammo or sending a packet; timeout makes refused placement retryable', () => {
  const g = scene(); const w = g.player.pickupWeapon(new Weapon(ID.BARRICADES)); g.player.selectWeapon(w);
  wall(g.map, 5, 5); g.fireLocal();
  assert.equal(w.ammo.count, 2); assert.equal(g.outQueue.length, 0);
  g.map.cellAt(5, 5).prop = null; g.fireLocal();
  assert.equal(w.canFire(), false);
  for (let i = 0; i < 40; i++) w.process();
  assert.equal(w.canFire(), true); assert.equal(w.ammo.count, 2);
});

test('scene charges and consumes projectile ammo once; changing weapon cancels a throw', () => {
  const g = scene(); const w = g.player.pickupWeapon(new Weapon(ID.GRENADES)); g.player.selectWeapon(w);
  w.fireInput(true, true); assert.equal(w.fireInput(false, false), true);
  g.fireLocal();
  assert.equal(w.ammo.count, 1); assert.equal(w.charge, 0);
  assert.equal(g.equipment.projectiles.length, 1); assert.equal(g.outQueue.length, 1);
  w.timeSinceFire = 999; w.fireInput(true, true); g.player.selectWeaponByID(0);
  assert.equal(w.charge, 0);
});

test('two clients replay a plasma shot and only the victim reports one hit', () => {
  const a = scene('001', '002'), b = scene('002', '001');
  a.player.setPosition(2, 5.5); a.remotes.get('002').character.setPosition(5.5, 5.5);
  b.player.setPosition(5.5, 5.5); const remote = b.remotes.get('001'); remote.character.setPosition(2, 5.5);
  const gun = a.player.pickupWeapon(new Weapon(ID.PLASMA)); a.player.selectWeapon(gun);
  remote.character.selectWeaponByID(ID.PLASMA);
  a.fireLocal();
  const packet = a.outQueue[0];
  b.remoteShot(remote, { angle: +packet.slice(1, 4) * Math.PI / 180, param: +packet.slice(4) });
  for (let i = 0; i < 8; i++) { a.equipment.tick(); b.equipment.tick(); }
  assert.equal(a.player.hp, 100); assert.equal(b.player.hp, 20);
  assert.deepEqual(b.outQueue, ['60012180']);
  assert.equal(a.outQueue.length, 1);
});

test('scene satellite toggle leaves the character position and inventory intact', () => {
  const g = scene(); const w = g.player.pickupWeapon(new Weapon(ID.SPY)); g.player.selectWeapon(w);
  g.fireLocal(); assert.deepEqual(g.spy, g.player.pos);
  g.spy.x += 5; assert.equal(g.player.pos.x, 5.5);
  g.fireLocal(); assert.equal(g.spy, null);
  assert.equal(g.outQueue.length, 0);
});

test('late placement acknowledgement still switches away from empty equipment after its reload', () => {
  const g = scene(); const w = g.player.pickupWeapon(new Weapon(ID.BARRICADES));
  w.ammo.setCount(1); g.player.selectWeapon(w); g.fireLocal();
  // No confirmation until after the normal reload tick.
  for (let i = 0; i < 40; i++) w.process();
  g.equipment.serverMessage('n001100005005');
  w.effectsQueue = [];
  g.processWeapons(g.player);
  assert.equal(g.player.weapon.id, 0);
  assert.equal(w.ammo.count, 0);
});
