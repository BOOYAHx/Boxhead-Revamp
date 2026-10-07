// Loads the generated assets (tools/build_assets.py) with a progress bar.

import { WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { ASSET_ROOT, loadSheets, registerFrames, setAtlas } from '../render/assets.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.json('atlas', ASSET_ROOT + 'atlas.json');
    this.load.json('manifest', ASSET_ROOT + 'manifest.json');
    this.load.text('constants', ASSET_ROOT + 'constants.xml');
    this.load.on('loaderror', (file) => this.fail(`Missing ${file.src}`));
  }

  create() {
    const atlas = this.cache.json.get('atlas');
    const manifest = this.cache.json.get('manifest');
    if (!atlas || !manifest) {
      this.fail('Game assets are missing. Run tools/build_assets.py (see README).');
      return;
    }
    setAtlas(atlas);
    loadSheets(this.load);
    for (const name of manifest.images) this.load.image('img:' + name, ASSET_ROOT + 'images/' + name + '.png');
    for (const [name, file] of Object.entries(manifest.sounds)) this.load.audio('snd:' + name, ASSET_ROOT + 'sounds/' + file);

    const bar = this.add.rectangle(WINDOW_WIDTH / 2 - 150, WINDOW_HEIGHT / 2, 0, 12, 0xffffff).setOrigin(0, 0.5);
    this.add.rectangle(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, 304, 16).setStrokeStyle(2, 0xffffff);
    const label = this.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2 - 24, 'Loading Boxhead...', { fontFamily: 'Verdana', fontSize: '14px' }).setOrigin(0.5);
    this.load.on('progress', (value) => (bar.width = 300 * value));
    this.load.once('complete', () => {
      if (this.failed) return;
      registerFrames(this.textures);
      label.setText('Ready');
      this.scene.start('game', this.registry.get('launch') || {});
    });
    this.load.start();
  }

  fail(message) {
    this.failed = true;
    console.error(message);
    this.add.text(20, 20, message, { fontFamily: 'Verdana', fontSize: '13px', color: '#ff8080', wordWrap: { width: WINDOW_WIDTH - 40 } });
  }
}
