// Browser port of MMOcha.server.MMOchaServer.
//
// The Flash client talked to the game server through an XMLSocket: UTF-8
// strings terminated by a NUL byte. BBHServer.py bridges a WebSocket to that
// same TCP stream, so this class only has to frame messages the same way and
// decode the server's replies exactly like the original client did.
// docs/PROTOCOL.md lists every message.

import { Emitter } from '../util/Emitter.js';
import { fromAlphaCharacter } from '../util/strings.js';

export const ServerEvent = Object.freeze({
  CONNECTED: 'connected',
  FAILED: 'failed',
  DISCONNECTED: 'disconnected',
  AUTHENTICATE: 'authenticate',
  REGISTER: 'register',
  SERVER_ERROR: 'serverError',
  ROOM_LIST: 'roomList',
  ROOM_INFO: 'roomInfo',
  ROOM_JOINED: 'roomJoined',
  PEER_JOINED: 'peerJoined',
  PEER_DISCONNECTED: 'peerDisconnected',
  HANDSHAKE: 'handshake',
  MESSAGE: 'message', // decrypted chat bundle from a peer
  PLAYER_MESSAGE: 'playerMessage', // game state from (or about) a peer
  SERVER_MESSAGE: 'serverMessage',
  ROUND_TIME: 'roundTime',
  WARNING: 'warning',
  GLOBAL_MESSAGE: 'globalMessage',
  MOST_WANTED_CHANGE: 'mostWantedChange',
  PING: 'ping',
});

const GENDERS = ['Monster', 'Male', 'Female'];

