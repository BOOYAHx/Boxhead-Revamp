// Draws one Character the way PlayerCharacter.draw layered it: tinted body
// colour layer, body outline, held weapon, tinted head layer, head outline,
// with a soft shadow underneath, the muzzle flash while firing, the Flamer's
// backpack and the health bar overhead (PlayerCharacter.drawOverhead).

import { CELL_HEIGHT, CELL_WIDTH } from '../game/constants.js';
import { MODELS, tintFor } from '../game/bodyParts.js';
import { createSprite, hdImageScale, showFrame } from './assets.js';
import { DEPTH_CORPSES, DEPTH_SHADOWS } from './MapView.js';
import { Preferences } from '../game/preferences.js';
import { snap } from './display.js';

const HEALTH_GREEN = 0x00ff00; // HealthBar: white bar tinted by health
const HEALTH_ORANGE = 0xcc6600;
const HEALTH_RED = 0xcc0000;
const OVERHEAD_Y = 55; // health bar this many pixels above the feet
// The leader's marker: the original's bullseye (from the UI art) behind "1st".
export const LEADER_ICON = 'ui:leader';
export const LEADER_ICON_URL = 'assets/game/ui/bitmaps/54.png';
const LEADER_ICON_SIZE = 18;
const LEADER_NAME_LIFT = 7; // the leader's name moves up to make room for the bullseye
const CONTACT_ALPHA = 0.5; // enhanced: the soft dark patch right under the feet

export class CharacterView {
  constructor(scene, character, nameColor = '#ffffff') {
    this.scene = scene;
    this.character = character;
    this.shadow = scene.shadows.create('Character_Shadow');
    this.container = scene.add.container(0, 0);
    this.bodyCustom = createSprite(scene, 'BondBodyCustom');
    this.body = createSprite(scene, 'BondBody');
    this.weapon = createSprite(scene, 'Pistol');
    this.backpack = createSprite(scene, 'Pistol').setVisible(false);
    this.headCustom = createSprite(scene, 'BondHeadCustom');
    this.head = createSprite(scene, 'BondHead');
    this.flash = createSprite(scene, 'MuzzleFlashSmall1').setVisible(false);
    this.container.add([this.backpack, this.bodyCustom, this.body, this.weapon, this.headCustom, this.head, this.flash]);
    // Lit by muzzle flashes and explosions (enhanced); the muzzle flash is the light itself.
    for (const part of [this.backpack, this.bodyCustom, this.body, this.weapon, this.headCustom, this.head]) scene.lighting?.add(part);
    this.contact = scene.lighting?.contactShadow(DEPTH_SHADOWS + 0.1, 30, 13, CONTACT_ALPHA);
    this.healthBorder = scene.add.image(0, 0, 'img:HealthBar_BarBorder').setOrigin(0, 0).setDepth(10000).setScale(1 / hdImageScale('HealthBar_BarBorder'));
    this.healthBar = scene.add.image(0, 0, 'img:HealthBar_Bar').setOrigin(0, 0).setDepth(10000).setScale(1 / hdImageScale('HealthBar_Bar'));
    this.shownHealth = -1;
    this.nameText = scene.add
      .text(0, 0, character.name, { fontFamily: 'Verdana, sans-serif', fontSize: '10px', color: nameColor, stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    // PlayerCharacter.updateOverheads: other players show name and placing; we show neither.
    this.placingText = scene.add
      .text(0, 0, '', { fontFamily: 'Verdana, sans-serif', fontSize: '10px', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 1);
    this.first = false;
    this.leaderIcon = scene.textures.exists(LEADER_ICON) ? scene.add.image(0, 0, LEADER_ICON).setDisplaySize(LEADER_ICON_SIZE, LEADER_ICON_SIZE).setVisible(false) : null;
    this.applyLook();
  }

  applyLook() {
    const { look } = this.character;
    const head = MODELS[look.headModel] || MODELS[0];
    const body = MODELS[look.bodyModel] || MODELS[0];
    this.parts = { body: body + 'Body', bodyCustom: body + 'BodyCustom', head: head + 'Head', headCustom: head + 'HeadCustom' };
    this.bodyTint = tintFor(body + 'Body', look.bodyColor);
    this.bodyCustom.setTint(this.bodyTint);
    this.headCustom.setTint(tintFor(head + 'Head', look.headColor));
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
    this.scene.shadows.setVisible(this.shadow, visible);
    this.contact?.setVisible(visible && Preferences.enhanced && Preferences.shadows);
    const overhead = visible && !ch.dead && !ch.local;
    this.nameText.setVisible(overhead);
    this.placingText.setVisible(overhead);
    this.leaderIcon?.setVisible(overhead && this.first);
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
    const x = snap(cx * CELL_WIDTH);
    const y = snap(cy * CELL_HEIGHT);
    const anim = ch.animator;
    const bodyFrame = anim.bodyFrame(ch.dir, ch.pose);
    const { parts } = this;

    this.scene.shadows.show(this.shadow, 'Character_Shadow', bodyFrame, x, y);
    showFrame(this.bodyCustom, parts.bodyCustom, bodyFrame, 0, 0);
    showFrame(this.body, parts.body, bodyFrame, 0, 0);
    showFrame(this.headCustom, parts.headCustom, bodyFrame, 0, 0);
    showFrame(this.head, parts.head, bodyFrame, 0, 0);

    const order = [this.bodyCustom, this.body];
    const weapon = ch.weapon;
    if (ch.dead) {
      this.weapon.setVisible(false);
      this.backpack.setVisible(false);
      this.flash.setVisible(false);
      // Corpses lying face up show the head under the body.
      if (ch.dir.dy > 0 && anim.finished) order.unshift(this.headCustom, this.head);
      else order.push(this.headCustom, this.head);
    } else {
      const weaponFrame = anim.weaponFrame(ch.dir);
      showFrame(this.weapon, weapon.display, weaponFrame, 0, 0);
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
      // The Flamer's tank is drawn first when facing south-west to east, otherwise last.
      if (weapon.backpack) {
        showFrame(this.backpack, weapon.backpack, weaponFrame, 0, 0);
        if (ch.dir.index <= 1 || ch.dir.index >= 6) order.unshift(this.backpack);
        else order.push(this.backpack);
      } else {
        this.backpack.setVisible(false);
      }
    }
    order.forEach((sprite, index) => this.container.moveTo(sprite, index));
    if (!order.includes(this.backpack)) this.container.moveTo(this.backpack, order.length);

    this.container.setPosition(x, y);
    this.contact?.setPosition(x, y);
    this.container.setDepth(ch.dead && anim.finished ? DEPTH_CORPSES : y / CELL_HEIGHT);
    this.placingText.setPosition(x, y - OVERHEAD_Y - 5).setDepth(10000);
    // "1st" over the lower half of the bullseye, like the original.
    this.leaderIcon?.setPosition(x, y - OVERHEAD_Y - 15).setDepth(9999);
    this.nameText.setPosition(x, y - OVERHEAD_Y - 17 - (this.first && this.leaderIcon ? LEADER_NAME_LIFT : 0)).setDepth(10000);
    this.updateHealthBar(x, y);
  }

  /** The placing over the head ("1st", "2nd"...); first place also gets the bullseye behind it. */
  setPlacing(text, first = false) {
    this.placingText.setText(text);
    this.first = first;
  }

  destroy() {
    this.placingText.destroy();
    this.leaderIcon?.destroy();
    this.scene.shadows.remove(this.shadow);
    this.container.destroy();
    this.contact?.destroy();
    this.nameText.destroy();
    this.healthBorder.destroy();
    this.healthBar.destroy();
  }
}
