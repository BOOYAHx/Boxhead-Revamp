// The original art drawn over the game: the weapon slider at the top left
// (boxhead.ui.weaponSlider.WeaponSlider), the "Shop" button under it
// (OpenShopButton) and the shop itself. A transparent Flash stage laid over
// the game canvas.

import { Stage } from './flash.js';
import { ShopScreen } from './shop.js';

const SPACING = 50; // WeaponSliderDisplay.SPACING
const DISABLED_ALPHA = 0.4;
const EXPAND_TIME = 5000;
const GLOW = [{ type: 'glow', color: [0xb0, 0xb0, 0x40, 255], blurX: 6, blurY: 6, strength: 4, passes: 1 }];
const AMMO_TICK = 'assets/game/images/WeaponSliderDisplay_AMMO_TICK.png';
const TICK_WIDTH = 2;

export class GameUi {
  /** handlers: selectWeapon(weapon), openShop(), and the ShopScreen handlers. */
  constructor(root, lib, shopState, handlers) {
    this.root = root;
    this.lib = lib;
    this.handlers = handlers;
    root.replaceChildren();
    root.hidden = false;
    const frame = document.createElement('div');
    frame.className = 'flash-stage';
    root.appendChild(frame);
    this.stage = new Stage(frame);
    this.slider = new WeaponSlider(lib, (weapon) => handlers.selectWeapon(weapon));
    this.stage.addChild(this.slider.clip);
    this.shopButton = lib.create('boxhead.ui.OpenShopButton');
    this.shopButton.y = 62;
    this.shopButton.on('click', () => {
      handlers.playSound('ClickShort');
      handlers.openShop();
    });
    this.stage.addChild(this.shopButton);
    this.shop = new ShopScreen(lib, shopState, handlers);
    this.shopOpen = false;
    this.setHudVisible(false);
  }

  /** ShopGame.guiShouldBeVisible: the slider and the shop button hide while shopping. */
  setHudVisible(on) {
    this.slider.clip.visible = on;
    this.shopButton.visible = on;
  }

  openShop() {
    if (this.shopOpen) return;
    this.shopOpen = true;
    this.stage.addChild(this.shop.clip);
    this.shop.refresh();
    this.setHudVisible(false);
  }

  closeShop() {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.shop.closed();
    this.stage.removeChild(this.shop.clip);
    this.setHudVisible(true);
  }

  destroy() {
    this.shop.destroy();
    this.stage.clear();
    this.root.replaceChildren();
    this.root.hidden = true;
  }
}

/** WeaponSlider: a numbered tab per bank; the open bank shows its weapons with their ammo. */
class WeaponSlider {
  constructor(lib, select) {
    this.lib = lib;
    this.select = select;
    this.clip = lib.create('boxhead.ui.weaponSlider.WeaponSliderPiece'); // only a holder; its art is hidden
    for (const child of this.clip.children) child.visible = false;
    this.open = lib.create('boxhead.ui.weaponSlider.WeaponSliderPiece');
    this.open.gotoAndStop('Mid');
    this.open.child('textField').visible = false;
    this.clip.addChild(this.open);
    this.pieces = {};
    this.displays = [0, 1, 2].map(() => {
      const d = lib.create('boxhead.ui.weaponSlider.WeaponSliderDisplay');
      d.el.style.cursor = 'pointer';
      d.on('click', () => d.weapon && this.select(d.weapon));
      d.ticks = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      d.ticks.setAttribute('href', AMMO_TICK);
      d.el.appendChild(d.ticks);
      d.visible = false;
      this.clip.addChild(d);
      return d;
    });
    this.banks = null;
    this.current = null;
    this.currentBank = 1;
    this.expanded = false;
    this.expandedUntil = 0;
  }

