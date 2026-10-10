import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { Character } = await import('../client/src/game/Character.js');
const { Weapon, WeaponID, parseWeaponStats, setWeaponStats } = await import('../client/src/game/weapons.js');

const constants = `<data>
  <weapon id="0"><ammo>Infinite</ammo><fireDelay>0.5</fireDelay></weapon>
  <weapon id="2"><ammo>250</ammo><ammoIncrement>250</ammoIncrement><fireDelay>0.15</fireDelay></weapon>
  <weapon id="15"><ammo>20</ammo><ammoIncrement>20</ammoIncrement><fireDelay>1.5</fireDelay></weapon>
  <weapon id="21"><ammo>30</ammo><ammoIncrement>30</ammoIncrement><fireDelay>1.2</fireDelay></weapon>
  <weapon id="20"><ammo>8</ammo><ammoIncrement>8</ammoIncrement><fireDelay>1.5</fireDelay></weapon>
  <weapon id="12"><ammo>Infinite</ammo><fireDelay>0.5</fireDelay></weapon>
</data>`;

function setup(name = 'Opeth', mode = 'online') {
  setWeaponStats(parseWeaponStats(constants));
  const connection = { localUser: { name }, equipmentMessages: [] };
  const scene = new GameScene();
  scene.init({ mode, app: { connection }, room: 'Arena' });
  const player = new Character({ id: '001', name, local: true });
  player.respawn(2, 2);
  // Movement, drawing, audio and socket I/O are stubbed; real input selection,
  // weapon/ammo rules, firing and all cooldown ticks run through GameScene.tick.
  player.move = () => {};
  for (const id of [WeaponID.AKIMBO_UZIS, WeaponID.RIFLE, WeaponID.PLASMA, WeaponID.SPY, WeaponID.GRENADE_LAUNCHER]) player.pickupWeapon(new Weapon(id));
  player.selectWeaponByID(WeaponID.RIFLE);
  scene.player = player;
  scene.map = {};
  scene.hud = { showWarning() {} };
  scene.equipment = { tick() {} };
  const shots = [], packets = [], spy = [];
  let tick = 0, input = {};
  scene.keyState = {
    isDown: action => action === 'fire' && !!input.fire,
    newPress: action => (input.press || []).includes(action),
    endTick() {},
  };
  scene.executeShot = (character, shot) => shots.push({ tick, weapon: character.weapon.id, shot });
  scene.showShot = scene.weaponChanged = scene.playReloadSound = scene.checkBountyCrates = scene.pingPeers = () => {};
  scene.setSpy = active => spy.push(active);
  scene.sendUpdate = () => packets.push(...scene.outQueue.splice(0));
  const frame = (keys = {}) => { input = keys; scene.tick(); tick++; };
  return { scene, player, shots, packets, spy, frame, connection };
}

test('Opeth cannot fire a ready gun before the previous gun cooldown finishes', () => {
  const s = setup();
  const delay = s.player.weapon.reloadTime;
  const uzis = s.player.weaponByID(WeaponID.AKIMBO_UZIS);
  const ammo = uzis.ammo.count;
  s.frame({ fire: true });
  s.frame({ fire: true, press: ['weapon1'] });
  assert.equal(s.player.weapon, uzis);
  assert.equal(uzis.ammo.count, ammo);
  assert.equal(s.shots.length, 1);
  assert.equal(s.packets.length, 1);
  for (let i = 2; i < delay; i++) s.frame({ fire: true });
  assert.equal(s.shots.length, 1);
  s.frame({ fire: true });
  assert.deepEqual(s.shots.map(shot => [shot.tick, shot.weapon]), [[0, WeaponID.RIFLE], [delay, WeaponID.AKIMBO_UZIS]]);
  assert.equal(uzis.ammo.count, ammo - 1);
  assert.equal(s.packets.length, 2);
});

test('Q/E cycling cannot clear Opeth cooldown, including case variants', () => {
  const s = setup('oPeTh');
  const delay = s.player.weapon.reloadTime;
  s.frame({ fire: true });
  for (let i = 1; i < delay; i++) s.frame({ fire: true, press: [i % 2 ? 'weaponDown' : 'weaponUp'] });
  assert.equal(s.shots.length, 1);
  s.frame({ fire: true, press: ['weapon1'] });
  assert.equal(s.shots.length, 2);
});

