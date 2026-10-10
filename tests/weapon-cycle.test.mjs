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
  const player = new Character({ id: '001', name, local: true, instantWeaponCycling: scene.instantWeaponCycling });
  player.respawn(2, 2);
  // Stub movement, drawing, audio and sockets. Selection, ammo, firing,
  // cooldowns and outgoing combat packets run through the real game tick.
  player.move = () => {};
  for (const id of [WeaponID.AKIMBO_UZIS, WeaponID.RIFLE]) player.pickupWeapon(new Weapon(id));
  player.selectWeaponByID(WeaponID.RIFLE);
  scene.player = player;
  scene.map = {};
  scene.hud = { showWarning() {} };
  scene.equipment = { tick() {} };
  scene.effects = { playSound() {}, soundLength() { return 0; } };
  const shots = [], packets = [], spy = [];
  let tick = 0, input = {};
  scene.keyState = {
    isDown: action => action === 'fire' && !!input.fire,
    newPress: action => (input.press || []).includes(action),
    endTick() {},
  };
  scene.executeShot = (character, shot) => shots.push({ tick, weapon: character.weapon.id, shot });
  scene.showShot = scene.stopReloadSounds = scene.playReloadSound = scene.checkBountyCrates = scene.pingPeers = () => {};
  scene.setSpy = active => spy.push(active);
  scene.sendUpdate = () => packets.push(...scene.outQueue.splice(0));
  const frame = (keys = {}) => { input = keys; scene.tick(); tick++; };
  return { scene, player, shots, packets, spy, frame, connection };
}

test('Opeth can shoot immediately after switching back to a cooling gun', () => {
  const s = setup();
  s.frame({ fire: true });
  s.frame({ fire: true, press: ['weapon1'] });
  s.frame({ fire: true, press: ['weapon2'] });
  assert.deepEqual(s.shots.map(shot => [shot.tick, shot.weapon]), [
    [0, WeaponID.RIFLE], [1, WeaponID.AKIMBO_UZIS], [2, WeaponID.RIFLE],
  ]);
  assert.equal(s.player.weaponByID(WeaponID.RIFLE).ammo.count, 18);
  assert.equal(s.player.weaponByID(WeaponID.AKIMBO_UZIS).ammo.count, 249);
  assert.equal(s.packets.filter(packet => packet.startsWith('4')).length, 3);
});

test('Q/E and repeated bank cycling ready the newly selected gun for Opeth', () => {
  const s = setup('oPeTh');
  s.frame({ fire: true });
  s.frame({ fire: true, press: ['weaponDown'] });
  s.frame({ fire: true, press: ['weaponUp'] });
  assert.deepEqual(s.shots.map(shot => shot.tick), [0, 1, 2]);
  assert.equal(s.shots[2].weapon, WeaponID.RIFLE);
  s.frame({ fire: true, press: ['weapon1'] });
  s.frame({ fire: true, press: ['weapon1'] });
  s.frame({ fire: true, press: ['weapon1'] });
  assert.deepEqual(s.shots.slice(3).map(shot => shot.weapon), [
    WeaponID.AKIMBO_UZIS, WeaponID.PISTOL, WeaponID.AKIMBO_UZIS,
  ]);
});

test('other accounts, similar usernames and offline practice retain per-gun cooldowns', () => {
  for (const [name, mode] of [['Other', 'online'], ['Opeth2', 'online'], ['Opeth', 'offline']]) {
    const s = setup(name, mode);
    s.player.name = 'Opeth'; // display names cannot enable the account policy
    s.frame({ fire: true });
    s.frame({ fire: true, press: ['weapon1'] });
    s.frame({ fire: true, press: ['weapon2'] });
    assert.deepEqual(s.shots.map(shot => shot.tick), [0, 1], name + ' / ' + mode);
    assert.equal(s.player.weapon.isLoaded, false);
  }
});

test('holding the same gun preserves its normal and upgraded firing rate', () => {
  for (const name of ['Opeth', 'Other']) {
    for (const upgraded of [false, true]) {
      const s = setup(name);
      if (upgraded) s.player.weapon.fireDelay = 0.2;
      const delay = s.player.weapon.reloadTime;
      for (let i = 0; i <= delay; i++) s.frame({ fire: true });
      assert.deepEqual(s.shots.map(shot => shot.tick), [0, delay], name);
    }
  }
});

test('reselecting the same gun without switching does not clear its cooldown', () => {
  const s = setup();
  s.frame({ fire: true });
  assert.equal(s.player.selectWeaponByID(WeaponID.RIFLE), false);
  s.frame({ fire: true, press: ['weapon2'] }); // only one gun in this bank
  assert.equal(s.shots.length, 1);
  assert.equal(s.player.weapon.isLoaded, false);
  assert.equal(s.player.weapon.ammo.count, 19);
});

