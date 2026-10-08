"""Serve the browser client.

    python tools/serve.py                      # testing: http://localhost:8080/
    python tools/serve.py --port 8000
    python tools/serve.py --online             # for players: every network, port 8080

Testing (the default) only answers this computer, and every response carries
Cache-Control: no-store, so a reload always runs the newest game files.

--online answers other computers too, and lets browsers keep the files: they
ask each time whether a file changed (Cache-Control: no-cache) and only download
it again when it did, so the large HD textures come down once, while a
`git pull` here still reaches everyone on their next load.

Both modes answer /__version with an id of the client folder in git
(`git rev-parse HEAD:client`); the game checks it every few minutes and offers
players a refresh after an update.
"""
import argparse
import functools
import http.server
import json
import os
import subprocess
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIENT = os.path.join(ROOT, 'client')
VERSION_PATH = '/__version'


class Version:
    """The client folder's git tree id, looked up at most every few seconds."""

    def __init__(self, ttl=5):
        self.ttl = ttl
        self.value = None
        self.checked = 0
        self.lock = threading.Lock()

    def get(self):
        with self.lock:
            if time.monotonic() - self.checked > self.ttl:
                self.checked = time.monotonic()
                try:
                    run = subprocess.run(['git', 'rev-parse', 'HEAD:client'], cwd=ROOT, capture_output=True, text=True, timeout=10)
                    self.value = run.stdout.strip() if run.returncode == 0 else None
                except (OSError, subprocess.TimeoutExpired):
                    self.value = None
            return self.value


class ClientHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    cache = 'no-store'
    version = Version()

    def end_headers(self):
        self.send_header('Cache-Control', self.cache)
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == VERSION_PATH:
            return self.send_version()
        return super().do_GET()

    def send_version(self):
        version = self.version.get()
        if not version:
            return self.send_error(404, 'No version (not a git checkout)')
        body = json.dumps({'version': version}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.cache, cache = 'no-store', self.cache
        self.end_headers()
        self.cache = cache
        self.wfile.write(body)

    def log_message(self, format, *args):
        if not self.server.quiet:
            super().log_message(format, *args)


class OnlineHandler(ClientHandler):
    cache = 'no-cache'


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--online', action='store_true', help='serve players on other computers (see above)')
    args = parser.parse_args()
    if not os.path.exists(os.path.join(CLIENT, 'assets', 'game', 'atlas.json')):
        print('Warning: client/assets/game is missing. Run tools/build_assets.py first (see README).')
    handler = functools.partial(OnlineHandler if args.online else ClientHandler, directory=CLIENT)
    address = ('0.0.0.0' if args.online else '127.0.0.1', args.port)
    with http.server.ThreadingHTTPServer(address, handler) as server:
        server.quiet = args.online  # one line per file and player would bury everything else
        print(f'Serving {CLIENT}')
        if args.online:
            print(f'Online on port {args.port}: players open http://<this computer\'s address>:{args.port}/  (Ctrl+C to stop)')
        else:
            print(f'Open http://localhost:{args.port}/  (Ctrl+C to stop)')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
