// Drawing resolution. The game world is always the original 700x490 window
// (everyone sees the same area). "Classic" draws it at that size and lets the
// browser stretch it, like the Flash player. "Enhanced" draws it at a whole
// multiple (2x, 3x...) at or just above the screen's real resolution, with
// the sprites' pixels kept crisp, and the browser shrinks that slightly to
// fit: text, lines and effects are sharp and sprite edges stay clean.

import { WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { Preferences } from '../game/preferences.js';
import { isHdTexture } from './assets.js';

const MAX_SCALE = 4; // caps the canvas at 2800x1960

export const Display = { scale: 1 };

/** True when the browser draws without a graphics card (Enhanced would be slow there). */
export function softwareRendering() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

/** The drawing scale for the current window size and options. */
export function wantedScale() {
  if (!Preferences.enhanced) return 1;
  // The game's frame on the page (play.html), or the window.
  const frame = document.getElementById('game');
  const width = frame?.clientWidth || window.innerWidth;
  const height = frame?.clientHeight || window.innerHeight;
  const fit = Math.min(width / WINDOW_WIDTH, height / WINDOW_HEIGHT);
  const scale = fit * (window.devicePixelRatio || 1);
  return Math.max(1, Math.min(MAX_SCALE, Math.ceil(scale - 0.1)));
}

/**
 * Crisp (nearest-pixel) sprites when enhanced, smooth like Flash otherwise.
 * Upscaled sheets are always smooth (they are drawn smaller than their pixels).
 */
export function applyFilters(textures, isHd = () => false) {
  const crisp = Display.scale > 1;
  for (const key of textures.getTextureKeys()) {
    if (!key.startsWith('sheet:') && !key.startsWith('img:')) continue;
    const smooth = !crisp || isHd(key);
    textures.get(key).setFilter(smooth ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST);
  }
}

/** A position rounded to the drawing grid: whole pixels in Classic, finer when enhanced (smoother motion). */
export const snap = (v) => Math.round(v * Display.scale) / Display.scale;

export const canvasSize = (scale) => ({ width: Math.round(WINDOW_WIDTH * scale), height: Math.round(WINDOW_HEIGHT * scale) });

/** A scene camera that shows the 700x490 window at the drawing scale (top-left origin). */
export function fitCamera(camera) {
  const { width, height } = canvasSize(Display.scale);
  camera.setSize(width, height);
  camera.setOrigin(0, 0);
  camera.setZoom(Display.scale);
}

/** Every Text object gets the drawing scale as its resolution, so it is rendered sharp. */
export function sharpenText() {
  const factory = Phaser.GameObjects.GameObjectFactory.prototype;
  const text = factory.text;
  factory.text = function (...args) {
    return text.apply(this, args).setResolution(Display.scale);
  };
}

function eachObject(list, fn) {
  for (const obj of list) {
    fn(obj);
    if (obj.list) eachObject(obj.list, fn); // containers
  }
}

/** Resize the canvas after the window or the Graphics option changed. */
export function applyDisplay(game) {
  const scale = wantedScale();
  if (scale === Display.scale) return;
  Display.scale = scale;
  const { width, height } = canvasSize(scale);
  game.scale.resize(width, height);
  applyFilters(game.textures, isHdTexture);
  for (const scene of game.scene.getScenes(false)) {
    if (!scene.sys.settings.active && !scene.sys.settings.visible) continue;
    fitCamera(scene.cameras.main);
    eachObject(scene.children.list, (obj) => obj.type === 'Text' && obj.setResolution(scale));
    scene.events.emit('displayscale', scale);
  }
}
