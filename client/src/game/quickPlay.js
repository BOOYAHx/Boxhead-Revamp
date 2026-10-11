// Quick Play's setup (chosen on the screen before a practice game, kept in the
// browser): how hard the computer players are, the money everyone starts each
// round with and which maps the rounds are played on.

import { DIFFICULTIES } from './npc.js';

const KEY = 'bbh.quickplay';
export const MIN_MONEY = 10000;
export const MAX_MONEY = 100000;
export const MONEY_STEP = 10000;

const DEFAULTS = Object.freeze({ difficulty: 'Medium', money: MIN_MONEY, maps: [] }); // no maps chosen: all of them

export const QuickPlay = { ...DEFAULTS, maps: [] };

/** Valid settings from anything (a saved copy, the setup screen). */
export function cleanSettings(raw = {}) {
  const difficulty = DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : DEFAULTS.difficulty;
  const n = Math.round(Number(raw.money) / MONEY_STEP) * MONEY_STEP;
  const money = Number.isFinite(n) ? Math.max(MIN_MONEY, Math.min(MAX_MONEY, n)) : DEFAULTS.money;
  const maps = Array.isArray(raw.maps) ? [...new Set(raw.maps.filter((m) => typeof m === 'string' && m))] : [];
  return { difficulty, money, maps };
}

export function loadQuickPlay(storage = globalThis.localStorage) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem(KEY) || '{}') || {};
  } catch {
    // Unreadable or blocked storage: the defaults.
  }
  return Object.assign(QuickPlay, cleanSettings(saved));
}

export function saveQuickPlay(settings, storage = globalThis.localStorage) {
  Object.assign(QuickPlay, cleanSettings(settings));
  try {
    storage?.setItem(KEY, JSON.stringify(QuickPlay));
  } catch {
    // Private mode or blocked storage: the settings last for this visit only.
  }
  return QuickPlay;
}

/** The maps the rounds are picked from: the chosen ones still on the list, or every map. */
export function playableMaps(maps, chosen = QuickPlay.maps) {
  const picked = maps.filter((m) => chosen.includes(m.name));
  return picked.length ? picked : maps;
}

export const formatMoney = (n) => '$' + Math.trunc(n).toLocaleString('en-US');
