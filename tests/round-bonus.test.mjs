// Award cash belongs to a continuing game, never to another room or practice session.
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { GameMap } = await import('../client/src/game/world.js');
const { Character } = await import('../client/src/game/Character.js');
const { newStats } = await import('../client/src/game/bounty.js');
const { MapView } = await import('../client/src/render/MapView.js');
const { CharacterView } = await import('../client/src/render/CharacterView.js');
const { setAtlas } = await import('../client/src/render/assets.js');
setAtlas({});

function display() {
  const object = {};
  for (const method of ['add', 'setOrigin', 'setVisible', 'setDepth', 'setScale', 'setTint', 'setScrollFactor'])
    object[method] = () => object;
  return object;
}

function setup(t, mode = 'online', room = 'First game') {
  // Only drawing is stubbed; loadMap, endGame and newGame use the real scene.
  t.mock.method(MapView.prototype, 'drawTerrain', () => {});
  t.mock.method(MapView.prototype, 'drawProps', () => {});
  t.mock.method(CharacterView.prototype, 'applyLook', () => {});
  const app = { connection: { clientID: '001', peers: [], localUser: {} } };
  const scene = new GameScene();
  scene.init({ mode, app, room });
  scene.add = { container: display, image: display, text: display, graphics: display };
  scene.textures = { exists: () => false };
  scene.shadows = { create: display };
  scene.cameras = { main: { setRoundPixels() {} } };
  scene.status = { setText() {} };
  scene.hud = { setInput() {}, showSummary() {}, setSummaryCountdown() {}, clearWarnings() {} };
  scene.effects = { playSound() {} };
  scene.time = { addEvent() {} };
  scene.setNpcCount = scene.setRoundTime = scene.updateScores = () => {};
  scene.scene = { restart: (data) => { scene.restartData = data; } };
  scene.loadMap(new GameMap(4, 4));
  return scene;
}

function restart(scene) {
  scene.newGame();
  scene.init(scene.restartData);
  scene.loadMap(new GameMap(4, 4));
}

test('awards carry to the next round once, without changing starting score', (t) => {
  const scene = setup(t);
  scene.endGame('001001001001001');
  scene.endGame('001001001001001'); // duplicate round-end packet
  restart(scene);
  assert.equal(scene.player.stats.money, 26000);
  assert.equal(scene.player.stats.score, 10000);
  assert.equal(scene.shop.wallet, scene.player.stats);
  restart(scene); // no new awards
  assert.equal(scene.player.stats.money, 10000);
});

test('leaving the summary and joining a different room clears award cash', (t) => {
  const scene = setup(t);
  scene.endGame('001001001001001');
  scene.init({ mode: 'online', app: scene.app, room: 'Different game' });
  scene.loadMap(new GameMap(4, 4));
  assert.equal(scene.player.stats.money, 10000);
});

test('a fresh game with the same room name also clears award cash', (t) => {
  const scene = setup(t);
  scene.endGame('001001001001001');
  scene.init({ mode: 'online', app: scene.app, room: scene.room });
  scene.loadMap(new GameMap(4, 4));
  assert.equal(scene.player.stats.money, 10000);
});

test('leaving while the next round is loading cannot transfer its pending bonus', (t) => {
  const scene = setup(t);
  scene.endGame('001001001001001');
  scene.newGame();
  scene.init(scene.restartData); // next map has not loaded or spent the bonus
  scene.init({ mode: 'online', app: scene.app, room: 'Different game' });
  scene.loadMap(new GameMap(4, 4));
  assert.equal(scene.player.stats.money, 10000);
});

test('only the local player awards contribute to next-round cash', (t) => {
  const scene = setup(t);
  const peer = new Character({ id: '002', name: 'Other player' });
  peer.stats = newStats();
  scene.remotes.set(peer.id, { id: peer.id, character: peer });
  scene.endGame('001002002002002');
  restart(scene);
  assert.equal(scene.player.stats.money, 15000);
});

test('practice award cash cannot leak into an online room', (t) => {
  const scene = setup(t, 'offline');
  scene.endGame('youyouyouyouyou');
  scene.init({ mode: 'online', app: scene.app, room: 'Online game' });
  scene.loadMap(new GameMap(4, 4));
  assert.equal(scene.player.stats.money, 10000);
});

test('kills, deaths, score and cash reset for the next round without a page refresh', (t) => {
  const scene = setup(t);
  Object.assign(scene.player.stats, { kills: 7, deaths: 3, score: 25000, bountyPoints: 8, money: 22000 });
  restart(scene);
  assert.deepEqual(scene.player.stats, newStats());
  assert.equal(scene.shop.wallet, scene.player.stats);
});

test('joining another game resets match stats and preserves saved profile totals', (t) => {
  const scene = setup(t);
  const career = { kills: 50, deaths: 20, wins: 6, losses: 3, bounty: 15000 };
  scene.app.connection.localUser.stats = career;
  Object.assign(scene.player.stats, { kills: 9, deaths: 5, score: 24000, bountyPoints: 6, money: 18000 });
  scene.init({ mode: 'online', app: scene.app, room: 'Another game' });
  scene.loadMap(new GameMap(4, 4));
  assert.deepEqual(scene.player.stats, newStats());
  assert.equal(scene.app.connection.localUser.stats, career);
});
