# Boxhead: Bounty Hunter network protocol

Reverse-engineered from the client (`MMOcha.server.MMOchaServer`,
`boxhead.game.Game` and the patch classes in the SWF) and the Python server.
The browser client in `client/src/net/Connection.js` implements it.

## Transport

The Flash client used an `XMLSocket`: every message is a UTF-8 string ending
in a NUL byte (`\0`). Browsers reach the game server through `BBHServer.py`,
which relays a WebSocket to the server's TCP port byte for byte. The client
splits the incoming stream on `\0` (one WebSocket frame may hold several
messages, or part of one) and appends `\0` to everything it sends.

Players are identified on the wire by a 3-digit **slot id** (`001`–`999`),
assigned at login. Names are 20 characters, left-padded with `#`.

## Login and accounts

| Client sends | Meaning |
| --- | --- |
| `0a<user>;<pass>` | create an account (patched client) → `Z1` ok / `Z0<error>` |
| `09<user>;<pass>` | log in |

Server replies to a login with `00;1`, then either `10;0;<error>` or
`10;1;<account>;<name>;<name>;<md5>;1` followed by the authenticate packet:

`A<id><name20><level1><gender1><headModel2><headColor2><bodyModel2><bodyColor2><kills>;<deaths>;<wins>;<losses>;<bounty><wanted1>`

Gender: `0` monster, `1` male, `2` female.

## Lobby and rooms

The lobby is the room named `_`.

| Client sends | Meaning |
| --- | --- |
| `03<room>` | join a room (`03_` = lobby) |
| `01` | request the room list |
| `04<room>` | request room info |
| `02<mode><custom><private><name>;<maps>[;L<lives>]` | create and join a room |
| `p` | request the round time |
| `0d0<headModel2><headColor2>`, `0d1<bodyModel2><bodyColor2>`, `0d2<gender>` | save customization |

`<mode>`: `A` free-for-all, `B` team deathmatch, `C` infected, `D` last
survivor. `<maps>` is one capital letter per map in the rotation
(`A` = index 0 of the bounty map list).

| Server sends | Meaning |
| --- | --- |
| `C<id>[<mode>]` | you (own id, with the room's mode) or a peer joined |
| `D<id>` | a peer left (own id: you were disconnected) |
| `U<id><payload>` | peer handshake: lobby stats, or game state in a game room (below) |
| `01<players2><name>;...` | room list (full and private rooms are hidden) |
| `04<mode><custom><mapLetter><players2><seconds>` | room info |
| `099` | join/create failed ("Game not found" / name in use) |
| `p<seconds>` | round time left |
| `s<crates>` | bounty crates already on the map |
| `0r<5 slot ids>` | round over: winner, hunter, professor, poacher, dummy |

Game handshake payload:
`<weapon2><hp3><name20><gender1><hm2><hc2><bm2><bc2><team1><score>;<kills>;<deaths>;<bounty>;[<weapon2><flags1>]...<wanted1>`

## In game

Positions are cells × 100, five digits per axis (`x5 y5`); a cell is
40 × 28 pixels. Directions are 0–7: S, SW, W, NW, N, NE, E, SE.

| Client sends | Relayed to peers as | Meaning |
| --- | --- | --- |
| `0k1` | `0k1` | map loaded; server resets your HP and sends placed deployables |
| `1<x5><y5><moveDir1><dir1><flags1>` | `M<id>1...` | movement: moveDir 0 = standing, else direction + 1; flag bit 0 = blocked |
| `4<angle3><param>` | `M<id>4...` | fired the current weapon at an angle in degrees |
| `6<attacker3><weapon2><damage2>` | — | **you** were hit (victim-side hit detection) |
| `8<cellX3><cellY3>` | `8<id><cell>` | respawned at a cell |
| `0q<weapon2>` | `M<id>0q<weapon2>` | switched weapon |
| `0m<crate3>` | `0m<id><crate3><bountyPoints>` | picked up a bounty crate |
| `9<encrypted>` | `M<id>9<encrypted>` | chat bundle (`c<text>;` chat, `a<index>;` deployable activation) |

Server-authoritative results:

| Server sends | Meaning |
| --- | --- |
| `M<id>6<hp3>` | player's new health |
| `M<id>7<killer3><weapon2><crates>` | player died; `<crates>` = 14-character crate entries |
| `n<owner3><kind1><index2><cellX3><cellY3>` | deployable placed |
| `o<index2><hp2>` | deployable damaged (`00` = destroyed) |

A crate entry is `<type1><index3><x5><y5>` (type 0 = $250, 1 = $500, 2 = $1000).

### Hit detection

Hits are decided by the victim. When `M<id>4<angle>` arrives, every client
replays that shot from the shooter's last reported position against its own
character (rewound by the shooter's ping), and if it is hit sends
`6<shooter><weapon><damage>`. The server owns health, kills and crates.

The rewind uses the shooter's ping, which every client measures to every
other player by sending the private chat message `?` (`00<id>9<encrypted ?>`)
and timing the `!` that comes back (average of the last three, one player
pinged per second, each at most every 10 seconds).

### Chat encryption

`9` messages are rotated: the first character `d` is a digit 1–9; the
receiver takes the rest `s` and returns `s.substr(len - d²mod len) +
s.substr(0, len - d²mod len)`. `9?<n>` pings bounce back as `M<id>9?<n>`.
