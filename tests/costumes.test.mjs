// The costumes drawn for this port (tools/costumes.py): models like the original twelve.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { COLORS, MODEL_LABELS, MODELS, ORIGINAL_MODELS, tintFor } from '../client/src/game/bodyParts.js';
import { createNpc } from '../client/src/game/npc.js';
import { cleanLook } from '../client/src/game/profile.js';

const atlas = JSON.parse(fs.readFileSync(new URL('../client/assets/game/atlas.json', import.meta.url), 'utf8'));

test('Ghost Rider: a model with all four sheets, every frame of the Ninja it is drawn over', () => {
  const index = MODELS.indexOf('GhostRider');
  assert.equal(index, ORIGINAL_MODELS, 'after the original twelve, so their numbers stay the same');
  assert.equal(MODEL_LABELS.GhostRider, 'Ghost Rider');
  for (const layer of ['Body', 'BodyCustom', 'Head', 'HeadCustom']) {
    const entry = atlas['GhostRider' + layer];
    assert.ok(entry, layer);
    assert.equal(entry.frames.length, atlas['Ninja' + layer].frames.length, layer);
    assert.ok(fs.existsSync(new URL(`../client/assets/game/sprites/${entry.image}.png`, import.meta.url)), layer);
  }
  // Its colours are painted in: one untinted colour.
  assert.equal(COLORS.GhostRiderBody.length, 1);
  assert.equal(tintFor('GhostRiderHead', 0), 0xffffff);
});

test('Venom: the next model, all four sheets, one colour', () => {
  assert.equal(MODELS.indexOf('Venom'), ORIGINAL_MODELS + 1);
  for (const layer of ['Body', 'BodyCustom', 'Head', 'HeadCustom']) {
    assert.equal(atlas['Venom' + layer]?.frames.length, atlas['Ninja' + layer].frames.length, layer);
    assert.ok(fs.existsSync(new URL(`../client/assets/game/sprites/Venom${layer}.png`, import.meta.url)), layer);
  }
  assert.equal(COLORS.VenomHead.length, 1);
  assert.equal(cleanLook({ headModel: 13, bodyModel: 13 }).bodyModel, 13);
});

test('Batman: the next model, all four sheets, one colour', () => {
  assert.equal(MODELS.indexOf('Batman'), ORIGINAL_MODELS + 2);
  for (const layer of ['Body', 'BodyCustom', 'Head', 'HeadCustom']) {
    assert.equal(atlas['Batman' + layer]?.frames.length, atlas['Ninja' + layer].frames.length, layer);
    assert.ok(fs.existsSync(new URL(`../client/assets/game/sprites/Batman${layer}.png`, import.meta.url)), layer);
  }
  assert.equal(COLORS.BatmanBody.length, 1);
  assert.equal(cleanLook({ headModel: 14, bodyModel: 14 }).headModel, 14);
});

test('Ghost Rider: a saved look keeps it; the bots stick to the original costumes', () => {
  assert.deepEqual(cleanLook({ gender: 'Male', headModel: 12, headColor: 0, bodyModel: 12, bodyColor: 0 }).headModel, 12);
  assert.equal(cleanLook({ headModel: MODELS.length }).headModel, 0);
  for (let i = 0; i < 200; i++) {
    const { look } = createNpc(i % 8);
    assert.ok(look.bodyModel < ORIGINAL_MODELS && look.headModel < ORIGINAL_MODELS);
  }
});

test('costume sheets keep a gap round every frame (the HD sheets are drawn smoothly)', () => {
  for (const model of ['GhostRider', 'Venom', 'Batman']) {
    for (const layer of ['Body', 'BodyCustom', 'Head', 'HeadCustom']) {
      const frames = atlas[model + layer].frames;
      const sorted = [...frames].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const f of frames) assert.ok(f[0] >= 2 && f[1] >= 2, `${model}${layer}: off the sheet's edge`);
      for (let i = 1; i < sorted.length; i++) {
        const [a, b] = [sorted[i - 1], sorted[i]];
        if (a[1] === b[1]) assert.ok(b[0] >= a[0] + a[2] + 4, `${model}${layer}: frames ${a} and ${b} touch`);
      }
    }
  }
});
