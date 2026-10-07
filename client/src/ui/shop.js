// The shop (boxhead.ui.shop.Shop) rebuilt from the original art: the
// Weapons, Refund and Equipment tabs, the item list, the weapon's picture and
// stats, buy and upgrade panels, and this build's ammo panel (two buttons for
// a pack or a full gun) and Refund page. The rules are in game/shop.js.

import { damageDescription, maxAmmoDescription, rateOfFireDescription, upgradeDescription } from '../game/weapons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const BLOCKED_ALPHA = 0.35; // Shop.isBlocked rows
const DOUBLE_CLICK = 400; // ms
const REFUND_TICK = 200; // ms (RefundPage clock)
const WHEEL_STEP = 25; // px per wheel notch
const PANE = { x: 25, y: 126, width: 610, height: 290 }; // the premiums scroll pane, reused for refunds
const ROW_TOP = 23;
const ROW_STEP = 93;
const KeySel = { NONE: 0, WEAPON: 1, UPGRADE1: 2, UPGRADE2: 3 };

const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  buy: ['Enter', 'NumpadEnter', 'Space', 'KeyJ'],
  nextTab: ['KeyE'],
  prevTab: ['KeyQ'],
};
const is = (event, name) => KEYS[name].includes(event.code);

/** A text field's font made smaller until the text fits (WeaponDisplay name). */
function shrinkToFit(field, size, min = 10) {
  const box = field.box;
  const width = field.def.bounds[2] - field.def.bounds[0] - 4;
  const ctx = (shrinkToFit.ctx ||= document.createElement('canvas').getContext('2d'));
  let s = size;
  let shift = 0;
  const font = (n) => box.style.font.replace(/\d+(\.\d+)?px/, n + 'px');
  while (s > min) {
    ctx.font = font(s);
    if (ctx.measureText(field.text).width <= width) break;
    s--;
    shift++;
  }
  box.style.font = font(s);
  box.style.paddingTop = 2 + shift + 'px';
}

export class ShopScreen {
  /**
   * state: a ShopState. handlers: playSound(name), purchased(result) after a
   * successful purchase, close() for Enter Game, now() for the clock.
   */
  constructor(lib, state, handlers) {
    this.lib = lib;
    this.state = state;
    this.handlers = handlers;
    this.clip = lib.create('boxhead.ui.shop.Shop');
    const c = this.clip;
    this.background = c.child('background');
    this.tabs = { weapons: c.child('weaponsTab'), refund: c.child('premiumsTab'), equipment: c.child('equipmentTab') };
    this.weaponsPage = c.child('weaponsPage');
    this.equipmentPage = c.child('equipmentPage');
    this.premiumsPage = c.child('premiumsPage');
    this.moneyField = c.child('moneyField');
    this.gameBeginField = c.child('gameBeginField');
    this.enterGame = c.child('enterGameButton');
    if (this.enterGame) {
      if ('text' in this.enterGame) this.enterGame.text = 'Enter Game';
      this.enterGame.onClick?.(() => this.handlers.close());
    }
    this.weaponDisplay = this.weaponsPage.child('weaponDisplay');
    this.equipmentDisplay = this.equipmentPage.child('equipmentDisplay');
    this.weaponRows = state.weapons.map((item) => this.makeRow(this.weaponsPage.child(item.name), item, false));
    this.equipmentRows = state.equipment.map((item) => this.makeRow(this.equipmentPage.child(item.name), item, true));
    for (const [name, tab] of Object.entries(this.tabs)) tab?.on('click', () => this.showTab(name, true));
    this.setupBuyButtons();
    this.ammoPanel = new AmmoPanel(this);
    this.refundPage = new RefundPage(this);
    this.notice = this.makeNotice();
    this.buyReleased = true;
    this.keySelection = KeySel.NONE;
    this.gameStarted = false;
    this.respawnSounded = true;
    this.reset();
  }

  get el() {
    return this.clip.el;
  }

  // --- set-up ----------------------------------------------------------------------

  makeRow(clip, item, equipment) {
    const row = { clip, item, equipment, lastClick: 0 };
    clip.child('nameField').text = item.weapon.name;
    clip.child('selectionOverlay').visible = false;
    clip.el.style.cursor = 'pointer';
    clip.on('click', () => {
      const now = performance.now();
      const double = this.selected === row && now - row.lastClick < DOUBLE_CLICK;
      row.lastClick = now;
      if (double) this.buySelected();
      else this.select(row, true);
    });
    return row;
  }

