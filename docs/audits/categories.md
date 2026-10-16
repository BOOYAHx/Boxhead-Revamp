# Security categories verified by the sweeps

A list of categories, not patterns: a new pattern lands under an existing category. "Covered by"
names the control as it exists in this repository; "Mechanical" says whether a test enforces it
(a sentence in a README is not a guard). When text and guard diverge, the guard is right.

| Category | Covered by | Mechanical? |
|---|---|---|
| Authentication and sessions | login "09" / register "0a" in `bbh-server-hunter-fix_2.py`; one session per account (`take_over_session`) | partly (`tests/test_moderation.py`, `tests/test_player_ips.py`) |
| Credential storage | `password_hash` in `users.db` | no |
| Moderator privileges | `account_is_moderator`, `handle_moderation` (/warn, /ban) | yes (`tests/test_moderation.py`) |
| Player identity on the wire | 3-digit wire ids from `SlotAllocator`; the server stamps the sender id on relayed packets | no |
| Persisted stats and leaderboard | `commit_round_results`, `save_user`, `mostwanted.xml`; unranked rooms never change stats | partly (`tests/test_stats_sync.py`) |
| Game rules the server enforces | crates, deployables, lives, teams, Infected rules | partly (`tests/test_infected.py`) |
| Client-judged combat (baseline) | each client judges hits on itself, as in the original game; not a finding by itself | n/a |
| Input parsing of raw packets | per-branch parsing in `_handle_packet`; any packet can come from a raw TCP client | no |
| Shared state across connection threads | `room_round_lock`, `DEPLOYABLE_LOCK`, `MODERATION_LOCK` | partly |
| Bridge trust boundary | `@bridge-ip:` accepted only from a loopback peer; bridge origin allow-list unless `--public` | yes (`tests/test_player_ips.py`) |
| Output rendering in the browser | how names, chat, room and map names reach the DOM | no |
| Transport | plain HTTP / WS unless the host adds TLS | no |
| Logging and alerting | stdout logs, `login_ips.log`, moderation store | no |
