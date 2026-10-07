# Repository update workflow

- Before every update, fetch `origin`, identify its default branch, and review
  the latest relevant repository files and incoming changes. Do not use an
  older prototype or downloaded ZIP as the source of truth.
- The user wants updates delivered through this GitHub repository. Prepare
  changes for the branch their checkout tracks so `git pull` retrieves them.
  Follow applicable repository contribution and branch rules.
- Keep the normal update procedure to `git pull` and a browser refresh.
  Track new website assets and avoid adding an unnecessary package install or
  build step. Generated copyrighted game assets remain locally managed.
- If an update genuinely requires rebuilding generated game assets or
  restarting a service, explain the specific requirement rather than claiming
  that `git pull` handles it automatically.
- Preserve existing game mechanics, connection settings, and generated assets
  during frontend changes unless the user requests changes to them.
- Use focused reads and checks to keep work efficient.
- Do not claim an update is available through `git pull` until its changes are
  actually published on the user's tracked branch. If GitHub access blocks
  publication, report that explicitly and keep the prepared work available.
