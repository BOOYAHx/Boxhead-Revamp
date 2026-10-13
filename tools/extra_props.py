#!/usr/bin/env python3
"""Draw the props this port adds to the game's own and put them in the sprite atlas.

The original game has cars but no bus or truck, and no raised deck, so these
are drawn here in the game's style (seen from above and the front, dark
outline, light from the top left):

    Bus1    school bus across, facing left   (prop a16, 6 x 2 cells)
    Bus2    school bus up-down, facing up    (prop a17, 2 x 6 cells)
    Truck1  box truck across, facing left    (prop a18, 4 x 2 cells)
    Truck2  box truck up-down, facing up     (prop a19, 2 x 4 cells)
    Deck1   raised wooden deck on posts, stairs down on the right (prop b31, 7 x 2)
    Deck2   the same with the stairs on the left                  (prop b32, 7 x 2)

plus a shadow for each (Bus_Shadow1, ...). tools/build_assets.py runs this
after baking the atlas; to redraw them on their own:

    python3 tools/extra_props.py [--out client/assets/game]

Each picture is drawn around the centre of the prop's footprint (x right, y
down, in game pixels: 40 x 28 per cell), the point the game places it at;
game/world.js describeProp has the matching sizes and hit boxes.

Requires Pillow (pip install pillow).
"""

import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_atlas import shadow as soft_shadow  # noqa: E402

OUTLINE = (24, 14, 10, 255)
GLASS = (34, 40, 48, 255)
GLINT = (96, 108, 120, 255)
TYRE = (14, 10, 9, 255)
HUB = (200, 198, 190, 255)
BUMPER = (28, 26, 24, 255)
TAIL = (210, 36, 28, 255)
AMBER = (250, 196, 70, 255)
YELLOW = (236, 182, 40, 255)
YELLOW_LIGHT = (246, 198, 62, 255)
YELLOW_SIDE = (196, 138, 22, 255)
YELLOW_DARK = (150, 100, 14, 255)
RED = (196, 44, 40, 255)
RED_LIGHT = (214, 60, 52, 255)
RED_SIDE = (140, 28, 30, 255)
WHITE = (222, 220, 212, 255)
WHITE_LIGHT = (234, 232, 225, 255)
WHITE_SIDE = (184, 182, 174, 255)
PANEL = (206, 204, 196, 255)
BLUE = (40, 84, 150, 255)


