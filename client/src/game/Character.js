// Player characters: state, animation frames and per-tick movement.
// Ports of boxhead.world.thing.character.{Character, PlayerCharacter,
// CharacterAnimator}. Rendering lives in render/CharacterView.js.

import { S } from './Direction.js';
import { HitCircle, moveCharacter } from './world.js';
import { CHARACTER_HEIGHT, FIRE_RADIUS, MAX_SPEED, MOVE_RADIUS, MAX_STORED_POSITIONS } from './constants.js';

const ANIM_FPS = 20;
const SMOOTH_TIME = 200; // ms to blend a corrected remote position (Mover.SMOOTH_TIME)
const BODY_FRAMES = 42; // frames per direction on body/head sheets
const WEAPON_FRAMES = 9; // frames per direction (and per weapon pose) on weapon sheets

/** CharacterAnimator: which frame of the 42-per-direction sheet to show. */
export class Animator {
  constructor() {
    this.name = null;
    this.idle();
  }

  set(name, frames, offset, repeat, speed) {
    if (this.name === name) return;
    Object.assign(this, { name, frames, offset, repeat, speed, progress: 0 });
  }

  idle() {
    this.set('Idle', 1, 0, false, 0);
  }

  walk(speed = 1) {
    this.set('Walk', 8, 1, true, speed);
    this.speed = speed;
  }

  die() {
    this.set('Die', 6, WEAPON_FRAMES * 4, false, 1);
  }

  advance(ms) {
    this.progress += (ms / 1000) * ANIM_FPS * this.speed;
    if (this.repeat) this.progress %= this.frames;
    else this.progress = Math.min(this.progress, this.frames - 1);
  }

  get finished() {
    return !this.repeat && this.progress >= this.frames - 1;
  }

  bodyFrame(dir, pose) {
    if (this.name === 'Die') return BODY_FRAMES * dir.index + this.offset + Math.floor(this.progress);
    return BODY_FRAMES * dir.index + WEAPON_FRAMES * pose + this.offset + Math.floor(this.progress);
  }

  weaponFrame(dir) {
    return WEAPON_FRAMES * dir.index + this.offset + Math.floor(this.progress);
  }
}

export class Character {
  constructor({ id = null, name = '', local = false } = {}) {
    this.id = id;
    this.name = name;
    this.local = local;
    this.pos = { x: 0, y: 0 };
    this.prevPos = { x: 0, y: 0 }; // position at the previous tick, for smooth rendering
    this.firePos = this.pos; // remote players fire from their last reported position
    this.dir = S;
    this.moveDir = null;
    this.strafing = false;
    this.collided = false;
    this.moving = false;
    this.speedMultiplier = 1;
    this.weaponSpeed = 1;
    this.hp = 100;
    this.maxHp = 100;
    this.active = false; // drawn and hittable
    this.height = CHARACTER_HEIGHT;
    this.moveHit = new HitCircle(this.pos, MOVE_RADIUS);
    this.fireHit = new HitCircle(this.pos, FIRE_RADIUS);
    this.animator = new Animator();
    this.storedPositions = []; // local only: lag compensation (LocalCharacter.unlag)
    this.look = { gender: 'Male', headModel: 0, headColor: 0, bodyModel: 0, bodyColor: 0 };
    this.pose = 1; // weapon pose: 1 = one-handed (pistol)
    this.renderPos = { x: 0, y: 0 }; // where it was last drawn, in cells
    this.smoothing = null;
  }

  /**
   * After a network correction moved `pos`, keep drawing from where the
   * character was on screen and blend into the new position (Mover.applySmoothing).
   */
  applySmoothing(now) {
    this.smoothing = { x: this.renderPos.x - this.pos.x, y: this.renderPos.y - this.pos.y, start: now };
  }

  /** Remaining smoothing offset (cells) at time `now`. */
  smoothingOffset(now) {
    if (!this.smoothing) return null;
    const k = Math.max(0, Math.min(1, 1 - (now - this.smoothing.start) / SMOOTH_TIME));
    if (k === 0) {
      this.smoothing = null;
      return null;
    }
    return { x: this.smoothing.x * k, y: this.smoothing.y * k };
  }

  get dead() {
    return this.hp <= 0;
  }

  get speed() {
    return MAX_SPEED * this.weaponSpeed * this.speedMultiplier;
  }

  setPosition(x, y) {
    this.pos.x = x;
    this.pos.y = y;
    this.prevPos.x = x;
    this.prevPos.y = y;
  }

  /** One 50 ms game tick (Character.move). */
  move(map) {
    this.prevPos.x = this.pos.x;
    this.prevPos.y = this.pos.y;
    this.collided = false;
    if (this.dead) return;
    if (this.moveDir) {
      this.animator.walk(this.weaponSpeed * this.speedMultiplier);
      if (!this.strafing) this.dir = this.moveDir;
      this.collided = moveCharacter(map, this, this.speed);
    } else {
      this.animator.idle();
    }
    this.moving = this.pos.x !== this.prevPos.x || this.pos.y !== this.prevPos.y;
    if (this.local) {
      this.storedPositions.unshift({ x: this.pos.x, y: this.pos.y });
      if (this.storedPositions.length > MAX_STORED_POSITIONS) this.storedPositions.pop();
    }
  }

  setHealth(hp) {
    this.hp = Math.max(0, hp);
    if (this.hp <= 0) this.animator.die();
  }

  respawn(x, y) {
    this.setPosition(x, y);
    this.hp = this.maxHp;
    this.moveDir = null;
    this.animator.name = null;
    this.animator.idle();
    this.storedPositions = [];
    this.smoothing = null;
    this.active = true;
  }
}
