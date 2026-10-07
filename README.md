# Boxhead: Bounty Hunter — browser edition

A rewrite of the Flash game *Boxhead: Bounty Hunter* in HTML5/JavaScript with
[Phaser 3](https://docs.phaser.io/), so it runs in any modern browser without
Flash or Ruffle. The goal is that browser players connect to the **existing
Python game server unchanged**: the client speaks the original network protocol
through the existing WebSocket bridge (`BBHServer.py`).

## Website and updates

Run `python tools/serve.py` as usual, or double-click `Start-Website.cmd`, then
open <http://localhost:8080/>. The homepage's **Play now** button opens the
existing game. You can also open <http://localhost:8080/play.html> directly.

Once an update is published to this repository, run this in your existing
Boxhead-Revamp checkout:

```sh
git pull
```

Then refresh the browser with **Ctrl+F5**. The static client server can keep
running. Your generated `client/assets/game/` files stay in place. Updates
that require new assets extracted from the original SWFs will explicitly say
when the asset build must be rerun. A fresh clone still needs the initial asset
build below.

## Progress

The port is built in small steps. Each one is tested before the next starts.

| Step | What you can test | Status |
| --- | --- | --- |
| 1 | Offline: Warehouse map with the original graphics; walk around with the original speed, collisions and animations | done |
| 2 | Connect through the bridge: log in, lobby, create/join rooms | done |
| 3 | Two players in a room see each other move | done |
| 4 | Shooting, damage, death and respawn (pistol) | done |
| 5 | Bounty crates, score, round timer, round summary, chat | done |
| 6 | Menus rebuilt to look like the original lobby (art extracted from the SWF) | done |
| 7 | Graphics: "Enhanced Graphics" (sharper picture, soft shadows, light and sparks) or "Classic" | done |
| 8 | The shop and every gun: Dual Uzis, Shotgun, Rifle, Flamer, AK47, Minigun, Magnum (ammo, upgrades, refunds, weapon switching) | **ready to test** |
| 9 | The in-game menu (Esc): options, quit (with "leave game?"), close | **ready to test** |
| 10 | Controls and weapon-bank setup (Options → configure controls / configure weapon banks), Auto Run and Spin keys | **ready to test** |
| 11 | High-resolution textures: every sprite and ground texture upscaled 4x by AI (one command) | **ready to test** |
| 12 | Grenades, Grenade Launcher, Plasma Cannon, C4, mines, airstrikes, barrels, barricades and spy satellite | **ready to playtest** |
| later | Turrets, team deathmatch / infected, customization screen | |

## Repository layout

```
client/             the browser game (static files, no build step)
  index.html
  src/              ES modules: net/ (protocol), game/ (rules), render/, scenes/, ui/ (menus)
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

Copy the three files into this repository's folder, then, with Python 3.9+,
Pillow and fontTools (`pip install pillow fonttools`):

```sh
python3 tools/build_assets.py --bbh BBH.swf --assets assets.swf --constants constants.xml
```

(On Windows: `python tools\build_assets.py --bbh BBH.swf --assets assets.swf
--constants constants.xml`.)

This writes `client/assets/game/` (about 15 MB): baked sprite sheets plus
`atlas.json` with every animation frame and draw offset, terrain textures,
143 sounds, `constants.xml`, and in `ui/` the menus' vector art, text fields
and fonts from the lobby SWF inside `BBH.swf`. Re-run it whenever the SWFs
change. Without fontTools the menus still build but use the computer's fonts.

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
* Host a game, join it from the other window. Esc, then quit, goes back to the lobby.

(Since step 6 these screens are the original menus, see below.)

### Troubleshooting

* **Old behaviour after downloading a new version:** use `tools/serve.py`
  (not `python -m http.server`, which lets the browser cache old files) and
  press Ctrl+F5 in each game window.
* **The other player is missing:** the player list in the top-left corner
  shows `(not seen yet)` next to anyone whose position hasn't arrived.
  Check that both windows show the same game name there.
* **Accounts:** they live in the game server's `users.db`. Use "Register"
  in the login box; the same account can't be logged in twice.

### Step 3: seeing each other move

Same setup as step 2. With two players in one game:

* Each player sees the other (yellow name) walk, turn, stop and get blocked
  by walls, and the positions match once they stop.
* Leaving the game (Esc, quit) removes that player from the other screen.
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
  the bottom left, and the dead player sees "You will respawn in: 5 seconds"
  counting down.
* After 5 seconds the dead player comes back with full health at the spawn
  point farthest from the other player, and the other window sees them there.
* Offline practice lets you fire too (there is nobody to hit).

Hits are decided like in the Flash game: each player's own game checks
whether an enemy shot hit *them* (allowing for the shooter's lag) and tells
the server, so a browser player and a Flash player can shoot each other.

### Step 5: bounty crates, score, rounds and chat

Same setup; `git pull`, then Ctrl+F5 in both windows. The screen now has the
original's layout: your money top right, your place ("1st", "2nd"…) top
centre, bounty points and the time left under the money, messages bottom left.

* Everyone starts the round with $10000. Killing a player drops bounty crates
  ($250 brown, $500 red, $1000 gold) that hop out of the body; walk over one
  to take it. The amount flies up to your money with a "ka-ching", and your
  score and place go up on both screens.
* Other players show their place ("1st"…) above their name. An arrow at the
  edge of the screen points to the best-placed other player when they are
  out of sight.
* Hold **Tab** for the scoreboard: the original "Scores" board, best first
  (ties keep the earlier player ahead), wanted players in red.
* Between rounds the original Game Summary shows the standings, the awards
  (Winner, Hunter, Dominator, Scrooge, Target Dummy) with each winner's
  portrait, and "Next Game begins in N seconds...".
* **Enter** opens the chat line, Enter sends, Esc cancels. The other window
  shows "Name: message" bottom left. Like the original: no ";" and no more
  than 3 messages in 2 seconds, and messages containing your password are
  not sent.
* When the time runs out (10 minutes on your server) the round freezes and
  the summary shows the Winner, The Hunter, The Professional, The Poacher and
  Target Dummy with the final standings. After 30 seconds the next round
  starts on the next map with everyone back at $10000; award winners get
  their award money ($5000 or $2000) on top.

The map list comes from the map service through the bridge, like the Flash
client. If it can't be reached, the lobby says so and uses the bundled
Warehouse.

If the game server runs elsewhere, edit `client/config.js` (bridge and map
service addresses).

### Step 6: the original menus

The menus are now drawn from the original art inside `BBH.swf`, so the asset
build has to run once more (it adds `client/assets/game/ui/`):

```sh
git pull
pip install fonttools
python tools/build_assets.py --bbh BBH.swf --assets assets.swf --constants constants.xml
```

Then Ctrl+F5 in both windows; the servers keep running. (Without the new
`ui/` folder the game falls back to the plain menus of steps 2–5.)

* **Main menu:** the backdrop and buttons fade in with the title music (click
  to skip). **LOGIN** → choose a server ("Squaresville") → **connect** → the
  login box. **Register** asks for the password twice and logs you straight
  in; "Remember me?" keeps your name for next time. Wrong passwords and
  unknown accounts are reported in red under the box; Cancel goes back.
* **QUICKPLAY** starts offline practice; Esc, then quit, returns to the main menu.
* **HOW TO PLAY:** four slides, click to go through them.
* **OPTIONS:** volume, shadows, blood, screen shake and Show FPS work in game
  and are remembered by the browser. Open shop on death, shell casings,
  smoke, footsteps and Auto Reload are saved for the features that need
  them; "configure controls" / "configure weapon banks" are greyed out for
  now.
* **Lobby:** chat (5 messages per 5 seconds), players online (you first), the
  game browser (click a game to see its mode, map, players and time left,
  then **Join** or double-click; it refreshes every 6 seconds), **Join
  Private** by name, **Host Game** (name, private, map list, FFA), **Join
  Random**, and **Exit** back to the main menu. Joining a game that is gone
  shows "Game not found"; hosting with a taken name shows "Room name already
  in use".
* **Most Wanted** tab: the top bounty hunters from the server's
  `mostwanted.xml`, with their character pictures.
* If the connection drops in the lobby it says "You have been disconnected"
  and logs back in by itself when the server is back. A drop during a game
  returns to the main menu and reconnects.
* "Customize Character" only shows a notice for now (it comes later).

`client/config.js` can also set the server name shown in the menus
(`serverName`) and where the Most Wanted list comes from (`mostWantedUrl`).

### Step 7: graphics

Rebuild the assets once more (it adds the original smoke and blood shapes,
`fx.json`), then Ctrl+F5:

```sh
git pull
python tools/build_assets.py --bbh BBH.swf --assets assets.swf --constants constants.xml
```

Options now has **Enhanced Graphics** (on by default; off by default on
computers that draw without a graphics card, where it would be slow).
Everyone still sees exactly the same 700x490 area of the map.

* **Classic** looks like the Flash game: drawn at 700x490 and stretched.
  New in both modes, from the original game: the smoke puff from the barrel
  (the Smoke option), ejected shell casings that stay on the floor (Shell
  Casings), the original blood splats, and shadows that no longer get darker
  where two overlap.
* **Enhanced** draws at a whole multiple (2x, 3x…) of the original at or above
  your screen's resolution: sharp text, health bars and lines, crisp sprite
  edges, smoother movement (half-pixel steps or finer), soft shadows, a warm
  light from muzzle flashes, glowing tracers, sparks and dust where bullets
  hit walls, and blood spray.

If the game feels slow, untick Enhanced Graphics.

**Higher-resolution art.** See step 11.

### Step 8: the shop and the guns

**Rebuild the assets first** (the build now also exports the flamer's fire and
the Minigun's sounds):

```
python tools/build_assets.py --bbh BBH.swf --assets assets.swf --constants constants.xml
```

- Each round starts in the shop with $10,000 (plus any award from the last
  round) and only the Pistol. Close it with **Enter Game**, **B** or **Esc** to
  spawn. Offline practice gives $1,000,000 so you can try everything.
- Buy guns, ammo packs or a full refill, and the two upgrades per gun. The
  **Refund** tab returns a gun (with its upgrades) within a minute of buying it.
- In game: **Q / E** previous / next weapon, **1-8** weapon banks, **R** (or
  Delete) buys ammo for the gun in hand, **B** or the Shop button opens the shop.
  The weapon bar at the top left shows the bank and the ammo left.
- After dying the shop opens by itself after 3 s ("Open shop on death"); you
  respawn when you close it. "Auto Reload" in Options refills a gun when it is
  down to its last round.
- Grenades, the Grenade Launcher, the Plasma Cannon and the equipment page are
  available. See Step 12 below for their controls.

### Step 9: the in-game menu

- **Esc** in a game opens the original menu: **options**, **quit** and
  **close**. The round carries on behind it (you stand still), like the
  original. Esc again, or close, puts it away.
- **options** is the same Options screen as the main menu; changes apply at once.
- **quit** asks "leave game?" first; quitting goes back to the lobby (or to the
  main menu from offline practice).
- Esc still closes the chat line or the shop first when one is open.

### Step 10: controls and weapon banks

- In **Options** (main menu or Esc menu), **configure controls** lists every
  action with two keys. Click a key, then press the new one (Esc, Enter and `
  cancel). A key taken from another action is removed there. **reset** puts the
  original keys back; **close** saves them in the browser.
