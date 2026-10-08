import assert from 'node:assert/strict';
import test from 'node:test';

import { hdScale, matchCostumes, pendingHdSheets, setHdSheets } from '../client/src/render/assets.js';

test('HD sheets load after start-up, characters first, and a costume only when all of its sheets are upscaled', () => {
  setHdSheets({
    sprites: { BondBody: 4, BondBodyCustom: 4, BondHead: 4, BondHeadCustom: 4, CopBodyCustom: 4, CopHead: 4, CopHeadCustom: 4, SwatBody: 4, SwatBodyCustom: 4, SwatHeadCustom: 4, Crate1: 3 },
    images: {},
  });
  const sheets = ['BondBody', 'BondBodyCustom', 'BondHead', 'BondHeadCustom', 'CopBody', 'CopBodyCustom', 'CopHead', 'CopHeadCustom', 'SwatBody', 'SwatBodyCustom', 'SwatHeadCustom', 'Crate1', 'Crate2'];
  matchCostumes(sheets);
  assert.equal(hdScale('BondBody'), 1); // the original until swapped in
  const pending = pendingHdSheets();
  const names = pending.map(([image]) => image);
  assert.deepEqual(names, ['BondBody', 'BondBodyCustom', 'BondHead', 'BondHeadCustom', 'SwatBody', 'SwatBodyCustom', 'SwatHeadCustom', 'Crate1']);
  assert.deepEqual(pending.at(-1), ['Crate1', 3, 'assets/game/sprites-hd/Crate1.png']);
  setHdSheets({});
});
