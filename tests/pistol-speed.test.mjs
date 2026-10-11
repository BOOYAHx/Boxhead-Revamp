import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { GameMap } = await import('../client/src/game/world.js');
const { E } = await import('../client/src/game/Direction.js');
const { MAX_SPEED } = await import('../client/src/game/constants.js');
const { PISTOL_ID, WeaponID, parseWeaponStats, setWeaponStats } = await import('../client/src/game/weapons.js');
const { MapView } = await import('../client/src/render/MapView.js');
const { CharacterView } = await import('../client/src/render/CharacterView.js');
const { setAtlas } = await import('../client/src/render/assets.js');
const constants = readFileSync(new URL('../client/assets/game/constants.xml', import.meta.url), 'utf8');

function session(t) {
  setWeaponStats(parseWeaponStats(constants));
  setAtlas({});
  // Drawing and audio are stubbed; map loading, purchases and movement are real.
  t.mock.method(MapView.prototype, 'drawTerrain', () => {});
  t.mock.method(MapView.prototype, 'drawProps', () => {});
  t.mock.method(CharacterView.prototype, 'applyLook', () => {});
  const display = () => {
    const object = {};
    for (const method of ['add', 'setOrigin', 'setVisible', 'setDepth', 'setScale', 'setTint', 'setScrollFactor']) object[method] = () => object;
    return object;
  };
  const connection = {
    localUser: { name: 'Hunter' }, equipmentMessages: [], purchases: [],
    sendGameMessage(message) { this.purchases.push(message); },
  };
  const scene = new GameScene();
  scene.init({ mode: 'online', app: { connection }, room: 'Arena' });
  scene.add = { container: display, image: display, text: display, graphics: display };
  scene.textures = { exists: () => false };
  scene.shadows = { create: display };
  scene.cameras = { main: { setRoundPixels() {} } };
  scene.status = { setText() {} };
  scene.hud = { setInput() {}, clearWarnings() {} };
  scene.effects = { playSound() {} };
  scene.updateScores = () => {};
  scene.loadMap(new GameMap(24, 24));
  scene.ui = {
    shopOpen: true,
    closeShop() { this.shopOpen = false; },
    slider: { setBanks() {}, update() {} },
  };
  scene.weaponChanged = () => {};
  return scene;
}

function walkDistance(scene) {
  const player = scene.player;
  player.setPosition(5.5, 5.5);
  player.moveDir = E;
  for (let tick = 0; tick < 5; tick++) player.move(scene.map);
  return player.pos.x - 5.5;
}

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

function buyUpgrade(scene, n) {
  const result = scene.shop.buyUpgrade(PISTOL_ID, n);
  assert.equal(result.ok, true);
  scene.purchased(result);
  return result;
}

test('pistol speed bought before the first spawn increases actual movement by 10%', (t) => {
  const scene = session(t), player = scene.player;
  player.active = false;
  const baseline = walkDistance(scene), cash = player.stats.money;
  buyUpgrade(scene, 2);
  assert.equal(player.stats.money, cash - 2500);
  assert.deepEqual(scene.connection.purchases, ['0l002']);
  scene.closeShop();
  assert.equal(player.active, true);
  assertClose(walkDistance(scene), baseline * 1.1);
  assert.equal(player.weapon, scene.shop.item(PISTOL_ID).weapon);
  assert.equal(player.weapon.fireDelay, 0.5);
  assert.equal(player.weapon.damage, 7);
});

test('an active pistol applies upgrades immediately and keeps them after switching and respawning', (t) => {
  const scene = session(t), player = scene.player;
  scene.ui.shopOpen = false;
  const baseline = walkDistance(scene);
  buyUpgrade(scene, 2);
  assertClose(walkDistance(scene), baseline * 1.1);
  assert.equal(player.animator.speed, 1.1);
  assert.equal(scene.shop.buyUpgrade(PISTOL_ID, 2).ok, false);
  assert.equal(player.stats.money, 7500);
  buyUpgrade(scene, 1);
  assert.equal(player.weapon.damage, 9);
  assert.equal(player.stats.money, 5000);
  // Switching to a different gun uses that gun's own movement speed.
  player.stats.money += 10000;
  const rifle = scene.shop.buy(WeaponID.RIFLE);
  assert.equal(rifle.ok, true);
  scene.purchased(rifle);
  player.selectWeaponByID(WeaponID.RIFLE);
  assertClose(player.speed, MAX_SPEED * 0.75);
  player.selectWeaponByID(PISTOL_ID);
  assertClose(walkDistance(scene), baseline * 1.1);
  player.die();
  scene.respawnLocal(false);
  assertClose(walkDistance(scene), baseline * 1.1);
  assert.equal(player.weapon.damage, 9);
  assert.equal(player.weapon.fireDelay, 0.5);
});
