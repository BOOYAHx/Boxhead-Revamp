// Original moderator chat commands. The server independently authorizes every request.
import { ServerEvent } from '../net/Connection.js';

export const MAX_BAN_MINUTES = 960;
export const MAX_MOD_MESSAGE_LENGTH = 240;
/** How long to wait for the server's answer before saying it never came. */
export const MODERATION_REPLY_TIMEOUT = 5000;

export const isModerator = (user) => Number.isFinite(Number(user?.level)) && Number(user?.level) > 0;

export function moderatorHelp(user) {
  return isModerator(user)
    ? ['Moderator commands:', '/warn name message', '/ban name minutes reason (1–960 minutes)']
    : [];
}

/** Return true for a consumed command, including rejected requests, so it never becomes public chat. */
export function runModeratorCommand(connection, text, notify) {
  const match = String(text).trim().match(/^\/(warn|ban)(?:\s+([\s\S]*))?$/i);
  if (!match) return false;
  const command = match[1].toLowerCase();
  if (!isModerator(connection?.localUser)) {
    notify('Only moderators can use this command.');
    return true;
  }
  if (!connection.authenticated || !connection.connected) {
    notify('Connect and log in before using moderator commands.');
    return true;
  }
  const args = (match[2] || '').trim().match(command === 'ban' ? /^(\S+)\s+(\S+)\s+(.+)$/ : /^(\S+)\s+(.+)$/);
  if (!args) {
    notify(command === 'ban' ? 'Usage: /ban name minutes reason' : 'Usage: /warn name message');
    return true;
  }
  const target = [connection.localUser, ...connection.peers].find((user) => user?.name?.toLowerCase() === args[1].toLowerCase());
  if (!target || !/^[0-9]{3}$/.test(target.id)) {
    notify('Player not found in this room.');
    return true;
  }
  const message = args[command === 'ban' ? 3 : 2].replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!message || message.length > MAX_MOD_MESSAGE_LENGTH) {
    notify(`Provide a message of 1–${MAX_MOD_MESSAGE_LENGTH} characters.`);
    return true;
  }
  if (command === 'ban') {
    if (target.id === connection.clientID) {
      notify('You cannot ban yourself.');
      return true;
    }
    const minutes = /^[0-9]{1,3}$/.test(args[2]) ? Number(args[2]) : 0;
    if (minutes < 1 || minutes > MAX_BAN_MINUTES) {
      notify(`Ban duration must be a whole number from 1 to ${MAX_BAN_MINUTES} minutes.`);
      return true;
    }
    connection.sendRaw(`0e${target.id};${minutes};${message}`);
    notify(`Banning ${target.name} for ${minutes} minute(s)...`);
  } else {
    connection.sendRaw(`0g${target.id}${message}`);
    notify(`Warning ${target.name}...`);
  }
  awaitReply(connection, notify);
  return true;
}

/**
 * The server answers every request ("0t..."). Without an answer the request
 * vanished (a game server still running code from before moderation was
 * added, for one), so say so instead of leaving the moderator guessing.
 */
function awaitReply(connection, notify) {
  if (!connection.on || !connection.off) return;
  const answered = () => {
    clearTimeout(timer);
    connection.off(ServerEvent.MODERATION_RESULT, answered);
  };
  const timer = setTimeout(() => {
    connection.off(ServerEvent.MODERATION_RESULT, answered);
    notify('The game server did not answer. Restart it (boxhead-restart) and try again.');
  }, MODERATION_REPLY_TIMEOUT);
  connection.on(ServerEvent.MODERATION_RESULT, answered);
}
