// All shadows drawn as one layer, like Map.draw did: every shadow is painted
// into one off-screen texture, which is then blended at SHADOW_ALPHA, so
// overlapping shadows don't get darker. "Enhanced" uses softened copies of
// the shadow images.

import { SHADOW_ALPHA, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { frameCount, frameInfo, showFrame } from './assets.js';

export const DEPTH_SHADOW_LAYER = -2;
const MARGIN = 120; // shadows this far outside the window may still reach into it
const SOFT_BLUR = 1.3; // px, enhanced shadows
const SOFT_PAD = 4;

const soft = new Map(); // atlas entry -> texture key of its softened frames

/** Every frame of a shadow, blurred, each in its own padded cell of one new texture. */
function softShadow(textures, name) {
  if (soft.has(name)) return soft.get(name);
  const count = frameCount(name);
  const frames = Array.from({ length: count }, (_, i) => frameInfo(name, i)).filter(Boolean);
  const source = frames.length && textures.get('sheet:' + frames[0].image)?.getSourceImage();
  if (!source) {
    soft.set(name, null);
    return null;
  }
  const cellW = Math.max(...frames.map((f) => f.w)) + SOFT_PAD * 2;
  const cellH = Math.max(...frames.map((f) => f.h)) + SOFT_PAD * 2;
  const columns = Math.max(1, Math.min(frames.length, Math.floor(2048 / cellW)));
  const rows = Math.ceil(frames.length / columns);
  const key = 'soft:' + name;
  const canvas = textures.createCanvas(key, cellW * columns, cellH * rows);
  const ctx = canvas.getContext();
  ctx.filter = `blur(${SOFT_BLUR}px)`;
  frames.forEach((f, i) => {
    const x = (i % columns) * cellW;
    const y = Math.floor(i / columns) * cellH;
    ctx.drawImage(source, f.x * f.scale, f.y * f.scale, f.w * f.scale, f.h * f.scale, x + SOFT_PAD, y + SOFT_PAD, f.w, f.h);
    canvas.add(`${name}:${i}`, 0, x, y, f.w + SOFT_PAD * 2, f.h + SOFT_PAD * 2);
  });
  canvas.refresh();
  soft.set(name, key);
  return key;
}

export class ShadowLayer {
  constructor(scene) {
    this.scene = scene;
    this.sprites = new Set();
    this.dirty = true;
    this.view = null;
    this.build();
  }

  build() {
    // Always the original 700x490 (a larger one, or a filter on it, upsets
    // the drawing that follows it in Phaser).
    this.texture?.destroy();
    this.texture = this.scene.add
      .renderTexture(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_SHADOW_LAYER)
      .setAlpha(SHADOW_ALPHA)
      .setVisible(Preferences.shadows);
    this.texture.camera.setOrigin(0, 0);
  }

  /** A shadow sprite (frame `index` of atlas entry `name`) owned by this layer. */
  create(name, index = 0, x = 0, y = 0) {
    const sprite = this.scene.make.image({ key: '__DEFAULT', add: false }).setOrigin(0, 0);
    this.show(sprite, name, index, x, y);
    this.sprites.add(sprite);
    this.dirty = true;
    return sprite;
  }

  /** showFrame for a shadow sprite (softened when enhanced). */
  show(sprite, name, index, x, y) {
    const shown = `${name}:${index}:${x}:${y}`;
    if (sprite.shown === shown) return sprite;
    sprite.shown = shown;
    this.dirty = true;
    const key = Preferences.enhanced && softShadow(this.scene.textures, name);
    const frame = key && frameInfo(name, index);
    if (!frame) return showFrame(sprite, name, index, x, y);
    sprite.setTexture(key, `${name}:${index}`);
    sprite.setPosition(x + frame.dx - SOFT_PAD, y + frame.dy - SOFT_PAD);
    sprite.setVisible(true);
    return sprite;
  }

  remove(sprite) {
    this.sprites.delete(sprite);
    sprite.destroy();
    this.dirty = true;
  }

  /** Hide or show a shadow (dead or inactive characters). */
  setVisible(sprite, visible) {
    if (sprite.visible === visible) return;
    sprite.setVisible(visible);
    this.dirty = true;
  }

  /** Repaint the layer for the camera's current view (once per frame). */
  render() {
    if (!Preferences.shadows) return;
    const camera = this.scene.cameras.main;
    // Nothing moved: the layer still holds this frame's shadows.
    const view = `${camera.scrollX},${camera.scrollY}`;
    if (!this.dirty && view === this.view) return;
    this.dirty = false;
    this.view = view;
    const left = camera.scrollX - MARGIN;
    const top = camera.scrollY - MARGIN;
    const right = camera.scrollX + WINDOW_WIDTH + MARGIN;
    const bottom = camera.scrollY + WINDOW_HEIGHT + MARGIN;
    const texture = this.texture;
    texture.camera.setScroll(camera.scrollX, camera.scrollY);
    texture.clear();
    texture.beginDraw();
    for (const sprite of this.sprites) {
      if (!sprite.visible || sprite.x > right || sprite.y > bottom || sprite.x + sprite.width < left || sprite.y + sprite.height < top) continue;
      texture.batchDraw(sprite);
    }
    texture.endDraw();
  }

  destroy() {
    for (const sprite of this.sprites) sprite.destroy();
    this.sprites.clear();
    this.texture?.destroy();
  }
}