  /** updateWeaponList: a tab for every bank with weapons. */
  setBanks(banks) {
    this.banks = banks;
    for (let n = 1; n <= 8; n++) {
      if (!banks[n]?.length || this.pieces[n]) continue;
      const piece = this.lib.create('boxhead.ui.weaponSlider.WeaponSliderPiece');
      piece.child('textField').text = String(n);
      piece.el.style.cursor = 'pointer';
      piece.on('click', () => {
        this.expanded = true;
        this.expandedUntil = performance.now() + EXPAND_TIME;
        this.currentBank = n;
        this.arrange();
      });
      this.clip.el.insertBefore(piece.el, this.clip.el.firstChild);
      this.clip.children.push(piece);
      this.pieces[n] = piece;
    }
    for (const [n, piece] of Object.entries(this.pieces)) piece.visible = !!banks[n]?.length;
    this.arrange();
  }

  /** update: open the bank of a newly selected weapon for 5 s; close it after. */
  update(weapon, force = false) {
    if (!this.banks || !weapon) return;
    const now = performance.now();
    if (weapon !== this.current) {
      this.current = weapon;
      this.expanded = true;
      this.expandedUntil = now + EXPAND_TIME;
      this.currentBank = weapon.bank;
      this.arrange();
    } else if (this.expanded && !weapon.firedRecently && now > this.expandedUntil) {
      this.expanded = false;
      this.currentBank = weapon.bank;
      this.arrange();
    } else {
      for (const d of this.displays) if (d.visible) this.showAmmo(d, force);
    }
  }

  arrange() {
    if (!this.banks || !this.current) return;
    let x = 0;
    let last = null;
    for (let n = 1; n <= 8; n++) {
      const piece = this.pieces[n];
      if (!piece || !this.banks[n]?.length) continue;
      if (n === this.currentBank) {
        this.open.x = x;
        const width = (this.expanded ? this.banks[n].length : 1) * SPACING;
        this.open.scaleX = width / Math.max(1, this.open.localBounds()?.[2] - this.open.localBounds()?.[0] || 1);
        x += width;
      }
      piece.x = x;
      piece.gotoAndStop('Bank');
      x += Math.round(piece.width);
      const usable = this.banks[n].some((w) => w.available);
      piece.child('textField').alpha = usable ? 1 : DISABLED_ALPHA;
      piece.el.style.pointerEvents = usable ? '' : 'none';
      last = piece;
    }
    last?.gotoAndStop('End');
    const bank = this.banks[this.currentBank] || [];
    const shown = this.expanded ? bank.map((w, i) => [w, bank.length - i]) : [[this.current, 1]];
    this.displays.forEach((d, i) => {
      const entry = shown[i];
      d.visible = !!entry;
      if (!entry) return;
      const [weapon, slot] = entry;
      d.x = this.open.x + (slot - 0.5) * SPACING;
      d.weapon = weapon;
      d.child('portrait').gotoAndStop(weapon.id + 1);
      d.child('nameField').text = weapon.shortName;
      d.child('portrait').el.setAttribute('filter', weapon === this.current ? `url(#${this.lib.filter(null, GLOW)})` : '');
      d.previousAmmo = -1;
      this.showAmmo(d, true);
    });
  }

  /** WeaponSliderDisplay.update: the count (or INF) and a row of ammo ticks. */
  showAmmo(d, force) {
    const w = d.weapon;
    const count = w.ammo ? w.ammo.count : 0;
    if (count === d.previousAmmo && !force) return;
    d.previousAmmo = count;
    const field = d.child('ammoField');
    const name = d.child('nameField');
    const alpha = w.ammo && count === 0 ? DISABLED_ALPHA : 1;
    field.alpha = alpha;
    name.alpha = alpha;
    field.text = w.ammo ? String(count) : 'INF';
    const right = field.x + (field.def.bounds[0] + 4 + field.box.scrollWidth);
    const end = SPACING / 2 - 1;
    let start = Math.ceil(right / 4) * 4;
    let n = Math.max(0, Math.floor((end - start) / TICK_WIDTH));
    start = end - n * TICK_WIDTH;
    if (w.ammo) n = Math.round((n * w.ammo.count) / w.ammo.max);
    d.ticks.setAttribute('x', start);
    d.ticks.setAttribute('y', Math.trunc(field.y + 4));
    d.ticks.setAttribute('width', Math.max(0, n * TICK_WIDTH));
    d.ticks.setAttribute('height', 6);
    d.ticks.setAttribute('preserveAspectRatio', 'none');
  }
}
