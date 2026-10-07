// Boxhead: Bounty Hunter, browser edition.

import { App } from './App.js';
import { WINDOW_HEIGHT, WINDOW_WIDTH } from './game/constants.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';
import { MenuScene } from './scenes/MenuScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WINDOW_WIDTH,
  height: WINDOW_HEIGHT,
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { roundPixels: true, antialias: true },
  scene: [BootScene, MenuScene, GameScene],
});

const app = new App(game, document.getElementById('overlay'));
game.registry.set('app', app);
window.boxheadApp = app;
