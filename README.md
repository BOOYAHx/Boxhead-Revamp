# Boxhead: Bounty Hunter — browser edition

A rewrite of the Flash game *Boxhead: Bounty Hunter* in HTML5/JavaScript with
[Phaser 3](https://docs.phaser.io/), so it runs in any modern browser without
Flash or Ruffle. The goal is that browser players connect to the **existing
Python game server unchanged**: the client speaks the original network protocol
through the existing WebSocket bridge (`BBHServer.py`).

## Progress

The port is built in small steps. Each one is tested before the next starts.

| Step | What you can test | Status |
| --- | --- | --- |
| 1 | Offline: Warehouse map with the original graphics; walk around with the original speed, collisions and animations | done |
| 2 | Connect through the bridge: log in, lobby, create/join rooms | done |
| 3 | Two players in a room see each other move | done |
| 4 | Shooting, damage, death and respawn (pistol) | **ready to test** |
| 5 | Bounty crates, score, round timer, chat | |
| 6 | Menus rebuilt to look like the original lobby (art extracted from the SWF) | |
| later | Shop and all weapons, deployables, team deathmatch / infected, customization screen, most wanted | |

## Repository layout

```
client/             the browser game (static files, no build step)
  index.html
  src/              ES modules: net/ (protocol), game/ (rules), render/, scenes/
  vendor/           phaser.min.js 3.90 (MIT)
  assets/game/      GENERATED from the SWFs, not committed (see below)
tools/              asset pipeline: SWF extractor, ActionScript decompiler, atlas baker
tests/              unit tests for the game rules and protocol helpers (node --test)
docs/PROTOCOL.md    the network protocol, as reverse-engineered from the client
```

## Building the game assets

Graphics, sounds and weapon stats are taken from the original files, which are
not stored in this repository because they are XGen Studios' copyrighted
material. You need:

* `BBH.swf` — the (patched) game SWF
* `assets.swf` and `constants.xml` — the files the game downloads from `/_assets/`

Then, with Python 3.9+ and Pillow (`pip install pillow`):

```sh
python3 tools/build_assets.py --bbh path/to/BBH.swf --assets path/to/assets.swf \
    --constants path/to/constants.xml
```

This writes `client/assets/game/` (about 13 MB): baked sprite sheets plus
`atlas.json` with every animation frame and draw offset, terrain textures,
143 sounds and `constants.xml`. Re-run it whenever the SWFs change.

## Testing step 1 (offline)

```sh
python3 tools/serve.py
```

(On Windows: `python tools\serve.py`.) It serves `client/` on port 8080 with
browser caching turned off, so a reload always runs the newest files.

Open <http://localhost:8080/>. You spawn at a random spawn point on Warehouse.

Controls (same defaults as the Flash game): **arrows / WASD** move, **Shift**
strafe (keep facing while moving). Test keys: **M** next character model,
**C** body colour, **H** head colour, **T** show hit boxes.

Things to check:

* Walls, crates, trees, cars and fences block you; you slide along walls.
* You walk behind things north of you and in front of things south of you.
* All 12 character models (press M) draw correctly in all 8 directions.
* Walking speed and animation feel like the original.

The Warehouse floor is a stand-in: only its obstacle layout ships inside the
SWF. From step 2 on, maps come from the map service through `BBHServer.py`,
exactly like the Flash client.

## Testing step 2 (online: login, lobby, rooms)

You need three windows (PowerShell on Windows), each left open:

1. **Game server**, in the folder with your server file:

   ```sh
   python bbh-server-hunter-fix_2.py
   ```

   It prints `[*] Listening on port 6123...`

2. **WebSocket bridge**, in the folder with `BBHServer.py`. Your game server
   listens on 6123 but the bridge defaults to 6124, so pass the port.
   `--bridge-only` leaves port 8080 free for the browser client:

   ```sh
   python BBHServer.py --bridge-only --game-port 6123
   ```

   It prints `[BRIDGE] ws://127.0.0.1:8081/ -> 127.0.0.1:6123`

3. **Browser client**, in this repository's folder:

   ```sh
   python tools/serve.py
   ```

Open <http://localhost:8080/> (the bridge only accepts pages from
`localhost:8080` or `127.0.0.1:8080`). Test in two browser windows (or one
normal and one private window) with two accounts:

* Create an account, log in; wrong passwords are refused.
* The lobby lists the players online and the open games; lobby chat reaches
  the other window (and Flash players in the lobby).
* Host a game, join it from the other window: both show `Players (2)` and the
  round timer. Esc goes back to the lobby.

### Troubleshooting

* **Old behaviour after downloading a new version:** use `tools/serve.py`
  (not `python -m http.server`, which lets the browser cache old files) and
  press Ctrl+F5 in each game window.
* **The other player is missing:** the player list in the top-left corner
  shows `(not seen yet)` next to anyone whose position hasn't arrived.
  Check that both windows show the same game name there.
* **Accounts:** they live in the game server's `users.db`. Use "Create
  account" on the login screen; the same account can't be logged in twice.

### Step 3: seeing each other move

Same setup as step 2. With two players in one game:

* Each player sees the other (yellow name) walk, turn, stop and get blocked
  by walls, and the positions match once they stop.
* Leaving the game (Esc) removes that player from the other screen.
* Movement uses the Flash client's packets, so a browser player and a
  Flash/Ruffle player in the same game should see each other too.

### Step 4: shooting, damage, death and respawn

Same setup as step 2. Nothing to rebuild: `git pull`, then Ctrl+F5 in both
game windows. Everyone has the pistol for now (other weapons come with the
shop). **Space** (or **J**) fires; hold it to keep firing every half second.

* Shooting shows a muzzle flash and a quick white tracer line and plays the
  pistol sound; the tracer stops at walls, crates and other tall objects.
* A hit takes 7 health: the victim flashes red, groans, bleeds on the floor
  and the health bar above their head shrinks (green, then orange below
  half, red below a quarter). Both windows show the same health.
* Walls stop bullets: hiding behind something tall keeps you safe.
* At zero health the player falls over, both windows show "X killed Y" at
  the top right, and the dead player sees "You will respawn in: 5…1".
* After 5 seconds the dead player comes back with full health at the spawn
  point farthest from the other player, and the other window sees them there.
* Offline practice lets you fire too (there is nobody to hit).

Hits are decided like in the Flash game: each player's own game checks
whether an enemy shot hit *them* (allowing for the shooter's lag) and tells
the server, so a browser player and a Flash player can shoot each other.

The map list comes from the map service through the bridge, like the Flash
client. If it can't be reached, the lobby says so and uses the bundled
Warehouse.

If the game server runs elsewhere, edit `client/config.js` (bridge and map
service addresses).

## Running the unit tests

```sh
node --test tests/*.test.mjs
```

## Deploying

The client is plain static files: copy `client/` (including the generated
`assets/game/`) to the website. Players get updates the next time they reload
the page. From step 2 the page also needs `BBHServer.py` (the WebSocket bridge
on port 8081) and the Python game server to be running.

## Tools

* `tools/build_assets.py` — the one-step asset build above.
* `tools/swf_extract.py` — extracts every named bitmap (PNG) and sound
  (MP3/WAV) from a SWF, including embedded SWFs.
* `tools/abc_decompile.py` — a small ActionScript 3 bytecode decompiler that
  prints AS3-like source per class (used by `build_assets.py`, and handy for
  porting more of the game logic).
* `tools/build_atlas.py` — turns the decompiled `boxhead.assets.Assets` frame
  tables into `atlas.json` and pre-combines colour + alpha sheets.
