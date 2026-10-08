#!/usr/bin/env python3
"""Hand-redrawn 4x art for "Enhanced Graphics".

An AI upscaler sharpens the original pixels; a person redrawing them at 4x
gives the best result. This tool prepares the pages to draw on and puts the
finished drawings in the game.

1. Make the drawing templates (here for the crates and trees):

       python tools/redrawn_art.py templates crates trees

   Groups: crates, trees, characters (all 12 costumes: 24 sheets of 336
   frames each), or any sprite sheet name from client/assets/game/sprites/
   (e.g. Crate1, Car1, NinjaBody). For each sheet, art/templates/ gets:

   * <Sheet>.png: the sheet enlarged 4x with hard pixels, the exact size and
     layout the game expects. Draw over it (keep the transparency around the
     drawing); --from-upscaled starts from the AI-upscaled copy instead.
   * <Sheet>.frames.png: the same with every frame's box outlined, as a guide
     layer. Keep each drawing inside its box; the game cuts the sheet there,
     and the feet / base must stay where they are.

2. Save the finished sheets, same name and size, in art/redrawn/ and run:

       python tools/redrawn_art.py apply

   That copies them into client/assets/game/sprites-hd/ and registers them
   (hd_sprites.py). tools/upscale_textures.py leaves them alone from then on.
   Press Ctrl+F5 with Enhanced Graphics on.

   Delete a file from art/redrawn/ and run tools/upscale_textures.py to go
   back to the AI-upscaled version of that sheet.

The templates contain the original game's art, so art/templates/ is not
tracked by git. Whether to commit art/redrawn/ is up to you.

Requires Pillow (pip install pillow).
"""

import argparse
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hd_sprites  # noqa: E402

SCALE = 4
GAME = os.path.join('client', 'assets', 'game')
TEMPLATES = os.path.join('art', 'templates')
REDRAWN = os.path.join('art', 'redrawn')
COSTUMES = ('Bond', 'Bambo', 'GI', 'Swat', 'Ninja', 'Devil', 'Zombie', 'Mummy', 'Cop', 'Bride', 'Croft', 'Vampire')
GROUPS = {
    'crates': ['Crate1', 'Crate2', 'BountyCrate', 'RedBountyCrate', 'GoldBountyCrate'],
    'trees': ['Tree1', 'Tree2'],
    'characters': [c + part for c in COSTUMES for part in ('Body', 'BodyCustom', 'Head', 'HeadCustom')],
}
GUIDE = (255, 0, 255, 255)


def sheets_for(names, atlas):
    """Sprite sheet names for groups, atlas entries or sheet names."""
    sheets = []
    for name in names:
        for entry in GROUPS.get(name, [name]):
            sheet = atlas[entry]['image'] if entry in atlas else entry
            if sheet not in sheets:
                sheets.append(sheet)
    return sheets


def frames_on(sheet, atlas):
    """Every frame rectangle (x, y, w, h, in original pixels) drawn from `sheet`."""
    return [tuple(f[:4]) for entry in atlas.values() if entry['image'] == sheet for f in entry['frames']]


def templates(game, names, from_upscaled):
    with open(os.path.join(game, 'atlas.json')) as f:
        atlas = json.load(f)
    os.makedirs(TEMPLATES, exist_ok=True)
    for sheet in sheets_for(names, atlas):
        source = os.path.join(game, 'sprites', sheet + '.png')
        if not os.path.exists(source):
            print(f'  {sheet}: no such sprite sheet, skipped')
            continue
        with Image.open(source) as f:
            original = f.convert('RGBA')
        size = (original.width * SCALE, original.height * SCALE)
        page = original.resize(size, Image.NEAREST)
        upscaled = os.path.join(game, 'sprites-hd', sheet + '.png')
        if from_upscaled and os.path.exists(upscaled):
            with Image.open(upscaled) as f:
                if f.size == size:
                    page = f.convert('RGBA')
        page.save(os.path.join(TEMPLATES, sheet + '.png'), optimize=True)
        guide = page.copy()
        draw = ImageDraw.Draw(guide)
        frames = frames_on(sheet, atlas)
        for x, y, w, h in frames:
            draw.rectangle([x * SCALE, y * SCALE, (x + w) * SCALE - 1, (y + h) * SCALE - 1], outline=GUIDE)
        guide.save(os.path.join(TEMPLATES, sheet + '.frames.png'), optimize=True)
        print(f'  {sheet}: {size[0]}x{size[1]}, {len(frames)} frame(s)')
    print(f'Templates are in {TEMPLATES}/. Save the redrawn sheets in {REDRAWN}/, then run: python tools/redrawn_art.py apply')


def apply(game):
    hd_dir = os.path.join(game, 'sprites-hd')
    os.makedirs(hd_dir, exist_ok=True)
    record = hd_sprites.load_record(hd_dir)
    done = 0
    for file in sorted(os.listdir(REDRAWN)) if os.path.isdir(REDRAWN) else []:
        if not file.endswith('.png') or file.endswith('.frames.png'):
            continue
        name = file[:-4]
        source = os.path.join(game, 'sprites', file)
        if not os.path.exists(source):
            print(f'  {file}: not one of the game\'s sprite sheets, skipped')
            continue
        with Image.open(source) as original, Image.open(os.path.join(REDRAWN, file)) as drawn:
            if drawn.size != (original.width * SCALE, original.height * SCALE):
                print(f'  {file}: {drawn.width}x{drawn.height}, but it must be {original.width * SCALE}x{original.height * SCALE} (4x), skipped')
                continue
            if drawn.mode != 'RGBA':
                print(f'  {file}: has no transparency (save it as a PNG with transparency), skipped')
                continue
        shutil.copyfile(os.path.join(REDRAWN, file), os.path.join(hd_dir, file))
        record[name] = hd_sprites.REDRAWN
        done += 1
    # Sheets taken out of art/redrawn/ go back to being upscaled.
    for name in [n for n, model in record.items() if model == hd_sprites.REDRAWN]:
        if not os.path.exists(os.path.join(REDRAWN, name + '.png')):
            record.pop(name)
            path = os.path.join(hd_dir, name + '.png')
            if os.path.exists(path):
                os.remove(path)
            print(f'  {name}: no longer redrawn; run tools/upscale_textures.py to upscale it again')
    hd_sprites.save_record(hd_dir, record)
    print(f'{done} redrawn sheet(s) in place.')
    hd_sprites.register(game)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', default=GAME, help='the built game assets')
    sub = ap.add_subparsers(dest='command', required=True)
    t = sub.add_parser('templates', help='make 4x drawing templates')
    t.add_argument('names', nargs='+', help='crates, trees, characters, or sprite sheet names')
    t.add_argument('--from-upscaled', action='store_true', help='start from the AI-upscaled copy where there is one')
    sub.add_parser('apply', help='put the redrawn sheets in the game')
    args = ap.parse_args()
    if args.command == 'templates':
        templates(args.game, args.names, args.from_upscaled)
    else:
        apply(args.game)


if __name__ == '__main__':
    main()
