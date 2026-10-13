// Computer players for offline practice: made-up names, random costumes and
// guns, and a brain that finds its way round the map, picks a target, lines up
// one of the eight firing lines (every gun in Boxhead shoots along the facing),
// keeps its distance, dodges shots and switches guns for the range.
// Bots start every round with the Pistol, a Shotgun and no money: the bounty
// crates they pick up pay for guns and ammo from their own shop, at the
// shop's prices, in this order: Rifle, Plasma Cannon, Magnum.
// Three difficulties (Quick Play's setup): Easy bots fight like the original
// practice bots; Hard bots react fast, dodge, go after money crates and chain their guns like
// good players (Plasma, Shotgun, Rifle, Magnum: each gun reloads on its own,
// so switching fires the next one at once).
// Pure logic: the game scene moves, shoots and damages them like any player.

import { Character } from './Character.js';
import { DIRECTIONS } from './Direction.js';
import { FIRE_RADIUS } from './constants.js';
import { MODELS, ORIGINAL_MODELS } from './bodyParts.js';
import { ShopState } from './shop.js';
import { traceShot } from './world.js';
import { Weapon, WeaponID } from './weapons.js';

export const MAX_NPCS = 15;
export const NPC_NAMES = [
  'Grim Tuesday', 'Boxwell', 'Captain Crate', 'Rusty Nails', 'Mad Dog Mike', 'Square Sally', 'Blocky Balboa', 'Doc Cubeman',
  'Nina Knuckles', 'Hexley', 'Big Lou', 'Tank Tompkins', 'Viper Vance', 'Slick Rico', 'Duchess Dynamo', 'Bones Malone',
  'Sergeant Stack', 'Pixel Pete', 'Mona Mayhem', 'Count Cornerstone', 'Ziggy Zero', 'Brick Baxter', 'Lady Lockjaw', 'Dutch Dozer',
];
// Which gun a bot holds for the range, best first (the Pistol when it has none of them).
const CLOSE_RANGE = [WeaponID.SHOTGUN, WeaponID.PLASMA, WeaponID.MAGNUM, WeaponID.RIFLE];
const MID_RANGE = [WeaponID.PLASMA, WeaponID.MAGNUM, WeaponID.SHOTGUN, WeaponID.RIFLE];
const LONG_RANGE = [WeaponID.PLASMA, WeaponID.RIFLE, WeaponID.MAGNUM];
// Hard bots fire these one after another, first loaded one in range first.
const CYCLE = [WeaponID.PLASMA, WeaponID.SHOTGUN, WeaponID.RIFLE, WeaponID.MAGNUM];
const COLORS = 34; // colour choices per body part
const FEMALE = new Set(['Croft', 'Bride']);
const MONSTER = new Set(['Zombie', 'Mummy']);

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Super Hard'];
/**
 * How each difficulty plays. think: ms between plans (reaction); aim: ms on a
 * firing line before the first shot; dodge: chance to step off an enemy's
 * line; playerBias: the human looks this much closer (below 1: hunted first);
 * crates: how far (cells) a money crate draws it, 0 for never; cycle: chain
 * the heavy guns, switching at most every switchDelay ms.
 */
