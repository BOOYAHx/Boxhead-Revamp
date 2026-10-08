// The lobby's friends and blocked lists (MMOchaLobby's "Lobby" SharedObject:
// friendsList and ignoreList), kept in this browser by player name.

const STORAGE_KEY = 'bbh.lobby';

export class Social {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    let saved = {};
    try {
      saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    this.friends = new Set((saved.friends || []).map(key));
    this.blocked = new Set((saved.blocked || []).map(key));
  }

  isFriend(name) {
    return this.friends.has(key(name));
  }

  isBlocked(name) {
    return this.blocked.has(key(name));
  }

  setFriend(name, on) {
    this.toggle(this.friends, name, on);
  }

  setBlocked(name, on) {
    this.toggle(this.blocked, name, on);
  }

  toggle(set, name, on) {
    if (!name) return;
    if (on) set.add(key(name));
    else set.delete(key(name));
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ friends: [...this.friends], blocked: [...this.blocked] }));
    } catch {
      // storage unavailable: the lists last until the page is closed
    }
  }

  /**
   * UserListWindow.addToOrderedList: you first, then friends, moderators,
   * the most wanted, everyone else and blocked players last, each by name.
   */
  order(users, local) {
    const rank = (u) => (u === local ? 0 : this.isBlocked(u.name) ? 5 : this.isFriend(u.name) ? 1 : u.level > 0 ? 2 : u.wanted ? 3 : 4);
    return users
      .filter(Boolean)
      .map((u) => [rank(u), u])
      .sort((a, b) => a[0] - b[0] || (a[1].name || '').localeCompare(b[1].name || ''))
      .map(([, u]) => u);
  }

  /** UserDisplay.displayUser: which icon a player's row shows. */
  icon(user, local) {
    if (this.isBlocked(user.name)) return 'Ignore';
    if (this.isFriend(user.name)) return 'Friend';
    if (user.level > 0) return 'Moderator';
    if (user.wanted) return 'Wanted';
    return user === local ? 'Local' : 'None';
  }
}

const key = (name) => String(name || '').toLowerCase();
