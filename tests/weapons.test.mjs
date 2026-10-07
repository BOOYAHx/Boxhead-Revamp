// Step 8 rules: every gun, ammo, weapon banks and switching, and the shop.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E, S } from '../client/src/game/Direction.js';
import { ShopState } from '../client/src/game/shop.js';
import { PISTOL_ID, Weapon, WeaponID, parseWeaponStats, setWeaponStats, shotgunCode } from '../client/src/game/weapons.js';

// The parts of the shipped constants.xml these tests use.
const CONSTANTS = `<data>
  <weapon id="0" name="Pistol" shortName="Pistol"><ammo>Infinite</ammo><ammoIncrement>0</ammoIncrement><damage>7</damage><range>20</range><spread>0.08</spread><fireDelay>0.5</fireDelay><moveSpeed>1.0</moveSpeed><cost>0</cost><ammoCost>0</ammoCost>
    <upgrade1><type>damage</type><value>9</value><cost>2500</cost></upgrade1><upgrade2><type>moveSpeed</type><value>1.1</value><cost>2500</cost></upgrade2></weapon>
  <weapon id="2" name="Dual Uzis" shortName="Dual Uzis"><ammo>250</ammo><ammoIncrement>250</ammoIncrement><damage>5</damage><range>20</range><spread>0.16</spread><fireDelay>0.15</fireDelay><moveSpeed>1</moveSpeed><cost>6500</cost><ammoCost>5</ammoCost>
    <upgrade1><type>damage</type><value>5</value><cost>3800</cost></upgrade1><upgrade2><type>moveSpeed</type><value>1.1</value><cost>3000</cost></upgrade2></weapon>
  <weapon id="3" name="Shotgun" shortName="Shotgun"><ammo>35</ammo><ammoIncrement>35</ammoIncrement><damage>6</damage><range>10</range><spread>0.3</spread><fireDelay>1.5</fireDelay><moveSpeed>0.75</moveSpeed><cost>7000</cost><ammoCost>50</ammoCost>
    <upgrade1><type>damage</type><value>7</value><cost>4000</cost></upgrade1><upgrade2><type>fireDelay</type><value>1.2</value><cost>5000</cost></upgrade2></weapon>
  <weapon id="5" name="Flamer" shortName="Flamer"><ammo>200</ammo><ammoIncrement>200</ammoIncrement><damage>1</damage><range>3</range><spread>0</spread><fireDelay>0.2</fireDelay><moveSpeed>0.6</moveSpeed><cost>13500</cost><ammoCost>20</ammoCost></weapon>
  <weapon id="6" name="Grenades" shortName="Grenades"><ammo>5</ammo><ammoIncrement>1</ammoIncrement><damage>55</damage><range>5</range><spread>0</spread><fireDelay>1</fireDelay><moveSpeed>1</moveSpeed><cost>1000</cost><ammoCost>1000</ammoCost></weapon>
  <weapon id="11" name="Magnum" shortName="Magnum"><ammo>20</ammo><ammoIncrement>20</ammoIncrement><damage>45</damage><range>20</range><spread>0.05</spread><fireDelay>0.8</fireDelay><moveSpeed>1.1</moveSpeed><cost>30000</cost><ammoCost>250</ammoCost>
    <upgrade1><type>ammo</type><value>30</value><cost>4000</cost></upgrade1><upgrade2><type>moveSpeed</type><value>1</value><cost>9500</cost></upgrade2></weapon>
  <weapon id="13" name="AK47" shortName="AK47"><ammo>100</ammo><ammoIncrement>100</ammoIncrement><damage>9</damage><range>20</range><spread>0.12</spread><fireDelay>0.2</fireDelay><moveSpeed>1</moveSpeed><cost>17500</cost><ammoCost>12</ammoCost></weapon>
  <weapon id="15" name="Rifle" shortName="Rifle"><ammo>35</ammo><ammoIncrement>35</ammoIncrement><damage>25</damage><range>25</range><spread>0.05</spread><fireDelay>1</fireDelay><moveSpeed>0.75</moveSpeed><cost>8500</cost><ammoCost>90</ammoCost></weapon>
  <weapon id="16" name="Railgun" shortName="Railgun"><ammo>20</ammo><ammoIncrement>20</ammoIncrement><damage>50</damage><range>Infinite</range><spread>0.05</spread><fireDelay>0.8</fireDelay><moveSpeed>1</moveSpeed><cost>30000</cost><ammoCost>250</ammoCost></weapon>
</data>`;

setWeaponStats(parseWeaponStats(CONSTANTS));

function player(x = 5, y = 5) {
  const ch = new Character({ id: '001', local: true });
  ch.respawn(x, y);
  return ch;
}

test('stats: ammo, the Flamer forced to 3 damage, "Infinite" range of 100', () => {
  const uzis = new Weapon(WeaponID.AKIMBO_UZIS);
  assert.equal(uzis.ammo.max, 250);
  assert.equal(uzis.ammo.count, 250);
  assert.equal(uzis.reloadTime, 3);
  assert.equal(new Weapon(WeaponID.FLAMER).damage, 3);
  assert.equal(new Weapon(WeaponID.RAILGUN).range, 100);
  assert.equal(new Weapon(PISTOL_ID).ammo, null);
  assert.equal(new Weapon(WeaponID.AKIMBO_UZIS, { remote: true }).ammo, null);
});

