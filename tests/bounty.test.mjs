// Step 5 rules: bounty crates, leaderboard, round awards and chat bundles.
import assert from 'node:assert/strict';
import test from 'node:test';

import { Character } from '../client/src/game/Character.js';
import { BountyCrate, chatLines, cleanChat, newStats, parseCrates, placingString, rankPlayers, roundAwards } from '../client/src/game/bounty.js';

test('crate strings from the server parse into type, index and position', () => {
  const crates = parseCrates('20120050000500' + '00030123402345' + 'x');
  assert.deepEqual(crates, [
    { type: 2, index: 12, pos: { x: 5, y: 5 } },
    { type: 0, index: 3, pos: { x: 12.34, y: 23.45 } },
  ]);
  assert.deepEqual(parseCrates(''), []);
});

test('crates are worth $250 / $500 / $1000 and are picked up by walking over them', () => {
  const [gold] = parseCrates('20010100002000');
  const crate = new BountyCrate(gold);
  assert.equal(crate.bounty, 1000);
  assert.equal(crate.sprite, 'GoldBountyCrate');
  const ch = new Character({ local: true });
  ch.respawn(10, 20);
  assert.ok(crate.inRange(ch));
  ch.setPosition(10.7, 20); // 0.2 + 0.42 = 0.62 cells reach
  assert.ok(!crate.inRange(ch));
});

test('a dropped crate hops from the victim and lands within 400 ms', () => {
  const [data] = parseCrates('10050100001000');
  const crate = new BountyCrate(data, { x: 8, y: 8 }, 1000, () => 0.5);
  crate.animate(1000);
  assert.deepEqual([crate.x, crate.y], [8, 8]);
  crate.animate(1160); // t = 0.4: top of the jump
  assert.ok(Math.abs(crate.altitude - 30) < 1e-9);
  crate.animate(1400);
  assert.deepEqual([crate.x, crate.y, crate.altitude], [10, 10, 0]);
  assert.ok(crate.frame >= 0 && crate.frame < 8);
});

test('leaderboard: highest score first, the local player below equal scores, inactive players left out', () => {
  const a = { stats: { ...newStats(), score: 10500 }, local: false, active: true };
  const me = { stats: { ...newStats(), score: 10500 }, local: true, active: true };
  const b = { stats: { ...newStats(), score: 12000 }, local: false, active: true };
  const ghost = { stats: { ...newStats(), score: 99999 }, local: false, active: false };
  const board = rankPlayers([me, a, b, ghost]);
  assert.deepEqual(board, [b, a, me]);
  assert.deepEqual([b.stats.placing, a.stats.placing, me.stats.placing], [1, 2, 3]);
  assert.deepEqual([1, 2, 3, 4, 11].map(placingString), ['1st', '2nd', '3rd', '4th', '11th']);
});

test('round awards name the players from the server and describe their achievement', () => {
  const players = [
    { id: '001', name: 'Alice', stats: { score: 13000, kills: 4, deaths: 1, bountyPoints: 6 } },
    { id: '002', name: 'Bob', stats: { score: 10000, kills: 0, deaths: 4, bountyPoints: 0 } },
  ];
  const awards = roundAwards('001001001001002', players);
  assert.deepEqual(awards.map((a) => [a.title, a.player?.name, a.caption, a.bonus]), [
    ['Winner', 'Alice', '13000 Earned', 5000],
    ['The Hunter', 'Alice', '6 Bounty Points', 5000],
    ['The Professional', 'Alice', '4 K/D', 2000],
    ['The Poacher', 'Alice', '$750 Per Kill', 2000],
    ['Target Dummy', 'Bob', '4 Deaths', 2000],
  ]);
  assert.equal(roundAwards('000000000000000', players)[0].player, null);
  assert.equal(roundAwards('002002002002002', players)[2].caption, '0 K/D');
});

test('chat: bundles split on ";" and typed text drops characters the original refused', () => {
  assert.deepEqual(chatLines('chello there;a12;cgg;'), ['hello there', 'gg']);
  assert.equal(cleanChat('hi; there é!'), 'hi there !');
});

test('a new round starts at $10,000 plus last round\'s award money', () => {
  assert.deepEqual(newStats(7000), { score: 10000, money: 17000, kills: 0, deaths: 0, bountyPoints: 0, placing: 0 });
});