export const LEVELS = Object.freeze({
  // Easy fights exactly like the original practice bots did (before there were difficulties).
  Easy: { think: 100, aim: 120, dodge: 0.75, playerBias: 0.8, crates: 3, cycle: false },
  Medium: { think: 140, aim: 200, dodge: 0.5, playerBias: 0.9, crates: 5, cycle: false },
  Hard: { think: 95, aim: 115, dodge: 0.72, playerBias: 0.75, crates: 10, cycle: true, switchDelay: 170 },
  // Super Hard: near-instant reactions and aim, almost always dodges, hunts the human, chains guns with no pause
  // and crates pay it double (crateMoney), so it reaches the Plasma Cannon and Magnum early.
  'Super Hard': { think: 50, aim: 35, dodge: 0.95, playerBias: 0.55, crates: 14, cycle: true, switchDelay: 0, crateMoney: 2 },
});
/** The gun every bot starts each round with (full of ammo; it buys more shells later). */
export const STARTING_GUN = WeaponID.SHOTGUN;
/** What every bot saves up for, in order: each gun once it can pay for it (the Shotgun is already owned). */
export const BUY_ORDER = Object.freeze([WeaponID.SHOTGUN, WeaponID.RIFLE, WeaponID.PLASMA, WeaponID.MAGNUM]);
/** How empty a gun gets (share of a full load) before the bot buys ammo for it. */
export const SHOPPING = Object.freeze({
  Easy: { guns: BUY_ORDER, refillBelow: 0.2 },
  Medium: { guns: BUY_ORDER, refillBelow: 0.3 },
  Hard: { guns: BUY_ORDER, refillBelow: 0.5 },
  'Super Hard': { guns: BUY_ORDER, refillBelow: 0.7, start: [WeaponID.SHOTGUN, WeaponID.RIFLE] },
});
const SHOP_TIME = 1000; // ms between shopping trips (sooner when a gun runs dry)
export const levelFor = (difficulty) => LEVELS[difficulty] || LEVELS.Medium;
const ALIGNED = FIRE_RADIUS * 0.7; // cells off the line that still hit
const DODGE_TIME = 300;
const TARGET_KEEP = 0.7; // a new target must be this much closer to take over
const CRATE_FIGHT = 4; // Hard: an enemy this close is fought before a crate is picked up
const STUCK_TIME = 900;
const PATH_REFRESH = 600; // ms before a route to the same cell is worked out again
const LINES = DIRECTIONS.slice(0, 4); // the four firing lines through a point (each both ways)
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** A computer player: a name from the list, a random costume and the Pistol (it buys the rest). */
export function createNpc(index, random = Math.random, usedNames = new Set()) {
  const free = NPC_NAMES.filter((n) => !usedNames.has(n));
  const name = free.length ? pick(free, random) : `Bot ${index + 1}`;
  const ch = new Character({ id: 'n' + String((index % 99) + 1).padStart(2, '0'), name }); // 3 characters, like a server slot id
  ch.npc = true;
  ch.firePos = ch.pos;
  const model = Math.floor(random() * ORIGINAL_MODELS); // the bots wear the original game's costumes
  Object.assign(ch.look, {
    gender: FEMALE.has(MODELS[model]) ? 'Female' : MONSTER.has(MODELS[model]) ? 'Monster' : 'Male', // the voice when hurt
    bodyModel: model,
    headModel: random() < 0.8 ? model : Math.floor(random() * ORIGINAL_MODELS),
    bodyColor: Math.floor(random() * COLORS),
    headColor: Math.floor(random() * COLORS),
  });
  ch.weapons = [];
  ch.banks = {};
  ch.weapon = null;
  ch.selectWeapon(ch.pickupWeapon(new Weapon(WeaponID.PISTOL, { remote: true })));
  return ch;
}

/** Walkable cells of a map and routes over them (8 ways, never cutting a corner). */
export class NavGrid {
  constructor(map) {
    this.map = map;
    this.width = map.width;
    this.height = map.height;
    const b = map.borderRect;
    this.open = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const inside = x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;
        this.open[y * this.width + x] = inside && !map.solidAt(x, y) ? 1 : 0;
      }
    }
    this.fields = new Map(); // goal cell -> { field, made }
  }

  walkable(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.open[y * this.width + x] === 1;
  }

  /** Steps from every cell to the goal cell (breadth first), cached for a moment. */
  field(gx, gy, now) {
    const key = gy * this.width + gx;
    const cached = this.fields.get(key);
    if (cached && now - cached.made < PATH_REFRESH) return cached.field;
    const field = new Float32Array(this.width * this.height).fill(Infinity);
    if (this.walkable(gx, gy)) {
      field[key] = 0;
      const queue = [key];
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const x = i % this.width;
        const y = (i - x) / this.width;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(x + dx, y) || !this.walkable(x, y + dy))) continue;
          const j = ny * this.width + nx;
          const d = field[i] + (dx && dy ? 1.4142 : 1);
          if (d < field[j]) {
            field[j] = d;
            queue.push(j);
          }
        }
      }
    }
    if (this.fields.size > 64) this.fields.clear();
    this.fields.set(key, { field, made: now });
    return field;
  }

  /** The centre of the next cell on the way from `pos` to the goal cell, or null when there is no way. */
  nextStep(pos, gx, gy, now) {
    const field = this.field(gx, gy, now);
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    let best = this.walkable(x, y) ? field[y * this.width + x] : Infinity;
    let step = null;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.walkable(nx, ny)) continue;
      if (dx && dy && (!this.walkable(x + dx, y) || !this.walkable(x, y + dy))) continue;
      const d = field[ny * this.width + nx];
      if (d < best) {
        best = d;
        step = { x: nx + 0.5, y: ny + 0.5 };
      }
    }
    if (!step && best === 0) step = { x: x + 0.5, y: y + 0.5 };
    return step;
  }

  /** A random walkable cell centre. */
  randomCell(random) {
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(random() * this.width);
      const y = Math.floor(random() * this.height);
      if (this.walkable(x, y)) return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }
}

