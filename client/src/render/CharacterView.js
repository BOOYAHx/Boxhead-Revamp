// Draws one Character the way PlayerCharacter.draw layered it: tinted body
// colour layer, body outline, held weapon, tinted head layer, head outline,
// with a soft shadow underneath.

import { CELL_HEIGHT, CELL_WIDTH, SHADOW_ALPHA } from '../game/constants.js';
import { MODELS, colorFor } from '../game/bodyParts.js';
import { createSprite, showFrame } from './assets.js';
import { DEPTH_CORPSES, DEPTH_SHADOWS } from './MapView.js';

const MIN_TONE = 8; // CharacterColorFinish keeps pure black slightly lit

function tone(color) {
  const r = Math.max(MIN_TONE, (color >> 16) & 255);
  const g = Math.max(MIN_TONE, (color >> 8) & 255);
  const b = Math.max(MIN_TONE, color & 255);
  return (r << 16) | (g << 8) | b;
}

export class CharacterView {
  constructor(scene, character, weaponSprite = 'Pistol', nameColor = '#ffffff') {
    this.scene = scene;
    this.character = character;
    this.weaponSprite = weaponSprite;
    this.shadow = createSprite(scene, 'Character_Shadow').setDepth(DEPTH_SHADOWS).setAlpha(SHADOW_ALPHA);
    this.container = scene.add.container(0, 0);
    this.bodyCustom = createSprite(scene, 'BondBodyCustom');
    this.body = createSprite(scene, 'BondBody');
    this.weapon = createSprite(scene, weaponSprite);
    this.headCustom = createSprite(scene, 'BondHeadCustom');
    this.head = createSprite(scene, 'BondHead');
    this.container.add([this.bodyCustom, this.body, this.weapon, this.headCustom, this.head]);
    this.nameText = scene.add
      .text(0, 0, character.name, { fontFamily: 'Verdana, sans-serif', fontSize: '10px', color: nameColor, stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    this.applyLook();
  }

  applyLook() {
    const { look } = this.character;
    const head = MODELS[look.headModel] || MODELS[0];
    const body = MODELS[look.bodyModel] || MODELS[0];
    this.parts = { body: body + 'Body', bodyCustom: body + 'BodyCustom', head: head + 'Head', headCustom: head + 'HeadCustom' };
    this.bodyCustom.setTint(tone(colorFor(body + 'Body', look.bodyColor)));
    this.headCustom.setTint(tone(colorFor(head + 'Head', look.headColor)));
  }

  /** alpha: 0..1 between the previous and current tick, for smooth motion. */
  update(alpha) {
    const ch = this.character;
    const visible = ch.active;
    this.container.setVisible(visible);
    this.shadow.setVisible(visible);
    this.nameText.setVisible(visible && !ch.dead);
    if (!visible) return;

    let cx = ch.prevPos.x + (ch.pos.x - ch.prevPos.x) * alpha;
    let cy = ch.prevPos.y + (ch.pos.y - ch.prevPos.y) * alpha;
    const smooth = ch.smoothingOffset(performance.now());
    if (smooth) {
      cx += smooth.x;
      cy += smooth.y;
    }
    ch.renderPos.x = cx;
    ch.renderPos.y = cy;
    const x = Math.round(cx * CELL_WIDTH);
    const y = Math.round(cy * CELL_HEIGHT);
    const anim = ch.animator;
    const bodyFrame = anim.bodyFrame(ch.dir, ch.pose);
    const { parts } = this;

    showFrame(this.shadow, 'Character_Shadow', bodyFrame, x, y);
    showFrame(this.bodyCustom, parts.bodyCustom, bodyFrame, 0, 0);
    showFrame(this.body, parts.body, bodyFrame, 0, 0);
    showFrame(this.headCustom, parts.headCustom, bodyFrame, 0, 0);
    showFrame(this.head, parts.head, bodyFrame, 0, 0);

    const order = [this.bodyCustom, this.body];
    if (ch.dead) {
      this.weapon.setVisible(false);
      // Corpses lying face up show the head under the body.
      if (ch.dir.dy > 0 && anim.finished) order.unshift(this.headCustom, this.head);
      else order.push(this.headCustom, this.head);
    } else {
      showFrame(this.weapon, this.weaponSprite, anim.weaponFrame(ch.dir), 0, 0);
      order.push(this.weapon, this.headCustom, this.head);
    }
    order.forEach((sprite, index) => this.container.moveTo(sprite, index));

    this.container.setPosition(x, y);
    this.container.setDepth(ch.dead && anim.finished ? DEPTH_CORPSES : y / CELL_HEIGHT);
    this.nameText.setPosition(x, y - 46).setDepth(10000);
  }

  destroy() {
    this.shadow.destroy();
    this.container.destroy();
    this.nameText.destroy();
  }
}
