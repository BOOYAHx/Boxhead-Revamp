---
status: resolved
trigger: |
  Okay i wanna rewrite the /ban command because it is not working using GSD Skill
  -i want when a user receives a ban he can't log in with any account unless the period of the ban is over
created: 2026-10-19
updated: 2026-10-19
---

## Symptoms

- Expected: moderator-only timed bans block the target account and alternate accounts on the same connection until expiry.
- Actual: the user reports no visible effect and the browser's moderation reply timeout.
- Error: "The game server did not answer. Restart it (boxhead-restart) and try again" (client notice, not a captured backend exception).
- Timeline: not provided.
- Reproduction: issue `/ban name minutes reason`; exercise the real server handlers with isolated account storage and sockets.

## Current Focus

- Hypothesis: confirmed account-only enforcement, missing session IP, and delayed acknowledgement during slow cleanup. A stale deployed backend remains another possible cause of the reported live timeout, not verified against the host.
- Next action: publish the verified change to the tracked branch; restart the live backend after pulling it.
- Execution: GSD debug workflow runs inline, without subagents.
- Source: BOOYAHx/Boxhead-Revamp, branch boxhead-revamp, commit 347a3886159e86cc7e7163c0f14d6f9b6bf7e7d1.

## Evidence

- `account_bans` persists account IDs only. Existing tests explicitly allow another account after a ban.
- Login validates account bans twice under MODERATION_LOCK, but the admitted session contains no `player_ip`.
- The bridge forwards the network peer IP as first-packet metadata. The backend accepts that metadata only from a loopback bridge and only before the first browser packet.
- `handle_moderation` commits a ban, sends to the target, closes its session/room state, and only then acknowledges the moderator.
- The client's moderation timeout is 5 seconds; backend socket sends can wait up to 10 seconds each.

## Resolution

- Root cause: only account IDs were persisted as bans, admitted sessions did not retain the trusted client IP, and moderator confirmation followed potentially slow disconnect cleanup.
- Fix: persist account and IP bans atomically, retain the authenticated connection's IP, check both bans before login/session takeover, disconnect existing sessions sharing that IP, reject further packets from closing sessions, and confirm persistence before cleanup. IPv6 and IPv4-mapped IPv6 addresses are canonicalized. Invalid/local proxy addresses reject the command explicitly. Existing account-ban databases migrate without losing records; shorter bans cannot shorten an active IP ban.
- Red: 3 new regression tests failed on the unchanged backend (alternate-account admission, missing session IP, delayed confirmation).
- Green: 29 moderation, 13 bridge/IP, 8 round-stat and 9 client moderation tests passed (59 focused checks).
- Additional audit: the account-security sweep has 4 passes and 4 failures. The same 4 failures were reproduced against the unchanged source at the base commit: password storage, login reply contents, distinguishable login errors, and missing failed-login limiting. These are pre-existing and outside this ban change.
- Files changed: bbh-server-hunter-fix_2.py, tests/test_moderation.py, README.md, docs/PROTOCOL.md, this GSD debug record.
- Limits: an IP ban affects other people sharing the public IP and cannot identify alternate accounts on a different network/VPN. The named account remains banned across IP changes. Existing account-only bans remain account-only. The live deployment was not accessed or restarted; the host must load the published backend before live acceptance testing.
