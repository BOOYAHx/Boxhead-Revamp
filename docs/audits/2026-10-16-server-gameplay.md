# Verified security sweep: server-gameplay, 2026-10-16

## Context
- Scope: rooms, combat packets, crates, deployables, rounds and persisted stats in
  `bbh-server-hunter-fix_2.py`. That covers the room helpers, round store and awards, `plant_item`,
  `damage_item`, the relays and `_handle_packet` branches `03`, `1`/`4`, `o`, `2`/`3`, `04`, `02`, `9?`,
  `8`/`0l`, `6`, `7`, `0m`, `0v`, `0k`, `0q` and the final catch-all.
- Trigger: owner request; this is the anti-cheat surface.
- First run. Commit read: `93d6304`.
- Baseline, not a finding by itself: each client judges hits on itself and reports its own
  movement, as in the original game. The question was what a cheater can do beyond that.

## Delegation
One read-only reviewer (general-purpose agent, fresh context). Its brief:
- Pre-read: `AGENTS.md`, `docs/PROTOCOL.md`, and the README sections on rounds, ranked and unranked
  rooms, crates, Team Deathmatch and Infected.
- Scope: the branches above. The cheater is a logged-in player sending any raw packet.
- Rules: the severity calibration, the disqualifications, and at most ten findings.

There were no previous reports. Verification, reproduction and the report were done by the sweep
owner.

## Verification
| Finding | Zone | Verdict | Claimed | Verified | Reservations | Proof |
|---|---|---|---|---|---|---|
| F1 unknown packets relayed to the room unchanged | server-gameplay | VERIFIED REAL | High | High | | `tests/audit/test_sweep_server_gameplay.py` UnknownPacketRelay, ran, fails as expected: bob receives `D002` and a forged `M002 7` death |
| F2 malformed position breaks every death in the room | server-gameplay | VERIFIED REAL | High | High | lasts until the cheater sends a valid position | BadPositionBreaksDeaths, ran, fails as expected: `ValueError` at the crate placement |
| F3 suicide counts as a kill | server-gameplay | VERIFIED REAL | Medium | Medium | | SelfKillCredit, ran, fails as expected |
| F4 crates taken while dead | server-gameplay | VERIFIED REAL | Medium | Medium | a distance check alone would only force a visible teleport, since movement is client-reported | CratePickupRules, ran, fails as expected |
| F5 anyone destroys another player's barrel or barricade | server-gameplay | VERIFIED REAL | Medium | Medium | | DeployableDamage, ran, fails as expected |
| F6 one player takes all 100 deployable slots | server-gameplay | VERIFIED REAL | Medium | Medium | lasts one round | DeployableSlots, ran, fails as expected |
| F7 killer lookup iterates `USERS` with no lock | server-gameplay | VERIFIED REAL | Medium | Low | needs a login or logout in the same instant | KillerLookupRace, ran, fails as expected: `RuntimeError` loses the kill and the death announcement |
| P8 `2`/`3` relay stamps the account id instead of the slot | server-gameplay | NEEDS DEEPER REVIEW | Low | - | | `bbh-server-hunter-fix_2.py:1948` |
| P9 non-numeric attacker in `6` | server-gameplay | OVER-RATED | Low | - | only the sender's own death is affected | `bbh-server-hunter-fix_2.py:2144` |
| P10 rooms named `INFECTED...` get Infected rules | server-gameplay | FALSE POSITIVE | Low | - | lens claim correctness: compatibility rule; it makes the room unranked, never more rewarding | `bbh-server-hunter-fix_2.py:273` |
| P11 team-size and join-capacity checks not under a lock | server-gameplay | OVER-RATED | Low | - | microsecond window; effect is one extra player, in unranked team rooms for the team check | not reproduced |
| P12 `6` processed in the lobby | server-gameplay | NEEDS DEEPER REVIEW | Low | - | | whether lobby stats ever reach `users.db` not traced |
| P13 a lone player in a public FFA room wins every round | server-gameplay | OVER-RATED | Low | - | decision pending: product rule | `calculate_round_awards` |

## Confirmed defects

### F1: unknown packets are relayed to the room unchanged (High)
- Location: `bbh-server-hunter-fix_2.py:2618`. Class: player identity on the wire. OWASP A01:2025,
  CWE-290.
- Evidence chain:
  1. The final `else:` of `_handle_packet` builds `payload_bytes` from the raw packet at
     `bbh-server-hunter-fix_2.py:2618` and sends it to every other player in the room. It does not
     add the sender's id.
  2. A cheater sends a packet that no branch claims, for example `D002` or `M0027001` + `00`.
     These are server packet types: `D` is "you were disconnected", `M<id>...` is "player <id> did
     something".
  3. No branch handles `D`, `M`, `A`, `0r` or `p<n>`. The bridge forwards server bytes as they are.
     The client trusts them, as it should trust the server: `client/src/net/Connection.js:324`.
