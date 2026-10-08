// Explosions for the grenades, Grenade Launcher, C4, mines, airstrikes and
// barrels. The blasts are laid out like the original (Projectile /
// Deployable / Barrel / AirstrikeBeacon .explode: a main fireball with
// smaller ones around it, an airstrike's rings of them), and each one is
// drawn in layers: a white-hot flash lighting the ground, a shockwave ring
// and a skirt of dust, a churning fireball that cools to red and goes out,
// thick smoke rising behind it, sparks, glowing embers and smoking debris,
// and a scorch mark left on the floor. All the textures are made here in
// code (soft noise puffs), so no asset build is needed.

import { CELL_HEIGHT, CELL_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { WeaponID } from '../game/weapons.js';
import { DEPTH_SHADOWS } from './MapView.js';

const DEPTH_GROUND = DEPTH_SHADOWS - 0.4; // scorch marks, over the blood
const DEPTH_GROUND_GLOW = DEPTH_SHADOWS - 0.3;
const DEPTH_TOP = 9450; // the flash, over everything but the HUD
const MAX_PARTICLES = 2500; // a hard cap so chain reactions can't stall the game
const MAX_SCORCHES = 120;
const VARIANTS = 4;
const PUFF = 128; // texture size of a smoke or fire puff
const BARREL_ID = 99; // equipment.js: a barrel's blast

// What each weapon's blast looks like (sizes relative to a grenade).
const KINDS = {
  grenade: { size: 1, fire: 1, smoke: 1, sparks: 1, debris: 1, sound: 'ExplosionGrenade', cluster: 'corners', shake: [260, 0.006] },
  launcher: { size: 1.05, fire: 1, smoke: 1, sparks: 1.2, debris: 1, sound: 'ExplosionGrenade', cluster: 'corners', shake: [260, 0.006] },
  c4: { size: 1.3, fire: 1.2, smoke: 1.3, sparks: 1.4, debris: 1.8, sound: 'ChargePackExplosion', cluster: 'corners', shake: [380, 0.009] },
  mine: { size: 1.1, fire: 0.9, smoke: 0.9, sparks: 2, debris: 1.2, sound: 'ClaymoreExplosion', cluster: 'corners', shake: [280, 0.007] },
  barrel: { size: 1.35, fire: 1.8, smoke: 1.6, sparks: 1, debris: 1.4, sound: 'ExplosionFiery', cluster: 'barrel', burn: true, shake: [340, 0.008] },
  airstrike: { size: 1.25, fire: 0.8, smoke: 0.7, sparks: 0.6, debris: 0.6, sound: 'ExplosionHuge', cluster: 'airstrike', shake: [1500, 0.012] },
};

export function explosionKind(weaponID) {
  switch (weaponID) {
    case WeaponID.GRENADE_LAUNCHER: return 'launcher';
    case WeaponID.C4: return 'c4';
    case WeaponID.MINES: return 'mine';
    case WeaponID.AIRSTRIKE: return 'airstrike';
    case BARREL_ID: return 'barrel';
    default: return 'grenade';
  }
}

/**
 * The fireballs of one blast, as the original placed them: { dx, dy (cells),
 * altitude, delay (ms), scale (1 main, smaller for the extras) }.
 */
export function blastLayout(cluster, altitude = 0, random = Math.random) {
  const blasts = [{ dx: 0, dy: 0, altitude, delay: 0, scale: 1 }];
  if (cluster === 'corners') {
    // Projectile / Deployable.explode: four more, a cell away diagonally, 50-150 ms later.
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) blasts.push({ dx: dx * 0.8, dy: dy * 0.8, altitude: Math.max(0, altitude - 10), delay: 50 + random() * 100, scale: 0.62 });
  } else if (cluster === 'barrel') {
    // A barrel bursts open: lumps of burning fuel thrown a little way out.
    for (let i = 0; i < 3; i++) {
      const angle = random() * Math.PI * 2;
      blasts.push({ dx: Math.cos(angle) * 0.6, dy: Math.sin(angle) * 0.6, altitude: 0, delay: 30 + random() * 90, scale: 0.55 });
    }
  } else if (cluster === 'airstrike') {
    // AirstrikeBeacon.explode: twelve spokes of three, out to five cells, a ring every 100 ms.
    blasts[0].scale = 1.5;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      for (let ring = 1; ring <= 3; ring++) {
        const distance = (ring / 3) * 5 * (0.85 + random() * 0.3);
        blasts.push({ dx: Math.cos(angle + (random() - 0.5) * 0.3) * distance, dy: Math.sin(angle + (random() - 0.5) * 0.3) * distance, altitude: 0, delay: ring * 100 - random() * 100 + 60, scale: 0.75 - ring * 0.05 });
      }
    }
  }
  return blasts;
}