  setupBuyButtons() {
    const wd = this.weaponDisplay;
    wd.child('buyDisplay.button')?.on('click', () => this.buySelected());
    for (const n of [1, 2]) {
      const display = wd.child('upgrade' + n + 'Display');
      display?.child('button')?.on('click', () => {
        if (this.selected?.item.owned) this.buyUpgrade(n);
      });
    }
    this.equipmentDisplay.child('buyDisplay.button')?.on('click', () => this.buySelected());
  }

  /** Shop.setNotice: a bar along the bottom (here: what is not for sale yet). */
  makeNotice() {
    const g = svg('g', { transform: 'translate(40 469)' });
    g.appendChild(svg('rect', { width: 620, height: 19, fill: '#000', 'fill-opacity': 0.75, rx: 3 }));
    const text = svg('text', { x: 310, y: 14, 'text-anchor': 'middle', fill: '#ffd34d', 'font-family': '"BBH Myriad Pro", Arial, sans-serif', 'font-size': 12, 'font-weight': 'bold' });
    g.appendChild(text);
    g.style.display = 'none';
    g.style.pointerEvents = 'none';
    this.clip.el.appendChild(g);
    return { g, text };
  }

  setNotice(message) {
    this.notice.text.textContent = message || '';
    this.notice.g.style.display = message ? '' : 'none';
  }

  // --- state ------------------------------------------------------------------------

  /** Shop.reset at each round: Weapons tab, first row, "Game will begin shortly...". */
  reset() {
    this.gameStarted = false;
    this.respawnSounded = true;
    this.gameBeginField.text = 'Game will begin shortly...';
    this.enterGame?.disable?.();
    this.refundPage.reset();
    this.showTab('weapons', false);
    this.select(this.weaponRows[0], false);
    this.equipmentSelected = this.equipmentRows[0];
  }

  /** Called when the round's items were replaced (a new ShopState round). */
  setState(state) {
    this.state = state;
    this.weaponRows.forEach((row, i) => (row.item = state.weapons[i]));
    this.equipmentRows.forEach((row, i) => (row.item = state.equipment[i]));
    this.refresh();
  }

  get rows() {
    return this.tab === 'equipment' ? this.equipmentRows : this.weaponRows;
  }

  /** Shop.showTab. */
  showTab(name, sound) {
    if (sound) this.handlers.playSound('ClickShort');
    this.tab = name;
    for (const [n, tab] of Object.entries(this.tabs)) if (tab) tab.el.style.pointerEvents = n === name ? 'none' : '';
    this.background.gotoAndStop(name === 'weapons' ? 1 : name === 'refund' ? 2 : 3);
    this.weaponsPage.visible = name === 'weapons';
    this.equipmentPage.visible = name === 'equipment';
    this.refundPage.show(name === 'refund');
    if (name === 'equipment') this.select(this.equipmentSelected || this.equipmentRows[0], false);
    else if (name === 'weapons') this.select(this.weaponSelected || this.weaponRows[0], false);
    this.refresh();
  }

  select(row, sound) {
    if (!row) return;
    if (sound && row !== this.selected) this.handlers.playSound('ClickShort');
    if (row.equipment) this.equipmentSelected = row;
    else this.weaponSelected = row;
    this.selected = row;
    this.checkKeySelection();
    this.ammoPanel.focus = this.ammoPanel.initialFocus();
    this.refresh();
  }

  /** Select a row by weapon id (Shop.buyWeaponByID / refillWeaponByID), equipment first. */
  selectByID(id) {
    const row = this.equipmentRows.find((r) => r.item.id === id) || this.weaponRows.find((r) => r.item.id === id);
    if (!row) return null;
    if (row.equipment) this.equipmentSelected = row;
    else this.weaponSelected = row;
    this.selected = row;
    this.checkKeySelection();
    return row;
  }

