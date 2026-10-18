import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ShopState } from '../client/src/game/shop.js';
import { Preferences, loadPreferences, resetPreferences, savePreferences } from '../client/src/game/preferences.js';
import { Character } from '../client/src/game/Character.js';
import { newStats } from '../client/src/game/bounty.js';
import { WeaponID, parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const constants = readFileSync(new URL('../client/assets/game/constants.xml', import.meta.url), 'utf8');
const { RIFLE, PLASMA, MAGNUM, AK47 } = WeaponID;

function shop(money) {
  setWeaponStats(parseWeaponStats(constants));
  return new ShopState(money);
}

test('Rifle is bought at exactly $8,500, with normal ammo and a refund receipt', () => {
  const s = shop(8499);
  assert.deepEqual(s.autoBuy(1000), []);
  s.money++;
  const [result] = s.autoBuy(1000);
  assert.equal(result.weapon.id, RIFLE);
  assert.equal(result.event, 'buy');
  assert.equal(result.action, '0');
  assert.equal(s.money, 0);
  assert.equal(result.weapon.ammo.count, result.weapon.ammo.max);
  assert.equal(s.refundable(1000)[0].amount, 8500);
  assert.equal(s.refundable(1000)[0].seconds, 60);
});

test('cash is deducted between purchases and only the requested three guns are bought', () => {
  const s = shop(31500);
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [RIFLE, PLASMA]);
  assert.equal(s.money, 0);
  s.money = 29999;
  assert.deepEqual(s.autoBuy(), []);
  s.money++;
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [MAGNUM]);
  assert.equal(s.money, 0);
  assert.equal(s.item(AK47).owned, false);
});

test('priority follows current shop prices rather than a hardcoded weapon order', () => {
  const s = shop(500);
  s.item(RIFLE).weapon.price.cost = 900;
  s.item(PLASMA).weapon.price.cost = 300;
  s.item(MAGNUM).weapon.price.cost = 200;
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [MAGNUM, PLASMA]);
  assert.equal(s.money, 0);
  assert.equal(s.item(RIFLE).owned, false);
});

test('owned guns are skipped: repeated checks never buy ammo, upgrades, or duplicates', () => {
  const s = shop(100000);
  s.buy(RIFLE);
  s.item(RIFLE).weapon.ammo.setCount(1);
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [PLASMA, MAGNUM]);
  const remaining = s.money;
  for (let i = 0; i < 20; i++) assert.deepEqual(s.autoBuy(), []);
  assert.equal(s.money, remaining);
  assert.equal(s.item(RIFLE).weapon.ammo.count, 1);
  assert.ok(s.item(RIFLE).weapon.upgrades.every((u) => !u?.owned));
});

test('refunds stay refunded this round, manual rebuy works, new rounds allow auto buy again', () => {
  const s = shop(8500);
  s.autoBuy(1000);
  assert.equal(s.refund(RIFLE, 2000).ok, true);
  assert.deepEqual(s.autoBuy(2001), []);
  assert.equal(s.money, 8500);
  assert.equal(s.buy(RIFLE, 3000).ok, true);
  s.reset();
  s.money = 8500;
  assert.deepEqual(s.autoBuy(4000).map((r) => r.weapon.id), [RIFLE]);
});

test('Auto Buy is off by default, persists as a boolean, and Reset disables it', () => {
  resetPreferences();
  assert.equal(Preferences.autoBuyWeapons, false);
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; } };
  Preferences.autoBuyWeapons = true;
  savePreferences(storage);
  resetPreferences();
  loadPreferences(storage);
  assert.equal(Preferences.autoBuyWeapons, true);
  resetPreferences();
  storage.value = '{"autoBuyWeapons":"true"}';
  loadPreferences(storage);
  assert.equal(Preferences.autoBuyWeapons, false);
});

function session() {
  resetPreferences();
  const state = shop(8499);
  const connection = { authenticated: true, connected: true, equipmentMessages: [], purchases: [],
    sendGameMessage(message) { this.purchases.push(message); } };
  const scene = new GameScene();
  scene.init({ mode: 'online', app: { connection, playSound() {} }, room: 'Arena' });
  scene.player = new Character({ id: '001', name: 'Hunter', local: true });
  scene.player.respawn(2, 2);
  scene.player.move = () => {};
  scene.player.stats = newStats();
  scene.player.stats.money = state.money;
  state.wallet = scene.player.stats;
  scene.shop = state;
  scene.ui = { shopOpen: false, menuOpen: false, shop: { refresh() {}, updateRespawnTime() {} },
    closeShop() { this.shopOpen = false; }, slider: { setBanks() {}, update() {} } };
  scene.hud = { messages: [], addMessage(message) { this.messages.push(message); } };
  scene.keyState = { newPress: () => false, isDown: () => false, endTick() {} };
  scene.equipment = { tick() {} };
  for (const method of ['updateScores', 'thinkNpcs', 'checkBountyCrates', 'processWeapons', 'sendUpdate', 'pingPeers', 'weaponChanged']) scene[method] = () => {};
  scene.respawnLocal = () => scene.player.respawn(2, 2);
  return scene;
}

test('real game tick buys at the cash threshold and syncs once without changing the held gun', () => {
  const scene = session();
  Preferences.autoBuyWeapons = true;
  scene.tick();
  assert.equal(scene.shop.item(RIFLE).owned, false);
  scene.player.stats.money++;
  const held = scene.player.weapon, charge = held.charge;
  scene.tick();
  assert.equal(scene.player.weaponByID(RIFLE), scene.shop.item(RIFLE).weapon);
  assert.equal(scene.player.weapon, held);
  assert.equal(held.charge, charge);
  assert.equal(scene.player.stats.money, 0);
  assert.deepEqual(scene.connection.purchases, ['0l150']);
  assert.deepEqual(scene.hud.messages, ['Auto bought Rifle.']);
  scene.tick();
  assert.deepEqual(scene.connection.purchases, ['0l150']);
  assert.equal(scene.autoSelectWeapon, null);
});

test('disabled, loading, ended or disconnected games do not spend cash', () => {
  for (const condition of ['off', 'loading', 'ended', 'disconnected', 'unauthenticated']) {
    const scene = session();
    scene.shop.money = 100000;
    Preferences.autoBuyWeapons = condition !== 'off';
    scene.loadingMap = condition === 'loading';
    scene.gameOver = condition === 'ended';
    scene.connection.connected = condition !== 'disconnected';
    scene.connection.authenticated = condition !== 'unauthenticated';
    scene.autoBuyWeapons();
    assert.equal(scene.shop.money, 100000, condition);
    assert.deepEqual(scene.connection.purchases, [], condition);
  }
});

test('enabling with existing cash works in the initial shop and equips inventory on spawn', () => {
  const scene = session();
  scene.player.active = false;
  scene.ui.shopOpen = true;
  scene.shop.money = 8500;
  Preferences.autoBuyWeapons = true;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(RIFLE).owned, true);
  scene.closeShop();
  assert.equal(scene.player.active, true);
  assert.equal(scene.player.weaponByID(RIFLE), scene.shop.item(RIFLE).weapon);
  assert.deepEqual(scene.connection.purchases, ['0l150']);
});

test('offline practice buys without a connection; turning the option off stops further purchases', () => {
  const scene = session();
  scene.mode = 'offline';
  scene.connection = null;
  scene.shop.money = 8500;
  Preferences.autoBuyWeapons = true;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(RIFLE).owned, true);
  Preferences.autoBuyWeapons = false;
  scene.shop.money = 100000;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(PLASMA).owned, false);
  assert.equal(scene.shop.money, 100000);
});
