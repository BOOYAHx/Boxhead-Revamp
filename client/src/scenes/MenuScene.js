// Backdrop behind the HTML menus.

import { WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { fitCamera } from '../render/display.js';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create() {
    fitCamera(this.cameras.main);
    const bg = this.textures.exists('img:Tiles') ? this.add.tileSprite(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT, 'img:Tiles') : null;
    bg?.setOrigin(0, 0).setAlpha(0.35);
    this.add.rectangle(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT, 0x000000, 0.45).setOrigin(0, 0);
  }
}
