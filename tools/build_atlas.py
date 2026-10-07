"""Bake the sprite atlas used by the browser client.

    python3 tools/build_atlas.py --assets-as decompiled/boxhead/assets/Assets.as \
        --images extracted/images --out client/assets/game

`Assets.as` is the decompiled `boxhead.assets.Assets` class (see
tools/abc_decompile.py).  Its `lookup()` switch lists, for every in-game
graphic, which bitmaps from assets.swf to combine and the source rectangle
and draw offset of each animation frame.  This script replays that table:

* `combine(color, alpha)` sheets become one RGBA PNG (alpha from the red
  channel of the alpha sheet, exactly like BitmapData.copyChannel).
* `processShadow(...)` sprites become soft black silhouettes.
* Everything else is copied as is.

Output: `<out>/sprites/<Name>.png` plus `<out>/atlas.json`:
    {"BondBody": {"image": "BondBody", "frames": [[x, y, w, h, ox, oy], ...]}, ...}
A single-image sprite has one frame covering the whole image.
"""
import argparse
import json
import os
import re

from PIL import Image, ImageFilter

NUM = r'[-+0-9 ()]+'


def evaluate(expr):
    if not re.fullmatch(r'[-+0-9 ()]+', expr):
        raise ValueError(expr)
    return int(eval(expr, {'__builtins__': {}}))  # digits, parens and +/- only


def parse_cases(lines):
    """Map asset name -> label of its case body in lookup()."""
    cases = {}
    for i, line in enumerate(lines):
        m = re.match(r'\s*if \("([^"]+)" !== _loc6\) goto L\d+;', line)
        if m:
            target = re.match(r'\s*goto (L\d+);', lines[i + 1])
            cases[m.group(1)] = target.group(1)
    return cases


def string_expr(expr, name):
    parts = [p.strip() for p in expr.strip('() ').split('+')]
    out = ''
    for p in parts:
        if p == 'arg1':
            out += name
        elif p.startswith('"'):
            out += p.strip('"')
        else:
            raise ValueError(expr)
    return out


def parse_body(lines, start, name):
    spec = {'frames': []}
    for line in lines[start + 1:]:
        s = line.strip()
        if s.startswith('goto L') or s.startswith('L') and s.endswith(':'):
            break
        m = re.search(r'combine\(((?:\([^()]*\))|"[^"]*"), ((?:\([^()]*\))|"[^"]*")\)', s)
        if m and 'new ThingClip' in s:
            spec['color'] = string_expr(m.group(1), name)
            spec['alpha'] = string_expr(m.group(2), name)
            continue
        m = re.search(r'new ThingClip\(AssetPool\.pool\[(arg1|"[^"]+")\]\)', s)
        if m:
            spec['image'] = name if m.group(1) == 'arg1' else m.group(1).strip('"')
            continue
        m = re.search(r'new ThingSprite\(AssetPool\.pool\[(arg1|"[^"]+")\], new Point\((.+)\)\)', s)
        if m:
            spec['image'] = name if m.group(1) == 'arg1' else m.group(1).strip('"')
            point = m.group(2)
            if s.count('processShadow('):
                spec['shadow'] = True
                point = point[:point.rfind(')')] if point.count(')') > point.count('(') else point
            depth, split = 0, None
            for i, ch in enumerate(point):
                depth += ch == '('
                depth -= ch == ')'
                if ch == ',' and depth == 0:
                    split = i
            spec['offset'] = [evaluate(point[:split]), evaluate(point[split + 1:])]
            continue
        m = re.search(r'addFrame\(new Rectangle\((\d+), (\d+), (\d+), (\d+)\), new Point\((' + NUM + r'), (' + NUM + r')\)\)', s)
        if m:
            spec['frames'].append([int(m.group(i)) for i in range(1, 5)] + [evaluate(m.group(5)), evaluate(m.group(6))])
            continue
        if 'SHADOW_BLUR' in s and 'applyFilter' in s:
            spec['blur'] = True
    return spec


def red_to_alpha(img):
    r = img.convert('RGBA').split()[0]
    black = Image.new('RGBA', img.size, (0, 0, 0, 0))
    black.putalpha(r)
    return black


def shadow(img):
    """Approximate processShadow: black silhouette + soft offset drop shadow."""
    pad = 4
    sil = red_to_alpha(img)
    out = Image.new('RGBA', (img.width + pad * 2, img.height + pad * 2), (0, 0, 0, 0))
    drop = Image.new('RGBA', out.size, (0, 0, 0, 0))
    drop.paste(sil, (pad + 2, pad + 2))
    a = drop.split()[3].point(lambda v: int(v * 0.7)).filter(ImageFilter.GaussianBlur(1))
    drop.putalpha(a)
    out.alpha_composite(drop)
    out.alpha_composite(Image.new('RGBA', out.size), (0, 0))
    base = Image.new('RGBA', out.size, (0, 0, 0, 0))
    base.paste(sil, (pad, pad))
    out.alpha_composite(base)
    return out, pad


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--assets-as', required=True)
    ap.add_argument('--images', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    lines = open(args.assets_as).read().split('\n')
    labels = {}
    for i, line in enumerate(lines):
        m = re.match(r'\s*(L\d+):$', line)
        if m:
            labels[m.group(1)] = i
    os.makedirs(os.path.join(args.out, 'sprites'), exist_ok=True)
    atlas, baked = {}, {}
    for name, label in parse_cases(lines).items():
        spec = parse_body(lines, labels[label], name)
        try:
            if 'color' in spec:
                key = spec['color'] + '+' + spec['alpha']
                if key not in baked:
                    img = Image.open(os.path.join(args.images, spec['color'] + '.png')).convert('RGBA')
                    img.putalpha(Image.open(os.path.join(args.images, spec['alpha'] + '.png')).convert('RGBA').split()[0])
                    img.save(os.path.join(args.out, 'sprites', name + '.png'), optimize=True)
                    baked[key] = name
                image = baked[key]
            elif 'image' in spec:
                img = Image.open(os.path.join(args.images, spec['image'] + '.png')).convert('RGBA')
                image = name
                if spec.get('shadow'):
                    img, pad = shadow(img)
                    spec['offset'] = [spec['offset'][0] - pad, spec['offset'][1] - pad]
                elif spec.get('blur'):
                    img = red_to_alpha(img).filter(ImageFilter.GaussianBlur(1))
                img.save(os.path.join(args.out, 'sprites', name + '.png'), optimize=True)
            else:
                print('no source for', name)
                continue
        except FileNotFoundError as error:
            print('missing bitmap for', name, '-', error.filename)
            continue
        frames = spec['frames'] or [[0, 0, img.width, img.height] + spec.get('offset', [0, 0])]
        atlas[name] = {'image': image, 'frames': frames}
    with open(os.path.join(args.out, 'atlas.json'), 'w') as f:
        json.dump(atlas, f, separators=(',', ':'))
    print(len(atlas), 'sprites,', len(set(a['image'] for a in atlas.values())), 'images')


if __name__ == '__main__':
    main()
