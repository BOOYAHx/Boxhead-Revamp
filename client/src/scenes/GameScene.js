// The playing field. Step 1: offline test on a bundled map with the local
// character only, to check graphics, movement and collisions.

import { CELL_HEIGHT, CELL_WIDTH, PROCESS_INTERVAL, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { byVector } from '../game/Direction.js';
import { Character } from '../game/Character.js';
import { MODELS } from '../game/bodyParts.js';
import { FALLBACK_MAPS } from '../game/maps.js';
import { parseMap } from '../game/world.js';
import { CharacterView } from '../render/CharacterView.js';
import { MapView } from '../render/MapView.js';

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create() {
    this.map = parseMap(FALLBACK_MAPS[0].data);
    this.mapView = new MapView(this, this.map);

    this.player = new Character({ name: 'You', local: true });
    const spawn = this.map.spawns[Math.floor(Math.random() * this.map.spawns.length)] || { x: 5.5, y: 5.5 };
    this.player.respawn(spawn.x, spawn.y);
    this.playerView = new CharacterView(this, this.player);

    const camera = this.cameras.main;
    const { borderRect } = this.map;
    camera.setBounds(borderRect.x * CELL_WIDTH, borderRect.y * CELL_HEIGHT, borderRect.width * CELL_WIDTH, borderRect.height * CELL_HEIGHT);
    camera.setRoundPixels(true);

    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT,M,C,T,H');
    this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
    this.debug = this.add.graphics().setDepth(9000);
    this.showHits = false;

    this.add
      .text(8, WINDOW_HEIGHT - 8, 'Offline test · Arrows/WASD move · Shift strafe · M model · C colour · H head · T hit boxes', {
        fontFamily: 'Verdana, sans-serif',
        fontSize: '11px',
        color: '#ffffff',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(10001);
    this.status = this.add
      .text(WINDOW_WIDTH - 8, 8, '', { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 6, y: 3 } })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(10001);

    this.accumulator = 0;
    // Expose state for automated browser tests.
    window.boxhead = { scene: this, player: this.player, map: this.map };
  }

  update(time, delta) {
    this.handleCustomizeKeys();
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= PROCESS_INTERVAL) {
      this.tick();
      this.accumulator -= PROCESS_INTERVAL;
    }
    this.player.animator.advance(delta);
    const alpha = this.accumulator / PROCESS_INTERVAL;
    this.playerView.update(alpha);
    this.cameras.main.centerOn(this.playerView.container.x, this.playerView.container.y);
    this.drawDebug();
    const p = this.player.pos;
    this.status.setText(`x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}  dir ${this.player.dir.index}${this.player.collided ? '  blocked' : ''}`);
  }

  /** One 50 ms game tick: read input (LocalPlayer.processInput) and move. */
  tick() {
    const k = this.keys;
    const h = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
    const v = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
    this.player.moveDir = byVector(h, v);
    this.player.strafing = k.SHIFT.isDown;
    this.player.move(this.map);
  }

  handleCustomizeKeys() {
    const { keys, player } = this;
    const look = player.look;
    if (Phaser.Input.Keyboard.JustDown(keys.M)) {
      look.bodyModel = (look.bodyModel + 1) % MODELS.length;
      look.headModel = look.bodyModel;
      look.bodyColor = 0;
      look.headColor = 0;
      this.playerView.applyLook();
    }
    if (Phaser.Input.Keyboard.JustDown(keys.C)) {
      look.bodyColor = (look.bodyColor + 1) % 34;
      this.playerView.applyLook();
    }
    if (Phaser.Input.Keyboard.JustDown(keys.H)) {
      look.headColor = (look.headColor + 1) % 34;
      this.playerView.applyLook();
    }
    if (Phaser.Input.Keyboard.JustDown(keys.T)) this.showHits = !this.showHits;
  }

  drawDebug() {
    const g = this.debug;
    g.clear();
    if (!this.showHits) return;
    const shapes = [];
    for (const prop of this.map.props) for (let s = prop.hit; s; s = s.next) shapes.push([s, 0x3399ff]);
    for (const s of this.map.borderHits) shapes.push([s, 0xff00ff]);
    shapes.push([this.player.moveHit, 0x00ff00], [this.player.fireHit, 0xffff00]);
    for (const [s, color] of shapes) {
      g.lineStyle(1, color, 0.9);
      if (s.radius !== undefined) g.strokeEllipse(s.x * CELL_WIDTH, s.y * CELL_HEIGHT, s.radius * 2 * CELL_WIDTH, s.radius * 2 * CELL_HEIGHT);
      else g.strokeRect((s.x - s.xRad) * CELL_WIDTH, (s.y - s.yRad) * CELL_HEIGHT, s.xRad * 2 * CELL_WIDTH, s.yRad * 2 * CELL_HEIGHT);
    }
  }
}
