# Verified security sweep: server-accounts, 2026-10-16

## Context
Scope: authentication, accounts and moderation in `bbh-server-hunter-fix_2.py`. This covers the
moderator and ban helpers, `md5_hash`, user DB load and save, `SlotAllocator` and `wire_id`,
`remove_user`, `take_over_session`, `close_reserved_session`, `reject_banned_login` and
`handle_moderation`. In `_handle_packet` it covers the register `0a`, login `09`, `0g`/`0e`,
`0t`/`P`, chat `9`, `0d` and private message `00` branches, plus `handle()`.
Trigger: owner request (first security audit, ahead of anti-cheat work). OWASP Top 10:2025 review
combined with this sweep. First run: no previous reports. Commit read: `93d6304`.

## Delegation
One read-only reviewer (general-purpose agent, fresh context) for this zone. Its brief:
- Pre-read: `AGENTS.md`, `docs/PROTOCOL.md`, and the moderation and account sections of `README.md`.
- Scope: the functions and branches listed above.
- Threat model: a client connected directly to TCP 6123 or through the bridge, sending any raw packet.
- Rules: the severity calibration, the disqualifications, and at most ten findings.

There were no previous reports to cite. Verification, reproduction and this report were done by
the sweep owner.

## Verification
| Finding | Zone | Verdict | Claimed | Verified | Reservations | Proof |
|---|---|---|---|---|---|---|
| F1 no limit on failed logins | server-accounts | VERIFIED REAL | Medium | Medium | guessing still needs one round trip per try | `tests/audit/test_sweep_server_accounts.py` FailedLoginLimit, ran, fails as expected: 50 wrong passwords, then the right one is accepted |
| F2 passwords stored as unsalted MD5 | server-accounts | VERIFIED REAL | Medium | Medium | needs a copy of `users.db` first | PasswordStorage, ran, fails as expected: the stored value equals `md5(password)` |
| F3 login errors reveal which names exist | server-accounts | VERIFIED REAL | Low | Low | registration reveals taken names by design | LoginErrorsRevealAccounts, ran, fails as expected |
| F4 login reply carries the password hash | server-accounts | VERIFIED REAL | Low | Low | only the user's own hash; the server never accepts a hash as a password | LoginReplySendsHash, ran, fails as expected |
| P5 a name in `MODERATOR_USERNAMES` can be registered by anyone | server-accounts | FALSE POSITIVE | Low | - | lens: exploitability; the list is empty as deployed | `bbh-server-hunter-fix_2.py:75` |
| P6 moderators can ban moderators; ban evasion with a new account | server-accounts | OVER-RATED | Low | - | needs a moderator; account bans by design | `bbh-server-hunter-fix_2.py:1166` |

## Confirmed defects

### F1: no limit on failed logins (Medium)
- Location: `bbh-server-hunter-fix_2.py:1503`. Class: authentication. OWASP A07:2025, CWE-307.
- Evidence chain:
  1. The password comparison at `bbh-server-hunter-fix_2.py:1503` fails, the branch replies
     `10;0;Incorrect password` and returns.
  2. Any client, logged out, connected through the bridge or straight to TCP 6123, can send
     `09<name>;<guess>` again on the same connection.
  3. Nothing counts failures per account or per IP, and nothing delays or closes the connection.
- Scenario: a player who knows another player's name guesses short passwords (3–20 characters
  from 64 symbols) as fast as the connection allows, and logs in as them.
- Fix approach: keep a failure count per account and per IP with a growing delay and a temporary
  block. The timed expiry used for account bans (`active_account_ban`) is a fitting pattern.
  Close the connection after a few failures.
- Reproduction: `FailedLoginLimit.test_attack_many_wrong_passwords_then_the_right_one_is_still_accepted`
  fails on the current code. `test_guard_a_couple_of_typos_then_the_right_password_logs_in` passes.