class Canvas:
    """A picture whose coordinates are relative to the prop's centre."""

    def __init__(self, left, top, right, bottom):
        self.ox, self.oy = -left, -top
        self.im = Image.new('RGBA', (right - left + 1, bottom - top + 1), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def box(self, x0, y0, x1, y1, fill, radius=0):
        xy = [x0 + self.ox, y0 + self.oy, x1 + self.ox, y1 + self.oy]
        if radius:
            self.d.rounded_rectangle(xy, radius=radius, fill=fill)
        else:
            self.d.rectangle(xy, fill=fill)

    def line(self, x0, y0, x1, y1, fill):
        self.d.line([x0 + self.ox, y0 + self.oy, x1 + self.ox, y1 + self.oy], fill=fill)

    def wheel(self, cx, cy, r=8):
        self.d.chord([cx - r - 4 + self.ox, cy - r - 4 + self.oy, cx + r + 4 + self.ox, cy + r + 2 + self.oy], 180, 360, fill=(22, 16, 12, 255))
        self.d.ellipse([cx - r + self.ox, cy - r + self.oy, cx + r + self.ox, cy + r + self.oy], fill=TYRE)
        self.d.ellipse([cx - 4 + self.ox, cy - 4 + self.oy, cx + 4 + self.ox, cy + 4 + self.oy], fill=HUB)
        self.d.ellipse([cx - 1 + self.ox, cy - 1 + self.oy, cx + 1 + self.ox, cy + 1 + self.oy], fill=(120, 116, 110, 255))

    def shade(self, x0, y0, x1, y1, light=12, dark=32):
        """Lighter at the top of a face, darker toward its bottom."""
        px = self.im.load()
        for y in range(y0, y1 + 1):
            k = (y - y0) / max(1, y1 - y0)
            delta = round(light * (1 - 2 * k)) if k < 0.5 else round(-dark * (k - 0.5) * 2)
            for x in range(x0, x1 + 1):
                r, g, b, a = px[x + self.ox, y + self.oy]
                if a:
                    px[x + self.ox, y + self.oy] = (max(0, min(255, r + delta)), max(0, min(255, g + delta)), max(0, min(255, b + delta)), a)

    def finish(self):
        """The picture with a dark outline, and its offset for the atlas."""
        grown = self.im.split()[3].filter(ImageFilter.MaxFilter(3))
        out = Image.new('RGBA', self.im.size, (0, 0, 0, 0))
        out.paste(Image.new('RGBA', self.im.size, OUTLINE), (0, 0), grown)
        out.alpha_composite(self.im)
        return out, [-self.ox, -self.oy]


def bus_across():
    c = Canvas(-103, -46, 103, 22)
    # side (the face toward the viewer): window row, door, black stripe
    c.box(-100, -4, 100, 12, YELLOW_SIDE)
    c.box(-100, -3, 100, 4, GLASS)
    for x in range(-77, 92, 15):
        c.box(x, -3, x + 2, 4, (170, 116, 18, 255))
        c.line(x + 5, -2, x + 9, -2, GLINT)
    c.box(-90, -3, -80, 10, (40, 46, 54, 255))
    c.line(-85, -3, -85, 10, YELLOW_DARK)
    c.box(-100, 7, 100, 8, (30, 22, 14, 255))
    c.box(-100, 10, 100, 12, YELLOW_DARK)
    c.box(-103, 6, -99, 12, BUMPER)
    c.box(99, 6, 103, 12, BUMPER)
    c.box(-99, 4, -97, 6, AMBER)
    c.box(96, 4, 98, 6, TAIL)
    c.box(-75, 5, -69, 10, (200, 30, 30, 255))  # stop sign arm
    c.shade(-100, -4, 100, 12, 0, 40)
    # roof
    c.box(-100, -44, 100, -4, YELLOW, radius=4)
    c.box(-96, -41, 96, -7, YELLOW_LIGHT, radius=3)
    c.box(-100, -42, -90, -4, GLASS)  # windscreen, seen from above
    c.line(-98, -40, -92, -8, GLINT)
    for x in (-43, 37):
        c.box(x, -32, x + 18, -18, (214, 160, 34, 255))
        c.box(x + 2, -30, x + 16, -20, (226, 222, 210, 255))
    c.line(-87, -25, 95, -25, (228, 172, 36, 255))
    c.line(-87, -43, 96, -43, (250, 214, 100, 255))
    c.shade(-100, -44, 100, -5, 10, 30)
    for x in (-69, 69):
        c.wheel(x, 13)
    return c.finish()


def bus_up_down():
    c = Canvas(-29, -104, 29, 80)
    # back (the face toward the viewer): rear window, emergency door, lights
    c.box(-26, 54, 26, 72, YELLOW_SIDE)
    c.box(-22, 56, 22, 62, GLASS)
    c.line(-20, 57, -14, 57, GLINT)
    c.box(-8, 56, 8, 70, (180, 124, 20, 255))
    c.box(-6, 57, 6, 62, (40, 46, 54, 255))
    c.box(-26, 65, 26, 66, (30, 22, 14, 255))
    c.box(-25, 63, -21, 67, TAIL)
    c.box(21, 63, 25, 67, TAIL)
    c.box(-24, 59, -22, 61, AMBER)
    c.box(22, 59, 24, 61, AMBER)
    c.box(-28, 70, 28, 74, BUMPER)
    c.shade(-26, 54, 26, 70, 0, 36)
    c.box(-27, 72, -18, 79, TYRE)
    c.box(18, 72, 27, 79, TYRE)
    # roof
    c.box(-26, -102, 26, 54, YELLOW, radius=4)
    c.box(-23, -98, 23, 51, YELLOW_LIGHT, radius=3)
    c.box(-26, -102, 26, -92, GLASS)  # windscreen at the front (top)
    c.line(-22, -98, 18, -96, GLINT)
    for y in (-60, 10):
        c.box(-9, y, 9, y + 18, (214, 160, 34, 255))
        c.box(-7, y + 2, 7, y + 16, (226, 222, 210, 255))
    c.line(0, -88, 0, 50, (228, 172, 36, 255))
    c.line(-25, -90, -25, 52, (250, 214, 100, 255))
    c.shade(-26, -92, 26, 53, 6, 22)
    return c.finish()


def truck_across():
    c = Canvas(-77, -56, 77, 22)
    c.box(-70, 9, 72, 14, (34, 30, 28, 255))  # chassis
    # cab: side, then roof
    c.box(-74, 0, -30, 12, RED_SIDE)
    c.box(-58, 1, -36, 7, GLASS)
    c.line(-56, 2, -50, 2, GLINT)
    c.box(-74, 8, -30, 9, (110, 20, 22, 255))
    c.box(-77, 6, -72, 12, BUMPER)
    c.box(-76, 3, -74, 5, AMBER)
    c.shade(-74, 0, -30, 12, 0, 36)
    c.box(-74, -40, -30, 0, RED, radius=3)
    c.box(-74, -38, -63, 0, GLASS)  # windscreen
    c.line(-72, -36, -66, -3, GLINT)
    c.box(-60, -34, -34, -6, RED_LIGHT)
    c.shade(-74, -40, -30, -1, 12, 34)
    # box: side, then roof
    c.box(-28, -14, 74, 10, WHITE_SIDE)
    c.box(-28, -7, 74, -2, BLUE)
    c.box(-28, -1, 74, 0, TAIL)
    for x in range(-14, 74, 22):
        c.line(x, -14, x, 9, (160, 158, 150, 255))
    c.box(72, 2, 74, 5, TAIL)
    c.shade(-28, -14, 74, 10, 0, 36)
    c.box(-28, -54, 74, -14, WHITE)
    c.box(-25, -51, 71, -17, WHITE_LIGHT)
    for x in range(-6, 74, 22):
        c.line(x, -51, x, -17, PANEL)
    c.line(-28, -54, 74, -54, (246, 245, 240, 255))
    c.shade(-28, -54, 74, -15, 8, 26)
    for x in (-52, 30, 52):
        c.wheel(x, 12)
    return c.finish()


def truck_up_down():
    c = Canvas(-29, -74, 29, 54)
    # cab roof (the box hides its back)
    c.box(-24, -72, 24, -40, RED, radius=3)
    c.box(-24, -72, 24, -64, GLASS)  # windscreen at the front (top)
    c.line(-20, -69, 14, -67, GLINT)
    c.box(-18, -62, 18, -52, RED_LIGHT)
    c.box(-28, -66, -24, -62, BUMPER)  # mirrors
    c.box(24, -66, 28, -62, BUMPER)
    # box: roof, then the back with its roll-up door
    c.box(-26, -52, 26, 22, WHITE)
    c.box(-23, -49, 23, 19, WHITE_LIGHT)
    for y in range(-30, 20, 22):
        c.line(-23, y, 23, y, PANEL)
    c.line(-26, -52, 26, -52, (246, 245, 240, 255))
    c.shade(-26, -52, 26, 21, 6, 22)
    c.box(-26, 22, 26, 44, WHITE_SIDE)
    c.box(-20, 24, 20, 42, (160, 158, 150, 255))
    for y in range(26, 42, 3):
        c.line(-19, y, 19, y, (140, 138, 130, 255))
    c.box(-25, 36, -22, 40, TAIL)
    c.box(22, 36, 25, 40, TAIL)
    c.box(-25, 32, -22, 34, AMBER)
    c.box(22, 32, 25, 34, AMBER)
    c.shade(-26, 22, 26, 44, 0, 30)
    c.box(-28, 44, 28, 47, BUMPER)
    c.box(-27, 46, -17, 53, TYRE)
    c.box(17, 46, 27, 53, TYRE)
    return c.finish()


def cast_shadow(body, height, *more):
    """The cars' kind of shadow: the ground under the body, stretched to the
    bottom right by its height. body: (x0, y0, x1, y1) around the centre;
    more: further (body, height) pairs in the same shadow. Returns (picture, offset)."""
    parts = [(body, height), *more]
    stretch = [(round(h * 0.8), round(h * 0.7)) for _, h in parts]
    left = min(b[0] for b, _ in parts)
    top = min(b[1] for b, _ in parts)
    right = max(b[2] + sx for (b, _), (sx, _) in zip(parts, stretch))
    bottom = max(b[3] + sy for (b, _), (_, sy) in zip(parts, stretch))
    mask = Image.new('RGB', (right - left + 1, bottom - top + 1), (0, 0, 0))
    d = ImageDraw.Draw(mask)
    for ((x0, y0, x1, y1), _), (sx, sy) in zip(parts, stretch):
        x0, x1, y0, y1 = x0 - left, x1 - left, y0 - top, y1 - top
        d.polygon([(x0, y0), (x1, y0), (x1 + sx, y0 + sy), (x1 + sx, y1 + sy), (x0 + sx, y1 + sy), (x0, y1)], fill=(255, 255, 255))
    img, pad = soft_shadow(mask)
    return img, [left - pad, top - pad]


WOOD_TOP = (164, 112, 66, 255)
WOOD_PLANK = (138, 92, 52, 255)
WOOD_EDGE = (104, 66, 38, 255)
WOOD_POST = (124, 82, 46, 255)
WOOD_DARK = (92, 58, 32, 255)
WOOD_RAIL = (150, 102, 58, 255)
DECK_HEIGHT = 56  # the floor's height above the ground, in pixels: players walk under it


def deck():
    """Deck1: the floor over x -140..60 (5 cells), y -28..28 (2 cells), stairs
    down to the right over x 60..140 in the front row (y 0..28)."""
    H = DECK_HEIGHT
    c = Canvas(-143, -105, 143, 34)
    # back railing, along the far edge of the floor
    c.box(-140, -28 - H - 18, 60, -28 - H - 15, WOOD_RAIL)
    for x in range(-140, 61, 8):
        c.box(x, -28 - H - 15, x + 1, -28 - H, WOOD_DARK)
    # front posts, under the floor's front edge
    for x in (-140, -43, 53):
        c.box(x, 28 - H + 7, x + 6, 28, WOOD_POST)
        c.box(x + 4, 28 - H + 7, x + 6, 28, WOOD_DARK)
    # the floor: planks, then its edge board
    c.box(-140, -28 - H, 60, 28 - H, WOOD_TOP)
    for y in range(-28 - H + 6, 28 - H, 7):
        c.line(-140, y, 60, y, WOOD_PLANK)
    c.shade(-140, -28 - H, 60, 28 - H - 1, 8, 18)
    c.box(-140, 28 - H, 60, 28 - H + 7, WOOD_EDGE)
    # side railings
    for x in (-140, 58):
        c.box(x, -28 - H - 18, x + 2, 28 - H - 16, WOOD_RAIL)
    # front railing, open at the top of the stairs
    c.box(-140, 28 - H - 18, 40, 28 - H - 15, WOOD_RAIL)
    for x in range(-140, 41, 8):
        c.box(x, 28 - H - 15, x + 1, 28 - H, WOOD_RAIL)
    for x in (-140, -43, 38):
        c.box(x, 28 - H - 20, x + 3, 28 - H, WOOD_POST)
    # stairs: eight steps down to the ground at the right
    steps = 8
    rise = H // steps
    for i in range(steps):
        x0 = 60 + i * 10
        h = H - (i + 1) * rise
        c.box(x0, 0 - h, x0 + 10, 28 - h, WOOD_TOP)
        c.line(x0, 0 - h, x0, 28 - h, WOOD_PLANK)
        c.box(x0, 28 - h, x0 + 10, 28 - h + rise - 1, WOOD_EDGE)
    c.d.polygon([(60 + c.ox, 28 - H + 7 + c.oy), (140 + c.ox, 28 + c.oy), (140 + c.ox, 31 + c.oy), (60 + c.ox, 28 - H + 14 + c.oy)], fill=WOOD_DARK)
    c.d.line([40 + c.ox, 28 - H - 17 + c.oy, 136 + c.ox, 28 - 17 + c.oy], fill=WOOD_RAIL, width=3)
    for i in (0, 4, 7):
        x = 62 + i * 10
        h = H - (i + 1) * rise
        c.box(x, 28 - h - 17, x + 2, 28 - h, WOOD_POST)
    return c.finish()


def mirrored(picture):
    """The picture flipped left to right about the prop's centre (the canvas is symmetric)."""
    img, offset = picture
    return img.transpose(Image.FLIP_LEFT_RIGHT), offset


def pictures():
    """name -> (picture, [dx, dy])"""
    return {
        'Bus1': bus_across(),
        'Bus2': bus_up_down(),
        'Truck1': truck_across(),
        'Truck2': truck_up_down(),
        'Bus_Shadow1': cast_shadow((-100, -20, 100, 20), 24),
        'Bus_Shadow2': cast_shadow((-26, -78, 26, 78), 24),
        'Truck_Shadow1': cast_shadow((-74, -20, 74, 20), 30),
        'Truck_Shadow2': cast_shadow((-26, -52, 26, 52), 30),
        'Deck1': deck(),
        'Deck2': mirrored(deck()),
        # the floor's shadow falls beside it (light from the top left), the stairs' under them
        'Deck_Shadow1': cast_shadow((-140, -28, 60, 28), DECK_HEIGHT, ((60, 0, 140, 28), DECK_HEIGHT // 2)),
        'Deck_Shadow2': cast_shadow((-60, -28, 140, 28), DECK_HEIGHT, ((-140, 0, -60, 28), DECK_HEIGHT // 2)),
    }


def add(out):
    """Write the pictures into <out>/sprites/ and their entries into <out>/atlas.json."""
    path = os.path.join(out, 'atlas.json')
    with open(path) as f:
        atlas = json.load(f)
    os.makedirs(os.path.join(out, 'sprites'), exist_ok=True)
    for name, (img, (dx, dy)) in pictures().items():
        img.save(os.path.join(out, 'sprites', name + '.png'), optimize=True)
        atlas[name] = {'image': name, 'frames': [[0, 0, img.width, img.height, dx, dy]]}
    with open(path, 'w') as f:
        json.dump(atlas, f, separators=(',', ':'))
    print('  extra props: bus, truck and deck')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join('client', 'assets', 'game'))
    add(ap.parse_args().out)


if __name__ == '__main__':
    main()
