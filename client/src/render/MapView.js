// Draws a GameMap: the terrain into canvas textures (Terrain.render), then
// every prop and its shadow as depth-sorted sprites.

import { CELL_HEIGHT, CELL_WIDTH, RELIEF_ALPHA } from '../game/constants.js';
import { TEXTURES } from '../game/world.js';
import { createSprite, hdImageScale } from './assets.js';
import { Display } from './display.js';
import { Preferences } from '../game/preferences.js';

const TERRAIN_CHUNK = 512; // map pixels per piece of ground
const TERRAIN_BUDGET = 36e6; // most texture pixels for the whole ground (about 144 MB)
// Enhanced: ambient occlusion, a soft darkening of the floor where walls and props stand on it.
const OCCLUSION = {
  wall: { blur: 7, spread: 2, alpha: 0.42 }, // walls, buildings, fences
  prop: { blur: 5, spread: 1.5, alpha: 0.34 }, // crates, cars, bins, rocks, trees
};
const WALLS = new Set(['fence', 'brickwall', 'castlewall', 'factory', 'storefront']);
const OFFSCREEN = 20000; // device px: the shapes are drawn out of sight, only their blurred shadow lands

export const DEPTH_TERRAIN = -3;
export const DEPTH_SHADOWS = -2;
export const DEPTH_CORPSES = -1;

/** SheetDecal.draw: where cell `variant` sits on a decal sheet of `width` x `height` original pixels. */
export function decalCell(width, height, variant) {
  const columns = Math.max(1, Math.round(width / CELL_WIDTH));
  const rows = Math.max(1, Math.round(height / CELL_HEIGHT));
  const v = ((variant % (columns * rows)) + columns * rows) % (columns * rows);
  return [(v % columns) * CELL_WIDTH, Math.floor(v / columns) * CELL_HEIGHT];
}

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
    this.occluded = Preferences.enhanced;
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
        this.drawDecals(ctx, left, top, width, height);
        if (relief) {
          ctx.save();
          ctx.globalAlpha = RELIEF_ALPHA;
          ctx.globalCompositeOperation = 'overlay';
          ctx.drawImage(relief, 0, 0, this.pixelWidth, this.pixelHeight);
          ctx.restore();
        }
        if (this.occluded) this.drawOcclusion(ctx, scale, left, top, width, height);
        canvas.refresh();
        const piece = scene.add.image(left, top, key).setOrigin(0, 0).setScale(1 / scale).setDepth(DEPTH_TERRAIN);
        scene.lighting?.add(piece);
        this.terrain.push(piece);
      }
    }
  }

  /**
   * Terrain.renderDecals: road lines, curbs, cracks, sidewalks, grass bits and
   * rock edges painted over the ground, under the relief shading. Each is one
   * cell of a sheet of cells (SheetDecal: variant = column + row * columns).
   * FloorDamage is vector art the asset build does not export, so it is left out.
   */
  drawDecals(ctx, left, top, width, height) {
    for (const decal of this.map.decals) {
      const px = decal.x * CELL_WIDTH;
      const py = decal.y * CELL_HEIGHT;
      if (px + CELL_WIDTH <= left || px >= left + width || py + CELL_HEIGHT <= top || py >= top + height) continue;
      const sheet = this.image(decal.image);
      if (!sheet) continue;
      const k = hdImageScale(decal.image);
      const [sx, sy] = decalCell(sheet.width / k, sheet.height / k, decal.variant);
      ctx.drawImage(sheet, sx * k, sy * k, CELL_WIDTH * k, CELL_HEIGHT * k, px, py, CELL_WIDTH, CELL_HEIGHT);
    }
  }

  /**
   * Enhanced: each prop's footprint (its hit shapes), a little larger and
   * blurred, darkens the floor under it. The prop hides the middle, so what
   * shows is a soft dark edge where its base meets the ground. The shapes go
   * far off the canvas and only their shadow is placed here, which blurs in
   * every browser (unlike canvas filters).
   */
  drawOcclusion(ctx, scale, left, top, width, height) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    for (const prop of this.map.props) {
      const style = WALLS.has(prop.kind) ? OCCLUSION.wall : OCCLUSION.prop;
      const reach = style.blur * 2 + style.spread;
      ctx.shadowColor = `rgba(0, 0, 0, ${style.alpha})`;
      ctx.shadowBlur = style.blur * scale;
      ctx.shadowOffsetX = OFFSCREEN;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#000';
      for (let shape = prop.hit; shape; shape = shape.next) {
        const cx = shape.pos.x * CELL_WIDTH;
        const cy = shape.pos.y * CELL_HEIGHT;
        const rx = (shape.radius ?? shape.xRad) * CELL_WIDTH + style.spread;
        const ry = (shape.radius ?? shape.yRad) * CELL_HEIGHT + style.spread;
        if (cx + rx + reach < left || cx - rx - reach > left + width || cy + ry + reach < top || cy - ry - reach > top + height) continue;
        const x = cx - OFFSCREEN / scale;
        ctx.beginPath();
        if (shape.radius !== undefined) ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
        else ctx.rect(x - rx, cy - ry, rx * 2, ry * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Redraw the ground when Enhanced Graphics is switched (its ambient occlusion). */
  refresh() {
    if (this.occluded === Preferences.enhanced) return;
    for (const piece of this.terrain || []) piece.destroy();
    this.drawTerrain();
  }

  drawProps() {
    for (const prop of this.map.props) {
      const x = Math.round(prop.renderPos.x * CELL_WIDTH);
      const y = Math.round(prop.renderPos.y * CELL_HEIGHT);
      if (prop.shadow) this.shadows.push(this.scene.shadows.create(prop.shadow, 0, x, y));
      if (prop.display) {
        const sprite = createSprite(this.scene, prop.display, 0, x, y).setDepth(prop.depth);
        this.scene.lighting?.add(sprite);
        this.objects.push(sprite);
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