/** The facing that best lines up a shot from `from` at `to`: { dir, along, offset }. */
export function bestLine(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let best = null;
  for (const dir of DIRECTIONS) {
    const along = dx * dir.dx + dy * dir.dy;
    if (along <= 0) continue;
    const offset = Math.abs(dx * dir.dy - dy * dir.dx);
    if (!best || offset < best.offset) best = { dir, along, offset };
  }
  return best || { dir: DIRECTIONS[0], along: 0, offset: Infinity };
}

/** The facing closest to a vector (8 ways), or null for no vector. */
export function facingFor(dx, dy) {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
  let best = null;
  let bestDot = -Infinity;
  const len = Math.hypot(dx, dy);
  for (const dir of DIRECTIONS) {
    const dot = (dx * dir.dx + dy * dir.dy) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  return best;
}

/** Nothing tall enough to stop a bullet between two points. */
export function clearShot(map, from, to, altitude = 20) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 0.01) return true;
  const result = traceShot(map, from, Math.atan2(to.y - from.y, to.x - from.x), altitude, distance, [], null, { ignoreDeployables: false });
  return result.distance >= distance - 0.05;
}

/**
 * Decides, every tick, where a computer player walks and faces, whether it
 * fires and which gun it holds. world: { map, nav, characters, now, random }.
 */
export class NpcBrain {
  constructor(character, random = Math.random, difficulty = 'Medium') {
    this.ch = character;
    this.random = random;
    this.difficulty = LEVELS[difficulty] ? difficulty : 'Medium';
    this.level = levelFor(difficulty);
    this.shopping = SHOPPING[this.difficulty];
    // Its own shop, paid from its money (character.stats.money): crates fill it.
    this.shop = new ShopState({
      get money() { return character.stats?.money || 0; },
      set money(value) { if (character.stats) character.stats.money = value; },
    });
    // The starting Shotgun comes from that shop, so its shells are refilled like a bought gun's.
    // (The Pistol stays in hand: it is the default.)
    for (const id of this.shopping.start || [STARTING_GUN]) {
      const start = this.shop.item(id);
      if (start && !start.owned) {
        start.owned = true;
        character.pickupWeapon(start.weapon);
      }
    }
    this.nextShop = 0;
    this.switchedAt = -Infinity;
    this.onBuy = null; // (character, weapon): a new gun was bought
    this.target = null;
    this.nextThink = 0;
    this.goal = null;
    this.alignedSince = null;
    this.dodgeUntil = 0;
    this.dodgeDir = null;
    this.lastProgress = { x: 0, y: 0, at: 0 };
    this.unstickUntil = 0;
    this.wander = null;
  }

  /** Forget the old fight (after a respawn). */
  reset() {
    this.target = null;
    this.goal = null;
    this.alignedSince = null;
    this.dodgeUntil = 0;
    this.wander = null;
    this.nextThink = 0;
  }

  update(world) {
    const ch = this.ch;
    const { now } = world;
    if (!ch.active || ch.dead) {
      ch.moveDir = null;
      ch.firing = false;
      return;
    }
    if (now >= this.nextShop || !ch.weapon.available) {
      this.goShopping();
      this.nextShop = now + SHOP_TIME;
    }
    if (now >= this.nextThink) {
      this.think(world);
      this.nextThink = now + this.level.think * (0.8 + this.random() * 0.4);
    }
    this.aimAndFire(world);
  }

  /**
   * Spend the money: the next gun on its list once it can pay for it, else
   * ammo for a gun that is running low. Returns what was bought, or null.
   */
  goShopping() {
    const ch = this.ch;
    const shop = this.shop;
    const next = this.shopping.guns.find((id) => shop.item(id) && !shop.item(id).owned && !shop.item(id).blocked);
    if (next !== undefined && shop.money >= shop.item(next).fillCost) {
      const result = shop.buy(next);
      if (result.ok) {
        ch.pickupWeapon(result.weapon);
        this.onBuy?.(ch, result.weapon);
        return result.weapon;
      }
    }
    for (const id of this.shopping.guns) {
      const item = shop.item(id);
      const ammo = item?.owned && item.weapon.ammo;
      if (!ammo || ammo.count >= ammo.max * this.shopping.refillBelow) continue;
      if (shop.money >= item.fillCost && shop.buy(id).ok) return item.weapon;
    }
    return null;
  }

  enemies(world) {
    return world.characters.filter((c) => c !== this.ch && c.active && !c.dead);
  }

