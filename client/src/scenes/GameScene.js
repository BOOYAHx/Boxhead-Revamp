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
import { cellPosToString, encodeMove, parseMove, shouldSendMove, stringToCellPos } from '../net/protocol.js';
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
    this.remotes = new Map(); // peer id -> { character, view }
    this.inbox = []; // player messages wait here until the map is loaded (Game.messageInQueue)
    this.lastSentMove = null;
    this.forcePositionUpdate = true;
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
    on(ServerEvent.HANDSHAKE, ({ user }) => this.peerHandshake(user));
    on(ServerEvent.PEER_JOINED, () => this.updateInfo());
    on(ServerEvent.PEER_DISCONNECTED, ({ id }) => this.removeRemote(id));
    on(ServerEvent.PLAYER_MESSAGE, (message) => this.inbox.push(message));
    on(ServerEvent.MESSAGE, ({ source, message }) => {
      // Peers measure their ping to us with "?" and expect "!" back (Game.receiveMessage).
      if (message === '?') c.sendPrivate('!', source);
    });
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
    for (const user of this.connection.peers) if (user.handshake) this.ensureRemote(user);
    this.connection.sendGameMessage('8' + cellPosToString(this.player.pos)); // spawned (Game.respawnLocalCharacter)
    this.forcePositionUpdate = true;
    this.updateInfo();
  }

  // --- other players ----------------------------------------------------------------

  peerHandshake(user) {
    if (this.map) this.ensureRemote(user);
    this.forcePositionUpdate = true; // let the newcomer see where we are
    this.updateInfo();
  }

  ensureRemote(user) {
    let remote = this.remotes.get(user.id);
    if (!remote) {
      const character = new Character({ id: user.id, name: user.name });
      character.firePos = { x: 0, y: 0 };
      character.strafing = true;
      remote = { character, view: null };
      this.remotes.set(user.id, remote);
    }
    const ch = remote.character;
    ch.name = user.name;
    Object.assign(ch.look, { gender: user.gender, headModel: user.headModel, headColor: user.headColor, bodyModel: user.bodyModel, bodyColor: user.bodyColor });
    if (user.handshake && !ch.active) ch.hp = user.handshake.hp;
    if (this.map) {
      remote.view?.destroy();
      remote.view = new CharacterView(this, ch, 'Pistol', '#ffe08a');
    }
    return remote;
  }

  removeRemote(id) {
    const remote = this.remotes.get(id);
    if (remote) {
      remote.view?.destroy();
      this.remotes.delete(id);
    }
    this.updateInfo();
  }

  /** Game.processPlayerMessage for the messages handled so far. */
  handlePlayerMessage({ source, message, raw }) {
    const c = this.connection;
    // The server relays respawns as "8<id><cell>" without the usual "M" wrapper.
    if (raw && raw.charAt(0) === '8') {
      if (source !== c.clientID) this.remoteRespawn(source, raw.substr(4, 6));
      return;
    }
    if (source === c.clientID) return; // our own state is decided locally
    const user = c.peers.find((p) => p.id === source);
    const remote = this.remotes.get(source) || (user ? this.ensureRemote(user) : null);
    if (!remote) return;
    const ch = remote.character;
    switch (message.charAt(0)) {
      case '1':
        this.applyRemoteMove(ch, parseMove(message));
        break;
      case '6': {
        const hp = parseInt(message.substr(1), 10);
        if (hp > 0) ch.setHealth(hp);
        break;
      }
      case '8':
        this.remoteRespawn(source, message.substr(1, 6));
        break;
      default:
        break;
    }
  }

  applyRemoteMove(ch, move) {
    const wasActive = ch.active;
    ch.moving = !!move.moveDir;
    ch.strafing = true;
    // Snap to the reported position when the walk changes or the peer is
    // blocked; otherwise keep extrapolating, exactly like the Flash client.
    if (move.blocked || !move.moveDir || ch.moveDir !== move.moveDir || !wasActive) {
      ch.pos.x = move.pos.x;
      ch.pos.y = move.pos.y;
      ch.prevPos.x = move.pos.x;
      ch.prevPos.y = move.pos.y;
      if (wasActive) ch.applySmoothing(performance.now());
    }
    ch.moveDir = move.moveDir;
    ch.dir = move.dir;
    ch.firePos.x = move.pos.x;
    ch.firePos.y = move.pos.y;
    if (!wasActive) {
      ch.active = true;
      this.updateInfo();
    }
  }

  remoteRespawn(id, cellText) {
    const remote = this.remotes.get(id);
    if (!remote) return;
    const cell = stringToCellPos(cellText);
    remote.character.respawn(cell.x + 0.5, cell.y + 0.5);
    remote.character.strafing = true;
  }

  /** Game.sendUpdate: tell peers about our movement when it changes. */
  sendUpdate() {
    const packet = encodeMove(this.player);
    if (!shouldSendMove(packet, this.lastSentMove, this.forcePositionUpdate)) return;
    this.connection.sendGameMessage(packet.text);
    this.lastSentMove = packet;
    this.forcePositionUpdate = false;
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
    window.boxhead && (window.boxhead.remotes = this.remotes);
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
    const alpha = this.accumulator / PROCESS_INTERVAL;
    this.playerView.update(alpha);
    for (const { character, view } of this.remotes.values()) {
      character.animator.advance(delta);
      view?.update(alpha);
    }
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
    while (this.inbox.length) this.handlePlayerMessage(this.inbox.shift());
    this.player.moveDir = byVector(h, v);
    this.player.strafing = k.SHIFT.isDown;
    this.player.move(this.map);
    for (const { character } of this.remotes.values()) if (character.active) character.move(this.map);
    if (this.mode === 'online' && this.player.active) this.sendUpdate();
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
    for (const { view } of this.remotes.values()) view?.destroy();
    this.remotes.clear();
    this.map = null;
  }
}
