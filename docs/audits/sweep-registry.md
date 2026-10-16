# Sweep registry: what exists, what ran, what it is worth

Proposals for sweeps are written here, not in conversation. The `Last run` column is derived
from report filenames by the sweep's `sweep_status.py`; the other columns are written by hand.
Yield = confirmed / verified candidates.

## Candidates

| Zone | Argument | Last run | Yield |
|---|---|---|---|
| `server-accounts` | Login, register, sessions, moderation, chat and private messages in `bbh-server-hunter-fix_2.py`; any raw TCP client can reach them. | 2026-10-16 | 4/6 |
| `server-gameplay` | Rooms, combat packets, crates, deployables, rounds and persisted stats; the anti-cheat surface. | 2026-10-16 | 7/13 |
| `bridge-web` | `BBHServer.py`, `tools/host.py`, `tools/serve.py`, and how the client renders other players' text. | 2026-10-16 | 1/7 |

## Proposed, not yet run

| Zone | Argument | Premise to re-verify before starting |
|---|---|---|
| `server-network` | Bind address of the game server (`0.0.0.0:6123`), per-connection packet rate, lag-switch detection; seen during bridge-web. | The listen address in `main()` is still all interfaces. |

## Candidates verified and refused

Written here so they are not rediscovered. A refused candidate without a written reason comes back.

- server-accounts P5: registering a name listed in `MODERATOR_USERNAMES`. The list is empty as
  deployed (2026-10-16-server-accounts).
- server-accounts P6: moderators banning moderators; new accounts after a ban. Needs a moderator,
  and accounts are banned by design (2026-10-16-server-accounts).
- server-gameplay P9, P10, P11: a non-numeric attacker affects only the sender; `INFECTED...` room
  names only make the room unranked; the team-size and join races have a microsecond window
  (2026-10-16-server-gameplay).
- bridge-web P2-P7: `--public` origins, plain transport, root services, repository-root serving
  (production always passes `--bridge-only`), upstream HTTP data, XSS (all text is set with
  `textContent`) (2026-10-16-bridge-web).
