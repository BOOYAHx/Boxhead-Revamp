import assert from 'node:assert/strict';
import test from 'node:test';
import { Intro } from '../client/src/ui/intro.js';
import { FlashLibrary } from '../client/src/ui/flash.js';

globalThis.document = { createElement() {}, createElementNS() {} };
globalThis.Image = function () {};

function element() {
  return {
    style: {}, children: [],
    setAttribute() {},
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.unshift(child); },
    remove() { this.removed = true; },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t) {
  t.mock.method(document, 'createElement', element);
  t.mock.method(document, 'createElementNS', element);
  const images = [];
  t.mock.method(globalThis, 'Image', function () {
    this.loaded = deferred();
    this.decode = () => this.loaded.promise;
    images.push(this);
  });
  const bar = { content: element(), gotoAndStop() {} };
  const loading = {}, version = {};
  const screen = { el: element(), child: (name) => ({ bar, loadingField: loading, versionField: version })[name] };
  const fill = { el: element() };
  const lib = {
    defs: { querySelectorAll: () => [] },
    create: (symbol) => symbol === 'MainFactory_Preloader' ? screen : fill,
  };
  t.mock.method(FlashLibrary, 'load', async () => lib);
  const intro = new Intro(element());
  return { intro, images, fill, version };
}

for (const delayed of [0, 1]) {
  test(`the complete loading screen waits for the ${delayed === 0 ? 'logo' : 'hunters'} to decode`, async (t) => {
    const { intro, images, fill, version } = setup(t);
    assert.equal(images.length, 2);
    assert.ok(images.every((image) => image.fetchPriority === 'high'));
    images[1 - delayed].loaded.resolve();
    await new Promise(setImmediate);
    assert.equal(intro.root.children.length, 0); // no partially drawn stage
    images[delayed].loaded.resolve();
    assert.equal(await intro.ready, true);
    assert.equal(intro.root.children.length, 1);
    assert.equal(version.text, 'Version 1.00');
    assert.equal(fill.scaleX, 0); // loading starts empty
    intro.progress(0.5);
    assert.equal(fill.scaleX, 0.5);
    assert.equal(fill.x, -160);
  });
}

test('a missing opening bitmap falls back instead of blocking game startup', async (t) => {
  const { intro, images } = setup(t);
  t.mock.method(console, 'warn', () => {});
  images[0].loaded.resolve();
  images[1].loaded.reject(new Error('Image unavailable'));
  assert.equal(await intro.ready, false);
  assert.equal(intro.failed, true);
  assert.equal(intro.root.removed, true);
});
