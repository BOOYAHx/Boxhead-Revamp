// Team Deathmatch and Infected: sides, friendly fire, the warm-up and who won.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { GameMap } = await import('../client/src/game/world.js');
const { parseWeaponStats, setWeaponStats } = await import('../client/src/game/weapons.js');
const { MapView } = await import('../client/src/render/MapView.js');
const { CharacterView } = await import('../client/src/render/CharacterView.js');
const { setAtlas } = await import('../client/src/render/assets.js');
const teams = await import('../client/src/game/teams.js');
const { BLUE_TEAM, RED_TEAM, SURVIVORS, INFECTED, NO_TEAM, GameType, ZOMBIE_LOOK, allies, hasTeams, infectionPreparing, roundResult } = teams;
setAtlas({});
setWeaponStats(parseWeaponStats(fs.readFileSync(new URL('../client/assets/game/constants.xml', import.meta.url), 'utf8')));

const stats = (kills, score = 10000) => ({ kills, deaths: 0, score });

test('only team games have sides; Last Survivor plays by the Infected rules', () => {
  assert.equal(hasTeams(GameType.FFA), false);
  assert.equal(hasTeams(GameType.TDM), true);
  assert.equal(hasTeams(GameType.INFECTED), true);
  assert.equal(hasTeams(GameType.LAST_SURVIVOR), true);
  assert.equal(allies(GameType.TDM, BLUE_TEAM, BLUE_TEAM), true);
  assert.equal(allies(GameType.TDM, BLUE_TEAM, RED_TEAM), false);
  assert.equal(allies(GameType.TDM, NO_TEAM, NO_TEAM), false, 'players without a team are nobody\'s allies');
  assert.equal(allies(GameType.FFA, BLUE_TEAM, BLUE_TEAM), false);
});

test('Infected\'s first minute (round clock above 570) is the warm-up', () => {
  assert.equal(infectionPreparing(GameType.INFECTED, 600), true);
  assert.equal(infectionPreparing(GameType.INFECTED, 570), false);
  assert.equal(infectionPreparing(GameType.TDM, 600), false);
});

test('Team Deathmatch: more kills win, money earned breaks a tie, else a draw', () => {
  const players = (b, r, bs = 10000, rs = 10000) => [{ team: BLUE_TEAM, stats: stats(b, bs) }, { team: RED_TEAM, stats: stats(r, rs) }, { team: NO_TEAM, stats: stats(50) }];
  assert.deepEqual([roundResult(GameType.TDM, players(5, 3)).winner, roundResult(GameType.TDM, players(5, 3)).text], [BLUE_TEAM, 'Blue Team wins! 5 kills to 3']);
  assert.equal(roundResult(GameType.TDM, players(2, 7)).winner, RED_TEAM);
  assert.equal(roundResult(GameType.TDM, players(4, 4, 12000, 15000)).text, 'Red Team wins on money earned (4 kills each)');
  assert.equal(roundResult(GameType.TDM, players(4, 4)).winner, NO_TEAM);
  assert.equal(roundResult(GameType.FFA, players(4, 4)), null);
});

test('Infected: the survivors win while any are left', () => {
  const left = [{ team: SURVIVORS, stats: stats(0) }, { team: INFECTED, stats: stats(3) }];
  assert.equal(roundResult(GameType.INFECTED, left).text, 'Survivors win! 1 survived');
  const none = [{ team: INFECTED, stats: stats(0) }, { team: INFECTED, stats: stats(3) }];
  assert.equal(roundResult(GameType.INFECTED, none).winner, INFECTED);
});

// Any drawing call does nothing and can be chained.
function display() {
  const object = new Proxy(() => object, { get: (target, key) => (key === 'then' ? undefined : object), apply: () => object });
  return object;
}

function setup(t, gameType, data = {}) {
  t.mock.method(MapView.prototype, 'drawTerrain', () => {});
  t.mock.method(MapView.prototype, 'drawProps', () => {});
  t.mock.method(CharacterView.prototype, 'applyLook', () => {});
  const sent = [];
  const messages = [];
  const app = { playSound() {}, connection: { clientID: '001', roomGameType: gameType, peers: [], localUser: { name: 'Me' }, sendGameMessage: (m) => sent.push(m) } };
  const scene = new GameScene();
  scene.init({ mode: 'online', app, room: 'Game', ...data });
  scene.add = { container: display, image: display, text: display, graphics: display };
  scene.textures = { exists: () => false };
  scene.cache = { audio: { get: () => null } };
  scene.shadows = display();
  scene.lighting = null;
  scene.cameras = { main: { setRoundPixels() {}, shake() {} } };
  scene.status = { setText() {} };
  scene.hud = { setInput() {}, showSummary() {}, setSummaryCountdown() {}, clearWarnings() {}, addMessage: (text) => messages.push(text), showWarning: (text) => messages.push(text), setTeamStatus() {}, setPlacing() {}, setMoney() {}, setBountyPoints() {} };
  scene.effects = { playSound() {}, addBlood() {} };
  scene.time = { addEvent() {} };
  scene.setNpcCount = scene.setRoundTime = () => {};
  scene.loadMap(new GameMap(4, 4));
  scene.player.active = true;
  scene.roundTime = 500;
  const peer = (id, name) => {
    const user = { id, name, gender: 'Male', headModel: 1, headColor: 0, bodyModel: 1, bodyColor: 0 };
    app.connection.peers.push(user);
    return scene.ensureRemote(user).character;
  };
  return { scene, sent, messages, peer };
}

