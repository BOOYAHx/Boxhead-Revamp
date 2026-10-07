// In-game message encoding (boxhead.game.Game): positions, movement and
// respawn packets. Pure functions so they can be unit-tested.

import { DIRECTIONS } from '../game/Direction.js';
import { padInt } from '../util/strings.js';

/** Cells -> "xxxxxyyyyy" (cells * 100, five digits each). */
export function posToString(pos) {
  return padInt(Math.trunc(pos.x * 100), 5) + padInt(Math.trunc(pos.y * 100), 5);
}

export function stringToPos(text) {
  return { x: parseInt(text.substr(0, 5), 10) / 100, y: parseInt(text.substr(5, 5), 10) / 100 };
}

/** Cell coordinates -> "xxxyyy". */
export function cellPosToString(pos) {
  return padInt(Math.trunc(pos.x), 3) + padInt(Math.trunc(pos.y), 3);
}

export function stringToCellPos(text) {
  return { x: parseInt(text.substr(0, 3), 10), y: parseInt(text.substr(3, 3), 10) };
}

/**
 * Movement packet "1<pos10><moveDir1><dir1><flags1>": moveDir is 0 when
 * standing, otherwise direction index + 1; flag bit 0 = blocked by a wall.
 */
export function encodeMove(ch) {
  const moveDir = ch.moveDir ? ch.moveDir.index + 1 : 0;
  const flags = ch.collided ? 1 : 0;
  return { text: '1' + posToString(ch.pos) + moveDir + ch.dir.index + flags, moveDir, dir: ch.dir.index, flags };
}

export function parseMove(message) {
  const moveIndex = parseInt(message.charAt(11), 10);
  return {
    pos: stringToPos(message.substr(1, 10)),
    moveDir: moveIndex > 0 ? DIRECTIONS[moveIndex - 1] || null : null,
    dir: DIRECTIONS[parseInt(message.charAt(12), 10)] || DIRECTIONS[0],
    blocked: (parseInt(message.charAt(13), 10) & 1) > 0,
  };
}

/**
 * Game.sendUpdate decides when to send: always when forced or blocked,
 * otherwise only when the walking direction, facing or flags changed.
 * Between packets everyone extrapolates along the last walking direction.
 */
export function shouldSendMove(packet, lastSent, forced) {
  if (forced || packet.flags) return true;
  if (!lastSent) return true;
  return packet.moveDir !== lastSent.moveDir || packet.dir !== lastSent.dir || packet.flags !== lastSent.flags;
}
