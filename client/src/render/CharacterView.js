// Draws one Character the way PlayerCharacter.draw layered it: tinted body
// colour layer, body outline, held weapon, tinted head layer, head outline,
// with a soft shadow underneath, the muzzle flash while firing and the
// health bar overhead (PlayerCharacter.drawOverhead).

import { CELL_HEIGHT, CELL_WIDTH, SHADOW_ALPHA } from '../game/constants.js';
import { MODELS, colorFor } from '../game/bodyParts.js';
import { createSprite, showFrame } from './assets.js';
import { DEPTH_CORPSES, DEPTH_SHADOWS } from './MapView.js';

const MIN_TONE = 8; // CharacterColorFinish keeps pure black slightly lit
const FLASH_TINT = 0xff5040; // stands in for PlayerCharacter.FLASH_CT (red damage flash)
const HEALTH_GREEN = 0x00ff00; // HealthBar: white bar tinted by health
const HEALTH_ORANGE = 0xcc6600;
const HEALTH_RED = 0xcc0000;
const OVERHEAD_Y = 55; // health bar this many pixels above the feet

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
    this.flash = createSprite(scene, character.weapon.muzzleFlash).setVisible(false);
    this.container.add([this.bodyCustom, this.body, this.weapon, this.headCustom, this.head, this.flash]);
    this.healthBorder = scene.add.image(0, 0, 'img:HealthBar_BarBorder').setOrigin(0, 0).setDepth(10000);
    this.healthBar = scene.add.image(0, 0, 'img:HealthBar_Bar').setOrigin(0, 0).setDepth(10000);
    this.shownHealth = -1;
    this.flashing = false;
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
    this.bodyTint = tone(colorFor(body + 'Body', look.bodyColor));
    this.bodyCustom.setTint(this.bodyTint);
    this.headCustom.setTint(tone(colorFor(head + 'Head', look.headColor)));
    this.flashing = false;
  }

  /** PlayerCharacter.drawBody: the body flashes red for a moment after a hit. */
  updateDamageFlash() {
    const flashing = this.character.flashTime > 0;
    if (flashing === this.flashing) return;
    this.flashing = flashing;
    if (flashing) {
      this.body.setTint(FLASH_TINT);
      this.bodyCustom.setTint(FLASH_TINT);
    } else {
      this.body.clearTint();
      this.bodyCustom.setTint(this.bodyTint);
    }
  }

  /** HealthBar.redraw: green from half health, orange from a quarter, red below. */
  updateHealthBar(x, y) {
    const ch = this.character;
    const visible = ch.active && !ch.dead;
    this.healthBorder.setVisible(visible);
    this.healthBar.setVisible(visible);
    if (!visible) return;
    const health = Math.max(0, Math.min(1, ch.hp / ch.maxHp));
    if (health !== this.shownHealth) {
      this.shownHealth = health;
      this.healthBar.setCrop(0, 0, Math.round(this.healthBar.width * health), this.healthBar.height);
      this.healthBar.setTint(health >= 0.5 ? HEALTH_GREEN : health >= 0.25 ? HEALTH_ORANGE : HEALTH_RED);
    }
    this.healthBorder.setPosition(x - 17, y - OVERHEAD_Y - 4);
    this.healthBar.setPosition(x - 16, y - OVERHEAD_Y - 3);
  }

  /** alpha: 0..1 between the previous and current tick, for smooth motion. */
  update(alpha) {
    const ch = this.character;
    const visible = ch.active;
    this.container.setVisible(visible);
    this.shadow.setVisible(visible);
    this.nameText.setVisible(visible && !ch.dead);
    if (!visible) {
      this.updateHealthBar(0, 0);
      return;
    }

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

    this.updateDamageFlash();
    const order = [this.bodyCustom, this.body];
    const weapon = ch.weapon;
    if (ch.dead) {
      this.weapon.setVisible(false);
      this.flash.setVisible(false);
      // Corpses lying face up show the head under the body.
      if (ch.dir.dy > 0 && anim.finished) order.unshift(this.headCustom, this.head);
      else order.push(this.headCustom, this.head);
    } else {
      const weaponFrame = anim.weaponFrame(ch.dir);
      showFrame(this.weapon, this.weaponSprite, weaponFrame, 0, 0);
      // The muzzle flash goes behind the gun when facing away from the camera.
      const behind = ch.dir.dy < 0;
      if (weapon.flashVisible) {
        const [mx, my] = weapon.muzzleOffset(weaponFrame);
        showFrame(this.flash, weapon.muzzleFlash, ch.dir.index, mx, my);
      } else {
        this.flash.setVisible(false);
      }
      if (behind) order.push(this.flash, this.weapon, this.headCustom, this.head);
      else order.push(this.weapon, this.headCustom, this.head, this.flash);
    }
    order.forEach((sprite, index) => this.container.moveTo(sprite, index));

    this.container.setPosition(x, y);
    this.container.setDepth(ch.dead && anim.finished ? DEPTH_CORPSES : y / CELL_HEIGHT);
    this.nameText.setPosition(x, y - OVERHEAD_Y - 5).setDepth(10000);
    this.updateHealthBar(x, y);
  }

  destroy() {
    this.shadow.destroy();
    this.container.destroy();
    this.nameText.destroy();
    this.healthBorder.destroy();
    this.healthBar.destroy();
  }
}
