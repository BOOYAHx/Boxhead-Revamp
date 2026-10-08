import assert from 'node:assert/strict';
import test from 'node:test';

import { Lighting } from '../client/src/render/Lighting.js';
import { Preferences } from '../client/src/game/preferences.js';

// A stand-in for the WebGL renderer's lights and game objects.
function fakeScene() {
  globalThis.Phaser = { WEBGL: 2 };
  const lights = {
    on: false,
    lights: [],
    enable() { this.on = true; return this; },
    disable() { this.on = false; return this; },
    setAmbientColor(color) { this.ambient = color; return this; },
    addLight(x, y, radius, color, intensity) { const l = { x, y, radius, color, intensity }; this.lights.push(l); return l; },
    removeLight(l) { this.lights = this.lights.filter((o) => o !== l); },
  };
  return { sys: { renderer: { type: 2 } }, lights };
}

function fakeSprite() {
  return {
    scene: {},
    pipeline: 'Multi',
    setPipeline(name) { this.pipeline = name; return this; },
    resetPipeline() { this.pipeline = 'Multi'; return this; },
    once() {},
  };
}

test('lights only add to white ambient light, and switch off with Enhanced Graphics', () => {
  const saved = Preferences.enhanced;
  try {
    Preferences.enhanced = true;
    const scene = fakeScene();
    const lighting = new Lighting(scene);
    const wall = lighting.add(fakeSprite());
    assert.equal(scene.lights.on, true);
    assert.equal(scene.lights.ambient, 0xffffff); // unlit art keeps its own colours
    assert.equal(wall.pipeline, 'Light2D');
    lighting.setEnabled(false);
    assert.equal(wall.pipeline, 'Multi');
    assert.equal(scene.lights.on, false);
    lighting.flash(0, 0);
    assert.equal(scene.lights.lights.length, 0);
  } finally {
    Preferences.enhanced = saved;
    delete globalThis.Phaser;
  }
});

test('a flash fades out, waits for its delay and is removed when done', () => {
  const saved = Preferences.enhanced;
  try {
    Preferences.enhanced = true;
    const scene = fakeScene();
    const lighting = new Lighting(scene);
    const start = performance.now();
    lighting.flash(10, 20, { intensity: 2, life: 100 });
    lighting.flash(10, 20, { intensity: 2, life: 100, delay: 50 });
    const [now, later] = scene.lights.lights;
    assert.equal(later.intensity, 0);
    lighting.update(start + 25);
    assert.ok(now.intensity < 2 && now.intensity > 0.5);
    assert.equal(later.intensity, 0); // not lit yet
    lighting.update(start + 120);
    assert.equal(scene.lights.lights.length, 1);
    lighting.update(start + 200);
    assert.equal(scene.lights.lights.length, 0);
    for (let i = 0; i < 30; i++) lighting.flash(0, 0);
    assert.ok(scene.lights.lights.length <= 12); // rapid fire never piles up lights
  } finally {
    Preferences.enhanced = saved;
    delete globalThis.Phaser;
  }
});
