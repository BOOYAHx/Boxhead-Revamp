// The maps made for this port (game/customMaps.js): playable, in free slots a room can name.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { CUSTOM_MAPS, withCustomMaps } from '../client/src/game/customMaps.js';
import { parseMap } from '../client/src/game/world.js';
import { decodeMap, encodeMap } from '../client/src/editor/mapCode.js';
import { fromAlphaCharacter } from '../client/src/util/strings.js';

const saved = JSON.parse(fs.readFileSync(new URL('../client/assets/game/maps/maps.json', import.meta.url), 'utf8'));

test('The custom maps load, with spawn points, and read back the same in the editor', () => {
  assert.deepEqual(CUSTOM_MAPS.map((m) => m.name), ['Hedge Town', 'Thorn Gardens', 'Juke Town', 'Scrap', 'Prison Yard']);
  for (const map of CUSTOM_MAPS) {
    const world = parseMap(map.data);
    assert.ok(world.width > 0 && world.height > 0 && world.props.length > 0, map.name);
    assert.ok(world.spawns.length >= 8, `${map.name}: ${world.spawns.length} spawn points`);
    assert.equal(encodeMap(decodeMap(map.data)), map.data, map.name);
  }
});

test('their slots are free, unique and fit a room\'s map letter (A-Z)', () => {
  const taken = new Set(saved.map((m) => m.slot));
  const names = new Set(saved.map((m) => m.name));
  for (const map of CUSTOM_MAPS) {
    assert.ok(!taken.has(map.slot) && !names.has(map.name), map.name);
    taken.add(map.slot);
    // Connection.createRoom sends A-Z; room info is read back lower-case.
    assert.equal(fromAlphaCharacter(String.fromCharCode(65 + map.slot).toLowerCase()), map.slot);
  }
  const list = withCustomMaps(saved.map((m) => ({ ...m, saved: true })).reduce((l, m) => ((l[m.slot] = m), l), []));
  assert.equal(list[7].name, 'Hedge Town');
  assert.equal(list[8], undefined, 'Nuketown\'s old slot stays empty');
  assert.equal(list[9].name, 'Thorn Gardens');
  assert.equal(list[10].name, 'Juke Town');
  assert.equal(list[11].name, 'Scrap');
  assert.equal(list[12].name, 'Prison Yard');
  assert.equal(list[0].name, saved[0].name, 'saved maps keep their slots');
  assert.equal(withCustomMaps([, , , , , , , { name: 'Taken' }])[7].name, 'Taken', 'a slot already in use is not taken over');
});