test('akimbo guns alternate hands, and the flash follows the hand', () => {
  const ch = player();
  ch.dir = S;
  const uzis = new Weapon(WeaponID.AKIMBO_UZIS);
  const params = [];
  const xs = [];
  for (let i = 0; i < 4; i++) {
    const param = uzis.fireParam();
    params.push(param);
    const shot = uzis.shoot(ch, S.radians, param);
    xs.push(shot.start.x);
  }
  assert.deepEqual(params, [1, 0, 1, 0]);
  // Facing south, param 1 fires from the right of the screen.
  assert.ok(xs[0] > 5 && xs[1] < 5);
  uzis.queueEffects(uzis.shoot(ch, S.radians, 1), [5]);
  uzis.process(true);
  assert.equal(uzis.flashHand, 0);
});

test('the shotgun fires five pellets from its code, skewed like the original', () => {
  const ch = player();
  ch.dir = E;
  const shotgun = new Weapon(WeaponID.SHOTGUN);
  const shot = shotgun.shoot(ch, 0, 15937);
  assert.equal(shot.tracers.length, 5);
  const ks = shot.tracers.map((t) => Math.round((t.angle / 0.3) * 8));
  assert.deepEqual(ks, [-3, 1, 5, -1, 3]); // digits 1, 5, 9, 3, 7 minus 4
  assert.ok(shot.tracers.every((t) => t.range === 10));
  // Codes are five digits 1-9; the 2 can only come first (the splice quirk).
  for (let i = 0; i < 200; i++) {
    const code = String(shotgunCode());
    assert.match(code, /^[1-9]{5}$/);
  }
  const sequence = [0.2, 0.0, 0.0, 0.0, 0.0]; // picks digit index 1 (the 2), then index 0
  let i = 0;
  assert.equal(shotgunCode(() => sequence[i++]), 11112);
});

test('the flamer throws five short rays of 3 damage', () => {
  const ch = player();
  const flamer = new Weapon(WeaponID.FLAMER);
  const shot = flamer.shoot(ch, 0, 0, () => 0.5);
  assert.deepEqual(
    shot.tracers.map((t) => +t.range.toFixed(2)),
    [1.3, 2, 2.7, 2, 1.3],
  );
  assert.equal(flamer.tracerLines({ shot, distances: [1, 1, 1, 1, 1], muzzle: { x: 0, y: 0 } }).length, 0);
});

test('ammo runs out, then the gun switches back once it has reloaded', () => {
  const ch = player();
  const rifle = ch.pickupWeapon(new Weapon(WeaponID.RIFLE));
  ch.selectWeapon(rifle);
  rifle.ammo.setCount(1);
  assert.ok(rifle.canFire());
  rifle.useFireAmmo();
  rifle.shoot(ch, 0);
  assert.ok(!rifle.canFire());
  let switched = null;
  for (let t = 0; t < rifle.reloadTime && !switched; t++) {
    for (const w of ch.weapons) if (w.process(w === ch.weapon).reloaded) switched = ch.checkAutoSwitch() || switched;
  }
  assert.equal(ch.weapon.id, PISTOL_ID);
  assert.equal(ch.refillTarget, rifle); // R buys ammo for it
});

test('weapon banks and Q/E order follow the original priorities', () => {
  const ch = player();
  for (const id of [WeaponID.MAGNUM, WeaponID.AKIMBO_UZIS, WeaponID.SHOTGUN, WeaponID.RIFLE, WeaponID.AK47, WeaponID.FLAMER]) ch.pickupWeapon(new Weapon(id));
  assert.deepEqual(
    ch.weapons.map((w) => w.name),
    ['Pistol', 'Dual Uzis', 'Magnum', 'Rifle', 'Shotgun', 'AK47', 'Flamer'],
  );
  assert.deepEqual(
    ch.banks[1].map((w) => w.name),
    ['Magnum', 'Dual Uzis', 'Pistol'],
  );
  assert.equal(ch.nextWeapon().name, 'Dual Uzis');
  assert.equal(ch.prevWeapon().name, 'Pistol');
  assert.equal(ch.prevWeapon().name, 'Flamer'); // wraps around
  assert.equal(ch.selectWeaponBank(2).name, 'AK47'); // first of the bank
  assert.equal(ch.selectWeaponBank(2).name, 'Shotgun'); // then the next one
  ch.weaponByID(WeaponID.RIFLE).ammo.setCount(0);
  assert.equal(ch.selectWeaponBank(2).name, 'AK47'); // empty guns are skipped
  assert.equal(ch.selectWeaponBank(5), null);
  // Walking speed comes from the weapon in hand; the animation from the one selected.
  ch.selectWeaponByID(WeaponID.SHOTGUN);
  assert.equal(ch.animSpeed, 0.75);
  assert.ok(Math.abs(ch.speed - 0.15) < 1e-9);
});

