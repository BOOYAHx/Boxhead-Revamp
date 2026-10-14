#!/usr/bin/env python3
"""Draw the costumes this port adds and put them in the sprite atlas.

    GhostRider  a flaming LEGO-style skull (black eyes with yellow pupils,
                angry brows, a stitched grin) and a black leather jacket with
                silver studs and a chain; drawn over the Ninja model's frames
    Venom       glossy black, big white eyes, a toothy grin with a red tongue
                and the white spider on the chest and back; over the Ninja too
    Batman      an all-black suit and cowl with ears, narrow white eyes, the
                jaw showing, a dark grey bat logo and a black cape; over the Ninja

Each costume is a model like the original twelve (game/bodyParts.js MODELS):
four sheets, <Model>Body, <Model>BodyCustom, <Model>Head and <Model>HeadCustom,
with the same 336 frames as the model it is drawn over (8 directions x 42: four
poses of standing + walking, then the six frames of dying). Its colours are
painted in, so it has a single colour (the white tint).

tools/build_assets.py runs this after baking the atlas (it needs the Ninja
sheets); to redraw the costumes on their own:

    python3 tools/costumes.py [--out client/assets/game]

Requires Pillow (pip install pillow).
"""

import argparse
import json
import os
import random

from PIL import Image

LAYERS = ('BodyCustom', 'Body', 'HeadCustom', 'Head')  # bottom to top
FRAMES_PER_DIRECTION = 42
DEATH_START = 36  # frames 36..41 of each direction: falling down
# Every frame is drawn on a canvas this size with the character's feet at (OX, OY):
# room for the widest frames (the head flying in the death frames) and the fire.
W, H, OX, OY = 84, 100, 42, 64
SHEET_WIDTH = 1024
# Transparent space round every frame on the sheets: the game draws the upscaled (HD)
# sheets smoothly, which reads a pixel or two past a frame's edge.
GUTTER = 2

BONE = [(150, 152, 158, 255), (200, 202, 208, 255), (234, 236, 240, 255), (252, 252, 252, 255)]  # white plastic
BLACK = (14, 8, 6, 255)
PUPIL = (255, 222, 40, 255)
FLAME = [(255, 246, 170, 255), (255, 210, 60, 255), (255, 140, 20, 255), (226, 70, 14, 255), (150, 30, 10, 255)]
STUD = (214, 218, 226, 255)
STUD_DARK = (120, 124, 134, 255)
CHAIN = [(200, 204, 212, 255), (110, 114, 124, 255)]
LEATHER_SHINE = (92, 88, 86, 255)
CLEAR = (0, 0, 0, 0)


class Mask:
    """Opaque pixels of some layers; reads outside the canvas are False."""

    def __init__(self, *ims):
        pxs = [im.load() for im in ims]
        self.rows = [[any(px[x, y][3] for px in pxs) for x in range(W)] for y in range(H)]

    def __call__(self, x, y):
        return 0 <= x < W and 0 <= y < H and self.rows[y][x]

    def bbox(self):
        pts = [(x, y) for y in range(H) for x in range(W) if self.rows[y][x]]
        if not pts:
            return None
        return min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)

    def span(self, y):
        xs = [x for x in range(W) if self(x, y)]
        return (min(xs), max(xs)) if xs else None


def put(im, x, y, c):
    if 0 <= x < W and 0 <= y < H:
        im.putpixel((x, y), c)


class Source:
    """The frames of a model of the game, each on its own canvas."""

    def __init__(self, out, model):
        with open(os.path.join(out, 'atlas.json')) as f:
            self.atlas = json.load(f)
        self.model = model
        self.sheets = {}
        for layer in LAYERS:
            image = self.atlas[model + layer]['image']
            self.sheets[layer] = Image.open(os.path.join(out, 'sprites', image + '.png')).convert('RGBA')
        self.count = len(self.atlas[model + 'Body']['frames'])

    def frame(self, layer, i):
        canvas = Image.new('RGBA', (W, H))
        x, y, w, h, dx, dy = self.atlas[self.model + layer]['frames'][i]
        canvas.alpha_composite(self.sheets[layer].crop((x, y, x + w, y + h)), (OX + dx, OY + dy))
        return canvas


# --- Ghost Rider ----------------------------------------------------------------------------