// --- textures --------------------------------------------------------------

function valueNoise(seed) {
  const size = 64;
  const grid = new Float32Array(size * size);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < grid.length; i++) {
    s = (s * 9301 + 49297) % 233280;
    grid[i] = s / 233280;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const sample = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = smooth(x - x0), fy = smooth(y - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
  // Fractal noise, 0-1.
  return (x, y) => {
    let total = 0, amplitude = 0.5, frequency = 1;
    for (let o = 0; o < 4; o++) {
      total += sample(x * frequency, y * frequency) * amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return total / 0.9375;
  };
}

function makeTexture(scene, key, width, height, pixel) {
  if (scene.textures.exists(key)) return;
  const canvas = scene.textures.createCanvas(key, width, height);
  const ctx = canvas.getContext();
  const data = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data.data[i] = r;
      data.data[i + 1] = g;
      data.data[i + 2] = b;
      data.data[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  }
  ctx.putImageData(data, 0, 0);
  canvas.refresh();
}

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function makeExplosionTextures(scene) {
  const half = PUFF / 2;
  for (let v = 0; v < VARIANTS; v++) {
    const noise = valueNoise(v * 7 + 3);
    const detail = valueNoise(v * 13 + 11);
    // Smoke: a billowy cloud with lumpy edges and lighter, darker folds.
    makeTexture(scene, 'xp:smoke' + v, PUFF, PUFF, (x, y) => {
      const dx = (x - half) / half, dy = (y - half) / half;
      const d = Math.hypot(dx, dy);
      const n = noise(x / 14, y / 14);
      const edge = 1 - smoothstep(0.45, 0.95, d + (n - 0.5) * 0.55);
      const shade = 0.7 + 0.3 * detail(x / 7, y / 7) - dy * 0.12; // lit from above
      const c = Math.max(0, Math.min(255, 255 * shade));
      return [c, c, c, edge * (0.55 + 0.45 * n)];
    });
    // Fire: a bright, turbulent puff, white in the middle (tinted when drawn).
    makeTexture(scene, 'xp:fire' + v, PUFF, PUFF, (x, y) => {
      const dx = (x - half) / half, dy = (y - half) / half;
      const d = Math.hypot(dx, dy);
      const n = noise(x / 11 + 5, y / 11);
      const body = 1 - smoothstep(0.25, 0.92, d + (n - 0.5) * 0.7);
      const flicker = 0.55 + 0.45 * detail(x / 5, y / 5);
      const c = 255 * Math.min(1, 0.55 + body * 0.6);
      return [c, c, c, body * flicker];
    });
  }
  // Shockwave: a thin, slightly broken ring.
  const ringNoise = valueNoise(41);
  makeTexture(scene, 'xp:ring', 256, 256, (x, y) => {
    const d = Math.hypot(x - 128, y - 128) / 128;
    const n = ringNoise(Math.atan2(y - 128, x - 128) * 6, 1);
    return [255, 255, 255, Math.exp(-(((d - 0.86) / 0.06) ** 2)) * (0.6 + 0.4 * n)];
  });
  // Scorch mark: a black burn with streaks thrown outwards.
  for (let v = 0; v < 3; v++) {
    const noise = valueNoise(v * 5 + 61);
    makeTexture(scene, 'xp:scorch' + v, 128, 128, (x, y) => {
      const dx = (x - 64) / 64, dy = (y - 64) / 64;
      const d = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const streaks = noise(angle * 5 + 10, 0.5) ** 2;
      const n = noise(x / 9, y / 9);
      const reach = 0.62 + streaks * 0.38;
      const a = (1 - smoothstep(reach * 0.2, reach, d + (n - 0.5) * 0.25)) * (0.5 + 0.5 * n);
      return [18 + 20 * n, 14 + 14 * n, 12, a * 0.9];
    });
  }
  // A spark: a short bright streak.
  makeTexture(scene, 'xp:streak', 32, 8, (x, y) => {
    const along = 1 - Math.abs((x - 16) / 16);
    const across = 1 - Math.abs((y - 3.5) / 4);
    return [255, 255, 255, Math.max(0, along) ** 1.5 * Math.max(0, across) ** 2];
  });
  // Light: a smooth falloff.
  makeTexture(scene, 'xp:light', 128, 128, (x, y) => {
    const d = Math.hypot(x - 64, y - 64) / 64;
    return [255, 255, 255, Math.max(0, 1 - d) ** 2.2];
  });
  // Debris: small jagged chunks of rubble and metal.
  for (let v = 0; v < 3; v++) {
    const noise = valueNoise(v * 3 + 91);
    makeTexture(scene, 'xp:chunk' + v, 16, 16, (x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5) / 7.5;
      const n = noise(x / 3, y / 3);
      const inside = d + (n - 0.5) * 0.9 < 0.75;
      const light = 60 + 70 * n;
      return [light, light * 0.92, light * 0.85, inside ? 1 : 0];
    });
  }
}

// --- colour --------------------------------------------------------------

/** A colour ramp [[t, 0xrrggbb], ...] sampled at t (0-1). */
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t <= t1) {
      const [t0, c0] = stops[i - 1];
      const k = (t - t0) / (t1 - t0);
      const r = ((c0 >> 16) & 255) + (((c1 >> 16) & 255) - ((c0 >> 16) & 255)) * k;
      const g = ((c0 >> 8) & 255) + (((c1 >> 8) & 255) - ((c0 >> 8) & 255)) * k;
      const b = (c0 & 255) + ((c1 & 255) - (c0 & 255)) * k;
      return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    }
  }
  return stops[stops.length - 1][1];
}