  /** Shop.checkWeaponKeySelection: highlight the buy panel, else the first upgrade left. */
  checkKeySelection() {
    const row = this.selected;
    if (!row) return;
    if (row.item.fillCost > 0) this.keySelection = KeySel.WEAPON;
    else if (!row.equipment && row.item.owned) {
      const [u1, u2] = row.item.weapon.upgrades;
      this.keySelection = u1 && !u1.owned ? KeySel.UPGRADE1 : u2 && !u2.owned ? KeySel.UPGRADE2 : KeySel.NONE;
    } else this.keySelection = row.equipment ? KeySel.NONE : KeySel.WEAPON;
  }

  // --- buying ------------------------------------------------------------------------

  apply(result, { sound = true } = {}) {
    if (sound && result.sound) this.handlers.playSound(result.sound);
    if (result.ok) {
      this.handlers.purchased(result);
      this.checkKeySelection();
    }
    this.refresh();
    return result;
  }

  /** Buy (or refill) the selected item. */
  buySelected(sound = true) {
    const row = this.selected;
    if (!row) return null;
    return this.apply(this.state.buy(row.item.id, this.handlers.now()), { sound });
  }

  buyUpgrade(n, sound = true) {
    const row = this.selected;
    if (!row || row.equipment) return null;
    return this.apply(this.state.buyUpgrade(row.item.id, n), { sound });
  }

  buyAmmo(full, sound = true) {
    const row = this.selected;
    if (!row) return null;
    return this.apply(this.state.buyAmmo(row.item.id, full), { sound });
  }

  /** Shop.refillWeaponByID (R key, AutoReload): select that item and buy it. */
  refillByID(id, sound = true) {
    if (!this.selectByID(id)) return null;
    return this.buySelected(sound);
  }

  // --- drawing --------------------------------------------------------------------------

  refresh() {
    this.moneyField.text = 'Your Cash: $' + this.state.money;
    for (const row of this.weaponRows) this.updateWeaponRow(row);
    for (const row of this.equipmentRows) this.updateEquipmentRow(row);
    if (this.tab === 'weapons') this.updateWeaponInfo();
    if (this.tab === 'equipment') this.updateEquipmentInfo();
    const blocked = this.tab !== 'refund' && this.selected?.item.blocked;
    this.setNotice(blocked ? 'Explosives, the Plasma Cannon and equipment are not in this version yet.' : '');
    if (this.tab === 'refund') this.refundPage.refresh();
  }

  /** ShopWeaponButton.update. */
  updateWeaponRow(row) {
    const { clip, item } = row;
    const weapon = item.weapon;
    clip.gotoAndStop(item.owned ? 'Owned' : 'NotOwned');
    const ammo = clip.child('ammoDisplay');
    const pips = [clip.child('upgrade1Display'), clip.child('upgrade2Display')];
    if (!item.owned) {
      ammo?.gotoAndStop(1);
      for (const pip of pips) pip?.gotoAndStop('Unavailable');
    } else {
      ammo?.gotoAndStop(weapon.ammo ? 1 + Math.round((weapon.ammo.count / weapon.ammo.max) * 8) : ammo.totalFrames);
      weapon.upgrades.forEach((u, i) => pips[i]?.gotoAndStop(u ? (u.owned ? 'Owned' : 'NotOwned') : 'Unavailable'));
    }
    clip.child('nameField').text = weapon.name;
    clip.child('selectionOverlay').visible = row === this.selected;
    clip.alpha = item.blocked ? BLOCKED_ALPHA : 1;
  }

  /** ShopEquipmentButton.update. */
  updateEquipmentRow(row) {
    const { clip, item } = row;
    const ammo = item.weapon.ammo;
    const has = item.owned && (!ammo || ammo.count > 0);
    clip.gotoAndStop(has ? 'Owned' : 'NotOwned');
    clip.child('nameField').text = item.weapon.name;
    clip.child('ammoField').text = !has ? '' : ammo && ammo.max > 1 ? 'x' + ammo.count : 'Purchased';
    clip.child('selectionOverlay').visible = row === this.selected;
    clip.alpha = item.blocked ? BLOCKED_ALPHA : 1;
  }