/** Name fields are 20 characters, left-padded with '#'. */
function readName(field) {
  const name = field.replace(/^#+/, '');
  return name.charAt(0).toUpperCase() + name.substr(1);
}

export class User {
  constructor(id) {
    this.id = id;
    this.name = '';
    this.level = 0;
    this.gender = 'Male';
    this.headModel = 0;
    this.headColor = 0;
    this.bodyModel = 0;
    this.bodyColor = 0;
    this.stats = { kills: 0, deaths: 0, wins: 0, losses: 0, bounty: 0 };
    this.wanted = false;
    this.handshake = null;
  }
}

export class Connection extends Emitter {
  constructor() {
    super();
    this.socket = null;
    this.buffer = '';
    this.decoder = new TextDecoder();
    this.clientID = null;
    this.localUser = null;
    this.peers = [];
    this.room = null;
    this.joiningRoom = null;
    this.roomGameType = 'A';
    this.authenticated = false;
    this.pingsSent = [];
    this.pingTimes = [];
    this.pingIndex = 0;
    this.pingTimer = null;
  }

  get connected() {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  connect(url) {
    this.disconnect();
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.buffer = '';
    socket.addEventListener('open', () => {
      this.clientID = null;
      this.localUser = new User(null);
      this.emit(ServerEvent.CONNECTED);
    });
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('error', () => {
      if (socket === this.socket && socket.readyState !== WebSocket.OPEN) this.emit(ServerEvent.FAILED);
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket) return;
      this.endSession();
      this.socket = null;
      this.emit(ServerEvent.DISCONNECTED);
    });
  }

  disconnect() {
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close();
    }
    this.endSession();
  }

  endSession() {
    this.clientID = null;
    this.authenticated = false;
    this.peers = [];
    this.room = null;
    this.localUser = null;
    this.disablePing();
  }

  // --- framing -----------------------------------------------------------

  /** Send one XMLSocket message (the NUL terminator is added here). */
  sendRaw(message) {
    if (this.connected) this.socket.send(message + '\0');
  }

  receive(data) {
    this.buffer += typeof data === 'string' ? data : this.decoder.decode(data, { stream: true });
    let end;
    while ((end = this.buffer.indexOf('\0')) >= 0) {
      const message = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (message) {
        try {
          this.handleMessage(message);
        } catch (error) {
          console.error('Bad server message', JSON.stringify(message), error);
        }
      }
    }
  }

  // --- requests (same strings the Flash client sent) ----------------------

  authenticate(username, password) {
    this.username = username;
    this.password = password;
    this.authenticated = false;
    this.sendRaw(`09${username};${password}`);
  }

  register(username, password) {
    this.sendRaw(`0a${username};${password}`);
  }

  joinRoom(name) {
    this.joiningRoom = name;
    this.peers = [];
    this.sendRaw('03' + name);
  }

  joinLobby() {
    this.joinRoom('_');
  }

  requestRoomList() {
    this.sendRaw('01');
  }

  requestRoomInfo(name) {
    this.sendRaw('04' + name);
  }

  requestRoundTime() {
    this.sendRaw('p');
  }

  /**
   * gameType: 'A' free-for-all, 'B' team deathmatch, 'C' infected, 'D' last survivor.
   * maps: indexes into the bounty map list, played in order.
   */
  createRoom(name, { gameType = 'A', isPrivate = false, useCustomMaps = false, maps = [0], lives = 0 } = {}) {
    this.joiningRoom = name;
    this.peers = [];
    let message = '02' + gameType + (useCustomMaps ? '1' : '0') + (isPrivate ? '1' : '0') + name + ';';
    for (const index of maps) message += toAlphaUpper(index);
    if (gameType === 'B' && lives) message += ';L' + lives;
    this.sendRaw(message);
  }

  /** Unencrypted game message, relayed by the server ("1", "4", "6", "8", "0q", ...). */
  sendGameMessage(message) {
    this.sendRaw(message);
  }

  /** Chat bundle to everyone in the room. */
  sendMessage(message) {
    this.sendRaw('9' + encrypt(message));
  }

  sendPrivate(message, targetID) {
    this.sendRaw('00' + targetID + '9' + encrypt(message));
  }

  submitCustomization(headModel, headColor, bodyModel, bodyColor, gender) {
    const pad = (n) => String(n).padStart(2, '0');
    this.sendRaw('0d0' + pad(headModel) + pad(headColor));
    this.sendRaw('0d1' + pad(bodyModel) + pad(bodyColor));
    this.sendRaw('0d2' + Math.max(0, GENDERS.indexOf(gender)));
  }

  enablePing(interval = 1000) {
    if (this.pingTimer) return;
    this.pingTimes = [];
    this.pingsSent = [];
    this.pingTimer = setInterval(() => this.pingTick(), Math.max(1000, interval));
  }

  disablePing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  pingTick() {
    if (!this.connected || !this.room) return;
    this.pingsSent.push({ time: performance.now(), index: this.pingIndex });
    this.sendRaw('9?' + this.pingIndex);
    this.pingIndex = (this.pingIndex + 1) % 1000;
  }

  get ping() {
    if (!this.pingTimes.length) return 0;
    return this.pingTimes.reduce((a, b) => a + b, 0) / this.pingTimes.length;
  }

  pingReceived(index) {
    const at = this.pingsSent.findIndex((p) => p.index === index);
    if (at < 0) return;
    const sent = this.pingsSent[at];
    this.pingsSent.splice(0, at + 1);
    this.pingTimes.push(performance.now() - sent.time);
    while (this.pingTimes.length > 5) this.pingTimes.shift();
    this.emit(ServerEvent.PING);
  }

  // --- incoming ------------------------------------------------------------

  handleMessage(data) {
    // Account bridge patch: "10;0;<error>" and "Z1"/"Z0<error>".
    if (data.startsWith('10;0;')) return this.emit(ServerEvent.SERVER_ERROR, { message: data.substr(5) });
    if (data.charAt(0) === 'Z') {
      const ok = data.charAt(1) === '1';
      return this.emit(ServerEvent.REGISTER, { ok, error: ok ? null : data.substr(2) || 'Account creation failed' });
    }

    const type = data.charAt(0);
    switch (type) {
      case '0':
        return this.handleZeroMessage(data);
      case 'A': {
        const id = data.substr(1, 3);
        const user = this.localUser || (this.localUser = new User(id));
        user.id = id;
        this.clientID = id;
        this.authenticated = true;
        updateUserFromAuthenticate(user, data.substr(4));
        return this.emit(ServerEvent.AUTHENTICATE, { id, user });
      }
      case 'U': {
        // Like the Flash client, only peers are updated: the server also sends
        // our own handshake, in the game-room layout even inside the lobby.
        const id = data.substr(1, 3);
        const user = this.peers.find((p) => p.id === id);
        if (!user) return;
        if (this.room === '_') updateUserFromLobbyHandshake(user, data.substr(4));
        else updateUserFromGameHandshake(user, data.substr(4));
        return this.emit(ServerEvent.HANDSHAKE, { id, user });
      }
      case 'C': {
        const id = data.substr(1, 3);
        if (!this.clientID) {
          this.clientID = id;
          if (this.localUser) this.localUser.id = id;
        }
        if (id === this.clientID) {
          this.room = this.joiningRoom;
          this.roomGameType = data.length > 4 ? data.charAt(4) : 'A';
          return this.emit(ServerEvent.ROOM_JOINED, { id, room: this.room, gameType: this.roomGameType });
        }
        if (!this.peers.some((p) => p.id === id)) this.peers.push(new User(id));
        return this.emit(ServerEvent.PEER_JOINED, { id });
      }
      case 'D': {
        const id = data.substr(1, 3);
        if (id === this.clientID) {
          this.endSession();
          return this.emit(ServerEvent.DISCONNECTED);
        }
        const index = this.peers.findIndex((p) => p.id === id);
        if (index >= 0) this.peers.splice(index, 1);
        return this.emit(ServerEvent.PEER_DISCONNECTED, { id });
      }
      case 'M': {
        const id = data.substr(1, 3);
        if (data.charAt(4) === '9') {
          if (data.charAt(5) === '?') {
            if (id === this.clientID) this.pingReceived(parseInt(data.substr(6), 10));
            return;
          }
          return this.emit(ServerEvent.MESSAGE, { source: id, message: decrypt(data.substr(5)) });
        }
        return this.emit(ServerEvent.PLAYER_MESSAGE, { source: id, message: data.substr(4) });
      }
      case 'r':
      case 's':
      case 'n':
      case 'o':
        return this.emit(ServerEvent.SERVER_MESSAGE, { message: data });
      case 'p':
        return this.emit(ServerEvent.ROUND_TIME, { seconds: parseInt(data.substr(1), 10) });
      default:
        // Includes the relayed respawn "8<id><cell>": same shape as the original default branch.
        return this.emit(ServerEvent.PLAYER_MESSAGE, { source: data.substr(1, 3), message: data.substr(4), raw: data });
    }
  }

  handleZeroMessage(data) {
    const sub = data.charAt(1);
    const rest = data.substr(2);
    switch (sub) {
      case '1': {
        const rooms = rest.split(';');
        rooms.pop();
        return this.emit(ServerEvent.ROOM_LIST, {
          rooms: rooms.map((entry) => ({ name: entry.substr(2), players: parseInt(entry.substr(0, 2), 10), maxPlayers: 16 })),
        });
      }
      case '4':
        return this.emit(ServerEvent.ROOM_INFO, {
          gameType: data.charAt(2),
          useCustomMaps: data.charAt(3) === '1',
          mapID: fromAlphaCharacter(data.charAt(4).toLowerCase()),
          players: parseInt(data.substr(5, 2), 10),
          roundTime: parseInt(data.substr(7), 10),
        });
      case 'g':
        return this.emit(ServerEvent.WARNING, { message: rest });
      case 'j':
        return this.emit(ServerEvent.GLOBAL_MESSAGE, { message: rest });
      case 'r':
        return this.emit(ServerEvent.SERVER_MESSAGE, { message: 'R' + rest });
      case 'm':
        return this.emit(ServerEvent.PLAYER_MESSAGE, { source: data.substr(2, 3), message: 'm' + data.substr(5) });
      case 'y': {
        const id = data.substr(2, 3);
        const user = id === this.clientID ? this.localUser : this.peers.find((p) => p.id === id);
        if (user) user.wanted = data.substr(5) === '1';
        return this.emit(ServerEvent.MOST_WANTED_CHANGE, { id });
      }
      case '9': {
        const code = data.charAt(2);
        const errors = { 0: 'Server Full', 1: 'Account Banned', 3: 'Duplicate Login', 4: 'Vote Kicked' };
        return this.emit(ServerEvent.SERVER_ERROR, { message: errors[code] || 'Error', code });
      }
      default:
        return undefined; // "00;1" login handshake, "0p" premium refresh, ...
    }
  }
}

