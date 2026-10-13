// The raised deck (b31, b32): players walk under its floor, only its posts
// and stairs block them, shots and the bots' paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { E } from '../client/src/game/Direction.js';
import { NavGrid } from '../client/src/game/npc.js';
import { describeProp, parseMap, traceShot } from '../client/src/game/world.js';
import { MapDoc, encodeMap } from '../client/src/editor/mapCode.js';

/** A 14 x 10 map with a deck whose top-left cell is (2, 2): floor over x 2..7, stairs at x 7..9 in row y 3 (variant 1). */
function deckMap(variant = 31) {
  const doc = new MapDoc({ width: 14, height: 10 });
  assert.ok(doc.place('b', variant, 2, 2));
  doc.setSpawn(0, 0, 0);
  return parseMap(encodeMap(doc));
}

test('the deck: 7 x 2, pictures in the atlas, twelve open cells, posts and stairs block', () => {
  const atlas = JSON.parse(fs.readFileSync(new URL('../client/assets/game/atlas.json', import.meta.url), 'utf8'));
  for (const v of [31, 32]) {
    const d = describeProp('b', v);
    assert.deepEqual(d.footprint, [7, 2]);
    assert.equal(d.open.length, 12);
    assert.ok(atlas[d.display] && atlas[d.shadow], d.display);
  }
  const map = deckMap();
  for (let x = 2; x < 9; x++) assert.equal(map.solidAt(x, 2), false, `under the floor or behind the stairs: ${x},2`);
  for (let x = 2; x < 7; x++) assert.equal(map.solidAt(x, 3), false, `under the floor: ${x},3`);
  assert.ok(map.solidAt(7, 3) && map.solidAt(8, 3), 'the stairs');
  const left = deckMap(32);
  assert.ok(left.solidAt(2, 3) && left.solidAt(3, 3) && !left.solidAt(8, 3), 'stairs on the left');
  const grid = new NavGrid(map);
  assert.ok(grid.walkable(4, 3) && !grid.walkable(7, 3), 'bots path under the floor, round the stairs');
});

test('the deck: walk right through under the floor, stopped by the stairs; shots pass between the posts', () => {
  const map = deckMap();
  const walker = new Character({ id: '001', local: true });
  walker.respawn(1.5, 3.0);
  walker.moveDir = E;
  for (let i = 0; i < 60; i++) walker.move(map);
  assert.ok(walker.pos.x > 5.5 && walker.pos.x < 7, `under the floor up to the stairs (x ${walker.pos.x.toFixed(2)})`);
  const other = new Character({ id: '002', local: true });
  other.respawn(1.5, 2.6);
  other.moveDir = E;
  for (let i = 0; i < 120; i++) other.move(map);
  assert.ok(other.pos.x > 9, `past the deck behind the stairs (x ${other.pos.x.toFixed(2)})`);
  const shot = traceShot(map, { x: 0.5, y: 2.6 }, 0, 22, 12, [], null);
  assert.ok(shot.distance >= 12, 'a shot under the floor goes through');
  const stairs = traceShot(map, { x: 0.5, y: 3.5 }, 0, 22, 12, [], null);
  assert.ok(stairs.distance < 7, 'the stairs stop it');
});
