// Boxhead: Bounty Hunter, browser edition.

import { App } from './App.js';
import { loadBindings } from './game/controls.js';
import { Preferences, isSaved, loadPreferences } from './game/preferences.js';
import { loadQuickPlay } from './game/quickPlay.js';
import { loadBanks } from './game/weapons.js';
import { Display, applyDisplay, canvasSize, sharpenText, softwareRendering, wantedScale } from './render/display.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { Intro } from './ui/intro.js';
import { watchForUpdates } from './net/updates.js';
import { keepConsoleKeys } from './ui/keyboard.js';

loadPreferences();
loadQuickPlay(); // Quick Play's setup: bot difficulty, starting money, maps
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

// Install after Phaser's keyboard manager so the game receives keys before
// their browser actions are cancelled (including modified/repeating Tab).
const captureConsole = () => {
  const stage = document.getElementById('play-stage');
  if (!stage) return;
  const release = keepConsoleKeys(stage, { playing: () => game.scene.isActive('game') });
  game.events.once('destroy', release);
};
if (game.isRunning) captureConsole();
else game.events.once('ready', captureConsole);

// Ctrl is Auto-run and W moves up, so playing can press Ctrl+W and close the tab. No page can
// stop that (outside fullscreen on a secure page, see play-page.js), but it can have the browser
// ask "Leave site?" first: in the menus and lobby as well as in a game. (Browsers only ask once
// the page has been clicked or typed in.)
let leaving = false; // a link on the page or the new-version Refresh button: going was chosen
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('a[href], .update-bar button:not(.update-later)')) return;
  leaving = true;
  setTimeout(() => (leaving = false), 3000);
}, true);
window.addEventListener('beforeunload', (event) => {
  if (leaving) return;
  event.preventDefault();
  event.returnValue = ''; // older browsers
});

// "A new version is available" after the website is updated.
watchForUpdates(app, document.getElementById('play-stage') || document.body);