// --- message helpers ---------------------------------------------------------

/** The client's chat "encryption": rotate the text by d*d characters. */
export function encrypt(message) {
  if (!message.length) return '1';
  const d = 1 + Math.floor(Math.random() * 9);
  const cut = (d * d) % message.length;
  return d + message.substr(cut) + message.substr(0, cut);
}

export function decrypt(message) {
  const d = parseInt(message.charAt(0), 10);
  const body = message.substr(1);
  if (!body.length) return '';
  const cut = body.length - ((d * d) % body.length);
  return body.substr(cut) + body.substr(0, cut);
}

function toAlphaUpper(index) {
  return index < 26 ? (index + 10).toString(36).toUpperCase() : (index - 16).toString(36).toUpperCase();
}

function updateUserFromAuthenticate(user, data) {
  user.name = readName(data.substr(0, 20));
  user.level = parseInt(data.charAt(20), 10) || 0;
  user.wanted = data.charAt(data.length - 1) === '1';
  data = data.substr(0, data.length - 1);
  user.gender = GENDERS[parseInt(data.charAt(21), 10)] || 'Monster';
  user.headModel = parseInt(data.substr(22, 2), 10) || 0;
  user.headColor = parseInt(data.substr(24, 2), 10) || 0;
  user.bodyModel = parseInt(data.substr(26, 2), 10) || 0;
  user.bodyColor = parseInt(data.substr(28, 2), 10) || 0;
  const [kills, deaths, wins, losses, bounty] = data.substr(30).split(';').map((n) => parseInt(n, 10) || 0);
  user.stats = { kills, deaths, wins, losses, bounty };
}

