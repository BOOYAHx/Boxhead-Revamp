// Run with: node --test tests/
import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E, N, byVector } from '../client/src/game/Direction.js';
import { FALLBACK_MAPS, WAREHOUSE_FIXED, WAREHOUSE_ORIGINAL } from '../client/src/game/maps.js';
import { HitRect, parseMap, traceShot } from '../client/src/game/world.js';
import { decrypt, encrypt } from '../client/src/net/Connection.js';
import { fromAlphaCharacter, fromAlphaNumericCharacter, padInt, toAlphaNumericCharacter } from '../client/src/util/strings.js';

test('alphanumeric codes match StringFunctions', () => {
  assert.equal(fromAlphaCharacter('a'), 0);
  assert.equal(fromAlphaCharacter('Z'), 51);
  assert.equal(fromAlphaNumericCharacter('9'), 9);
  assert.equal(fromAlphaNumericCharacter('d'), 13);
  assert.equal(fromAlphaNumericCharacter('B'), 37);
  for (let n = 0; n < 62; n++) assert.equal(fromAlphaNumericCharacter(toAlphaNumericCharacter(n)), n);
  assert.equal(padInt(7, 3), '007');
  assert.equal(padInt(1234, 3), '999');
});

test('chat encryption round-trips', () => {
  for (const text of ['c hello there;', 'a12;', 'x']) assert.equal(decrypt(encrypt(text)), text);
});

test('Warehouse fallback map parses', () => {
  const map = parseMap(FALLBACK_MAPS[0].data);
  assert.equal(map.width, 60);
  assert.equal(map.height, 37);
  assert.equal(map.spawns.length, 12);
  assert.ok(map.props.length > 400);
  assert.equal(map.border, 1);
});

test('the Warehouse repair swaps the obstacle layer', () => {
  const broken = parseMap('160;37;' + WAREHOUSE_ORIGINAL + ';d9d2c71e;;1');
  const fixed = parseMap('160;37;' + WAREHOUSE_FIXED + ';d9d2c71e;;1');
  assert.equal(broken.props.length, fixed.props.length);
});

test('terrain run lengths repeat the previous texture', () => {
  // 4x2 map: 'b' (grass) once, then 2 more grass, then 'c' (asphalt) fills the rest.
  const map = parseMap('14;2;;ffffff1b2c;;0');
  assert.deepEqual(map.cells.map((c) => c.texture), [1, 1, 1, 2, 2, 2, 2, 2]);
});

test('characters stop at walls and slide along them', () => {
  const map = parseMap('110;10;55c1;ffffff1b;;0'); // one crate at (5,5)
  const ch = new Character({ local: true });
  ch.respawn(5.5, 8.5);
  ch.moveDir = N;
  for (let i = 0; i < 40; i++) ch.move(map);
  assert.ok(ch.pos.y >= 6 + 0.42 - 0.02, `stopped below the crate, got ${ch.pos.y}`);
  ch.moveDir = E;
  for (let i = 0; i < 5; i++) ch.move(map);
  assert.ok(ch.pos.x > 6.4, 'can move sideways after being blocked');
});

test('characters cannot leave the map', () => {
  const map = parseMap('110;10;;ffffff1b;;0');
  const ch = new Character({ local: true });
  ch.respawn(1, 1);
  ch.moveDir = byVector(-1, -1);
  for (let i = 0; i < 40; i++) ch.move(map);
  assert.ok(ch.pos.x >= 0.4 && ch.pos.y >= 0.4);
});

test('bullets stop at props and hit characters in front of them', () => {
  const map = parseMap('110;10;55c1;ffffff1b;;0');
  const near = new Character();
  near.respawn(3.5, 5.5);
  const behind = new Character();
  behind.respawn(8.5, 5.5);
  const result = traceShot(map, { x: 1, y: 5.5 }, 0, 18, 20, [near, behind], null);
  assert.equal(result.characters.length, 1);
  assert.equal(result.characters[0].target, near);
  assert.ok(Math.abs(result.distance - 4) < 1e-6, 'blocked by the crate face at x=5');
});

test('HitRect ejects a circle sideways', () => {
  const rect = new HitRect({ x: 5, y: 5 }, 0.5, 0.5);
  const push = rect.ejectCircle({ x: 4.3, y: 5, radius: 0.42 });
  assert.ok(push.x < 0 && push.y === 0);
});

test('movement packets round-trip like Game.sendUpdate', async () => {
  const { encodeMove, parseMove, shouldSendMove, cellPosToString, stringToCellPos } = await import('../client/src/net/protocol.js');
  const ch = new Character();
  ch.respawn(12.345, 7.5);
  ch.moveDir = E;
  ch.dir = E;
  ch.collided = true;
  const packet = encodeMove(ch);
  assert.equal(packet.text, '101234007507' + '6' + '1');
  const move = parseMove(packet.text);
  assert.deepEqual(move.pos, { x: 12.34, y: 7.5 });
  assert.equal(move.moveDir, E);
  assert.equal(move.dir, E);
  assert.equal(move.blocked, true);
  // Unchanged walking is not resent; a turn or a block is.
  const walking = { ...packet, flags: 0 };
  assert.equal(shouldSendMove(walking, walking, false), false);
  assert.equal(shouldSendMove({ ...walking, dir: 2 }, walking, false), true);
  assert.equal(shouldSendMove(packet, packet, false), true);
  assert.equal(cellPosToString({ x: 5.5, y: 12.9 }), '005012');
  assert.deepEqual(stringToCellPos('005012'), { x: 5, y: 12 });
});

test('characters slide round trees instead of sticking to them (ejection rounds away)', async () => {
  const { Character } = await import('../client/src/game/Character.js');
  const { DIRECTIONS } = await import('../client/src/game/Direction.js');
  const { HitCircle, moveCharacter } = await import('../client/src/game/world.js');
  const tree = new HitCircle({ x: 15, y: 10.6 }, 1);
  const map = { obstaclesNear: () => [tree], borderHits: [] };
  const ch = new Character({ local: true });
  ch.respawn(10, 10);
  ch.moveDir = DIRECTIONS[6]; // east, a little above the tree's centre
  let stuck = 0;
  for (let t = 0; t < 80; t++) {
    const x = ch.pos.x;
    moveCharacter(map, ch, ch.speed);
    if (ch.pos.x === x) stuck++;
  }
  assert.equal(stuck, 0);
  assert.ok(ch.pos.x > 20);
});
