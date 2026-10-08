// The original art drawn over the game: the weapon slider at the top left
// (boxhead.ui.weaponSlider.WeaponSlider), the "Shop" button under it
// (OpenShopButton), the shop itself and the Esc menu (IngameMenuScreen with
// its options and "are you sure?" screens). A transparent Flash stage laid
// over the game canvas.

import { scoreOrder } from '../game/bounty.js';
import { Stage } from './flash.js';
import { createControlsScreen, createWeaponBanksScreen } from './configScreens.js';
import { createOptionsScreen } from './menus.js';
import { ShopScreen } from './shop.js';

const SPACING = 50; // WeaponSliderDisplay.SPACING
const DISABLED_ALPHA = 0.4;
const EXPAND_TIME = 5000;
const GLOW = [{ type: 'glow', color: [0xb0, 0xb0, 0x40, 255], blurX: 6, blurY: 6, strength: 4, passes: 1 }];
const AMMO_TICK = 'assets/game/images/WeaponSliderDisplay_AMMO_TICK.png';
const TICK_WIDTH = 2;
const TICK_HEIGHT = 5;

export class GameUi {
  /**
   * handlers: selectWeapon(weapon), openShop(), quit() (leave the game),
   * preferencesChanged(), and the ShopScreen handlers.
   */
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
    this.shop = shopState ? new ShopScreen(lib, shopState, handlers) : null;
    this.shopOpen = false;
    this.menu = null; // the Esc menu while it is open
    this.screens = []; // the menu and the screens opened from it, the last one showing
    this.setHudVisible(false);
  }

  get menuOpen() {
    return !!this.menu;
  }

  /** Main.toggleIngameMenu (Esc). */
  toggleMenu() {
    if (this.menu) this.closeMenu();
    else this.openMenu();
  }

  /** IngameMenuScreen: options, quit, close. The game carries on behind it. */
  openMenu() {
    if (this.menu) return;
    const menu = (this.menu = this.lib.create('boxhead.ui.screen.IngameMenuScreen'));
    const actions = {
      optionsButton: ['options', () => this.showOptions()],
      quitButton: ['quit', () => this.confirmQuit()],
      closeButton: ['close', () => this.closeMenu()],
    };
    for (const [name, [text, action]] of Object.entries(actions)) {
      const button = menu.child(name);
      if (!button) continue;
      button.text = text;
      button.onClick(action);
    }
    this.stage.addChild(menu);
    this.screens = [menu];
  }

  get menuScreen() {
    return this.screens[this.screens.length - 1] || null;
  }

  closeMenu() {
    if (!this.menu) return;
    for (const screen of this.screens) {
      this.stage.removeChild(screen);
      screen.destroy();
    }
    this.menu = null;
    this.screens = [];
  }

  /** Screen.showSubscreen: the screen below hides while the subscreen is up. */
  showSubscreen(screen) {
    this.menuScreen.visible = false;
    this.screens.push(this.stage.addChild(screen));
  }

  /** Screen.subscreenClose: back to the screen below. */
  closeSubscreen() {
    if (this.screens.length < 2) return;
    const screen = this.screens.pop();
    this.stage.removeChild(screen);
    screen.destroy();
    this.menuScreen.visible = true;
  }

  showOptions() {
    this.showSubscreen(
      createOptionsScreen(this.lib, {
        changed: () => this.handlers.preferencesChanged(),
        close: () => this.closeSubscreen(),
        controls: () => this.showSubscreen(createControlsScreen(this.lib, { close: () => this.closeSubscreen() })),
        weapons: () =>
          this.showSubscreen(
            createWeaponBanksScreen(this.lib, {
              close: () => this.closeSubscreen(),
              changed: () => this.handlers.banksChanged?.(),
            }),
          ),
      }),
    );
  }

  /** ConfirmQuitScreen: "quit" leaves the game, "cancel" goes back. */
  confirmQuit() {
    const screen = this.lib.create('boxhead.ui.screen.ConfirmQuitScreen');
    const quit = screen.child('quitButton');
    quit.text = 'quit';
    quit.onClick(() => {
      this.closeMenu();
      this.handlers.quit();
    });
    const cancel = screen.child('closeButton');
    cancel.text = 'cancel';
    cancel.onClick(() => this.closeSubscreen());
    this.showSubscreen(screen);
  }

  /** ShopGame.guiShouldBeVisible: the slider and the shop button hide while shopping. */
  setHudVisible(on) {
    this.slider.clip.visible = on;
    this.shopButton.visible = on;
  }

  openShop() {
    if (this.shopOpen || !this.shop) return;
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

  // --- scores (boxhead.ui.score) ----------------------------------------------------

  /**
   * BountyScoreBoard while the scores key is held: everyone by score.
   * players: [{ name, stats, wanted }] (null hides it).
   */
  showScoreboard(players) {
    if (!players) {
      if (this.scoreboard) this.scoreboard.visible = false;
      return;
    }
    if (!this.scoreboard) this.scoreboard = this.stage.addChild(this.lib.create('boxhead.ui.score.BountyScoreBoard'));
    this.scoreboard.visible = true;
    fillEntries(this.scoreboard, players);
  }

  /**
   * GameSummary at the end of a round: the standings, the five awards with
   * each winner's picture, and the countdown to the next round.
   * awards: from roundAwards(); portrait(player) gives a picture canvas.
   */
  showSummary(players, awards, portrait) {
    this.summary?.destroy();
    const summary = (this.summary = this.stage.addChild(this.lib.create('boxhead.ui.score.GameSummary')));
    this.showScoreboard(null);
    summary.child('nextGameField').text = '';
    fillEntries(summary, players);
    const names = ['winnerAwardEntry', 'hunterAwardEntry', 'dominatorAwardEntry', 'scroogeAwardEntry', 'targetDummyAwardEntry'];
    awards.forEach((award, i) => {
      const entry = summary.child(names[i]);
      if (!entry) return;
      const title = entry.child('awardField');
      title.text = award.title;
      title.box.style.textDecoration = 'underline';
      title.textColor = award.color;
      if (i === 0) {
        // AwardEntry.largeTextMode
        title.scaleX += 0.15;
        title.scaleY += 0.15;
        title.y -= 3;
      }
      entry.child('bonusField').text = '$' + award.bonus;
      entry.child('scoreField').text = award.player ? award.caption : '';
      entry.child('nameField').text = award.player ? award.player.name : '';
      const box = entry.child('characterBox');
      if (award.unknown) box?.unknown?.();
      else if (award.player) box?.drawCharacter?.(portrait(award.player));
      else box?.clear?.();
    });
  }

  setSummaryCountdown(seconds) {
    const field = this.summary?.child('nextGameField');
    if (field) field.text = 'Next Game begins in ' + Math.max(0, seconds) + ' seconds...';
  }

  destroy() {
    this.closeMenu();
    this.shop?.destroy();
    this.stage.clear();
    this.root.replaceChildren();
    this.root.hidden = true;
  }
}

