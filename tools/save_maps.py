#!/usr/bin/env python3
"""Save every online bounty map into the game files.

    python tools/save_maps.py [--api URL] [--out client/assets/game]

Downloads the map list and each map (xgen.stickarena.maps.list / maps.get for
the BBHBOUNTYMAPS account, as BBHServer.py's /api/ gateway does) and writes
client/assets/game/maps/maps.json: [{"slot", "name", "data"}]. The game reads
that file first, so online rooms and their maps keep working without the old
map service. Run it again to pick up changed maps, then commit the file.

--api defaults to the XGen service itself; pass the bridge's gateway instead
(e.g. --api http://localhost:8081/api/) if that is the one your computer reaches.
"""
import argparse
import json
import os
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urlencode
from urllib.request import urlopen

ACCOUNT = 'BBHBOUNTYMAPS'
DEFAULT_API = 'http://api.xgenstudios.com/'


def request(api, **params):
    url = api + ('&' if '?' in api else '?') + urlencode({'username': ACCOUNT, **params})
    with urlopen(url, timeout=30) as response:
        rsp = ET.fromstring(response.read())
    if rsp.tag != 'rsp' or rsp.get('stat') != 'ok':
        raise RuntimeError(f"{params['method']}: the service said no ({ET.tostring(rsp)[:200]!r})")
    return rsp


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--api', default=DEFAULT_API, help='map service or the bridge gateway (default: %(default)s)')
    ap.add_argument('--out', default=os.path.join('client', 'assets', 'game'), help='the game assets folder')
    args = ap.parse_args()

    rsp = request(args.api, method='xgen.stickarena.maps.list')
    entries = []
    for node in rsp.iter('map'):
        slot = node.get('slot_id')
        if slot is None or not slot.isdigit():
            continue
        name = (node.findtext('name') or f'Map {slot}').strip()
        entries.append((int(slot), name))
    if not entries:
        sys.exit('The map list is empty.')

    maps = []
    for slot, name in sorted(entries):
        data = (request(args.api, method='xgen.stickarena.maps.get', slot_id=str(slot)).findtext('.//map/data') or '').strip()
        if not data:
            print(f'  {slot:3} {name}: no data, skipped')
            continue
        maps.append({'slot': slot, 'name': name, 'data': data})
        print(f'  {slot:3} {name}')

    folder = os.path.join(args.out, 'maps')
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, 'maps.json'), 'w', encoding='utf-8') as f:
        json.dump(maps, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'Saved {len(maps)} maps to {os.path.join(folder, "maps.json")}')


if __name__ == '__main__':
    main()
