// Key bindings (boxhead.ui.Input): every action has a primary and a
// secondary key, both changeable on the Controls screen and saved in the
// browser. Keys are the browser's keyCode numbers, which are the same as
// Flash's. Also tracks which keys are down, for "held" and "new press".

export const NO_KEY = 258; // Input.NO_KEYCODE
const KEYS_VERSION = 6; // Input.KEYS_VERSION: older saved bindings are ignored (5 is updated, see loadBindings)
const STORAGE_KEY = 'bbh.keys';

/** The configurable actions, in Input's order (the Controls screen's rows). */
export const ACTIONS = [
  'up',
  'down',
  'left',
  'right',
  'strafe',
  'autoRun',
  'spin',
  'fire',
  'weaponUp',
  'weaponDown',
  'weapon1',
  'weapon2',
  'weapon3',
  'weapon4',
  'weapon5',
  'weapon6',
  'weapon7',
  'weapon8',
  'shop',
  'refill',
  'scores',
];
const index = Object.fromEntries(ACTIONS.map((a, i) => [a, i]));

/** Input.defaults: [primary, secondary] per action. */
const DEFAULTS = {
  up: [38, 87], // Up, W
  down: [40, 83], // Down, S
  left: [37, 65], // Left, A
  right: [39, 68], // Right, D
  strafe: [16, 75], // Shift, K
  autoRun: [17, 73], // Control, I
  spin: [67, 76], // C, L
  fire: [32, 74], // Space, J
  // The original had E for the next weapon and Q for the previous; this edition swaps them.
  weaponUp: [81, NO_KEY], // Q: next weapon
  weaponDown: [69, NO_KEY], // E: previous weapon
  weapon1: [49, NO_KEY],
  weapon2: [50, NO_KEY],
  weapon3: [51, NO_KEY],
  weapon4: [52, NO_KEY],
  weapon5: [53, NO_KEY],
  weapon6: [54, NO_KEY],
  weapon7: [55, NO_KEY],
  weapon8: [56, NO_KEY],
  shop: [66, 78], // B, N
  refill: [82, 46], // R, Delete
  scores: [9, NO_KEY], // Tab
};

let binds = []; // index * 2 (+1 for the secondary key) -> keyCode

/** Input.defaults. */
export function defaultBindings() {
  binds = [];
  for (const action of ACTIONS) binds.push(...DEFAULTS[action]);
}
defaultBindings();

export function getBind(action, primary = true) {
  return binds[index[action] * 2 + (primary ? 0 : 1)];
}

export function setBind(action, primary, keyCode) {
  binds[index[action] * 2 + (primary ? 0 : 1)] = keyCode;
}

/** Is `keyCode` one of the action's keys? */
export function isKey(action, keyCode) {
  const i = index[action] * 2;
  return keyCode !== NO_KEY && (binds[i] === keyCode || binds[i + 1] === keyCode);
}

/** Input.load: saved bindings from this version of the key list. */
export function loadBindings(storage = globalThis.localStorage) {
  defaultBindings();
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (!saved || saved.version < KEYS_VERSION - 1 || !Array.isArray(saved.bindings)) return;
    saved.bindings.forEach((code, i) => {
      if (i < binds.length && Number.isInteger(code)) binds[i] = code;
    });
    // Version 5 had E next and Q previous: swap them unless the player had changed them.
    const up = index.weaponUp * 2;
    const down = index.weaponDown * 2;
    if (saved.version === KEYS_VERSION - 1 && binds[up] === 69 && binds[down] === 81) [binds[up], binds[down]] = [81, 69];
  } catch {
    // unreadable storage: keep the defaults
  }
}

/** Input.save. */
export function saveBindings(storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: KEYS_VERSION, bindings: binds }));
  } catch {
    // storage unavailable
  }
}

// Input.getCharString.
const NAMES = {
  [NO_KEY]: '',
  257: 'Mouse Button',
  27: 'Esc',
  19: 'Pause',
  145: 'Scroll Lock',
  192: '`',
  189: '-',
  187: '=',
  8: 'Backspace',
  9: 'Tab',
  20: 'Caps Lock',
  16: 'Shift',
  17: 'Control',
  32: 'Space',
  13: 'Enter',
  220: '\\',
  37: 'Left',
  39: 'Right',
  38: 'Up',
  40: 'Down',
  45: 'Insert',
  46: 'Del',
  36: 'Home',
  35: 'End',
  33: 'Page Up',
  34: 'Page Down',
  144: 'Num Lock',
  96: 'Numpad Ins',
  106: 'Numpad *',
  107: 'Numpad +',
  109: 'Numpad -',
  110: 'Numpad Del',
  111: 'Numpad /',
  219: '[',
  221: ']',
  186: ';',
  222: "'",
  188: '<',
  190: '>',
  191: '/',
};
for (let c = 65; c <= 90; c++) NAMES[c] = String.fromCharCode(c);
for (let c = 48; c <= 57; c++) NAMES[c] = String(c - 48);
for (let c = 97; c <= 105; c++) NAMES[c] = 'Numpad ' + (c - 96);
for (let f = 1; f <= 12; f++) if (f !== 10) NAMES[111 + f] = 'F' + f;

export function keyName(keyCode) {
  return NAMES[keyCode] ?? '';
}

/** Keys that can't be bound (KeyEntry.keyDown): `, Esc and Enter. */
export const UNBINDABLE = [192, 27, 13];

/**
 * Which keys are held, from the page's key events (Input.keyDown / keyUp),
 * and "new press" per game tick (Input.newPress / update).
 */
export class KeyState {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set(); // went down since the last tick
    this.target = target;
    this.onDown = (event) => {
      if (event.repeat) return;
      this.down.add(event.keyCode);
      this.pressed.add(event.keyCode);
    };
    this.onUp = (event) => this.down.delete(event.keyCode);
    this.onBlur = () => this.down.clear();
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(action) {
    return this.down.has(getBind(action, true)) || this.down.has(getBind(action, false));
  }

  newPress(action) {
    return this.pressed.has(getBind(action, true)) || this.pressed.has(getBind(action, false));
  }

  /** Input.update, at the end of a tick. */
  endTick() {
    this.pressed.clear();
  }

  reset() {
    this.down.clear();
    this.pressed.clear();
  }

  destroy() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
