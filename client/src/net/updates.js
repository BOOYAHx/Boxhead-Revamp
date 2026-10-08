// Tells players when the website has been updated (a `git pull` on the host),
// so they can refresh onto the new version. tools/serve.py answers __version
// with an id of the client folder's contents; other web servers answer 404 and
// the check simply stays quiet. Nobody is interrupted mid-match: the notice
// waits until the player is back in the menus or the lobby.

const URL = '__version';
const EVERY = 2 * 60 * 1000;
const BUSY = new Set(['game', 'offline', 'joining']); // App states where a refresh would cut a round short

export class UpdateWatcher {
  constructor({ url = URL, every = EVERY, fetch = globalThis.fetch?.bind(globalThis), busy = () => false, notify }) {
    this.url = url;
    this.every = every;
    this.fetch = fetch;
    this.busy = busy;
    this.notify = notify;
    this.version = null;
    this.pending = false;
    this.shown = false;
    this.timer = null;
  }

  async current() {
    try {
      const response = await this.fetch(this.url, { cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()).version || null;
    } catch {
      return null; // offline, or a web server without the check
    }
  }

  async start() {
    this.version = await this.current();
    if (!this.version) return false;
    this.timer = setInterval(() => this.tick(), this.every);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.tick();
    });
    return true;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.shown) return;
    if (!this.pending) {
      const version = await this.current();
      this.pending = Boolean(version && version !== this.version);
    }
    if (this.pending && !this.busy()) {
      this.shown = true;
      this.stop();
      this.notify();
    }
  }
}

/** The "new version" bar over the game, with its Refresh button. */
export function showUpdateBar(stage, reload = () => location.reload()) {
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'A new version of the game is available.';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh';
  refresh.addEventListener('click', () => reload());
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'update-later';
  later.textContent = 'Later';
  later.setAttribute('aria-label', 'Dismiss');
  later.addEventListener('click', () => bar.remove());
  bar.append(text, refresh, later);
  stage.appendChild(bar);
  return bar;
}

/** Watch for updates while `app` runs, showing the bar over `stage`. */
export function watchForUpdates(app, stage) {
  const watcher = new UpdateWatcher({
    busy: () => BUSY.has(app.state),
    notify: () => showUpdateBar(stage),
  });
  // While a notice waits for the round to end, look again every few seconds.
  const poll = setInterval(() => {
    if (watcher.shown) clearInterval(poll);
    else if (watcher.pending) watcher.tick();
  }, 3000);
  watcher.start();
  return watcher;
}
