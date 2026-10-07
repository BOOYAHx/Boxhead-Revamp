// Player characters: state, animation frames and per-tick movement.
// Ports of boxhead.world.thing.character.{Character, PlayerCharacter,
// CharacterAnimator}. Rendering lives in render/CharacterView.js.

import { S } from './Direction.js';
import { HitCircle, moveCharacter } from './world.js';
import { CHARACTER_HEIGHT, FIRE_RADIUS, MAX_SPEED, MOVE_RADIUS, MAX_STORED_POSITIONS, PROCESS_INTERVAL, RESPAWN_TIME, SECOND } from './constants.js';
import { NUM_WEAPONS, PISTOL_ID, Weapon, WeaponID } from './weapons.js';

const ANIM_FPS = 20;
const SMOOTH_TIME = 200; // ms to blend a corrected remote position (Mover.SMOOTH_TIME)
const BODY_FRAMES = 42; // frames per direction on body/head sheets
const WEAPON_FRAMES = 9; // frames per direction (and per weapon pose) on weapon sheets
const FLASH_TIME = Math.round(0.3 * SECOND); // ticks the body flashes red when hurt (PlayerCharacter.FLASH_TIME)

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
    this.hp = 100;
    this.maxHp = 100;
    this.active = false; // drawn and hittable
    this.height = CHARACTER_HEIGHT;
    this.moveHit = new HitCircle(this.pos, MOVE_RADIUS);
    this.fireHit = new HitCircle(this.pos, FIRE_RADIUS);
    this.animator = new Animator();
    this.storedPositions = []; // local only: lag compensation (LocalCharacter.unlag)
    this.look = { gender: 'Male', headModel: 0, headColor: 0, bodyModel: 0, bodyColor: 0 };
    this.weapons = []; // every weapon held, in Q/E order (PlayerCharacter.weaponPool)
    this.banks = {}; // bank 1-8 -> its weapons, by priority (weaponBanks)
    this.weapon = null; // the one in hand
    this.refillTarget = null; // an emptied gun the refill key buys ammo for
    this.animSpeed = 1; // walk animation speed: the weapon's when it was selected
    this.selectWeapon(this.pickupWeapon(new Weapon(PISTOL_ID)));
    this.firing = false; // local only: fire key held
    this.armor = 1;
    this.hurtWaiting = 0; // fractional damage carried over (Character.hurt)
    this.flashTime = 0; // ticks of red damage flash left
    this.respawnTime = 0; // local only: ms until respawn after death
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

  /** PlayerCharacter.getSpeed: the weapon in hand sets the pace. */
  get speed() {
    return MAX_SPEED * this.weapon.moveSpeed * this.speedMultiplier;
  }

  get pose() {
    return this.weapon.pose;
  }

  // --- weapons (PlayerCharacter) ---------------------------------------------------

  weaponByID(id) {
    return this.weapons.find((w) => w.id === id) || null;
  }

  /**
   * PlayerCharacter.pickupWeapon: banks are kept in priority order; the Q/E
   * order is by bank, and inside a bank from the lowest priority up. Picking
   * up a weapon already held adds its ammo instead. Returns the held weapon.
   */
  pickupWeapon(weapon) {
    const owned = this.weaponByID(weapon.id);
    if (owned) {
      if (owned !== weapon && owned.ammo && weapon.ammo) owned.ammo.add(weapon.ammo.count);
      return owned;
    }
    const bank = (this.banks[weapon.bank] ||= []);
    const at = bank.findIndex((w) => w.priority > weapon.priority);
    bank.splice(at < 0 ? bank.length : at, 0, weapon);
    let after = -1;
    for (let i = this.weapons.length - 1; i >= 0; i--) {
      const w = this.weapons[i];
      if (weapon.bank > w.bank || (weapon.bank === w.bank && weapon.priority < w.priority)) {
        after = i;
        break;
      }
    }
    this.weapons.splice(after + 1, 0, weapon);
    return weapon;
  }

  /** Re-sort the banks and Q/E order after the bank layout changed. */
  rebuildBanks() {
    const weapons = this.weapons;
    this.weapons = [];
    this.banks = {};
    for (const weapon of weapons) this.pickupWeapon(weapon);
  }

  /** Every weapon, with unlimited ammo, for other players (pickupRemoteWeapons). */
  pickupRemoteWeapons() {
    for (let id = 0; id < NUM_WEAPONS; id++) if (!this.weaponByID(id)) this.pickupWeapon(new Weapon(id, { remote: true }));
  }

  dropWeapon(weapon) {
    this.weapons = this.weapons.filter((w) => w !== weapon);
    const bank = this.banks[weapon.bank];
    if (bank) {
      bank.splice(bank.indexOf(weapon), 1);
      if (!bank.length) delete this.banks[weapon.bank];
    }
    if (this.refillTarget === weapon) this.refillTarget = null;
  }

  /** PlayerCharacter.selectWeapon. Returns true when the weapon in hand changed. */
  selectWeapon(weapon) {
    if (!weapon || weapon === this.weapon) return false;
    this.refillTarget = null;
    this.weapon = weapon;
    this.animSpeed = weapon.moveSpeed;
    return true;
  }

  selectWeaponByID(id) {
    return this.selectWeapon(this.weaponByID(id));
  }

  /** The next weapon with ammo, in Q/E order (E). Returns the new weapon or null. */
  nextWeapon(step = 1) {
    const list = this.weapons;
    const n = list.length;
    const i = list.indexOf(this.weapon);
    for (let k = 1; k <= n; k++) {
      const w = list[(((i + step * k) % n) + n) % n];
      if (w === this.weapon) break;
      if (w.available) return this.selectWeapon(w) ? w : null;
    }
    return null;
  }

  /** The previous weapon with ammo (Q). */
  prevWeapon() {
    return this.nextWeapon(-1);
  }

  /**
   * PlayerCharacter.selectWeaponBank (keys 1-8): the bank's first weapon
   * with ammo, or, when already holding one of its weapons, the next one.
   */
  selectWeaponBank(n) {
    const bank = this.banks[n];
    if (!bank?.length) return null;
    const i = bank.indexOf(this.weapon);
    if (i < 0) {
      const w = bank.find((x) => x.available);
      return w && this.selectWeapon(w) ? w : null;
    }
    for (let k = 1; k < bank.length; k++) {
      const w = bank[(i + k) % bank.length];
      if (w.available) return this.selectWeapon(w) ? w : null;
    }
    return null;
  }

  /** selectStartWeapon: Dual Pistols, else the Pistol, else anything. */
  startWeapon() {
    return this.weaponByID(WeaponID.AKIMBO_PISTOLS) || this.weaponByID(PISTOL_ID) || this.weapons[0] || null;
  }

  /**
   * PlayerCharacter.checkAutoSwitch, when a gun has reloaded: an empty gun
   * is swapped for the previous one with ammo; if that is the Pistol, the
   * refill key will buy ammo for the empty gun. Returns the new weapon or null.
   */
  checkAutoSwitch() {
    if (!this.local || this.weapon.available) return null;
    const old = this.weapon;
    const now = this.prevWeapon();
    if (this.weapon.id === PISTOL_ID && old.ammo && old.ammo.count === 0) this.refillTarget = old;
    return now;
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
      this.animator.walk(this.animSpeed);
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

  /**
   * PlayerCharacter.setHealth. Returns 'hurt' when the health went down (the
   * body flashes red), 'died' when it reached zero, otherwise null.
   */
  setHealth(hp) {
    let result = null;
    if (hp > 0 && hp < this.hp) {
      this.flashTime = FLASH_TIME;
      result = 'hurt';
    }
    const wasDead = this.dead;
    this.hp = Math.max(0, hp);
    if (this.hp <= 0 && !wasDead) {
      this.die();
      result = 'died';
    }
    return result;
  }

  /** Character.die / LocalCharacter.die. */
  die() {
    this.hp = 0;
    this.hurtWaiting = 0;
    this.moveDir = null;
    this.firing = false;
    this.animator.die();
    this.respawnTime = RESPAWN_TIME;
    this.storedPositions = [];
  }

  /**
   * Character.hurt: take `damage` (after armour), keeping fractions for the
   * next hit. Returns the whole points of health actually lost.
   */
  hurt(damage) {
    if (this.hp <= 0) return 0;
    const taken = Math.max(0, Math.min(this.hp - this.hurtWaiting, damage / this.armor));
    this.hurtWaiting += taken + 0.0001;
    const lost = Math.trunc(this.hurtWaiting);
    this.hurtWaiting -= lost;
    if (lost <= 0) return 0;
    this.setHealth(this.hp - lost);
    return lost;
  }

  /**
   * LocalCharacter.unlag: move the bullet hit circle to where we were `ping`
   * ms ago, so shots are judged against what the shooter saw. unlag(0) restores it.
   */
  unlag(ping) {
    if (!ping || !this.storedPositions.length) {
      this.fireHit.pos = this.pos;
      return;
    }
    const index = Math.max(0, Math.min(this.storedPositions.length - 1, Math.trunc(ping / PROCESS_INTERVAL)));
    this.fireHit.pos = this.storedPositions[index];
  }

  /** Per-tick timers (PlayerCharacter.process, LocalCharacter.process). Returns true when it is time to respawn. */
  processTimers() {
    if (this.flashTime > 0) this.flashTime--;
    if (!this.dead || !this.local) return false;
    this.respawnTime -= PROCESS_INTERVAL;
    return this.respawnTime <= 0;
  }

  respawn(x, y) {
    this.setPosition(x, y);
    this.hp = this.maxHp;
    this.hurtWaiting = 0;
    this.flashTime = 0;
    this.respawnTime = 0;
    this.moveDir = null;
    this.animator.name = null;
    this.animator.idle();
    this.storedPositions = [];
    this.smoothing = null;
    this.active = true;
  }
}
