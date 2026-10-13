// The map editor's map codes: every saved map reads in and writes back out to
// a code the game loads into exactly the same map.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { MapDoc, decodeMap, encodeMap, footprintOf } from '../client/src/editor/mapCode.js';
import { FALLBACK_MAPS } from '../client/src/game/maps.js';
import { parseMap } from '../client/src/game/world.js';

const saved = JSON.parse(fs.readFileSync(new URL('../client/assets/game/maps/maps.json', import.meta.url), 'utf8'));
const maps = [...saved, { name: 'Warehouse', data: FALLBACK_MAPS[0].data }];

/** What the game makes of a map code, minus random choices (variant 0 picks a random look). */
function summary(code) {
  const map = parseMap(code);
  return {
    size: [map.width, map.height],
    background: map.backgroundColor,
    relief: map.relief,
    border: map.border,
    textures: map.cells.map((c) => c.texture).join(','),
    props: map.props.map((p) => `${p.kind}@${p.x},${p.y}:${p.footprint}`).sort(),
    // (decals written past the bottom edge are never seen; the editor leaves them out)
    decals: map.decals.filter((d) => d.y < map.height).map((d) => `${d.image}@${d.x},${d.y}:${d.variant}`).sort(),
    spawns: map.spawns.map((s) => `${s.x},${s.y}:${s.team}`).sort(),
  };
}

for (const { name, data } of maps) {
  test(`${name}: read and written back, the game loads the same map`, () => {
    const doc = decodeMap(data, name);
    assert.deepEqual(summary(encodeMap(doc)), summary(data));
    assert.equal(encodeMap(decodeMap(encodeMap(doc))), encodeMap(doc), 'stable once written');
  });
}

test('a new map: props cannot overlap each other or a spawn point, and the code loads', () => {
  const doc = new MapDoc({ name: 'Test', width: 20, height: 12, texture: 1, relief: 1 });
  assert.ok(doc.place('a', 1, 2, 2)); // a car: 3 x 2
  assert.equal(doc.place('c', 1, 4, 3), null, 'inside the car');
  assert.ok(doc.place('c', 1, 5, 3));
  assert.ok(doc.setSpawn(8, 8));
  assert.equal(doc.place('t', 2, 7, 7), null, 'a big tree over the spawn point');
  assert.equal(doc.setSpawn(3, 3), false, 'a spawn point inside the car');
  assert.equal(doc.place('w', 2, 16, 0), null, 'a wall hanging over the edge');
  doc.setDecal(10, 5, 'c', 2);
  doc.setTexture(0, 0, 10);
  const map = parseMap(encodeMap(doc));
  assert.equal(map.props.length, 2);
  assert.deepEqual(map.spawns, [{ x: 8.5, y: 8.5, team: 0 }]);
  assert.equal(map.cells[0].texture, 10);
  assert.equal(map.cells[1].texture, 1);
  assert.equal(map.decals[0].image, 'RoadLines');
  assert.equal(map.relief, 'Relief2');
  assert.deepEqual(footprintOf('a', 1), [3, 2]);
});

test('resizing keeps what still fits', () => {
  const doc = new MapDoc({ width: 30, height: 30 });
  doc.place('a', 7, 26, 26); // a truck, 2 x 3
  doc.place('c', 2, 3, 3);
  doc.setSpawn(25, 2);
  doc.setTexture(27, 27, 4);
  const small = doc.resized(20, 20);
  assert.equal(small.props.length, 1);
  assert.equal(small.spawns.size, 0);
  const big = small.resized(40, 25);
  assert.equal(big.width, 40);
  assert.equal(big.props[0].code, 'c');
});

test('broken codes are refused with a reason', () => {
  assert.throws(() => decodeMap('hello'), /map code/);
  assert.throws(() => decodeMap('1500;20;;ebdcc71b;;0'), /at most/);
});

test('a shared map opens from a code, a downloaded file or a maps.json list', async () => {
  const { parseShared } = await import('../client/src/editor/mapCode.js');
  const doc = new MapDoc({ name: 'Shared', width: 12, height: 10, texture: 2 });
  doc.setSpawn(1, 1);
  const code = encodeMap(doc);
  assert.equal(encodeMap(parseShared(code)), code);
  assert.equal(encodeMap(parseShared(code.slice(0, 20) + '\n' + code.slice(20))), code, 'line breaks from pasting are ignored');
  const fromFile = parseShared(JSON.stringify({ name: 'Shared', data: code }));
  assert.equal(fromFile.name, 'Shared');
  assert.equal(parseShared(JSON.stringify([{ slot: 0, name: 'List', data: code }])).name, 'List');
  assert.throws(() => parseShared('{"name":"x"}'), /No map/);
});

