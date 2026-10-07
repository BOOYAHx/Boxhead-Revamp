// The playing field.
//   offline: bundled map, local character only (graphics / movement check)
//   online:  a game room on the server; the map comes from the room info

import { CELL_HEIGHT, CELL_WIDTH, PROCESS_INTERVAL, ROUND_END_TIME, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { byVector } from '../game/Direction.js';
import { Character } from '../game/Character.js';
import { MODELS } from '../game/bodyParts.js';
import { FALLBACK_MAPS } from '../game/maps.js';
import { parseMap } from '../game/world.js';
import { ServerEvent } from '../net/Connection.js';
import { fetchMap } from '../net/MapService.js';
import { CharacterView } from '../render/CharacterView.js';
import { MapView } from '../render/MapView.js';

const HUD_DEPTH = 10001;
const TEXT_STYLE = { fontFamily: 'Verdana, sans-serif', fontSize: '11px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 6, y: 3 } };

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.mode = data.mode || 'offline';
    this.app = data.app;
    this.room = data.room;
    this.connection = this.mode === 'online' ? this.app.connection : null;
    this.map = null;
    this.roundTime = -1;
    this.unsubscribe = [];
  }

  create() {
    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT,M,C,T,H,ESC');
    this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
    this.debug = this.add.graphics().setDepth(9000);
    this.showHits = false;
    this.accumulator = 0;

    this.status = this.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.coords = this.add.text(WINDOW_WIDTH - 8, WINDOW_HEIGHT - 8, '', { ...TEXT_STYLE, fontFamily: 'monospace' }).setOrigin(1, 1).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.info = this.add.text(8, 8, '', TEXT_STYLE).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.timer = this.add.text(WINDOW_WIDTH / 2, 8, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    const help =
      this.mode === 'offline'
        ? 'Offline practice · Arrows/WASD move · Shift strafe · M model · C colour · H head · T hit boxes · Esc menu'
        : 'Arrows/WASD move · Shift strafe · T hit boxes · Esc back to lobby';
    this.add.text(8, WINDOW_HEIGHT - 8, help, TEXT_STYLE).setOrigin(0, 1).setScrollFactor(0).setDepth(HUD_DEPTH);

    this.events.once('shutdown', () => this.shutdown());
    window.boxhead = { scene: this };

    if (this.mode === 'online') this.startOnline();
    else this.loadMap(parseMap(FALLBACK_MAPS[0].data));
  }

  // --- online room -------------------------------------------------------------

  startOnline() {
    const c = this.connection;
    this.status.setText(`Joining ${this.room}…`);
    const on = (type, fn) => this.unsubscribe.push(c.on(type, fn));
    on(ServerEvent.ROOM_INFO, (info) => this.receiveRoomInfo(info));
    on(ServerEvent.ROUND_TIME, ({ seconds }) => this.setRoundTime(seconds));
    on(ServerEvent.HANDSHAKE, () => this.updateInfo());
    on(ServerEvent.PEER_JOINED, () => this.updateInfo());
    on(ServerEvent.PEER_DISCONNECTED, () => this.updateInfo());
    this.secondTimer = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.second() });
    c.requestRoomInfo(this.room);
    this.updateInfo();
  }

  async receiveRoomInfo(info) {
    this.setRoundTime(info.roundTime);
    if (this.map || this.loadingMap) return;
    this.loadingMap = true;
    const maps = this.app.maps;
    const entry = maps[info.mapID] || maps.find(Boolean);
    this.status.setText(`Loading ${entry?.name || 'map'}…`);
    let map;
    try {
      map = parseMap(await fetchMap(entry));
    } catch (error) {
      console.error('Could not load map', entry, error);
      this.status.setText('Could not load this map; using the bundled one.');
      map = parseMap(FALLBACK_MAPS[0].data);
    }
    if (!this.sys.isActive()) return;
    this.mapName = entry?.name || 'Warehouse';
    this.loadMap(map);
    this.connection.sendGameMessage('0k1'); // map loaded (BountyGame.loadMap)
    this.updateInfo();
  }

  setRoundTime(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.roundTime = seconds;
    this.timer.setVisible(true);
    this.drawTimer();
  }

  /** Game.second: local countdown, resynced with the server every 20 s. */
  second() {
    if (this.roundTime < 0) return;
    this.roundTime -= 1;
    if (this.roundTime % 20 === 0) this.connection.requestRoundTime();
    this.drawTimer();
  }

  drawTimer() {
    const left = Math.max(0, this.roundTime - ROUND_END_TIME);
    this.timer.setText(left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Round over');
  }

  updateInfo() {
    if (this.mode !== 'online') return;
    const c = this.connection;
    const names = [c.localUser?.name || 'You', ...c.peers.map((p) => p.name || '…')];
    this.info.setText([`${this.room}${this.mapName ? ' · ' + this.mapName : ''}`, `Players (${names.length}): ${names.join(', ')}`].join('\n'));
  }

  // --- map and local player ------------------------------------------------------

  loadMap(map) {
    this.map = map;
    this.mapView = new MapView(this, map);
    const user = this.connection?.localUser;
    this.player = new Character({ id: this.connection?.clientID, name: user?.name || 'You', local: true });
    if (user) Object.assign(this.player.look, { gender: user.gender, headModel: user.headModel, headColor: user.headColor, bodyModel: user.bodyModel, bodyColor: user.bodyColor });
    const spawn = map.spawns[Math.floor(Math.random() * map.spawns.length)] || { x: 5.5, y: 5.5 };
    this.player.respawn(spawn.x, spawn.y);
    this.playerView = new CharacterView(this, this.player);

    const camera = this.cameras.main;
    const { borderRect } = map;
    camera.setBounds(borderRect.x * CELL_WIDTH, borderRect.y * CELL_HEIGHT, borderRect.width * CELL_WIDTH, borderRect.height * CELL_HEIGHT);
    camera.setRoundPixels(true);
    this.status.setText('');
    window.boxhead = { scene: this, player: this.player, map };
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
      this.app.leaveGame();
      return;
    }
    if (!this.map) return;
    if (Phaser.Input.Keyboard.JustDown(this.keys.T)) this.showHits = !this.showHits;
    if (this.mode === 'offline') this.handleCustomizeKeys();
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= PROCESS_INTERVAL) {
      this.tick();
      this.accumulator -= PROCESS_INTERVAL;
    }
    this.player.animator.advance(delta);
    this.playerView.update(this.accumulator / PROCESS_INTERVAL);
    this.cameras.main.centerOn(this.playerView.container.x, this.playerView.container.y);
    this.drawDebug();
    const p = this.player.pos;
    this.coords.setText(`x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}`);
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

  shutdown() {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.secondTimer?.remove();
    this.mapView?.destroy();
    this.playerView?.destroy();
    this.map = null;
  }
}