def leather(im):
    """The model's white geometry -> black leather, a soft shine along lit top edges."""
    px = im.load()
    lum = {(x, y): sum(px[x, y][:3]) / 3 for y in range(H) for x in range(W) if px[x, y][3]}
    top = {p for p, l in lum.items() if l >= 225}
    for (x, y), l in lum.items():
        v = int(10 + l * 0.08)
        px[x, y] = LEATHER_SHINE if (x, y) in top and (x, y - 1) not in top else (v + 3, v + 1, v, 255)


def skull(im):
    """The model's white geometry -> white plastic, darker where the model is shaded."""
    px = im.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            if a:
                px[x, y] = BONE[min(3, int((r + g + b) / 3 / 64))]


def flames(im, head, seed, small=False):
    """Fire licking up from the top of the head: taller in the middle, different every frame."""
    x0, top, x1, _ = head.bbox()
    rnd = random.Random(seed)
    mid = (x0 + x1) / 2
    half = max(1, (x1 - x0) / 2)
    for x in range(x0 - 1, x1 + 2):
        base = next((y for y in range(top, top + 6) if head(x, y)), top + 1)
        height = int(3 + 6 * (1 - abs(x - mid) / (half + 1)) + rnd.randint(-2, 2))
        if small:
            height = height * 2 // 3
        for k in range(height):
            if k > 2 and rnd.random() < 0.15:  # some tongues break up
                continue
            put(im, x, base - k, FLAME[min(4, int(k / max(1, height) * 5))] if k else FLAME[0])


def front_face(hf, head, slit):
    """The face from the front: black eyes slanting down to the middle with a yellow pupil
    each, thick brows meeting them, a little nose and a wide stitched grin."""
    fx0, fx1 = min(x for x, _ in slit), max(x for x, _ in slit)
    fy0, fy1 = min(y for _, y in slit), max(y for _, y in slit)
    c0 = (fx0 + fx1) // 2
    eye = [(-1, -5), (-1, -4), (0, -4), (-1, -3), (0, -3), (1, -3), (-1, -2), (0, -2), (1, -2), (2, -2),
           (0, -1), (1, -1), (2, -1), (1, 0), (2, 0)]
    brow = [(-1, -7), (0, -7), (1, -7), (0, -6), (1, -6), (2, -5), (3, -4), (3, -3)]
    both = lambda dx: [x for x, ok in ((fx0 + dx, fx0 + dx <= c0), (fx1 - dx, fx1 - dx > c0)) if ok]
    for dx, dy in eye + brow:
        for x in both(dx):
            if head(x, fy0 + dy):
                put(hf, x, fy0 + dy, BLACK)
    for dx, dy in ((1, -2), (1, -1)):
        for x in both(dx):
            put(hf, x, fy0 + dy, PUPIL)
    for x in (c0, c0 + 1):  # nose
        put(hf, x, fy1 - 1, BLACK)
        put(hf, x, fy1, BLACK)
    my = fy1 + 2  # the grin: corners turned up, teeth between two black lines
    for x in range(fx0 - 1, fx1 + 2):
        if not head(x, my):
            continue
        put(hf, x, my, BLACK)
        put(hf, x, my + 1, BLACK if x in (fx0 - 1, fx1 + 1) or (x - fx0) % 2 else BONE[3])
        if fx0 <= x <= fx1:
            put(hf, x, my + 2, BLACK)
    for x in (fx0 - 1, fx1 + 1):
        put(hf, x, my - 1, BLACK)


# The face from three quarters, on the slanted side of the turned head: 7 pixels wide,
# each column moved up or down to follow the slant. B black, Y yellow, W white, . skull.
THREE_QUARTER = [
    'B.....B',  # brows, high outside
    'BB...BB',
    'BBB.BBB',  # meeting the eyes
    'BBY.YBB',  # the eyes and their pupils (on the model's eye slit)
    '.BB.BB.',
    '...B...',  # nose
    'B.....B',  # the grin: corners up
    'BBBBBBB',
    'BWBWBWB',  # teeth
    '.BBBBB.',
]
THREE_QUARTER_EYES = 3


