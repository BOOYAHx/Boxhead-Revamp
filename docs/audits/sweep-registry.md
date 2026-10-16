# Sweep registry: what exists, what ran, what it is worth

Proposals for sweeps are written here, not in conversation. The `Last run` column is derived
from report filenames by the sweep's `sweep_status.py`; the other columns are written by hand.
Yield = confirmed / verified candidates.

## Candidates

| Zone | Argument | Last run | Yield |
|---|---|---|---|
| `server-accounts` | Login, register, sessions, moderation, chat and private messages in `bbh-server-hunter-fix_2.py`; any raw TCP client can reach them. | | |
| `server-gameplay` | Rooms, combat packets, crates, deployables, rounds and persisted stats; the anti-cheat surface. | | |
| `bridge-web` | `BBHServer.py`, `tools/host.py`, `tools/serve.py`, and how the client renders other players' text. | | |

## Proposed, not yet run

| Zone | Argument | Premise to re-verify before starting |
|---|---|---|

## Candidates verified and refused

Written here so they are not rediscovered. A refused candidate without a written reason comes back.
