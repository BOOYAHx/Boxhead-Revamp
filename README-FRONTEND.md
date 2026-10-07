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

- Dark indigo header with Boxhead branding and cyan navigation accents.
- Full-width illustrated warehouse hero, condensed typography, and Play CTA.
- Game overview, default keyboard controls, and current development roadmap.
- Mobile navigation with Escape-to-close, keyboard focus styles, and reduced-motion support.
- Self-hosted display font and optimized WebP hero (about 171 KB), with no
  external font, analytics, or website script dependencies.
- `client/play.html` preserves the repository's original game entry page.

The game engine, game CSS, original menus, mechanics, accounts, weapon prices,
network protocol, and configuration are unchanged.

## Validation

Checked local asset references, section anchors, unique IDs, script syntax,
the Play links, and preservation of the original game entry page and files.
Live browser layout verification was unavailable: the preview browser reached
an existing game server on port 8080 instead of this checkout.

## Artwork

The new promotional backdrop is a website asset only; it does not replace
any in-game graphics. It was created with the built-in imagegen tool and
optimized to `client/assets/site/warehouse-hero.webp`.
The complete generation prompt is recorded in `FRONTEND-ARTWORK-PROMPT.txt`.
The display font is Bebas Neue, distributed under the SIL Open Font License;
its license is included in `client/assets/site/FONT-LICENSE.txt`.