const pistol = { id: 0, damage: 10 };

test('Team Deathmatch: teammates cannot hurt each other, the other team can', (t) => {
  const { scene, peer } = setup(t, GameType.TDM);
  const mate = peer('002', 'Mate');
  const enemy = peer('003', 'Enemy');
  scene.handlePlayerMessage({ source: '001', message: '0k2' });
  scene.handlePlayerMessage({ source: '002', message: '0k2' });
  scene.handlePlayerMessage({ source: '003', message: '0k3' });
  assert.equal(scene.friendly(scene.player, mate), true);
  assert.equal(scene.friendly(scene.player, enemy), false);
  scene.hurtCharacter(scene.player, mate, pistol);
  assert.equal(scene.player.hp, 100);
  scene.hurtCharacter(scene.player, enemy, pistol);
  assert.equal(scene.player.hp, 90);
  scene.hurtCharacter(scene.player, scene.player, pistol);
  assert.equal(scene.player.hp, 80, 'our own blasts still hurt us');
});

test('Team Deathmatch: no spawning before joining a team; "Join Team" asks the server', (t) => {
  const { scene, sent, messages } = setup(t, GameType.TDM);
  assert.equal(scene.needsTeam(), true);
  scene.chooseTeam(RED_TEAM);
  scene.chooseTeam(BLUE_TEAM);
  assert.deepEqual(sent.filter((m) => m.startsWith('0k')), ['0k3'], 'one pick at a time');
  scene.handlePlayerMessage({ source: '001', message: '0k3' });
  assert.equal(scene.needsTeam(), false);
  assert.equal(scene.teamRequested, NO_TEAM);
  assert.deepEqual(messages, ['You joined the Red Team']);
});

test('Team Deathmatch teams carry over to the next round', (t) => {
  const { scene } = setup(t, GameType.TDM, { newRound: true, teams: [['001', BLUE_TEAM], ['002', RED_TEAM]] });
  assert.equal(scene.teamOf('001'), BLUE_TEAM);
  assert.equal(scene.teamOf('002'), RED_TEAM);
  assert.equal(scene.needsTeam(), false);
});

test('Infected: nobody is hurt in the warm-up; the infected wear the zombie look and spare each other', (t) => {
  const { scene, peer, messages } = setup(t, GameType.INFECTED, { teams: [['001', INFECTED]] });
  const other = peer('002', 'Other');
  assert.equal(scene.teamOf('001'), SURVIVORS, 'every Infected round starts with survivors only');
  scene.roundTime = 600;
  scene.hurtCharacter(scene.player, other, pistol);
  assert.equal(scene.player.hp, 100);
  scene.roundTime = 500;
  scene.handlePlayerMessage({ source: '002', message: '0k3' });
  assert.deepEqual(other.look, { ...other.look, ...ZOMBIE_LOOK });
  assert.ok(messages.some((m) => m.includes('The infection has begun: Other is infected')));
  scene.hurtCharacter(scene.player, other, pistol);
  assert.equal(scene.player.hp, 90, 'the infected hurt survivors');
  scene.handlePlayerMessage({ source: '001', message: '0k3' });
  assert.equal(scene.player.look.headModel, ZOMBIE_LOOK.headModel);
  scene.hurtCharacter(scene.player, other, pistol);
  assert.equal(scene.player.hp, 90, 'but not each other');
});

test('the round\'s last infection is counted before the summary', (t) => {
  const { scene, peer } = setup(t, GameType.INFECTED);
  peer('002', 'Other');
  let shown = null;
  scene.ui = { showSummary: (rows, awards, portrait, options) => (shown = options.result), setSummaryCountdown() {}, setHudVisible() {}, shopOpen: false };
  scene.handlePlayerMessage({ source: '002', message: '0k3' });
  scene.inbox.push({ source: '001', message: '0k3' });
  scene.receiveServerMessage('R000000000000000');
  assert.equal(shown.text, 'The infected win! Nobody survived');
});

test('FFA rooms have no sides', (t) => {
  const { scene, peer } = setup(t, GameType.FFA);
  const other = peer('002', 'Other');
  scene.handlePlayerMessage({ source: '002', message: '0k3' });
  assert.equal(scene.teamOf('002'), NO_TEAM);
  assert.equal(scene.friendly(scene.player, other), false);
  assert.equal(scene.needsTeam(), false);
});
