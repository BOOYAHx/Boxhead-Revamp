"""Serve the browser client for local testing, with caching disabled.

    python tools/serve.py            # http://localhost:8080/
    python tools/serve.py --port 8000

Unlike `python -m http.server`, every response carries Cache-Control:
no-store, so a reload always runs the newest game files.
"""
import argparse
import functools
import http.server
import os

CLIENT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'client')


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', type=int, default=8080)
    args = parser.parse_args()
    if not os.path.exists(os.path.join(CLIENT, 'assets', 'game', 'atlas.json')):
        print('Warning: client/assets/game is missing. Run tools/build_assets.py first (see README).')
    handler = functools.partial(NoCacheHandler, directory=CLIENT)
    with http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler) as server:
        print(f'Serving {CLIENT}')
        print(f'Open http://localhost:{args.port}/  (Ctrl+C to stop)')
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