  think(world) {
    const ch = this.ch;
    const { map, nav, now } = world;
    // Pick a target: the nearest enemy in sight, the human slightly first; keep it unless a much better one shows up.
    const score = (c) => Math.hypot(c.pos.x - ch.pos.x, c.pos.y - ch.pos.y) * (c.npc ? 1 : this.level.playerBias) + (clearShot(map, ch.pos, c.pos) ? 0 : 8);
    const enemies = this.enemies(world);
    if (this.target && (!this.target.active || this.target.dead)) this.target = null;
    let best = null;
    let bestScore = Infinity;
    for (const e of enemies) {
      const s = score(e);
      if (s < bestScore) {
        best = e;
        bestScore = s;
      }
    }
    if (!this.target || (best && best !== this.target && bestScore < score(this.target) * TARGET_KEEP)) this.target = best;
    const target = this.target;
    this.chooseGun(target);

    // Stuck against something: walk somewhere else for a moment.
    if (Math.hypot(ch.pos.x - this.lastProgress.x, ch.pos.y - this.lastProgress.y) > 0.5) this.lastProgress = { x: ch.pos.x, y: ch.pos.y, at: now };
    else if (now - this.lastProgress.at > STUCK_TIME) {
      this.unstickUntil = now + 600;
      this.wander = nav.randomCell(this.random);
      this.lastProgress = { x: ch.pos.x, y: ch.pos.y, at: now };
    }

    // Money: a crate close enough is picked up first, unless a fight is right here.
    const crate = this.crateToTake(world, target);
    if (crate && now >= this.unstickUntil) {
      this.goal = crate;
      return;
    }

    if (!target || now < this.unstickUntil) {
      if (!this.wander || Math.hypot(this.wander.x - ch.pos.x, this.wander.y - ch.pos.y) < 1) this.wander = nav.randomCell(this.random);
      this.goal = this.wander;
      return;
    }

    // Dodge: an enemy lined up on us and facing us; step off the line (unless we are about to shoot first).
    if (now >= this.dodgeUntil) {
      const threat = enemies.find((e) => {
        if (Math.hypot(e.pos.x - ch.pos.x, e.pos.y - ch.pos.y) > (e.weapon?.range || 20)) return false;
        const dx = ch.pos.x - e.pos.x;
        const dy = ch.pos.y - e.pos.y;
        const along = dx * e.dir.dx + dy * e.dir.dy;
        return along > 0 && Math.abs(dx * e.dir.dy - dy * e.dir.dx) < FIRE_RADIUS + 0.3 && clearShot(map, e.pos, ch.pos);
      });
      const mine = bestLine(ch.pos, target.pos);
      const readyToShoot = mine.offset <= ALIGNED && this.alignedSince !== null && now - this.alignedSince >= this.level.aim;
      if (threat && !readyToShoot && this.random() < this.level.dodge) {
        const side = this.random() < 0.5 ? 1 : -1;
        this.dodgeDir = facingFor(-threat.dir.dy * side, threat.dir.dx * side);
        this.dodgeUntil = now + DODGE_TIME;
      }
    }

    // Where to stand: on one of the target's four firing lines, at a good range for the gun, in sight.
    const range = Math.min(ch.weapon.range, 14);
    const preferred = ch.weapon.id === WeaponID.SHOTGUN ? 2.5 : Math.min(range * 0.6, 7);
    let goal = null;
    let goalCost = Infinity;
    for (const line of LINES) {
      const u = (ch.pos.x - target.pos.x) * line.dx + (ch.pos.y - target.pos.y) * line.dy;
      for (const sign of [1, -1]) {
        const t = sign * Math.max(1.5, Math.min(preferred, Math.abs(u) || preferred));
        const p = { x: target.pos.x + line.dx * t, y: target.pos.y + line.dy * t };
        if (!nav.walkable(Math.floor(p.x), Math.floor(p.y))) continue;
        const cost = Math.hypot(p.x - ch.pos.x, p.y - ch.pos.y) + (clearShot(map, p, target.pos) ? 0 : 10) + (Math.sign(u) === sign ? 0 : 1);
        if (cost < goalCost) {
          goal = p;
          goalCost = cost;
        }
      }
    }
    this.goal = goal || { x: target.pos.x, y: target.pos.y };
  }

