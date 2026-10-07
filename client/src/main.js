// Boxhead: Bounty Hunter, browser edition.

import { WINDOW_HEIGHT, WINDOW_WIDTH } from './game/constants.js';
import { BootScene } from './scenes/BootScene.js';
import { GameScene } from './scenes/GameScene.js';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WINDOW_WIDTH,
  height: WINDOW_HEIGHT,
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { roundPixels: true, antialias: true },
  audio: { disableWebAudio: false },
  scene: [BootScene, GameScene],
});

window.boxheadGame = game;
