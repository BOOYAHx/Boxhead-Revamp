# Boxhead Revamp — new website frontend

Frontend update for https://github.com/BOOYAHx/Boxhead-Revamp, based on commit
`6c5d97c` (Free guns option, on by default).

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
- **Font:** Anton for all text. It is the closest free match to the heavy,
  condensed lettering of the game's main menu. Headings get the menu's
  scratched, worn look. The game's menu text is drawn artwork, not a font,
  so it can't be reused directly.
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
- No packages or build step. The game is still at `client/play.html`, unchanged.

## Artwork

The font is Anton, distributed under the SIL Open Font License; its license is
included in `client/assets/site/ANTON-LICENSE.txt`.
