// Quick Play's setup, shown when Quick Play is pressed: how hard the computer
// players are, the money you start each round with and which maps are played.
// Plain page elements over the main menu's backdrop, styled like its screens.

import { DIFFICULTIES } from '../game/npc.js';
import { MAX_MONEY, MIN_MONEY, MONEY_STEP, cleanSettings, formatMoney } from '../game/quickPlay.js';

const HINTS = {
  Easy: 'Slow to react, light guns. Good for learning the maps.',
  Medium: 'A fair fight: an automatic and a shotgun or long gun.',
  Hard: 'Fast and sharp. They chain Plasma, Shotgun and Rifle, dodge your shots and grab every money crate.',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The setup panel in `root`. settings: { difficulty, money, maps } (maps:
 * chosen names, empty for all); maps: a promise of [{ name }]. play(settings)
 * starts the game, back() returns to the menu. Returns { remove }.
 */
export function createQuickPlaySetup(root, { settings, maps, play, back, playSound = () => {} }) {
  const state = cleanSettings(settings);
  const layer = el('div', 'qp-setup');
  const panel = el('div', 'qp-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Quick Play setup');
  layer.append(panel);
  panel.append(el('h2', 'qp-title', 'quick play'));

  // Bot difficulty: three buttons, one pressed.
  const difficulty = el('section', 'qp-section');
  difficulty.append(el('h3', 'qp-label', 'Bot Difficulty'));
  const segment = el('div', 'qp-segment');
  const hint = el('p', 'qp-hint');
  const levelButtons = DIFFICULTIES.map((level) => {
    const button = el('button', 'qp-choice qp-' + level.toLowerCase(), level);
    button.type = 'button';
    button.addEventListener('click', () => {
      playSound('ClickShort');
      state.difficulty = level;
      showDifficulty();
    });
    segment.append(button);
    return button;
  });
  const showDifficulty = () => {
    levelButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(DIFFICULTIES[i] === state.difficulty)));
    hint.textContent = HINTS[state.difficulty];
  };
  difficulty.append(segment, hint);

  // Starting money: $10,000 to $100,000.
  const money = el('section', 'qp-section');
  const moneyLabel = el('label', 'qp-label', 'Starting Money');
  const row = el('div', 'qp-money');
  const slider = el('input', 'qp-slider');
  Object.assign(slider, { type: 'range', min: MIN_MONEY, max: MAX_MONEY, step: MONEY_STEP, value: state.money, id: 'qp-money' });
  moneyLabel.htmlFor = slider.id;
  const amount = el('output', 'qp-amount');
  amount.htmlFor = slider.id;
  const showMoney = () => {
    amount.textContent = formatMoney(state.money);
    slider.style.setProperty('--fill', ((state.money - MIN_MONEY) / (MAX_MONEY - MIN_MONEY)) * 100 + '%');
  };
  slider.addEventListener('input', () => {
    state.money = Number(slider.value);
    showMoney();
  });
  row.append(slider, amount);
  money.append(moneyLabel, row);

  // Maps: a box for each; all of them when none is picked.
  const mapsSection = el('section', 'qp-section');
  const mapsHead = el('div', 'qp-maps-head');
  const all = el('button', 'qp-link', 'All');
  all.type = 'button';
  mapsHead.append(el('h3', 'qp-label', 'Maps'), all);
  const list = el('div', 'qp-maps');
  list.textContent = 'Loading maps…';
  const note = el('p', 'qp-hint');
  mapsSection.append(mapsHead, list, note);
  let boxes = [];
  const chosen = () => boxes.filter((b) => b.checked).map((b) => b.value);
  const showMaps = () => {
    const n = chosen().length;
    playButton.disabled = boxes.length > 0 && n === 0;
    note.textContent = n === 0 ? 'Pick at least one map.' : n === boxes.length ? 'A random map each round.' : n === 1 ? 'Every round on this map.' : `A random one of these ${n} each round.`;
    all.textContent = n === boxes.length ? 'None' : 'All';
  };
  all.addEventListener('click', () => {
    playSound('ClickShort');
    const on = chosen().length !== boxes.length;
    for (const b of boxes) b.checked = on;
    showMaps();
  });

  const actions = el('div', 'qp-actions');
  const backButton = el('button', 'qp-button', 'back');
  backButton.type = 'button';
  const playButton = el('button', 'qp-button qp-play', 'play');
  playButton.type = 'button';
  actions.append(backButton, playButton);
  panel.append(difficulty, money, mapsSection, actions);

  const start = () => {
    if (playButton.disabled) return;
    const picked = chosen();
    state.maps = picked.length === boxes.length ? [] : picked; // all: new maps join in too
    play(cleanSettings(state));
  };
  playButton.addEventListener('click', start);
  backButton.addEventListener('click', () => back());
  const onKey = (event) => {
    if (event.key === 'Escape') back();
    else if (event.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') start();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  layer.addEventListener('keydown', onKey);

  Promise.resolve(maps).then((available) => {
    if (!layer.isConnected) return;
    list.textContent = '';
    const names = [...new Set((available || []).map((m) => m.name).filter(Boolean))];
    const picked = state.maps.filter((name) => names.includes(name));
    boxes = names.map((name) => {
      const label = el('label', 'qp-map');
      const box = el('input');
      Object.assign(box, { type: 'checkbox', value: name, checked: picked.length === 0 || picked.includes(name) });
      box.addEventListener('change', () => (playSound('ClickShort'), showMaps()));
      label.append(box, el('span', '', name));
      list.append(label);
      return box;
    });
    showMaps();
  });

  showDifficulty();
  showMoney();
  root.append(layer);
  playButton.focus({ preventScroll: true });
  return { element: layer, remove: () => layer.remove() };
}
