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
const { SHOTGUN, RIFLE, PLASMA, MAGNUM, AK47 } = WeaponID;

function shop(money) {
  setWeaponStats(parseWeaponStats(constants));
  return new ShopState(money);
}

function unlockedShop(money) {
  const s = shop(money + 7000);
  assert.equal(s.buy(SHOTGUN).ok, true);
  return s;
}

test('Auto Buy spends nothing until Shotgun is manually purchased, even with abundant cash', () => {
  const s = shop(1000000);
  for (let i = 0; i < 5; i++) assert.deepEqual(s.autoBuy(1000), []);
  assert.equal(s.money, 1000000);
  assert.equal(s.item(SHOTGUN).owned, false);
  assert.equal(s.item(RIFLE).owned, false);
  s.buy(RIFLE);
  assert.deepEqual(s.autoBuy(), [], 'buying another gun does not unlock Auto Buy');
  s.money = 6999;
  assert.equal(s.buy(SHOTGUN).ok, false);
  s.money = 1000000;
  assert.deepEqual(s.autoBuy(), [], 'a failed Shotgun purchase does not unlock it');
});

test('cash is deducted between purchases and only the remaining three guns are bought', () => {
  const s = unlockedShop(31500);
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
  const s = unlockedShop(500);
  s.item(RIFLE).weapon.price.cost = 900;
  s.item(PLASMA).weapon.price.cost = 300;
  s.item(MAGNUM).weapon.price.cost = 200;
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [MAGNUM, PLASMA]);
  assert.equal(s.money, 0);
  assert.equal(s.item(RIFLE).owned, false);
});

test('owned guns are skipped: repeated checks never buy ammo, upgrades, or duplicates', () => {
  const s = unlockedShop(100000);
  s.buy(RIFLE);
  s.item(RIFLE).weapon.ammo.setCount(1);
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [PLASMA, MAGNUM]);
  const remaining = s.money;
  for (let i = 0; i < 20; i++) assert.deepEqual(s.autoBuy(), []);
  assert.equal(s.money, remaining);
  assert.equal(s.item(RIFLE).weapon.ammo.count, 1);
  assert.ok(s.item(RIFLE).weapon.upgrades.every((u) => !u?.owned));
});

test('refunding Shotgun pauses all Auto Buy until it is manually bought again', () => {
  const s = shop(100000);
  s.buy(SHOTGUN, 1000);
  assert.equal(s.refund(SHOTGUN, 2000).ok, true);
  const cash = s.money;
  assert.deepEqual(s.autoBuy(2001), []);
  assert.equal(s.money, cash);
  assert.equal(s.item(SHOTGUN).owned, false);
  assert.equal(s.buy(SHOTGUN, 3000).ok, true);
  assert.deepEqual(s.autoBuy(3001).map((r) => r.weapon.id), [RIFLE, PLASMA, MAGNUM]);
});

test('each refunded automatic gun stays excluded, including after re-unlocking with Shotgun', () => {
  for (const id of [RIFLE, PLASMA, MAGNUM]) {
    const s = unlockedShop(100000);
    s.autoBuy(1000);
    assert.equal(s.refund(id, 2000).ok, true);
    const cash = s.money;
    assert.deepEqual(s.autoBuy(2001), []);
    assert.equal(s.money, cash);
    assert.equal(s.item(id).owned, false);
    assert.equal(s.refund(SHOTGUN, 3000).ok, true);
    s.buy(SHOTGUN, 4000);
    assert.deepEqual(s.autoBuy(4001), []);
    assert.equal(s.item(id).owned, false, 'Shotgun rebuy does not clear other refunds');
    assert.equal(s.buy(id, 5000).ok, true, 'manual rebuy remains available');
  }
});

