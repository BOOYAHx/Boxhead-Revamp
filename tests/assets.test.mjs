import assert from 'node:assert/strict';
import test from 'node:test';

import { hdScale, matchCostumes, setHdSheets } from '../client/src/render/assets.js';

test('a costume is drawn in HD only when all of its sheets are', () => {
  setHdSheets({
    sprites: { BondBody: 4, BondBodyCustom: 4, BondHead: 4, BondHeadCustom: 4, CopBodyCustom: 4, CopHead: 4, CopHeadCustom: 4, SwatBody: 4, SwatBodyCustom: 4, SwatHeadCustom: 4, Crate1: 4 },
    images: {},
  });
  const sheets = ['BondBody', 'BondBodyCustom', 'BondHead', 'BondHeadCustom', 'CopBody', 'CopBodyCustom', 'CopHead', 'CopHeadCustom', 'SwatBody', 'SwatBodyCustom', 'SwatHeadCustom', 'Crate1', 'Crate2'];
  matchCostumes(sheets);
  assert.equal(hdScale('BondBody'), 4);
  assert.equal(hdScale('SwatHeadCustom'), 4); // Swat has no plain head sheet
  for (const sheet of ['CopBody', 'CopBodyCustom', 'CopHead', 'CopHeadCustom']) assert.equal(hdScale(sheet), 1);
  assert.equal(hdScale('Crate1'), 4); // other sheets are untouched
  setHdSheets({});
});
