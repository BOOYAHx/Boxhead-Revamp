// Boxhead: Bounty Hunter, browser edition.

import { App } from './App.js';
import { loadBindings } from './game/controls.js';
import { Preferences, isSaved, loadPreferences } from './game/preferences.js';
import { loadBanks } from './game/weapons.js';
import { Display, applyDisplay, canvasSize, sharpenText, softwareRendering, wantedScale } from './render/display.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { Intro } from './ui/intro.js';

loadPreferences();
loadBindings(); // the Controls screen's keys
loadBanks(); // the Weapon Banks screen's layout
// Enhanced Graphics starts off on computers drawing without a graphics card.
if (!isSaved('enhanced') && softwareRendering()) Preferences.enhanced = false;
Display.scale = wantedScale();
sharpenText();

// The original's loading screen, over the game until the main menu is ready.
const intro = new Intro(document.getElementById('game').parentElement);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  ...canvasSize(Display.scale),
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { roundPixels: true, antialias: true },
  scene: [BootScene, MenuScene, GameScene],
});

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => applyDisplay(game), 150);
});

const app = new App(game, { overlay: document.getElementById('overlay'), flashRoot: document.getElementById('flash-ui') });
game.registry.set('app', app);
game.registry.set('intro', intro);
window.boxheadApp = app;
