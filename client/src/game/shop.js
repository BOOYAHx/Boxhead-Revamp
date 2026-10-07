// The shop's rules: what is for sale and what buying does
// (boxhead.ui.shop.Shop, ShopWeaponButton, ShopEquipmentButton, and this
// build's AmmoPurchasePanel, RefundPage and AutoReload). Pure logic so it can
// be unit-tested; ui/shop.js draws it and GameScene sends the "0l" messages.
//
// Money only ever lives on this client: the server relays purchases without
// checking them (it has no idea what anything costs).

import { PISTOL_ID, Weapon, WeaponID, isImplemented } from './weapons.js';

/** Weapons page rows, top to bottom (instance name, weapon id). */
export const WEAPON_ROWS = [
  ['pistolButton', WeaponID.PISTOL],
  ['uzisButton', WeaponID.AKIMBO_UZIS],
  ['shotgunButton', WeaponID.SHOTGUN],
  ['rifleButton', WeaponID.RIFLE],
  ['flamerButton', WeaponID.FLAMER],
  ['ak47Button', WeaponID.AK47],
  ['grenadeLauncherButton', WeaponID.GRENADE_LAUNCHER],
  ['plasmaCannonButton', WeaponID.PLASMA],
  ['minigunButton', WeaponID.MINIGUN],
  ['magnumButton', WeaponID.MAGNUM],
];

/** Equipment page rows. */
export const EQUIPMENT_ROWS = [
  ['grenadesButton', WeaponID.GRENADES],
  ['chargePacksButton', WeaponID.C4],
  ['minesButton', WeaponID.MINES],
  ['airstrikesButton', WeaponID.AIRSTRIKE],
  ['barrelsButton', WeaponID.BARRELS],
  ['barricadesButton', WeaponID.BARRICADES],
  ['spySatelliteButton', WeaponID.SPY],
];

export const BUY_ACTION = '0'; // also every refill (Game.BUY_ACTION / REFILL_ACTION)
export const UPGRADE1_ACTION = '1';
export const UPGRADE2_ACTION = '2';
export const REFUND_ACTION = '3'; // RefundPage
export const REFUND_TIME = 60000; // ms a gun can be returned after buying it
const REFUND_REPEAT = 350; // ms between refunds
const BIG_PACKS = [WeaponID.AKIMBO_UZIS, WeaponID.AK47, WeaponID.M16, WeaponID.MINIGUN, WeaponID.FLAMER];
// AutoReload: guns it refills when one round is left.
const RELOADABLE = [
  WeaponID.AKIMBO_UZIS,
  WeaponID.SHOTGUN,
  WeaponID.RIFLE,
  WeaponID.FLAMER,
  WeaponID.AK47,
  WeaponID.M16,
  WeaponID.GRENADE_LAUNCHER,
  WeaponID.PLASMA,
  WeaponID.MINIGUN,
  WeaponID.MAGNUM,
  WeaponID.RAILGUN,
];

/** One row of the shop: a weapon instance that becomes the player's when bought. */
export class ShopItem {
  constructor(name, id, equipment, free = false) {
    this.name = name;
    this.id = id;
    this.equipment = equipment;
    this.free = free && !equipment; // free guns: the gun, its ammo and its upgrades cost nothing
    this.owned = id === PISTOL_ID;
    this.weapon = this.newWeapon();
  }

  newWeapon() {
    const weapon = new Weapon(this.id);
    if (this.free) {
      weapon.price = { cost: 0, ammoCost: Math.min(0, weapon.price.ammoCost) }; // -1 stays "no ammo for sale"
      for (const upgrade of weapon.upgrades) if (upgrade) upgrade.cost = 0;
    }
    return weapon;
  }

  /** Not sold yet in this version (shown faded, like the original's blocked items). */
  get blocked() {
    return !isImplemented(this.id);
  }

  /**
   * ShopWeaponButton / ShopEquipmentButton fillCost: the price of the next
   * purchase. Guns: the gun, then a full refill. Equipment: one more unit,
   * or the full price again once it is used up.
   */
  get fillCost() {
    const { ammo, price } = this.weapon;
    if (this.equipment) {
      if (this.owned && (!ammo || ammo.count > 0)) return ammo ? ammo.buyCount * price.ammoCost : 0;
      return price.cost;
    }
    if (!this.owned) return price.cost;
    return ammo ? ammo.buyCount * price.ammoCost : 0;
  }

  /** Rounds missing from a full gun. */
  get missing() {
    const ammo = this.weapon.ammo;
    return ammo ? Math.max(0, ammo.max - ammo.count) : 0;
  }

  /** AmmoPurchasePanel.ammoPackSize: the small ammo purchase. */
  get packSize() {
    return BIG_PACKS.includes(this.id) ? 25 : 5;
  }
}

/** Result of a purchase attempt: { ok, sound, action, event, weapon }. */
const denied = (sound = 'CantAfford') => ({ ok: false, sound });

export class ShopState {
  /**
   * wallet: where the money is kept (the player's stats), or a starting amount.
   * freeGuns: every gun, its ammo and upgrades cost nothing (config.js freeGuns).
   */
  constructor(wallet = 0, { freeGuns = false } = {}) {
    this.wallet = typeof wallet === 'number' ? { money: wallet } : wallet;
    this.freeGuns = freeGuns;
    this.reset();
  }

  get money() {
    return this.wallet.money;
  }

  set money(value) {
    this.wallet.money = value;
  }

