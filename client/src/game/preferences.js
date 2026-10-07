// Player options (boxhead.options.Preferences), kept in the browser's
// localStorage like the original kept them in a Flash cookie.

export const FOOTSTEPS = Object.freeze({ OFF: 'Off', PLAYER: 'Player Only', ON: 'On' });
const KEY = 'bbh.preferences';

const DEFAULTS = Object.freeze({
  volume: 0.7,
  shadows: true,
  blood: true,
  shells: true,
  smoke: true,
  shake: true,
  showFPS: false,
  footsteps: FOOTSTEPS.ON,
  autoShop: true,
  autoReload: false, // added by the patched game (boxhead.options.AutoReload)
});

export const Preferences = { ...DEFAULTS };

export function loadPreferences(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || '{}');
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof saved[key] === typeof DEFAULTS[key]) Preferences[key] = saved[key];
    }
  } catch {
    // Unreadable or blocked storage: keep the defaults.
  }
  return Preferences;
}

export function savePreferences(storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(Preferences));
  } catch {
    // Private mode or blocked storage: the options last for this visit only.
  }
}

export function resetPreferences() {
  Object.assign(Preferences, DEFAULTS);
}
