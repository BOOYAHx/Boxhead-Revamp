// Draws a GameMap: the terrain into one canvas texture (Terrain.render), then
// every prop and its shadow as depth-sorted sprites.

import { CELL_HEIGHT, CELL_WIDTH, RELIEF_ALPHA, SHADOW_ALPHA } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { TEXTURES } from '../game/world.js';
import { createSprite } from './assets.js';

export const DEPTH_TERRAIN = -3;
export const DEPTH_SHADOWS = -2;
export const DEPTH_CORPSES = -1;

/** Shadows are drawn only with the Shadows option on (Map.draw). */
export const shadowAlpha = () => (Preferences.shadows ? SHADOW_ALPHA : 0);

export class MapView {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.pixelWidth = map.width * CELL_WIDTH;
    this.pixelHeight = map.height * CELL_HEIGHT;
    this.objects = [];
    this.drawTerrain();
    this.drawProps();
  }

  image(key) {
    const textures = this.scene.textures;
    return textures.exists('img:' + key) ? textures.get('img:' + key).getSourceImage() : null;
  }

  drawTerrain() {
    const { map, scene } = this;
    const key = 'terrain';
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = scene.textures.createCanvas(key, this.pixelWidth, this.pixelHeight);
    const ctx = canvas.getContext();
    ctx.fillStyle = '#' + map.backgroundColor.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, this.pixelWidth, this.pixelHeight);

    for (const cell of map.cells) {
      const texture = TEXTURES[cell.texture] && this.image(TEXTURES[cell.texture]);
      if (!texture) continue;
      const px = cell.x * CELL_WIDTH;
      const py = cell.y * CELL_HEIGHT;
      // Textures tile across the map: each cell copies its slice of the pattern.
      ctx.drawImage(texture, px % texture.width, py % texture.height, CELL_WIDTH, CELL_HEIGHT, px, py, CELL_WIDTH, CELL_HEIGHT);
    }

    const relief = map.relief && this.image(map.relief);
    if (relief) {
      ctx.save();
      ctx.globalAlpha = RELIEF_ALPHA;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(relief, 0, 0, this.pixelWidth, this.pixelHeight);
      ctx.restore();
    }
    canvas.refresh();
    this.terrain = scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH_TERRAIN);
  }

  drawProps() {
    for (const prop of this.map.props) {
      const x = Math.round(prop.renderPos.x * CELL_WIDTH);
      const y = Math.round(prop.renderPos.y * CELL_HEIGHT);
      if (prop.shadow && Preferences.shadows) {
        this.objects.push(createSprite(this.scene, prop.shadow, 0, x, y).setDepth(DEPTH_SHADOWS).setAlpha(SHADOW_ALPHA));
      }
      if (prop.display) {
        this.objects.push(createSprite(this.scene, prop.display, 0, x, y).setDepth(prop.depth));
      }
    }
  }

  destroy() {
    this.terrain?.destroy();
    for (const object of this.objects) object.destroy();
    this.objects = [];
  }
}
