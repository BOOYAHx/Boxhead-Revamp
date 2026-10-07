// The Options screen's two sub-screens, rebuilt from the original art:
// ControlsScreen (two keys per action, click one then press a key) and
// WeaponBanksScreen (drag weapons between the eight banks).

import { ACTIONS, NO_KEY, UNBINDABLE, defaultBindings, getBind, keyName, saveBindings, setBind } from '../game/controls.js';
import { NUM_WEAPONS, defaultBanks, saveBanks, setBankLayout, weaponBank, weaponBankPriority, weaponStatsFor } from '../game/weapons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SPACING = 14; // rows, both screens
const PANE = { width: 250, height: 295 }; // ControlsScreen.paneRect
const MAX_BANK = 3; // the weapon slider shows at most three weapons of a bank

function clip(target, width, height) {
  const id = 'cfgclip' + Math.random().toString(36).slice(2);
  const path = document.createElementNS(SVGNS, 'clipPath');
  path.setAttribute('id', id);
  const rect = document.createElementNS(SVGNS, 'rect');
  rect.setAttribute('width', width);
  rect.setAttribute('height', height);
  path.appendChild(rect);
  target.el.appendChild(path);
  target.el.setAttribute('clip-path', `url(#${id})`);
}

function setupButtons(screen, { reset, close }) {
  const r = screen.child('resetButton');
  r.text = 'reset';
  r.align('left');
  r.onClick(reset);
  const c = screen.child('closeButton');
  c.text = 'close';
  c.align('right');
  c.onClick(close);
}

/** ControlsScreen. close(): back to the options (the keys are saved). */
export function createControlsScreen(lib, { close }) {
  const screen = lib.create('boxhead.ui.screen.ControlsScreen');
  const pane = screen.child('scrollPane');
  const bar = screen.child('scrollBar');
  const entries = [];
  let waiting = null; // the entry waiting for a key
  let swallowUp = null; // the key just bound: its key-up must not reach the game

  const show = (entry) => (entry.field.text = keyName(getBind(entry.action, entry.primary)));
  const stopWaiting = () => {
    if (!waiting) return;
    show(waiting);
    waiting = null;
  };
  // KeyEntry.keyDown: the next key pressed (except `, Esc and Enter) becomes the bind;
  // the same key is taken off any other action (ControlsScreen.keyChange).
  const onKey = (event) => {
    if (!waiting) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    swallowUp = event.keyCode;
    const entry = waiting;
    waiting = null;
    if (!UNBINDABLE.includes(event.keyCode)) {
      setBind(entry.action, entry.primary, event.keyCode);
      for (const other of entries) {
        if (other !== entry && getBind(other.action, other.primary) === event.keyCode) {
          setBind(other.action, other.primary, NO_KEY);
          show(other);
        }
      }
    }
    show(entry);
  };
  const onKeyUp = (event) => {
    if (event.keyCode !== swallowUp) return;
    swallowUp = null;
    event.stopImmediatePropagation();
  };
  const onPointer = (event) => {
    if (waiting && !waiting.el.contains(event.target)) stopWaiting(); // KeyEntry.loseFocus
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPointer, true);

  // Rows: movement (up to spin), then fire to bank 8, then shop to scores; a column per key.
  // The art labels the row after Fire "Previous Weapon", but the original put
  // the next-weapon key (E) there; the two are swapped so the labels are right.
  const rows = (from, to) => ACTIONS.slice(ACTIONS.indexOf(from), ACTIONS.indexOf(to) + 1);
  const weaponRows = rows('fire', 'weapon8');
  weaponRows.splice(1, 2, 'weaponDown', 'weaponUp');
  const groups = [
    [rows('up', 'spin'), 0],
    [weaponRows, 103],
    [rows('shop', 'scores'), 261],
  ];
  for (const primary of [true, false]) {
    for (const [actions, top] of groups) {
      for (const [row, action] of actions.entries()) {
        const entry = lib.create('boxhead.ui.KeyEntry');
        entry.x = primary ? 100 : 165;
        entry.y = top + row * SPACING;
        entry.action = action;
        entry.primary = primary;
        entry.field = entry.child('textField');
        entry.field.mouseEnabled = false;
        entry.el.style.cursor = 'pointer';
        entry.on('click', () => {
          stopWaiting();
          waiting = entry;
          entry.field.text = '<Press Key>';
        });
        show(entry);
        pane.addChild(entry);
        entries.push(entry);
      }
    }
  }

  // The pane scrolls inside a 250 x 295 window.
  clip(pane, PANE.width, PANE.height);
  const contentHeight = Math.max(PANE.height + 1, pane.height);
  let scroll = 0;
  const scrollTo = (y) => {
    scroll = Math.max(0, Math.min(contentHeight - PANE.height, y));
    pane.content.setAttribute('transform', `translate(0 ${-scroll})`);
    if (bar) bar.scrollValue = scroll / Math.max(1, contentHeight - PANE.height);
  };
  if (bar) {
    bar.handleSize = (PANE.height - 20) / contentHeight;
    bar.el.addEventListener('scrolldrag', (e) => scrollTo(e.detail * (contentHeight - PANE.height)));
    bar.el.addEventListener('stepup', () => scrollTo(scroll - SPACING));
    bar.el.addEventListener('stepdown', () => scrollTo(scroll + SPACING));
  }
  pane.el.addEventListener('wheel', (e) => {
    e.preventDefault();
    scrollTo(scroll + Math.sign(e.deltaY) * SPACING);
  });
  scrollTo(0);

  setupButtons(screen, {
    reset: () => {
      stopWaiting();
      defaultBindings();
      entries.forEach(show);
    },
    close: () => {
      saveBindings();
      close();
    },
  });
  const destroy = screen.destroy.bind(screen);
  screen.destroy = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointerdown', onPointer, true);
    destroy();
  };
  return screen;
}

