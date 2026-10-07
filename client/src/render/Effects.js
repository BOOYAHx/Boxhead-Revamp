// Short-lived combat effects: bullet tracer lines (TracerLine), blood on the
// ground (Blood, Map.addBlood), muzzle smoke (Smoke), ejected shell casings
// (ShellCasing, ShotgunShell), the flamer's fire (Fire) and positional sounds
// (AreaSound). With "Enhanced Graphics" on there are also light from muzzle
// flashes, glowing tracers, sparks where bullets hit walls, and blood spray.

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
const SHELL_VELOCITY = 10; // Weapon.smokeAndShell always throws shells at 10
const SHELLS = { ShellCasing1: 6, ShotgunShell: 8 }; // sprite -> frames
const FIRE_FRAME_TIME = 1000 / 50; // ms (Fire.FRAME_RATE)
const FIRE_LIFE = 1000; // ms (Particle.lifeSpan)
const SECOND_TICKS = 20;

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
    this.bloodRes = fx.blood?.length ? fx.bloodRes || 1 : 1; // texture pixels per game pixel
    this.smokeFrames = fx.smoke || [];
    this.fireDisplays = fx.fire || [];
    this.sounds = new Set(); // playing sounds, stopped with the scene
  }

  /** The effects' clock (ms); tests may slow it down. */
  now() {
    return performance.now();
  }

  get enhanced() {
    return Preferences.enhanced;
  }

  /** Lightweight blast sprites drawn in code; no new asset build required. */
  equipmentEffect(event) {
    const { type, pos } = event;
    if (type === 'bounce') { this.playSound('Grenade_Bounce', pos); return; }
    if (type === 'mine') { this.playSound('ClaymoreActivate', pos); return; }
    const plasma = type === 'plasma';
    this.playSound(plasma ? 'PlasmaCannonHit' : event.radius >= 6 ? 'ExplosionHuge' : 'ExplosionGrenade', pos);
    const x = pos.x * CELL_WIDTH, y = pos.y * CELL_HEIGHT - (event.altitude || 0);
    const graphic = this.scene.add.graphics().setDepth(9501);
    const start = this.now(), life = plasma ? 280 : 650;
    const radius = plasma ? 25 : type === 'debris' ? 25 : 28 + (event.radius || 3) * 8;
    const enhanced = this.enhanced;
    this.particles.push({
      destroy: () => graphic.destroy(),
      update: (now) => {
        const t = (now - start) / life;
        if (t >= 1) return false;
        graphic.clear();
        const r = radius * (0.2 + Math.sqrt(t));
        if (enhanced) {
          graphic.fillStyle(plasma ? 0x67dfff : 0xff9d42, (1 - t) * 0.12).fillEllipse(x, y, r * 3, r * 2);
          graphic.lineStyle(2, plasma ? 0x91efff : 0xffcd8a, (1 - t) * 0.7).strokeEllipse(x, y, r * 2, r * 1.4);
        }
        for (let i = 0; i < 7; i++) {
          const a = i * Math.PI * 2 / 7;
          graphic.fillStyle(plasma ? 0x58caf1 : t < 0.3 ? 0xffa43c : 0x4f4c48, (1 - t) * 0.8);
          graphic.fillCircle(x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.3 - t * 15, r * 0.3);
        }
        graphic.fillStyle(plasma ? 0xd9ffff : 0xffefb0, Math.max(0, 1 - t * 3)).fillCircle(x, y, r * 0.38);
        return true;
      },
    });
    if (type === 'explosion' && Preferences.shake) {
      const distance = Math.hypot(pos.x - this.focus.x, pos.y - this.focus.y);
      if (distance < 10) this.scene.cameras.main.shake(180, 0.003 * (1 - distance / 10) / this.scene.cameras.main.zoom ** 2);
    }
  }

  /** TracerLine: a thin line from the muzzle that fades out in 80 ms (white; the Railgun's purple). */
  addTracer(line) {
    if (line.length <= 0) return;
    this.tracers.push({ color: TRACER_COLOR, alpha: TRACER_ALPHA, ...line, end: this.now() + TRACER_TIME });
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
      this.addDecal(this.scene.add.image(sx, sy, key).setDepth(DEPTH_BLOOD).setScale(1 / this.bloodRes));
    }
  }

  addDecal(image) {
    this.decals.push(image);
    if (this.decals.length > MAX_DECALS) this.decals.shift().destroy();
  }

  /**
   * Weapon.getParticles for a shot being shown: smoke from the barrel and a
   * shell casing (smokeAndShell), the shotgun's shell and five puffs, the
   * Railgun's smoke trail or the Flamer's fire; plus the enhanced light and
   * sparks. Smoke and shells each have their own option.
   */
  addShotEffects(weapon, effects) {
    const { shot, distances } = effects;
    const rays = shot.tracers.map((t, i) => ({ ...t, distance: distances[i], dx: Math.cos(t.angle), dy: Math.sin(t.angle) }));
    if (!rays.length) return;
    const smoke = (ray, spread, d = weapon.smokeDistance, size = weapon.smokeSize, length = ray.distance, altitude = weapon.barrelAltitude) =>
      Preferences.smoke && this.addSmoke({ x: ray.start.x + ray.dx * d, y: ray.start.y + ray.dy * d }, ray.angle + (Math.random() - 0.5) * spread, size, length, altitude);
    const shell = (ray, sprite) =>
      Preferences.shells &&
      this.addShell({ x: ray.start.x + ray.dx * weapon.shellDistance, y: ray.start.y + ray.dy * weapon.shellDistance }, Math.PI + ray.angle - effects.hand * 0.5, weapon.barrelAltitude, sprite);
    switch (weapon.particles) {
      case 'smokeAndShell':
        smoke(rays[0], 0.05);
        shell(rays[0], 'ShellCasing1');
        break;
      case 'shotgun':
        if (rays.length === 5) shell(rays[2], 'ShotgunShell');
        for (const ray of rays) smoke(ray, 0.2);
        break;
      case 'smokeTrail': {
        const ray = rays[0];
        for (let d = weapon.smokeDistance; d < ray.distance; d += 3) smoke(ray, 0.05, d, 3, ray.distance - d, weapon.barrelAltitude + 2);
        break;
      }
      case 'fire':
        if (rays.length >= 5 && weapon.takeFireBurst()) this.addFire(weapon, effects.muzzle, rays[2]);
        break;
      default:
        break;
    }
    if (!this.enhanced) return;
    if (weapon.flamer) this.addMuzzleLight(effects.muzzle, weapon.barrelAltitude, 0xff8030, 0.6);
    else if (weapon.muzzleFlashes.length) this.addMuzzleLight(effects.muzzle, weapon.barrelAltitude, weapon.tracerColor === TRACER_COLOR ? 0xffc060 : weapon.tracerColor);
    if (weapon.flamer) return;
    rays.forEach((ray, i) => {
      if (ray.distance >= ray.range - 0.01) return;
      const end = { x: ray.start.x + ray.dx * ray.distance, y: ray.start.y + ray.dy * ray.distance };
      this.addSparks(end, ray.altitude, ray.angle, rays.length > 1 ? 3 : 0, i);
    });
  }

  /** Smoke: a soft streak (at most `size` cells, not past `distance`) that drifts up and fades (450 ms). */
  addSmoke(start, angle, size, distance, altitude) {
    if (!this.smokeFrames.length) return;
    const frame = this.smokeFrames[Math.floor(Math.random() * this.smokeFrames.length)];
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
    this.particles.push({
      update: (now) => {
        const time = now - born;
        const progress = time / SMOKE_LIFE;
        if (progress >= 1) return false;
        const slide = progress * 0.1 * frame.graphicWidth;
        const scaleX = scale * (1 - progress * 0.3);
        const res = frame.res || 1;
        image.setScale(scaleX / res, scale / res);
        image.setPosition(Math.cos(angle) * slide * scaleX, Math.sin(angle) * slide * scaleX);
        if (masked < frame.graphicWidth) image.setCrop(0, 0, (frame.pad + masked - slide) * res, frame.height * res);
        holder.y = start.y * CELL_HEIGHT - (altitude + time * climb);
        holder.setAlpha((1 - progress) * (1 - progress));
        return true;
      },
      destroy: () => holder.destroy(),
    });
  }

  /** ShellCasing / ShotgunShell: thrown back past the hand, arcs up and lands, then stays on the ground. */
  addShell(pos, angle, altitude, sprite = 'ShellCasing1') {
    if (!hasSprite(sprite)) return;
    const frames = SHELLS[sprite] || 6;
    const velocity = SHELL_VELOCITY;
    const vx = (Math.cos(angle) + 0.2 - 0.4 * Math.random()) * velocity * SHELL_SPEED;
    const vy = (Math.sin(angle) + 0.2 - 0.4 * Math.random()) * velocity * SHELL_SPEED;
    const startFrame = Math.floor(Math.random() * frames);
    const maxAltitude = altitude + velocity;
    const image = createSprite(this.scene, sprite, startFrame);
    const born = this.now() - 25;
    let landed = false;
    const place = (time, height, frame) => {
      const x = (pos.x + vx * time) * CELL_WIDTH;
      const y = (pos.y + vy * time) * CELL_HEIGHT;
      showFrame(image, sprite, frame, Math.round(x), Math.round(y - height));
      image.setDepth(landed ? DEPTH_BLOOD + 0.1 : y / CELL_HEIGHT);
    };
    this.particles.push({
      update: (now) => {
        const time = now - born;
        const frame = (startFrame + Math.floor(time / 100)) % frames;
        const k = Math.abs(time - 200) / 200;
        const height = Math.max(0, maxAltitude - k * k * velocity);
        if (height <= 0 && time > 200) {
          landed = true;
          place(time, 0, frame);
          this.addDecal(image);
          return false;
        }
        place(time, height, frame);
        return true;
      },
      destroy: () => !landed && image.destroy(),
    });
  }

  /**
   * Flamer.getParticles: ten flames along the stream, small at the ends and
   * large in the middle, each drifting forward and up until it burns out.
   */
  addFire(weapon, muzzle, ray) {
    if (!this.fireDisplays.length) return;
    const maxLength = weapon.range - weapon.barrelDistance;
    const length = Math.max(0, Math.min(maxLength, ray.distance - weapon.barrelDistance));
    for (let i = 0; i < 10; i++) {
      const d = ((i + 0.5) * maxLength) / 10;
      if (d > length) break;
      const size = i <= 2 || i >= 9 ? 0 : i <= 3 || i >= 7 ? 1 : 2;
      this.addFlame({ x: muzzle.x + ray.dx * d, y: muzzle.y + ray.dy * d }, 20 - 2 * size, ray, (0.02 * (10 - i)) / 10, length - d, size);
    }
  }

  /** Fire: one pre-rendered flame playing at 50 frames a second. */
  addFlame(pos, startAltitude, dir, speed, maxDistance, size) {
    const variants = this.fireDisplays[size];
    if (!variants?.length) return;
    const frames = variants[Math.floor(Math.random() * variants.length)];
    const image = this.scene.add.image(0, 0, frames[0].key, frames[0].frame).setOrigin(0, 0).setScale(1 / (frames[0].res || 1));
    const born = this.now();
    this.particles.push({
      update: (now) => {
        const time = now - born;
        const distance = (time / 1000) * SECOND_TICKS * speed;
        const frame = Math.floor(time / FIRE_FRAME_TIME);
        if (distance > maxDistance || frame >= frames.length || time > FIRE_LIFE) return false;
        const f = frames[frame];
        const x = (pos.x + dir.dx * distance) * CELL_WIDTH;
        const y = (pos.y + dir.dy * distance) * CELL_HEIGHT;
        image.setFrame(f.frame);
        image.setPosition(Math.round(x + f.dx), Math.round(y + f.dy - Math.trunc(startAltitude + time / 60)));
        image.setDepth(y / CELL_HEIGHT);
        return true;
      },
      destroy: () => image.destroy(),
    });
  }

  /** Enhanced: a short warm light around the muzzle flash. */
  addMuzzleLight(muzzle, altitude, color = 0xffc060, strength = 1) {
    const { x, y } = px(muzzle);
    const light = this.scene.add.image(x, y - altitude, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(color).setDepth(DEPTH_LIGHT).setScale(0.7, 0.55);
    const floor = this.scene.add.image(x, y, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(color === 0xffc060 ? 0xff9a40 : color).setDepth(DEPTH_BLOOD + 0.2).setScale(1.2, 0.85);
    this.fade([light, floor], 110, [0.4 * strength, 0.25 * strength]);
  }

  /** Enhanced: sparks and a puff of dust where a bullet hits a wall (`sparks` 0: a random handful). */
  addSparks(pos, altitude, angle, sparks = 0) {
    const { x, y } = px(pos);
    const sy = y - altitude;
    const flash = this.scene.add.image(x, sy, 'fx:glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe0a0).setScale(0.35).setDepth(DEPTH_LIGHT);
    this.fade([flash], 90, [0.8]);
    const count = sparks || 5 + Math.floor(Math.random() * 4);
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

  /** AreaSound: quieter and panned with distance from the listener. */
  soundLevels(pos) {
    const distance = Math.hypot(pos.x - this.focus.x, pos.y - this.focus.y);
    const volume = (VOLUME_MIN + Math.max(0, Math.min(1, (VOLUME_RANGE - distance) / VOLUME_RANGE)) * (1 - VOLUME_MIN)) * GAME_VOLUME;
    const pan = Math.max(-1, Math.min(1, (pos.x - this.focus.x) / PAN_RANGE));
    return { volume, pan };
  }

  /**
   * SoundControl.playAreaSound. Returns the sound, which can be stopped
   * (or null when it does not exist or audio is unavailable).
   */
  playSound(name, pos, delay = 0, { loop = false } = {}) {
    const key = 'snd:' + name;
    if (!name || !this.scene.cache.audio.exists(key)) return null;
    try {
      const sound = this.scene.sound.add(key);
      this.sounds.add(sound);
      const done = () => {
        this.sounds.delete(sound);
        sound.destroy();
      };
      sound.once('complete', done);
      sound.once('stop', done);
      sound.play({ ...this.soundLevels(pos), delay: delay / 1000, loop });
      return sound;
    } catch (error) {
      return null; // Audio can be unavailable (autoplay rules, no device); the game goes on.
    }
  }

  /** Keep a playing sound (a weapon loop) at the right volume as things move. */
  moveSound(sound, pos) {
    if (!sound || !this.sounds.has(sound)) return;
    const { volume, pan } = this.soundLevels(pos);
    sound.setVolume?.(volume);
    sound.setPan?.(pan);
  }

  stopSound(sound) {
    if (sound && this.sounds.has(sound)) sound.stop();
  }

  /** How long a sound lasts, in ms (0 if unknown). */
  soundLength(name) {
    const audio = name && this.scene.cache.audio.get('snd:' + name);
    return audio?.duration ? audio.duration * 1000 : 0;
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
      const x = t.x * CELL_WIDTH;
      const y = t.y * CELL_HEIGHT - t.altitude;
      const x2 = x + t.dx * t.length * CELL_WIDTH;
      const y2 = y + t.dy * t.length * CELL_HEIGHT;
      const alpha = (1 - Math.pow(1 - k, 1.5)) * t.alpha;
      if (this.enhanced) {
        // A faint glow around the line.
        g.lineStyle(3, t.color === TRACER_COLOR ? 0xffe0a0 : t.color, alpha * 0.35);
        g.lineBetween(x, y, x2, y2);
      }
      g.lineStyle(TRACER_WIDTH, t.color, alpha);
      g.lineBetween(x, y, x2, y2);
    }
  }

  destroy() {
    for (const sound of [...this.sounds]) sound.stop();
    this.sounds.clear();
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
