#!/usr/bin/env python3
"""Export the original loading screen (MainFactory's preloader in BBH.swf).

    python tools/export_intro.py --bbh BBH.swf [--out client/assets/game]

Writes client/assets/game/intro/: the BBH.swf vector art, text fields and
fonts (swf_vector.py), which the game shows while it loads (ui/intro.js).
tools/build_assets.py does this too; this is the quick way to add just the
intro to assets built before it existed. Generated, not committed.

Requires Python 3.9+ and fontTools (pip install fonttools).
"""
import argparse
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import swf_vector  # noqa: E402


def export_intro(bbh_bytes, out):
    folder = os.path.join(out, 'intro')
    shutil.rmtree(folder, ignore_errors=True)
    library = swf_vector.export(bbh_bytes, folder, 'assets/game/intro/')
    if 'MainFactory_Preloader' not in library.classes:
        raise SystemExit('BBH.swf has no MainFactory_Preloader: is it the right file?')
    return library


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bbh', required=True, help='BBH.swf')
    ap.add_argument('--out', default=os.path.join('client', 'assets', 'game'), help='the built game assets')
    args = ap.parse_args()
    with open(args.bbh, 'rb') as f:
        export_intro(f.read(), args.out)
    print('Done:', os.path.join(args.out, 'intro'))


if __name__ == '__main__':
    main()