function updateUserFromLobbyHandshake(user, data) {
  user.name = readName(data.substr(0, 20));
  user.wanted = data.charAt(data.length - 1) === '1';
  const parts = data.substr(20, data.length - 21).split(';').map((n) => parseInt(n, 10) || 0);
  user.stats = { kills: parts[0], deaths: parts[1], wins: parts[2], losses: parts[3], bounty: parts[4] };
  user.level = parts[5] || 0;
}

function updateUserFromGameHandshake(user, data) {
  user.name = readName(data.substr(5, 20));
  user.wanted = data.charAt(data.length - 1) === '1';
  data = data.substr(0, data.length - 1);
  const weaponID = parseInt(data.substr(0, 2), 10) || 0;
  const hp = parseInt(data.substr(2, 3), 10);
  user.gender = GENDERS[parseInt(data.charAt(25), 10)] || 'Monster';
  user.headModel = parseInt(data.substr(26, 2), 10) || 0;
  user.headColor = parseInt(data.substr(28, 2), 10) || 0;
  user.bodyModel = parseInt(data.substr(30, 2), 10) || 0;
  user.bodyColor = parseInt(data.substr(32, 2), 10) || 0;
  const team = parseInt(data.charAt(34), 10) || 0;
  const fields = data.substr(35).split(';');
  const [score, kills, deaths, bountyPoints] = fields.slice(0, 4).map((n) => parseInt(n, 10) || 0);
  let upgradesText = fields.slice(4).join(';');
  const upgrades = [];
  while (upgradesText.length > 2) {
    upgrades.push({ weaponID: parseInt(upgradesText.substr(0, 2), 10), flags: parseInt(upgradesText.charAt(2), 10) });
    upgradesText = upgradesText.substr(3);
  }
  user.handshake = { weaponID, hp: isNaN(hp) ? 100 : hp, team, score, kills, deaths, bountyPoints, upgrades };
}
