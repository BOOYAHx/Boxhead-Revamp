// Enhanced Graphics lighting: muzzle flashes and explosions light up the
// ground, walls, props and characters around them for a moment (Phaser's
// Light2D). The ambient light is white, so nothing changes until a light is
// on: a lit pixel is its own colour times (1 + the light reaching it), which
// keeps the original art's look and only warms what is near the flash.
// Needs WebGL; with the Canvas renderer or Classic graphics nothing is lit.

import { Preferences } from '../game/preferences.js';

const MAX_LIGHTS = 12; // the oldest light gives way to a new one past this (Phaser draws up to 10 at once)

export class Lighting {
  constructor(scene) {
    this.scene = scene;
    this.supported = typeof Phaser !== 'undefined' && scene.sys?.renderer?.type === Phaser.WEBGL && !!scene.lights;
    this.objects = new Set(); // everything that can be lit
    this.lights = []; // { light, born, life, intensity, flicker }
    this.active = false;
    this.setEnabled(Preferences.enhanced);
  }

  /** Turn lighting on or off (the Enhanced Graphics option). */
  setEnabled(on) {
    on = on && this.supported;
    if (on === this.active) return;
    this.active = on;
    if (on) this.scene.lights.enable().setAmbientColor(0xffffff);
    else {
      for (const l of this.lights) this.scene.lights.removeLight(l.light);
      this.lights = [];
      this.scene.lights.disable();
    }
    for (const object of this.objects) this.applyPipeline(object);
  }

  applyPipeline(object) {
    if (!object.scene) return;
    if (this.active) object.setPipeline('Light2D');
    else object.resetPipeline();
  }

  /** Let a sprite or image (or every child of a container) be lit. Returns it. */
  add(object) {
    if (!this.supported || !object) return object;
    if (object.list) {
      for (const child of object.list) this.add(child);
      return object;
    }
    if (this.objects.has(object)) return object;
    this.objects.add(object);
    object.once('destroy', () => this.objects.delete(object));
    if (this.active) this.applyPipeline(object);
    return object;
  }

  /**
   * A soft dark patch on the ground right under something (enhanced), `width`
   * x `height` map pixels at its darkest `alpha` in the middle: it sits the
   * thing on the floor under the original's sharper directional shadow.
   */
  contactShadow(depth, width, height, alpha) {
    const key = 'fx:contact';
    const textures = this.scene.textures;
    if (!textures.exists(key)) {
      const size = 64;
      const canvas = textures.createCanvas(key, size, size);
      const ctx = canvas.getContext();
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      for (const [at, a] of [[0, 1], [0.35, 0.8], [0.7, 0.3], [1, 0]]) g.addColorStop(at, `rgba(0,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      canvas.refresh();
    }
    return this.scene.add.image(0, 0, key).setDisplaySize(width, height).setAlpha(alpha).setDepth(depth).setVisible(false);
  }

  /**
   * A light at (x, y) in map pixels: `intensity` at first, fading out over
   * `life` ms (an explosion's flickers as it fades), starting after `delay` ms.
   */
  flash(x, y, { radius = 100, color = 0xffc060, intensity = 1, life = 100, flicker = false, delay = 0 } = {}) {
    if (!this.active) return;
    while (this.lights.length >= MAX_LIGHTS) this.scene.lights.removeLight(this.lights.shift().light);
    const light = this.scene.lights.addLight(x, y, radius, color, delay > 0 ? 0 : intensity);
    this.lights.push({ light, born: performance.now() + delay, life, intensity, flicker });
  }

  update(now = performance.now()) {
    if (!this.lights.length) return;
    this.lights = this.lights.filter((l) => {
      const t = (now - l.born) / l.life;
      if (t >= 1) {
        this.scene.lights.removeLight(l.light);
        return false;
      }
      if (t < 0) return true; // not lit yet
      const fade = (1 - t) * (1 - t);
      l.light.intensity = l.intensity * fade * (l.flicker ? 0.85 + Math.random() * 0.3 : 1);
      return true;
    });
  }

  destroy() {
    for (const l of this.lights) this.scene.lights?.removeLight(l.light);
    this.lights = [];
    this.objects.clear();
  }
}
