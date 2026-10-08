#!/usr/bin/env python3
"""Make high-resolution copies of the game's art with an AI upscaler.

    python tools/upscale_textures.py

Downloads Real-ESRGAN (the portable "ncnn-vulkan" build, about 45 MB, once,
into tools/.realesrgan/), enlarges every sprite sheet and ground texture of
client/assets/game/ 4 times, and registers them (tools/hd_sprites.py). The
game uses them when "Enhanced Graphics" is on in Options; press Ctrl+F5.

It uses the graphics card (any card with Vulkan: NVIDIA, AMD or Intel), and
takes a few minutes. Every result is checked against its original; some
graphics drivers make Real-ESRGAN output noise, and those files are left out
(try --tile 64, another --gpu, or --cpu, which is slow).
Files go through in small batches, and large sheets (the character bodies) in
pieces that are joined again afterwards, so no single job runs long. If the
graphics driver crashes ("vkQueueSubmit failed -4"), Real-ESRGAN is stopped,
the driver gets time to restart and the lost files are tried again one at a
time; finished pieces are kept (tools/.realesrgan/pieces/), so running it
again carries on where it stopped. Files of a few pixels and shadows (the game
blurs those and draws them at their original size) are left as they are.

Run it again after rebuilding the assets; files already done with the same
model are skipped (--redo does them all again; a different model redoes them by
itself). Delete client/assets/game/sprites-hd/ and images-hd/ to go back to the
original art.

Models (--model for the sprites, --ground-model for the ground textures):
  ultrasharp  4x-UltraSharp: sharp and faithful, keeps the shading, wood grain
              and leaves (default for sprites)
  photo       realesrgan-x4plus: natural texture detail (default for the ground)
  anime       realesrgan-x4plus-anime: very clean, but flattens fine detail and
              paints a yellow edge where faces meet collars
  hifi        High Fidelity: like ultrasharp, a little softer
  remacri     Remacri: the most texture, can look noisy
  ultramix    UltraMix Balanced: between remacri and ultrasharp
  fast        realesr-animevideov3: much faster, softer
The last four and ultrasharp come from Upscayl (github.com/upscayl/upscayl) and
are downloaded the first time they are used. 4x-UltraSharp, Remacri and UltraMix
are by Kim2091 and Foolhardy under CC BY-NC-SA 4.0: free for this non-commercial
fan project, not for selling.

    python tools/upscale_textures.py --compare

upscales a few samples (two characters, a car, a crate, a tree, grass, tiles)
with every model and saves them side by side in tools/.realesrgan/compare.png,
so you can pick with your own eyes before upscaling everything.

Requires Pillow (pip install pillow).
"""

import argparse
import hashlib
import io
import json
import os
import platform
import queue
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import zipfile

from PIL import Image, ImageChops

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hd_sprites  # noqa: E402

RELEASE = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-{}.zip'
PLATFORMS = {'Windows': 'windows', 'Linux': 'ubuntu', 'Darwin': 'macos'}
MODELS = {
    'ultrasharp': 'ultrasharp-4x',
    'photo': 'realesrgan-x4plus',
    'anime': 'realesrgan-x4plus-anime',
    'hifi': 'high-fidelity-4x',
    'remacri': 'remacri-4x',
    'ultramix': 'ultramix-balanced-4x',
    'fast': 'realesr-animevideov3',
}
EXTRA_MODELS = 'https://raw.githubusercontent.com/upscayl/upscayl/main/resources/models/{}'  # not in the Real-ESRGAN zip
RECORD = '.models.json'  # in each -hd folder: which model made each file
DEFAULT_MODEL = {'sprites': 'ultrasharp', 'images': 'photo'}
EARLIER_DEFAULT = {'sprites': 'anime', 'images': 'photo'}  # what made files from before the record existed
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


def ensure_model(exe, model):
    """Model files next to the executable, downloading Upscayl's ones the first time."""
    folder = os.path.join(os.path.dirname(exe), 'models')
    for ext in ('param', 'bin'):
        path = os.path.join(folder, f'{model}.{ext}')
        if os.path.exists(path) or model.startswith('realesr'):
            continue
        print(f'Downloading the {model} model ...')
        os.makedirs(folder, exist_ok=True)
        with urllib.request.urlopen(EXTRA_MODELS.format(f'{model}.{ext}'), timeout=300) as response:
            data = response.read()
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)


