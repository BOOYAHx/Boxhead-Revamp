"""Build every browser asset from the original Flash files in one step.

    python3 tools/build_assets.py --bbh BBH.swf --assets assets.swf \
        --constants constants.xml [--out client/assets/game]

Produces (all generated, not committed):
    images/*.png      terrain textures and UI bitmaps from BBH.swf
    sprites/*.png     baked sprite sheets (see build_atlas.py)
    atlas.json        frame rectangles and offsets for every sprite
    sounds/*.mp3      every game sound
    constants.xml     weapon and health tuning, read by the game at startup

Requires Python 3.9+ and Pillow.
"""
import argparse
import json
import os
import shutil
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import abc_decompile  # noqa: E402
import build_atlas  # noqa: E402
import swf_extract  # noqa: E402


def find_abc(swf_bytes, class_name):
    """Return the DoABC payload that defines `class_name`."""
    for code, body in swf_extract.read_swf(swf_bytes):
        if code != 82:
            continue
        name_end = body.index(b'\0', 4)
        abc = abc_decompile.Abc(body[name_end + 1:])
        for inst in abc.instances:
            if abc.qn(inst['name'], full=True) == class_name:
                return abc
    raise SystemExit(f'{class_name} not found in the SWF')


def decompile_class(abc, class_name, out_dir):
    abc_decompile.dump(abc, out_dir)
    return os.path.join(out_dir, *class_name.split('.')) + '.as'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bbh', required=True, help='the game SWF (BBH.swf)')
    ap.add_argument('--assets', required=True, help='assets.swf served from /_assets/')
    ap.add_argument('--constants', required=True, help='constants.xml served from /_assets/')
    ap.add_argument('--out', default=os.path.join('client', 'assets', 'game'))
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, 'raw')
        manifest = {'images': {}, 'sounds': {}}
        with open(args.bbh, 'rb') as f:
            bbh = f.read()
        with open(args.assets, 'rb') as f:
            assets = f.read()

        print('Extracting BBH.swf')
        swf_extract.extract(bbh, raw, manifest)
        game_images = set(manifest['images'])
        print('Extracting assets.swf')
        swf_extract.extract(assets, raw, manifest)

        print('Decompiling boxhead.assets.Assets')
        assets_as = decompile_class(find_abc(bbh, 'boxhead.assets.Assets'), 'boxhead.assets.Assets',
                                    os.path.join(tmp, 'as3'))

        if os.path.isdir(args.out):
            for sub in ('images', 'sprites', 'sounds'):
                shutil.rmtree(os.path.join(args.out, sub), ignore_errors=True)
        os.makedirs(os.path.join(args.out, 'images'), exist_ok=True)

        print('Baking sprite atlas')
        sys.argv = ['build_atlas', '--assets-as', assets_as, '--images', os.path.join(raw, 'images'), '--out', args.out]
        build_atlas.main()

        for name in sorted(game_images):
            shutil.copy(os.path.join(raw, 'images', name + '.png'), os.path.join(args.out, 'images', name + '.png'))
        shutil.copytree(os.path.join(raw, 'sounds'), os.path.join(args.out, 'sounds'))
        shutil.copy(args.constants, os.path.join(args.out, 'constants.xml'))
        with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
            json.dump({'images': sorted(game_images), 'sounds': manifest['sounds']}, f, indent=1)
    print('Done:', args.out)


if __name__ == '__main__':
    main()
