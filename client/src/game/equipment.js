// Fixed 20 Hz equipment simulation. Rendering and network transport are callbacks;
// the victim judges character damage, and the owner judges deployable damage.
import { HitCircle, traceShot } from './world.js';
import { SPLASH, Weapon, WeaponID as ID } from './weapons.js';
import { padInt } from '../util/strings.js';

export const DEPLOYABLES = [
  { weaponID: ID.BARRELS, hp: 20, radius: 0.3, height: 27, solid: true, sprite: 'Barrel', variants: 3, shadow: 'Barrel_Shadow', blast: 3, inner: 2.4 },
  { weaponID: ID.BARRICADES, hp: 40, radius: 0.5, height: 20, solid: true, sprite: 'Barricade', variants: 3, shadow: 'Barricade_Shadow' },
  { weaponID: ID.C4, hp: 1, radius: 0, height: 0, solid: false, sprite: 'ChargePack', variants: 4, blast: 3, inner: 1.5 },
  { weaponID: ID.MINES, hp: 1, radius: 0.4, height: 0, solid: false, sprite: 'Claymore', blast: 3, inner: 1.5 },
];

export function parsePlacement(text) {
  if (!/^\d{12}(\d{2})?$/.test(text)) return null;
  const kind = +text[3];
  if (!DEPLOYABLES[kind]) return null;
  const record = { ownerID: text.slice(0, 3), kind, index: +text.slice(4, 6), x: +text.slice(6, 9), y: +text.slice(9, 12) };
  if (text.length === 14) record.hp = +text.slice(12, 14);
  return record;
}

export const encodeDeployableDamage = (index, attackerID, damage) => 'o' + padInt(index, 2) + padInt(attackerID, 3) + padInt(Math.max(1, Math.min(99, Math.ceil(damage))), 2);

/** The original full inner blast and steep outer falloff. */
export function blastDamage(damage, distance, radius, inner) {
  if (distance >= radius) return 0;
  if (distance < inner) return damage;
  return Math.trunc(0.5 + 0.5 * damage * (1 - ((distance - inner) / (radius - inner)) ** 1.4));
}

/**
 * Splash from a gun shot: for each ray, the point where it stopped (just short
 * of a wall), and everyone in `judged` near it who was not hit directly. Each
 * victim takes the strongest splash of the shot once; walls block it.
 * Returns [{ victim, damage, angle }].
 */
export function gunSplash(map, weapon, splash, tracers, distances, judged, direct) {
  const worst = new Map();
  tracers.forEach((t, i) => {
    const reach = Math.max(0, distances[i] - 0.05);
    const at = { x: t.start.x + Math.cos(t.angle) * reach, y: t.start.y + Math.sin(t.angle) * reach };
    for (const victim of judged) {
      if (direct.has(victim) || t.altitude > victim.height) continue;
      const away = Math.max(0, Math.hypot(victim.pos.x - at.x, victim.pos.y - at.y) - victim.moveHit.radius);
      const damage = blastDamage(weapon.damage * splash.share, away, splash.radius, splash.inner);
      if (damage > 0 && damage > (worst.get(victim)?.damage || 0) && clearBlastPath(map, at, victim.pos, t.altitude)) {
        worst.set(victim, { victim, damage, angle: Math.atan2(victim.pos.y - at.y, victim.pos.x - at.x) });
      }
    }
  });
  return [...worst.values()];
}

