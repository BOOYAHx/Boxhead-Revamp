// What the map editor offers: ground textures, painted marks (decals), props
// grouped like a builder's catalogue, spawn points and the eraser. Codes and
// variants are the map format's (game/world.js describeProp).

import { TEXTURES } from '../game/world.js';

export const GROUND_NAMES = {
  0: 'Bare ground',
  1: 'Grass',
  2: 'Asphalt',
  3: 'Dark asphalt',
  4: 'Tiles',
  5: 'Wood floor',
  6: 'Pavement',
  7: 'Concrete',
  8: 'Paving stones',
  9: 'Gravel',
  10: 'Road',
};

export const GROUND = TEXTURES.map((name, texture) => ({ type: 'ground', texture, image: name, label: GROUND_NAMES[texture] || name || 'Bare ground' }));

/** Decal sheets: a letter (world.js DECALS) and how many cells each sheet holds. */
export const MARKS = [
  { code: 'c', label: 'Road lines', count: 5 },
  { code: 'b', label: 'Curbs', count: 12 },
  { code: 'g', label: 'Sidewalk edges', count: 16 },
  { code: 'f', label: 'Grass and rock edges', count: 12 },
  { code: 'e', label: 'Grass bits', count: 16 },
  { code: 'a', label: 'Cracks', count: 16 },
];

const prop = (code, variant, label) => ({ type: 'prop', code, variant, label });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const PROPS = [
  {
    label: 'Nature',
    items: [prop('t', 1, 'Tree'), prop('t', 2, 'Big tree'), prop('r', 1, 'Rock'), prop('r', 2, 'Low rock')],
  },
  {
    label: 'Street',
    items: [
      prop('c', 1, 'Crate'), prop('c', 2, 'Crate'),
      ...range(1, 3).map((v) => prop('u', v, 'Trash can')),
      prop('u', 11, 'Fire hydrant'), prop('u', 12, 'Fire hydrant'),
      ...range(21, 24).map((v) => prop('u', v, 'Mailbox')),
    ],
  },
  {
    label: 'Wooden fence',
    items: [
      prop('f', 7, 'Fence corner ┌'), prop('f', 8, 'Fence, top side'), prop('f', 9, 'Fence corner ┐'),
      prop('f', 4, 'Fence, left side'), prop('f', 6, 'Fence, right side'),
      prop('f', 1, 'Fence corner └'), prop('f', 2, 'Fence, bottom side'), prop('f', 3, 'Fence corner ┘'),
    ],
  },
  {
    label: 'Walls',
    items: [
      prop('f', 11, 'Brick wall, across (2 cells)'), prop('f', 12, 'Brick wall, down (2 cells)'), prop('f', 13, 'Brick block'),
      prop('w', 2, 'Concrete wall, across (6 x 2)'), prop('w', 3, 'Concrete wall, down (2 x 6)'), prop('w', 1, 'Concrete post (2 x 2)'),
      ...range(21, 29).map((v) => prop('f', v, 'Castle wall')),
    ],
  },
  {
    label: 'Buildings',
    items: [
      prop('b', 5, 'Warehouse, garage door (3 cells)'), prop('b', 4, 'Warehouse, windows (2 cells)'),
      prop('b', 1, 'Warehouse, wall'), prop('b', 2, 'Warehouse, wall'), prop('b', 3, 'Warehouse, wall'),
      prop('b', 6, 'Warehouse roof (with a vent)'), prop('b', 7, 'Warehouse roof'),
      prop('b', 11, 'Shop front (2 cells)'), prop('b', 12, 'Shop front'), prop('b', 13, 'Shop roof'), prop('b', 14, 'Shop roof (no shadow)'),
      ...range(21, 24).map((v) => prop('b', v, 'Tall building front')), prop('b', 25, 'Tall building roof'),
    ],
  },
  {
    label: 'Vehicles',
    items: [
      ...range(1, 6).map((v) => prop('a', v, 'Car (3 x 2)')),
      ...range(7, 9).map((v) => prop('a', v, 'Truck (2 x 3)')),
      ...range(10, 15).map((v) => prop('a', v, 'Wreck (2 x 1)')),
    ],
  },
];

export const SPAWN = { type: 'spawn', label: 'Spawn point' };
export const ERASER = { type: 'erase', label: 'Eraser' };
export const SELECT = { type: 'select', label: 'Select / move' };
