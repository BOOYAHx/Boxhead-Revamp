// Ties the connection, the HTML menus and the Phaser scenes together:
// login -> lobby -> game room -> back to the lobby.

import { BRIDGE_URL } from './config.js';
import { Connection, ServerEvent } from './net/Connection.js';
import { fetchMapList } from './net/MapService.js';
import { Screens } from './ui/Screens.js';

const LOBBY = '_';
const ROOM_LIST_REFRESH = 10000;
const VALID_NAME = /^[A-Za-z0-9.,]{3,20}$/; // same rule as the server's account check

export class App {
  constructor(game, overlay) {
    this.game = game;
    this.connection = new Connection();
    this.screens = new Screens(overlay, {
      login: (u, p) => this.login(u, p),
      register: (u, p) => this.register(u, p),
      offline: () => this.playOffline(),
      logout: () => this.logout(),
      refreshRooms: () => this.connection.requestRoomList(),
      joinRoom: (name) => this.joinRoom(name),
      createRoom: (options) => this.createRoom(options),
      chat: (text) => this.lobbyChat(text),
    });
    this.maps = [];
    this.mapsReady = fetchMapList().then((maps) => (this.maps = maps));
    this.pendingLogin = null;
    this.state = 'login';
    this.listen();
  }

  start() {
    this.showLogin({ status: 'Connecting…' });
    this.connect();
  }

  connect() {
    this.connection.connect(BRIDGE_URL);
  }

  listen() {
    const c = this.connection;
    c.on(ServerEvent.CONNECTED, () => {
      if (this.pendingLogin) {
        const { username, password } = this.pendingLogin;
        this.pendingLogin = null;
        c.authenticate(username, password);
      } else if (this.state === 'login') {
        this.screens.setLoginFeedback('Connected. Log in or create an account.');
      }
    });
    c.on(ServerEvent.FAILED, () => this.connectionLost(`Cannot reach the game server at ${BRIDGE_URL}. Is BBHServer.py running?`));
    c.on(ServerEvent.DISCONNECTED, () => this.connectionLost('Disconnected from the game server.'));

    c.on(ServerEvent.REGISTER, ({ ok, error }) => {
      if (ok) this.screens.setLoginFeedback('Account created. You can log in now.');
      else this.screens.setLoginFeedback(error, true);
    });
    c.on(ServerEvent.SERVER_ERROR, ({ message }) => {
      if (this.state === 'login') this.screens.setLoginFeedback(message, true);
      else if (this.state === 'lobby' || this.state === 'joining') {
        this.state = 'lobby';
        this.screens.setLobbyFeedback(message === 'Error' ? 'Game not found, full, or that name is already in use.' : message, true);
      }
    });
    c.on(ServerEvent.AUTHENTICATE, () => {
      this.state = 'lobby';
      c.joinLobby();
    });

    c.on(ServerEvent.ROOM_JOINED, ({ room }) => (room === LOBBY ? this.enterLobby() : this.enterGame(room)));
    c.on(ServerEvent.ROOM_LIST, ({ rooms }) => this.screens.setRooms(rooms));
    const refreshPlayers = () => {
      if (this.state === 'lobby' && c.room === LOBBY) this.screens.setPlayers([c.localUser, ...c.peers].filter(Boolean));
    };
    c.on(ServerEvent.PEER_JOINED, refreshPlayers);
    c.on(ServerEvent.HANDSHAKE, refreshPlayers);
    c.on(ServerEvent.PEER_DISCONNECTED, refreshPlayers);
    c.on(ServerEvent.MESSAGE, ({ source, message }) => {
      if (c.room !== LOBBY || source === c.clientID || message.charAt(0) !== 'C') return;
      const peer = c.peers.find((p) => p.id === source);
      this.screens.addChat(peer?.name || 'Someone', message.substr(1));
    });
    c.on(ServerEvent.WARNING, ({ message }) => this.screens.addChat('Moderator', message, 'warning'));
    c.on(ServerEvent.GLOBAL_MESSAGE, ({ message }) => this.screens.addChat('', message, 'system'));
  }

  // --- login -------------------------------------------------------------------

  showLogin(options = {}) {
    this.state = 'login';
    this.stopGame();
    this.screens.login({ username: this.lastUsername || '', ...options });
  }

  validate(username, password) {
    if (!VALID_NAME.test(username) || !VALID_NAME.test(password)) {
      this.screens.setLoginFeedback('User name and password: 3-20 letters, digits, "." or ",".', true);
      return false;
    }
    return true;
  }

  login(username, password) {
    if (!this.validate(username, password)) return;
    this.lastUsername = username;
    this.screens.setLoginFeedback('Logging in…');
    if (this.connection.connected) this.connection.authenticate(username, password);
    else {
      this.pendingLogin = { username, password };
      this.connect();
    }
  }

  register(username, password) {
    if (!this.validate(username, password)) return;
    if (!this.connection.connected) {
      this.screens.setLoginFeedback('Not connected yet, try again in a moment.', true);
      this.connect();
      return;
    }
    this.screens.setLoginFeedback('Creating account…');
    this.connection.register(username, password);
  }

  logout() {
    this.connection.disconnect();
    this.showLogin({ status: 'Logged out.' });
    this.connect();
  }

  connectionLost(message) {
    if (this.state === 'offline') return;
    this.pendingLogin = null;
    this.showLogin({ error: message });
  }

  // --- lobby -------------------------------------------------------------------

  async enterLobby() {
    this.state = 'lobby';
    this.stopGame();
    await this.mapsReady;
    const c = this.connection;
    this.screens.showLobby({ user: c.localUser, maps: this.maps });
    this.screens.setPlayers([c.localUser, ...c.peers].filter(Boolean));
    if (!this.maps.some((m) => m?.online)) this.screens.setLobbyFeedback('Map service unavailable: using the bundled Warehouse map.');
    c.requestRoomList();
    clearInterval(this.roomTimer);
    this.roomTimer = setInterval(() => {
      if (this.state === 'lobby') c.requestRoomList();
    }, ROOM_LIST_REFRESH);
  }

  joinRoom(name) {
    if (!name) return;
    this.state = 'joining';
    this.screens.setLobbyFeedback(`Joining ${name}…`);
    this.connection.joinRoom(name);
  }

  createRoom({ name, map, isPrivate }) {
    if (!name) return;
    this.state = 'joining';
    this.screens.setLobbyFeedback(`Creating ${name}…`);
    this.connection.createRoom(name, { gameType: 'A', isPrivate, maps: [map] });
  }

  lobbyChat(text) {
    this.connection.sendMessage('C' + text);
    this.screens.addChat(this.connection.localUser?.name || 'You', text, 'own');
  }

  // --- game --------------------------------------------------------------------

  async enterGame(room) {
    clearInterval(this.roomTimer);
    this.state = 'game';
    await this.mapsReady;
    this.screens.clear();
    this.game.scene.stop('menu');
    this.game.scene.start('game', { mode: 'online', app: this, room });
  }

  leaveGame() {
    if (this.state === 'offline') {
      this.showLogin({ status: this.connection.connected ? 'Connected.' : '' });
      if (!this.connection.connected) this.connect();
      return;
    }
    this.connection.joinLobby();
  }

  playOffline() {
    this.state = 'offline';
    this.screens.clear();
    this.game.scene.stop('menu');
    this.game.scene.start('game', { mode: 'offline', app: this });
  }

  stopGame() {
    if (this.game.scene.isActive('game') || this.game.scene.isPaused('game')) this.game.scene.stop('game');
    if (!this.game.scene.isActive('menu')) this.game.scene.start('menu');
  }
}
