# Repository update workflow

- Before every update, fetch `origin`, identify its default branch, and review
  the latest relevant repository files and incoming changes. Do not use an
  older prototype or downloaded ZIP as the source of truth.
- The user wants updates delivered through this GitHub repository. Prepare
  changes for the branch their checkout tracks so `git pull` retrieves them.
  Follow applicable repository contribution and branch rules.
- Keep the normal update procedure to `git pull` and a browser refresh.
  Track new website assets and avoid adding an unnecessary package install or
  build step. The generated game assets in `client/assets/game/` are tracked
  (shared with the copyright holders' permission); rebuild them with
  `tools/build_assets.py` and commit the result. The AI-upscaled HD copies
  (`sprites-hd/`, `images-hd/`, `hd.json`) and the saved maps (`maps/`) are
  tracked too, but they are made on the user's computer (GPU upscaler, map
  service): never commit stand-ins for them from elsewhere.
- If an update genuinely requires rebuilding generated game assets or
  restarting a service, explain the specific requirement rather than claiming
  that `git pull` handles it automatically.
- Preserve existing game mechanics, connection settings, and generated assets
  during frontend changes unless the user requests changes to them.
- Use focused reads and checks to keep work efficient.
- Do not claim an update is available through `git pull` until its changes are
  actually published on the user's tracked branch. If GitHub access blocks
  publication, report that explicitly and keep the prepared work available.