- **configure weapon banks**: drag weapons between the eight banks (a bank
  takes at most three, like the original); higher in a list is picked first.
  **close** saves; the change applies straight away in a game.
- New keys from the original: **Auto Run** (Control or I: keep running while
  the direction keys only aim) and **Turn 180** (C or L). Offline practice's
  colour key moved from C to V.
- The shop and the Tab scoreboard follow your keys too.
- One fix to the original: its Controls screen put the next-weapon key on the
  "Previous Weapon" row; the rows now match what the keys do.

### Step 11: high-resolution textures

The original art is small bitmaps. One command makes 4x copies of every
sprite sheet (characters, weapons, props, effects) and ground texture with
the Real-ESRGAN AI upscaler:

```
python tools/upscale_textures.py
```

* It downloads Real-ESRGAN once (about 45 MB, into `tools/.realesrgan/`) and
  uses your graphics card (NVIDIA, AMD or Intel with Vulkan); it takes a few
  minutes. Then press Ctrl+F5 with **Enhanced Graphics** on in Options.
* The bigger your game window, the sharper it gets (up to 4x the original).
* Some graphics drivers make Real-ESRGAN output noise instead of a picture
  (in the game: striped, grainy blocks and grey boxes). Every file is now
  checked against its original and broken ones are left out; the tool then
  suggests `--tile 64`, `--model fast`, or `--cpu` (slow, an hour or more, but
  it always works). Already have broken files from before? Run
  `python tools/hd_sprites.py` and they are dropped.