- Scenario: in a ranked room a cheater sends `D` with each player's id. Every other player is
  thrown to the menu and loses the round in progress. Or the cheater forges shots and deaths in
  other players' names, so real players die and the kills are saved to the cheater's friend.
- Fix approach: drop unknown packets instead of relaying them (log them). If a new opcode needs
  relaying, add it explicitly and stamp the sender's id, as `relay_state_to_room` and
  `relay_chat9_to_room` already do.
- Reproduction: `UnknownPacketRelay`. Both attack cases fail on the current code.
  `test_guard_movement_is_relayed_with_the_senders_id` passes.

### F2: one malformed position breaks every death in the room (High)
- Location: `bbh-server-hunter-fix_2.py:1806`. Class: input parsing of raw packets. OWASP A10:2025,
  CWE-20.
- Evidence chain:
  1. `bbh-server-hunter-fix_2.py:1806` stores any 10 characters as `last_pos`.
     `remember_walkable_position` rejects them for the history, but `last_pos` is already stored.
  2. A cheater sends `112_3412_34000`. When any player in the room dies, the crate placement reads
     every player's `last_pos`. `int("12_34")` is valid Python, so the guarded parse passes, but
     `int("12_")` at `bbh-server-hunter-fix_2.py:2279` raises `ValueError` outside the `try`.
  3. The death and the kill are already counted, but the exception skips the crates, the
     `M<victim>7` death announcement, the lives update and the Infected conversion. `handle()` only
     logs the exception.
- Scenario: with one packet, a cheater makes every death in the room drop no bounty crates (no
  money, no saved bounty points for anyone). Other screens never see the death, and in Infected
  rooms dead survivors are never infected.
- Fix approach: store `last_pos` only when it passes the check `plant_item` already uses (10 ASCII
  digits). Also move line 2279 inside the `try` above it.
- Reproduction: `BadPositionBreaksDeaths`. The attack fails with
  `ValueError("invalid literal for int() with base 10: '12_'")`; the guard passes.

### F3: a suicide counts as a kill (Medium)
- Location: `bbh-server-hunter-fix_2.py:2163`. Class: persisted stats and leaderboard. OWASP
  A06:2025, CWE-841.
- Evidence chain:
  1. The killer lookup at `bbh-server-hunter-fix_2.py:2163` matches any player in the room whose slot
     equals the reported attacker, including the victim.
  2. The cheater sends `6<own id>00100`, then respawns with `8...`, and repeats.
  3. There is no `attacker != victim` check. Ranked rounds save kills through
     `commit_round_results`.
- Scenario: alone in a public room, a cheater saves thousands of kills per round to `users.db` and
  the Most Wanted list. A legitimate grenade suicide also scores a kill today.
- Fix approach: use `account_by_wire(room, raw_attacker)`, the helper used elsewhere, and credit
  only when it differs from the victim. This also fixes F7.
- Reproduction: `SelfKillCredit` (the attack fails, the guard passes).

### F4: crates can be taken while dead (Medium)
- Location: `bbh-server-hunter-fix_2.py:2406`. Class: game rules the server enforces. OWASP
  A06:2025, CWE-602.
- Evidence chain:
  1. The only check at `bbh-server-hunter-fix_2.py:2406` is whether the crate exists.
  2. A dead player sends `0m<index>` for the crates of their own death. Every death announcement
     lists the crate indexes, and a player can trigger their own death at will under the baseline.
  3. There is no check of `hp`, of who died, or of distance. `claimed_deaths` limits bounty points
     per death, not self-claims.
- Scenario: a cheater loops die-and-pick-up to create money and bounty points from nothing, which
  pushes real players down the Most Wanted list. They can also take every crate in the room the
  instant it appears.
- Fix approach: refuse `0m` while `hp <= 0`, and give no bounty points for crates of the picker's
  own death (`death_id` starts with their account id). Optionally compare `last_pos` with the
  crate's position.
- Reproduction: `CratePickupRules` (the attack fails, the guard passes).

### F5: anyone can destroy another player's barrel or barricade (Medium)
- Location: `bbh-server-hunter-fix_2.py:851`. Class: game rules the server enforces. OWASP A01:2025,
  CWE-285.