def run_upscaler(exe, model, src, dest, gpu, tile):
    """Real-ESRGAN over every PNG of `src` into `dest`; False if it failed."""
    ensure_model(exe, model)
    os.makedirs(dest, exist_ok=True)  # Real-ESRGAN only writes into an existing folder
    cmd = [exe, '-i', src, '-o', dest, '-n', model, '-s', str(SCALE), '-f', 'png', '-m', os.path.join(os.path.dirname(exe), 'models')]
    if gpu is not None:
        cmd += ['-g', str(gpu)]
    if tile:
        cmd += ['-t', str(tile)]
    return watch(subprocess.Popen(cmd, cwd=os.path.dirname(exe), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, errors='replace', bufsize=1), STALL_CPU if gpu == -1 else STALL)


STALL = 120  # seconds without a word from Real-ESRGAN on a graphics card before it counts as stuck
STALL_CPU = 600
DEVICE_LOST = re.compile(r'failed -4\b|device lost', re.I)
device_losses = [0]  # graphics driver crashes so far this run


def watch(proc, stall):
    """
    Echo Real-ESRGAN's output and wait for it. After a graphics driver crash
    ("vkQueueSubmit failed -4") it often never exits, so it is stopped then, or
    when it goes quiet for `stall` seconds. False if it failed or was stopped.
    """
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout] + [lines.put(None)], daemon=True).start()
    lost = False
    while True:
        try:
            line = lines.get(timeout=stall)
        except queue.Empty:
            print(f'  Real-ESRGAN stopped answering for {stall} s; stopping it')
            break
        if line is None:
            proc.wait()
            if lost:
                device_losses[0] += 1
            return proc.returncode == 0 and not lost
        print(line, end='' if line.endswith('\n') else '\n', flush=True)
        if DEVICE_LOST.search(line) and not lost:
            lost = True
            stall = min(stall, 10)  # give it a moment to exit by itself
    if lost:
        device_losses[0] += 1
    proc.kill()
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        print('  (it will not close; carrying on without it)')
    return False


BATCH = 12  # files per Real-ESRGAN run
RETRY_TILES = (64, 32)  # piece sizes for files that failed in a batch
# Large sheets go in pieces, so one job never runs long (graphics drivers crash on
# long jobs) and a crash only loses one piece. Finished pieces are kept between runs.
PIECES_CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.realesrgan', 'pieces')
PIECES_ABOVE = 256  # sheets wider or taller than this (original pixels) are done in pieces
PIECE = 128  # about this many original pixels a side
PIECE_CONTEXT = 8  # pixels of the neighbouring pieces each piece sees, cut off when they are joined
# Not worth upscaling: the AI cannot add anything to a few pixels (and cannot be
# judged on them), and the game blurs shadows and draws them at their original size.
MIN_SIDE = 12


def worth_upscaling(name, size):
    return min(size) >= MIN_SIDE and 'Shadow' not in name


