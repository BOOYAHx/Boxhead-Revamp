// Ties the connection, the menus and the Phaser scenes together, like the
// original Main class: main menu -> server select -> connecting -> login ->
// lobby -> game room -> back to the lobby. The menus are the original Flash
// art (ui/menus.js); when the asset build has not exported it, the plain HTML
// menus (ui/Screens.js) are used instead.

import { BRIDGE_URL, SERVER_NAME } from './config.js';
import { loadPreferences, Preferences } from './game/preferences.js';
import { Connection, ServerEvent } from './net/Connection.js';
import { fetchMapList } from './net/MapService.js';
import { drawPortrait } from './render/portrait.js';
import { FlashMenus } from './ui/menus.js';
import { Screens } from './ui/Screens.js';

const LOBBY = '_';
const ROOM_LIST_REFRESH = 10000;
const VALID_NAME = /^[A-Za-z0-9.,]{3,20}$/; // same rule as the server's account check
const UI_VOLUME = 0.7; // SoundControl.UI_VOLUME
const MUSIC_VOLUME = 0.7; // SoundControl.MUSIC_VOLUME
const MUSIC_DELAY = 300; // ms (Main.showMainMenu)
const MUSIC_FADE = 1000; // ms (Main.hideMainMenu)
const RECONNECT_DELAY = 2000; // MMOchaLobby.reconnectTimer
// Main.handleServerError: errors that end the session, shown on the BanScreen.
const SESSION_ERRORS = {
  'Account Banned': ['You are currently banned', ''],
  'Server Full': ['Server is full.', 'Please try again later.'],
  'Duplicate Login': ['Duplicate login detected.', ''],
};

export class App {
  constructor(game, { overlay, flashRoot = null }) {
    this.game = game;
    this.connection = new Connection();
    loadPreferences();
    this.handlers = {
      connect: () => this.connectToServer(),
      cancelConnect: () => this.showMainMenu(),
      login: (u, p) => this.login(u, p),
      register: (u, p) => this.register(u, p),
      offline: () => this.playOffline(),
      logout: () => this.logout(),
      refreshRooms: () => this.connection.requestRoomList(),
      requestRoomInfo: (name) => this.connection.requestRoomInfo(name),
      joinRoom: (name) => this.joinRoom(name),
      createRoom: (options) => this.createRoom(options),
      chat: (text) => this.lobbyChat(text),
      preferencesChanged: () => this.applyPreferences(),
    };
    this.screens = new Screens(overlay, this.handlers);
    this.ui = this.screens;
    this.menus = null;
    this.menusReady = flashRoot
      ? FlashMenus.create(flashRoot, this.handlers, {
          playSound: (name) => this.playSound(name),
          portrait: (look) => drawPortrait(this.game.textures, look),
          serverName: SERVER_NAME,
        })
          .then((menus) => (this.menus = menus))
          .catch((error) => console.warn('Original menu art not found, using the plain menus:', error.message))
      : Promise.resolve();
    this.maps = [];
    this.mapsReady = fetchMapList().then((maps) => (this.maps = maps));
    this.pendingLogin = null;
    this.state = 'menu';
    this.ready = false;
    this.listen();
  }

  /** Called once the game art has loaded (BootScene). */
  async start() {
    await this.menusReady;
    this.applyPreferences();
    this.game.sound.once('unlocked', () => this.applyPreferences()); // browsers start audio muted until a click
    this.ready = true;
    if (this.menus) {
      this.ui = this.menus;
      this.showMainMenu({ fade: true });
    } else {
      this.showLogin({ status: 'Connecting…' });
      this.connect();
    }
  }

  connect() {
    this.connection.connect(BRIDGE_URL);
  }

  listen() {
    const c = this.connection;
    c.on(ServerEvent.CONNECTED, () => this.connected());
    c.on(ServerEvent.FAILED, () => this.connectionFailed());
    c.on(ServerEvent.DISCONNECTED, () => this.connectionLost());

    c.on(ServerEvent.REGISTER, ({ ok, error }) => this.ui.registerResult(ok, error));
    c.on(ServerEvent.SERVER_ERROR, (event) => this.serverError(event));
    c.on(ServerEvent.AUTHENTICATE, () => {
      if (this.state !== 'reconnecting') this.ui.loginSucceeded();
      this.state = 'lobby';
      c.joinLobby();
    });

    c.on(ServerEvent.ROOM_JOINED, ({ room }) => (room === LOBBY ? this.enterLobby() : this.enterGame(room)));
    c.on(ServerEvent.ROOM_LIST, ({ rooms }) => this.state === 'lobby' && this.ui.setRooms(rooms));
    c.on(ServerEvent.ROOM_INFO, (info) => this.state === 'lobby' && this.ui.setRoomInfo?.(info));
    const refreshPlayers = () => {
      if (this.state === 'lobby' && c.room === LOBBY) this.ui.setPlayers([c.localUser, ...c.peers].filter(Boolean));
    };
    c.on(ServerEvent.PEER_JOINED, refreshPlayers);
    c.on(ServerEvent.HANDSHAKE, refreshPlayers);
    c.on(ServerEvent.PEER_DISCONNECTED, refreshPlayers);
    c.on(ServerEvent.MOST_WANTED_CHANGE, refreshPlayers);
    c.on(ServerEvent.MESSAGE, ({ source, message }) => {
      if (c.room !== LOBBY || source === c.clientID || message.charAt(0) !== 'C') return;
      const peer = c.peers.find((p) => p.id === source);
      this.ui.addChat(peer?.name || 'Someone', message.substr(1));
    });
    c.on(ServerEvent.WARNING, ({ message }) => c.room === LOBBY && this.ui.addChat('Moderator', message, 'warning'));
    c.on(ServerEvent.GLOBAL_MESSAGE, ({ message }) => c.room === LOBBY && this.ui.addChat('', message, 'system'));
  }

