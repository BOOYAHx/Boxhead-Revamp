// Loads the generated assets (tools/build_assets.py) with a progress bar.

import { WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { loadHdSheets } from '../render/hdLoader.js';
import { ASSET_ROOT, imageURL, isHdTexture, loadSheets, registerFrames, setAtlas, setHdSheets } from '../render/assets.js';
import { LEADER_ICON, LEADER_ICON_URL } from '../render/CharacterView.js';
import { applyFilters, fitCamera } from '../render/display.js';
import { buildFxTextures } from '../render/fxTextures.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.json('atlas', ASSET_ROOT + 'atlas.json');
    this.load.json('manifest', ASSET_ROOT + 'manifest.json');
    this.load.text('constants', ASSET_ROOT + 'constants.xml');
    // The leader's bullseye is optional: without it first place shows just "1st".
    this.load.on('loaderror', (file) => file.key !== LEADER_ICON && this.fail(`Missing ${file.src}`));
  }

  async create() {
    fitCamera(this.cameras.main);
    // Upscaled sprite sheets and images (tools/upscale_textures.py), used with Enhanced Graphics.
    if (Preferences.enhanced) {
      setHdSheets(await fetch(ASSET_ROOT + 'hd.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
    }
    const atlas = this.cache.json.get('atlas');
    const manifest = this.cache.json.get('manifest');
    if (!atlas || !manifest) {
      this.fail('Game assets are missing. Run tools/build_assets.py (see README).');
      return;
    }
    setAtlas(atlas);
    loadSheets(this.load);
    for (const name of manifest.images) this.load.image('img:' + name, imageURL(name));
    this.load.image(LEADER_ICON, LEADER_ICON_URL);
    for (const [name, file] of Object.entries(manifest.sounds)) this.load.audio('snd:' + name, ASSET_ROOT + 'sounds/' + file);

    // The original's loading screen (ui/intro.js); a plain bar when its art has not been exported.
    const intro = this.registry.get('intro');
    const original = intro && (await intro.ready);
    const bar = this.add.rectangle(WINDOW_WIDTH / 2 - 150, WINDOW_HEIGHT / 2, 0, 12, 0xffffff).setOrigin(0, 0.5).setVisible(!original);
    this.add.rectangle(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, 304, 16).setStrokeStyle(2, 0xffffff).setVisible(!original);
    const label = this.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2 - 24, 'Loading Boxhead...', { fontFamily: 'Verdana', fontSize: '14px' }).setOrigin(0.5).setVisible(!original);
    this.load.on('progress', (value) => {
      bar.width = 300 * value;
      intro?.progress(value);
    });
    // Particle shapes (fx.json, from builds since the graphics step); optional.
    const fx = fetch(ASSET_ROOT + 'fx.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    this.load.once('complete', async () => {
      if (this.failed) return;
      registerFrames(this.textures);
      applyFilters(this.textures, isHdTexture);
      label.setText('Preparing effects...');
      // Built at 1x: at the drawing scale they upset the shadow layer's drawing
      // on some graphics drivers (a grey box stamped into the ground).
      this.registry.set('fx', await buildFxTextures(this, await fx, 1));
      if (original) await intro.toBlack();
      this.scene.start('menu');
      const app = this.registry.get('app');
      await app.start();
      if (original) intro.reveal();
      // The HD sprite sheets, in the background from here (render/hdLoader.js).
      const game = this.game;
      loadHdSheets(game, () => game.scene.isActive('game') || game.scene.isPaused('game') || game.scene.isSleeping('game'));
    });
    this.load.start();
  }

  fail(message) {
    this.failed = true;
    console.error(message);
    this.add.text(20, 20, message, { fontFamily: 'Verdana', fontSize: '13px', color: '#ff8080', wordWrap: { width: WINDOW_WIDTH - 40 } });
  }
}
