// A player who joins after someone bought a gun upgrade must still judge that
// gun's hits with the upgrade (each game judges the hits on its own player).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { GameMap } = await import('../client/src/game/world.js');
const { Character } = await import('../client/src/game/Character.js');
const { WeaponID, parseWeaponStats, setWeaponStats } = await import('../client/src/game/weapons.js');
const { MapView } = await import('../client/src/render/MapView.js');
const { CharacterView } = await import('../client/src/render/CharacterView.js');
const { setAtlas } = await import('../client/src/render/assets.js');
setAtlas({});
setWeaponStats(parseWeaponStats(fs.readFileSync(new URL('../client/assets/game/constants.xml', import.meta.url), 'utf8')));

// Any drawing call does nothing and can be chained.
function display() {
  const object = new Proxy(() => object, { get: (target, key) => (key === 'then' ? undefined : object), apply: () => object });
  return object;
}

function setup(t) {
  t.mock.method(MapView.prototype, 'drawTerrain', () => {});
  t.mock.method(MapView.prototype, 'drawProps', () => {});
  t.mock.method(CharacterView.prototype, 'applyLook', () => {});
  const sent = [];
  const app = { connection: { clientID: '001', peers: [], localUser: {}, sendGameMessage: (m) => sent.push(m) } };
  const scene = new GameScene();
  scene.init({ mode: 'online', app, room: 'Game' });
  scene.add = { container: display, image: display, text: display, graphics: display };
  scene.textures = { exists: () => false };
  scene.shadows = display();
  scene.lighting = null;
  scene.cameras = { main: { setRoundPixels() {} } };
  scene.status = { setText() {} };
  scene.hud = { setInput() {}, showSummary() {}, setSummaryCountdown() {}, clearWarnings() {}, addMessage() {} };
  scene.effects = { playSound() {} };
  scene.time = { addEvent() {} };
  scene.setNpcCount = scene.setRoundTime = scene.updateScores = () => {};
  scene.loadMap(new GameMap(4, 4));
  return { scene, sent };
}

test('a player who joins later is told our Shotgun damage upgrade', (t) => {
  const { scene, sent } = setup(t);
  scene.player.stats.money = 1e6;
  assert.ok(scene.shop.buy(WeaponID.SHOTGUN).ok);
  assert.ok(scene.shop.buyUpgrade(WeaponID.SHOTGUN, 1).ok);
  assert.equal(scene.shop.item(WeaponID.SHOTGUN).weapon.damage, 7);
  scene.peerHandshake({ id: '003', name: 'Old friend' });
  assert.deepEqual(sent, [], 'a handshake from someone already here: nothing to repeat');
  scene.peerJoined('002');
  scene.peerHandshake({ id: '002', name: 'Newcomer' });
  assert.deepEqual(sent, ['0l031']);
  scene.peerHandshake({ id: '002', name: 'Newcomer' });
  assert.equal(sent.length, 1, 'once per arrival');
});

test('the newcomer applies it, so our pellets hurt them for 7, and a repeat changes nothing', (t) => {
  const { scene } = setup(t);
  const shooter = new Character({ id: '001', name: 'Shooter' });
  shooter.pickupRemoteWeapons();
  const shotgun = shooter.weaponByID(WeaponID.SHOTGUN);
  assert.equal(shotgun.damage, 6);
  scene.remotePurchase(shooter, '0l031');
  assert.equal(shotgun.damage, 7);
  scene.remotePurchase(shooter, '0l031');
  assert.equal(shotgun.damage, 7);
});
