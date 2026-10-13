// Game modes with sides: Team Deathmatch (TeamBountyGame: the blue and the red
// team) and Infected (survivors against the infected, decided by the server).
// Both use the same two team ids on the wire ("0k<team>", the handshake's team
// character); the server keeps teammates from hurting each other.

export const GameType = Object.freeze({ FFA: 'A', TDM: 'B', INFECTED: 'C', LAST_SURVIVOR: 'D' });
export const MODE_NAMES = Object.freeze({ A: 'FFA', B: 'Team Deathmatch', C: 'Infected', D: 'Last Survivor Infected' });

export const NO_TEAM = 0;
export const BLUE_TEAM = 2; // TeamBountyGame.BLUE_TEAM
export const RED_TEAM = 3; // TeamBountyGame.RED_TEAM
export const SURVIVORS = BLUE_TEAM;
export const INFECTED = RED_TEAM;

/** The round clock (server seconds left) when Infected's one-minute preparation ends and the infection starts. */
export const INFECTION_STARTS_AT = 570;

/** What the infected look like: the Zombie head and body in pale green, with the monster's voice. */
export const ZOMBIE_LOOK = Object.freeze({ gender: 'Monster', headModel: 9, headColor: 2, bodyModel: 9, bodyColor: 2 }); // pale green skin and rags

const COLORS = {
  [GameType.TDM]: { [BLUE_TEAM]: '#4d7dff', [RED_TEAM]: '#ff3b3b' },
  [GameType.INFECTED]: { [SURVIVORS]: '#ffe08a', [INFECTED]: '#7ee04a' },
};
const NAMES = {
  [GameType.TDM]: { [BLUE_TEAM]: 'Blue Team', [RED_TEAM]: 'Red Team' },
  [GameType.INFECTED]: { [SURVIVORS]: 'Survivors', [INFECTED]: 'Infected' },
};

/** Last Survivor plays by Infected's rules. */
const family = (type) => (type === GameType.LAST_SURVIVOR ? GameType.INFECTED : type);

export function hasTeams(type) {
  return family(type) === GameType.TDM || family(type) === GameType.INFECTED;
}

export function isInfectedMode(type) {
  return family(type) === GameType.INFECTED;
}

export function isTeam(team) {
  return team === BLUE_TEAM || team === RED_TEAM;
}

/** Two different players on the same side (who cannot hurt each other). */
export function allies(type, a, b) {
  return hasTeams(type) && isTeam(a) && a === b;
}

export function teamName(type, team) {
  return NAMES[family(type)]?.[team] || '';
}

export function teamColor(type, team) {
  return COLORS[family(type)]?.[team] || null;
}

/** Infected's preparation: nobody is infected yet and nobody can be hurt. */
export function infectionPreparing(type, roundTime) {
  return isInfectedMode(type) && roundTime > INFECTION_STARTS_AT;
}

/**
 * Kills, deaths, money earned and players of each side.
 * players: [{ team, stats: { kills, deaths, score } }].
 */
export function teamTotals(players) {
  const totals = {};
  for (const team of [BLUE_TEAM, RED_TEAM]) totals[team] = { kills: 0, deaths: 0, score: 0, players: 0 };
  for (const p of players) {
    const t = totals[p.team];
    if (!t) continue;
    t.kills += p.stats.kills;
    t.deaths += p.stats.deaths;
    t.score += p.stats.score;
    t.players++;
  }
  return totals;
}

/**
 * How the round ended. Team Deathmatch: the team with more kills wins (money
 * earned breaks a tie). Infected: the survivors win while any are left.
 * Returns { winner (team or NO_TEAM for a draw), text, totals } or null for FFA.
 */
export function roundResult(type, players) {
  if (!hasTeams(type)) return null;
  const totals = teamTotals(players);
  const blue = totals[BLUE_TEAM];
  const red = totals[RED_TEAM];
  if (isInfectedMode(type)) {
    const left = totals[SURVIVORS].players;
    if (left > 0) return { winner: SURVIVORS, text: `Survivors win! ${left} survived`, totals };
    return { winner: INFECTED, text: 'The infected win! Nobody survived', totals };
  }
  if (blue.kills !== red.kills) {
    const winner = blue.kills > red.kills ? BLUE_TEAM : RED_TEAM;
    return { winner, text: `${teamName(type, winner)} wins! ${Math.max(blue.kills, red.kills)} kills to ${Math.min(blue.kills, red.kills)}`, totals };
  }
  if (blue.score !== red.score) {
    const winner = blue.score > red.score ? BLUE_TEAM : RED_TEAM;
    return { winner, text: `${teamName(type, winner)} wins on money earned (${blue.kills} kills each)`, totals };
  }
  return { winner: NO_TEAM, text: `Draw! ${blue.kills} kills each`, totals };
}
