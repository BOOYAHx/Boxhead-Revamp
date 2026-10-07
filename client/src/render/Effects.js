// Short-lived combat effects: bullet tracer lines (TracerLine), blood on the
// ground (Blood, Map.addBlood) and positional sounds (AreaSound).

import { CELL_HEIGHT, CELL_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { DEPTH_SHADOWS } from './MapView.js';

const TRACER_TIME = 80; // ms (TracerLine.TIME)
const TRACER_COLOR = 0xffffff;
const TRACER_ALPHA = 0.4;
const TRACER_WIDTH = 0.7;
const DEPTH_TRACERS = 9500;

const BLOOD_DAMAGE_PER_SPLAT = 5; // Blood.DAMAGE_PER_SPLAT
const BLOOD_COLOR = 0x900204; // Blood.COLOR
const BLOOD_ALPHA = 0.1; // Blood.ALPHA, per splat
const BLOOD_WIDTH = 48;
const BLOOD_HEIGHT = 34;
const BLOOD_VARIANTS = 4;
const MAX_BLOOD = 400; // oldest splats are removed after this
const DEPTH_BLOOD = DEPTH_SHADOWS - 0.5;

const VOLUME_RANGE = 10; // cells (AreaSound)
const VOLUME_MIN = 0.25;
const PAN_RANGE = 5;
const GAME_VOLUME = 0.7; // SoundControl.GAME_VOLUME

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.tracerGraphics = scene.add.graphics().setDepth(DEPTH_TRACERS);
    this.blood = [];
    this.focus = { x: 0, y: 0 }; // where the listener is (the local player)
    makeBloodTextures(scene);
  }

  /** TracerLine: a thin white line from the muzzle that fades out in 80 ms. */
  addTracer(line) {
    if (line.length <= 0) return;
    this.tracers.push({ ...line, end: performance.now() + TRACER_TIME });
  }

  /** Map.addBlood: one splat per 5 points of damage, remainders carried per character. */
  addBlood(character, damage) {
    if (!Preferences.blood) return;
    damage += character.bloodWaiting || 0;
    const splats = Math.floor(damage / BLOOD_DAMAGE_PER_SPLAT);
    character.bloodWaiting = damage - splats * BLOOD_DAMAGE_PER_SPLAT;
    const x = character.pos.x * CELL_WIDTH;
    const y = character.pos.y * CELL_HEIGHT;
    for (let i = 0; i < splats; i++) {
      const sx = x + Math.round((Math.random() - 0.5) * 15);
      const sy = y + Math.round((Math.random() - 0.5) * 10);
      const key = 'fx:blood' + Math.floor(Math.random() * BLOOD_VARIANTS);
      this.blood.push(this.scene.add.image(sx, sy, key).setDepth(DEPTH_BLOOD));
      if (this.blood.length > MAX_BLOOD) this.blood.shift().destroy();
    }
  }

  /** SoundControl.playAreaSound: quieter and panned with distance from the listener. */
  playSound(name, pos, delay = 0) {
    const key = 'snd:' + name;
    if (!name || !this.scene.cache.audio.exists(key)) return;
    const distance = Math.hypot(pos.x - this.focus.x, pos.y - this.focus.y);
    const volume = (VOLUME_MIN + Math.max(0, Math.min(1, (VOLUME_RANGE - distance) / VOLUME_RANGE)) * (1 - VOLUME_MIN)) * GAME_VOLUME;
    const pan = Math.max(-1, Math.min(1, (pos.x - this.focus.x) / PAN_RANGE));
    try {
      this.scene.sound.play(key, { volume, pan, delay: delay / 1000 });
    } catch (error) {
      // Audio can be unavailable (autoplay rules, no device); the game goes on.
    }
  }

  update() {
    const g = this.tracerGraphics;
    g.clear();
    const now = performance.now();
    this.tracers = this.tracers.filter((t) => t.end > now);
    for (const t of this.tracers) {
      const k = (t.end - now) / TRACER_TIME;
      const alpha = (1 - Math.pow(1 - k, 1.5)) * TRACER_ALPHA;
      const x = t.x * CELL_WIDTH;
      const y = t.y * CELL_HEIGHT - t.altitude;
      g.lineStyle(TRACER_WIDTH, TRACER_COLOR, alpha);
      g.lineBetween(x, y, x + t.dx * t.length * CELL_WIDTH, y + t.dy * t.length * CELL_HEIGHT);
    }
  }

  destroy() {
    this.tracerGraphics.destroy();
    for (const image of this.blood) image.destroy();
    this.blood = [];
  }
}

/**
 * Blood.prerender drew a vector splat over Perlin noise; that MovieClip is not
 * in the extracted assets, so build similar faint, blotchy splats once.
 */
function makeBloodTextures(scene) {
  for (let v = 0; v < BLOOD_VARIANTS; v++) {
    const key = 'fx:blood' + v;
    if (scene.textures.exists(key)) continue;
    const canvas = scene.textures.createCanvas(key, BLOOD_WIDTH, BLOOD_HEIGHT);
    const ctx = canvas.getContext();
    const r = (BLOOD_COLOR >> 16) & 255;
    const g = (BLOOD_COLOR >> 8) & 255;
    const b = BLOOD_COLOR & 255;
    for (let i = 0; i < 14; i++) {
      const cx = BLOOD_WIDTH / 2 + (Math.random() - 0.5) * BLOOD_WIDTH * 0.6;
      const cy = BLOOD_HEIGHT / 2 + (Math.random() - 0.5) * BLOOD_HEIGHT * 0.6;
      const radius = 3 + Math.random() * 9;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${BLOOD_ALPHA * 2.5})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    canvas.refresh();
  }
}
