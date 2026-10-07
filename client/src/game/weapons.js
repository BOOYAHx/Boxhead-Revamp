// Weapons: stats from constants.xml and the firing rules of
// boxhead.world.weapon.{Weapon, Weapon1h, Pistol}. Pure logic (no Phaser),
// so the timings can be unit-tested; effects are reported to the caller.

import { DIRECTIONS } from './Direction.js';
import { SECOND } from './constants.js';

export const PISTOL_ID = 0;
const INFINITE_RANGE = 1000; // "Infinite" in constants.xml; rays stop at the map edge anyway

// Fallback when constants.xml is missing an entry (the shipped Pistol values).
const DEFAULT_STATS = { name: 'Pistol', damage: 7, range: 20, spread: 0.08, fireDelay: 0.5, moveSpeed: 1 };
let weaponStats = { [PISTOL_ID]: DEFAULT_STATS };

/**
 * Read every <weapon id="..."> block of constants.xml. Regex based so it also
 * runs under Node for the tests.
 */
export function parseWeaponStats(xml) {
  const stats = {};
  const number = (block, tag, fallback) => {
    const match = block.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`));
    if (!match) return fallback;
    if (/^infinite$/i.test(match[1])) return INFINITE_RANGE;
    const value = parseFloat(match[1]);
    return Number.isFinite(value) ? value : fallback;
  };
  for (const match of xml.matchAll(/<weapon\s+id="(\d+)"\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/weapon>/g)) {
    const block = match[3].replace(/<upgrade\d>[\s\S]*?<\/upgrade\d>/g, '');
    stats[parseInt(match[1], 10)] = {
      name: match[2],
      damage: number(block, 'damage', 0),
      range: number(block, 'range', 0),
      spread: number(block, 'spread', 0),
      fireDelay: number(block, 'fireDelay', 1),
      moveSpeed: number(block, 'moveSpeed', 1),
    };
  }
  return stats;
}

export function setWeaponStats(stats) {
  weaponStats = { [PISTOL_ID]: DEFAULT_STATS, ...stats };
}

export function weaponName(id) {
  return weaponStats[id]?.name || 'Weapon';
}

// Pistol.getMuzzleOffsets: pixel offset of the muzzle flash for every weapon
// frame (9 per direction, directions in sheet order S, SW, W, NW, N, NE, E, SE).
const PISTOL_MUZZLE = [
  [-10, -5], [-10, -4], [-10, -4], [-10, -4], [-10, -5], [-10, -5], [-10, -5], [-10, -4], [-10, -4],
  [-24, -15], [-25, -15], [-25, -14], [-24, -14], [-24, -15], [-24, -15], [-24, -15], [-24, -14], [-25, -14],
  [-24, -29], [-25, -30], [-25, -29], [-25, -29], [-24, -29], [-24, -30], [-24, -29], [-25, -29], [-25, -29],
  [-10, -39], [-11, -40], [-10, -40], [-10, -40], [-10, -39], [-10, -39], [-10, -39], [-10, -40], [-10, -40],
  [10, -39], [11, -40], [11, -40], [11, -40], [11, -39], [11, -40], [11, -39], [11, -40], [11, -40],
  [25, -29], [26, -30], [26, -30], [25, -29], [25, -29], [25, -30], [25, -29], [25, -29], [26, -30],
  [24, -15], [26, -15], [26, -15], [25, -14], [25, -15], [25, -15], [25, -15], [25, -15], [26, -15],
  [10, -5], [11, -4], [11, -4], [11, -4], [11, -5], [10, -5], [11, -5], [11, -4], [11, -4],
];

const WEAPON_INFO = {
  [PISTOL_ID]: {
    sprite: 'Pistol',
    pose: 1, // Weapon.ONE_HAND
    barrelAltitude: 22, // Weapon1h
    muzzleFlashes: ['MuzzleFlashSmall1', 'MuzzleFlashSmall2'],
    muzzleOffsets: PISTOL_MUZZLE,
    fireSounds: ['PistolFire01', 'PistolFire02', 'PistolFire03'],
    reloadSound: 'PistolReload',
    reloadSoundDelay: 200,
  },
};

const SIDE_DISTANCE = 0.25; // Weapon.sideDistance (handMultiplier 1)
const BARREL_DISTANCE = 0.8; // Weapon.barrelDistance
const FLASH_TIME = Math.round(0.1 * SECOND); // ticks the muzzle flash shows

export class Weapon {
  constructor(id = PISTOL_ID) {
    const stats = weaponStats[id] || DEFAULT_STATS;
    const info = WEAPON_INFO[id] || WEAPON_INFO[PISTOL_ID];
    Object.assign(this, info);
    this.id = id;
    this.name = stats.name;
    this.damage = stats.damage;
    this.range = stats.range;
    this.spread = stats.spread;
    this.moveSpeed = stats.moveSpeed;
    this.reloadTime = Math.round(stats.fireDelay * SECOND); // ticks between shots
    this.timeSinceFire = 999;
    this.timeSinceEffects = 999;
    this.effectsQueue = [];
    this.muzzleFlashVariant = 0;
    this.shoulder = { x: 0, y: 0 };
    this.muzzle = { x: 0, y: 0 };
  }

  get isLoaded() {
    return this.timeSinceFire >= this.reloadTime;
  }

  get flashVisible() {
    return this.timeSinceEffects <= FLASH_TIME;
  }

  get muzzleFlash() {
    return this.muzzleFlashes[this.muzzleFlashVariant];
  }

  muzzleOffset(weaponFrame) {
    return this.muzzleOffsets[weaponFrame] || [0, 0];
  }

  /** Weapon.updatePosition: shoulder beside the fire position, muzzle ahead of it. */
  updatePosition(ch) {
    const side = DIRECTIONS[(ch.dir.index + 2) % 8];
    this.shoulder.x = ch.firePos.x + side.dx * SIDE_DISTANCE;
    this.shoulder.y = ch.firePos.y + side.dy * SIDE_DISTANCE;
    this.muzzle.x = this.shoulder.x + ch.dir.dx * BARREL_DISTANCE;
    this.muzzle.y = this.shoulder.y + ch.dir.dy * BARREL_DISTANCE;
  }

  /** Weapon.getFireAngle: facing plus random spread. */
  fireAngle(ch, random = Math.random) {
    return ch.dir.radians + (random() - 0.5) * this.spread;
  }

  /**
   * Weapon.shoot: a shot from the shoulder at `angle`. Remote shots call this
   * too, with the angle the shooter sent.
   */
  shoot(ch, angle, param = 0) {
    this.updatePosition(ch);
    this.timeSinceFire = 0;
    return { angle, param, start: { x: this.shoulder.x, y: this.shoulder.y }, altitude: this.barrelAltitude, range: this.range };
  }

  /** Queue the visible/audible part of a shot (Weapon.queueShotEffects). */
  queueEffects(shot, distance) {
    this.effectsQueue.push({ shot, distance, muzzle: { x: this.muzzle.x, y: this.muzzle.y } });
  }

  /**
   * One tick (Weapon.process). Returns the effects to show now, if any, and
   * whether the reload sound is due.
   */
  process(current = true) {
    if (!current) this.effectsQueue.length = 0;
    this.timeSinceFire++;
    this.timeSinceEffects++;
    let effects = null;
    if (this.effectsQueue.length > 0 && this.timeSinceEffects >= FLASH_TIME - 1) {
      effects = this.effectsQueue.shift();
      this.muzzleFlashVariant = Math.floor(Math.random() * this.muzzleFlashes.length);
      this.timeSinceEffects = 0;
    }
    return { effects, reloaded: this.timeSinceFire === this.reloadTime };
  }

  /** Tracer line drawn from the muzzle (Weapon.lineFromTracer). */
  tracerLine(effects) {
    const { angle } = effects.shot;
    return {
      x: effects.muzzle.x,
      y: effects.muzzle.y,
      dx: Math.cos(angle),
      dy: Math.sin(angle),
      length: Math.max(0, effects.distance - BARREL_DISTANCE),
      altitude: this.barrelAltitude,
    };
  }
}