  /**
   * The nearest money crate worth walking to: none on Easy, near ones when no
   * enemy is in sight on Medium, on Hard any within reach unless an enemy is
   * close. world.crates: [{ x, y }].
   */
  crateToTake(world, target) {
    const range = this.level.crates;
    if (!range || !world.crates?.length) return null;
    const ch = this.ch;
    let best = null;
    let bestDistance = range;
    for (const c of world.crates) {
      const d = Math.hypot(c.x - ch.pos.x, c.y - ch.pos.y);
      if (d < bestDistance && world.nav.walkable(Math.floor(c.x), Math.floor(c.y))) {
        best = c;
        bestDistance = d;
      }
    }
    if (!best || !target) return best;
    const targetDistance = Math.hypot(target.pos.x - ch.pos.x, target.pos.y - ch.pos.y);
    const inSight = clearShot(world.map, ch.pos, target.pos);
    if (this.level.cycle) return targetDistance > CRATE_FIGHT || !inSight ? best : null;
    return inSight ? null : best;
  }

  /** The gun for the range: the Shotgun up close, Plasma or a long gun further off, else the Pistol. */
  chooseGun(target) {
    const ch = this.ch;
    const best = (ids) => ids.map((id) => ch.weaponByID(id)).find((w) => w?.available);
    const pistol = ch.weaponByID(WeaponID.PISTOL) || ch.weapon;
    // The Pistol is every bot's default: held while walking about with nobody to fight.
    if (!target) {
      ch.selectWeapon(pistol);
      return;
    }
    if (this.level.cycle) {
      // Hard: walk with the Pistol; aimAndFire picks the gun for each shot.
      if (this.alignedSince === null) ch.selectWeapon(pistol);
      else if (!ch.weapon.available) ch.selectWeapon(pistol);
      return;
    }
    const d = Math.hypot(target.pos.x - ch.pos.x, target.pos.y - ch.pos.y);
    const want = best(d < 3.5 ? CLOSE_RANGE : d > 9 ? LONG_RANGE : MID_RANGE) || pistol;
    if (want !== ch.weapon) ch.selectWeapon(want);
  }

  /**
   * Hard: the first loaded gun that reaches (Plasma, Shotgun, Rifle, Magnum),
   * else the Pistol, so a shot goes out every time one is ready; it takes a
   * moment (switchDelay) to change guns.
   */
  cycleGuns(distance, now) {
    const ch = this.ch;
    if (now - this.switchedAt < (this.level.switchDelay || 0)) return;
    const ready = (w) => w.available && w.isLoaded && distance <= w.range * 0.95;
    const next = CYCLE.map((id) => ch.weaponByID(id)).find((w) => w && ready(w)) || ch.weaponByID(WeaponID.PISTOL);
    if (next && ch.selectWeapon(next)) this.switchedAt = now;
  }

  aimAndFire(world) {
    const ch = this.ch;
    const { map, nav, now } = world;
    const target = this.target;
    ch.strafing = true;
    ch.firing = false;

    // Walking: a dodge step, straight at the goal when nothing is in the way, else along the route.
    let move = null;
    if (now < this.dodgeUntil && this.dodgeDir) move = this.dodgeDir;
    else if (this.goal) {
      const gx = Math.floor(this.goal.x);
      const gy = Math.floor(this.goal.y);
      const d = Math.hypot(this.goal.x - ch.pos.x, this.goal.y - ch.pos.y);
      if (d > 0.25) {
        const step = Math.floor(ch.pos.x) === gx && Math.floor(ch.pos.y) === gy ? this.goal : nav.nextStep(ch.pos, gx, gy, now) || this.goal;
        move = facingFor(step.x - ch.pos.x, step.y - ch.pos.y);
      }
    }
    ch.moveDir = move;

    if (!target || !target.active || target.dead) {
      if (move) ch.dir = move;
      return;
    }
    const line = bestLine(ch.pos, target.pos);
    ch.dir = line.dir;
    // Hard bots switch to whichever gun reaches, so the longest of them counts (up to a screen away).
    const reach = this.level.cycle ? Math.min(25, Math.max(...ch.weapons.filter((w) => (w.kind === 'gun' || w.kind === 'projectile') && w.available).map((w) => w.range))) : ch.weapon.range;
    const inRange = line.along <= reach * 0.95;
    if (line.offset <= ALIGNED && inRange && clearShot(map, ch.pos, target.pos)) {
      if (this.alignedSince === null) this.alignedSince = now;
      if (now - this.alignedSince >= this.level.aim) {
        if (this.level.cycle) this.cycleGuns(line.along, now);
        ch.firing = true;
      }
      // Lined up: hold the line (only step along it), so the shots keep landing.
      if (ch.moveDir && now >= this.dodgeUntil) {
        const along = ch.moveDir.dx * line.dir.dx + ch.moveDir.dy * line.dir.dy;
        ch.moveDir = Math.abs(along) > 0.9 ? ch.moveDir : null;
      }
    } else this.alignedSince = null;
  }
}
