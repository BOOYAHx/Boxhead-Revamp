// Bounty rules: crates (boxhead.world.thing.bounty.BountyCrate), player
// scores (boxhead.game.Player), the leaderboard order (GUI.updateLeaderboard),
// the round summary awards (GameSummary) and chat bundles (Game.processBundle).
// Pure logic so it can be unit-tested.

import { stringToPos } from '../net/protocol.js';

export const CRATE_VALUES = [250, 500, 1000]; // BountyCrate.bounty by type
export const CRATE_SPRITES = ['BountyCrate', 'RedBountyCrate', 'GoldBountyCrate'];
export const CRATE_ENTRY_LENGTH = 14; // <type1><index3><x5><y5>
const CRATE_RADIUS = 0.2; // BountyItem hit circle
const JUMP_HEIGHT = 30; // pixels
const ANIM_TIME = 400; // ms for a dropped crate to land

export const START_SCORE = 10000; // Player: score and money at round start
export const CHAT_DELIM = ';'; // Game.DELIM
export const CHAT_PREFIX = 'c'; // Game.M_CHAT
export const CHAT_VALID = "1234567890-=!@#$%^&*()_+`~abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ[]\\{}|':\",./<>? "; // GUI.VALID_INPUT

/** Game.createBountyItemsFromString: 14-character crate entries. */
export function parseCrates(text) {
  const crates = [];
  for (let i = 0; i + CRATE_ENTRY_LENGTH <= text.length; i += CRATE_ENTRY_LENGTH) {
    const entry = text.substr(i, CRATE_ENTRY_LENGTH);
    const type = parseInt(entry.charAt(0), 10);
    const index = parseInt(entry.substr(1, 3), 10);
    if (!(type >= 0 && type < CRATE_VALUES.length) || Number.isNaN(index)) continue;
    crates.push({ type, index, pos: stringToPos(entry.substr(4, 10)) });
  }
  return crates;
}

export class BountyCrate {
  /** `from`: where a dropped crate jumps from (the victim), or null to appear in place. */
  constructor({ type, index, pos }, from = null, now = 0, random = Math.random) {
    this.type = type;
    this.index = index;
    this.end = { x: pos.x, y: pos.y };
    this.start = from ? { x: from.x, y: from.y } : null;
    this.startTime = now;
    this.jumpHeight = JUMP_HEIGHT * (0.8 + random() * 0.4);
    this.rotationSpan = (random() - 0.5) * 8;
    this.x = pos.x;
    this.y = pos.y;
    this.altitude = 0;
    this.frame = 0;
  }

  get bounty() {
    return CRATE_VALUES[this.type] || 0;
  }

  get sprite() {
    return CRATE_SPRITES[this.type] || CRATE_SPRITES[0];
  }

  /** BountyCrate.animate: hop from the victim to the landing spot, spinning. */
  animate(now) {
    const t = this.start ? (now - this.startTime) / ANIM_TIME : 1;
    let frame;
    if (t >= 1) {
      this.altitude = 0;
      this.x = this.end.x;
      this.y = this.end.y;
      frame = Math.trunc(this.rotationSpan * 8) % 8;
    } else {
      this.altitude = this.jumpHeight * (1 - Math.pow(Math.abs(t - 0.4) / 0.6, 2));
      this.x = this.start.x + (this.end.x - this.start.x) * t;
      this.y = this.start.y + (this.end.y - this.start.y) * t;
      frame = Math.trunc(t * this.rotationSpan * 8) % 8;
    }
    this.frame = frame < 0 ? frame + 8 : frame;
    return this;
  }

  /** BountyItem.checkRange: touching the character's movement circle. */
  inRange(ch) {
    return Math.hypot(this.end.x - ch.pos.x, this.end.y - ch.pos.y) <= CRATE_RADIUS + ch.moveHit.radius;
  }
}

/** A player's round statistics (Player). */
export function newStats(roundBonus = 0) {
  return { score: START_SCORE, money: START_SCORE + roundBonus, kills: 0, deaths: 0, bountyPoints: 0, placing: 0 };
}

/**
 * GUI.updateLeaderboard: active players by score, the local player below
 * anyone with the same score. Sets `placing` (1-based) and returns the order.
 * Entries: { stats, local, active }.
 */
export function rankPlayers(players) {
  const board = players.filter((p) => p.active);
  for (let i = 1; i < board.length; i++) {
    const current = board[i];
    let j = i - 1;
    while (j >= 0) {
      const other = board[j];
      if (current.stats.score > other.stats.score || (current.stats.score === other.stats.score && other.local)) {
        board[j + 1] = other;
        board[j] = current;
        j--;
      } else break;
    }
  }
  board.forEach((p, i) => (p.stats.placing = i + 1));
  return board;
}

export function placingString(placing) {
  if (placing === 1) return '1st';
  if (placing === 2) return '2nd';
  if (placing === 3) return '3rd';
  return placing + 'th';
}

/**
 * GameSummary.displaySummary: the five awards from "0r<winner><hunter>
 * <professional><poacher><dummy>" (slot ids, "000" = nobody), with their
 * captions and the money each adds to the next round.
 */
export function roundAwards(awardIDs, players) {
  const find = (id) => (id === '000' ? null : players.find((p) => p.id === id) || null);
  const ids = [0, 1, 2, 3, 4].map((i) => awardIDs.substr(i * 3, 3));
  const [winner, hunter, professional, poacher, dummy] = ids.map(find);
  const kd = (p) => (p.stats.deaths > 0 ? `${Math.trunc((p.stats.kills / p.stats.deaths) * 100) / 100} K/D` : 'Max K/D');
  const poach = (p) => (p.stats.kills > 0 ? `$${Math.trunc((p.stats.score - START_SCORE) / p.stats.kills)} Per Kill` : `$${p.stats.score - START_SCORE} Free Money`);
  return [
    { title: 'Winner', color: 0xfff336, bonus: 5000, player: winner, caption: winner ? `${winner.stats.score} Earned` : '' },
    { title: 'The Hunter', color: 0xaaff4f, bonus: 5000, player: hunter, caption: hunter ? `${hunter.stats.bountyPoints} Bounty Points` : '' },
    { title: 'The Professional', color: 0xff4545, bonus: 2000, player: professional, caption: professional ? kd(professional) : '' },
    { title: 'The Poacher', color: 0x5d7cff, bonus: 2000, player: poacher, caption: poacher ? poach(poacher) : '' },
    { title: 'Target Dummy', color: 0xf2923d, bonus: 2000, player: dummy, caption: dummy ? `${dummy.stats.deaths} Deaths` : '' },
  ];
}

/** Keep only characters the original chat input accepted (no ';', which separates messages). */
export function cleanChat(text) {
  return [...text].filter((c) => CHAT_VALID.includes(c)).join('');
}

/** Game.processBundle: the chat lines in a decrypted bundle "c<text>;a<index>;...". */
export function chatLines(bundle) {
  return bundle
    .split(CHAT_DELIM)
    .filter((part) => part.charAt(0) === CHAT_PREFIX)
    .map((part) => part.substr(1));
}
