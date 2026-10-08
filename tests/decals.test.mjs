import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMap } from '../client/src/game/world.js';
import { decalCell } from '../client/src/render/MapView.js';

test('decal cells are picked from their sheets like SheetDecal', () => {
  assert.deepEqual(decalCell(200, 28, 3), [120, 0]); // RoadLines: 5 x 1
  assert.deepEqual(decalCell(240, 56, 7), [40, 28]); // Curb: 6 x 2
  assert.deepEqual(decalCell(40, 336, 11), [0, 308]); // GrassRockEdge: 1 x 12
  assert.deepEqual(decalCell(160, 112, 17), [40, 0]); // Cracks: 4 x 4, wraps around
});

test('maps keep their road lines and other decals', () => {
  // 3 x 2 map, no obstacles, plain ground; decals: road line 2 at (1, 0), curb 5 at (0, 1).
  const map = parseMap('13;2;;d9d2c71b;1c21b5;1');
  assert.deepEqual(map.decals.map((d) => [d.x, d.y, d.image, d.variant]), [[1, 0, 'RoadLines', 2], [0, 1, 'Curb', 5]]);
});