// Additive, so fading to black is fading out.
// The fireball's body is drawn normally (it has to show on a white floor), cooling into smoke.
const FIRE = [[0, 0xfffbe8], [0.1, 0xffe27a], [0.25, 0xffa22e], [0.45, 0xf0561a], [0.62, 0x9a2c12], [0.8, 0x3c2a22], [1, 0x2e2925]];
// Its glow is added on top, so fading to black is fading out.
const GLOW = [[0, 0xffffff], [0.2, 0xffd36a], [0.5, 0xff6a14], [1, 0x000000]];
const BURN = [[0, 0xffd080], [0.3, 0xff7a20], [0.6, 0xb02c08], [1, 0x000000]];
const SPARK = [[0, 0xffffff], [0.25, 0xffe39a], [0.6, 0xffa040], [1, 0x802008]];
const SMOKE = [[0, 0x2a2521], [0.4, 0x4a4540], [1, 0x77726c]];
const DUST = [[0, 0x8a7a64], [1, 0x6e665c]];

// --- the effect ------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (prefix, n) => prefix + Math.floor(Math.random() * n);

export class Explosions {
  constructor(scene, effects) {
    this.scene = scene;
    this.effects = effects;
    this.particles = [];
    this.scorches = [];
    makeExplosionTextures(scene);
  }

  /** A blast at `pos` (cells) by `weaponID`, `altitude` px above the ground. */
  explode(pos, altitude = 0, weaponID = WeaponID.GRENADES) {
    const kind = KINDS[explosionKind(weaponID)];
    const detail = Preferences.enhanced ? 1 : 0.5;
    const blasts = blastLayout(kind.cluster, altitude);
    for (const b of blasts) {
      const at = { x: pos.x + b.dx, y: pos.y + b.dy };
      this.blast(at, b.altitude, kind, b.scale, b.delay, detail * (b.scale < 1 ? 0.55 : 1), b === blasts[0]);
    }
    this.sounds(kind, pos);
    this.shake(kind, pos);
  }

  sounds(kind, pos) {
    this.effects.playSound(kind.sound, pos);
    if (kind.cluster === 'airstrike') {
      // AirstrikeBeacon.playExplosionSounds: a rumble of artillery spreading out.
      for (let i = 1; i <= 5; i++) this.effects.playSound(i % 2 ? 'ExplosionArtillery' : 'ExplosionGrenade', pos, i * 100 + Math.random() * 50);
    }
  }

