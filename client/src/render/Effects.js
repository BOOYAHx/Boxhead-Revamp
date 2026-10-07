// Short-lived combat effects: bullet tracer lines (TracerLine), blood on the
// ground (Blood, Map.addBlood), muzzle smoke (Smoke), ejected shell casings
// (ShellCasing) and positional sounds (AreaSound). With "Enhanced Graphics"
// on there are also light from muzzle flashes, glowing tracers, sparks where
// bullets hit walls, and blood spray.

import { CELL_HEIGHT, CELL_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { createSprite, hasSprite, showFrame } from './assets.js';
import { DEPTH_SHADOWS } from './MapView.js';

const TRACER_TIME = 80; // ms (TracerLine.TIME)
const TRACER_COLOR = 0xffffff;
const TRACER_ALPHA = 0.4;
const TRACER_WIDTH = 0.7;
const DEPTH_TRACERS = 9500;
const DEPTH_LIGHT = 9400;

const BLOOD_DAMAGE_PER_SPLAT = 5; // Blood.DAMAGE_PER_SPLAT
const BLOOD_COLOR = 0x900204; // Blood.COLOR
const BLOOD_ALPHA = 0.1; // Blood.ALPHA, per splat
const BLOOD_WIDTH = 48;
const BLOOD_HEIGHT = 34;
const BLOOD_VARIANTS = 4;
const MAX_DECALS = 600; // oldest blood and shells are removed after this
const DEPTH_BLOOD = DEPTH_SHADOWS - 0.5;

const SMOKE_LIFE = 450; // ms (Smoke.lifeSpan)
const SHELL_SPEED = 5e-5; // ShellCasing.SPEED_MULTIPLIER
const SHELL_FRAMES = 6;

const VOLUME_RANGE = 10; // cells (AreaSound)
const VOLUME_MIN = 0.25;
const PAN_RANGE = 5;
const GAME_VOLUME = 0.7; // SoundControl.GAME_VOLUME

const px = (pos) => ({ x: pos.x * CELL_WIDTH, y: pos.y * CELL_HEIGHT });

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.tracerGraphics = scene.add.graphics().setDepth(DEPTH_TRACERS);
    this.decals = [];
    this.particles = []; // { update(now) -> false when finished, destroy() }
    this.focus = { x: 0, y: 0 }; // where the listener is (the local player)
    const fx = scene.registry.get('fx') || {};
    this.bloodKeys = fx.blood?.length ? fx.blood : makeBloodTextures(scene);
    this.smokeFrames = fx.smoke || [];
  }

  /** The effects' clock (ms); tests may slow it down. */
  now() {
    return performance.now();
  }

  get enhanced() {
    return Preferences.enhanced;
  }

  /** TracerLine: a thin white line from the muzzle that fades out in 80 ms. */
  addTracer(line) {
    if (line.length <= 0) return;
    this.tracers.push({ ...line, end: this.now() + TRACER_TIME });
  }

  /** Map.addBlood: one splat per 5 points of damage, remainders carried per character. */
  addBlood(character, damage, angle = null) {
    if (this.enhanced) this.addBloodSpray(character, damage, angle);
    if (!Preferences.blood) return;
    damage += character.bloodWaiting || 0;
    const splats = Math.floor(damage / BLOOD_DAMAGE_PER_SPLAT);
    character.bloodWaiting = damage - splats * BLOOD_DAMAGE_PER_SPLAT;
    const { x, y } = px(character.pos);
    for (let i = 0; i < splats; i++) {
      const sx = x + Math.round((Math.random() - 0.5) * 15);
      const sy = y + Math.round((Math.random() - 0.5) * 10);
      const key = this.bloodKeys[Math.floor(Math.random() * this.bloodKeys.length)];
      this.addDecal(this.scene.add.image(sx, sy, key).setDepth(DEPTH_BLOOD));
    }
  }

  addDecal(image) {
    this.decals.push(image);
    if (this.decals.length > MAX_DECALS) this.decals.shift().destroy();
  }

  /**
   * Weapon.smokeAndShell for a shot being shown: smoke from the barrel and a
   * shell casing thrown out of the gun (each with its original option), plus
   * the enhanced light and sparks.
   */
  addShotEffects(weapon, effects) {
    const { shot, distance } = effects;
    const dir = { x: Math.cos(shot.angle), y: Math.sin(shot.angle) };
    if (Preferences.smoke) this.addSmoke(shot, dir, distance, weapon);
    if (Preferences.shells) this.addShell(shot, dir, weapon);
    if (!this.enhanced) return;
    this.addMuzzleLight(effects.muzzle, weapon.barrelAltitude);
    if (distance < shot.range - 0.01) {
      const end = { x: shot.start.x + dir.x * distance, y: shot.start.y + dir.y * distance };
      this.addSparks(end, shot.altitude, shot.angle);
    }
  }

  /** Smoke: a soft streak along the shot that drifts up and fades (450 ms). */
  addSmoke(shot, dir, distance, weapon) {
    if (!this.smokeFrames.length) return;
    const frame = this.smokeFrames[Math.floor(Math.random() * this.smokeFrames.length)];
    const size = weapon.smokeSize;
    const start = { x: shot.start.x + dir.x * weapon.smokeDistance, y: shot.start.y + dir.y * weapon.smokeDistance };
    const angle = shot.angle + (Math.random() - 0.5) * 0.05;
    const length = Math.min(size, distance);
    const scale = (size * CELL_WIDTH) / frame.graphicWidth;
    const masked = Math.min((length / size) * frame.graphicWidth + 5, frame.graphicWidth);
    const sin = Math.sin(angle);
    const squash = Math.abs(sin) < 0.1 ? 1 : CELL_HEIGHT / CELL_WIDTH;
    const depth = Math.max(start.y, start.y + sin * length);
    const holder = this.scene.add.container(start.x * CELL_WIDTH, start.y * CELL_HEIGHT).setDepth(depth).setScale(1, squash);
    const image = this.scene.add.image(0, 0, frame.key).setOrigin(frame.originX, frame.originY).setRotation(angle);
    holder.add(image);
    const born = this.now();
    const climb = Math.max(0.02, (scale * scale - 1) * 0.05);
    const altitude = shot.altitude;
    this.particles.push({
      update: (now) => {
        const time = now - born;
        const progress = time / SMOKE_LIFE;
        if (progress >= 1) return false;
        const slide = progress * 0.1 * frame.graphicWidth;
        const scaleX = scale * (1 - progress * 0.3);
        image.setScale(scaleX, scale);
        image.setPosition(Math.cos(angle) * slide * scaleX, Math.sin(angle) * slide * scaleX);
        if (masked < frame.graphicWidth) image.setCrop(0, 0, frame.pad + masked - slide, frame.height);
        holder.y = start.y * CELL_HEIGHT - (altitude + time * climb);
        holder.setAlpha((1 - progress) * (1 - progress));
        return true;
      },
      destroy: () => holder.destroy(),
    });
  }

  /** ShellCasing: thrown back past the hand, arcs up and lands, then stays on the ground. */
  addShell(shot, dir, weapon) {
    if (!hasSprite('ShellCasing1')) return;
    const pos = { x: shot.start.x + dir.x * weapon.shellDistance, y: shot.start.y + dir.y * weapon.shellDistance };
    const angle = Math.PI + shot.angle - weapon.handMultiplier * 0.5;
    const velocity = weapon.shellVelocity;
    const vx = (Math.cos(angle) + 0.2 - 0.4 * Math.random()) * velocity * SHELL_SPEED;
    const vy = (Math.sin(angle) + 0.2 - 0.4 * Math.random()) * velocity * SHELL_SPEED;
    const startFrame = Math.floor(Math.random() * SHELL_FRAMES);
    const maxAltitude = shot.altitude + velocity;
    const sprite = createSprite(this.scene, 'ShellCasing1', startFrame);
    const born = this.now() - 25;
    let landed = false;
    const place = (time, altitude, frame) => {
      const x = (pos.x + vx * time) * CELL_WIDTH;
      const y = (pos.y + vy * time) * CELL_HEIGHT;
      showFrame(sprite, 'ShellCasing1', frame, Math.round(x), Math.round(y - altitude));
      sprite.setDepth(landed ? DEPTH_BLOOD + 0.1 : y / CELL_HEIGHT);
    };
    this.particles.push({
      update: (now) => {
        const time = now - born;
        const frame = (startFrame + Math.floor(time / 100)) % SHELL_FRAMES;
        const k = Math.abs(time - 200) / 200;
        const altitude = Math.max(0, maxAltitude - k * k * velocity);
        if (altitude <= 0 && time > 200) {
          landed = true;
          place(time, 0, frame);
          this.addDecal(sprite);
          return false;
        }
        place(time, altitude, frame);
        return true;
      },
      destroy: () => !landed && sprite.destroy(),
    });
  }

  /** Enhanced: a short warm light around the muzzle flash. */
  addMuzzleLight(muzzle, altitude) {
    const { x, y } = px(muzzle);
    const light = this.scene.add.image(x, y - altitude, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc060).setDepth(DEPTH_LIGHT).setScale(0.7, 0.55);
    const floor = this.scene.add.image(x, y, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xff9a40).setDepth(DEPTH_BLOOD + 0.2).setScale(1.2, 0.85);
    this.fade([light, floor], 110, [0.4, 0.25]);
  }

  /** Enhanced: sparks and a puff of dust where a bullet hits a wall. */
  addSparks(pos, altitude, angle) {
    const { x, y } = px(pos);
    const sy = y - altitude;
    const flash = this.scene.add.image(x, sy, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe0a0).setScale(0.35).setDepth(DEPTH_LIGHT);
    this.fade([flash], 90, [0.8]);
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const a = angle + Math.PI + (Math.random() - 0.5) * 2.2;
      const speed = 0.08 + Math.random() * 0.14; // px per ms
      const life = 120 + Math.random() * 160;
      const spark = this.scene.add.image(x, sy, 'fx:spark').setBlendMode(Phaser.BlendModes.ADD).setTint(Math.random() < 0.5 ? 0xffd070 : 0xffffff).setDepth(DEPTH_LIGHT + 1);
      const born = this.now();
      const vx = Math.cos(a) * speed;
      const vy = Math.sin(a) * speed * 0.7 - 0.05;
      this.particles.push({
        update: (now) => {
          const t = now - born;
          if (t >= life) return false;
          const k = 1 - t / life;
          spark.setPosition(x + vx * t, sy + vy * t + 0.0004 * t * t);
          spark.setScale(0.8 * k + 0.25, 0.4 * k + 0.15);
          spark.setRotation(Math.atan2(vy + 0.0008 * t, vx));
          spark.setAlpha(k);
          return true;
        },
        destroy: () => spark.destroy(),
      });
    }
    // A little dust off the wall.
    const dust = this.scene.add.image(x, sy, 'fx:glow').setTint(0x9a9080).setDepth(DEPTH_LIGHT - 1).setScale(0.25);
    const born = this.now();
    this.particles.push({
      update: (now) => {
        const t = now - born;
        if (t >= 400) return false;
        const k = t / 400;
        dust.setPosition(x - Math.cos(angle) * 6 * k, sy - 8 * k);
        dust.setScale(0.25 + 0.35 * k);
        dust.setAlpha(0.35 * (1 - k));
        return true;
      },
      destroy: () => dust.destroy(),
    });
  }

  /** Enhanced: drops of blood thrown from a hit, falling to the floor. */
  addBloodSpray(character, damage, angle) {
    if (!Preferences.blood) return;
    const { x, y } = px(character.pos);
    const count = Math.min(10, 3 + Math.round(damage / 3));
    for (let i = 0; i < count; i++) {
      const a = (angle ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 1.6;
      const speed = 0.03 + Math.random() * 0.06;
      const height = 20 + Math.random() * 12;
      const up = 0.05 + Math.random() * 0.08;
      const drop = this.scene.add.image(x, y - height, 'fx:spark').setTint(0x8a0000).setDepth(y / CELL_HEIGHT + 0.01).setScale(0.35 + Math.random() * 0.3);
      const born = this.now();
      this.particles.push({
        update: (now) => {
          const t = now - born;
          const altitude = height + up * t - 0.0006 * t * t;
          if (altitude <= 0 || t > 800) return false;
          drop.setPosition(x + Math.cos(a) * speed * t, y + Math.sin(a) * speed * t * 0.7 - altitude);
          return true;
        },
        destroy: () => drop.destroy(),
      });
    }
  }

  fade(images, duration, alphas) {
    const born = this.now();
    this.particles.push({
      update: (now) => {
        const k = 1 - (now - born) / duration;
        if (k <= 0) return false;
        images.forEach((image, i) => image.setAlpha(alphas[i] * k));
        return true;
      },
      destroy: () => images.forEach((image) => image.destroy()),
    });
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
    const now = this.now();
    this.particles = this.particles.filter((p) => {
      if (p.update(now)) return true;
      p.destroy();
      return false;
    });
    const g = this.tracerGraphics;
    g.clear();
    this.tracers = this.tracers.filter((t) => t.end > now);
    for (const t of this.tracers) {
      const k = (t.end - now) / TRACER_TIME;
      const alpha = (1 - Math.pow(1 - k, 1.5)) * TRACER_ALPHA;
      const x = t.x * CELL_WIDTH;
      const y = t.y * CELL_HEIGHT - t.altitude;
      const x2 = x + t.dx * t.length * CELL_WIDTH;
      const y2 = y + t.dy * t.length * CELL_HEIGHT;
      if (this.enhanced) {
        // A faint warm glow around the line.
        g.lineStyle(3, 0xffe0a0, alpha * 0.35);
        g.lineBetween(x, y, x2, y2);
      }
      g.lineStyle(TRACER_WIDTH, TRACER_COLOR, alpha);
      g.lineBetween(x, y, x2, y2);
    }
  }

  destroy() {
    for (const p of this.particles) p.destroy();
    this.particles = [];
    this.tracerGraphics.destroy();
    for (const image of this.decals) image.destroy();
    this.decals = [];
  }
}

/**
 * Stand-in splats for asset builds without fx.json (made before the graphics
 * step): faint, blotchy blood-coloured shapes.
 */
function makeBloodTextures(scene) {
  const keys = [];
  for (let v = 0; v < BLOOD_VARIANTS; v++) {
    const key = 'fx:bloodold' + v;
    keys.push(key);
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
  return keys;
}