/** WeaponBanksScreen. close(): back to the options; changed() once the new banks are saved. */
export function createWeaponBanksScreen(lib, { close, changed = () => {} }) {
  const screen = lib.create('boxhead.ui.screen.WeaponBanksScreen');
  const areas = [null];
  for (let n = 1; n <= 8; n++) areas.push(screen.child('area' + n));
  const banks = Array.from({ length: 9 }, () => []);
  const entries = [];
  for (let id = 0; id < NUM_WEAPONS; id++) {
    const entry = lib.create('boxhead.ui.WeaponEntry');
    entry.weaponID = id;
    const field = entry.child('textField');
    field.text = weaponStatsFor(id).shortName;
    field.mouseEnabled = false;
    entry.el.style.cursor = 'grab';
    screen.addChild(entry);
    entries.push(entry);
  }
  const arrangeBank = (n) =>
    banks[n].forEach((entry, i) => {
      entry.x = areas[n].x;
      entry.y = areas[n].y + i * SPACING;
    });
  /** WeaponBanksScreen.arrange: each bank in priority order. */
  const arrange = () => {
    for (const bank of banks) bank.length = 0;
    const sorted = [...entries].sort((a, b) => weaponBankPriority(a.weaponID) - weaponBankPriority(b.weaponID));
    for (const entry of sorted) banks[weaponBank(entry.weaponID)].push(entry);
    for (let n = 1; n <= 8; n++) arrangeBank(n);
  };
  arrange();
  const bankOf = (entry) => banks.findIndex((b) => b.includes(entry));

  // Drag and drop (pickupEntry / moveEntry / dropEntry): a bank takes at most three weapons.
  for (const entry of entries) {
    entry.on('pointerdown', (event) => {
      event.preventDefault();
      entry.alpha = 0.5;
      screen.el.appendChild(entry.el); // on top
      const move = (e) => {
        const p = screen.localPoint(e);
        entry.x = p.x - entry.width / 2;
        entry.y = p.y - entry.height / 2;
      };
      const drop = (e) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', drop);
        entry.alpha = 1;
        const p = screen.localPoint(e);
        const target = areas.findIndex((a) => a && a.bounds && p.x >= a.bounds[0] && p.x <= a.bounds[2] && p.y >= a.bounds[1] && p.y <= a.bounds[3]);
        const from = bankOf(entry);
        if (target > 0 && banks[target].length < MAX_BANK) {
          banks[from].splice(banks[from].indexOf(entry), 1);
          const at = banks[target].findIndex((other) => p.y < other.y + SPACING / 2);
          banks[target].splice(at < 0 ? banks[target].length : at, 0, entry);
          arrangeBank(from);
          if (target !== from) arrangeBank(target);
        } else arrangeBank(from); // back where it was
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', drop);
    });
  }

  setupButtons(screen, {
    reset: () => {
      defaultBanks();
      arrange();
    },
    close: () => {
      // bake: the order on screen becomes each weapon's bank and place.
      setBankLayout(banks.map((bank) => bank.map((entry) => entry.weaponID)));
      saveBanks();
      changed();
      close();
    },
  });
  return screen;
}