export function clearBlastPath(map, from, to, altitude) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return distance < 0.001 || traceShot(map, from, Math.atan2(to.y - from.y, to.x - from.x), altitude, distance, [], null, { ignoreDeployables: true }).distance >= distance - 0.001;
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export class EquipmentWorld {
  constructor(map, { localID = null, online = false, characters = () => [], hurt = () => {}, send = () => {}, activate = () => {}, effect = () => {}, placed = () => {} } = {}) {
    Object.assign(this, { map, localID, online, characters, hurt, send, activate, effect, placed });
    this.deployables = map.deployables;
    this.projectiles = [];
    this.serial = 0;
  }

  owner(id) {
    return this.characters().find((ch) => ch.id === id) || { id, name: 'Player', pos: { x: 0, y: 0 } };
  }

  canPlace(character) {
    const cell = this.map.cellAt(character.pos.x, character.pos.y);
    return !!cell && !cell.prop && ![...this.deployables.values()].some((d) => d.cellX === cell.x && d.cellY === cell.y);
  }

  placeOffline(character, weapon) {
    if (!this.canPlace(character)) return null;
    const kind = DEPLOYABLES.findIndex((d) => d.weaponID === weapon.id);
    const index = Array.from({ length: 100 }, (_, i) => i).find((i) => !this.deployables.has(i));
    if (kind < 0 || index === undefined) return null;
    return this.place({ ownerID: character.id, kind, index, x: Math.floor(character.pos.x), y: Math.floor(character.pos.y) });
  }

  place(record, snapshot = false) {
    const definition = DEPLOYABLES[record.kind];
    if (!definition || !this.map.cellAt(record.x, record.y) || record.hp === 0) return null;
    const previous = this.deployables.get(record.index);
    if (previous && previous.ownerID === record.ownerID && previous.kind === record.kind && previous.cellX === record.x && previous.cellY === record.y) {
      if (record.hp !== undefined) previous.hp = Math.min(previous.maxHp, record.hp);
      return previous; // Retransmitted placements/snapshots must not spend ammo twice.
    }
    if (previous) this.remove(previous);
    for (const old of this.deployables.values()) if (old.cellX === record.x && old.cellY === record.y) this.remove(old);
    const owner = this.owner(record.ownerID);
    const weapon = owner.weaponByID?.(definition.weaponID) || new Weapon(definition.weaponID, { remote: true });
    const d = { ...definition, kind: record.kind, index: record.index, ownerID: record.ownerID, weapon, cellX: record.x, cellY: record.y, pos: { x: record.x + 0.5, y: record.y + 0.5 }, hp: Math.min(definition.hp, record.hp ?? definition.hp), maxHp: definition.hp, escape: new Set(), pendingDamage: 0, age: 0, countdown: null };
    d.hit = new HitCircle(d.pos, d.radius);
    for (const ch of this.characters()) if (d.solid && ch.moveHit && d.hit.ejectCircle(ch.moveHit)) d.escape.add(ch);
    this.deployables.set(d.index, d);
    if (d.kind === 2) { weapon.chargePack = d; weapon.display = 'Detonator'; }
    if (!snapshot) this.placed(d);
    return d;
  }

  serverMessage(message) {
    if (message[0] === 'n') {
      const record = parsePlacement(message.slice(1));
      if (record) this.place(record);
    } else if (message[0] === 'r') {
      const records = [];
      if ((message.length - 1) % 14) return;
      for (let i = 1; i < message.length; i += 14) {
        const record = parsePlacement(message.slice(i, i + 14));
        if (!record) return;
        records.push(record);
      }
      const indices = new Set(records.filter((r) => r.hp > 0).map((r) => r.index));
      for (const d of this.deployables.values()) if (!indices.has(d.index)) this.remove(d);
      for (const record of records) this.place(record, true);
    } else if (/^o\d{4,5}$/.test(message)) {
      const d = this.deployables.get(+message.slice(1, 3));
      if (!d) return;
      const hp = message.length === 6 ? 0 : +message.slice(3);
      d.pendingDamage = 0;
      if (hp > 0) d.hp = Math.min(d.maxHp, hp);
      else this.destroy(d, message.length === 6 ? this.owner(message.slice(3)) : d.lastAttacker || this.owner(d.ownerID));
    }
  }

  remove(d) {
    this.deployables.delete(d.index);
    if (d.weapon.chargePack === d) { d.weapon.chargePack = null; d.weapon.display = 'ChargePackHeld'; }
  }

  removeOwner(id) {
    for (const d of this.deployables.values()) if (d.ownerID === id) this.remove(d);
  }

  damage(d, attacker, amount, detonate = false) {
    if (!this.deployables.has(d.index) || d.ownerID !== this.localID || amount <= 0 || (!d.solid && !detonate)) return;
    if (d.pendingDamage >= d.hp) return;
    d.lastAttacker = attacker;
    if (this.online) {
      const damage = Math.max(1, Math.min(99, Math.ceil(amount)));
      d.pendingDamage += damage;
      this.send(encodeDeployableDamage(d.index, attacker.id, damage));
    } else {
      d.hp = Math.max(0, d.hp - amount);
      if (d.hp === 0) this.destroy(d, attacker);
    }
  }

  detonate(d) {
    if (d && d.ownerID === this.localID) this.damage(d, this.owner(d.ownerID), d.hp, true);
  }

  activateMine(index, source) {
    const d = this.deployables.get(index);
    if (d?.kind === 3 && d.ownerID === source && d.countdown === null) {
      d.countdown = 20;
      this.effect({ type: 'mine', pos: d.pos });
      return true;
    }
    return false;
  }

  destroy(d, attacker) {
    this.remove(d); // Remove first: chain reactions cannot hit it twice.
    if (d.blast) {
      const source = d.kind === 0 ? attacker : this.owner(d.ownerID);
      this.explode({ pos: d.pos, altitude: 0, radius: d.blast, inner: d.inner, damage: d.weapon.damage, weaponID: d.kind === 0 ? 99 : d.weaponID, owner: source });
    } else this.effect({ type: 'debris', pos: d.pos });
  }

  fire(owner, weapon, shot) {
    if (![ID.GRENADES, ID.GRENADE_LAUNCHER, ID.PLASMA, ID.AIRSTRIKE].includes(weapon.id)) return;
    if (![shot.start.x, shot.start.y, shot.angle, shot.param].every(Number.isFinite)) return;
    const plasma = weapon.id === ID.PLASMA, beacon = weapon.id === ID.AIRSTRIKE;
    const speed = plasma ? 1.2 : beacon ? 0 : Math.max(0, Math.min(5, shot.param / 100));
    const p = { id: ++this.serial, weaponID: weapon.id, owner, damage: weapon.damage, pos: { ...shot.start }, altitude: plasma ? weapon.barrelAltitude : beacon ? 0 : weapon.id === ID.GRENADES ? 21 : 30, vx: Math.cos(shot.angle) * speed, vy: Math.sin(shot.angle) * speed, vz: (speed * 100 + 20) * 0.2, age: 0, bounces: 3, damaged: new Set(), dead: false, radius: beacon ? 6 : 3, inner: beacon ? 4.5 : 1.5 };
    p.prevPos = { ...p.pos };
    p.prevAltitude = p.altitude;
    this.projectiles.push(p);
    // Trace the barrel offset as well, so firing against a wall cannot spawn an orb through it.
    this.advance(p, Math.cos(shot.angle) * weapon.barrelDistance, Math.sin(shot.angle) * weapon.barrelDistance);
  }

  advance(p, dx, dy) {
    const distance = Math.hypot(dx, dy);
    if (!distance || p.dead) return;
    const from = { ...p.pos };
    const angle = Math.atan2(dy, dx);
    const collision = traceShot(this.map, from, angle, p.altitude, distance, [], null, { ignoreDeployables: true });
    const travel = Math.max(0, collision.distance - (collision.obstacle ? 0.002 : 0));
    p.pos.x += dx / distance * travel;
    p.pos.y += dy / distance * travel;
    if (p.weaponID === ID.PLASMA) this.pulse(p, from);
    if (collision.obstacle) {
      if (p.weaponID === ID.GRENADES) {
        const h = collision.shape;
        let nx = p.pos.x - h.x, ny = p.pos.y - h.y;
        if (h.radius === undefined) {
          if (Math.abs(nx) / h.xRad > Math.abs(ny) / h.yRad) { nx = Math.sign(nx); ny = 0; }
          else { nx = 0; ny = Math.sign(ny); }
        }
        const length = Math.hypot(nx, ny) || 1;
        nx /= length; ny /= length;
        const dot = p.vx * nx + p.vy * ny;
        p.vx = (p.vx - 2 * dot * nx) * 0.4;
        p.vy = (p.vy - 2 * dot * ny) * 0.4;
        this.effect({ type: 'bounce', pos: p.pos });
      } else this.finish(p);
    }
  }

  pulse(p, from) {
    for (const ch of this.characters()) {
      if (!(ch.local || ch.npc) || ch === p.owner || !ch.active || ch.dead || p.damaged.has(ch)) continue;
      if (segmentDistance(ch.pos, from, p.pos) <= 0.6 + ch.moveHit.radius && clearBlastPath(this.map, p.pos, ch.pos, p.altitude)) {
        p.damaged.add(ch);
        this.hurt(p.owner, { id: p.weaponID, damage: p.damage }, Math.atan2(p.vy, p.vx), ch);
      }
    }
    for (const d of [...this.deployables.values()]) {
      if (!d.solid || d.ownerID !== this.localID || p.damaged.has(d)) continue;
      if (segmentDistance(d.pos, from, p.pos) <= 0.6 + d.radius && clearBlastPath(this.map, p.pos, d.pos, p.altitude)) {
        p.damaged.add(d);
        this.damage(d, p.owner, p.damage);
      }
    }
  }

  explode(p) {
    this.effect({ type: 'explosion', pos: { ...p.pos }, altitude: p.altitude, radius: p.radius, weaponID: p.weaponID });
    for (const ch of this.characters()) {
      if (!(ch.local || ch.npc) || !ch.active || ch.dead || p.altitude > ch.height) continue; // offline the computer players are judged here too
      const damage = blastDamage(p.damage, Math.hypot(ch.pos.x - p.pos.x, ch.pos.y - p.pos.y), p.radius, p.inner);
      if (damage > 0 && clearBlastPath(this.map, p.pos, ch.pos, p.altitude)) this.hurt(p.owner, { id: p.weaponID, damage }, Math.atan2(ch.pos.y - p.pos.y, ch.pos.x - p.pos.x), ch);
    }
    for (const d of [...this.deployables.values()]) {
      if (!d.solid || d.ownerID !== this.localID || p.altitude > d.height) continue;
      const damage = blastDamage(p.damage, Math.hypot(d.pos.x - p.pos.x, d.pos.y - p.pos.y), p.radius, p.inner);
      if (damage > 0 && clearBlastPath(this.map, p.pos, d.pos, p.altitude)) this.damage(d, p.owner, damage);
    }
  }

  /** The plasma orb's burst where it ends: never its owner, nor anyone it already went through. */
  plasmaSplash(p) {
    const splash = SPLASH[ID.PLASMA];
    for (const ch of this.characters()) {
      if (!(ch.local || ch.npc) || ch === p.owner || !ch.active || ch.dead || p.damaged.has(ch) || p.altitude > ch.height) continue;
      const away = Math.max(0, Math.hypot(ch.pos.x - p.pos.x, ch.pos.y - p.pos.y) - ch.moveHit.radius);
      const damage = blastDamage(p.damage * splash.share, away, splash.radius, splash.inner);
      if (damage > 0 && clearBlastPath(this.map, p.pos, ch.pos, p.altitude)) this.hurt(p.owner, { id: p.weaponID, damage }, Math.atan2(ch.pos.y - p.pos.y, ch.pos.x - p.pos.x), ch);
    }
  }

  finish(p) {
    if (p.dead) return;
    p.dead = true;
    if (p.weaponID === ID.PLASMA) {
      this.effect({ type: 'plasma', pos: { ...p.pos }, altitude: p.altitude });
      this.plasmaSplash(p);
    } else this.explode(p);
  }

  tick() {
    for (const d of [...this.deployables.values()]) {
      d.age++;
      if (d.kind !== 3) continue;
      if (d.countdown !== null) {
        d.countdown = Math.max(0, d.countdown - 1);
        if (d.countdown === 0) this.detonate(d);
      } else if (d.ownerID === this.localID && this.characters().some((ch) => ch.id !== d.ownerID && ch.active && !ch.dead && Math.hypot(ch.pos.x - d.pos.x, ch.pos.y - d.pos.y) <= d.radius + ch.moveHit.radius)) {
        this.activateMine(d.index, d.ownerID);
        this.activate('a' + d.index);
      }
    }
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.prevPos = { ...p.pos }; p.prevAltitude = p.altitude;
      p.age++;
      if (p.weaponID === ID.AIRSTRIKE) {
        if (p.age >= 50) this.finish(p);
        continue;
      }
      this.advance(p, p.vx, p.vy);
      if (p.dead) continue;
      if (p.weaponID !== ID.PLASMA) {
        const prop = this.map.cellAt(p.pos.x, p.pos.y)?.prop;
        const floor = prop?.height || 0;
        p.altitude += p.vz;
        p.vz -= 5;
        if (p.altitude <= floor && p.vz < 0) {
          p.altitude = floor;
          if (p.weaponID === ID.GRENADE_LAUNCHER) this.finish(p);
          else {
            p.vz = p.bounces-- > 0 ? -p.vz * 0.32 : 0;
            p.vx *= 0.7; p.vy *= 0.7;
          }
        }
        if (p.weaponID === ID.GRENADES && p.age >= 30) this.finish(p);
      }
      // Bounded lifetime and travel even for malformed peer shots or open maps.
      if (p.age > 200 || p.pos.x < -5 || p.pos.y < -5 || p.pos.x > this.map.width + 5 || p.pos.y > this.map.height + 5) p.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }
}