  shake(kind, pos) {
    if (!Preferences.shake) return;
    const camera = this.scene.cameras.main;
    const focus = this.effects.focus;
    const distance = Math.hypot(pos.x - focus.x, pos.y - focus.y);
    const reach = kind.cluster === 'airstrike' ? 18 : 11;
    if (distance >= reach) return;
    const [duration, intensity] = kind.shake;
    camera.shake(duration, (intensity * (1 - distance / reach)) / camera.zoom ** 2, true);
  }

  /** One fireball and everything around it. */
  blast(pos, altitude, kind, scale, delay, detail, main) {
    const x = pos.x * CELL_WIDTH;
    const y = pos.y * CELL_HEIGHT;
    const s = kind.size * scale;
    const count = (n) => Math.max(1, Math.round(n * detail));
    const depth = pos.y + 0.6; // in front of what stands on the blast's cell
    const at = this.effects.now() + delay;

    // Flash: a white-hot core and a wide warm light over the ground around it.
    this.add({ key: 'xp:light', x, y, altitude: altitude + 10, born: at, life: 110 * s, depth: DEPTH_TOP, add: true, scale: [0.55 * s, 1.1 * s], alpha: [0.95, 0], tint: 0xfff4d8, squash: 0.85 });
    // The blast lights up the ground, walls and people around it, flickering as it dies down.
    this.effects.scene.lighting?.flash(x, y - altitude, { radius: (main ? 330 : 200) * s, color: 0xffa050, intensity: main ? 1.6 : 0.9, life: (main ? 750 : 400) * s, flicker: true, delay });
    if (main) this.add({ key: 'xp:light', x, y, altitude: 0, born: at, life: 700 * s, depth: DEPTH_GROUND_GLOW, add: true, scale: [2.2 * s, 2.8 * s], alpha: [0.45, 0], tint: 0xff8a2a, squash: 0.7, flicker: true });

    // Shockwave and the ring of dust it kicks up.
    if (altitude < 15) {
      if (main) this.add({ key: 'xp:ring', x, y, altitude: 0, born: at, life: 360 * s, depth: DEPTH_GROUND_GLOW, add: true, scale: [0.15 * s, 1.1 * s], alpha: [0.5, 0], tint: 0xffd8a0, squash: 0.7, ease: 'out' });
      for (let i = 0, n = count(10 * s); i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
        const speed = rand(0.12, 0.2) * s;
        this.add({ key: pick('xp:smoke', VARIANTS), x, y, altitude: rand(0, 4), born: at + rand(0, 60), life: rand(900, 1400), depth: (y + Math.sin(a) * 30) / CELL_HEIGHT, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, drag: 0.004, rise: 0.008, scale: [0.18 * s, 0.6 * s], alpha: [0.5, 0], fadeIn: 0.05, colors: DUST, spin: rand(-0.001, 0.001) });
      }
    }

    // The fireball: puffs bursting out, slowing, rising and cooling into smoke.
    const burn = kind.burn ? 1.5 : 1;
    for (let i = 0, n = count(16 * s * kind.fire); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(0.04, 0.14) * s;
      const life = rand(650, 1000) * burn * Math.sqrt(s);
      this.add({ key: pick('xp:fire', VARIANTS), x: x + rand(-6, 6) * s, y: y + rand(-4, 4) * s, altitude: altitude + rand(2, 14) * s, born: at + rand(0, 70), life, depth: depth + 1.3, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, drag: 0.006, rise: rand(0.02, 0.05), scale: [rand(0.16, 0.24) * s, rand(0.42, 0.62) * s], alpha: [1, 0], hold: 0.55, colors: FIRE, spin: rand(-0.004, 0.004) });
    }
    // Its glow: the hot parts burning bright.
    for (let i = 0, n = count(9 * s * kind.fire); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(0.03, 0.1) * s;
      this.add({ key: pick('xp:fire', VARIANTS), x: x + rand(-5, 5) * s, y: y + rand(-3, 3) * s, altitude: altitude + rand(4, 14) * s, born: at + rand(0, 90), life: rand(300, 520) * burn * Math.sqrt(s), depth: depth + 1.31, add: true, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, drag: 0.007, rise: rand(0.02, 0.05), scale: [rand(0.14, 0.2) * s, rand(0.32, 0.45) * s], alpha: kind.burn ? [0.55, 0.55] : [0.75, 0.75], colors: kind.burn ? BURN : GLOW, spin: rand(-0.005, 0.005) });
    }
    // The white-hot centre.
    for (let i = 0; i < count(4); i++) {
      this.add({ key: pick('xp:fire', VARIANTS), x: x + rand(-3, 3), y, altitude: altitude + 8 * s, born: at, life: rand(140, 220) * s, depth: depth + 1.32, add: true, scale: [0.25 * s, 0.55 * s], alpha: [1, 0], tint: 0xfff8e6, spin: rand(-0.01, 0.01) });
    }

    // Smoke: dark, rolling up from the fire and spreading as it thins.
    if (Preferences.smoke) {
      for (let i = 0, n = count(14 * s * kind.smoke); i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = rand(0.03, 0.09) * s;
        this.add({ key: pick('xp:smoke', VARIANTS), x: x + rand(-14, 14) * s, y: y + rand(-9, 9) * s, altitude: altitude + rand(8, 22) * s, born: at + rand(150, 450), life: rand(1900, 3400) * Math.sqrt(s), depth: depth + 1.2, vx: Math.cos(a) * speed + 0.005, vy: Math.sin(a) * speed * 0.7, drag: 0.0022, rise: rand(0.018, 0.04), scale: [rand(0.28, 0.4) * s, rand(0.75, 1.05) * s], alpha: [0.62, 0], fadeIn: 0.15, colors: SMOKE, spin: rand(-0.0008, 0.0008) });
      }
    }

    // Sparks flying out and falling, and embers drifting up.
    for (let i = 0, n = count(18 * s * kind.sparks); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = rand(0.18, 0.5) * Math.sqrt(s);
      this.add({ key: 'xp:streak', x, y, altitude: altitude + rand(4, 16), born: at + rand(0, 40), life: rand(250, 650), depth: depth + 0.05, add: true, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, drag: 0.002, up: rand(0.05, 0.25), gravity: 0.0009, scale: [rand(0.5, 0.9), 0.2], alpha: [1, 0.2], colors: SPARK, stretch: true, ground: true });
    }
    for (let i = 0, n = count(8 * s); i < n; i++) {
      this.add({ key: 'xp:light', x: x + rand(-14, 14) * s, y: y + rand(-8, 8) * s, altitude: altitude + rand(10, 30), born: at + rand(100, 400), life: rand(900, 1700), depth: depth + 1.3, add: true, vx: rand(-0.02, 0.02), vy: rand(-0.01, 0.01), rise: rand(0.02, 0.05), scale: [0.05, 0.02], alpha: [1, 0], colors: BURN, flicker: true });
    }

    // Debris: chunks thrown up in arcs, trailing smoke (or fire, from a barrel).
    if (main) {
      for (let i = 0, n = count(6 * kind.debris * s); i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = rand(0.06, 0.16) * s;
        const chunk = this.add({ key: pick('xp:chunk', 3), x, y, altitude: altitude + 6, born: at, life: rand(700, 1100), depth: depth + 0.1, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7, up: rand(0.2, 0.38), gravity: 0.0009, scale: [rand(0.45, 0.8), rand(0.45, 0.8)], alpha: [1, 1], tint: kind.burn ? 0x5a4a40 : 0xffffff, spin: rand(-0.02, 0.02), ground: true, bounce: true });
        chunk.trail = kind.burn ? 'fire' : Preferences.smoke ? 'smoke' : null;
      }
    }

    // Scorch marks on the floor.
    if (altitude < 15 && scale >= 0.6) {
      const scorch = this.scene.add.image(x, y, pick('xp:scorch', 3)).setDepth(DEPTH_GROUND).setRotation(Math.random() * Math.PI * 2).setScale(0.75 * s, 0.55 * s).setAlpha(0).setVisible(false);
      this.scorches.push({ image: scorch, at: at + 60, alpha: main ? 0.7 : 0.45 });
      if (this.scorches.length > MAX_SCORCHES) this.scorches.shift().image.destroy();
    }
  }

