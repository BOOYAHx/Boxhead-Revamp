import { CELL_WIDTH as CW, CELL_HEIGHT as CH, WINDOW_WIDTH, WINDOW_HEIGHT } from '../game/constants.js';
import { WeaponID as ID } from '../game/weapons.js';
import { Preferences } from '../game/preferences.js';
import { frameCount, hasSprite, showFrame } from './assets.js';

/** Existing atlas art, with a small drawn fallback for older asset exports. */
export class EquipmentView {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.views = new Map();
    this.health = scene.add.graphics().setDepth(9900);
    this.scanner = scene.add.graphics().setScrollFactor(0).setDepth(9998);
    this.label = scene.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT - 16, '', { fontFamily: 'Verdana', fontSize: '11px', color: '#b5f5dc', backgroundColor: '#132626', padding: { x: 8, y: 4 } }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(10000);
  }

  entry(model) {
    let view = this.views.get(model);
    if (!view) {
      view = { sprite: this.scene.add.image(0, 0, '__DEFAULT').setOrigin(0), fallback: this.scene.add.graphics(), glow: this.scene.add.graphics(), shadow: null };
      this.scene.lighting?.add(view.sprite);
      this.views.set(model, view);
    }
    return view;
  }

  draw(model, name, frame, x, y, altitude, shadowName) {
    const view = this.entry(model);
    const depth = y / CH + altitude / CH;
    const art = hasSprite(name);
    view.sprite.setVisible(art).setDepth(depth);
    view.fallback.clear().setVisible(!art).setPosition(x, y - altitude).setDepth(depth);
    if (art) showFrame(view.sprite, name, frame % Math.max(1, frameCount(name)), x, y - altitude);
    else {
      const g = view.fallback;
      if (model.solid) {
        const barrel = model.kind === 0;
        g.fillStyle(barrel ? 0x9a3434 : 0x8a795a).fillRect(-13, -model.height, 26, model.height);
        g.lineStyle(2, 0x292d2f).strokeRect(-13, -model.height, 26, model.height);
        g.lineBetween(-12, -8, 12, -8);
      } else {
        g.fillStyle(model.weaponID === ID.PLASMA ? 0x7dedff : 0x555f42).fillCircle(0, -3, model.weaponID === ID.PLASMA ? 9 : 5);
        g.lineStyle(1, 0x172321).strokeCircle(0, -3, 5);
      }
    }
    if (shadowName && hasSprite(shadowName)) {
      if (!view.shadow) view.shadow = this.scene.shadows.create(shadowName);
      this.scene.shadows.show(view.shadow, shadowName, 0, x, y);
    }
    view.glow.clear().setDepth(depth + 0.01);
    if (model.weaponID === ID.PLASMA && Preferences.enhanced) {
      view.glow.fillStyle(0x41d8ff, 0.15).fillCircle(x, y - altitude, 18);
      view.glow.fillStyle(0xb3f5ff, 0.24).fillCircle(x, y - altitude, 10);
    }
    if ((model.kind === 3 && model.countdown !== null) || model.weaponID === ID.AIRSTRIKE) {
      const lit = Math.floor(model.age / 2) % 2 === 0;
      view.glow.fillStyle(lit ? 0xff5843 : 0x541d13).fillCircle(x, y - 5, 2);
      if (Preferences.enhanced && lit) view.glow.fillStyle(0xff5843, 0.13).fillEllipse(x, y, 32, 20);
    }
  }

  update(alpha, player, spy) {
    const live = new Set([...this.world.deployables.values(), ...this.world.projectiles.filter((p) => !p.dead)]);
    for (const [model, view] of this.views) if (!live.has(model)) {
      view.sprite.destroy(); view.fallback.destroy(); view.glow.destroy();
      if (view.shadow) this.scene.shadows.remove(view.shadow);
      this.views.delete(model);
    }
    this.health.clear();
    for (const d of this.world.deployables.values()) {
      const name = d.sprite + (d.variants ? 1 + d.index % d.variants : '');
      const x = d.pos.x * CW, y = d.pos.y * CH;
      this.draw(d, name, 0, x, y, 0, d.shadow);
      if (d.solid && d.hp < d.maxHp) {
        this.health.fillStyle(0x101719, 0.85).fillRect(x - 14, y - d.height - 8, 28, 4);
        this.health.fillStyle(d.ownerID === this.world.localID ? 0x6ed797 : 0xe68c68).fillRect(x - 13, y - d.height - 7, 26 * d.hp / d.maxHp, 2);
      }
    }
    for (const p of this.world.projectiles) {
      if (p.dead) continue;
      const x = (p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha) * CW;
      const y = (p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha) * CH;
      const altitude = p.prevAltitude + (p.altitude - p.prevAltitude) * alpha;
      const name = p.weaponID === ID.PLASMA ? 'PlasmaBall' : p.weaponID === ID.AIRSTRIKE ? 'AirstrikeBeacon' : p.weaponID === ID.GRENADE_LAUNCHER ? 'LaunchGrenade' : 'Grenade_Projectile' + (1 + Math.floor(p.age / 2) % 2);
      this.draw(p, name, Math.floor(p.age / 2), x, y, altitude, p.weaponID === ID.PLASMA ? 'PlasmaBall_Shadow' : p.weaponID === ID.AIRSTRIKE ? null : 'Grenade_Shadow');
    }
    this.scanner.clear();
    if (spy) {
      this.scanner.fillStyle(0x40c787, 0.08).fillRect(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT);
      this.scanner.lineStyle(1, 0x71e8a7, 0.14);
      for (let y = 0; y < WINDOW_HEIGHT; y += 12) this.scanner.lineBetween(0, y, WINDOW_WIDTH, y);
      this.scanner.strokeRect(16, 16, WINDOW_WIDTH - 32, WINDOW_HEIGHT - 32);
    }
    const w = player.weapon;
    const text = spy ? 'SATELLITE · Move to pan · Fire again to return' : w.placementPending ? 'Waiting for placement…' : w.id === ID.AIRSTRIKE ? 'Hold and release fire to mark an airstrike' : w.charge > 0 ? `POWER ${Math.round(Math.min(1, w.charge / (w.id === ID.GRENADE_LAUNCHER ? 25 : 15)) * 100)}% · Release fire` : w.chargePack ? 'C4 PLANTED · Press fire to detonate' : w.charged ? 'Hold fire for power · Release to fire' : w.kind === 'planter' ? this.world.canPlace(player) ? 'Fire to place in your current cell' : 'Move to an empty cell to place' : w.kind === 'gadget' ? 'Press fire to use the satellite' : '';
    this.label.setText(text).setVisible(!!text && player.active && !player.dead && !this.scene.ui?.shopOpen && !this.scene.ui?.menuOpen);
  }

  destroy() {
    for (const view of this.views.values()) {
      view.sprite.destroy(); view.fallback.destroy(); view.glow.destroy();
      if (view.shadow) this.scene.shadows.remove(view.shadow);
    }
    this.views.clear(); this.health.destroy(); this.scanner.destroy(); this.label.destroy();
  }
}
