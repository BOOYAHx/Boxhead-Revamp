#!/usr/bin/env python3
"""Register upscaled sprite sheets for "Enhanced Graphics".

1. Upscale the PNG files in client/assets/game/sprites/ by 2, 3 or 4 times,
   for example with an AI image upscaler such as Upscayl or Real-ESRGAN.
2. Save them under the same names in client/assets/game/sprites-hd/.
3. Run:  python tools/hd_sprites.py

The checker makes sure every sheet is exactly 2x, 3x or 4x its original,
puts back the transparency if the upscaler dropped it (taken from the
original, enlarged smoothly), and writes hd.json, which the game reads at
start-up. Sheets that are missing or the wrong size keep the
original art. Run it again whenever you change the folder; delete the
folder to go back to the original sprites.

Requires Pillow (pip install pillow).
"""

import argparse
import json
import os
import sys

from PIL import Image

SCALES = (2, 3, 4)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', default=os.path.join('client', 'assets', 'game'), help='the built game assets')
    args = ap.parse_args()
    originals = os.path.join(args.game, 'sprites')
    hd_dir = os.path.join(args.game, 'sprites-hd')
    if not os.path.isdir(hd_dir):
        with open(os.path.join(args.game, 'hd.json'), 'w') as f:
            json.dump({}, f)
        sys.exit(f'No {hd_dir} folder: put the upscaled sheets there first.')
    registered = {}
    for file in sorted(os.listdir(hd_dir)):
        if not file.lower().endswith('.png'):
            continue
        name = file[:-4]
        source = os.path.join(originals, file)
        if not os.path.exists(source):
            print(f'  {file}: not one of the game sheets, skipped')
            continue
        with Image.open(source) as original:
            original = original.convert('RGBA')
        path = os.path.join(hd_dir, file)
        with Image.open(path) as f:
            hd = f.copy()
        scale = hd.width / original.width
        if scale not in SCALES or hd.height != original.height * scale:
            print(f'  {file}: {hd.width}x{hd.height} is not 2x, 3x or 4x of {original.width}x{original.height}, skipped')
            continue
        scale = int(scale)
        if hd.mode != 'RGBA' or (hd.getextrema()[3][0] == 255 and original.getextrema()[3][0] < 255):
            # Upscalers often lose transparency: rebuild it from the original.
            alpha = original.getchannel('A').resize(hd.size, Image.LANCZOS)
            hd = hd.convert('RGB')
            hd.putalpha(alpha)
            hd.save(path, optimize=True)
            print(f'  {file}: transparency restored from the original')
        registered[name] = scale
    with open(os.path.join(args.game, 'hd.json'), 'w') as f:
        json.dump(registered, f, indent=1, sort_keys=True)
    total = len([f for f in os.listdir(originals) if f.endswith('.png')])
    print(f'{len(registered)} of {total} sheets will use the upscaled art (Enhanced Graphics on).')


if __name__ == '__main__':
    main()
