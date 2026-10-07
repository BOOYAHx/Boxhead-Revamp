// The playing field.
//   offline: bundled map, local character only (graphics / movement check)
//   online:  a game room on the server; the map comes from the room info

import { CELL_HEIGHT, CELL_WIDTH, PING_CYCLE_INTERVAL, PING_INTERVAL, PROCESS_INTERVAL, ROUND_END_TIME, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { byVector } from '../game/Direction.js';
import { Character } from '../game/Character.js';
import { MODELS } from '../game/bodyParts.js';
import { FALLBACK_MAPS } from '../game/maps.js';
import { parseWeaponStats, setWeaponStats, weaponName } from '../game/weapons.js';
import { chooseSpawn, parseMap, traceShot } from '../game/world.js';
import { ServerEvent } from '../net/Connection.js';
import { fetchMap } from '../net/MapService.js';
import { cellPosToString, encodeFire, encodeHit, encodeMove, parseDeath, parseFire, parseMove, shouldSendMove, stringToCellPos } from '../net/protocol.js';
import { CharacterView } from '../render/CharacterView.js';
import { Effects } from '../render/Effects.js';
import { MapView } from '../render/MapView.js';

const HUD_DEPTH = 10001;
const KILL_MESSAGE_TIME = 8000; // ms a kill message stays in the feed
const KILL_MESSAGES = 5;
const PING_REQUEST = '?'; // Game.M_PING_REQUEST / M_PING_RESPONSE, sent as private chat
const PING_RESPONSE = '!';
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
    this.loadingMap = false; // Phaser reuses the scene object for every game
    this.mapName = null;
    this.roundTime = -1;
    this.unsubscribe = [];
    this.remotes = new Map(); // peer id -> { character, view }
    this.inbox = []; // player messages wait here until the map is loaded (Game.messageInQueue)
    this.lastSentMove = null;
    this.forcePositionUpdate = true;
    this.outQueue = []; // game messages sent after the next movement packet (Game.gameMessageOutQueue)
    this.killMessages = [];
    this.lastPingCycle = 0;
    this.pingIndex = 0;
  }

  create() {
    setWeaponStats(parseWeaponStats(this.cache.text.get('constants') || ''));
    this.keys = this.input.keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SHIFT,SPACE,J,M,C,T,H,ESC');
    this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE');
    this.debug = this.add.graphics().setDepth(9000);
    this.showHits = false;
    this.accumulator = 0;

    this.status = this.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.coords = this.add.text(WINDOW_WIDTH - 8, WINDOW_HEIGHT - 8, '', { ...TEXT_STYLE, fontFamily: 'monospace' }).setOrigin(1, 1).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.info = this.add.text(8, 8, '', TEXT_STYLE).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.timer = this.add.text(WINDOW_WIDTH / 2, 8, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    this.warning = this.add.text(WINDOW_WIDTH / 2, 120, '', { ...TEXT_STYLE, fontSize: '16px', color: '#ffdd55' }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    this.killFeed = this.add.text(WINDOW_WIDTH - 8, 8, '', { ...TEXT_STYLE, align: 'right' }).setOrigin(1, 0).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    this.effects = new Effects(this);
    const help =
      this.mode === 'offline'
        ? 'Offline practice · Arrows/WASD move · Space fire · Shift strafe · M model · C colour · H head · T hit boxes · Esc menu'
        : 'Arrows/WASD move · Space fire · Shift strafe · T hit boxes · Esc back to lobby';
    this.add.text(8, WINDOW_HEIGHT - 8, help, TEXT_STYLE).setOrigin(0, 1).setScrollFactor(0).setDepth(HUD_DEPTH);

    this.events.once('shutdown', () => this.shutdown());
    // Browsers stop drawing hidden or fully covered windows. Keep the network
    // side running so other players still see us (and we keep their state).
    this.onVisibility = () => this.visibilityChanged();
    document.addEventListener('visibilitychange', this.onVisibility);
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
      if (message === PING_REQUEST) c.sendPrivate(PING_RESPONSE, source);
      else if (message === PING_RESPONSE) this.remotes.get(source)?.pingReceived?.();
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
      remote = { id: user.id, character, view: null, ping: 0, pings: [], lastPing: 0, pingSentAt: 0 };
      remote.pingReceived = () => {
        // Player.pingReceived: average of the last three round trips.
        remote.pings.unshift(performance.now() - remote.pingSentAt);
        if (remote.pings.length > 3) remote.pings.pop();
        remote.ping = remote.pings.reduce((a, b) => a + b, 0) / remote.pings.length;
      };
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
    if (source === c.clientID) {
      // Our own health and position are decided locally; only the server's
      // death announcement matters (it also arrives when we died ourselves).
      if (message.charAt(0) === '7') this.characterKilled(this.player, parseDeath(message));
      return;
    }
    const user = c.peers.find((p) => p.id === source);
    const remote = this.remotes.get(source) || (user ? this.ensureRemote(user) : null);
    if (!remote) return;
    const ch = remote.character;
    switch (message.charAt(0)) {
      case '1':
        this.applyRemoteMove(ch, parseMove(message));
        break;
      case '4':
        if (ch.active && !ch.dead) this.remoteShot(remote, parseFire(message));
        break;
      case '6': {
        // Server-confirmed health after a hit.
        const hp = parseInt(message.substr(1), 10);
        if (hp > 0) {
          if (ch.hp > hp) this.effects.addBlood(ch, ch.hp - hp);
          this.healthChanged(ch, ch.hp, () => ch.setHealth(hp));
        }
        break;
      }
      case '7':
        this.characterKilled(ch, parseDeath(message));
        break;
      case '8':
        this.remoteRespawn(source, message.substr(1, 6));
        break;
      default:
        break;
    }
  }

  // --- combat ----------------------------------------------------------------------

  /** Weapon.fire for the local player: shoot, show it, and tell the room. */
  fireLocal() {
    const p = this.player;
    const shot = p.weapon.shoot(p, p.weapon.fireAngle(p));
    this.executeShot(p, shot);
    if (this.mode === 'online') {
      this.forcePositionUpdate = true; // peers replay the shot from our exact position
      this.outQueue.push(encodeFire(shot.angle, shot.param));
    }
  }

  /**
   * MatchPerformance.remoteShot: replay a peer's shot from where they last
   * said they were, against our position as it was `ping` ms ago.
   */
  remoteShot(remote, { angle, param }) {
    const shooter = remote.character;
    this.player.unlag(remote.ping);
    try {
      this.executeShot(shooter, shooter.weapon.shoot(shooter, angle, param));
    } finally {
      this.player.unlag(0);
    }
  }

  /**
   * Map.executeShot: trace the bullet until a wall stops it. Only our own
   * character can be hurt here; every client judges hits on itself.
   */
  executeShot(shooter, shot) {
    const victim = this.player;
    const targets = shooter !== victim && victim.active && !victim.dead ? [victim] : [];
    const result = traceShot(this.map, shot.start, shot.angle, shot.altitude, shot.range, targets, shooter);
    if (result.characters.length) this.localHurt(shooter, shooter.weapon);
    shooter.weapon.queueEffects(shot, result.distance);
  }

  /** Character.hurt + Game.characterHurt for the local player. */
  localHurt(shooter, weapon) {
    const p = this.player;
    const before = p.hp;
    let lost = 0;
    this.healthChanged(p, before, () => (lost = p.hurt(Math.min(p.hp, weapon.damage))));
    if (!lost) return;
    this.effects.addBlood(p, lost);
    this.cameras.main.shake(200, 0.006); // ScreenShake(pos, 1.5, 200)
    if (p.dead) this.localDeath(shooter, weapon.id);
    if (this.mode === 'online') this.outQueue.push(encodeHit(shooter.id, weapon.id, lost));
  }

  /** Game.characterDeath: kill message and the respawn countdown. */
  localDeath(killer, weaponID) {
    this.addKillMessage(killer, this.player, weaponID);
    this.forcePositionUpdate = true;
  }

  /** A death announced by the server: "M<victim>7<killer><weapon><crates>". */
  characterKilled(victim, { killerID, weaponID }) {
    if (!victim || victim.dead) return; // we already showed our own death
    if (!victim.local) this.effects.addBlood(victim, victim.hp);
    this.healthChanged(victim, victim.hp, () => victim.setHealth(0));
    const killer = killerID === this.connection?.clientID ? this.player : this.remotes.get(killerID)?.character;
    this.addKillMessage(killer, victim, weaponID);
  }

  /**
   * Run `change`, then play the hurt or death sound like
   * PlayerCharacter.setHealth / die (one hurt sound at a time per character).
   */
  healthChanged(ch, before, change) {
    change();
    const sounds = ch.look.gender === 'Female' ? 'Female' : ch.look.gender === 'Monster' ? 'Monster' : 'Male';
    const now = performance.now();
    if (ch.dead && before > 0) {
      this.effects.playSound('CorpseThud', ch.pos, 280);
      if (!(now < ch.hurtSoundUntil)) this.playHurtSound(ch, sounds + 'HurtD' + (1 + Math.floor(Math.random() * 3)));
    } else if (ch.hp < before && !(now < ch.hurtSoundUntil)) {
      const variant = 'ABC'.charAt(Math.floor(Math.random() * 3)) + (1 + Math.floor(Math.random() * 3));
      this.playHurtSound(ch, sounds + 'Hurt' + variant);
    }
  }

  playHurtSound(ch, name) {
    this.effects.playSound(name, ch.pos);
    const audio = this.cache.audio.get('snd:' + name);
    ch.hurtSoundUntil = performance.now() + (audio?.duration ? audio.duration * 1000 : 500);
  }

  /** Weapon.process: timers, then the queued muzzle flash, tracer and fire sound. */
  processWeapon(ch) {
    const weapon = ch.weapon;
    const { effects, reloaded } = weapon.process(true);
    if (effects) {
      this.effects.addTracer(weapon.tracerLine(effects));
      const sounds = weapon.fireSounds;
      this.effects.playSound(sounds[Math.floor(Math.random() * sounds.length)], weapon.muzzle);
    }
    if (reloaded && ch.local && !ch.dead) this.effects.playSound(weapon.reloadSound, weapon.muzzle, weapon.reloadSoundDelay);
  }

  /** Game.respawnLocalCharacter: back at the safest spawn point after the countdown. */
  respawnLocal() {
    const spawn = this.pickSpawn();
    this.player.respawn(spawn.x, spawn.y);
    this.warning.setVisible(false);
    this.effects.playSound('CharacterRespawn', this.player.pos);
    if (this.mode === 'online') {
      this.outQueue.push('8' + cellPosToString(this.player.pos));
      this.forcePositionUpdate = true;
    }
  }

  pickSpawn() {
    const enemies = [...this.remotes.values()].map((r) => r.character).filter((ch) => ch.active && !ch.dead);
    return chooseSpawn(this.map.spawns, enemies) || this.map.spawns[0] || { x: 5.5, y: 5.5 };
  }

  /** KillMessage: "X killed Y", "You" for the local player. */
  addKillMessage(killer, victim, weaponID) {
    const name = (ch) => (!ch ? 'Someone' : ch.local ? 'You' : ch.name || 'Someone');
    const text = !killer || killer === victim ? `${name(victim)} killed ${victim.local ? 'yourself' : 'themself'}` : `${name(killer)} killed ${name(victim)}`;
    this.killMessages.push({ text: `${text} (${weaponName(weaponID)})`, until: performance.now() + KILL_MESSAGE_TIME });
    while (this.killMessages.length > KILL_MESSAGES) this.killMessages.shift();
    this.drawKillFeed();
  }

  drawKillFeed() {
    const now = performance.now();
    this.killMessages = this.killMessages.filter((m) => m.until > now);
    this.killFeed.setVisible(this.killMessages.length > 0);
    this.killFeed.setText(this.killMessages.map((m) => m.text).join('\n'));
  }

  /** Game.processRemotePlayers: ping one peer per second, each at most every 10 s. */
  pingPeers() {
    const now = performance.now();
    if (now < this.lastPingCycle + PING_CYCLE_INTERVAL) return;
    const remotes = [...this.remotes.values()];
    if (!remotes.length) return;
    const remote = remotes[this.pingIndex % remotes.length];
    if (now - remote.lastPing > PING_INTERVAL || !remote.lastPing) {
      this.lastPingCycle = now;
      remote.lastPing = now;
      remote.pingSentAt = now;
      this.connection.sendPrivate(PING_REQUEST, remote.id);
      this.pingIndex = (this.pingIndex + 1) % remotes.length;
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
    remote.character.firePos.x = remote.character.pos.x;
    remote.character.firePos.y = remote.character.pos.y;
    remote.character.strafing = true;
    this.updateInfo();
  }

  /**
   * Game.sendUpdate: tell peers about our movement when it changes, then send
   * the queued game messages (shots, hits, respawns) right after it.
   */
  sendUpdate() {
    const packet = encodeMove(this.player);
    if (shouldSendMove(packet, this.lastSentMove, this.forcePositionUpdate)) {
      this.connection.sendGameMessage(packet.text);
      this.lastSentMove = packet;
    }
    while (this.outQueue.length) this.connection.sendGameMessage(this.outQueue.shift());
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
    const peerName = (p) => (p.name || '…') + (this.map && !this.remotes.get(p.id)?.character.active ? ' (not seen yet)' : '');
    const names = [c.localUser?.name || 'You', ...c.peers.map(peerName)];
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
    const spawn = this.pickSpawn();
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
    this.effects.focus = this.player.renderPos;
    this.effects.update();
    if (this.killMessages.length) this.drawKillFeed();
    if (this.player.dead) this.warning.setText(`You will respawn in: ${Math.max(0, Math.ceil(this.player.respawnTime / 1000))}`).setVisible(true);
    this.drawDebug();
    const p = this.player.pos;
    this.coords.setText(`x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}`);
  }

  /**
   * One 50 ms game tick: messages, input (LocalPlayer.processInput), firing
   * and the respawn countdown (LocalCharacter.process), movement, weapons.
   */
  tick() {
    const k = this.keys;
    const p = this.player;
    while (this.inbox.length) this.handlePlayerMessage(this.inbox.shift());
    if (!p.dead) {
      const h = (k.RIGHT.isDown || k.D.isDown ? 1 : 0) - (k.LEFT.isDown || k.A.isDown ? 1 : 0);
      const v = (k.DOWN.isDown || k.S.isDown ? 1 : 0) - (k.UP.isDown || k.W.isDown ? 1 : 0);
      p.moveDir = byVector(h, v);
      p.strafing = k.SHIFT.isDown;
      p.firing = k.SPACE.isDown || k.J.isDown;
    }
    p.move(this.map);
    if (p.processTimers()) this.respawnLocal();
    else if (p.active && !p.dead && p.firing && p.weapon.isLoaded) this.fireLocal();
    this.processWeapon(p);
    for (const { character } of this.remotes.values()) {
      if (character.active) character.move(this.map);
      character.processTimers();
      this.processWeapon(character);
    }
    if (this.mode === 'online') {
      if (p.active) this.sendUpdate();
      this.pingPeers();
    }
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

  visibilityChanged() {
    clearInterval(this.backgroundTimer);
    this.backgroundTimer = null;
    if (document.hidden && this.mode === 'online') {
      this.input.keyboard.resetKeys(); // keys released while hidden would otherwise stay down
      this.backgroundTimer = setInterval(() => {
        if (this.map) this.tick();
      }, PROCESS_INTERVAL);
    }
  }

  shutdown() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearInterval(this.backgroundTimer);
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.secondTimer?.remove();
    this.mapView?.destroy();
    this.playerView?.destroy();
    for (const { view } of this.remotes.values()) view?.destroy();
    this.remotes.clear();
    this.effects?.destroy();
    this.map = null;
  }
}
