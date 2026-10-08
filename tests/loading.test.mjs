import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { FALLBACK_MAPS } = await import('../client/src/game/maps.js');

function setup(mode = 'offline') {
  const scene = new GameScene();
  const sent = [];
  const app = {
    maps: [{ ...FALLBACK_MAPS[0], online: false }],
    leaveGame() { this.leaves = (this.leaves || 0) + 1; },
    connection: { peers: [], existingPickups: '', sendGameMessage: (m) => sent.push(m) },
  };
  scene.init({ app, mode });
  scene.status = { setText() {} };
  scene.sys = { isActive: () => true };
  scene.setRoundTime = scene.addCrates = scene.updateScores = () => {};
  scene.loadingPaint = () => Promise.resolve();
  scene.loadMap = (map) => { scene.loaded = map; scene.ui = {}; };
  return { scene, app, sent };
}

test('offline map waits for the loading screen to paint', async () => {
  const { scene } = setup();
  let paint;
  scene.loadingPaint = () => new Promise((resolve) => { paint = resolve; });
  const loading = scene.loadOfflineMap();
  assert.equal(scene.loaded, undefined);
  paint();
  await loading;
  assert.ok(scene.loaded.borderRect);
});

test('cancel stops offline loading and leaves only once', async () => {
  const { scene, app } = setup();
  const loading = scene.loadOfflineMap();
  scene.cancelMapLoad();
  scene.cancelMapLoad();
  await loading;
  assert.equal(scene.loaded, undefined);
  assert.equal(app.leaves, 1);
});

test('online loading prepares the map and acknowledges readiness', async () => {
  const { scene, sent } = setup('online');
  await scene.receiveRoomInfo({ mapID: 0, roundTime: 60 });
  assert.ok(scene.loaded.borderRect);
  assert.deepEqual(sent, ['0k1']);
});

test('cancel aborts the map request; its late rejection cannot load a new scene', async (t) => {
  const { scene, app, sent } = setup('online');
  app.maps = [{ slot: 0, name: 'Remote map', online: true }];
  let rejectRequest, signal;
  t.mock.method(globalThis, 'fetch', (url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => { rejectRequest = reject; });
  });
  const loading = scene.receiveRoomInfo({ mapID: 0, roundTime: 60 });
  scene.cancelMapLoad();
  assert.equal(signal.aborted, true);
  scene.init({ app, mode: 'online', room: 'Another room' });
  rejectRequest(new Error('Old request finished after leaving'));
  await loading;
  assert.equal(scene.loaded, undefined);
  assert.equal(scene.loadingMap, false);
  assert.deepEqual(sent, []);
});

test('the overlay resets its cancel button and releases it when hidden', (t) => {
  const { scene } = setup();
  const button = { disabled: true, blur() { this.blurred = true; } };
  const root = { hidden: true, querySelector: () => button };
  t.mock.method(globalThis.document, 'getElementById', () => root);
  scene.showMapLoading();
  assert.equal(root.hidden, false);
  assert.equal(button.disabled, false);
  button.onclick();
  assert.equal(button.disabled, true);
  scene.hideMapLoading();
  assert.equal(root.hidden, true);
  assert.equal(button.onclick, null);
  assert.equal(button.blurred, true);
});