  /** WeaponDisplay.displayInfo: picture, name, stats, the buy panel and the upgrades. */
  updateWeaponInfo() {
    const row = this.weaponSelected;
    if (!row) return;
    const wd = this.weaponDisplay;
    const { item } = row;
    const weapon = item.weapon;
    const money = this.state.money;
    wd.child('portraits').gotoAndStop(weapon.id + 1);
    const name = wd.child('nameField');
    name.text = weapon.name;
    shrinkToFit(name, name.def.size || 32);
    wd.child('statsField').text = `Damage: ${damageDescription(weapon)}\nRate of Fire: ${rateOfFireDescription(weapon)}\nMax Ammo: ${maxAmmoDescription(weapon)}`;
    // BuyWeaponDisplay, or the ammo panel for an owned gun with ammo.
    const buy = wd.child('buyDisplay');
    const ammoPanel = item.owned && !!weapon.ammo;
    buy.visible = !ammoPanel;
    this.ammoPanel.setVisible(ammoPanel);
    if (!ammoPanel) {
      let cost = 0;
      if (!item.owned) {
        cost = weapon.price.cost;
        buy.gotoAndStop(money >= cost && !item.blocked ? 'Buy' : 'CannotBuy');
      } else {
        buy.gotoAndStop('FullAmmo');
      }
      buy.child('costField').text = cost > 0 ? '$' + cost : '';
      buy.child('selectionOverlay').visible = this.keySelection === KeySel.WEAPON;
      const button = buy.child('button');
      if (button) button.el.style.cursor = cost > 0 && money >= cost ? 'pointer' : 'default';
    } else {
      this.ammoPanel.update();
    }
    [1, 2].forEach((n) => this.updateUpgrade(wd.child('upgrade' + n + 'Display'), n, weapon.upgrades[n - 1], item.owned, money, item.blocked));
  }

  /** UpgradeDisplay.display. */
  updateUpgrade(display, n, upgrade, weaponOwned, money, blocked) {
    if (!display) return;
    display.visible = !!upgrade;
    if (!upgrade) return;
    display.gotoAndStop(upgrade.owned ? 'Owned' : weaponOwned && money >= upgrade.cost && !blocked ? 'Buy' : 'CannotBuy');
    display.child('upgradeField').text = 'Upgrade ' + n;
    display.child('descriptionField').text = upgradeDescription(upgrade.type);
    display.child('costField').text = upgrade.owned ? 'Purchased!' : '$' + upgrade.cost;
    for (const f of ['upgradeField', 'descriptionField', 'costField']) display.child(f).alpha = upgrade.owned ? 0.5 : 1;
    const focus = this.ammoPanel.visible ? this.ammoPanel.focus === n + 1 : this.keySelection === n + 1;
    display.child('selectionOverlay').visible = focus;
    const button = display.child('button');
    if (button) button.el.style.cursor = weaponOwned && !upgrade.owned && money >= upgrade.cost ? 'pointer' : 'default';
  }

  /** EquipmentDisplay. */
  updateEquipmentInfo() {
    const row = this.equipmentSelected;
    if (!row) return;
    const ed = this.equipmentDisplay;
    const { item } = row;
    const weapon = item.weapon;
    const ammo = weapon.ammo;
    const money = this.state.money;
    ed.child('portraits').gotoAndStop(weapon.id + 1);
    const name = ed.child('nameField');
    name.text = weapon.name;
    shrinkToFit(name, name.def.size || 40);
    ed.child('descriptionField').text = weapon.description || '';
    const buy = ed.child('buyDisplay');
    const owned = item.owned && (!ammo || ammo.count > 0);
    let cost = 0;
    if (!owned) {
      cost = weapon.price.cost;
      buy.gotoAndStop(money >= cost && !item.blocked ? 'Buy' : 'CannotBuy');
    } else if (ammo && !ammo.full) {
      cost = ammo.buyCount * weapon.price.ammoCost;
      buy.gotoAndStop(money >= cost && !item.blocked ? 'Buy' : 'CannotBuy');
    } else buy.gotoAndStop(ammo ? 'FullAmmo' : 'Purchased');
    buy.child('costField').text = cost > 0 ? '$' + cost : '';
    buy.child('selectionOverlay').visible = this.keySelection === KeySel.WEAPON;
  }

  // --- round status ------------------------------------------------------------------