  // --- connection (Main.connect / connected / connectionFailed) -------------------------------

  /** "connect" on the server select screen. */
  connectToServer() {
    this.state = 'connecting';
    this.menus?.connecting();
    if (this.connection.connected) this.connected();
    else this.connect();
  }

  connected() {
    if (this.pendingLogin) {
      // login() was called before the connection was open.
      const { username, password } = this.pendingLogin;
      this.pendingLogin = null;
      this.connection.authenticate(username, password);
    } else if (this.state === 'reconnecting') {
      this.menus.lobbyJoining();
      this.connection.authenticate(this.connection.username, this.connection.password);
    } else if (this.state === 'connecting') {
      this.showLogin();
    } else if (this.state === 'login') {
      this.ui.setLoginFeedback('Connected. Log in or create an account.');
    }
  }

  connectionFailed() {
    if (this.state === 'reconnecting') return this.scheduleReconnect();
    this.pendingLogin = null;
    if (this.menus) {
      if (this.state === 'connecting' || this.state === 'login') {
        this.state = 'menu';
        this.menus.connectionFailed();
      }
      return;
    }
    if (this.state !== 'offline') this.showLogin({ error: `Cannot reach the game server at ${BRIDGE_URL}. Is BBHServer.py running?` });
  }

  connectionLost() {
    if (this.state === 'reconnecting') return this.scheduleReconnect();
    if (this.state === 'offline' || this.state === 'menu') return;
    this.pendingLogin = null;
    if (!this.menus) {
      this.showLogin({ error: 'Disconnected from the game server.' });
      return;
    }
    if (this.state === 'lobby' || this.state === 'joining') {
      // MMOchaLobby.disconnected: say so in the chat and keep trying to get back in.
      this.state = 'reconnecting';
      this.menus.lobbyDisconnected();
      this.scheduleReconnect();
    } else if (this.state === 'game') {
      // Main.disconnectedFromGame: back to the main menu and connect again.
      this.showMainMenu();
      this.connectToServer();
    } else {
      this.showMainMenu();
      this.menus.connectionFailed();
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.state === 'reconnecting' && this.connect(), RECONNECT_DELAY);
  }

  serverError({ message, code }) {
    if (SESSION_ERRORS[message] && this.menus) {
      this.showMainMenu();
      this.menus.banScreen(...SESSION_ERRORS[message]);
      return;
    }
    if (this.state === 'login' || this.state === 'connecting' || this.pendingLogin) {
      this.ui.loginFailed(message);
    } else if (this.state === 'reconnecting') {
      // The stored login was refused: stop trying (MMOchaLobby.forceDisconnect).
      this.state = 'lobby-closed';
      this.connection.disconnect();
      this.menus.lobbyNotice(message);
    } else if (this.state === 'joining') {
      this.state = 'lobby';
      const creating = this.creatingRoom;
      this.creatingRoom = false;
      if (code !== undefined || message === 'Error') this.ui.roomError(creating);
      else this.ui.setLobbyFeedback(message, true);
    }
  }

  // --- main menu and login --------------------------------------------------------------------

