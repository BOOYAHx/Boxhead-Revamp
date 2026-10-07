import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanLook, loadLook, saveLook } from '../client/src/game/profile.js';

const memory = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = String(v)) };
};

test('the customized look is kept in the browser for offline practice', () => {
  const storage = memory();
  assert.deepEqual(loadLook(storage), { gender: 'Male', headModel: 0, headColor: 0, bodyModel: 0, bodyColor: 0 });
  saveLook({ gender: 'Female', headModel: 5, headColor: 2, bodyModel: 11, bodyColor: 3 }, storage);
  assert.deepEqual(loadLook(storage), { gender: 'Female', headModel: 5, headColor: 2, bodyModel: 11, bodyColor: 3 });
});

test('a damaged saved look falls back to safe values', () => {
  assert.deepEqual(cleanLook({ gender: 'Robot', headModel: 40, headColor: -1, bodyModel: 2.5, bodyColor: '3' }), { gender: 'Male', headModel: 0, headColor: 0, bodyModel: 0, bodyColor: 0 });
  const storage = memory();
  storage.setItem('bbh.look', '{not json');
  assert.equal(loadLook(storage).gender, 'Male');
});