test('projectile guns fire on return and their ready display stays lit', () => {
  const s = setup();
  const plasma = s.player.pickupWeapon(new Weapon(WeaponID.PLASMA));
  s.player.selectWeapon(plasma);
  s.frame({ fire: true });
  s.frame({ fire: true, press: ['weapon2'] });
  s.frame({ fire: true, press: ['weapon3'] });
  assert.deepEqual(s.shots.map(shot => [shot.tick, shot.weapon]), [
    [0, WeaponID.PLASMA], [1, WeaponID.RIFLE], [2, WeaponID.PLASMA],
  ]);
  assert.equal(plasma.ammo.count, 28);
  s.frame({ press: ['weapon2'] });
  s.frame({ press: ['weapon3'] });
  assert.equal(plasma.isLoaded, true);
  assert.equal(plasma.display, plasma.displays[1]);
  s.frame();
  assert.equal(plasma.display, plasma.displays[1]);
});

test('instant cycling does not refill ammo or shorten gadget cooldowns', () => {
  const s = setup();
  const uzis = s.player.weaponByID(WeaponID.AKIMBO_UZIS);
  uzis.ammo.count = 0;
  uzis.timeSinceFire = 0;
  s.player.selectWeapon(uzis);
  s.frame({ fire: true });
  assert.equal(s.shots.length, 0);
  assert.equal(uzis.ammo.count, 0);
  assert.equal(uzis.canFire(), false);
  const satellite = s.player.pickupWeapon(new Weapon(WeaponID.SPY));
  satellite.timeSinceFire = 0;
  s.player.selectWeapon(satellite);
  s.frame({ fire: true, press: ['fire'] });
  assert.equal(satellite.isLoaded, false);
  assert.equal(s.spy.includes(true), false);
});

test('grenade launcher can cycle instantly but still requires charging and release', () => {
  const s = setup();
  const launcher = s.player.pickupWeapon(new Weapon(WeaponID.GRENADE_LAUNCHER));
  s.player.selectWeapon(launcher);
  s.frame({ fire: true });
  assert.equal(s.shots.length, 0);
  s.frame();
  s.frame({ fire: true, press: ['weapon2'] });
  s.frame({ fire: true, press: ['weapon4'] });
  assert.equal(s.shots.length, 2);
  s.frame();
  assert.deepEqual(s.shots.map(shot => [shot.tick, shot.weapon]), [
    [1, WeaponID.GRENADE_LAUNCHER], [2, WeaponID.RIFLE], [4, WeaponID.GRENADE_LAUNCHER],
  ]);
  assert.equal(launcher.ammo.count, 6);
});

test('remote characters never have their firing timers reset by this local policy', () => {
  setup();
  const remote = new Character({ id: '002', local: false, instantWeaponCycling: true });
  const rifle = remote.pickupWeapon(new Weapon(WeaponID.RIFLE));
  remote.selectWeapon(rifle);
  rifle.shoot(remote, 0);
  remote.selectWeaponByID(WeaponID.PISTOL);
  remote.selectWeapon(rifle);
  assert.equal(rifle.isLoaded, false);
});

test('new games and account changes recompute the Opeth-only policy', () => {
  const s = setup();
  s.scene.init({ mode: 'online', app: { connection: s.connection }, room: 'Another game' });
  assert.equal(s.scene.instantWeaponCycling, true);
  s.connection.localUser.name = 'Other';
  s.scene.init({ mode: 'online', app: { connection: s.connection }, room: 'Another game' });
  assert.equal(s.scene.instantWeaponCycling, false);
  s.scene.init({ mode: 'offline', app: { connection: s.connection } });
  assert.equal(s.scene.instantWeaponCycling, false);
});

test('loading a map passes the authenticated account policy to the local character', async (t) => {
  const { GameMap } = await import('../client/src/game/world.js');
  const { MapView } = await import('../client/src/render/MapView.js');
  const { CharacterView } = await import('../client/src/render/CharacterView.js');
  const { setAtlas } = await import('../client/src/render/assets.js');
  setAtlas({});
  t.mock.method(MapView.prototype, 'drawTerrain', () => {});
  t.mock.method(MapView.prototype, 'drawProps', () => {});
  t.mock.method(CharacterView.prototype, 'applyLook', () => {});
  const display = () => {
    const object = {};
    for (const method of ['add', 'setOrigin', 'setVisible', 'setDepth', 'setScale', 'setTint', 'setScrollFactor']) object[method] = () => object;
    return object;
  };
  for (const [name, mode] of [['Opeth', 'online'], ['Other', 'online'], ['Opeth', 'offline']]) {
    const { scene } = setup(name, mode);
    scene.add = { container: display, image: display, text: display, graphics: display };
    scene.textures = { exists: () => false };
    scene.shadows = { create: display };
    scene.cameras = { main: { setRoundPixels() {} } };
    scene.status = { setText() {} };
    scene.hud = { setInput() {}, clearWarnings() {} };
    scene.time = { addEvent() {} };
    scene.setNpcCount = scene.setRoundTime = scene.updateScores = () => {};
    scene.loadMap(new GameMap(4, 4));
    const rifle = scene.player.pickupWeapon(new Weapon(WeaponID.RIFLE));
    rifle.timeSinceFire = 0;
    scene.player.selectWeapon(rifle);
    assert.equal(rifle.isLoaded, name === 'Opeth' && mode === 'online', name + ' / ' + mode);
  }
});
