// Draws a GameMap: the terrain into canvas textures (Terrain.render), then
// every prop and its shadow as depth-sorted sprites.

import { CELL_HEIGHT, CELL_WIDTH, RELIEF_ALPHA } from '../game/constants.js';
import { TEXTURES } from '../game/world.js';
import { createSprite, hdImageScale } from './assets.js';
import { Display } from './display.js';

const TERRAIN_CHUNK = 512; // map pixels per piece of ground
const TERRAIN_BUDGET = 36e6; // most texture pixels for the whole ground (about 144 MB)

export const DEPTH_TERRAIN = -3;
export const DEPTH_SHADOWS = -2;
export const DEPTH_CORPSES = -1;

export class MapView {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.pixelWidth = map.width * CELL_WIDTH;
    this.pixelHeight = map.height * CELL_HEIGHT;
    this.objects = [];
    this.shadows = [];
    this.drawTerrain();
    this.drawProps();
  }

  image(key) {
    const textures = this.scene.textures;
    return textures.exists('img:' + key) ? textures.get('img:' + key).getSourceImage() : null;
  }

  /**
   * How sharp to paint the ground: at the drawing scale when the ground
   * textures are upscaled (Enhanced Graphics), limited so the pieces stay
   * within the graphics card's memory.
   */
  terrainScale() {
    const names = [...new Set(this.map.cells.map((c) => TEXTURES[c.texture]).filter(Boolean)), this.map.relief].filter(Boolean);
    if (!names.some((name) => hdImageScale(name) > 1)) return 1;
    let scale = Math.max(1, Display.scale);
    while (scale > 1 && this.pixelWidth * this.pixelHeight * scale * scale > TERRAIN_BUDGET) scale--;
    return scale;
  }

  /** Terrain.render: every cell's slice of its repeating texture, then the relief shading on top, in pieces. */
  drawTerrain() {
    const { map, scene } = this;
    const scale = this.terrainScale();
    this.terrain = [];
    const relief = map.relief && this.image(map.relief);
    for (let top = 0; top < this.pixelHeight; top += TERRAIN_CHUNK) {
      for (let left = 0; left < this.pixelWidth; left += TERRAIN_CHUNK) {
        const width = Math.min(TERRAIN_CHUNK, this.pixelWidth - left);
        const height = Math.min(TERRAIN_CHUNK, this.pixelHeight - top);
        const key = `terrain:${left}:${top}`;
        if (scene.textures.exists(key)) scene.textures.remove(key);
        const canvas = scene.textures.createCanvas(key, Math.ceil(width * scale), Math.ceil(height * scale));
        const ctx = canvas.getContext();
        ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
        ctx.fillStyle = '#' + map.backgroundColor.toString(16).padStart(6, '0');
        ctx.fillRect(left, top, width, height);
        for (const cell of map.cells) {
          const px = cell.x * CELL_WIDTH;
          const py = cell.y * CELL_HEIGHT;
          if (px + CELL_WIDTH <= left || px >= left + width || py + CELL_HEIGHT <= top || py >= top + height) continue;
          const name = TEXTURES[cell.texture];
          const texture = name && this.image(name);
          if (!texture) continue;
          // Textures tile across the map: each cell copies its slice of the pattern
          // (upscaled textures are `k` times larger than the pattern they draw).
          const k = hdImageScale(name);
          const tw = texture.width / k;
          const th = texture.height / k;
          ctx.drawImage(texture, (px % tw) * k, (py % th) * k, CELL_WIDTH * k, CELL_HEIGHT * k, px, py, CELL_WIDTH, CELL_HEIGHT);
        }
        if (relief) {
          ctx.save();
          ctx.globalAlpha = RELIEF_ALPHA;
          ctx.globalCompositeOperation = 'overlay';
          ctx.drawImage(relief, 0, 0, this.pixelWidth, this.pixelHeight);
          ctx.restore();
        }
        canvas.refresh();
        this.terrain.push(scene.add.image(left, top, key).setOrigin(0, 0).setScale(1 / scale).setDepth(DEPTH_TERRAIN));
      }
    }
  }

  drawProps() {
    for (const prop of this.map.props) {
      const x = Math.round(prop.renderPos.x * CELL_WIDTH);
      const y = Math.round(prop.renderPos.y * CELL_HEIGHT);
      if (prop.shadow) this.shadows.push(this.scene.shadows.create(prop.shadow, 0, x, y));
      if (prop.display) {
        this.objects.push(createSprite(this.scene, prop.display, 0, x, y).setDepth(prop.depth));
      }
    }
  }

  destroy() {
    for (const piece of this.terrain || []) {
      const key = piece.texture.key;
      piece.destroy();
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    this.terrain = [];
    for (const object of this.objects) object.destroy();
    for (const shadow of this.shadows) this.scene.shadows?.remove(shadow);
    this.objects = [];
    this.shadows = [];
  }
}
