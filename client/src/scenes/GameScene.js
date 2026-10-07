// The playing field.
//   offline: bundled map, local character only (graphics / movement check)
//   online:  a game room on the server; the map comes from the room info

import { CELL_HEIGHT, CELL_WIDTH, PING_CYCLE_INTERVAL, PING_INTERVAL, PROCESS_INTERVAL, ROUND_END_TIME, ROUND_START_TIME, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { DIRECTIONS, byVector } from '../game/Direction.js';
import { KeyState, isKey } from '../game/controls.js';
import { Character } from '../game/Character.js';
import { MODELS } from '../game/bodyParts.js';
import { BountyCrate, CHAT_DELIM, CHAT_PREFIX, chatLines, cleanChat, newStats, parseCrates, placingString, rankPlayers, roundAwards } from '../game/bounty.js';
import { FALLBACK_MAPS } from '../game/maps.js';
import { Preferences } from '../game/preferences.js';
import { ShopState } from '../game/shop.js';
import { PISTOL_ID, parseWeaponStats, setWeaponStats } from '../game/weapons.js';
import { GameUi } from '../ui/gameUi.js';
import { chooseSpawn, parseMap, traceShot } from '../game/world.js';
import { ServerEvent } from '../net/Connection.js';
import { fetchMap } from '../net/MapService.js';
import { cellPosToString, encodeFire, encodeHit, encodeMove, parseDeath, parseFire, parseMove, shouldSendMove, stringToCellPos } from '../net/protocol.js';
import { padInt } from '../util/strings.js';
import { CharacterView } from '../render/CharacterView.js';
import { Effects } from '../render/Effects.js';
import { Hud } from '../render/Hud.js';
import { createSprite, showFrame } from '../render/assets.js';
import { MapView } from '../render/MapView.js';
import { ShadowLayer } from '../render/ShadowLayer.js';
import { Display, fitCamera, snap } from '../render/display.js';

const HUD_DEPTH = 10001;
const PING_REQUEST = '?'; // Game.M_PING_REQUEST / M_PING_RESPONSE, sent as private chat
const PING_RESPONSE = '!';
const MAX_FLOOD = 3; // chat messages per FLOOD_TIME before further ones are dropped
const FLOOD_TIME = 2000;
const MAX_CHAT_LENGTH = 120;
const LEADER_COLOR = 0xffffff;
const AUTO_SHOP_DELAY = 3000; // ShopGame.AUTO_SHOP_DELAY
const OFFLINE_MONEY = 1000000; // practice: enough to try everything
const TEXT_STYLE = { fontFamily: 'Verdana, sans-serif', fontSize: '11px', color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.55)', padding: { x: 6, y: 3 } };

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  init(data) {
    this.mode = data.mode || 'offline';
    this.app = data.app;
    this.room = data.room;
    this.newRound = !!data.newRound; // stats in old handshakes belong to the previous round
    this.connection = this.mode === 'online' ? this.app.connection : null;
    this.map = null;
    this.loadingMap = false; // Phaser reuses the scene object for every game
    this.mapName = null;
    this.roundTime = -1;
    this.gameOver = false;
    this.participated = false;
    this.unsubscribe = [];
    this.remotes = new Map(); // peer id -> { id, character, view, ping, ... }
    // Player messages wait here until the map is loaded (Game.messageInQueue).
    // It carries over to the next round: peers that start it sooner announce
    // their spawn while we are still on the summary.
    this.inbox = data.inbox || [];
    this.lastSentMove = null;
    this.forcePositionUpdate = true;
    this.outQueue = []; // game messages sent after the next movement packet (Game.gameMessageOutQueue)
    this.chatOutQueue = []; // chat bundle entries (Game.messageOutQueue)
    this.chatInput = null; // text being typed, or null when the chat line is closed
    this.floodCount = 0;
    this.floodWarningGiven = false;
    this.crates = new Map(); // crate index -> { crate, sprite, shadow }
    this.claimedCrates = new Map(); // picked up by us, waiting for the server's confirmation
    this.lastPingCycle = 0;
    this.pingIndex = 0;
    this.ui = null; // weapon slider and shop (the original art)
    this.shop = null; // ShopState
    this.autoShopTime = 0;
    this.autoSelectWeapon = null;
    this.loops = new Map(); // weapon -> playing loop sound
    this.reloadSounds = []; // the local player's pending reload / change sounds
  }

  create() {
    setWeaponStats(parseWeaponStats(this.cache.text.get('constants') || ''));
    fitCamera(this.cameras.main);
    // Game keys follow the player's bindings (game/controls.js); these are the fixed ones.
    this.keys = this.input.keyboard.addKeys('M,V,T,H,ESC');
    this.keyState = new KeyState();
    this.input.keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE,TAB');
    this.debug = this.add.graphics().setDepth(9000);
    this.showHits = false;
    this.accumulator = 0;

    this.status = this.add.text(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, '', { ...TEXT_STYLE, fontSize: '14px' }).setOrigin(0.5).setScrollFactor(0).setDepth(HUD_DEPTH);
    this.coords = this.add.text(WINDOW_WIDTH - 8, WINDOW_HEIGHT - 8, '', { ...TEXT_STYLE, fontFamily: 'monospace' }).setOrigin(1, 1).setScrollFactor(0).setDepth(HUD_DEPTH).setVisible(false);
    this.shadows = new ShadowLayer(this);
    this.effects = new Effects(this);
    this.hud = new Hud(this);
    const help =
      this.mode === 'offline'
        ? 'Offline practice · Arrows/WASD move · Space fire · Shift strafe · Q/E or 1-8 weapons · C spin · Ctrl auto-run · B shop · R refill · M model · V colour · H head · T hit boxes · Esc menu'
        : 'Arrows/WASD move · Space fire · Shift strafe · Q/E or 1-8 weapons · C spin · Ctrl auto-run · B shop · R refill · Enter chat · Tab scores · Esc menu';
    // Not in the original: a short reminder of the keys that fades after a while.
    this.help = this.add
      .text(4, 4, help, { ...TEXT_STYLE, fontSize: '10px', backgroundColor: 'rgba(0,0,0,0.4)', wordWrap: { width: 260 } })
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH)
      .setAlpha(0.8);
    this.tweens.add({ targets: this.help, alpha: 0, delay: 30000, duration: 2000 });

    this.events.once('shutdown', () => this.shutdown());
    // Browsers stop drawing hidden or fully covered windows. Keep the network
    // side running so other players still see us (and we keep their state).
    this.onVisibility = () => this.visibilityChanged();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onKeyDown = (event) => {
      if (this.ui?.menuOpen) return; // the Esc menu has the keyboard
      // ShopGame.process: B / N open and close the shop.
      if (this.ui && this.chatInput === null && !this.gameOver && !event.repeat && isKey('shop', event.keyCode)) {
        if (this.ui.shopOpen) this.closeShop();
        else this.openShop();
        return;
      }
      if (this.ui?.shopOpen && this.chatInput === null) {
        if (event.code !== 'Escape' && !isKey('shop', event.keyCode) && this.ui.shop.keyDown(event)) event.preventDefault();
        return;
      }
      this.chatKey(event);
    };
    this.onKeyUp = (event) => {
      if (!this.ui) return;
      if (this.ui.shopOpen) this.ui.shop.keyUp(event);
      if (event.code !== 'Escape') return;
      // Game.handleKeyUp: Escape closes the chat line, then the shop; otherwise it toggles the menu.
      if (this.swallowEscape) this.swallowEscape = false;
      else if (this.ui.shopOpen && !this.ui.menuOpen) this.closeShop();
      else if (this.chatInput === null) this.ui.toggleMenu();
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
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
    on(ServerEvent.PEER_JOINED, () => this.updateScores());
    on(ServerEvent.PEER_DISCONNECTED, ({ id }) => this.removeRemote(id));
    on(ServerEvent.PLAYER_MESSAGE, (message) => this.inbox.push(message));
    on(ServerEvent.SERVER_MESSAGE, ({ message }) => this.receiveServerMessage(message));
    on(ServerEvent.MESSAGE, ({ source, message }) => this.receiveMessage(source, message));
    this.secondTimer = this.time.addEvent({ delay: 1000, loop: true, callback: () => this.second() });
    this.floodTimer = this.time.addEvent({ delay: FLOOD_TIME, loop: true, callback: () => this.floodTick() });
    c.requestRoomInfo(this.room);
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
    this.addCrates(this.connection.existingPickups); // crates already lying around
    this.connection.existingPickups = '';
    this.connection.sendGameMessage('0k1'); // map loaded (BountyGame.loadMap)
    for (const user of this.connection.peers) if (user.handshake) this.ensureRemote(user);
    if (!this.ui) {
      // No shop art: spawn straight away (Game.respawnLocalCharacter).
      this.player.active = true;
      this.connection.sendGameMessage('8' + cellPosToString(this.player.pos));
    }
    this.forcePositionUpdate = true;
    this.updateScores();
  }

  /** Game.receiveServerMessage / processServerMessage. */
  receiveServerMessage(message) {
    if (message.charAt(0) === 'R') this.endGame(message.substr(1)); // "0r<awards>": round over
  }

  /** Game.receiveMessage: pings and chat bundles (our own bundle comes back too; skip it). */
  receiveMessage(source, message) {
    const c = this.connection;
    if (source === c.clientID) return;
    if (message === PING_REQUEST) return c.sendPrivate(PING_RESPONSE, source);
    if (message === PING_RESPONSE) return this.remotes.get(source)?.pingReceived?.();
    const name = this.remotes.get(source)?.character.name || c.peers.find((p) => p.id === source)?.name || 'Someone';
    for (const line of chatLines(message)) if (line) this.hud.addMessage(`${name}: ${line}`, { chat: true });
  }

  // --- other players ----------------------------------------------------------------

  peerHandshake(user) {
    if (this.map) this.applyHandshakeStats(this.ensureRemote(user), user);
    this.forcePositionUpdate = true; // let the newcomer see where we are
    this.updateScores();
  }

  ensureRemote(user) {
    let remote = this.remotes.get(user.id);
    if (!remote) {
      const character = new Character({ id: user.id, name: user.name });
      character.pickupRemoteWeapons();
      character.selectWeaponByID(user.handshake?.weaponID || PISTOL_ID);
      character.firePos = { x: 0, y: 0 };
      character.strafing = true;
      character.stats = newStats();
      remote = { id: user.id, character, view: null, ping: 0, pings: [], lastPing: 0, pingSentAt: 0 };
      remote.pingReceived = () => {
        // Player.pingReceived: average of the last three round trips.
        remote.pings.unshift(performance.now() - remote.pingSentAt);
        if (remote.pings.length > 3) remote.pings.pop();
        remote.ping = remote.pings.reduce((a, b) => a + b, 0) / remote.pings.length;
      };
      this.remotes.set(user.id, remote);
      if (!this.newRound) this.applyHandshakeStats(remote, user);
    }
    const ch = remote.character;
    ch.name = user.name;
    Object.assign(ch.look, { gender: user.gender, headModel: user.headModel, headColor: user.headColor, bodyModel: user.bodyModel, bodyColor: user.bodyColor });
    if (user.handshake && !ch.active) ch.hp = user.handshake.hp;
    if (this.map) {
      remote.view?.destroy();
      remote.view = new CharacterView(this, ch, '#ffe08a');
      remote.view.setPlacing(ch.stats.placing ? placingString(ch.stats.placing) : '');
    }
    return remote;
  }

  /** The game handshake carries the player's round score, kills, deaths and bounty points. */
  applyHandshakeStats(remote, user) {
    const h = user.handshake;
    if (h) Object.assign(remote.character.stats, { score: h.score, kills: h.kills, deaths: h.deaths, bountyPoints: h.bountyPoints });
  }

  removeRemote(id) {
    const remote = this.remotes.get(id);
    if (remote) {
      remote.view?.destroy();
      this.remotes.delete(id);
    }
    this.updateScores();
  }

  /** The player (local character or peer) with this slot id. */
  characterByID(id) {
    if (id === this.connection?.clientID) return this.player;
    return this.remotes.get(id)?.character || null;
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
      // Our own health and position are decided locally; the server's death
      // announcement (it also arrives when we died ourselves) and crate
      // pickups still apply.
      if (message.charAt(0) === '7') this.characterKilled(this.player, parseDeath(message));
      else if (message.charAt(0) === 'm') this.crateTaken(this.player, message);
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
      case 'm':
        this.crateTaken(ch, message);
        break;
      case '0':
        if (message.charAt(1) === 'q') {
          // A peer changed weapon (Game.processPlayerMessage "q").
          if (ch.selectWeaponByID(parseInt(message.substr(2, 2), 10))) this.weaponChanged(ch, true);
        } else if (message.charAt(1) === 'l') this.remotePurchase(ch, message);
        break;
      default:
        break;
    }
  }

  /**
   * "0l<weapon2><action>": a peer bought an upgrade or returned a gun. The
   * Flash client never received these from this server; applying them means
   * our hit checks use the shooter's real damage.
   */
  remotePurchase(ch, message) {
    const weapon = ch.weaponByID(parseInt(message.substr(2, 2), 10));
    const action = message.charAt(4);
    if (!weapon) return;
    if (action === '1' || action === '2') weapon.buyUpgrade(parseInt(action, 10));
    else if (action === '3') {
      const fresh = new weapon.constructor(weapon.id, { remote: true });
      const wasCurrent = ch.weapon === weapon;
      ch.dropWeapon(weapon);
      ch.pickupWeapon(fresh);
      if (wasCurrent) ch.selectWeapon(fresh);
    }
  }

  // --- combat ----------------------------------------------------------------------

  /** Weapon.fire + Game.characterFire for the local player: shoot, show it, warn about ammo, tell the room. */
  fireLocal() {
    const p = this.player;
    const w = p.weapon;
    w.useFireAmmo();
    const param = w.fireParam();
    const shot = w.shoot(p, w.fireAngle(p), param);
    this.executeShot(p, shot);
    if (w.ammo) {
      if (w.ammo.count === 0) this.hud.showWarning('OUT OF AMMO!', 2000);
      else if (!w.ammoWarningGiven && w.ammo.count <= Math.max(1, w.ammo.max * 0.2)) {
        w.ammoWarningGiven = true;
        this.hud.showWarning('LOW AMMO!', 3000);
      }
    }
    if (this.mode === 'online') {
      this.forcePositionUpdate = true; // peers replay the shot from our exact position
      this.outQueue.push(encodeFire(shot.angle, param));
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
    const weapon = shooter.weapon;
    const distances = shot.tracers.map((t) => {
      const targets = shooter !== victim && victim.active && !victim.dead ? [victim] : [];
      const result = traceShot(this.map, t.start, t.angle, t.altitude, t.range, targets, shooter);
      // Every ray (shotgun pellet, flame) that reaches us does the full damage.
      if (result.characters.length) this.localHurt(shooter, weapon, t.angle);
      return result.distance;
    });
    weapon.queueEffects(shot, distances);
  }

  /** Character.hurt + Game.characterHurt for the local player. */
  localHurt(shooter, weapon, angle = null) {
    const p = this.player;
    const before = p.hp;
    let lost = 0;
    this.healthChanged(p, before, () => (lost = p.hurt(Math.min(p.hp, weapon.damage))));
    if (!lost) return;
    this.effects.addBlood(p, lost, angle);
    // ScreenShake(pos, 1.5, 200); Phaser scales the shake by the zoom twice.
    if (Preferences.shake) this.cameras.main.shake(200, 0.006 / (Display.scale * Display.scale));
    if (p.dead) this.localDeath(shooter);
    if (this.mode === 'online') this.outQueue.push(encodeHit(shooter.id, weapon.id, Math.min(99, lost)));
  }

  /** Game.characterDeath: kill message and the respawn countdown. */
  localDeath(killer) {
    this.addKillMessage(killer, this.player);
    this.hud.showWarning('You will respawn in: [seconds]', this.player.respawnTime);
    this.forcePositionUpdate = true;
    if (this.ui) this.autoShopTime = performance.now() + AUTO_SHOP_DELAY; // ShopGame.characterDeath
  }

  /**
   * A death announced by the server: "M<victim>7<killer><weapon><crates>".
   * Counts the kill and death and drops the victim's bounty crates.
   */
  characterKilled(victim, { killerID, crates }) {
    if (!victim) return;
    const killer = this.characterByID(killerID);
    if (!victim.dead) {
      if (!victim.local) this.effects.addBlood(victim, victim.hp);
      this.healthChanged(victim, victim.hp, () => victim.setHealth(0));
      this.addKillMessage(killer, victim);
      if (victim.local) this.hud.showWarning('You will respawn in: [seconds]', this.player.respawnTime);
    }
    victim.stats.deaths++;
    if (killer && killer !== victim) killer.stats.kills++;
    this.addCrates(crates.join(''), victim.pos);
    this.updateScores();
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

  /**
   * PlayerCharacter.updateWeapons: every weapon held ticks (holstered ones
   * still reload); the one in hand shows its queued shot: flash, tracers,
   * smoke, shells, fire and sounds. An empty gun is swapped once reloaded.
   */
  processWeapons(ch) {
    for (const weapon of ch.weapons) {
      const current = weapon === ch.weapon;
      const { effects, reloaded, stopLoop } = weapon.process(current);
      if (effects && current) this.showShot(ch, weapon, effects);
      if (stopLoop || (!current && this.loops.has(weapon))) this.stopLoop(weapon, stopLoop);
      else if (this.loops.has(weapon)) this.effects.moveSound(this.loops.get(weapon), weapon.muzzle);
      if (reloaded) {
        if (ch.local && !ch.dead && weapon.hasAmmo) this.playReloadSound(weapon, weapon.reloadSoundDelay);
        const next = ch.checkAutoSwitch();
        if (next) this.weaponChanged(ch, true);
      }
    }
  }

  /** Weapon.executeEffects. */
  showShot(ch, weapon, effects) {
    if (ch.local) this.stopReloadSounds();
    for (const line of weapon.tracerLines(effects)) this.effects.addTracer(line);
    this.effects.addShotEffects(weapon, effects);
    const sounds = weapon.fireSounds;
    const fire = sounds.length ? sounds[Math.floor(Math.random() * sounds.length)] : null;
    if (weapon.loopSound) {
      if (effects.startLoop) {
        if (fire) this.effects.playSound(fire, weapon.muzzle);
        this.loops.set(weapon, this.effects.playSound(weapon.loopSound, weapon.muzzle, fire ? this.effects.soundLength(fire) : 0, { loop: true }));
      }
    } else if (fire) this.effects.playSound(fire, weapon.muzzle);
  }

  stopLoop(weapon, playStop) {
    this.effects.stopSound(this.loops.get(weapon));
    this.loops.delete(weapon);
    weapon.loopPlaying = false;
    if (playStop && weapon.stopSound) this.effects.playSound(weapon.stopSound, weapon.muzzle);
  }

  /** Weapon.playReloadSound: the local player's reload click (both guns for akimbo). */
  playReloadSound(weapon, delay) {
    if (!weapon.reloadSound || !weapon.hasAmmo) return;
    this.reloadSounds.push(this.effects.playSound(weapon.reloadSound, weapon.muzzle, delay));
    if (weapon.reloadSound2) this.reloadSounds.push(this.effects.playSound(weapon.reloadSound2, weapon.muzzle, delay + weapon.reloadSoundDelay2 - weapon.reloadSoundDelay));
  }

  stopReloadSounds() {
    for (const sound of this.reloadSounds) this.effects.stopSound(sound);
    this.reloadSounds = [];
  }

  /**
   * After PlayerCharacter.selectWeapon: the change sound (Weapon.playChangeWeaponSound),
   * and for us, "0q" to the room and the weapon slider.
   */
  weaponChanged(ch, sound) {
    const weapon = ch.weapon;
    weapon.updatePosition(ch);
    if (sound) {
      if (ch.local) this.stopReloadSounds();
      const change = weapon.changeSound;
      if (change) {
        const s = this.effects.playSound(change, weapon.muzzle);
        if (ch.local) this.reloadSounds.push(s);
      }
      if (ch.local) this.playReloadSound(weapon, change ? this.effects.soundLength(change) : 0);
    }
    if (!ch.local) return;
    if (this.mode === 'online') this.outQueue.push('0q' + padInt(weapon.id, 2));
    this.ui?.slider.update(weapon);
  }

  /** Previous / next weapon and the eight banks (LocalPlayer.processInput). */
  handleWeaponKeys() {
    const p = this.player;
    const press = (action) => this.keyState.newPress(action);
    let changed = null;
    if (press('weaponDown')) changed = p.prevWeapon();
    if (press('weaponUp')) changed = p.nextWeapon() || changed;
    for (let n = 1; n <= 8; n++) if (press('weapon' + n)) changed = p.selectWeaponBank(n) || changed;
    if (changed) this.weaponChanged(p, true);
  }

  // --- shop (ShopGame) -----------------------------------------------------------------

  openShop() {
    if (!this.ui || this.ui.shopOpen || this.ui.menuOpen || this.gameOver) return;
    this.autoShopTime = 0;
    const p = this.player;
    p.moveDir = null;
    p.firing = false;
    this.ui.openShop();
    this.updateShopTime();
  }

  /** ShopGame.closeShop: the first close of a round spawns us with what we bought. */
  closeShop() {
    if (!this.ui?.shopOpen) return;
    const p = this.player;
    this.ui.closeShop();
    if (!p.active) {
      for (const weapon of this.shop.ownedWeapons()) p.pickupWeapon(weapon);
      this.respawnLocal(false);
      if (p.selectWeapon(p.startWeapon())) this.weaponChanged(p, true);
      else this.weaponChanged(p, false);
    }
    this.forcePositionUpdate = true;
    this.ui.slider.setBanks(p.banks);
    if (this.autoSelectWeapon && p.selectWeaponByID(this.autoSelectWeapon.id)) this.weaponChanged(p, true);
    this.autoSelectWeapon = null;
    this.ui.slider.update(p.weapon, true);
    this.updateScores();
  }

  /** ShopGame.handleBuyWeapon / handleRefillWeapon / handleWeaponUpgrade, and refunds. */
  purchased(result) {
    const p = this.player;
    const id = result.weapon.id;
    if (result.event === 'buy' && !p.weaponByID(id)) {
      if (p.active) p.pickupWeapon(result.weapon);
      this.autoSelectWeapon = result.weapon;
    }
    if (result.event === 'refund') {
      const held = p.weaponByID(id);
      if (held) {
        if (p.weapon === held) {
          this.stopLoop(held, false);
          if (p.selectWeapon(p.weaponByID(1) || p.weaponByID(PISTOL_ID) || p.weapons.find((w) => w !== held && w.available))) this.weaponChanged(p, false);
        }
        p.dropWeapon(held);
      }
      if (this.autoSelectWeapon?.id === id) this.autoSelectWeapon = null;
    }
    if (this.mode === 'online') this.connection.sendGameMessage('0l' + padInt(id, 2) + result.action);
    if (p.active) this.ui.slider.setBanks(p.banks);
    this.ui.slider.update(p.weapon, true);
    this.updateScores();
  }

  /** ShopGame.refillCurrentWeapon (R / Delete): ammo for the emptied gun, or the one in hand. */
  refillCurrentWeapon() {
    const p = this.player;
    if (!this.ui || !p.weapon) return;
    const target = p.refillTarget || p.weapon;
    this.ui.shop.refillByID(target.id, true);
    if (target !== p.weapon && target.ammo?.count > 0 && p.selectWeapon(target)) this.weaponChanged(p, true);
    this.updateScores();
  }

  /** ShopGame.updateShopGameTime: the countdown to the round's start. */
  updateShopTime() {
    if (!this.ui?.shopOpen) return;
    if (this.mode === 'offline') return this.ui.shop.setCountDown(0);
    if (this.roundTime >= 0) this.ui.shop.setCountDown(Math.max(0, Math.trunc(this.roundTime - ROUND_START_TIME)));
  }

  /** Options changed from the Esc menu: volume and display, and what the game draws. */
  preferencesChanged() {
    this.app?.applyPreferences();
    this.shadows.texture.setVisible(Preferences.shadows);
    this.shadows.dirty = true;
    this.hud.fps.setVisible(Preferences.showFPS);
  }

  /** The shop's and menu's handlers. */
  shopHandlers() {
    return {
      playSound: (name) => this.app?.playSound(name),
      purchased: (result) => this.purchased(result),
      close: () => this.closeShop(),
      now: () => performance.now(),
      openShop: () => this.openShop(),
      quit: () => this.app?.leaveGame(),
      banksChanged: () => {
        this.player.rebuildBanks();
        if (this.player.active) this.ui.slider.setBanks(this.player.banks);
        this.ui.slider.update(this.player.weapon, true);
      },
      preferencesChanged: () => this.preferencesChanged(),
      selectWeapon: (weapon) => {
        if (this.player.selectWeapon(weapon)) this.weaponChanged(this.player, true);
      },
    };
  }

  /** Game.respawnLocalCharacter: back at the safest spawn point after the countdown. */
  respawnLocal(sound = true) {
    const spawn = this.pickSpawn();
    this.player.respawn(spawn.x, spawn.y);
    this.hud.clearWarnings();
    if (sound) this.effects.playSound('CharacterRespawn', this.player.pos);
    if (this.mode === 'online') {
      this.outQueue.push('8' + cellPosToString(this.player.pos));
      this.forcePositionUpdate = true;
    }
  }

  pickSpawn() {
    const enemies = [...this.remotes.values()].map((r) => r.character).filter((ch) => ch.active && !ch.dead);
    return chooseSpawn(this.map.spawns, enemies) || this.map.spawns[0] || { x: 5.5, y: 5.5 };
  }

  /** KillMessage: "X killed Y", "You" for the local player; highlighted when we are involved. */
  addKillMessage(killer, victim) {
    const name = (ch) => (!ch ? 'Someone' : ch.local ? 'You' : ch.name || 'Someone');
    const text = !killer || killer === victim ? `${name(victim)} killed ${victim.local ? 'yourself' : 'themself'}` : `${name(killer)} killed ${name(victim)}`;
    this.hud.addMessage(text, { local: !!(killer?.local || victim.local) });
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
      this.updateScores();
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
    this.updateScores();
  }

  // --- bounty crates ---------------------------------------------------------------

  /** Game.createBountyItemsFromString: crates, hopping out of `from` when dropped by a death. */
  addCrates(text, from = null) {
    if (!text || !this.map) return;
    const now = performance.now();
    for (const data of parseCrates(text)) {
      this.removeCrate(data.index);
      this.claimedCrates.delete(data.index);
      const crate = new BountyCrate(data, from, now);
      const shadow = this.shadows.create('BountyCrate_Shadow');
      const sprite = createSprite(this, crate.sprite);
      this.crates.set(data.index, { crate, sprite, shadow });
    }
  }

  removeCrate(index) {
    const entry = this.crates.get(index);
    if (!entry) return null;
    entry.sprite.destroy();
    this.shadows.remove(entry.shadow);
    this.crates.delete(index);
    return entry.crate;
  }

  /** Game.checkBountyCrates: walking over a crate claims it until the server confirms. */
  checkBountyCrates() {
    const p = this.player;
    if (!p.active || p.dead || this.mode !== 'online') return;
    for (const [index, { crate }] of this.crates) {
      if (!crate.inRange(p)) continue;
      this.removeCrate(index);
      this.claimedCrates.set(index, crate);
      this.outQueue.push('0m' + padInt(index, 3));
    }
  }

  /** "0m<id><crate3><bountyPoints>": the server gave crate to `ch` (Game.pickupBountyItem). */
  crateTaken(ch, message) {
    const index = parseInt(message.substr(1, 3), 10);
    const bountyPoints = parseInt(message.substr(4), 10) || 0;
    const crate = this.removeCrate(index) || this.claimedCrates.get(index);
    this.claimedCrates.delete(index);
    if (!crate || !ch) return;
    ch.stats.bountyPoints += bountyPoints;
    ch.stats.score += crate.bounty;
    if (ch.local) {
      this.effects.playSound('Ka_ching', ch.pos);
      ch.stats.money += crate.bounty; // Player.pickupMoney (no money premium)
      if (this.ui?.shopOpen) this.ui.shop.refresh();
      const camera = this.cameras.main;
      this.hud.addMoneyFloater(crate.bounty, crate.end.x * CELL_WIDTH - camera.scrollX, crate.end.y * CELL_HEIGHT - camera.scrollY - 20);
    }
    this.updateScores();
  }

  drawCrates() {
    const now = performance.now();
    for (const { crate, sprite, shadow } of this.crates.values()) {
      crate.animate(now);
      const x = snap(crate.x * CELL_WIDTH);
      const y = snap(crate.y * CELL_HEIGHT);
      this.shadows.show(shadow, 'BountyCrate_Shadow', 0, x, y);
      showFrame(sprite, crate.sprite, crate.frame, x, snap(y - crate.altitude));
      sprite.setDepth(crate.y);
    }
  }

  // --- scores, rounds and chat -------------------------------------------------------

  /** Everyone in the room, for the leaderboard and summary. */
  players() {
    const list = [];
    if (this.player) list.push({ id: this.connection?.clientID, name: this.player.name, stats: this.player.stats, local: true, active: this.player.active, character: this.player });
    for (const r of this.remotes.values()) list.push({ id: r.id, name: r.character.name, stats: r.character.stats, local: false, active: r.character.active, character: r.character, view: r.view });
    return list;
  }

  /** Game.updateScores / GUI.updateLeaderboard. */
  updateScores() {
    if (!this.player) return;
    const board = rankPlayers(this.players());
    for (const entry of board) entry.view?.setPlacing(placingString(entry.stats.placing));
    const me = this.player.stats;
    this.hud.setPlacing(this.player.active ? me.placing : 0);
    this.hud.setMoney(me.money);
    this.hud.setBountyPoints(me.bountyPoints);
    // CharacterPointer: the best-placed other player.
    const leader = board.length > 1 ? board.find((p) => !p.local) : null;
    this.leader = leader ? { character: leader.character, name: leader.name, placing: placingString(leader.stats.placing), color: LEADER_COLOR } : null;
    window.boxhead && (window.boxhead.remotes = this.remotes);
  }

  setRoundTime(seconds) {
    if (!Number.isFinite(seconds)) return;
    this.roundTime = seconds;
    if (seconds > ROUND_END_TIME) this.participated = true;
    if (!this.gameOver) this.hud.setTime(seconds - ROUND_END_TIME);
  }

  /** Game.second: local countdown, resynced with the server every 20 s; next round after the summary. */
  second() {
    if (this.roundTime < 0) return;
    this.roundTime -= 1;
    if (this.roundTime % 20 === 0) this.connection.requestRoundTime();
    if (this.roundTime === ROUND_START_TIME) this.effects.playSound('GameStart', this.effects.focus);
    this.updateShopTime();
    if (this.gameOver) {
      this.hud.setSummaryCountdown(this.roundTime);
      // Start the next round once the server has (its "p" jumps back up).
      // Starting on our own countdown can beat the server by a moment, and it
      // ignores gameplay packets, like our spawn, until the new round begins.
      if (this.roundTime > ROUND_END_TIME) this.newGame();
      else if (this.roundTime <= 0) this.connection.requestRoundTime();
      return;
    }
    this.hud.setTime(this.roundTime - ROUND_END_TIME);
  }

  /** Game.endGame: freeze the round and show the summary with the awards. */
  endGame(awardIDs) {
    if (this.gameOver || !this.player) return;
    this.gameOver = true;
    this.closeChat();
    if (this.ui?.shopOpen) this.ui.closeShop();
    this.ui?.setHudVisible(false);
    const everyone = this.players();
    const shown = rankPlayers(everyone.map((p) => ({ ...p, active: p.local ? this.participated : true })));
    const awards = roundAwards(awardIDs, everyone);
    // GameSummary.displayAward: award money is added to the winner's next round.
    for (const award of awards) if (award.player?.local) this.app.roundBonus = (this.app.roundBonus || 0) + award.bonus;
    this.hud.showSummary(shown, awards);
    this.hud.setSummaryCountdown(this.roundTime);
    this.hud.clearWarnings();
    this.effects.playSound('EndRound', this.effects.focus);
  }

  /** Game.newGame: start the next round from scratch with the room's next map. */
  newGame() {
    this.scene.restart({ mode: 'online', app: this.app, room: this.room, newRound: true, inbox: this.inbox });
  }

  /** Chat line: Enter opens it, Enter sends, Escape cancels (GUI input). */
  chatKey(event) {
    if (this.mode !== 'online' || !this.player || this.gameOver || this.ui?.menuOpen) return;
    if (this.chatInput === null) {
      if (event.key === 'Enter') {
        this.chatInput = '';
        this.hud.setInput('');
        event.preventDefault();
      }
      return;
    }
    event.preventDefault();
    if (event.key === 'Enter') {
      this.sendChat(this.chatInput);
      this.closeChat();
    } else if (event.key === 'Escape') {
      this.closeChat();
      this.swallowEscape = true; // Escape closes the chat line, not the game
    } else if (event.key === 'Backspace') {
      this.chatInput = this.chatInput.slice(0, -1);
    } else if (event.key.length === 1 && this.chatInput.length < MAX_CHAT_LENGTH) {
      this.chatInput += cleanChat(event.key);
    }
    if (this.chatInput !== null) this.hud.setInput(this.chatInput);
  }

  closeChat() {
    this.chatInput = null;
    this.hud.setInput(null);
  }

  /** Game.handleKeyUp (Enter): flood control, never send the password, then queue the bundle entry. */
  sendChat(text) {
    text = text.trim();
    if (!text || this.floodWarningGiven) return;
    if (this.floodCount >= MAX_FLOOD) {
      this.floodWarningGiven = true;
      return;
    }
    const password = this.connection.password;
    if (password && text.toLowerCase().includes(password.toLowerCase())) {
      this.hud.addMessage(`${this.player.name}: You can not send chat messages containing your password`, { chat: true });
      return;
    }
    this.floodCount++;
    this.chatOutQueue.push(CHAT_PREFIX + text);
    this.hud.addMessage(`${this.player.name}: ${text}`, { chat: true });
  }

  floodTick() {
    if (this.floodCount > 0) {
      this.floodCount--;
      if (this.floodCount === 0) this.floodWarningGiven = false;
    }
  }

  /**
   * Game.sendUpdate: tell peers about our movement when it changes, then send
   * the queued game messages (shots, hits, respawns, pickups) right after it,
   * then the chat bundle.
   */
  sendUpdate() {
    const packet = encodeMove(this.player);
    if (shouldSendMove(packet, this.lastSentMove, this.forcePositionUpdate)) {
      this.connection.sendGameMessage(packet.text);
      this.lastSentMove = packet;
    }
    while (this.outQueue.length) this.connection.sendGameMessage(this.outQueue.shift());
    if (this.chatOutQueue.length) {
      this.connection.sendMessage(this.chatOutQueue.map((m) => m + CHAT_DELIM).join(''));
      this.chatOutQueue = [];
    }
    this.forcePositionUpdate = false;
  }

  // --- map and local player ------------------------------------------------------

  loadMap(map) {
    this.map = map;
    this.mapView = new MapView(this, map);
    const user = this.connection?.localUser;
    this.player = new Character({ id: this.connection?.clientID, name: user?.name || 'You', local: true });
    this.player.stats = newStats(this.app?.roundBonus || 0);
    if (this.mode === 'offline') this.player.stats.money = OFFLINE_MONEY;
    if (this.app) this.app.roundBonus = 0; // Player.newRound spends the bonus
    if (user) Object.assign(this.player.look, { gender: user.gender, headModel: user.headModel, headColor: user.headColor, bodyModel: user.bodyModel, bodyColor: user.bodyColor });
    const spawn = this.pickSpawn();
    this.player.respawn(spawn.x, spawn.y);
    this.playerView = new CharacterView(this, this.player);
    // The round starts in the shop (BountyGame.showInitUI); we spawn when it closes.
    this.shop = new ShopState(this.player.stats);
    const lib = this.app?.menus?.lib;
    const root = document.getElementById('game-ui');
    if (lib && root) {
      try {
        this.ui = new GameUi(root, lib, this.shop, this.shopHandlers());
      } catch (error) {
        console.warn('The shop art could not be built:', error);
        this.ui = null;
      }
    }
    if (this.ui) {
      this.player.active = false;
      const b = map.borderRect;
      this.player.setPosition(b.x + b.width / 2, b.y + b.height / 2); // the camera looks at the middle meanwhile
      this.openShop();
    }

    const { borderRect } = map;
    this.cameraBounds = { x: borderRect.x * CELL_WIDTH, y: borderRect.y * CELL_HEIGHT, width: borderRect.width * CELL_WIDTH, height: borderRect.height * CELL_HEIGHT };
    this.cameras.main.setRoundPixels(true);
    this.status.setText('');
    window.boxhead = { scene: this, player: this.player, map };
    this.updateScores();
  }

  update(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.ESC) && !this.ui) {
      if (this.swallowEscape) this.swallowEscape = false;
      else if (this.chatInput === null) {
        this.app.leaveGame();
        return;
      }
    }
    this.hud.update();
    if (!this.map) return;
    if (this.chatInput === null && Phaser.Input.Keyboard.JustDown(this.keys.T)) {
      this.showHits = !this.showHits;
      this.coords.setVisible(this.showHits);
    }
    if (this.mode === 'offline') this.handleCustomizeKeys();
    if (this.gameOver) {
      this.hud.showScoreboard(null);
      return; // the round is frozen behind the summary (Game.process)
    }
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= PROCESS_INTERVAL) {
      this.tick();
      this.accumulator -= PROCESS_INTERVAL;
    }
    this.player.animator.advance(delta);
    if (this.ui && this.player.active && !this.ui.shopOpen) this.ui.slider.update(this.player.weapon);
    const alpha = this.accumulator / PROCESS_INTERVAL;
    this.playerView.update(alpha);
    for (const { character, view } of this.remotes.values()) {
      character.animator.advance(delta);
      view?.update(alpha);
    }
    this.drawCrates();
    const camera = this.cameras.main;
    this.placeCamera(this.playerView.container.x, this.playerView.container.y);
    this.shadows.render();
    this.effects.focus = this.player.renderPos;
    this.effects.update();
    this.hud.pointTo(this.leader, { x: camera.scrollX, y: camera.scrollY });
    const tab = this.keyState.isDown('scores') && this.chatInput === null && this.mode === 'online';
    this.hud.showScoreboard(`${this.room} · ${this.mapName || ''}`, tab ? rankPlayers(this.players()) : null);
    this.drawDebug();
    const p = this.player.pos;
    this.coords.setText(`x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}`);
  }

  /** Camera.centerOn kept inside the map border (the camera's origin is its top-left corner). */
  placeCamera(x, y) {
    const b = this.cameraBounds;
    const sx = Math.max(b.x, Math.min(x - WINDOW_WIDTH / 2, b.x + b.width - WINDOW_WIDTH));
    const sy = Math.max(b.y, Math.min(y - WINDOW_HEIGHT / 2, b.y + b.height - WINDOW_HEIGHT));
    this.cameras.main.setScroll(sx, sy);
  }

  /**
   * One 50 ms game tick: messages, input (LocalPlayer.processInput), firing
   * and the respawn countdown (LocalCharacter.process), movement, weapons,
   * crate pickups.
   */
  tick() {
    const p = this.player;
    const ks = this.keyState;
    while (this.inbox.length) this.handlePlayerMessage(this.inbox.shift());
    // ShopGame.process: death opens the shop after 3 s.
    if (Preferences.autoShop && this.autoShopTime && performance.now() >= this.autoShopTime) {
      this.autoShopTime = 0;
      this.openShop();
    }
    const captured = !!(this.ui?.shopOpen || this.ui?.menuOpen); // Game.captureInput: the character stands still
    if (this.ui?.shopOpen) this.ui.shop.updateRespawnTime(Math.max(0, Math.ceil(p.respawnTime / 1000)), p.active, p.dead);
    if (captured) {
      p.moveDir = null;
      p.firing = false;
    } else if (this.chatInput === null && p.active) {
      if (!p.dead) this.handleWeaponKeys();
      if (ks.newPress('refill')) this.refillCurrentWeapon(); // works while dead too
    }
    if (!p.dead && !captured) {
      const typing = this.chatInput !== null;
      const down = (action) => !typing && ks.isDown(action);
      const dir = byVector((down('right') ? 1 : 0) - (down('left') ? 1 : 0), (down('down') ? 1 : 0) - (down('up') ? 1 : 0));
      if (down('autoRun')) {
        // Auto run: keep running the same way; the direction keys only aim.
        if (dir) p.dir = dir;
        if (p.collided) p.moveDir = null;
        p.strafing = true;
      } else {
        p.moveDir = dir;
        p.strafing = down('strafe');
      }
      if (!typing && ks.newPress('spin')) p.dir = DIRECTIONS[(p.dir.index + 4) % 8]; // Character.spin: turn round
      p.firing = down('fire');
    }
    if (p.active) p.move(this.map);
    if (p.active && p.processTimers()) {
      if (!this.ui?.shopOpen) this.respawnLocal(); // the shop holds the respawn back
    } else if (p.active && !p.dead && p.firing && p.weapon.canFire()) this.fireLocal();
    this.processWeapons(p);
    // AutoReload: a gun down to its last round is filled up.
    if (Preferences.autoReload && this.ui && !this.ui.shopOpen && !this.gameOver && p.active && !p.dead) {
      const w = p.weapon;
      if (this.shop.autoReload(w)?.ok) {
        this.ui.shop.refresh();
        if (this.mode === 'online') this.connection.sendGameMessage('0l' + padInt(w.id, 2) + '0');
        this.updateScores();
      }
    }
    for (const { character } of this.remotes.values()) {
      if (character.active) character.move(this.map);
      character.processTimers();
      this.processWeapons(character);
    }
    this.checkBountyCrates();
    if (this.mode === 'online') {
      if (p.active) this.sendUpdate();
      this.pingPeers();
    }
    ks.endTick();
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
    if (Phaser.Input.Keyboard.JustDown(keys.V)) {
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
      this.keyState.reset();
      this.closeChat();
      this.backgroundTimer = setInterval(() => {
        if (this.map && !this.gameOver) this.tick();
      }, PROCESS_INTERVAL);
    }
  }

  shutdown() {
    // Captured keys are blocked page-wide: release them so the menus can be typed in.
    this.input.keyboard.clearCaptures();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.keyState?.destroy();
    this.ui?.destroy();
    this.ui = null;
    this.loops.clear();
    clearInterval(this.backgroundTimer);
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.secondTimer?.remove();
    this.floodTimer?.remove();
    this.mapView?.destroy();
    this.playerView?.destroy();
    for (const { view } of this.remotes.values()) view?.destroy();
    this.remotes.clear();
    for (const index of [...this.crates.keys()]) this.removeCrate(index);
    this.effects?.destroy();
    this.hud?.destroy();
    this.shadows?.destroy();
    this.map = null;
    this.player = null;
  }
}