test('railgun shots light the gun down until it reloads; the minigun turns', () => {
  const ch = player();
  const rail = new Weapon(WeaponID.RAILGUN);
  assert.equal(rail.display, 'RailgunLit');
  rail.shoot(ch, 0);
  rail.process(true);
  assert.equal(rail.display, 'Railgun');
  for (let i = 0; i < rail.reloadTime; i++) rail.process(true);
  assert.equal(rail.display, 'RailgunLit');
});

test('shop: buy a gun, fill it up, upgrade it, refund it within a minute', () => {
  const shop = new ShopState(30000);
  assert.deepEqual(shop.ownedWeapons().map((w) => w.id), [PISTOL_ID]);
  const ak = shop.buy(WeaponID.AK47, 0);
  assert.deepEqual([ak.ok, ak.event, ak.action, shop.money], [true, 'buy', '0', 12500]);
  ak.weapon.ammo.setCount(40);
  const pack = shop.buyAmmo(WeaponID.AK47, false);
  assert.deepEqual([pack.ok, ak.weapon.ammo.count, shop.money], [true, 65, 12500 - 25 * 12]);
  const full = shop.buy(WeaponID.AK47);
  assert.deepEqual([full.event, ak.weapon.ammo.count, shop.money], ['refill', 100, 12200 - 35 * 12]);
  assert.equal(shop.buy(WeaponID.AK47).ok, false); // already full
  const pistol = shop.buyUpgrade(PISTOL_ID, 1);
  assert.deepEqual([pistol.ok, pistol.action, shop.weapons[0].weapon.damage], [true, '1', 9]);
  const poor = shop.buy(WeaponID.MAGNUM);
  assert.deepEqual([poor.ok, poor.sound], [false, 'CantAfford']);
  const rows = shop.refundable(30000);
  assert.deepEqual(rows.map((r) => [r.item.id, r.seconds, r.amount]), [[WeaponID.AK47, 30, 17500]]);
  const before = shop.money;
  const refund = shop.refund(WeaponID.AK47, 30000);
  assert.deepEqual([refund.ok, refund.action, shop.money - before], [true, '3', 17500]);
  assert.equal(shop.item(WeaponID.AK47).owned, false);
  assert.equal(shop.item(WeaponID.AK47).weapon.ammo.count, 100); // ammo bought is kept, not refunded
  assert.equal(shop.refund(WeaponID.AK47, 31000).ok, false);
});

test('shop: equipment and the explosive guns are available', () => {
  const shop = new ShopState(100000);
  assert.equal(shop.buy(WeaponID.GRENADES).ok, true);
  assert.equal(shop.buy(WeaponID.GRENADE_LAUNCHER).ok, true);
  assert.equal(shop.buy(WeaponID.PLASMA).ok, true);
  assert.ok(shop.money < 100000, 'equipment still costs money');
});

test('free guns: guns, ammo and upgrades cost nothing, equipment is unchanged', () => {
  const shop = new ShopState(0, { freeGuns: true });
  const ak = shop.buy(WeaponID.AK47, 0);
  assert.deepEqual([ak.ok, ak.event, shop.money], [true, 'buy', 0]);
  ak.weapon.ammo.setCount(1);
  assert.deepEqual([shop.buy(WeaponID.AK47).ok, ak.weapon.ammo.count], [true, 100]);
  shop.buy(WeaponID.SHOTGUN);
  assert.equal(shop.buyUpgrade(WeaponID.SHOTGUN, 2).ok, true);
  assert.deepEqual(shop.refundable(0), []); // nothing paid, nothing to refund
  assert.equal(shop.buy(WeaponID.GRENADES).ok, false);
  assert.equal(shop.money, 0);
  shop.reset();
  assert.equal(shop.buy(WeaponID.MAGNUM).ok, true);
});

test('auto reload buys a full gun when one round is left', () => {
  const shop = new ShopState(10000);
  const uzis = shop.buy(WeaponID.AKIMBO_UZIS).weapon;
  uzis.ammo.setCount(2);
  assert.equal(shop.autoReload(uzis), null);
  uzis.ammo.setCount(1);
  const r = shop.autoReload(uzis);
  assert.ok(r.ok);
  assert.equal(uzis.ammo.count, 250);
  assert.equal(shop.money, 3500 - 249 * 5);
});

test('the real constants.xml has every weapon', { skip: !safeRead('client/assets/game/constants.xml') }, () => {
  const stats = parseWeaponStats(safeRead('client/assets/game/constants.xml'));
  for (let id = 0; id < 22; id++) assert.ok(stats[id], 'weapon ' + id);
  assert.equal(stats[WeaponID.FLAMER].damage, 3);
  assert.equal(stats[WeaponID.PLASMA].range, 100);
  assert.equal(stats[WeaponID.SHOTGUN].upgrades[1].type, 'fireDelay');
  setWeaponStats(parseWeaponStats(CONSTANTS));
});

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
