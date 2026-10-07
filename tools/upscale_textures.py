#!/usr/bin/env python3
"""Make high-resolution copies of the game's art with an AI upscaler.

    python tools/upscale_textures.py

Downloads Real-ESRGAN (the portable "ncnn-vulkan" build, about 45 MB, once,
into tools/.realesrgan/), enlarges every sprite sheet and ground texture of
client/assets/game/ 4 times, and registers them (tools/hd_sprites.py). The
game uses them when "Enhanced Graphics" is on in Options; press Ctrl+F5.

It uses the graphics card (any card with Vulkan: NVIDIA, AMD or Intel), and
takes a few minutes. Run it again after rebuilding the assets; files already
done are skipped (--redo does them all again). Delete
client/assets/game/sprites-hd/ and images-hd/ to go back to the original art.

Models (--model):
  anime  realesrgan-x4plus-anime: sharp, clean outlines (default; suits the cartoon art)
  fast   realesr-animevideov3: much faster, a little softer
  photo  realesrgan-x4plus: for photographic detail

Requires Pillow (pip install pillow).
"""

import argparse
import io
import os
import platform
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hd_sprites  # noqa: E402

RELEASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-{}.zip'
PLATFORMS = {'Windows': 'windows', 'Linux': 'ubuntu', 'Darwin': 'macos'}
MODELS = {'anime': 'realesrgan-x4plus-anime', 'fast': 'realesr-animevideov3', 'photo': 'realesrgan-x4plus'}
SCALE = 4
MAX_SIDE = 4096  # bigger textures don't load on every graphics card
PAD = 8  # pixels of the pattern wrapped around ground textures so their edges still tile
NOT_TILES = ('GUI_', 'HealthBar', 'WeaponSlider', 'Ghostface')  # images that are not repeating patterns


def find_upscaler(cache):
    """The Real-ESRGAN executable, downloaded the first time."""
    exe = 'realesrgan-ncnn-vulkan' + ('.exe' if platform.system() == 'Windows' else '')
    for root, _, files in os.walk(cache):
        if exe in files:
            return os.path.join(root, exe)
    name = PLATFORMS.get(platform.system())
    if not name:
        sys.exit(f'No Real-ESRGAN download for {platform.system()}; use --upscaler with your own copy.')
    url = RELEASE.format(name)
    print(f'Downloading Real-ESRGAN ({url}) ...')
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    os.makedirs(cache, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(cache)
    for root, _, files in os.walk(cache):
        if exe in files:
            path = os.path.join(root, exe)
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            return path
    sys.exit('The Real-ESRGAN download did not contain ' + exe)


def is_tile(name):
    return not name.startswith(NOT_TILES)


def prepare(src_dir, names, work, wrap):
    """Copy the files to upscale; ground textures get their pattern wrapped around them."""
    pads = {}
    for name in names:
        with Image.open(os.path.join(src_dir, name + '.png')) as f:
            img = f.convert('RGBA')
        pad = PAD if wrap and is_tile(name) else 0
        if pad:
            w, h = img.size
            tiled = Image.new('RGBA', (w * 3, h * 3))
            for i in range(3):
                for j in range(3):
                    tiled.paste(img, (i * w, j * h))
            img = tiled.crop((w - pad, h - pad, 2 * w + pad, 2 * h + pad))
        img.save(os.path.join(work, name + '.png'))
        pads[name] = pad
    return pads


def finish(name, out_dir, dest_dir, pad, original_size):
    """Crop off the wrapped border, keep under MAX_SIDE, save into the -hd folder."""
    with Image.open(os.path.join(out_dir, name + '.png')) as f:
        img = f.convert('RGBA')
    if pad:
        img = img.crop((pad * SCALE, pad * SCALE, img.width - pad * SCALE, img.height - pad * SCALE))
    w, h = original_size
    scale = SCALE
    while scale > 2 and max(w, h) * scale > MAX_SIDE:
        scale -= 1
    if max(w, h) * scale > MAX_SIDE:
        return None  # too big even at 2x: keep the original
    if img.size != (w * scale, h * scale):
        img = img.resize((w * scale, h * scale), Image.LANCZOS)
    img.save(os.path.join(dest_dir, name + '.png'), optimize=True)
    return scale


def upscale_folder(exe, model, game, src, dest, redo, gpu):
    src_dir = os.path.join(game, src)
    dest_dir = os.path.join(game, dest)
    os.makedirs(dest_dir, exist_ok=True)
    names = []
    sizes = {}
    for file in sorted(os.listdir(src_dir)):
        if not file.endswith('.png'):
            continue
        name = file[:-4]
        with Image.open(os.path.join(src_dir, file)) as f:
            sizes[name] = f.size
        done = os.path.join(dest_dir, file)
        if not redo and os.path.exists(done):
            with Image.open(done) as f:
                if f.width % sizes[name][0] == 0 and f.width // sizes[name][0] in (2, 3, 4):
                    continue
        names.append(name)
    if not names:
        print(f'{src}: everything already upscaled (use --redo to do it again).')
        return
    total = sum(sizes[n][0] * sizes[n][1] for n in names)
    print(f'{src}: upscaling {len(names)} files ({total / 1e6:.1f} million pixels) with {model} ...')
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, 'in')
        out = os.path.join(tmp, 'out')
        os.makedirs(work)
        os.makedirs(out)
        pads = prepare(src_dir, names, work, wrap=src == 'images')
        cmd = [exe, '-i', work, '-o', out, '-n', model, '-s', str(SCALE), '-f', 'png', '-m', os.path.join(os.path.dirname(exe), 'models')]
        if gpu is not None:
            cmd += ['-g', str(gpu)]
        result = subprocess.run(cmd, cwd=os.path.dirname(exe))
        if result.returncode != 0:
            sys.exit('Real-ESRGAN failed. Is the graphics driver up to date? (--gpu picks another card, --model fast uses less memory)')
        for name in names:
            if not os.path.exists(os.path.join(out, name + '.png')):
                print(f'  {name}: not upscaled, keeping the original')
                continue
            if finish(name, out, dest_dir, pads[name], sizes[name]) is None:
                print(f'  {name}: too large to enlarge, keeping the original')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', default=os.path.join('client', 'assets', 'game'), help='the built game assets')
    ap.add_argument('--model', choices=sorted(MODELS), default='anime')
    ap.add_argument('--only', choices=['sprites', 'images'], help='just one of the two folders')
    ap.add_argument('--redo', action='store_true', help='upscale everything again')
    ap.add_argument('--gpu', type=int, help='graphics card number, if you have several')
    ap.add_argument('--upscaler', help='path to an existing realesrgan-ncnn-vulkan executable')
    args = ap.parse_args()
    if not os.path.isdir(os.path.join(args.game, 'sprites')):
        sys.exit(f'{args.game} has no sprites: build the assets first (tools/build_assets.py).')
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.realesrgan')
    exe = args.upscaler or find_upscaler(cache)
    for src, dest in hd_sprites.FOLDERS:
        if args.only and args.only != src:
            continue
        upscale_folder(exe, MODELS[args.model], args.game, src, dest, args.redo, args.gpu)
    hd_sprites.register(args.game)
    print('Done. Turn on "Enhanced Graphics" in Options and press Ctrl+F5 in the game.')


if __name__ == '__main__':
    main()
