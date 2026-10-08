#!/usr/bin/env python3
"""Register upscaled art for "Enhanced Graphics".

tools/upscale_textures.py does all of this for you. To use another upscaler:

1. Upscale the PNG files in client/assets/game/sprites/ (sprite sheets) and
   client/assets/game/images/ (ground textures, health bar...) by 2, 3 or 4
   times, for example with Upscayl or Real-ESRGAN.
2. Save them under the same names in client/assets/game/sprites-hd/ and
   client/assets/game/images-hd/.
3. Run:  python tools/hd_sprites.py

The checker makes sure every file is exactly 2x, 3x or 4x its original,
puts back the transparency if the upscaler dropped it (taken from the
original, enlarged smoothly), leaves out files that don't look like their
original when shrunk back (some graphics drivers make the upscaler output
noise), and writes hd.json, which the game reads at start-up. Files that
are missing, the wrong size or broken keep the original art.
Run it again whenever you change the folders; delete them to go back to the
original art.

Requires Pillow (pip install pillow).
"""

import argparse
import json
import os

from PIL import Image

SCALES = (2, 3, 4)
MAX_COLOUR_DIFF = 25  # average colour difference (0-255) after shrinking back; good upscales are under 15
MAX_ALPHA_DIFF = 30  # the same for transparency, measured where either picture has something drawn
FOLDERS = (('sprites', 'sprites-hd'), ('images', 'images-hd'))


def difference(original, hd):
    """
    How far `hd`, shrunk back to the original's size, is from it: (colour, transparency), 0-255.
    Transparency is compared only where either picture has something drawn: outline sheets are
    mostly empty, and an upscale that lost all their lines would otherwise still look close.
    """
    small = hd.convert('RGBA').resize(original.size, Image.BOX)
    a, b = original.convert('RGBA'), small
    pa, pb = a.load(), b.load()
    colour = weight = alpha = 0.0
    w, h = original.size
    step = max(1, (w * h) // 40000)  # sample big images
    count = 0
    for i in range(0, w * h, step):
        x, y = i % w, i // w
        c1, c2 = pa[x, y], pb[x, y]
        k = max(c1[3], c2[3]) / 255
        colour += k * (abs(c1[0] - c2[0]) + abs(c1[1] - c2[1]) + abs(c1[2] - c2[2])) / 3
        weight += k
        if max(c1[3], c2[3]) > 8:
            alpha += abs(c1[3] - c2[3])
            count += 1
    return colour / max(weight, 1e-9), alpha / max(count, 1)


def looks_right(original, hd):
    colour, alpha = difference(original, hd)
    return colour <= MAX_COLOUR_DIFF and alpha <= MAX_ALPHA_DIFF


def register_folder(originals, hd_dir, log=print):
    """{name: scale} for the valid upscaled files in hd_dir."""
    registered = {}
    if not os.path.isdir(hd_dir):
        return registered
    for file in sorted(os.listdir(hd_dir)):
        if not file.lower().endswith('.png'):
            continue
        name = file[:-4]
        source = os.path.join(originals, file)
        if not os.path.exists(source):
            log(f'  {file}: not one of the game files, skipped')
            continue
        with Image.open(source) as original:
            original = original.convert('RGBA')
        path = os.path.join(hd_dir, file)
        with Image.open(path) as f:
            hd = f.copy()
        scale = hd.width / original.width
        if scale not in SCALES or hd.height != original.height * scale:
            log(f'  {file}: {hd.width}x{hd.height} is not 2x, 3x or 4x of {original.width}x{original.height}, skipped')
            continue
        scale = int(scale)
        if hd.mode != 'RGBA' or (hd.getextrema()[3][0] == 255 and original.getextrema()[3][0] < 255):
            # Upscalers often lose transparency: rebuild it from the original.
            alpha = original.getchannel('A').resize(hd.size, Image.LANCZOS)
            hd = hd.convert('RGB')
            hd.putalpha(alpha)
            hd.save(path, optimize=True)
            log(f'  {file}: transparency restored from the original')
        if not looks_right(original, hd):
            log(f'  {file}: does not look like the original (a broken upscale?), skipped')
            continue
        registered[name] = scale
    return registered


def register(game, log=print):
    """Check both folders and write hd.json: {"sprites": {...}, "images": {...}}."""
    result = {}
    for originals, hd in FOLDERS:
        found = register_folder(os.path.join(game, originals), os.path.join(game, hd), log)
        total = len([f for f in os.listdir(os.path.join(game, originals)) if f.endswith('.png')])
        log(f'{originals}: {len(found)} of {total} use the upscaled art (Enhanced Graphics on).')
        result[originals] = found
    with open(os.path.join(game, 'hd.json'), 'w') as f:
        json.dump(result, f, indent=1, sort_keys=True)
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', default=os.path.join('client', 'assets', 'game'), help='the built game assets')
    args = ap.parse_args()
    register(args.game)


if __name__ == '__main__':
    main()