* Sprites use the "anime" model (clean outlines); the ground uses the
  "photo" model, because the anime one smooths grass and gravel into flat
  colour. If you upscaled before this change and the floor looks blurry, run
  `python tools/upscale_textures.py --only images --redo`.
* `--model fast` is quicker and a little softer; `--model photo` is the
  realistic model. `--redo` upscales everything again (for example after
  trying another model).
* Run it again after rebuilding the assets; files already done are skipped.
  Delete `client/assets/game/sprites-hd/` and `images-hd/` to go back to the
  original art (or untick Enhanced Graphics).
* Rebuild the assets once more first: the build now also extracts the
  characters' shadows, which were missing (the original stores them in a way
  the extractor didn't read).
* Already have upscaled PNGs from another tool (e.g. Upscayl)? Put them in
  `sprites-hd/` and `images-hd/` with the same names and run
  `python tools/hd_sprites.py`.

## Running the unit tests

```sh
node --test tests/*.test.mjs
```

## Free guns

`client/config.js` has `freeGuns: true`: every gun, its ammo and its upgrades
cost nothing in the shop (it shows "Free"), so money only counts for the score.
Equipment keeps its price. Set it to `false` for the original prices. Each
player's page decides, so on a website set it in the uploaded `config.js`.

## Deploying