- Evidence chain:
  1. `damage_item` checks the owner only for C4 and mines (`bbh-server-hunter-fix_2.py:851`).
  2. Any player sends `o<index><any id><damage>`, for example `o0000299`.
  3. `docs/PROTOCOL.md` says only the owner reports deployable damage, and the client sends `o` only
     for its own items, capped at 99. The server enforces neither rule.
- Scenario: a cheater blows up any barrel next to other players, or removes the other team's
  barricades in Team Deathmatch, without firing a shot.
- Fix approach: require `placed[1:4] == wire_id(self.account_id)` for every kind and
  `1 <= damage <= 99`.
- Reproduction: `DeployableDamage` (the attack fails, the guard passes).

### F6: one player can take all 100 deployable slots (Medium)
- Location: `bbh-server-hunter-fix_2.py:830`. Class: game rules the server enforces. OWASP A06:2025,
  CWE-770.
- Evidence chain:
  1. The room's 100 slots are shared, and only C4 is limited per owner.
  2. A cheater sends `0q08`, then 100 pairs of a move to a new cell and `4000`.
  3. Ammo is counted only on the client.
- Scenario: a cheater covers a map with 100 mines or barricades. Every other player's placements
  are silently refused for the rest of the round.
- Fix approach: before allocating at `bbh-server-hunter-fix_2.py:830`, count the owner's items with
  the same scan as the C4 rule and refuse above a small cap.
- Reproduction: `DeployableSlots` (the attack fails, the guard passes).

## Low
- F7, the killer lookup iterates the shared `USERS` dict with no lock (OWASP A10:2025, CWE-362).
  - The loop is at `bbh-server-hunter-fix_2.py:2162`. A login or logout on another thread at that
    instant raises `RuntimeError`.
  - The death is counted, but the kill, the crates and the death announcement are lost.
  - Fix: the change for F3 removes the loop.
  - Reproduction: `KillerLookupRace` runs an interleaving test that adds a session during the
    iteration. The attack fails; the guard passes.

## Refused or unconfirmed candidates
- P8, the `2`/`3` relay at `bbh-server-hunter-fix_2.py:1948` stamps `self.account_id.zfill(3)`
  instead of the wire id: needs deeper review.
  - To decide, check whether any client sends `2`/`3` and whether an account id can equal another
    player's slot id. F1's fix narrows the impact either way.
- P9, a non-numeric attacker in `6` makes `int()` raise at `bbh-server-hunter-fix_2.py:2144`:
  refused, lens exploitability. The exception only skips the sender's own death handling.
- P10, rooms whose name starts with `INFECTED` get Infected rules (`bbh-server-hunter-fix_2.py:273`):
  refused, lens claim correctness.
  - It is a compatibility rule with the original servers.
  - It only makes the room unranked, so it cannot inflate stats.
- P11, the team-size check on `0k` and the join-capacity check on `03` are not under the room lock:
  refused, lens exploitability.
  - The window is microseconds and the effect is one extra player.
  - The team check runs only in team rooms, which are unranked.
- P12, a `6` hit is processed while in the lobby: needs deeper review. It is still open whether
  lobby kills and deaths can reach `users.db`; trace `stats` from the lobby into
  `commit_round_results`.
- P13, a lone player in a public FFA room is the winner of every round and the win is saved:
  decision pending, a product rule. Possible rule: no saved results for rounds with fewer than two
  players.
- Hits naming another victim, cross-room actions, picking up a crate twice, round-save races, C4
  and mine ownership, teammate hits, Infected side changes: refused, lens claim correctness.
  - `6` always damages the sender.
  - The room comes from the server's own record.
  - The crate `pop` runs under `CRATE_LOCK`.
  - The round snapshot is taken under the round lock and the save is idempotent per `round_id`.
  - The C4 and mine owner check is in `damage_item`.
  - Teammate hits are dropped.
  - Infected `0k` cannot change side.

## Coverage
- Read: every branch of the zone, by the reviewer and again at every cited line by the sweep owner.
- Also read, to confirm effects on other screens: the client handlers `Connection.js` and
  `GameScene.js`.
- Lenses applied: exploitability, claim correctness, existing mitigation.
- OWASP categories assessed for this zone: A01, A06, A08, A10.

## Hand-off
Proposals, not changes. One change per row, each shipping its reproduction test moved into
`tests/` plus the guard test:
1. F1: drop unknown packets instead of relaying them.
2. F2: validate `last_pos`, and move the `int()` at line 2279 inside the `try`.
3. F3 and F7: look up the killer with `account_by_wire` and refuse self-credit.
4. F4: no crates while dead, and no bounty points from the picker's own death.
5. F5 and F6: owner check and damage cap on `o`, and a per-owner deployable cap.

All of these change the game server, which must be restarted. The client is unchanged.