const WANTED_COLOR = 0xd72b2b; // MMOchaUser.WANTED_COLOR

/** ScoreBoardEntry.update for the 16 rows of a board ("entry0".."entry15"). */
function fillEntries(board, players) {
  const ranked = scoreOrder(players);
  for (let i = 0; i < 16; i++) {
    const entry = board.child('entry' + i);
    if (!entry) continue;
    const p = ranked[i];
    const name = entry.child('nameField');
    name.text = p ? `${i + 1}) ${p.name}` : '';
    name.textColor = p?.wanted ? WANTED_COLOR : 0xffffff;
    entry.child('killsField').text = p ? String(p.stats.kills) : '';
    entry.child('deathsField').text = p ? String(p.stats.deaths) : '';
    entry.child('scoreField').text = p ? '$' + p.stats.score : '';
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
      // The tick art is one tick and its gap, repeated across the bar (a bitmap fill).
      const SVGNS = 'http://www.w3.org/2000/svg';
      const id = 'ammoTicks' + Math.random().toString(36).slice(2);
      d.tickPattern = document.createElementNS(SVGNS, 'pattern');
      d.tickPattern.id = id;
      d.tickPattern.setAttribute('patternUnits', 'userSpaceOnUse');
      d.tickPattern.setAttribute('width', TICK_WIDTH);
      d.tickPattern.setAttribute('height', TICK_HEIGHT);
      const tick = document.createElementNS(SVGNS, 'image');
      tick.setAttribute('href', AMMO_TICK);
      tick.setAttribute('width', TICK_WIDTH);
      tick.setAttribute('height', TICK_HEIGHT);
      tick.style.imageRendering = 'pixelated';
      d.tickPattern.appendChild(tick);
      d.ticks = document.createElementNS(SVGNS, 'rect');
      d.ticks.setAttribute('fill', `url(#${id})`);
      d.ticks.setAttribute('height', TICK_HEIGHT);
      d.el.append(d.tickPattern, d.ticks);
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
    const right = field.x + (field.def.bounds[0] + 4 + field.textWidth);
    const end = SPACING / 2 - 1;
    let start = Math.ceil(right / 4) * 4;
    let n = Math.max(0, Math.floor((end - start) / TICK_WIDTH));
    start = end - n * TICK_WIDTH;
    if (w.ammo) n = Math.round((n * w.ammo.count) / w.ammo.max);
    const y = Math.trunc(field.y + 4);
    d.tickPattern.setAttribute('x', start);
    d.tickPattern.setAttribute('y', y);
    d.ticks.setAttribute('x', start);
    d.ticks.setAttribute('y', y);
    d.ticks.setAttribute('width', Math.max(0, n * TICK_WIDTH));
  }
}
