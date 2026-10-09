import test from 'node:test';
import assert from 'node:assert/strict';
import { keepConsoleKeys } from '../client/src/ui/keyboard.js';
import { defaultBindings, KeyState, setBind } from '../client/src/game/controls.js';

function fixture() {
  const target = new EventTarget();
  const doc = { body: {}, activeElement: null, defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) } };
  const dispatchAt = (receiver, type, element) => {
    const event = new Event(type);
    Object.defineProperty(event, 'target', { value: element });
    receiver.dispatchEvent(event);
  };
  const element = (typing = false) => ({
    typing, disabled: false, hidden: false, tabIndex: 0,
    closest(selector) { return selector.startsWith('[hidden]') ? (this.hidden ? this : null) : (this.typing ? this : null); },
    getClientRects() { return this.hidden ? [] : [{}]; },
    focus() { doc.activeElement = this; dispatchAt(target, 'focusin', this); },
  });
  const stage = new EventTarget();
  const fields = [];
  Object.assign(stage, element(), { ownerDocument: doc, contains: (el) => el === stage || fields.includes(el), querySelectorAll: () => fields });
  stage.focus = () => { doc.activeElement = stage; dispatchAt(target, 'focusin', stage); };
  doc.activeElement = stage;
  let playing = true;
  const release = keepConsoleKeys(stage, { target, document: doc, playing: () => playing });
  const key = (code, options = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { keyCode: code, key: code === 9 ? 'Tab' : '', ...options });
    target.dispatchEvent(event);
    return event;
  };
  return { target, doc, stage, fields, element, key, release, dispatchAt, menu: () => { playing = false; } };
}

test('Tab and Shift+Tab stay inside gameplay through repeated keydowns', () => {
  const f = fixture();
  const keys = new KeyState(f.target);
  try {
    for (const shiftKey of [false, true]) {
      for (let i = 0; i < 30; i++) {
        const event = f.key(9, { shiftKey, repeat: i > 0 });
        assert.equal(event.defaultPrevented, true);
        assert.equal(f.doc.activeElement, f.stage);
        assert.equal(keys.isDown('scores'), true);
      }
    }
    f.target.dispatchEvent(Object.assign(new Event('keyup'), { keyCode: 9 }));
    assert.equal(keys.isDown('scores'), false);
  } finally { keys.destroy(); f.release(); }
});

test('modified game keys cancel page actions and follow bindings changed at runtime', () => {
  defaultBindings();
  const f = fixture();
  try {
    assert.equal(f.key(32, { shiftKey: true }).defaultPrevented, true);
    assert.equal(f.key(82, { ctrlKey: true }).defaultPrevented, true);
    assert.equal(f.key(37, { altKey: true }).defaultPrevented, true);
    assert.equal(f.key(112).defaultPrevented, false); // initially unbound F1
    setBind('fire', true, 112);
    assert.equal(f.key(112, { repeat: true }).defaultPrevented, true);
  } finally { defaultBindings(); f.release(); }
});

test('menu fields wrap forward and backwards without reaching outside links', () => {
  const f = fixture(); f.menu();
  const first = f.element(true), second = f.element(true), hidden = f.element(true), disabled = f.element(true);
  hidden.hidden = true; disabled.disabled = true;
  f.fields.push(first, second, hidden, disabled);
  try {
    assert.equal(f.key(9).defaultPrevented, true);
    assert.equal(f.doc.activeElement, first);
    f.key(9); assert.equal(f.doc.activeElement, second);
    f.key(9); assert.equal(f.doc.activeElement, first);
    f.key(9, { shiftKey: true }); assert.equal(f.doc.activeElement, second);
    f.key(9, { shiftKey: true }); assert.equal(f.doc.activeElement, first);
  } finally { f.release(); }
});

test('typing in console inputs works and existing field navigation is respected', () => {
  const f = fixture();
  const field = f.element(true); f.fields.push(field); f.doc.activeElement = field;
  try {
    assert.equal(f.key(32).defaultPrevented, false);
    assert.equal(f.key(82, { ctrlKey: true }).defaultPrevented, false);
    assert.equal(f.key(13).defaultPrevented, false);
    assert.equal(f.key(9, { shiftKey: true }).defaultPrevented, true);
    assert.equal(f.doc.activeElement, field);
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'Tab', keyCode: 9 }); event.preventDefault();
    f.target.dispatchEvent(event);
    assert.equal(f.doc.activeElement, field);
  } finally { f.release(); }
});

test('removed menu inputs hand focus back to the game, while deliberate outside clicks release it', () => {
  const f = fixture();
  try {
    f.doc.activeElement = f.doc.body; // focused login field removed during a screen change
    assert.equal(f.key(9, { shiftKey: true }).defaultPrevented, true);
    assert.equal(f.doc.activeElement, f.stage);
    f.target.dispatchEvent(new Event('pointerdown')); // pointer target is outside stage
    f.doc.activeElement = f.doc.body;
    assert.equal(f.key(9).defaultPrevented, false);
    f.doc.activeElement = { outside: true };
    assert.equal(f.key(9, { shiftKey: true }).defaultPrevented, false);
    assert.equal(f.key(32).defaultPrevented, false);
    // Clicking the game again restores keyboard ownership, including after a
    // subsequent screen transition removes the focused menu field.
    f.dispatchAt(f.target, 'pointerdown', f.stage);
    f.dispatchAt(f.stage, 'click', f.stage);
    f.doc.activeElement = f.doc.body;
    assert.equal(f.key(9, { repeat: true, shiftKey: true }).defaultPrevented, true);
    assert.equal(f.doc.activeElement, f.stage);
  } finally { f.release(); }
});

test('Phaser receives a key before capture; cleanup and ordinary menu activation work', () => {
  const f = fixture();
  f.release();
  let phaserReceived = false;
  f.target.addEventListener('keydown', (event) => { phaserReceived = !event.defaultPrevented; });
  const release = keepConsoleKeys(f.stage, { target: f.target, document: f.doc, playing: () => true });
  assert.equal(f.key(9, { shiftKey: true }).defaultPrevented, true);
  assert.equal(phaserReceived, true);
  release();
  assert.equal(f.key(9).defaultPrevented, false);
  f.menu();
  const menuRelease = keepConsoleKeys(f.stage, { target: f.target, document: f.doc });
  try { assert.equal(f.key(13).defaultPrevented, false); assert.equal(f.key(32).defaultPrevented, false); }
  finally { menuRelease(); }
});
