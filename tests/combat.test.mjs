// Step 4 rules: weapons, damage, death, respawn and the combat packets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E, N, S } from '../client/src/game/Direction.js';
import { FALLBACK_MAPS } from '../client/src/game/maps.js';
import { PISTOL_ID, Weapon, parseWeaponStats, setWeaponStats } from '../client/src/game/weapons.js';
import { chooseSpawn, parseMap, traceShot } from '../client/src/game/world.js';
import { encodeFire, encodeHit, parseDeath, parseFire } from '../client/src/net/protocol.js';

const CONSTANTS = `<data>
  <weapon id="0" name="Pistol" shortName="Pistol">
    <ammo>Infinite</ammo><damage>7</damage><range>20</range><spread>0.08</spread>
    <fireDelay>0.5</fireDelay><moveSpeed>1.0</moveSpeed>
    <upgrade1><type>damage</type><value>9</value><cost>2500</cost></upgrade1>
  </weapon>
  <weapon id="16" name="Railgun" shortName="Railgun">
    <damage>50</damage><range>Infinite</range><spread>0.05</spread><fireDelay>0.8</fireDelay><moveSpeed>1</moveSpeed>
  </weapon>
</data>`;

function player(x, y, local = true) {
  const ch = new Character({ id: local ? '001' : '002', local });
  ch.respawn(x, y);
  return ch;
}

test('weapon stats come from constants.xml, ignoring upgrade values', () => {
  const stats = parseWeaponStats(CONSTANTS);
  assert.deepEqual(stats[0], { name: 'Pistol', damage: 7, range: 20, spread: 0.08, fireDelay: 0.5, moveSpeed: 1 });
  assert.equal(stats[16].range, 1000);
  setWeaponStats(stats);
  const pistol = new Weapon(PISTOL_ID);
  assert.equal(pistol.reloadTime, 10); // 0.5 s at 20 ticks per second
});

test('the pistol fires every half second when the key is held', () => {
  const ch = player(5, 5);
  const fired = [];
  for (let tick = 0; tick < 40; tick++) {
    if (ch.weapon.isLoaded) {
      ch.weapon.shoot(ch, 0);
      fired.push(tick);
    }
    ch.weapon.process(true);
  }
  assert.deepEqual(fired, [0, 10, 20, 30]);
});

test('shot effects wait for the previous muzzle flash and report the reload', () => {
  const ch = player(5, 5);
  const w = ch.weapon;
  const shot = w.shoot(ch, 0);
  w.queueEffects(shot, 6);
  const first = w.process(true);
  assert.ok(first.effects);
  assert.ok(w.flashVisible);
  const line = w.tracerLine(first.effects);
  assert.ok(Math.abs(line.length - 5.2) < 1e-9); // distance minus the barrel
  assert.equal(line.altitude, 22);
  let reloaded = false;
  for (let i = 0; i < 9; i++) reloaded = w.process(true).reloaded || reloaded;
  assert.ok(reloaded);
});

test('shots start at the shoulder beside the fire position', () => {
  const ch = player(10, 10);
  ch.dir = E;
  const shot = ch.weapon.shoot(ch, 0);
  // Facing east, the right shoulder is 0.25 cells south (Direction index + 2).
  assert.ok(Math.abs(shot.start.x - 10) < 1e-9);
  assert.ok(Math.abs(shot.start.y - 10.25) < 1e-9);
  assert.ok(Math.abs(ch.weapon.muzzle.x - 10.8) < 1e-9);
});

test('damage lowers health, flashes, and kills at zero with a 5 s respawn', () => {
  const ch = player(5, 5);
  assert.equal(ch.hurt(7), 7);
  assert.equal(ch.hp, 93);
  assert.ok(ch.flashTime > 0);
  assert.equal(ch.hurt(200), 93); // never more than what is left
  assert.ok(ch.dead);
  assert.equal(ch.animator.name, 'Die');
  assert.equal(ch.hurt(7), 0); // dead characters take no damage
  let ticks = 0;
  while (!ch.processTimers()) ticks++;
  assert.equal(ticks, 99); // respawn on the 100th tick = 5000 ms
  ch.respawn(6, 6);
  assert.equal(ch.hp, 100);
  assert.ok(!ch.dead);
});

test('setHealth reports hurt and death', () => {
  const ch = player(5, 5, false);
  assert.equal(ch.setHealth(80), 'hurt');
  assert.equal(ch.setHealth(90), null);
  assert.equal(ch.setHealth(0), 'died');
  assert.equal(ch.setHealth(0), null);
});

test('unlag judges shots against where we were `ping` ms ago', () => {
  const map = parseMap(FALLBACK_MAPS[0].data);
  const victim = player(6.5, 27.5); // open floor north of here
  victim.moveDir = N;
  for (let i = 0; i < 20; i++) victim.move(map); // walk north for a second
  const now = { ...victim.pos };
  victim.unlag(500); // 10 ticks back
  assert.ok(victim.fireHit.y > now.y + 1);
  victim.unlag(0);
  assert.equal(victim.fireHit.pos, victim.pos);
});

test('a shot hits the victim in its path and walls stop shots', () => {
  const map = parseMap(FALLBACK_MAPS[0].data);
  const shooter = player(30.5, 18.5, false);
  const victim = player(30.5, 21.5);
  const hit = traceShot(map, shooter.pos, S.radians, 22, 20, [victim], shooter);
  assert.equal(hit.characters.length, 1);
  const miss = traceShot(map, shooter.pos, 0, 22, 20, [victim], shooter);
  assert.equal(miss.characters.length, 0);
  // Somewhere on the Warehouse a long shot must end on a wall before 20 cells.
  const blocked = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6].some((a) => traceShot(map, shooter.pos, a, 22, 20, [], shooter).distance < 20);
  assert.ok(blocked);
});

test('respawn picks the spawn point farthest from enemies', () => {
  const spawns = [{ x: 1, y: 1 }, { x: 50, y: 30 }, { x: 2, y: 2 }];
  const enemy = { pos: { x: 1.5, y: 1.5 } };
  for (let i = 0; i < 10; i++) assert.deepEqual(chooseSpawn(spawns, [enemy]), { x: 50, y: 30 });
  assert.ok(spawns.includes(chooseSpawn(spawns, [])));
  assert.equal(chooseSpawn([], [enemy]), null);
});

test('combat packets match the Flash client', () => {
  assert.equal(encodeFire(0), '40000');
  assert.equal(encodeFire(-Math.PI / 2), '42700');
  assert.equal(encodeFire(Math.PI), '41800');
  const fire = parseFire('41350');
  assert.ok(Math.abs(fire.angle - (135 * Math.PI) / 180) < 1e-12);
  assert.equal(fire.param, 0);
  assert.equal(encodeHit('002', 0, 7), '60020007');
  const crate = '00010050000500';
  assert.deepEqual(parseDeath('700100' + crate + crate), { killerID: '001', weaponID: 0, crates: [crate, crate] });
});

test('the real constants.xml parses when present', { skip: !safeRead('client/assets/game/constants.xml') }, () => {
  const stats = parseWeaponStats(safeRead('client/assets/game/constants.xml'));
  assert.equal(stats[0].damage, 7);
  assert.equal(stats[3].name, 'Shotgun');
});

function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