  /** Main.showMainMenu: disconnects and shows the menu (with the title music). */
  showMainMenu({ fade = false } = {}) {
    if (!this.menus) {
      this.showLogin();
      if (!this.connection.connected) this.connect();
      return;
    }
    this.state = 'menu';
    this.pendingLogin = null;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.roomTimer);
    this.connection.disconnect();
    this.stopGame();
    this.menus.mainMenu({ fade });
    this.playMusic();
  }

  showLogin(options = {}) {
    this.state = 'login';
    this.stopGame();
    this.ui.login({ username: this.lastUsername || '', ...options });
  }

  validate(username, password) {
    if (!VALID_NAME.test(username) || !VALID_NAME.test(password)) {
      this.ui.loginFailed('User name and password: 3-20 letters, digits, "." or ",".');
      return false;
    }
    return true;
  }

  login(username, password) {
    if (!this.validate(username, password)) return;
    this.lastUsername = username;
    if (!this.menus) this.ui.setLoginFeedback('Logging in…');
    if (this.connection.connected) this.connection.authenticate(username, password);
    else {
      this.pendingLogin = { username, password };
      this.connect();
    }
  }

  register(username, password) {
    if (!this.validate(username, password)) return;
    if (!this.connection.connected) {
      this.ui.loginFailed('Not connected yet, try again in a moment.');
      this.connect();
      return;
    }
    if (!this.menus) this.ui.setLoginFeedback('Creating account…');
    this.connection.register(username, password);
  }

  /** Exit in the lobby (MMOchaLobby.exitLobby → Main.showMainMenu). */
  logout() {
    if (this.menus) return this.showMainMenu();
    this.connection.disconnect();
    this.showLogin({ status: 'Logged out.' });
    this.connect();
  }

  // --- lobby ----------------------------------------------------------------------------------

  async enterLobby() {
    this.state = 'lobby';
    this.creatingRoom = false;
    clearTimeout(this.reconnectTimer);
    this.stopGame();
    this.fadeMusic();
    await this.mapsReady;
    const c = this.connection;
    this.ui.showLobby({ user: c.localUser, maps: this.maps });
    this.ui.setPlayers([c.localUser, ...c.peers].filter(Boolean));
    if (!this.maps.some((m) => m?.online)) this.ui.setLobbyFeedback('Map service unavailable: using the bundled Warehouse map.');
    c.requestRoomList();
    clearInterval(this.roomTimer);
    // The original lobby refreshes the game browser itself; the plain menus need a timer.
    if (!this.menus) {
      this.roomTimer = setInterval(() => {
        if (this.state === 'lobby') c.requestRoomList();
      }, ROOM_LIST_REFRESH);
    }
  }

  joinRoom(name) {
    if (!name || !this.connection.connected) return;
    this.state = 'joining';
    this.creatingRoom = false;
    if (!this.menus) this.ui.setLobbyFeedback(`Joining ${name}…`);
    this.connection.joinRoom(name);
  }

  /** maps: indexes in the bounty map list, played in order (map: a single one). */
  createRoom({ name, map = 0, maps, isPrivate = false, gameType = 'A' }) {
    if (!name || !this.connection.connected) return;
    this.state = 'joining';
    this.creatingRoom = true;
    if (!this.menus) this.ui.setLobbyFeedback(`Creating ${name}…`);
    this.connection.createRoom(name, { gameType, isPrivate, maps: maps?.length ? maps : [map] });
  }

  lobbyChat(text) {
    this.connection.sendMessage('C' + text);
    this.ui.addChat(this.connection.localUser?.name || 'You', text, 'own');
  }

  // --- game -----------------------------------------------------------------------------------

  async enterGame(room) {
    clearInterval(this.roomTimer);
    this.state = 'game';
    this.creatingRoom = false;
    this.fadeMusic();
    await this.mapsReady;
    this.ui.clear();
    this.game.scene.stop('menu');
    this.game.scene.start('game', { mode: 'online', app: this, room });
  }

  leaveGame() {
    if (this.state === 'offline') {
      // Main.closeGame: quick play goes back to the main menu.
      if (this.menus) return this.showMainMenu();
      this.showLogin({ status: this.connection.connected ? 'Connected.' : '' });
      if (!this.connection.connected) this.connect();
      return;
    }
    this.connection.joinLobby();
  }

  playOffline() {
    this.state = 'offline';
    this.fadeMusic();
    this.ui.clear();
    this.game.scene.stop('menu');
    this.game.scene.start('game', { mode: 'offline', app: this });
  }

  stopGame() {
    if (this.game.scene.isActive('game') || this.game.scene.isPaused('game')) this.game.scene.stop('game');
    if (!this.game.scene.isActive('menu')) this.game.scene.start('menu');
  }

  // --- sound and options ----------------------------------------------------------------------

  /** SoundControl.playUISound */
  playSound(name) {
    const key = 'snd:' + name;
    if (this.game.cache.audio.exists(key)) this.game.sound.play(key, { volume: UI_VOLUME });
  }

  /** SoundControl.playMusic(TITLE_MUSIC, 300): loops until the main menu closes. */
  playMusic() {
    const key = 'snd:TitleScreenMusic';
    if (this.music || !this.game.cache.audio.exists(key)) return;
    const sound = this.game.sound;
    const music = (this.music = sound.add(key, { loop: true, volume: MUSIC_VOLUME }));
    const play = () => this.music === music && music.play();
    this.musicTimer = setTimeout(() => (sound.locked ? sound.once('unlocked', play) : play()), MUSIC_DELAY);
  }

  /** SoundControl.fadeMusic */
  fadeMusic(ms = MUSIC_FADE) {
    const music = this.music;
    this.music = null;
    clearTimeout(this.musicTimer);
    if (!music) return;
    const steps = 10;
    let left = steps;
    const timer = setInterval(() => {
      left -= 1;
      if (left > 0 && music.isPlaying) music.setVolume((MUSIC_VOLUME * left) / steps);
      else {
        clearInterval(timer);
        music.destroy();
      }
    }, ms / steps);
  }

  /** Options: the master volume here; the game reads the other options as it draws. */
  applyPreferences() {
    this.game.sound.volume = Preferences.volume;
  }
}