test('a selection moves as one: blocked by anything else, carrying its spawn points and marks', async () => {
  const { selectionSize } = await import('../client/src/editor/mapCode.js');
  const doc = new MapDoc({ width: 20, height: 12 });
  const car = doc.place('a', 1, 2, 2); // 3 x 2 at 2..4, 2..3
  const crate = doc.place('c', 1, 6, 2);
  doc.setSpawn(2, 5);
  doc.setDecal(3, 5, 'c', 1);
  const tree = doc.place('t', 1, 12, 3);
  let sel = doc.selectArea(1, 1, 6, 5); // the car, the crate, the spawn point and the mark
  assert.equal(selectionSize(sel), 4);
  assert.ok(!sel.props.has(tree));
  assert.equal(doc.canMove(sel, 6, 1), false, 'the crate would land on the tree');
  assert.equal(doc.canMove(sel, 0, -3), false, 'off the top edge');
  assert.ok(doc.canMove(sel, 1, 0), 'overlapping its own old cells is fine');
  sel = doc.moveSelection(sel, 1, 1);
  assert.deepEqual([...sel.props].map((p) => [p.code, p.x, p.y]).sort(), [['a', 3, 3], ['c', 7, 3]]);
  assert.ok(doc.spawns.has(doc.index(3, 6)) && !doc.spawns.has(doc.index(2, 5)));
  assert.deepEqual(doc.decals.get(doc.index(4, 6)), { code: 'c', variant: 1 });
  assert.equal(doc.propAt(2, 2), null, 'the old cells are free');
  assert.equal(doc.place('c', 2, 2, 2) !== null, true);
  // A loose prop cannot be dropped onto a spawn point that stays put.
  const lone = doc.selectArea(12, 3, 12, 3);
  doc.setSpawn(14, 3);
  assert.equal(doc.canMove(lone, 2, 0), false);
  assert.ok(doc.removeSelection(lone));
  assert.equal(doc.props.includes(tree), false);
  assert.equal(selectionSize(doc.selectAll()), doc.props.length + doc.spawns.size + doc.decals.size);
  assert.ok(car && crate);
});

test('turning: pieces become their turned versions, groups turn about their middle, four turns come back', async () => {
  const { selectionSize } = await import('../client/src/editor/mapCode.js');
  const { turnProp, turnDecal } = await import('../client/src/editor/rotation.js');
  // Every turn table entry is a piece the game knows, and four turns come back for the fences, walls and mailboxes.
  for (const [code, variant] of [['f', 8], ['f', 7], ['f', 11], ['w', 2], ['u', 21], ['u', 11]]) {
    let v = variant;
    for (let i = 0; i < 4; i++) v = turnProp(code, v);
    assert.equal(v, variant, `${code}${variant}`);
  }
  for (const code of ['c', 'b', 'e', 'f']) for (let v = 0; v < 5; v++) assert.ok(Number.isInteger(turnDecal(code, v)));
  assert.equal(turnProp('t', 1), 1, 'a tree looks the same from every side');
  // Six car colours across, three up-down: a car turned back keeps its colour. Fences just carry on round.
  assert.equal(turnProp('a', 9), 6);
  assert.equal(turnProp('a', 9, 3), 3);
  assert.equal(turnProp('f', 6, 8), 2);

  const doc = new MapDoc({ width: 20, height: 20 });
  // A brick wall across, one cell, then a crate under its left end: turned, the wall goes down.
  doc.place('f', 11, 5, 5);
  doc.place('c', 1, 5, 6);
  doc.setDecal(6, 6, 'c', 0);
  let sel = doc.selectAll();
  const start = encodeMap(doc);
  sel = doc.rotateSelection(sel);
  assert.ok(sel);
  const wall = [...sel.props].find((p) => p.code === 'f');
  assert.equal(wall.variant, 12);
  assert.deepEqual(footprintOf('f', wall.variant), [1, 2]);
  assert.equal(doc.decals.get([...sel.decals][0]).variant, 1, 'the road line turned down');
  for (let i = 0; i < 3; i++) sel = doc.rotateSelection(sel);
  assert.equal(encodeMap(doc), start, 'four turns: as it was');
  // A single car turns into an up-down car in place; blocked, nothing changes.
  const car = new MapDoc({ width: 20, height: 20 });
  const carSel = car.selectArea(0, 0, 0, 0);
  carSel.props.add(car.place('a', 6, 5, 5));
  const turned = car.rotateSelection(carSel);
  assert.deepEqual([...turned.props].map((p) => [p.variant, ...footprintOf('a', p.variant)]), [[9, 2, 3]]);
  car.place('c', 1, 7, 6); // beside the up-down car, where the car across would go
  const before = encodeMap(car);
  assert.equal(car.rotateSelection(turned), null, 'the crate is in the way');
  assert.equal(encodeMap(car), before);
  assert.equal(selectionSize(turned), 1);
  let red = car.selectArea(0, 0, 0, 0);
  red.props.add(car.place('a', 3, 10, 10));
  for (let i = 0; i < 2; i++) red = car.rotateSelection(red);
  assert.deepEqual([...red.props].map((p) => [p.variant, p.x, p.y]), [[3, 10, 10]], 'turned twice: the same car, where it was');
});