The client is plain static files: copy `client/` (including the generated
`assets/game/`) to the website. Players get updates the next time they reload
the page. From step 2 the page also needs `BBHServer.py` (the WebSocket bridge
on port 8081) and the Python game server to be running.

### Step 12: explosives and equipment

Update with `git pull`, then **Ctrl+F5**. This step adds no packages or asset
build: it uses the existing atlas/sounds and draws the new blast effects in
JavaScript. Prices, ammo, damage and upgrades still come from your local
`constants.xml`; free-guns mode applies to the launcher and plasma, while
equipment keeps its purchase prices.

Open **B → Equipment** to buy items; use **Q/E** or the number banks to select
them. The controls below refer to the fire binding (Space by default).

| Item | Default bank | Use |
| --- | --- | --- |
| Grenades / Grenade Launcher | 4 | Hold fire for distance, release to throw/fire. Grenades bounce and have a 1.5 s fuse; launcher rounds explode on impact. |
| Plasma Cannon | 3 | Hold fire. Moving bolts hit each target once and stop at walls. |
| C4 | 5 | Press fire to plant; press again to detonate, including when that was your last charge. |
| Mines | 5 | Fire to plant. Enemies trigger a one-second warning before the explosion. |
| Airstrikes | 5 | Hold and release fire to drop a beacon; the strike arrives after 2.5 s. |
| Barrels / Barricades | 6 | Fire to place in an empty cell. Walk out of the new object; it then blocks movement and bullets. Barrels explode and can chain together. |
| Spy Satellite | 8 | Press fire to enter/leave the camera; movement keys pan while your character stands still and remains vulnerable. |

Repeat a bank key to cycle its items. Changing weapons, opening a menu/shop,
typing chat, or leaving the window cancels a charged throw. Explosions have
distance falloff, respect static cover and can hurt you.

**Explosions** (`client/src/render/Explosions.js`) are laid out like the
original: grenades, launcher rounds, C4 and mines burst into a main fireball
with four smaller ones around it, a barrel throws out burning lumps, and an
airstrike sets off twelve spokes of blasts out to five cells. Each blast has a
white-hot flash that lights the floor, a shockwave ring and a skirt of dust, a
churning fireball that cools from white to orange to red and turns into thick
rising smoke, sparks, drifting embers, smoking (or burning) debris, and a
scorch mark left on the floor. Each kind has its own size, sound and shake: C4
is the biggest single blast, mines throw the most shrapnel, barrels burn
longest, and an airstrike shakes the screen for 1.5 s. With Enhanced Graphics
off they use half the particles; the smoke option turns off the smoke, and
screen shake follows its option.

Online placement waits for the server's `n` acknowledgement before consuming
ammo. This uses the existing `4`, `n`, `o`, `r`, and `a<index>;` protocol; no
backend is bundled or replaced. A server without deployable support will not
confirm placements. Turrets remain a later step because they are absent from
the current shop and require additional server support.

Validation: automated physics, collision, input, ammo, snapshot and scene
tests, including simulated two-client plasma hit reporting. Browser rendering
and a live room on your Python server still need a playtest. A useful first
check is to place a barricade, walk out, fire at it, then try C4 and mines with
a second player. Run the logic checks with `node --test tests/*.test.mjs`.

## Tools

* `tools/build_assets.py` — the one-step asset build above.
* `tools/swf_vector.py` — exports a SWF's vector shapes, sprites, buttons,
  text fields and fonts as SVG + JSON (the menus' art; `client/src/ui/flash.js`
  draws it back as a small Flash display list).
* `tools/upscale_textures.py` — makes 4x AI-upscaled copies of the sprites and ground textures (see step 11).
* `tools/hd_sprites.py` — checks and registers upscaled art (see step 11).
* `tools/swf_extract.py` — extracts every named bitmap (PNG) and sound
  (MP3/WAV) from a SWF, including embedded SWFs.
* `tools/abc_decompile.py` — a small ActionScript 3 bytecode decompiler that
  prints AS3-like source per class (used by `build_assets.py`, and handy for
  porting more of the game logic).
* `tools/build_atlas.py` — turns the decompiled `boxhead.assets.Assets` frame
  tables into `atlas.json` and pre-combines colour + alpha sheets.