### F2: passwords stored as unsalted MD5 (Medium)
- Location: `bbh-server-hunter-fix_2.py:381`. Class: credential storage. OWASP A04:2025, CWE-916.
- Evidence chain:
  1. `md5_hash` at `bbh-server-hunter-fix_2.py:381` is a single unsalted MD5.
  2. `save_user` stores it at registration, and login compares it.
  3. There is no salt and no slow hash.
- Scenario: if `users.db` ever leaks (a backup, a copy shared for help, a server compromise), most
  passwords are recovered in seconds. Players often reuse passwords elsewhere.
- Fix approach: store `hashlib.scrypt` or `pbkdf2_hmac` (standard library, no new dependency) with
  a per-user salt, as `scheme$salt$hash`. Accept the old MD5 at login and rewrite it then.
- Reproduction: `PasswordStorage.test_attack_the_stored_value_is_the_plain_md5_of_the_password`
  fails. `test_guard_the_registered_password_logs_in` passes.

## Low
- F3, login errors reveal which names exist (OWASP A07:2025, CWE-204).
  - `bbh-server-hunter-fix_2.py:1510` says "Account does not exist" and the wrong-password path
    says "Incorrect password".
  - Fix: use one message for both.
  - Reproduction: `LoginErrorsRevealAccounts` (the attack fails, the guard passes).
- F4, the login reply carries the stored password hash (OWASP A04:2025, CWE-200).
  - `bbh-server-hunter-fix_2.py:1558` puts `pwd_hash` in the `10;1;` reply.
  - That puts the at-rest secret on the wire and in client memory for no use.
  - Fix: send a constant in that field. The browser client does not use it; check the Flash
    client before changing it.
  - Reproduction: `LoginReplySendsHash`.

## Refused or unconfirmed candidates
- P5, registering a name listed in `MODERATOR_USERNAMES`: refused, lens exploitability.
  - The set at `bbh-server-hunter-fix_2.py:75` is empty in the code that is deployed by `git pull`.
  - The risk exists only if a host lists a name before creating that account. That is worth a line
    in the README; see the hand-off.
- P6, a moderator can ban another moderator, and a banned player can register again: refused, lens
  exploitability.
  - The first needs an actor who is already a moderator (the check at `bbh-server-hunter-fix_2.py:1166`
    stops only self-bans).
  - Bans apply to the account by design, and IP bans exist through `banlist.txt`.
  - Decision pending: whether new accounts should be limited per IP.
- Acting before login, changing identity after login, raw `0e`/`0g` from non-moderators, client-sent
  `0t`/`P`, delimiter characters in names, ban reasons, the bridge IP header, the session takeover
  race: refused, lens claim correctness. Each is checked in the code: the auth gate after the `09`
  branch, `account_is_moderator` on server data, the name allow-list `[A-Za-z0-9.,]`, parameterized
  SQL, the first-packet loopback check, and rechecking bans under `MODERATION_LOCK`.
- Private messages (`00` branch): needs deeper review. The sender id is stamped by the server, but
  how a reused slot id resolves its target was not traced end to end.

## Coverage
- Read: the zone's functions and branches, by the reviewer and again at every cited line by the
  sweep owner.
- Not read: `relay_chat9_to_room`, which belongs to the gameplay relay.
- Lenses applied: exploitability, claim correctness, existing mitigation.
- OWASP categories assessed for this zone: A01, A04, A07, A09 (partially), A10.

## Hand-off
Proposals, not changes:
- Fix F1 and F2 as one change to the login path:
  - a lockout with delay;
  - scrypt with upgrade on login;
  - one error message (F3);
  - no hash in the login reply (F4).

  Ship it with `tests/audit/test_sweep_server_accounts.py` moved into `tests/`, so it runs in the
  normal suite. The game server must be restarted after the change.
- README: note that a name added to `MODERATOR_USERNAMES` should already exist as an account (P5).
- Rules file: add one line to `AGENTS.md` pointing at `docs/audits/` for security reviews.
