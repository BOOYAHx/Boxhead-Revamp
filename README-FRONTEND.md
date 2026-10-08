# Boxhead Revamp — new website frontend

Website frontend for https://github.com/BOOYAHx/Boxhead-Revamp.

## Update from GitHub

After this change is published to your checkout's tracked branch, run
`git pull` from your existing Boxhead-Revamp folder and refresh the browser
with **Ctrl+F5**. Your current client server can keep running. No new package
installation or asset rebuild is needed for this frontend change.

The game is now at `play.html`, reached through **Play now** on the homepage.
Keep your existing Python game server and WebSocket bridge setup for online play.

## Optional local ZIP installation

1. Extract this ZIP into your **existing Boxhead-Revamp folder**, the folder
   containing `README.md`, `client/`, and `tools/`. Replace `client/index.html`
   when Windows asks. Do not extract it inside `client/`.
2. Double-click **Start-Website.cmd**, or run `python tools\serve.py` as before.
   Leave that terminal open. If the client server is already running, just
   refresh the browser instead of starting a second copy.
3. Visit **http://localhost:8080/** and press **Ctrl+F5** once.
4. **Play now** / **Enter the arena** opens the existing game at `play.html`.
   Choose **QUICKPLAY** in the game's menu for practice, or **LOGIN** for online play.

This is a frontend update, not a complete replacement game download.
Keep your existing `client/assets/game/`, `config.js`, game sources, and
Python server/bridge files. The public GitHub repository does not include the
generated game assets. If you start with a fresh clone, build those assets
using the repository's existing README before launching the game.

The homepage itself needs no new Python packages, npm install, or build step.
To preview just the homepage, you can also open `client/index.html` directly;
launching the game still requires the local HTTP server.

Online play uses the same game server and bridge setup as before. This update
does not start those services or change connection settings. Use the browser's
Back button to return from the game to the homepage.

## What changed

- **Logo:** Bond and Bambo from the Boxhead main menu art
  (`client/assets/site/hunters-logo.png`, cut out of its white background).
  It appears in the header, on the shutter badge and on the wanted poster.
  The favicon is Bambo's head.
- **Title:** the hero shows the Boxhead: Bounty Hunter title logo
  (`client/assets/site/boxhead-title.png`), cut out and recoloured for the dark
  page: BOXHEAD in off-white, BOUNTY HUNTER in red.
- **Lettering:** the main menu's look everywhere. The game's LOGIN /
  QUICKPLAY words are drawn art, not a font: heavy condensed capitals in grey
  stone with black chips and a dark glow. All text on the website and the
  game page copies that look:
  - Anton gives the letter shapes (the closest free match to them).
  - It is filled with `assets/site/stone-text.png`, a stone texture made to
    the menu art's colours (grey around #707070 with lighter mottling and
    black chips).
  - Paragraph-sized text uses `stone-text-soft.png` (fewer chips) so letters
    stay whole.
  - Highlighted words keep their red or gold in the same stone.
  - Red buttons, the WANTED tag, the wanted poster and the status stamps keep
    plain colours so they stay readable.
- **Boxhead after dark:** charcoal concrete, blood red and bounty gold, with
  hazard-tape dividers, crate cards in steel frames, keycap controls,
  case-file update cards with rubber stamps and a wanted poster.
- **Background:** `client/assets/site/arena-hero.webp` (and a small copy for
  phones) is a night fight in the warehouse, in the game's own top-down
  view. The hunters are the game's customization characters (SWAT, GI,
  Mummy, Ninja, Croft, the wanted Bond in a white tux, Devil with dual Uzis
  and a fallen Zombie). They are drawn from the built game sprites, so the
  picture contains original game art. The floor, crates, bounty crate, barrel
  explosion, gunfire and lighting are painted in code by
  `tools/site/hero-art.html`. To repaint it, build the game assets, run
  `python -m http.server 8000` in the repository folder, and open
  `http://localhost:8000/tools/site/hero-art.html`.
- **Game page (`client/play.html`, `css/play.css`):** the website's header,
  links back to its sections and hazard tape. The game sits in the silver
  boxhead.com window frame, with the BOXHEAD nameplate and Bond and Bambo
  leaning over it, on the darkened arena background. Underneath is a strip
  with the main keys and a Fullscreen button. The shutters lift when you
  arrive from the homepage. The game fits between the header and the strip
  at any window size.
- **Navigation animations:**
  - The page opens like a shutter lifting.
  - Section links sweep a three-stripe wipe across the screen and jump.
  - A red bar slides under the current section's link.
  - Sections slide in as they come into view, and the bounty counts up.
  - Every Play link slams steel shutters shut before the game loads. Coming
    back with the Back button lifts them again.
  - Also: a scroll progress bar, a header that shrinks, a slowly drifting
    hero picture with mouse and scroll parallax, and an animated phone menu.
- With "reduce motion" turned on in the system, navigation is instant. If the
  script fails to load, the opening shutter lifts by itself after 3 s.
- No packages or build step. The game is at `client/play.html`.

## Community navigation

The homepage and game-page header now link to **About the Game**, **What's
New**, **Updates**, **Feedback & Bugs**, and **Support a Creator**. These
replace The Game, Arsenal and How to Play in the website navigation. The
game page keeps its controls strip.

- **What's New** describes the HTML5/JavaScript/Phaser rebuild, smoother
  rendering, optional HD art, effects, gameplay, shop, customization, controls
  and multiplayer. Frame-rate improvements are not presented as a benchmark
  or a guaranteed FPS on every device.
- **Updates** requests the newest six commits on `boxhead-revamp` once when
  the page loads. It displays dates, patch descriptions and source links.
  Bundled notes remain available if GitHub is offline or rate-limits the
  request. Repository messages are inserted as text, not HTML. No API key,
  polling service or scheduled task is needed.
- **Support a Creator** opens the creator-provided PayPal link:
  `https://www.paypal.com/ncp/payment/K2EKZJYTSW5GA`.
- **Feedback & Bugs** has report type, summary, details, optional reproduction
  steps and browser/device fields. Delivery is configured in
  `client/src/site-config.js`. It is disabled until the creator supplies the
  destination; no reports are claimed to be received or stored locally.

Feedback configuration options:

```js
// Open the player's mail app; they review the draft and press Send there.
export const feedback = { mode: 'email', email: 'YOUR_EMAIL', endpoint: '' };

// Or a service endpoint that accepts a native HTML POST with the form fields
// type, title, details, steps and browser. The service confirms receipt.
export const feedback = { mode: 'form', email: '', endpoint: 'YOUR_HTTPS_ENDPOINT' };
```

The email option requires a configured mail app. The form option requires a
working form-service endpoint; services with custom field IDs need their own
mapping. Never put a private API key in this public configuration file.

No package install, asset rebuild or game-server changes are needed. Pull
the update and refresh with Ctrl+F5. Logic checks for delivery URLs and the
patch feed run with `node --test tests/community.test.mjs`. Live visual
preview was unavailable in this workspace (localhost timed out).

## Artwork

The font is Anton, distributed under the SIL Open Font License; its license is
included in `client/assets/site/ANTON-LICENSE.txt`.
