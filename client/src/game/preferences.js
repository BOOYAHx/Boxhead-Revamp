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
  enhanced: true, // browser edition: sharper picture and extra effects ("Classic" when off)
  npcs: 8, // computer players in offline practice (0 to 15)
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

/** Whether the player has saved a value for this option. */
export function isSaved(key, storage = globalThis.localStorage) {
  try {
    return key in JSON.parse(storage?.getItem(KEY) || '{}');
  } catch {
    return false;
  }
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