test('a new round resets the unlock and refund exclusions', () => {
  const s = unlockedShop(100000);
  s.autoBuy(1000);
  s.refund(RIFLE, 2000);
  s.reset();
  s.money = 100000;
  assert.deepEqual(s.autoBuy(3000), []);
  s.buy(SHOTGUN, 4000);
  assert.deepEqual(s.autoBuy(4001).map((r) => r.weapon.id), [RIFLE, PLASMA, MAGNUM]);
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
  const state = shop(6999);
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

test('real game tick waits for manual Shotgun, then buys Rifle at $8,500 and syncs once', () => {
  const scene = session();
  Preferences.autoBuyWeapons = true;
  scene.shop.money = 100000;
  scene.tick();
  assert.equal(scene.shop.money, 100000);
  assert.deepEqual(scene.connection.purchases, []);
  scene.shop.money = 15499;
  scene.purchased(scene.shop.buy(SHOTGUN));
  assert.equal(scene.shop.money, 8499);
  scene.tick();
  assert.equal(scene.shop.item(RIFLE).owned, false);
  scene.shop.money++;
  const held = scene.player.weapon, charge = held.charge;
  const pendingSelection = scene.autoSelectWeapon;
  scene.tick();
  assert.equal(scene.player.weaponByID(RIFLE), scene.shop.item(RIFLE).weapon);
  assert.equal(scene.player.weapon, held);
  assert.equal(held.charge, charge);
  assert.equal(scene.shop.money, 0);
  assert.deepEqual(scene.connection.purchases, ['0l030', '0l150']);
  assert.deepEqual(scene.hud.messages, ['Auto bought Rifle.']);
  scene.tick();
  assert.deepEqual(scene.connection.purchases, ['0l030', '0l150']);
  assert.equal(scene.autoSelectWeapon, pendingSelection);
});

test('disabled, loading, ended or disconnected games do not spend cash', () => {
  for (const condition of ['off', 'loading', 'ended', 'disconnected', 'unauthenticated']) {
    const scene = session();
    scene.shop.money = 107000;
    scene.shop.buy(SHOTGUN);
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

test('manual Shotgun purchased before enabling unlocks Auto Buy in the initial shop', () => {
  const scene = session();
  scene.player.active = false;
  scene.ui.shopOpen = true;
  scene.shop.money = 15500;
  scene.purchased(scene.shop.buy(SHOTGUN));
  assert.equal(Preferences.autoBuyWeapons, false);
  Preferences.autoBuyWeapons = true;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(RIFLE).owned, true);
  scene.closeShop();
  assert.equal(scene.player.active, true);
  assert.equal(scene.player.weaponByID(RIFLE), scene.shop.item(RIFLE).weapon);
  assert.deepEqual(scene.connection.purchases, ['0l030', '0l150']);
});

test('offline practice requires manual Shotgun too; turning off stops further purchases', () => {
  const scene = session();
  scene.mode = 'offline';
  scene.connection = null;
  scene.shop.money = 15500;
  Preferences.autoBuyWeapons = true;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.money, 15500);
  scene.purchased(scene.shop.buy(SHOTGUN));
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(RIFLE).owned, true);
  Preferences.autoBuyWeapons = false;
  scene.shop.money = 100000;
  scene.autoBuyWeapons();
  assert.equal(scene.shop.item(PLASMA).owned, false);
  assert.equal(scene.shop.money, 100000);
});

test('starting $10,000 stays untouched until manual Shotgun, then saves up for Rifle', () => {
  const s = shop(10000);
  assert.deepEqual(s.autoBuy(), []);
  assert.equal(s.money, 10000);
  const result = s.buy(SHOTGUN, 1000);
  assert.equal(result.ok, true);
  assert.equal(s.refundable(1000)[0].amount, 7000);
  assert.equal(s.money, 3000);
  assert.deepEqual(s.autoBuy(), []);
  s.money = 8499;
  assert.deepEqual(s.autoBuy(), []);
  s.money++;
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [RIFLE]);
  assert.equal(s.money, 0);
});

test('after manual Shotgun, enough cash buys the remaining three once, cheapest first', () => {
  const s = shop(68500);
  assert.deepEqual(s.autoBuy(), []);
  s.buy(SHOTGUN);
  assert.deepEqual(s.autoBuy().map((r) => r.weapon.id), [RIFLE, PLASMA, MAGNUM]);
  assert.equal(s.money, 0);
  assert.deepEqual(s.autoBuy(), []);
});
