// The character's look kept in this browser (the original's QuickPlayProfile):
// offline practice uses it, and it is what the customization window last saved.

const KEY = 'bbh.look';
const GENDERS = ['Monster', 'Male', 'Female'];
const DEFAULT_LOOK = Object.freeze({ gender: 'Male', headModel: 0, headColor: 0, bodyModel: 0, bodyColor: 0 });

const index = (value, max) => (Number.isInteger(value) && value >= 0 && value < max ? value : 0);

/** A clean look: known gender, models 0-11, colours 0-49 (the palettes are shorter; the renderer clamps). */
export function cleanLook(look = {}) {
  return {
    gender: GENDERS.includes(look.gender) ? look.gender : DEFAULT_LOOK.gender,
    headModel: index(look.headModel, 12),
    headColor: index(look.headColor, 50),
    bodyModel: index(look.bodyModel, 12),
    bodyColor: index(look.bodyColor, 50),
  };
}

export function loadLook(storage = globalThis.localStorage) {
  try {
    return cleanLook(JSON.parse(storage?.getItem(KEY) || '{}'));
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(cleanLook(look)));
  } catch {
    // Private mode or blocked storage: the look lasts for this visit only.
  }
}