  /** A particle: an image moved by update(); values in px and ms. */
  add(p) {
    if (this.particles.length >= MAX_PARTICLES) return p;
    const image = this.scene.add.image(p.x, p.y, p.key).setVisible(false).setDepth(p.depth);
    if (p.add) image.setBlendMode(Phaser.BlendModes.ADD);
    if (p.tint !== undefined) image.setTint(p.tint);
    image.setRotation(Math.random() * Math.PI * 2);
    p.image = image;
    p.vx ||= 0;
    p.vy ||= 0;
    p.squash ||= 1;
    p.rotation = image.rotation;
    p.lastTrail = p.born;
    this.particles.push(p);
    return p;
  }

  update(now) {
    for (const scorch of this.scorches) {
      if (scorch.alpha === null || now < scorch.at) continue;
      const k = Math.min(1, (now - scorch.at) / 250);
      scorch.image.setVisible(true).setAlpha(scorch.alpha * k);
      if (k === 1) scorch.alpha = null; // done fading in
    }
    const spawned = [];
    this.particles = this.particles.filter((p) => {
      const t = now - p.born;
      if (t < 0) return true;
      if (t >= p.life) {
        p.image.destroy();
        return false;
      }
      const k = t / p.life;
      // Movement: drag slows the burst; `rise` lifts smoke and fire; `up`/`gravity` throw arcs.
      const travel = p.drag ? (1 - Math.exp(-p.drag * t)) / p.drag : t;
      let x = p.x + p.vx * travel;
      let y = p.y + p.vy * travel;
      let altitude = p.altitude + (p.rise || 0) * t + (p.up || 0) * t - 0.5 * (p.gravity || 0) * t * t;
      if (p.ground && altitude <= 0) {
        if (p.bounce && !p.bounced) {
          // Land once with a little hop, then lie still and fade.
          p.bounced = true;
          p.x = x; p.y = y; p.altitude = 0;
          p.vx *= 0.25; p.vy *= 0.25;
          p.up = 0.05; p.born = now - 1; p.life = Math.max(400, p.life - t); p.trail = null;
          p.drag = 0.01;
          return true;
        }
        if (!p.bounce) {
          p.image.destroy();
          return false;
        }
        altitude = 0;
      }
      const image = p.image.setVisible(true);
      image.setPosition(x, y - altitude);
      let scale = p.scale[0] + (p.scale[1] - p.scale[0]) * (p.ease === 'out' ? 1 - (1 - k) ** 3 : Math.sqrt(k));
      if (p.stretch) {
        const speed = Math.hypot(p.vx * Math.exp(-(p.drag || 0) * t), p.vy - (p.up || 0) + (p.gravity || 0) * t);
        image.setRotation(Math.atan2(p.vy * Math.exp(-(p.drag || 0) * t) - (p.up || 0) + (p.gravity || 0) * t, p.vx * Math.exp(-(p.drag || 0) * t)));
        image.setScale(scale * (0.5 + speed * 2), 0.5);
      } else {
        if (p.spin) image.setRotation(p.rotation + p.spin * t);
        image.setScale(scale, scale * p.squash);
      }
      const fade = p.hold ? Math.max(0, (k - p.hold) / (1 - p.hold)) : k;
      let alpha = p.alpha[0] + (p.alpha[1] - p.alpha[0]) * fade;
      if (p.fadeIn && k < p.fadeIn) alpha *= k / p.fadeIn;
      if (p.flicker) alpha *= 0.75 + 0.25 * Math.sin(t * 0.05 + p.x);
      image.setAlpha(alpha);
      if (p.colors) image.setTint(ramp(p.colors, k));
      // Debris trails.
      if (p.trail && now - p.lastTrail > 35 && altitude > 1) {
        p.lastTrail = now;
        spawned.push(p.trail === 'fire'
          ? { key: pick('xp:fire', VARIANTS), x, y, altitude, born: now, life: rand(250, 400), depth: p.depth, add: true, rise: 0.02, scale: [0.12, 0.05], alpha: [0.9, 0], colors: BURN }
          : { key: pick('xp:smoke', VARIANTS), x, y, altitude, born: now, life: rand(500, 800), depth: p.depth, rise: 0.015, scale: [0.06, 0.2], alpha: [0.55, 0], colors: SMOKE });
      }
      return true;
    });
    for (const p of spawned) this.add(p);
  }

  destroy() {
    for (const p of this.particles) p.image.destroy();
    for (const s of this.scorches) s.image.destroy();
    this.particles = [];
    this.scorches = [];
  }
}