  /** Shop.setCountDown: "Game begins in N seconds..." until the round starts. */
  setCountDown(seconds) {
    if (this.gameStarted) return;
    this.gameBeginField.text = 'Game begins in ' + seconds + ' seconds...';
    if (seconds <= 0) {
      this.gameStarted = true;
      this.gameBeginField.text = 'Game has begun!';
      this.enterGame?.enable?.();
    }
  }

  /** Shop.updateRespawnTime. */
  updateRespawnTime(seconds, active, dead) {
    if (!this.gameStarted) return;
    if (active && dead) {
      if (seconds <= 0) {
        this.gameBeginField.text = 'You are ready to respawn!';
        if (!this.respawnSounded) {
          this.respawnSounded = true;
          this.handlers.playSound('CharacterRespawn');
        }
      } else this.gameBeginField.text = 'Respawn in ' + seconds + ' seconds...';
    } else if (active) this.gameBeginField.text = 'Game is in progress!';
  }

  /** Shop.closed. */
  closed() {
    this.respawnSounded = false;
    this.buyReleased = true;
  }

  // --- keyboard --------------------------------------------------------------------------

  /** Shop.handleKeyDown. Returns true when the key was used. */
  keyDown(event) {
    if (this.tab === 'refund') return this.refundPage.keyDown(event);
    if (this.ammoPanel.visible && this.ammoPanel.keyDown(event)) return true;
    const rows = this.rows;
    const index = rows.indexOf(this.selected);
    if (is(event, 'buy')) {
      if (!this.buyReleased) return true;
      this.buyReleased = false;
      if (this.tab === 'equipment' || this.keySelection === KeySel.WEAPON) this.buySelected();
      else if (this.keySelection === KeySel.UPGRADE1) this.buyUpgrade(1);
      else if (this.keySelection === KeySel.UPGRADE2) this.buyUpgrade(2);
      return true;
    }
    if (is(event, 'up') || is(event, 'down')) {
      const step = is(event, 'up') ? -1 : 1;
      this.select(rows[(index + step + rows.length) % rows.length], true);
      return true;
    }
    if (is(event, 'left') || is(event, 'right')) {
      if (this.tab === 'weapons') {
        this.keySelection = Math.max(KeySel.WEAPON, Math.min(KeySel.UPGRADE2, this.keySelection + (is(event, 'right') ? 1 : -1)));
        this.refresh();
      }
      return true;
    }
    if (is(event, 'nextTab') && this.tab === 'weapons') {
      this.showTab('refund', true);
      return true;
    }
    if (is(event, 'prevTab') && this.tab === 'equipment') {
      this.showTab('refund', true);
      return true;
    }
    return false;
  }

  keyUp(event) {
    if (is(event, 'buy')) {
      this.buyReleased = true;
      this.refundPage.held = false;
    }
  }

  destroy() {
    this.refundPage.destroy();
    this.clip.destroy();
  }
}

/**
 * AmmoPurchasePanel: in place of the buy panel for a gun already owned, two
 * buttons: "Full Ammo" and "Buy <pack> Ammo".
 */
class AmmoPanel {
  constructor(shop) {
    this.shop = shop;
    this.visible = false;
    this.focus = 1;
    const area = { x: -4, y: 149, width: 393, height: 88 };
    this.g = svg('g', { transform: `translate(${area.x} ${area.y})` });
    this.g.style.display = 'none';
    const half = (area.width - 8) / 2;
    this.buttons = [
      this.makeButton(half + 8, half, area.height, 0, () => shop.buyAmmo(false)), // focus 0: a pack
      this.makeButton(0, half, area.height, 1, () => shop.buyAmmo(true)), // focus 1: full
    ];
    shop.weaponDisplay.el.appendChild(this.g);
  }

