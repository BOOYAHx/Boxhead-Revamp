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
| 1 | Offline: Warehouse map with the original graphics; walk around with the original speed, collisions and animations | **ready to test** |
| 2 | Connect through the bridge: log in, lobby, create/join rooms | next |
| 3 | Two players in a room see each other move | |
| 4 | Shooting, damage, death and respawn | |
| 5 | Bounty crates, score, round timer, chat | |
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
cd client
python3 -m http.server 8080
```

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