  /** Shop.reset at every round: only the Pistol, fresh weapons, no receipts. */
  reset() {
    this.weapons = WEAPON_ROWS.map(([name, id]) => new ShopItem(name, id, false, this.freeGuns));
    this.equipment = EQUIPMENT_ROWS.map(([name, id]) => new ShopItem(name, id, true));
    this.receipts = new Map(); // weapon id -> { price, upgrade1, upgrade2, deadline, used }
    this.lastRefund = -Infinity;
  }

  item(id) {
    // Equipment rows are searched first, like Shop.buyWeaponByID.
    return this.equipment.find((i) => i.id === id) || this.weapons.find((i) => i.id === id) || null;
  }

  /** Everything bought, weapons first (Shop.getOwnedWeapons). */
  ownedWeapons() {
    return [...this.weapons, ...this.equipment].filter((i) => i.owned).map((i) => i.weapon);
  }

  /**
   * Shop.buySelectedWeapon / buySelectedEquipment: buy the item, or refill
   * it. An owned gun with ammo is filled up completely (the ammo panel's
   * "Full Ammo"). `event` is 'buy' for a new item, 'refill' otherwise.
   */
  buy(id, now = 0) {
    const item = this.item(id);
    if (!item) return { ok: false, sound: null };
    if (item.blocked) return denied();
    if (!item.equipment && item.owned && item.weapon.ammo) return this.buyAmmo(id, true);
    const cost = item.fillCost;
    if (cost <= 0 && item.owned) return { ok: false, sound: null };
    if (this.money < cost) return denied();
    const wasOwned = item.owned;
    this.money -= cost;
    if (!wasOwned) {
      item.owned = true;
      if (!item.equipment && cost > 0) this.receipts.set(id, { price: cost, upgrade1: 0, upgrade2: 0, deadline: now + REFUND_TIME, used: false });
    } else if (item.weapon.ammo) {
      item.weapon.ammo.add(item.weapon.ammo.buyCount);
    }
    item.weapon.ammoWarningGiven = false;
    return { ok: true, sound: 'ClickLong', action: BUY_ACTION, event: wasOwned ? 'refill' : 'buy', weapon: item.weapon };
  }

  /** AmmoPurchasePanel.purchase: a pack of rounds, or fill the gun up. */
  buyAmmo(id, full) {
    const item = this.item(id);
    const ammo = item?.weapon.ammo;
    if (!item || !item.owned || !ammo) return { ok: false, sound: null };
    if (item.blocked) return denied();
    const missing = item.missing;
    if (missing === 0) return { ok: false, sound: null };
    const n = full ? missing : item.packSize;
    if (!full && missing < n) return { ok: false, sound: null };
    const cost = n * item.weapon.price.ammoCost;
    if (item.weapon.price.ammoCost < 0 || this.money < cost) return denied();
    ammo.add(n);
    this.money -= cost;
    item.weapon.ammoWarningGiven = false;
    return { ok: true, sound: 'ClickLong', action: BUY_ACTION, event: 'refill', weapon: item.weapon };
  }

  /** Shop.buyUpgrade: upgrade 1 or 2 of an owned gun. */
  buyUpgrade(id, n) {
    const item = this.item(id);
    if (!item) return { ok: false, sound: null };
    if (item.blocked) return denied();
    const upgrade = item.weapon.upgrades[n - 1];
    if (!upgrade || upgrade.owned || !item.owned) return { ok: false, sound: null };
    if (this.money < upgrade.cost) return denied();
    this.money -= upgrade.cost;
    const receipt = this.receipts.get(id);
    if (receipt && !receipt.used) receipt['upgrade' + n] += upgrade.cost;
    item.weapon.buyUpgrade(n);
    return { ok: true, sound: 'ClickLong', action: n === 1 ? UPGRADE1_ACTION : UPGRADE2_ACTION, event: 'upgrade' + n, weapon: item.weapon };
  }

  /** Guns that can still be returned (RefundPage rows), with seconds left. */
  refundable(now) {
    const rows = [];
    for (const item of this.weapons) {
      const receipt = this.receipts.get(item.id);
      if (!receipt || receipt.used || !item.owned) continue;
      const seconds = Math.max(0, Math.ceil((receipt.deadline - now) / 1000));
      rows.push({ item, receipt, seconds, amount: receipt.price + receipt.upgrade1 + receipt.upgrade2 });
    }
    return rows;
  }

  /**
   * RefundPage.refund: the gun goes back with its upgrades for what was
   * paid (not the ammo bought); a new copy keeps the rounds it had.
   */
  refund(id, now) {
    const item = this.item(id);
    const receipt = this.receipts.get(id);
    if (!item || !receipt || receipt.used || !item.owned || now - this.lastRefund < REFUND_REPEAT || now > receipt.deadline) return { ok: false, sound: null };
    this.lastRefund = now;
    receipt.used = true;
    const old = item.weapon;
    item.owned = false;
    item.weapon = item.newWeapon();
    if (old.ammo && item.weapon.ammo) item.weapon.ammo.setCount(Math.min(old.ammo.count, item.weapon.ammo.max));
    this.money += receipt.price + receipt.upgrade1 + receipt.upgrade2;
    return { ok: true, sound: 'ClickLong', action: REFUND_ACTION, event: 'refund', weapon: old };
  }

  /**
   * AutoReload.check: with the option on, a gun down to its last round is
   * refilled silently when there is money for it.
   */
  autoReload(weapon) {
    const ammo = weapon?.ammo;
    if (!ammo || !RELOADABLE.includes(weapon.id) || ammo.count !== 1 || ammo.max <= 1) return null;
    const item = this.item(weapon.id);
    if (!item || item.weapon !== weapon || !item.owned) return null;
    const cost = weapon.price.ammoCost;
    if (cost < 0 || this.money < (ammo.max - 1) * cost) return null;
    return this.buy(weapon.id);
  }
}