  makeButton(x, w, h, index, action) {
    const g = svg('g', { transform: `translate(${x} 0)` });
    const stripes = svg('g');
    const clipID = 'ammoclip' + Math.random().toString(36).slice(2);
    const clip = svg('clipPath', { id: clipID });
    clip.appendChild(svg('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 12 }));
    g.appendChild(clip);
    g.appendChild(svg('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 12, fill: '#242424', 'fill-opacity': 0.96 }));
    stripes.setAttribute('clip-path', `url(#${clipID})`);
    for (let s = -h; s < w + h; s += 25) stripes.appendChild(svg('line', { x1: s, y1: h, x2: s + h, y2: 0, stroke: '#fff', 'stroke-opacity': 0.025, 'stroke-width': 7 }));
    g.appendChild(stripes);
    const border = svg('rect', { x: 1, y: 1, width: w - 2, height: h - 2, rx: 12, fill: 'none', 'stroke-width': 2 });
    const focus = svg('rect', { x: 3.5, y: 3.5, width: w - 7, height: h - 7, rx: 10, fill: 'none', stroke: '#ffd34d', 'stroke-width': 3 });
    const font = { 'text-anchor': 'middle', 'font-family': 'Arial, Helvetica, sans-serif', 'font-weight': 'bold' };
    const caption = svg('text', { ...font, x: w / 2, y: h * 0.13 + 20, 'font-size': 20 });
    const price = svg('text', { ...font, x: w / 2, y: h * 0.53 + 23, 'font-size': 23 });
    g.append(border, focus, caption, price);
    g.style.cursor = 'pointer';
    const button = { g, border, focus, caption, price, index, enabled: false, width: w };
    g.addEventListener('pointerenter', () => {
      if (!button.enabled) return;
      this.focus = index;
      g.setAttribute('opacity', 0.88);
      this.shop.refresh();
    });
    g.addEventListener('pointerleave', () => g.removeAttribute('opacity'));
    g.addEventListener('pointerdown', () => button.enabled && g.setAttribute('opacity', 0.72));
    g.addEventListener('pointerup', () => button.enabled && g.setAttribute('opacity', 0.88));
    g.addEventListener('click', () => button.enabled && action());
    this.g.appendChild(g);
    return button;
  }

  setVisible(on) {
    this.visible = on;
    this.g.style.display = on ? '' : 'none';
  }

  /** Where the keyboard focus starts: "Full Ammo" if the gun is not full, else the first upgrade left. */
  initialFocus() {
    const item = this.shop.weaponSelected?.item;
    const ammo = item?.weapon.ammo;
    if (!ammo) return 1;
    if (ammo.count < ammo.max) return 1;
    const [u1, u2] = item.weapon.upgrades;
    return u1 && !u1.owned ? 2 : u2 && !u2.owned ? 3 : 1;
  }

  update() {
    const item = this.shop.weaponSelected.item;
    const weapon = item.weapon;
    const money = this.shop.state.money;
    const missing = item.missing;
    const pack = item.packSize;
    const cost = weapon.price.ammoCost;
    const texts = [
      ['Buy ' + pack + ' Ammo', missing > 0 ? '$' + pack * cost : 'Ammo Full', missing >= pack && cost >= 0 && money >= pack * cost],
      ['Full Ammo', missing > 0 ? '$' + missing * cost : 'Ammo Full', missing > 0 && cost >= 0 && money >= missing * cost],
    ];
    this.buttons.forEach((b, i) => {
      const [caption, price, enabled] = texts[i];
      b.enabled = enabled && !item.blocked;
      b.caption.textContent = caption;
      b.price.textContent = price;
      const color = b.enabled ? '#ffffff' : '#888888';
      b.caption.setAttribute('fill', color);
      b.price.setAttribute('fill', color);
      b.border.setAttribute('stroke', b.enabled ? '#eeeeee' : '#555555');
      b.focus.style.display = this.focus === b.index ? '' : 'none';
      b.g.style.cursor = b.enabled ? 'pointer' : 'default';
      for (const [t, size] of [
        [b.caption, 20],
        [b.price, 23],
      ]) {
        t.setAttribute('font-size', size);
        let s = size;
        while (s > 10 && t.getComputedTextLength?.() > b.width - 16) t.setAttribute('font-size', --s);
      }
    });
  }

  /** AmmoPurchasePanel.handleKey: Enter buys the focused button; Left/Right move along them. */
  keyDown(event) {
    const shop = this.shop;
    const item = shop.weaponSelected?.item;
    if (!item?.owned || !item.weapon.ammo) return false;
    if (is(event, 'buy')) {
      if (shop.buyReleased) {
        shop.buyReleased = false;
        if (this.focus === 0) shop.buyAmmo(false);
        else if (this.focus === 1) shop.buyAmmo(true);
        else shop.buyUpgrade(this.focus - 1);
      }
      return true;
    }
    if (is(event, 'left') || is(event, 'right')) {
      const [u1, u2] = item.weapon.upgrades;
      const order = [1, 0, ...(u1 && !u1.owned ? [2] : []), ...(u2 && !u2.owned ? [3] : [])];
      const at = Math.max(0, order.indexOf(this.focus));
      const next = order[Math.max(0, Math.min(order.length - 1, at + (is(event, 'right') ? 1 : -1)))];
      if (next !== this.focus) {
        this.focus = next;
        shop.handlers.playSound('ClickShort');
        shop.refresh();
      }
      return true;
    }
    return false;
  }
}

/**
 * RefundPage (the middle tab): guns bought in the last minute, each in a
 * premium bar, with a countdown; clicking one returns it for what was paid.
 */
class RefundPage {
  constructor(shop) {
    this.shop = shop;
    this.rows = [];
    this.selected = -1;
    this.scroll = 0;
    this.held = false;
    const page = (this.page = shop.premiumsPage);
    for (const name of ['mtxField', 'fundButton', 'scrollArea']) {
      const child = page.child(name);
      if (child) child.visible = false;
    }
    // The pane keeps its headers above the first bar; the premium bars go.
    const pane = (this.pane = page.child('scrollPane'));
    if (pane) {
      for (const child of pane.children) if (child.className === 'boxhead.ui.shop.PremiumBar' || child.y >= ROW_TOP) child.visible = false;
      const clipID = 'refundclip' + Math.random().toString(36).slice(2);
      const clip = svg('clipPath', { id: clipID });
      clip.appendChild(svg('rect', { x: 0, y: 0, width: PANE.width, height: PANE.height }));
      pane.el.appendChild(clip);
      pane.el.setAttribute('clip-path', `url(#${clipID})`);
      pane.el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.setScroll(this.scroll + Math.sign(e.deltaY) * WHEEL_STEP);
      });
    }
    this.blurb = page.child('blurbField');
    this.bar = page.child('scrollBar');
    if (this.bar) {
      this.bar.child('upButton')?.on('click', () => this.setScroll(this.scroll - this.maxScroll * 0.1));
      this.bar.child('downButton')?.on('click', () => this.setScroll(this.scroll + this.maxScroll * 0.1));
      const handle = this.bar.child('handle');
      handle?.on('pointerdown', (e) => {
        const startY = e.clientY;
        const start = this.scroll;
        const scale = this.page.el.getScreenCTM()?.d || 1;
        const track = (this.bar.child('background')?.height || 260) - (handle.height || 30);
        const move = (ev) => this.setScroll(start + ((ev.clientY - startY) / scale / Math.max(1, track)) * this.maxScroll);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    this.timer = null;
  }

  get maxScroll() {
    return Math.max(0, ROW_TOP + this.rows.length * ROW_STEP - PANE.height);
  }

  reset() {
    this.clearRows();
    this.scroll = 0;
  }

  show(on) {
    this.page.visible = on;
    clearInterval(this.timer);
    this.timer = null;
    if (!on) return;
    this.rebuild();
    this.timer = setInterval(() => this.refresh(), REFUND_TICK);
  }

  clearRows() {
    for (const row of this.rows) row.view.destroy();
    this.rows = [];
  }

  /** RefundPage.rebuild: a bar per gun that can still be returned. */
  rebuild() {
    this.clearRows();
    const lib = this.shop.lib;
    const list = this.shop.state.refundable(this.shop.handlers.now());
    for (const entry of list) {
      const view = lib.create('boxhead.ui.shop.PremiumBar');
      view.gotoAndStop('NotOwned');
      view.x = 3;
      view.y = ROW_TOP + this.rows.length * ROW_STEP;
      view.child('nameField').text = entry.item.weapon.name;
      const icon = view.child('icon');
      if (icon) {
        const box = icon.bounds;
        icon.visible = false;
        const portrait = lib.create('boxhead.ui.WeaponPortraits');
        portrait.gotoAndStop(entry.item.id + 1);
        const b = portrait.bounds || [0, 0, 1, 1];
        const k = Math.min((box[2] - box[0] - 8) / Math.max(1, b[2] - b[0]), (box[3] - box[1] - 8) / Math.max(1, b[3] - b[1]));
        portrait.scaleX = k;
        portrait.scaleY = k;
        portrait.x = box[0] + (box[2] - box[0] - (b[2] - b[0]) * k) / 2 - b[0] * k;
        portrait.y = box[1] + (box[3] - box[1] - (b[3] - b[1]) * k) / 2 - b[1] * k;
        view.addChild(portrait);
      }
      const row = { id: entry.item.id, view };
      view.el.style.cursor = 'pointer';
      view.on('click', () => this.refund(row));
      view.on('pointerenter', () => {
        this.selected = this.rows.indexOf(row);
        this.refresh();
      });
      this.pane.addChild(view);
      this.rows.push(row);
    }
    this.selected = this.rows.length ? Math.max(0, Math.min(this.selected, this.rows.length - 1)) : -1;
    if (this.blurb) {
      this.blurb.text = this.rows.length
        ? 'Refund guns within 1 minute of purchase.\nIncludes paid upgrades. Ammo is not refunded.\nClick a gun below to refund it.'
        : 'No purchased guns to refund.\nBuy a gun in Weapons to start its 1-minute timer.\nIncludes paid upgrades. Ammo is not refunded.';
    }
    this.setScroll(this.scroll);
    this.refresh();
  }

  /** Every 200 ms: the time left on each gun. */
  refresh() {
    const now = this.shop.handlers.now();
    const live = new Map(this.shop.state.refundable(now).map((r) => [r.item.id, r]));
    this.rows.forEach((row, i) => {
      const entry = live.get(row.id);
      const secs = entry ? entry.seconds : 0;
      const view = row.view;
      view.child('descriptionField').text = secs > 0 ? 'Return weapon + paid upgrades\nRefund expires in ' + (secs >= 60 ? '1:00' : '0:' + String(secs).padStart(2, '0')) : 'Refund expired\n0:00 remaining';
      view.child('costField').text = secs > 0 ? 'Refund $' + entry.amount : 'Refund unavailable';
      view.alpha = secs > 0 ? 1 : 0.5;
      view.child('selectionOverlay').visible = i === this.selected && secs > 0;
    });
    this.shop.moneyField.text = 'Your Cash: $' + this.shop.state.money;
  }

  setScroll(y) {
    this.scroll = Math.max(0, Math.min(this.maxScroll, y));
    if (this.pane) this.pane.content.setAttribute('transform', `translate(0 ${-this.scroll})`);
    if (this.bar) {
      this.bar.visible = this.maxScroll > 0;
      const handle = this.bar.child('handle');
      const bg = this.bar.child('background');
      if (handle && bg) {
        const value = this.maxScroll ? this.scroll / this.maxScroll : 0;
        handle.y = bg.y + Math.round(value * (bg.height - handle.height));
      }
    }
  }

  refund(row) {
    const result = this.shop.state.refund(row.id, this.shop.handlers.now());
    if (result.ok) {
      this.shop.handlers.purchased(result);
      this.shop.handlers.playSound('ClickLong');
      this.rebuild();
      this.shop.refresh();
    }
  }

  /** RefundPage.keyDown: Q/E or Left/Right change tab, Up/Down choose, Enter returns the gun. */
  keyDown(event) {
    const shop = this.shop;
    if (is(event, 'left') || is(event, 'prevTab')) shop.showTab('weapons', true);
    else if (is(event, 'right') || is(event, 'nextTab')) shop.showTab('equipment', true);
    else if ((is(event, 'up') || is(event, 'down')) && this.rows.length) {
      const step = is(event, 'up') ? -1 : 1;
      this.selected = (this.selected + step + this.rows.length) % this.rows.length;
      const top = ROW_TOP + this.selected * ROW_STEP;
      if (top < this.scroll) this.setScroll(top - ROW_TOP);
      else if (top + ROW_STEP > this.scroll + PANE.height) this.setScroll(top + ROW_STEP - PANE.height);
      shop.handlers.playSound('ClickShort');
      this.refresh();
    } else if (is(event, 'buy') && !this.held && this.selected >= 0) {
      this.held = true;
      this.refund(this.rows[this.selected]);
    }
    return true;
  }

  destroy() {
    clearInterval(this.timer);
    this.clearRows();
  }
}
