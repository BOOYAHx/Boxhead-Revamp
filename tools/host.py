#!/usr/bin/env python3
"""Run everything the online game needs, and keep it running.

    python tools/host.py            (or double-click Start-Online.cmd)

Starts each service listed in host.json (made the first time, next to
README.md): the website (tools/serve.py --online) and, once you fill in their
folders, the game server and the bridge. Their output shows here, each line
marked with the service's name.

  * A service that stops by itself is started again.
  * After a `git pull` (Update.cmd) a service is restarted only when files it
    depends on changed ("restart_on" in host.json). Website changes need no
    restart at all: players get them on their next load, and the game offers
    a refresh to players already on the site.

Ctrl+C stops everything.
"""
import fnmatch
import json
import os
import signal
import subprocess
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, 'host.json')
POLL = 3  # seconds between checks
AS_SERVICE = bool(os.environ.get('INVOCATION_ID'))  # started by systemd
CRASH_LIMIT = 5  # crashes within CRASH_WINDOW seconds before a service is left stopped
CRASH_WINDOW = 60

DEFAULT_CONFIG = {
    'services': [
        {
            'name': 'website',
            'run': ['python', 'tools/serve.py', '--online', '--port', '8080'],
            'restart_on': ['tools/serve.py'],
        },
        {
            # In this repository: updates to it restart it (Update.cmd).
            'name': 'game server',
            'run': ['python', 'bbh-server-hunter-fix_2.py'],
            'restart_on': ['bbh-server-hunter-fix_2.py'],
        },
        {
            # Browsers talk to the game server through it; --public lets players on other computers in.
            'name': 'bridge',
            'run': ['python', 'BBHServer.py', '--bridge-only', '--public', '--game-port', '6123'],
            'restart_on': ['BBHServer.py'],
        },
    ]
}

print_lock = threading.Lock()


def say(name, text):
    with print_lock:
        print(f'{time.strftime("%H:%M:%S")} [{name}] {text}', flush=True)


def git(*args):
    try:
        run = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return run.stdout if run.returncode == 0 else None


def changed_files(old, new):
    out = git('diff', '--name-only', old, new)
    return [line.strip() for line in (out or '').splitlines() if line.strip()]


def matches(path, patterns):
    """Whether a changed repository file is one a service depends on (a file, folder or wildcard)."""
    for pattern in patterns:
        pattern = pattern.replace('\\', '/').strip('/')
        if fnmatch.fnmatch(path, pattern) or path.startswith(pattern + '/'):
            return True
    return False


class Service:
    def __init__(self, spec):
        self.name = spec['name']
        self.run = [sys.executable if part in ('python', 'python3') else part for part in spec['run']]
        cwd = spec.get('cwd') or ROOT
        self.cwd = cwd if os.path.isabs(cwd) else os.path.join(ROOT, cwd)
        self.restart_on = spec.get('restart_on', [])
        self.proc = None
        self.crashes = []
        self.given_up = False

    def start(self):
        if not os.path.isdir(self.cwd):
            say(self.name, f'folder not found: {self.cwd} (fix "cwd" in host.json)')
            self.given_up = True
            return
        env = {**os.environ, 'PYTHONUNBUFFERED': '1'}
        try:
            self.proc = subprocess.Popen(self.run, cwd=self.cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         stdin=subprocess.DEVNULL, text=True, errors='replace', bufsize=1)
        except OSError as error:
            say(self.name, f'could not start: {error}')
            self.given_up = True
            return
        say(self.name, 'started')
        proc = self.proc
        threading.Thread(target=self.echo, args=(proc,), daemon=True).start()

    def echo(self, proc):
        for line in proc.stdout:
            say(self.name, line.rstrip())

    def stop(self):
        proc, self.proc = self.proc, None
        if not proc or proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

    def restart(self, why):
        say(self.name, f'restarting: {why}')
        self.stop()
        self.given_up = False
        self.crashes = []
        self.start()

    def check(self):
        """Start it again if it stopped by itself (unless it keeps crashing)."""
        if self.given_up or not self.proc or self.proc.poll() is None:
            return
        code = self.proc.returncode
        now = time.monotonic()
        self.crashes = [t for t in self.crashes if now - t < CRASH_WINDOW] + [now]
        if len(self.crashes) >= CRASH_LIMIT:
            say(self.name, f'stopped {len(self.crashes)} times in a minute (last exit code {code}); leaving it off. Fix it and run Update.cmd or restart this window.')
            self.given_up = True
            return
        say(self.name, f'stopped (exit code {code}); starting it again')
        time.sleep(2)
        self.start()


def load_config():
    if not os.path.exists(CONFIG):
        with open(CONFIG, 'w') as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
            f.write('\n')
        print(f'Made {CONFIG}: the website, the game server and the bridge, all from this folder.')
        print('Edit it to change how they are started (a service with "enabled": false is left off).\n')
    with open(CONFIG) as f:
        config = json.load(f)
    return [Service(spec) for spec in config.get('services', []) if spec.get('enabled', True)]


def main():
    try:
        services = load_config()
    except (OSError, ValueError) as error:
        sys.exit(f'host.json could not be read: {error}')
    if not services:
        sys.exit('host.json lists no enabled services.')
    head = (git('rev-parse', 'HEAD') or '').strip()
    # As a service (tools/install_service.sh) systemd stops us with SIGTERM: stop the services too.
    signal.signal(signal.SIGTERM, signal.default_int_handler)  # like Ctrl+C
    for service in services:
        service.start()
    print('Running. Update.cmd (git pull) applies updates; Ctrl+C stops everything.\n', flush=True)
    try:
        while True:
            time.sleep(POLL)
            new = (git('rev-parse', 'HEAD') or '').strip()
            if head and new and new != head:
                time.sleep(2)  # let the pull finish writing
                new = (git('rev-parse', 'HEAD') or '').strip() or new
                files = changed_files(head, new)
                say('update', f'{head[:7]} -> {new[:7]}, {len(files)} files changed')
                if 'tools/host.py' in files:
                    if AS_SERVICE:
                        say('update', 'tools/host.py changed: restarting everything with the new version')
                        sys.exit(0)  # systemd starts us again (Restart=always)
                    say('update', 'tools/host.py changed: close this window and start it again to use the new version')
                for service in services:
                    hit = [f for f in files if matches(f, service.restart_on)]
                    if hit:
                        service.restart(f'{hit[0]} changed' + (f' (+{len(hit) - 1} more)' if len(hit) > 1 else ''))
                if not any(matches(f, s.restart_on) for s in services for f in files):
                    say('update', 'no restart needed; players get the new version on their next load')
            head = new or head
            for service in services:
                service.check()
    except KeyboardInterrupt:
        signal.signal(signal.SIGINT, signal.SIG_IGN)  # a second Ctrl+C must not cut the shutdown short
        print('\nStopping ...')
    finally:
        for service in services:
            service.stop()


if __name__ == '__main__':
    main()