test('other accounts, similarly named accounts and offline practice still cycle normally', () => {
  for (const [name, mode] of [['Other', 'online'], ['Opeth2', 'online'], ['Opeth', 'offline']]) {
    const s = setup(name, mode);
    s.frame({ fire: true });
    s.frame({ fire: true, press: ['weapon1'] });
    assert.deepEqual(s.shots.map(shot => shot.tick), [0, 1], `${name} / ${mode}`);
  }
});

test('continuous firing of the same gun keeps its normal rate', () => {
  for (const name of ['Opeth', 'Other']) {
    const s = setup(name);
    const delay = s.player.weapon.reloadTime;
    for (let i = 0; i <= delay; i++) s.frame({ fire: true });
    assert.deepEqual(s.shots.map(shot => shot.tick), [0, delay], name);
  }
});

test('the shared delay uses the firing gun upgraded rate and covers projectile guns', () => {
  const s = setup();
  s.player.weapon.fireDelay = 0.2;
  s.frame({ fire: true });
  s.player.selectWeaponByID(WeaponID.PLASMA);
  for (let i = 1; i < 4; i++) s.frame({ fire: true });
  assert.equal(s.shots.length, 1);
  s.frame({ fire: true });
  const plasmaDelay = s.player.weapon.reloadTime;
  s.player.selectWeaponByID(WeaponID.AKIMBO_UZIS);
  for (let i = 1; i < plasmaDelay; i++) s.frame({ fire: true });
  assert.equal(s.shots.length, 2);
  s.frame({ fire: true });
  assert.deepEqual(s.shots.map(shot => [shot.tick, shot.weapon]), [
    [0, WeaponID.RIFLE], [4, WeaponID.PLASMA], [4 + plasmaDelay, WeaponID.AKIMBO_UZIS],
  ]);
});

test('gadgets remain usable during the gun delay without clearing that delay', () => {
  const s = setup();
  const delay = s.player.weapon.reloadTime;
  s.frame({ fire: true });
  s.player.selectWeaponByID(WeaponID.SPY);
  s.frame({ fire: true, press: ['fire'] });
  assert.deepEqual(s.spy, [true]);
  s.frame({ fire: true, press: ['weapon1'] });
  assert.equal(s.shots.length, 1);
  for (let i = 3; i < delay; i++) s.frame({ fire: true });
  s.frame({ fire: true });
  assert.equal(s.shots[1].tick, delay);
});

test('releasing a charged gun during the shared delay cannot cause a later shot', () => {
  const s = setup();
  const delay = s.player.weapon.reloadTime;
  s.frame({ fire: true });
  s.frame({ fire: true, press: ['weapon4'] });
  const launcher = s.player.weapon;
  assert.equal(launcher.id, WeaponID.GRENADE_LAUNCHER);
  assert.equal(launcher.charge, 0);
  s.frame(); // release during the blocked period
  for (let i = 3; i <= delay; i++) s.frame();
  assert.equal(s.shots.length, 1);
  assert.equal(launcher.ammo.count, 8);
  s.frame({ fire: true }); // charge only when the shared cooldown has finished
  s.frame();
  assert.equal(s.shots.length, 2);
  assert.equal(s.shots[1].weapon, WeaponID.GRENADE_LAUNCHER);
  assert.equal(launcher.ammo.count, 7);
});

test('an empty gun starts no shared cooldown and menu time advances an existing delay', () => {
  const s = setup();
  s.player.weapon.ammo.count = 0;
  s.frame({ fire: true });
  assert.equal(s.shots.length, 0);
  s.frame({ fire: true, press: ['weapon1'] });
  assert.equal(s.shots.length, 1);
  const delay = s.player.weapon.reloadTime;
  s.scene.ui = { menuOpen: true };
  for (let i = 1; i <= delay; i++) s.frame({ fire: true });
  assert.equal(s.shots.length, 1);
  s.scene.ui = null;
  s.frame({ fire: true });
  assert.equal(s.shots.length, 2);
});

test('new games and account changes reset the shared cooldown', () => {
  const s = setup();
  s.frame({ fire: true });
  assert.ok(s.scene.weaponCycleCooldown > 0);
  s.scene.init({ mode: 'online', app: { connection: s.connection }, room: 'Another game' });
  assert.equal(s.scene.weaponCycleCooldown, 0);
  assert.equal(s.scene.restrictWeaponCycling, true);
  s.connection.localUser.name = 'Other';
  s.scene.init({ mode: 'online', app: { connection: s.connection }, room: 'Another game' });
  assert.equal(s.scene.restrictWeaponCycling, false);
});