def three_quarter_face(hf, head, slit):
    x0, _, x1, _ = head.bbox()
    cols = {}
    for x, y in slit:
        cols.setdefault(x, []).append(y)
    xs = sorted(cols)
    slope = 1 if min(cols[xs[-1]]) > min(cols[xs[0]]) else -1
    mid = xs[len(xs) // 2]
    eyes = min(cols[mid])
    # The face is on one side of the turned head: from its outer edge to the middle seam.
    seam = (x0 + x1) // 2
    lo, hi = (x0 + 1, seam) if sum(xs) / len(xs) < (x0 + x1) / 2 else (seam + 1, x1 - 1)
    cx = (lo + hi) // 2
    colors = {'B': BLACK, 'Y': PUPIL, 'W': BONE[3]}
    for u in range(7):
        x = cx - 3 + u
        top = eyes + slope * (x - mid) - THREE_QUARTER_EYES
        for v, row in enumerate(THREE_QUARTER):
            if row[u] in colors and head(x, top + v):
                put(hf, x, top + v, colors[row[u]])


def profile_face(hf, head, facing_left):
    """From the side: one black eye with its pupil, and the end of the grin."""
    x0, _, x1, y1 = head.bbox()
    edge, step = (x0, 1) if facing_left else (x1, -1)
    fy = y1 - 7
    for dx, dy in ((1, -3), (1, -2), (2, -2), (1, -1), (2, -1), (3, -1), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (4, 1)):
        x = edge + step * dx
        if head(x, fy + dy):
            put(hf, x, fy + dy, BLACK)
    put(hf, edge + step * 2, fy - 1, PUPIL)
    for d in range(5):
        x = edge + step * d
        for k, c in ((4, BLACK), (5, BLACK if d % 2 else BONE[3]), (6, BLACK)):
            if head(x, fy + k):
                put(hf, x, fy + k, c)


def ghost_rider(src, i):
    bc, bf, hc, hf = (src.frame(layer, i) for layer in LAYERS)
    direction, step = divmod(i, FRAMES_PER_DIRECTION)
    dying = step >= DEATH_START
    # The Ninja's eye slit (skin coloured) shows where the face is; it goes.
    slit = [(x, y) for y in range(H) for x in range(W) if (lambda p: p[3] and p[0] > 55 and p[0] > p[2] + 15)(hf.getpixel((x, y)))]
    for x, y in slit:
        put(hf, x, y, BONE[2])
    # So does the Ninja's light sash.
    fpx = bf.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = fpx[x, y]
            if a and r > 70 and abs(r - b) < 25:
                fpx[x, y] = CLEAR
    leather(bc)
    skull(hc)
    head, body_mask = Mask(hc, hf), Mask(bc, bf)
    hb = head.bbox()
    if not hb or not body_mask.bbox():
        return bc, bf, hc, hf
    hx0, _, hx1, hy1 = hb
    body = lambda x, y: body_mask(x, y) and not head(x, y)

    if not dying:
        if len(slit) >= 2:  # the face is towards us
            if direction % 2:
                three_quarter_face(hf, head, slit)
            else:
                front_face(hf, head, slit)
            # A silver chain across the chest from the left shoulder.
            c0 = (min(x for x, _ in slit) + max(x for x, _ in slit)) // 2
            for k in range(12):
                x, y = c0 - 5 + k, hy1 + 2 + k // 2
                if body(x, y):
                    put(bf, x, y, CHAIN[k % 2])
        elif direction in (2, 6):
            profile_face(hf, head, facing_left=direction == 2)
        # Studs on the shoulders, every way round.
        for y in (hy1 + 2, hy1 + 4):
            span = body_mask.span(y)
            if not span:
                continue
            lx, rx = span
            for x in (lx + 1, lx + 3, rx - 1, rx - 3):
                if body(x, y) and (x < hx0 or x > hx1):
                    put(bc, x, y, STUD)
                    put(bc, x, y + 1, STUD_DARK)
    flames(hf, head, i * 7919 + direction, small=dying)
    return bc, bf, hc, hf


# --- Venom ------------------------------------------------------------------------------------

WHITE = (246, 247, 251, 255)
GOO_SHINE = [(104, 120, 160, 255), (54, 62, 86, 255)]  # the blue-grey streak along a lit top edge
MOUTH = (58, 4, 14, 255)
TONGUE = (214, 38, 66, 255)
TONGUE_DARK = (150, 18, 42, 255)
# The white spider: upper legs out to the top of the chest, lower legs round the ribs.
SPIDER = [
    'WW........WW',
    '.WW......WW.',
    '..WWWWWWWW..',
    '...WWWWWW...',
    '....WWWW....',
    '.....WW.....',
    '....WWWW....',
    '...WWWWWW...',
    '..WW.WW.WW..',
    '.WW..WW..WW.',
    'WW........WW',
    'W..........W',
]
SPIDER_NARROW = [  # squeezed for the three-quarter views
    'W......W',
    '.WWWWWW.',
    '..WWWW..',
    '...WW...',
    '..WWWW..',
    '.WWWWWW.',
    'WW.WW.WW',
    'W......W',
]
GRIN = [
    'W        W',
    'WWWWWWWWWW',
    '.W.W..W.W.',
    'W.W.TT.W.W',
    'WWWWTTWWWW',
]
# From three quarters, sheared along the side of the head like Ghost Rider's.
VENOM_THREE_QUARTER = [
    'W.....W',
    'WW...WW',
    'WWW.WWW',  # the eyes (on the model's eye slit)
    '.WW.WW.',
    '.......',
    'WWWWWWW',  # the grin
    'M.WMW.M',
    'WMWTWMW',
    'WWWTWWW',
]


def goo(im):
    """The model's white geometry -> glossy black, a blue-grey shine along lit top edges."""
    px = im.load()
    lum = {(x, y): sum(px[x, y][:3]) / 3 for y in range(H) for x in range(W) if px[x, y][3]}
    top = {p for p, l in lum.items() if l >= 225}
    for (x, y), l in lum.items():
        v = int(7 + l * 0.095)
        c = (v, v + 4, v + 14, 255)
        if (x, y) in top:
            if (x, y - 1) not in top:
                c = GOO_SHINE[0]
            elif (x, y - 2) not in top:
                c = GOO_SHINE[1]
        px[x, y] = c


def stamp(im, art, x0, y0, colors, where):
    for dy, row in enumerate(art):
        for dx, ch in enumerate(row):
            if ch in colors and where(x0 + dx, y0 + dy):
                put(im, x0 + dx, y0 + dy, colors[ch])


def venom(src, i):
    bc, bf, hc, hf = (src.frame(layer, i) for layer in LAYERS)
    direction, step = divmod(i, FRAMES_PER_DIRECTION)
    dying = step >= DEATH_START
    slit = [(x, y) for y in range(H) for x in range(W) if (lambda p: p[3] and p[0] > 55 and p[0] > p[2] + 15)(hf.getpixel((x, y)))]
    for x, y in slit:
        put(hf, x, y, CLEAR)
    fpx = bf.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = fpx[x, y]
            if a and r > 70 and abs(r - b) < 25:  # the Ninja's sash
                fpx[x, y] = CLEAR
    goo(bc)
    goo(hc)
    head, body_mask = Mask(hc, hf), Mask(bc, bf)
    hb = head.bbox()
    if dying or not hb or not body_mask.bbox():
        return bc, bf, hc, hf
    hx0, _, hx1, hy1 = hb
    body = lambda x, y: body_mask(x, y) and not head(x, y)
    colors = {'W': WHITE, 'M': MOUTH, 'T': TONGUE}
    if len(slit) >= 2:
        fx0, fx1 = min(x for x, _ in slit), max(x for x, _ in slit)
        fy0, fy1 = min(y for _, y in slit), max(y for _, y in slit)
        c0 = (fx0 + fx1) // 2
        if direction % 2:
            cols = {}
            for x, y in slit:
                cols.setdefault(x, []).append(y)
            xs = sorted(cols)
            slope = 1 if min(cols[xs[-1]]) > min(cols[xs[0]]) else -1
            mid = xs[len(xs) // 2]
            seam = (hx0 + hx1) // 2
            lo, hi = (hx0 + 1, seam) if sum(xs) / len(xs) < (hx0 + hx1) / 2 else (seam + 1, hx1 - 1)
            cx = (lo + hi) // 2
            for u in range(7):
                x = cx - 3 + u
                top = min(cols[mid]) + slope * (x - mid) - 2
                for v, row in enumerate(VENOM_THREE_QUARTER):
                    if row[u] in colors and head(x, top + v):
                        put(hf, x, top + v, colors[row[u]])
            stamp(bf, SPIDER_NARROW, c0 - 3, hy1 + 2, colors, body)
        else:
            eye = [(-1, -5), (-1, -4), (0, -4), (-1, -3), (0, -3), (1, -3), (-1, -2), (0, -2), (1, -2), (2, -2),
                   (0, -1), (1, -1), (2, -1), (1, 0), (2, 0)]
            for dx, dy in eye:
                for x, ok in ((fx0 + dx, fx0 + dx <= c0), (fx1 - dx, fx1 - dx > c0)):
                    if ok and head(x, fy0 + dy):
                        put(hf, x, fy0 + dy, WHITE)
            stamp(hf, GRIN, c0 - 4, fy1, {'W': WHITE, '.': MOUTH, 'T': TONGUE}, head)
            for x, y, c in ((c0, fy1 + 5, TONGUE), (c0 + 1, fy1 + 5, TONGUE), (c0 + 1, fy1 + 6, TONGUE),
                            (c0, fy1 + 6, TONGUE_DARK), (c0 + 2, fy1 + 6, TONGUE_DARK)):
                put(hf, x, y, c)  # the tongue lolls out over the chin
            stamp(bf, SPIDER if direction == 0 else SPIDER_NARROW, c0 - (5 if direction == 0 else 3), hy1 + 2, colors, body)
    elif direction in (2, 6):  # profile: one big eye, the grin, the spider's legs round the side
        facing_left = direction == 2
        edge, stp = (hx0, 1) if facing_left else (hx1, -1)
        fy = hy1 - 7
        for dx, dy in ((1, -3), (1, -2), (2, -2), (1, -1), (2, -1), (3, -1), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (4, 1)):
            if head(edge + stp * dx, fy + dy):
                put(hf, edge + stp * dx, fy + dy, WHITE)
        for k, row in enumerate(['WWWWW', 'T.W.W', 'WWWW.']):
            for d, ch in enumerate(row):
                x, y = edge + stp * d, fy + 3 + k
                if head(x, y):
                    put(hf, x, y, WHITE if ch == 'W' else TONGUE if ch == 'T' else MOUTH)
        for k in range(6):
            for x, y in ((edge + stp * (1 + k), hy1 + 2 + k), (edge + stp * (2 + k), hy1 + 2 + k),
                         (edge + stp * (6 - k), hy1 + 8 + k), (edge + stp * (7 - k), hy1 + 8 + k)):
                if body(x, y):
                    put(bf, x, y, WHITE)
    else:  # the spider carries on round the back
        cx = (hx0 + hx1) // 2
        art = SPIDER if direction == 4 else SPIDER_NARROW
        stamp(bf, art, cx - (len(art[0]) // 2 - 1), hy1 + 2, colors, body)
    return bc, bf, hc, hf


# --- Batman -----------------------------------------------------------------------------------

BAT_COWL = [(0, 0, 0, 255), (4, 4, 5, 255), (9, 9, 11, 255), (15, 15, 18, 255)]
BAT_COWL_SHINE = (48, 49, 54, 255)
BAT_SUIT = [(0, 0, 0, 255), (5, 5, 6, 255), (10, 10, 12, 255), (17, 17, 20, 255)]
BAT_SUIT_SHINE = (44, 45, 50, 255)
BAT_CAPE = [(0, 0, 0, 255), (11, 11, 13, 255)]
BAT_EYE = (250, 250, 250, 255)
BAT_SKIN = (176, 120, 80, 255)
BAT_SKIN_DARK = (128, 82, 52, 255)
BAT_LOGO = (42, 43, 48, 255)
BAT_BLACK = (8, 8, 12, 255)
# The chest logo: a black bat (B) on a dark grey oval (Y).
BAT_SIGN = [
    '..YYYYYYYY..',
    '.YBYYBBYYBY.',
    'YBBBBBBBBBBY',
    '.YBBYBBYBBY.',
    '..YYYYYYYY..',
]
BAT_SIGN_NARROW = [  # from three quarters
    '.YYYYYY.',
    'YBBBBBBY',
    'YYBBBBYY',
    '.YYYYYY.',
]
# The face from three quarters, sheared along the side of the head: W eye, S skin, D mouth.
BAT_THREE_QUARTER = ['WW...WW', '.WW.WW.', '.......', 'SSSSSSS', 'SSSSSSS', 'SSDDDSS', 'SSSSSSS']


def plastic(im, ramp, shine):
    """The model's white geometry -> a dark plastic, a faint shine along lit top edges."""
    px = im.load()
    lum = {(x, y): sum(px[x, y][:3]) / 3 for y in range(H) for x in range(W) if px[x, y][3]}
    top = {p for p, l in lum.items() if l >= 225}
    for (x, y), l in lum.items():
        px[x, y] = shine if (x, y) in top and (x, y - 1) not in top else ramp[min(3, int(l / 64))]


def chest_sign(bc, bf, art, x0, y0, colors, where):
    """A logo painted into the suit's own layer (not on the outline layer over it), so it
    upscales as part of the chest instead of a few loose pixels."""
    for dy, row in enumerate(art):
        for dx, ch in enumerate(row):
            x, y = x0 + dx, y0 + dy
            if ch in colors and where(x, y):
                put(bc, x, y, colors[ch])
                if bf.getpixel((x, y))[3]:
                    put(bf, x, y, CLEAR)


def batman(src, i):
    bc, bf, hc, hf = (src.frame(layer, i) for layer in LAYERS)
    direction, step = divmod(i, FRAMES_PER_DIRECTION)
    slit = [(x, y) for y in range(H) for x in range(W) if (lambda p: p[3] and p[0] > 55 and p[0] > p[2] + 15)(hf.getpixel((x, y)))]
    fpx = bf.load()
    for y in range(H):
        for x in range(W):
            r, g, b, a = fpx[x, y]
            if a and r > 70 and abs(r - b) < 25:  # the Ninja's sash
                fpx[x, y] = CLEAR
    plastic(bc, BAT_SUIT, BAT_SUIT_SHINE)
    plastic(hc, BAT_COWL, BAT_COWL_SHINE)
    for x, y in slit:
        put(hf, x, y, BAT_COWL[1])
    head, bm = Mask(hc, hf), Mask(bc, bf)
    hb = head.bbox()
    if step >= DEATH_START or not hb or not bm.bbox():
        return bc, bf, hc, hf
    hx0, hy0, hx1, hy1 = hb
    body = lambda x, y: bm(x, y) and not head(x, y)
    # The cowl's ears: two points up from its top corners (along the ridge when turned).
    if direction % 2 == 0:
        for k, w in enumerate((3, 2, 2, 1, 1)):
            for d in range(w):
                put(hf, hx0 + 1 + d, hy0 + 2 - k, BAT_COWL[0] if d == 0 else BAT_COWL[1])
                put(hf, hx1 - 1 - d, hy0 + 2 - k, BAT_COWL[0] if d == 0 else BAT_COWL[1])
    else:
        cx = (hx0 + hx1) // 2
        for ex in (cx - 4, cx + 3):
            ty = next((y for y in range(H) if head(ex, y)), hy0) + 1
            for k, w in enumerate((2, 2, 1, 1)):
                for d in range(w):
                    put(hf, ex + d, ty - k, BAT_COWL[0])
    waist = next((y for y in range(hy1 + 10, hy1 + 18) if bm.span(y)), None)
    sign = {'Y': BAT_LOGO, 'B': BAT_BLACK}
    if len(slit) >= 2:
        fx0, fx1 = min(x for x, _ in slit), max(x for x, _ in slit)
        fy0, fy1 = min(y for _, y in slit), max(y for _, y in slit)
        c0 = (fx0 + fx1) // 2
        if direction % 2 == 0:
            # Narrow white eyes angled down to the middle, the jaw below them, a stern mouth.
            for x, dy in ((fx0, -1), (fx0 + 1, -1), (fx0 + 1, 0), (fx0 + 2, 0)):
                put(hf, x, fy0 + dy, BAT_EYE)
                put(hf, fx1 - (x - fx0), fy0 + dy, BAT_EYE)
            for y in range(fy1 + 1, hy1 + 1):
                for x in range(fx0, fx1 + 1):
                    if head(x, y):
                        put(hf, x, y, BAT_SKIN if y < hy1 else BAT_SKIN_DARK)
            for x in range(c0 - 1, c0 + 3):
                put(hf, x, fy1 + 3, BAT_SKIN_DARK)
            chest_sign(bc, bf, BAT_SIGN if direction == 0 else BAT_SIGN_NARROW, c0 - (5 if direction == 0 else 3), hy1 + 3, sign, body)
        else:
            cols = {}
            for x, y in slit:
                cols.setdefault(x, []).append(y)
            xs = sorted(cols)
            slope = 1 if min(cols[xs[-1]]) > min(cols[xs[0]]) else -1
            mid = xs[len(xs) // 2]
            seam = (hx0 + hx1) // 2
            lo, hi = (hx0 + 1, seam) if sum(xs) / len(xs) < (hx0 + hx1) / 2 else (seam + 1, hx1 - 1)
            cx = (lo + hi) // 2
            colors = {'W': BAT_EYE, 'S': BAT_SKIN, 'D': BAT_SKIN_DARK}
            for u in range(7):
                x = cx - 3 + u
                top = min(cols[mid]) + slope * (x - mid) - 1
                for v, row in enumerate(BAT_THREE_QUARTER):
                    if row[u] in colors and head(x, top + v):
                        put(hf, x, top + v, colors[row[u]])
            chest_sign(bc, bf, BAT_SIGN_NARROW, c0 - 3, hy1 + 3, sign, body)
    elif direction in (2, 6):  # profile: one eye, the jaw, the cape down the back
        facing_left = direction == 2
        edge, stp = (hx0, 1) if facing_left else (hx1, -1)
        fy = hy1 - 7
        for d, dy in ((1, 0), (2, 0), (2, 1)):
            put(hf, edge + stp * d, fy + dy, BAT_EYE)
        for y in range(fy + 3, hy1 + 1):
            for d in range(4):
                if head(edge + stp * d, y):
                    put(hf, edge + stp * d, y, BAT_SKIN)
        for y in range(hy1 + 1, (waist or hy1 + 14) + 6):
            sp = bm.span(y)
            if sp:
                bx = sp[1] if facing_left else sp[0]
                for d in range(3):
                    put(bc, bx - (d if facing_left else -d), y, BAT_CAPE[d % 2])
    else:  # from behind: the cape over the back, down to the knees
        for y in range(hy1 + 1, (waist or hy1 + 14) + 7):
            for x in range(W):
                if body(x, y):
                    put(bc, x, y, BAT_CAPE[x % 4 == 0])
                    if bf.getpixel((x, y))[3]:
                        put(bf, x, y, CLEAR)
    return bc, bf, hc, hf


COSTUMES = {'GhostRider': ('Ninja', ghost_rider), 'Venom': ('Ninja', venom), 'Batman': ('Ninja', batman)}


# --- sheets -----------------------------------------------------------------------------------

def pack(frames):
    """Crop each canvas to what is drawn and shelf-pack them, GUTTER apart: (sheet, [[x, y, w, h, dx, dy], ...])."""
    boxes = []
    for im in frames:
        box = im.getbbox() or (0, 0, 1, 1)
        boxes.append((im.crop(box), box))
    placed, x, y, shelf = [], 0, 0, 0
    for piece, _ in boxes:
        w, h = piece.width + 2 * GUTTER, piece.height + 2 * GUTTER
        if x + w > SHEET_WIDTH:
            x, y, shelf = 0, y + shelf, 0
        placed.append((x + GUTTER, y + GUTTER))
        x += w
        shelf = max(shelf, h)
    sheet = Image.new('RGBA', (SHEET_WIDTH, y + shelf))
    entries = []
    for (piece, box), (px, py) in zip(boxes, placed):
        sheet.alpha_composite(piece, (px, py))
        entries.append([px, py, piece.width, piece.height, box[0] - OX, box[1] - OY])
    return sheet, entries


def add(out):
    """Write each costume's sheets into <out>/sprites/ and its entries into <out>/atlas.json."""
    path = os.path.join(out, 'atlas.json')
    with open(path) as f:
        atlas = json.load(f)
    for name, (base, draw) in COSTUMES.items():
        src = Source(out, base)
        layers = {layer: [] for layer in LAYERS}
        for i in range(src.count):
            for layer, im in zip(LAYERS, draw(src, i)):
                layers[layer].append(im)
        for layer, frames in layers.items():
            sheet, entries = pack(frames)
            sheet.save(os.path.join(out, 'sprites', name + layer + '.png'), optimize=True)
            atlas[name + layer] = {'image': name + layer, 'frames': entries}
        print(f'  costume {name}: {src.count} frames, drawn over {base}')
    with open(path, 'w') as f:
        json.dump(atlas, f, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join('client', 'assets', 'game'))
    add(ap.parse_args().out)


if __name__ == '__main__':
    main()
