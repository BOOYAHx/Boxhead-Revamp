// Character pictures for the lobby (boxhead.ui.CharacterBox.drawCharacter):
// the character idle, facing south-west with a pistol, over its shadow,
// drawn from the game's sprite sheets onto a canvas.

import { MODELS, tintFor } from '../game/bodyParts.js';
import { Animator } from '../game/Character.js';
import { SHADOW_ALPHA } from '../game/constants.js';
import { SW } from '../game/Direction.js';
import { frameInfo } from './assets.js';

const ONE_HAND = 1; // the pistol's pose (Weapon.ONE_HAND)

/**
 * A canvas of `width` x `height` with the character's feet at (x, y)
 * (CharacterBox: 48 x 59, feet at the "offset" marker 30, 46).
 * look: { headModel, headColor, bodyModel, bodyColor }.
 */
export function drawPortrait(textures, look, { width = 48, height = 59, x = 30, y = 46 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const anim = new Animator(); // idle
  const bodyFrame = anim.bodyFrame(SW, ONE_HAND);
  const head = MODELS[look.headModel] || MODELS[0];
  const body = MODELS[look.bodyModel] || MODELS[0];
  const draw = (name, index, { alpha = 1, tint = null } = {}) => {
    const frame = frameInfo(name, index);
    const source = frame && textures.get('sheet:' + frame.image)?.getSourceImage();
    if (!source) return;
    // Source rectangle on the loaded sheet (upscaled sheets are `scale` times larger).
    const k = frame.scale;
    let image = source;
    let [sx, sy, sw, sh] = [frame.x * k, frame.y * k, frame.w * k, frame.h * k];
    if (tint !== null) {
      // Multiply the layer by its colour, keeping its own transparency (Phaser's tint).
      image = document.createElement('canvas');
      image.width = sw;
      image.height = sh;
      const t = image.getContext('2d');
      t.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      t.globalCompositeOperation = 'multiply';
      t.fillStyle = '#' + tint.toString(16).padStart(6, '0');
      t.fillRect(0, 0, sw, sh);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
      [sx, sy] = [0, 0];
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, sx, sy, sw, sh, x + frame.dx, y + frame.dy, frame.w, frame.h);
    ctx.globalAlpha = 1;
  };
  draw('Character_Shadow', bodyFrame, { alpha: SHADOW_ALPHA });
  draw(body + 'BodyCustom', bodyFrame, { tint: tintFor(body + 'Body', look.bodyColor) });
  draw(body + 'Body', bodyFrame);
  draw('Pistol', anim.weaponFrame(SW));
  draw(head + 'HeadCustom', bodyFrame, { tint: tintFor(head + 'Head', look.headColor) });
  draw(head + 'Head', bodyFrame);
  return canvas;
}