def piece_boxes(w, h):
    """[(piece, outer box, inner box)]: the inner boxes cover the w x h sheet; each outer one adds the context."""
    cols, rows = -(-w // PIECE), -(-h // PIECE)
    xs = [round(i * w / cols) for i in range(cols + 1)]
    ys = [round(j * h / rows) for j in range(rows + 1)]
    boxes = []
    for j in range(rows):
        for i in range(cols):
            inner = (xs[i], ys[j], xs[i + 1], ys[j + 1])
            outer = (max(0, inner[0] - PIECE_CONTEXT), max(0, inner[1] - PIECE_CONTEXT), min(w, inner[2] + PIECE_CONTEXT), min(h, inner[3] + PIECE_CONTEXT))
            boxes.append((f'{i}_{j}', outer, inner))
    return boxes


def join_pieces(size, boxes, piece_file):
    """The upscaled sheet from its upscaled pieces (piece_file(piece) -> path)."""
    w, h = size
    sheet = Image.new('RGBA', (w * SCALE, h * SCALE))
    for piece, outer, inner in boxes:
        with Image.open(piece_file(piece)) as f:
            img = f.convert('RGBA')
        want = ((outer[2] - outer[0]) * SCALE, (outer[3] - outer[1]) * SCALE)
        if img.size != want:
            img = img.resize(want, Image.LANCZOS)
        x, y = (inner[0] - outer[0]) * SCALE, (inner[1] - outer[1]) * SCALE
        part = img.crop((x, y, x + (inner[2] - inner[0]) * SCALE, y + (inner[3] - inner[1]) * SCALE))
        sheet.paste(part, (inner[0] * SCALE, inner[1] * SCALE))
    return sheet


RECOVER = 20  # seconds to let Windows restart the graphics driver after a crash
ROUNDS = 4  # passes over files that keep failing before they are left for the next run

# Graphics cards Real-ESRGAN lists as "[1 NVIDIA GeForce RTX 4060 Laptop GPU]  queueC=...".
DEVICE_LINE = re.compile(r'^\[(\d+) ([^\]]+)\]')
DEDICATED = re.compile(r'nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a', re.I)


def pick_gpu(exe, model):
    """
    The dedicated graphics card when there are several. Real-ESRGAN takes card 0
    by default, which on many laptops is the weak built-in chip (and that one often
    turns out noise). Returns the card number, or None to leave the choice to it.
    """
    ensure_model(exe, model)
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, 'probe.png')
        Image.new('RGBA', (8, 8), (128, 128, 128, 255)).save(src)
        cmd = [exe, '-i', src, '-o', os.path.join(tmp, 'out.png'), '-n', model, '-s', str(SCALE), '-m', os.path.join(os.path.dirname(exe), 'models')]
        try:
            run = subprocess.run(cmd, cwd=os.path.dirname(exe), capture_output=True, text=True, errors='replace', timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            return None
    cards = {}
    for line in (run.stderr + run.stdout).splitlines():
        m = DEVICE_LINE.match(line.strip())
        if m:
            cards[int(m.group(1))] = m.group(2).strip()
    if len(cards) < 2:
        return None
    for number, name in sorted(cards.items()):
        if DEDICATED.search(name):
            print(f'Using graphics card {number}: {name} (--gpu picks another)')
            return number
    return None


def load_record(dest_dir):
    try:
        with open(os.path.join(dest_dir, RECORD)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_record(dest_dir, record):
    with open(os.path.join(dest_dir, RECORD), 'w') as f:
        json.dump(record, f, indent=1, sort_keys=True)


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


def upscale_folder(exe, model, game, src, dest, redo, gpu, tile):
    """Upscale one folder with `model` (a MODELS key); returns (files done, files that came out broken)."""
    src_dir = os.path.join(game, src)
    dest_dir = os.path.join(game, dest)
    os.makedirs(dest_dir, exist_ok=True)
    record = load_record(dest_dir)
    names = []
    sizes = {}
    for file in sorted(os.listdir(src_dir)):
        if not file.endswith('.png'):
            continue
        name = file[:-4]
        with Image.open(os.path.join(src_dir, file)) as f:
            sizes[name] = f.size
        done = os.path.join(dest_dir, file)
        if record.get(name) == hd_sprites.REDRAWN and os.path.exists(done):
            continue  # redrawn by hand (tools/redrawn_art.py)
        # Skip files already done well with this model, unless the asset build has replaced the original since.
        same_model = record.get(name, EARLIER_DEFAULT[src]) == model
        if not redo and same_model and os.path.exists(done) and os.path.getmtime(done) >= os.path.getmtime(os.path.join(src_dir, file)):
            with Image.open(done) as f, Image.open(os.path.join(src_dir, file)) as original:
                if f.width % sizes[name][0] == 0 and f.width // sizes[name][0] in (2, 3, 4) and hd_sprites.looks_right(original, f):
                    continue
        names.append(name)
    skipped = [n for n in names if not worth_upscaling(n, sizes[n])]
    names = [n for n in names if worth_upscaling(n, sizes[n])]
    if skipped:
        print(f'{src}: {len(skipped)} files stay as they are (too small to gain anything, or shadows, which the game blurs anyway).')
    if not names:
        print(f'{src}: everything worth upscaling is done (use --redo to do it again).')
        return 0, []
    total = sum(sizes[n][0] * sizes[n][1] for n in names)
    print(f'{src}: upscaling {len(names)} files ({total / 1e6:.1f} million pixels) with {model} ...')
    if model in ('ultrasharp', 'photo', 'hifi', 'remacri', 'ultramix'):
        print('  (a large model: on a graphics card a few minutes, with --cpu much longer)')
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, 'in')
        os.makedirs(work)
        pads = prepare(src_dir, names, work, wrap=src == 'images')
        runs = [0]

        # Large sheets in pieces (see PIECES_ABOVE), kept in pieces_dir until their sheet is done.
        pieces_dir = os.path.join(PIECES_CACHE, src, model)
        os.makedirs(pieces_dir, exist_ok=True)
        in_pieces = {}  # sheet -> [(piece, outer, inner)]
        piece_of = {}  # unit -> (sheet, cached file)
        units = []
        for name in names:
            if pads[name] or max(sizes[name]) <= PIECES_ABOVE:
                units.append(name)
                continue
            in_pieces[name] = piece_boxes(*sizes[name])
            with Image.open(os.path.join(work, name + '.png')) as f:
                sheet = f.convert('RGBA')
            for piece, outer, _ in in_pieces[name]:
                unit = f'{name}~{piece}'
                img = sheet.crop(outer)
                img.save(os.path.join(work, unit + '.png'))
                with open(os.path.join(work, unit + '.png'), 'rb') as f:
                    key = hashlib.md5(f.read()).hexdigest()[:10]  # a changed original makes new pieces
                piece_of[unit] = (name, os.path.join(pieces_dir, f'{unit}~{key}.png'))
                if not os.path.exists(piece_of[unit][1]):
                    units.append(unit)
        if in_pieces:
            print(f'  {len(in_pieces)} large sheets go in {sum(len(b) for b in in_pieces.values())} pieces'
                  f' ({len(piece_of) - sum(u in piece_of for u in units)} already done in an earlier run)')

        def accept(unit, run_out):
            """Keep a finished file or piece if it came out right."""
            out = os.path.join(run_out, unit + '.png')
            if unit in piece_of:
                with Image.open(out) as hd, Image.open(os.path.join(work, unit + '.png')) as original:
                    if not hd_sprites.looks_right(original, hd):
                        return False
                shutil.copy(out, piece_of[unit][1])
                return True
            if finish(unit, run_out, dest_dir, pads[unit], sizes[unit]) is None:
                print(f'  {unit}: too large to enlarge, keeping the original')
                return True
            return check(unit)

        def check(name):
            path = os.path.join(dest_dir, name + '.png')
            with Image.open(path) as hd, Image.open(os.path.join(src_dir, name + '.png')) as original:
                ok = hd_sprites.looks_right(original, hd)
            if ok:
                record[name] = model
            else:
                os.remove(path)  # so a later try (or run) does it again
            return ok

        def attempt(batch, card, tile_size):
            """One Real-ESRGAN run over `batch`; returns the files and pieces that did not come out right."""
            runs[0] += 1
            run_in = os.path.join(tmp, f'run{runs[0]}', 'in')
            run_out = os.path.join(tmp, f'run{runs[0]}', 'out')
            os.makedirs(run_in)
            for unit in batch:
                shutil.copy(os.path.join(work, unit + '.png'), run_in)
            run_upscaler(exe, MODELS[model], run_in, run_out, card, tile_size)  # judged by its files, not its exit code
            return [unit for unit in batch if not (os.path.exists(os.path.join(run_out, unit + '.png')) and accept(unit, run_out))]

        # Small batches: when the graphics driver crashes ("vkQueueSubmit failed -4",
        # device lost) only that batch is lost. The driver gets a moment to restart,
        # the rest goes in smaller tiles (lighter on the card) and the lost files
        # are tried again one at a time.
        tiles = [tile]

        def run(batch):
            losses = device_losses[0]
            bad = attempt(batch, gpu, tiles[0])
            if device_losses[0] > losses and gpu != -1:
                if not tiles[0] or tiles[0] > RETRY_TILES[-1]:
                    tiles[0] = next(t for t in RETRY_TILES if not tiles[0] or t < tiles[0])
                print(f'  The graphics driver crashed; waiting {RECOVER} s for it to restart, then going on in {tiles[0]} px tiles ...')
                time.sleep(RECOVER)
            save_record(dest_dir, record)  # stopping now keeps what is done
            return bad

        left = []
        for i in range(0, len(units), BATCH):
            left += run(units[i:i + BATCH])
            print(f'  {min(i + BATCH, len(units))} of {len(units)} done' + (f', {len(left)} to try again' if left else ''))
        for round in range(ROUNDS):
            if not left:
                break
            print(f'{src}: trying {len(left)} again, one at a time ...')
            before = len(left)
            left = [bad for unit in left for bad in run([unit])]
            if len(left) == before and round:
                break  # no headway

        # Join the pieces of each large sheet that has all of them.
        failed = [unit for unit in left if unit not in piece_of]
        joined = os.path.join(tmp, 'joined')
        os.makedirs(joined)
        for name, boxes in in_pieces.items():
            files = {piece: piece_of[f'{name}~{piece}'][1] for piece, _, _ in boxes}
            if not all(os.path.exists(f) for f in files.values()):
                failed.append(name)  # the pieces done so far are kept for the next run
                continue
            join_pieces(sizes[name], boxes, files.get).save(os.path.join(joined, name + '.png'))
            if finish(name, joined, dest_dir, 0, sizes[name]) is not None and not check(name):
                failed.append(name)
            for f in files.values():
                os.remove(f)  # done, or to be made again
        for name in failed:
            record.pop(name, None)
        save_record(dest_dir, record)
        return len(names), failed


# --- side-by-side comparison of the models ----------------------------------------------

COMPARE_CHARACTERS = (('Bond', (90, 90, 90), (70, 45, 30)), ('Swat', (30, 30, 200), (30, 30, 120)))
COMPARE_PROPS = ('Car1', 'Crate1', 'Tree1')
COMPARE_GROUND = ('Grass1', 'Tiles')


def compare_samples(game, folder):
    """Small pictures of the game's art to upscale: two whole characters, props and ground."""
    with open(os.path.join(game, 'atlas.json')) as f:
        atlas = json.load(f)

    def frame(name, index):
        x, y, w, h, dx, dy = atlas[name]['frames'][index]
        with Image.open(os.path.join(game, 'sprites', atlas[name]['image'] + '.png')) as sheet:
            return sheet.convert('RGBA').crop((x, y, x + w, y + h)), dx, dy

    def tinted(img, rgb):
        # The *Custom layers carry the costume colour: multiplied in, like the game does.
        out = ImageChops.multiply(img.convert('RGB'), Image.new('RGB', img.size, rgb))
        out.putalpha(img.getchannel('A'))
        return out

    samples = []
    for model, body, head in COMPARE_CHARACTERS:
        if model + 'Body' not in atlas:
            continue
        canvas = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
        body_frame = 42 * 1 + 9  # facing south-west, holding a pistol
        for name, tint, index in ((model + 'BodyCustom', body, body_frame), (model + 'Body', None, body_frame), ('Pistol', None, 9),
                                  (model + 'HeadCustom', head, body_frame), (model + 'Head', None, body_frame)):
            if name not in atlas:
                continue
            img, dx, dy = frame(name, index)
            canvas.alpha_composite(tinted(img, tint) if tint else img, (24 + dx, 40 + dy))
        samples.append(('1_' + model, canvas))
    for name in COMPARE_PROPS:
        if name in atlas:
            samples.append(('2_' + name, frame(name, 0)[0]))
    for name in COMPARE_GROUND:
        path = os.path.join(game, 'images', name + '.png')
        if os.path.exists(path):
            with Image.open(path) as img:
                samples.append(('3_' + name, img.convert('RGBA').crop((0, 0, min(80, img.width), min(56, img.height)))))
    os.makedirs(folder, exist_ok=True)
    for name, img in samples:
        img.save(os.path.join(folder, name + '.png'))
    return [name for name, _ in samples]


def compare(exe, game, gpu, tile, out_path):
    """Upscale the samples with every model and save them side by side."""
    from PIL import ImageDraw  # noqa: PLC0415 (only the comparison draws text)
    columns = [('no AI', None)] + [(key, key) for key in MODELS]
    with tempfile.TemporaryDirectory() as tmp:
        names = compare_samples(game, os.path.join(tmp, 'in'))
        for key in MODELS:
            print(f'Comparing: {key} ...')
            if not run_upscaler(exe, MODELS[key], os.path.join(tmp, 'in'), os.path.join(tmp, key), gpu, tile):
                print(f'  {key} failed; its column stays empty')
        cell = 200
        sheet = Image.new('RGB', (cell * len(columns), 30 + cell * len(names)), (52, 48, 46))
        draw = ImageDraw.Draw(sheet)
        for c, (label, _) in enumerate(columns):
            draw.text((c * cell + 8, 9), label + (' (sprites)' if label == DEFAULT_MODEL['sprites'] else ' (ground)' if label == DEFAULT_MODEL['images'] else ''), fill=(240, 230, 210))
        for r, name in enumerate(names):
            with Image.open(os.path.join(tmp, 'in', name + '.png')) as original:
                original = original.convert('RGBA')
            for c, (_, key) in enumerate(columns):
                path = os.path.join(tmp, key, name + '.png') if key else None
                if key is None:
                    img = original.resize((original.width * SCALE, original.height * SCALE), Image.LANCZOS)
                elif os.path.exists(path):
                    with Image.open(path) as f:
                        img = f.convert('RGBA')
                else:
                    continue
                k = min(cell / img.width, cell / img.height)
                img = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
                tile_img = Image.new('RGBA', (cell, cell), (52, 48, 46, 255))
                tile_img.alpha_composite(img, ((cell - img.width) // 2, (cell - img.height) // 2))
                sheet.paste(tile_img.convert('RGB'), (c * cell, 30 + r * cell))
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        sheet.save(out_path)
    print(f'Saved {out_path}: one row per sample, one column per model.')
    print('Pick one, then for example:  python tools/upscale_textures.py --model hifi')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', default=os.path.join('client', 'assets', 'game'), help='the built game assets')
    ap.add_argument('--model', choices=list(MODELS), default=DEFAULT_MODEL['sprites'], help=f"for the sprites (default {DEFAULT_MODEL['sprites']})")
    ap.add_argument('--ground-model', choices=list(MODELS), default=DEFAULT_MODEL['images'], help=f"for the ground textures (default {DEFAULT_MODEL['images']})")
    ap.add_argument('--compare', action='store_true', help='upscale a few samples with every model, side by side, and stop')
    ap.add_argument('--only', choices=['sprites', 'images'], help='just one of the two folders')
    ap.add_argument('--redo', action='store_true', help='upscale everything again')
    ap.add_argument('--gpu', type=int, help='graphics card number, if you have several')
    ap.add_argument('--cpu', action='store_true', help='use the processor instead of the graphics card (slow; not every Real-ESRGAN build supports it)')
    ap.add_argument('--tile', type=int, help='work in smaller pieces, e.g. 64 (helps some graphics cards)')
    ap.add_argument('--upscaler', help='path to an existing realesrgan-ncnn-vulkan executable')
    args = ap.parse_args()
    if not os.path.isdir(os.path.join(args.game, 'sprites')):
        sys.exit(f'{args.game} has no sprites: build the assets first (tools/build_assets.py).')
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.realesrgan')
    exe = args.upscaler or find_upscaler(cache)
    gpu = -1 if args.cpu else args.gpu
    if gpu is None:
        gpu = pick_gpu(exe, MODELS[args.model])
    if args.compare:
        compare(exe, args.game, gpu, args.tile, os.path.join(cache, 'compare.png'))
        return
    done, broken = 0, []
    try:
        for src, dest in hd_sprites.FOLDERS:
            if args.only and args.only != src:
                continue
            model = args.ground_model if src == 'images' else args.model
            n, bad = upscale_folder(exe, model, args.game, src, dest, args.redo, gpu, args.tile)
            done += n
            broken += bad
    finally:
        hd_sprites.register(args.game, log=lambda *a: None)  # hd.json lists what is done, even when stopped
    if broken:
        print(f'\n{len(broken)} of {done} files did not come out right and were left out.')
        print('Files that worked are kept: run it again and only the missing ones are done.')
        print('If they keep failing, try:')
        print('  python tools/upscale_textures.py --tile 32')
        print('  python tools/upscale_textures.py --model fast')
    else:
        print('Done. Turn on "Enhanced Graphics" in Options and press Ctrl+F5 in the game.')


if __name__ == '__main__':
    main()
