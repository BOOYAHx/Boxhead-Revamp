"""Serve the local game page and bridge Ruffle WebSockets to the test server."""
import argparse
import asyncio
import functools
import http.server
from http import HTTPStatus
from pathlib import Path
import socket
import sys
import threading
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.python-packages'))
try:
    from websockets.asyncio.server import serve
    from websockets.exceptions import ConnectionClosed
    from websockets.datastructures import Headers
    from websockets.http11 import Response
except ImportError:
    raise SystemExit('Missing bridge dependency. Run: python -m pip install --target .python-packages -r requirements.txt')


class WebsiteHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, format, *args):
        # Keep game account names and credentials out of launcher output.
        pass


class AssetGateway:
    """Forward only fixed public game resources, never account credentials."""
    def __init__(self, origins):
        self.origins = origins
        self.cache = {}

    def resource(self, path):
        parts = urlsplit(path)
        query = parse_qs(parts.query)
        if parts.path == '/api/':
            method = query.get('method', [''])[0]
            if method == 'xgen.items.list':
                url = 'http://api.xgenstudios.com/?method=xgen.items.list&game_id=boxhead'
            elif method == 'xgen.stickarena.maps.list':
                url = 'http://api.xgenstudios.com/?method=xgen.stickarena.maps.list&username=BBHBOUNTYMAPS'
            elif method == 'xgen.stickarena.maps.get':
                slot = query.get('slot_id', [''])[0]
                if not slot.isdigit() or not 0 <= int(slot) <= 199:
                    raise ValueError('Invalid map slot')
                url = 'http://api.xgenstudios.com/?' + urlencode({
                    'method': method, 'username': 'BBHBOUNTYMAPS', 'slot_id': slot})
            elif method == 'xgen.users.items.list':
                return b'<rsp stat="ok"><items/></rsp>', 'application/xml'
            elif method == 'xgen.users.authenticate':
                return b'<rsp stat="ok"><user><points>0</points></user></rsp>', 'application/xml'
            else:
                return b'<rsp stat="fail"><err msg="Unavailable on this local test website"/></rsp>', 'application/xml'
            mime = 'application/xml'
        elif parts.path in ('/assets/_assets/constants.xml', '/assets/_assets/assets.swf',
                            '/assets/mostwanted.xml'):
            url = 'http://138.197.53.66/' + parts.path.removeprefix('/assets/')
            mime = 'application/x-shockwave-flash' if parts.path.endswith('.swf') else 'application/xml'
        else:
            raise ValueError('Unknown resource')
        # Constants and rankings may change; cache the larger static resources.
        cacheable = 'constants.xml' not in url and 'mostwanted.xml' not in url
        if cacheable and url in self.cache:
            return self.cache[url], mime
        with urlopen(url, timeout=15) as upstream:
            data = upstream.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('Resource exceeds the game asset limit')
        if cacheable:
            self.cache[url] = data
        return data, mime

    async def request(self, connection, request):
        if request.headers.get('Upgrade', '').lower() == 'websocket':
            return None
        origin = request.headers.get('Origin')
        if origin and self.origins is not None and origin not in self.origins:
            return connection.respond(HTTPStatus.FORBIDDEN, 'Origin is not allowed')
        try:
            body, mime = await asyncio.to_thread(self.resource, request.path)
            status = HTTPStatus.OK
        except ValueError:
            status, body, mime = HTTPStatus.NOT_FOUND, b'Unknown game resource', 'text/plain'
        except OSError:
            print('[ASSETS] Could not load a game resource. Check your internet connection.', flush=True)
            status, body, mime = HTTPStatus.BAD_GATEWAY, b'Game resource could not be loaded', 'text/plain'
        headers = Headers({'Content-Type': mime, 'Content-Length': str(len(body)),
                           'Cache-Control': 'no-store', 'Connection': 'close'})
        if origin:
            headers['Access-Control-Allow-Origin'] = origin
            headers['Vary'] = 'Origin'
        return Response(status.value, status.phrase, headers, body)


async def relay(websocket, game_port):
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection('127.0.0.1', game_port), timeout=3)
    except (OSError, asyncio.TimeoutError):
        print(f'[BRIDGE] Cannot reach the test game server on port {game_port}. Start its Python file.', flush=True)
        await websocket.close(code=1011, reason='Test game server is not running')
        return

    print(f'[BRIDGE] Browser connected to the test game server on port {game_port}.', flush=True)

    async def browser_to_game():
        async for message in websocket:
            # Ruffle uses binary frames; accept UTF-8 text frames as well.
            writer.write(message.encode('utf-8') if isinstance(message, str) else message)
            await writer.drain()

    async def game_to_browser():
        while data := await reader.read(65536):
            await websocket.send(data)

    tasks = [asyncio.create_task(browser_to_game()), asyncio.create_task(game_to_browser())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (ConnectionClosed, ConnectionError, OSError):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass


async def run(args):
    if args.public:
        # Players' browsers come from the server's own address (or a domain name), so
        # any page may connect; the game server still asks every player to log in.
        host, origins = '0.0.0.0', None
    else:
        host, origins = '127.0.0.1', [f'http://127.0.0.1:{args.http_port}', f'http://localhost:{args.http_port}']
    assets = AssetGateway(origins)
    async with serve(functools.partial(relay, game_port=args.game_port),
                     host, args.bridge_port, origins=origins,
                     compression=None, max_size=1048576, close_timeout=2, open_timeout=45,
                     process_request=assets.request) as bridge:
        shown = "<this server's address>" if args.public else '127.0.0.1'
        print(f'[BRIDGE] ws://{shown}:{args.bridge_port}/ -> 127.0.0.1:{args.game_port}', flush=True)
        await bridge.serve_forever()


def port_number(value):
    number = int(value)
    if not 1 <= number <= 65535:
        raise argparse.ArgumentTypeError('Port must be between 1 and 65535')
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--http-port', type=port_number, default=8080)
    parser.add_argument('--bridge-port', type=port_number, default=8081)
    parser.add_argument('--game-port', type=port_number, default=6124)
    parser.add_argument('--bridge-only', action='store_true')
    parser.add_argument('--public', action='store_true',
                        help='accept players from other computers (an online server), not just this one')
    args = parser.parse_args()
    site_directory = ROOT / 'dist' if (ROOT / 'dist' / 'index.html').exists() else ROOT
    httpd = None
    try:
        if not args.bridge_only:
            handler = functools.partial(WebsiteHandler, directory=str(site_directory))
            try:
                httpd = http.server.ThreadingHTTPServer(('127.0.0.1', args.http_port), handler)
            except OSError:
                # Keep using the user's existing local website server.
                with socket.create_connection(('127.0.0.1', args.http_port), timeout=1):
                    print(f'[WEBSITE] Reusing the server already listening on port {args.http_port}.', flush=True)
            else:
                threading.Thread(target=httpd.serve_forever, daemon=True).start()
        if not args.bridge_only:
            print(f'[WEBSITE] Open http://127.0.0.1:{args.http_port}/ and keep this window open.', flush=True)
        print(f'[GAME] Your Python test game server must also be running on port {args.game_port}.', flush=True)
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print('\nWebsite bridge stopped.', flush=True)
    except OSError as error:
        raise SystemExit(f'Could not start the website bridge: {error}')
    finally:
        if httpd:
            httpd.shutdown()
            httpd.server_close()


if __name__ == '__main__':
    main()
