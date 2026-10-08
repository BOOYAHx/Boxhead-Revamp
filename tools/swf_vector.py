"""Export the vector art of a Flash SWF (shapes, sprites, buttons, text,
fonts) so the browser can rebuild the original screens.

    python3 tools/swf_vector.py Lobby.swf --out client/assets/game/ui

Writes:
    library.svg   every shape and static text as an SVG <g id="c<id>">, with
                  its gradients and bitmap patterns, ready to <use>
    library.json  the display lists: sprites (frames of placed children with
                  matrix, colour transform, instance name, masks, filters,
                  blend mode), buttons (up/over/down/hit states), text fields,
                  symbol class names, fonts
    bitmaps/      the bitmaps the art uses (JPEG or PNG)
    fonts/        embedded fonts as TrueType (needs fontTools; skipped without)

Coordinates are converted from twips to pixels. Shapes follow the Flash
rules: each edge separates two fills (left and right), fills use the
even-odd rule unless the shape says otherwise, lines are drawn over fills.
"""
import argparse
import io
import json
import math
import os
import struct
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import swf_extract  # noqa: E402

TWIPS = 20.0
GRADIENT_SQUARE = 16384 / TWIPS  # gradients are defined on a 32768-twip square
BLEND_MODES = {2: 'normal', 3: 'multiply', 4: 'screen', 5: 'lighten', 6: 'darken', 7: 'difference', 8: 'plus-lighter',
               9: 'difference', 10: 'difference', 11: 'normal', 12: 'normal', 13: 'overlay', 14: 'hard-light'}


# --- reading --------------------------------------------------------------------------

class Reader:
    """Bit and byte reader for SWF structures."""

    def __init__(self, data, pos=0):
        self.data = data
        self.bit = pos * 8

    @property
    def pos(self):
        return (self.bit + 7) >> 3

    def align(self):
        self.bit = (self.bit + 7) & ~7

    def ub(self, n):
        if n == 0:
            return 0
        start, end = self.bit, self.bit + n
        first, last = start >> 3, (end - 1) >> 3
        chunk = int.from_bytes(self.data[first:last + 1], 'big')
        shift = (last + 1) * 8 - end
        self.bit = end
        return (chunk >> shift) & ((1 << n) - 1)

    def sb(self, n):
        value = self.ub(n)
        if n and value >> (n - 1):
            value -= 1 << n
        return value

    def fb(self, n):
        return self.sb(n) / 65536.0

    def _unpack(self, fmt, size):
        self.align()
        value = struct.unpack_from(fmt, self.data, self.bit >> 3)[0]
        self.bit += size * 8
        return value

    def u8(self):
        return self._unpack('<B', 1)

    def u16(self):
        return self._unpack('<H', 2)

    def s16(self):
        return self._unpack('<h', 2)

    def u32(self):
        return self._unpack('<I', 4)

    def fixed(self):
        return self._unpack('<i', 4) / 65536.0

    def fixed8(self):
        return self._unpack('<h', 2) / 256.0

    def float(self):
        return self._unpack('<f', 4)

    def string(self):
        self.align()
        start = self.bit >> 3
        end = self.data.index(b'\0', start)
        self.bit = (end + 1) * 8
        return self.data[start:end].decode('utf-8', 'replace')

    def bytes(self, n):
        self.align()
        start = self.bit >> 3
        self.bit += n * 8
        return self.data[start:start + n]

    def rect(self):
        self.align()
        n = self.ub(5)
        xmin, xmax, ymin, ymax = (self.sb(n) / TWIPS for _ in range(4))
        return [xmin, ymin, xmax, ymax]

    def matrix(self):
        """(a, b, c, d, tx, ty) with the translation in pixels."""
        self.align()
        a = d = 1.0
        b = c = 0.0
        if self.ub(1):
            n = self.ub(5)
            a, d = self.fb(n), self.fb(n)
        if self.ub(1):
            n = self.ub(5)
            b, c = self.fb(n), self.fb(n)
        n = self.ub(5)
        tx, ty = self.sb(n) / TWIPS, self.sb(n) / TWIPS
        return [a, b, c, d, tx, ty]

    def cxform(self, alpha):
        """[[mult r, g, b, a], [add r, g, b, a]]: multipliers as factors, additions in 0..255."""
        self.align()
        has_add, has_mult, n = self.ub(1), self.ub(1), self.ub(4)
        count = 4 if alpha else 3
        mult = [1.0, 1.0, 1.0, 1.0]
        add = [0, 0, 0, 0]
        if has_mult:
            for i in range(count):
                mult[i] = self.sb(n) / 256.0
        if has_add:
            for i in range(count):
                add[i] = self.sb(n)
        return [mult, add]

    def rgb(self):
        return [self.u8(), self.u8(), self.u8(), 255]

    def rgba(self):
        return [self.u8(), self.u8(), self.u8(), self.u8()]


def read_tags(data, pos=0):
    while pos + 2 <= len(data):
        header = struct.unpack_from('<H', data, pos)[0]
        pos += 2
        code, length = header >> 6, header & 0x3f
        if length == 0x3f:
            length = struct.unpack_from('<I', data, pos)[0]
            pos += 4
        yield code, data[pos:pos + length]
        pos += length
        if code == 0:
            break


# --- shapes --------------------------------------------------------------------------

def read_gradient(r, version, focal=False):
    r.align()
    spread, interpolation, count = r.ub(2), r.ub(2), r.ub(4)
    stops = []
    for _ in range(count):
        ratio = r.u8()
        stops.append([ratio, r.rgba() if version >= 3 else r.rgb()])
    gradient = {'spread': spread, 'interpolation': interpolation, 'stops': stops}
    if focal:
        gradient['focal'] = r.fixed8()
    return gradient


def read_fill_style(r, version):
    kind = r.u8()
    if kind == 0x00:
        return {'type': 'solid', 'color': r.rgba() if version >= 3 else r.rgb()}
    if kind in (0x10, 0x12, 0x13):
        m = r.matrix()
        return {'type': {0x10: 'linear', 0x12: 'radial', 0x13: 'focal'}[kind], 'matrix': m, 'gradient': read_gradient(r, version, kind == 0x13)}
    if kind in (0x40, 0x41, 0x42, 0x43):
        bitmap = r.u16()
        return {'type': 'bitmap', 'bitmap': bitmap, 'matrix': r.matrix(), 'repeat': kind in (0x40, 0x42), 'smooth': kind in (0x40, 0x41)}
    raise ValueError(f'unknown fill style {kind:#x}')


def read_line_style(r, version):
    width = r.u16() / TWIPS
    if version < 4:
        return {'width': width, 'color': r.rgba() if version >= 3 else r.rgb(), 'cap': 0, 'join': 0}
    r.align()
    start_cap, join, has_fill = r.ub(2), r.ub(2), r.ub(1)
    r.ub(1), r.ub(1), r.ub(1), r.ub(5)  # no h/v scale, pixel hinting, reserved
    r.ub(1)  # no close
    r.ub(2)  # end cap (same as start in practice)
    style = {'width': width, 'cap': start_cap, 'join': join}
    if join == 2:
        style['miter'] = r.u16() / 256.0
    if has_fill:
        style['fill'] = read_fill_style(r, version)
        stops = style['fill'].get('gradient', {}).get('stops')
        style['color'] = stops[0][1] if stops else [0, 0, 0, 255]
    else:
        style['color'] = r.rgba()
    return style


def read_styles(r, version):
    count = r.u8()
    if count == 0xff and version >= 2:
        count = r.u16()
    fills = [read_fill_style(r, version) for _ in range(count)]
    count = r.u8()
    if count == 0xff and version >= 2:
        count = r.u16()
    lines = [read_line_style(r, version) for _ in range(count)]
    return fills, lines


def read_shape_records(r, version, fills, lines):
    """Records as ('style', {...}) / ('line', dx, dy) / ('curve', cdx, cdy, adx, ady), in twips."""
    r.align()
    fill_bits, line_bits = r.ub(4), r.ub(4)
    records = []
    while True:
        if r.ub(1) == 0:
            flags = r.ub(5)
            if flags == 0:
                break
            rec = {}
            if flags & 1:
                n = r.ub(5)
                rec['move'] = (r.sb(n), r.sb(n))
            if flags & 2:
                rec['fill0'] = r.ub(fill_bits)
            if flags & 4:
                rec['fill1'] = r.ub(fill_bits)
            if flags & 8:
                rec['line'] = r.ub(line_bits)
            if flags & 16:
                rec['styles'] = read_styles(r, version)
                r.align()
                fill_bits, line_bits = r.ub(4), r.ub(4)
            records.append(('style', rec))
        elif r.ub(1):  # straight edge
            n = r.ub(4) + 2
            if r.ub(1):
                records.append(('line', r.sb(n), r.sb(n)))
            elif r.ub(1):
                records.append(('line', 0, r.sb(n)))
            else:
                records.append(('line', r.sb(n), 0))
        else:
            n = r.ub(4) + 2
            records.append(('curve', r.sb(n), r.sb(n), r.sb(n), r.sb(n)))
    return records


def parse_shape(code, body):
    version = {2: 1, 22: 2, 32: 3, 83: 4}[code]
    r = Reader(body)
    cid = r.u16()
    bounds = r.rect()
    evenodd = True
    if version == 4:
        r.rect()
        evenodd = not (r.u8() & 0x04)
    fills, lines = read_styles(r, version)
    records = read_shape_records(r, version, fills, lines)
    return {'id': cid, 'bounds': bounds, 'fills': fills, 'lines': lines, 'records': records, 'evenodd': evenodd}


def shape_groups(fills, lines, records):
    """Split records into style groups of {fills, lines, fill_edges, line_edges}.
    Edges are (x0, y0, control or None, x1, y1) in twips; a fill's edges have it on the right."""
    groups = []
    group = {'fills': fills, 'lines': lines, 'fill': defaultdict(list), 'line': defaultdict(list)}
    x = y = 0
    fill0 = fill1 = line = 0
    for rec in records:
        if rec[0] == 'style':
            d = rec[1]
            if 'styles' in d:
                groups.append(group)
                group = {'fills': d['styles'][0], 'lines': d['styles'][1], 'fill': defaultdict(list), 'line': defaultdict(list)}
                fill0 = fill1 = line = 0
            if 'move' in d:
                x, y = d['move']
            fill0 = d.get('fill0', fill0)
            fill1 = d.get('fill1', fill1)
            line = d.get('line', line)
            continue
        if rec[0] == 'line':
            edge = (x, y, None, x + rec[1], y + rec[2])
        else:
            cx, cy = x + rec[1], y + rec[2]
            edge = (x, y, (cx, cy), cx + rec[3], cy + rec[4])
        if fill1:
            group['fill'][fill1].append(edge)
        if fill0:
            group['fill'][fill0].append((edge[3], edge[4], edge[2], edge[0], edge[1]))
        if line:
            group['line'][line].append(edge)
        x, y = edge[3], edge[4]
    groups.append(group)
    return groups


def contours(edges):
    """Join edges into closed loops: follow each edge with an unused edge starting where it ends."""
    by_start = defaultdict(list)
    for i, e in enumerate(edges):
        by_start[(e[0], e[1])].append(i)
    used = [False] * len(edges)
    loops = []
    for i, e in enumerate(edges):
        if used[i]:
            continue
        used[i] = True
        loop = [e]
        start, end = (e[0], e[1]), (e[3], e[4])
        while end != start:
            nxt = next((j for j in by_start.get(end, ()) if not used[j]), None)
            if nxt is None:
                break
            used[nxt] = True
            loop.append(edges[nxt])
            end = (edges[nxt][3], edges[nxt][4])
        loops.append(loop)
    return loops


def num(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def path_data(loops, close=True, scale=1 / TWIPS):
    out = []
    for loop in loops:
        px, py = None, None
        for x0, y0, c, x1, y1 in loop:
            if (x0, y0) != (px, py):
                out.append(f'M{num(x0 * scale)} {num(y0 * scale)}')
            if c is None:
                out.append(f'L{num(x1 * scale)} {num(y1 * scale)}')
            else:
                out.append(f'Q{num(c[0] * scale)} {num(c[1] * scale)} {num(x1 * scale)} {num(y1 * scale)}')
            px, py = x1, y1
        if close and loop and (loop[0][0], loop[0][1]) == (loop[-1][3], loop[-1][4]):
            out.append('Z')
    return ''.join(out)


def strokes(edges):
    """Lines in drawing order, split where they jump."""
    loops, current = [], []
    for e in edges:
        if current and (current[-1][3], current[-1][4]) != (e[0], e[1]):
            loops.append(current)
            current = []
        current.append(e)
    if current:
        loops.append(current)
    return loops


def color(c):
    return f'#{c[0]:02x}{c[1]:02x}{c[2]:02x}'


def matrix_attr(m):
    if m[:4] == [1.0, 0.0, 0.0, 1.0]:
        if m[4] == 0 and m[5] == 0:
            return ''
        return f'translate({num(m[4])} {num(m[5])})'
    return 'matrix(' + ' '.join(f'{v:.5g}' if i < 4 else num(v) for i, v in enumerate(m)) + ')'


class SvgWriter:
    """Accumulates <defs> (gradients, patterns, filters) and symbol bodies."""

    def __init__(self, bitmap_url):
        self.defs = []
        self.bodies = []
        self.counter = 0
        self.bitmap_url = bitmap_url  # bitmap id -> (url, width, height)

    def new_id(self, prefix):
        self.counter += 1
        return f'{prefix}{self.counter}'

    def paint(self, style):
        """SVG paint for a fill style: ('#rrggbb', opacity) or ('url(#id)', 1)."""
        kind = style['type']
        if kind == 'solid':
            return color(style['color']), style['color'][3] / 255
        if kind in ('linear', 'radial', 'focal'):
            g = style['gradient']
            gid = self.new_id('g')
            spread = ('pad', 'reflect', 'repeat')[min(g['spread'], 2)]
            interp = ' color-interpolation="linearRGB"' if g['interpolation'] == 1 else ''
            stops = ''.join(f'<stop offset="{num(ratio / 255)}" stop-color="{color(c)}"' + (f' stop-opacity="{num(c[3] / 255)}"' if c[3] != 255 else '') + '/>' for ratio, c in g['stops'])
            transform = matrix_attr(style['matrix'])
            t = f' gradientTransform="{transform}"' if transform else ''
            if kind == 'linear':
                self.defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{-GRADIENT_SQUARE}" y1="0" x2="{GRADIENT_SQUARE}" y2="0" spreadMethod="{spread}"{t}{interp}>{stops}</linearGradient>')
            else:
                fx = f' fx="{num(g.get("focal", 0) * GRADIENT_SQUARE)}"' if kind == 'focal' else ''
                self.defs.append(f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="{GRADIENT_SQUARE}"{fx} spreadMethod="{spread}"{t}{interp}>{stops}</radialGradient>')
            return f'url(#{gid})', 1
        if kind == 'bitmap':
            info = self.bitmap_url.get(style['bitmap'])
            if not info:
                return 'none', 0
            url, w, h = info
            pid = self.new_id('p')
            a, b, c, d, tx, ty = style['matrix']
            m = [a / TWIPS, b / TWIPS, c / TWIPS, d / TWIPS, tx, ty]
            smooth = '' if style['smooth'] else ' style="image-rendering:pixelated"'
            self.defs.append(f'<pattern id="{pid}" patternUnits="userSpaceOnUse" width="{w}" height="{h}" patternTransform="{matrix_attr(m)}">'
                             f'<image href="{url}" width="{w}" height="{h}"{smooth}/></pattern>')
            return f'url(#{pid})', 1
        return 'none', 0

    def shape_body(self, shape):
        out = []
        rule = ' fill-rule="evenodd"' if shape['evenodd'] else ''
        for group in shape_groups(shape['fills'], shape['lines'], shape['records']):
            for index in sorted(group['fill']):
                if index > len(group['fills']):
                    continue
                paint, opacity = self.paint(group['fills'][index - 1])
                d = path_data(contours(group['fill'][index]))
                if not d or paint == 'none':
                    continue
                op = f' fill-opacity="{num(opacity)}"' if opacity < 1 else ''
                out.append(f'<path d="{d}" fill="{paint}"{op}{rule}/>')
            for index in sorted(group['line']):
                if index > len(group['lines']):
                    continue
                style = group['lines'][index - 1]
                d = path_data(strokes(group['line'][index]), close=False)
                if not d:
                    continue
                if 'fill' in style:
                    paint, opacity = self.paint(style['fill'])
                else:
                    paint, opacity = color(style['color']), style['color'][3] / 255
                width = style['width']
                hairline = width < 1 / TWIPS * 2
                attrs = f' stroke="{paint}" stroke-width="{num(max(width, 1) if hairline else width)}"'
                if opacity < 1:
                    attrs += f' stroke-opacity="{num(opacity)}"'
                attrs += ' stroke-linecap="{}" stroke-linejoin="{}"'.format(('round', 'butt', 'square')[min(style['cap'], 2)], ('round', 'bevel', 'miter')[min(style['join'], 2)])
                if style.get('miter'):
                    attrs += f' stroke-miterlimit="{num(style["miter"])}"'
                if hairline:
                    attrs += ' vector-effect="non-scaling-stroke"'
                out.append(f'<path d="{d}" fill="none"{attrs}/>')
        return ''.join(out)


# --- fonts and text ---------------------------------------------------------------------

def parse_font(code, body):
    """DefineFont2/3: glyph shapes, codes, advances, metrics. Units: Font3 = 20480/em, Font2 = 1024/em."""
    r = Reader(body)
    fid, flags = r.u16(), r.u8()
    r.u8()  # language
    name = r.bytes(r.u8()).decode('latin-1').rstrip('\0')
    count = r.u16()
    wide_offsets, wide_codes = flags & 0x08, flags & 0x04
    table = r.bit >> 3
    offsets = [struct.unpack_from('<I' if wide_offsets else '<H', body, table + i * (4 if wide_offsets else 2))[0] for i in range(count)]
    code_offset = struct.unpack_from('<I' if wide_offsets else '<H', body, table + count * (4 if wide_offsets else 2))[0]
    glyphs = []
    for i in range(count):
        g = Reader(body, table + offsets[i])
        records = read_shape_records(g, 1, [], [])
        glyphs.append(records)
    pos = table + code_offset
    codes = []
    for _ in range(count):
        if wide_codes:
            codes.append(struct.unpack_from('<H', body, pos)[0])
            pos += 2
        else:
            codes.append(body[pos])
            pos += 1
    font = {'id': fid, 'name': name, 'bold': bool(flags & 1), 'italic': bool(flags & 2), 'em': 20480 if code == 75 else 1024,
            'glyphs': glyphs, 'codes': codes, 'advances': None, 'ascent': None, 'descent': None, 'leading': 0}
    if flags & 0x80:
        r2 = Reader(body, pos)
        font['ascent'], font['descent'], font['leading'] = r2.u16(), r2.u16(), r2.s16()
        font['advances'] = [r2.s16() for _ in range(count)]
    return font


def glyph_edges(records):
    """A glyph's filled edges (fill style 1 on either side), in font units."""
    edges = []
    for group in shape_groups([], [], records):
        for index in group['fill']:
            edges.extend(group['fill'][index])
    return edges


def parse_text(code, body):
    """DefineText/DefineText2: positioned glyph runs."""
    r = Reader(body)
    tid = r.u16()
    bounds = r.rect()
    m = r.matrix()
    glyph_bits, advance_bits = r.u8(), r.u8()
    runs = []
    font = color_ = None
    height = 0
    x = y = 0.0
    while True:
        r.align()
        flags = r.u8()
        if flags == 0:
            break
        if flags & 0x08:
            font = r.u16()
        if flags & 0x04:
            color_ = r.rgba() if code == 33 else r.rgb()
        if flags & 0x01:
            x = r.s16() / TWIPS
        if flags & 0x02:
            y = r.s16() / TWIPS
        if flags & 0x08:
            height = r.u16() / TWIPS
        count = r.u8()
        glyphs = []
        for _ in range(count):
            index = r.ub(glyph_bits)
            advance = r.sb(advance_bits) / TWIPS
            glyphs.append((index, x))
            x += advance
        runs.append({'font': font, 'color': color_, 'height': height, 'y': y, 'glyphs': glyphs})
    return {'id': tid, 'bounds': bounds, 'matrix': m, 'runs': runs}


def text_body(text, fonts):
    """Static text as glyph outlines: exact, independent of installed fonts."""
    out = []
    for run in text['runs']:
        font = fonts.get(run['font'])
        if not font or not run['color']:
            continue
        scale = run['height'] / font['em']
        paths = []
        for index, gx in run['glyphs']:
            if index >= len(font['glyphs']):
                continue
            d = path_data(contours(glyph_edges(font['glyphs'][index])), scale=scale)
            if d:
                paths.append(f'<path transform="translate({num(gx)} {num(run["y"])})" d="{d}"/>')
        if paths:
            c = run['color']
            op = f' fill-opacity="{num(c[3] / 255)}"' if c[3] != 255 else ''
            out.append(f'<g fill="{color(c)}"{op} fill-rule="evenodd">' + ''.join(paths) + '</g>')
    t = matrix_attr(text['matrix'])
    return (f'<g transform="{t}">' if t else '<g>') + ''.join(out) + '</g>'


def parse_edit_text(body):
    r = Reader(body)
    tid = r.u16()
    bounds = r.rect()
    f1, f2 = r.u8(), r.u8()
    field = {'id': tid, 'bounds': bounds, 'wordWrap': bool(f1 & 0x40), 'multiline': bool(f1 & 0x20), 'password': bool(f1 & 0x10),
             'readOnly': bool(f1 & 0x08), 'autoSize': bool(f2 & 0x40), 'noSelect': bool(f2 & 0x10), 'border': bool(f2 & 0x08),
             'html': bool(f2 & 0x02), 'useOutlines': bool(f2 & 0x01), 'font': None, 'fontClass': None, 'size': 12, 'color': [0, 0, 0, 255],
             'maxLength': 0, 'align': 0, 'leftMargin': 0, 'rightMargin': 0, 'indent': 0, 'leading': 0, 'variable': '', 'text': ''}
    if f1 & 0x01:
        field['font'] = r.u16()
    if f2 & 0x80:
        field['fontClass'] = r.string()
    if f1 & 0x01 or f2 & 0x80:
        field['size'] = r.u16() / TWIPS
    if f1 & 0x04:
        field['color'] = r.rgba()
    if f1 & 0x02:
        field['maxLength'] = r.u16()
    if f2 & 0x20:
        field['align'] = r.u8()
        field['leftMargin'] = r.u16() / TWIPS
        field['rightMargin'] = r.u16() / TWIPS
        field['indent'] = r.u16() / TWIPS
        field['leading'] = r.s16() / TWIPS
    field['variable'] = r.string()
    if f1 & 0x80:
        field['text'] = r.string()
    return field


# --- display lists -----------------------------------------------------------------------

def read_filters(r):
    filters = []
    for _ in range(r.u8()):
        kind = r.u8()
        if kind == 0:  # drop shadow
            c = r.rgba()
            bx, by, angle, distance, strength = r.fixed(), r.fixed(), r.fixed(), r.fixed(), r.fixed8()
            flags = r.u8()
            filters.append({'type': 'shadow', 'color': c, 'blurX': bx, 'blurY': by, 'angle': angle, 'distance': distance,
                            'strength': strength, 'inner': bool(flags & 0x80), 'knockout': bool(flags & 0x40), 'passes': flags & 0x1f})
        elif kind == 1:
            bx, by = r.fixed(), r.fixed()
            filters.append({'type': 'blur', 'blurX': bx, 'blurY': by, 'passes': r.u8() >> 3})
        elif kind == 2:
            c = r.rgba()
            bx, by, strength = r.fixed(), r.fixed(), r.fixed8()
            flags = r.u8()
            filters.append({'type': 'glow', 'color': c, 'blurX': bx, 'blurY': by, 'strength': strength,
                            'inner': bool(flags & 0x80), 'knockout': bool(flags & 0x40), 'passes': flags & 0x1f})
        elif kind == 3:
            shadow, highlight = r.rgba(), r.rgba()
            bx, by, angle, distance, strength = r.fixed(), r.fixed(), r.fixed(), r.fixed(), r.fixed8()
            flags = r.u8()
            filters.append({'type': 'bevel', 'shadow': shadow, 'highlight': highlight, 'blurX': bx, 'blurY': by, 'angle': angle,
                            'distance': distance, 'strength': strength, 'inner': bool(flags & 0x80), 'knockout': bool(flags & 0x40),
                            'onTop': bool(flags & 0x10), 'passes': flags & 0x0f})
        elif kind in (4, 7):
            n = r.u8()
            colors = [r.rgba() for _ in range(n)]
            ratios = [r.u8() for _ in range(n)]
            bx, by, angle, distance, strength = r.fixed(), r.fixed(), r.fixed(), r.fixed(), r.fixed8()
            flags = r.u8()
            filters.append({'type': 'gradientglow' if kind == 4 else 'gradientbevel', 'colors': colors, 'ratios': ratios, 'blurX': bx,
                            'blurY': by, 'angle': angle, 'distance': distance, 'strength': strength, 'inner': bool(flags & 0x80),
                            'knockout': bool(flags & 0x40), 'passes': flags & 0x0f})
        elif kind == 5:
            mx, my = r.u8(), r.u8()
            divisor, bias = r.float(), r.float()
            values = [r.float() for _ in range(mx * my)]
            r.rgba()
            r.u8()
            filters.append({'type': 'convolution', 'x': mx, 'y': my, 'divisor': divisor, 'bias': bias, 'matrix': values})
        elif kind == 6:
            filters.append({'type': 'colormatrix', 'matrix': [r.float() for _ in range(20)]})
        else:
            raise ValueError(f'unknown filter {kind}')
    return filters


def parse_place(code, body):
    r = Reader(body)
    if code == 4:  # PlaceObject
        place = {'id': r.u16(), 'depth': r.u16(), 'matrix': r.matrix()}
        if r.pos < len(body):
            place['cxform'] = r.cxform(False)
        return place, False
    flags = r.u8()
    flags2 = r.u8() if code == 70 else 0
    place = {'depth': r.u16()}
    if flags2 & 0x08 or (flags2 & 0x10 and flags & 0x02):
        place['className'] = r.string()
    if flags & 0x02:
        place['id'] = r.u16()
    if flags & 0x04:
        place['matrix'] = r.matrix()
    if flags & 0x08:
        place['cxform'] = r.cxform(True)
    if flags & 0x10:
        place['ratio'] = r.u16()
    if flags & 0x20:
        place['name'] = r.string()
    if flags & 0x40:
        place['clipDepth'] = r.u16()
    if flags2 & 0x01:
        place['filters'] = read_filters(r)
    if flags2 & 0x02:
        place['blend'] = r.u8()
    # The last fields are sometimes left out (Flash writes a cacheAsBitmap
    # flag without its byte), so stop at the end of the tag.
    if flags2 & 0x04 and r.pos < len(body):
        r.u8()  # cacheAsBitmap
    if flags2 & 0x20 and r.pos < len(body):
        place['visible'] = bool(r.u8())
    return place, bool(flags & 0x01)


def parse_timeline(data):
    """Frames of a timeline: each frame is the full display list, sorted by depth."""
    frames, labels = [], {}
    display = {}
    for code, body in read_tags(data):
        if code in (4, 26, 70):
            place, move = parse_place(code, body)
            depth = place['depth']
            if move and depth in display:
                merged = dict(display[depth])
                if 'id' in place and place['id'] != merged.get('id'):
                    # Replaced character: it keeps the position and colour of the old one.
                    merged = {k: v for k, v in merged.items() if k in ('depth', 'matrix', 'cxform')}
                merged.update(place)
                display[depth] = merged
            else:
                display[depth] = place
        elif code in (5, 28):
            depth = struct.unpack_from('<H', body, 2 if code == 5 else 0)[0]
            display.pop(depth, None)
        elif code == 43:
            labels[body.split(b'\0', 1)[0].decode('utf-8', 'replace')] = len(frames)
        elif code == 1:
            frames.append([dict(display[d]) for d in sorted(display)])
    if display and not frames:
        frames.append([dict(display[d]) for d in sorted(display)])
    return frames, labels


def parse_button(code, body):
    r = Reader(body)
    bid = r.u16()
    states = {'up': [], 'over': [], 'down': [], 'hit': []}
    if code == 34:
        r.u8()  # track as menu
        r.u16()  # action offset
    while True:
        flags = r.u8()
        if flags == 0:
            break
        record = {'id': r.u16(), 'depth': r.u16(), 'matrix': r.matrix()}
        if code == 34:
            record['cxform'] = r.cxform(True)
            if flags & 0x10:
                record['filters'] = read_filters(r)
            if flags & 0x20:
                record['blend'] = r.u8()
        for bit, state in ((1, 'up'), (2, 'over'), (4, 'down'), (8, 'hit')):
            if flags & bit:
                states[state].append(record)
    for state in states.values():
        state.sort(key=lambda p: p['depth'])
    return {'id': bid, 'states': states}


# --- library -----------------------------------------------------------------------------

class Library:
    """All characters of one SWF."""

    def __init__(self, data):
        self.shapes, self.sprites, self.buttons, self.texts, self.edits = {}, {}, {}, {}, {}
        self.fonts, self.bitmaps, self.classes, self.scale9 = {}, {}, {}, {}
        self.font_names = {}
        self.root_frames, self.root_labels = [], {}
        tables = None
        root_tags = []
        for code, body in swf_extract.read_swf(data):
            try:
                if code in (2, 22, 32, 83):
                    s = parse_shape(code, body)
                    self.shapes[s['id']] = s
                elif code == 39:
                    sid, count = struct.unpack_from('<HH', body, 0)
                    frames, labels = parse_timeline(body[4:])
                    self.sprites[sid] = {'id': sid, 'frames': frames, 'labels': labels, 'frameCount': count}
                elif code in (7, 34):
                    b = parse_button(code, body)
                    self.buttons[b['id']] = b
                elif code in (11, 33):
                    t = parse_text(code, body)
                    self.texts[t['id']] = t
                elif code == 37:
                    e = parse_edit_text(body)
                    self.edits[e['id']] = e
                elif code in (48, 75):
                    f = parse_font(code, body)
                    self.fonts[f['id']] = f
                elif code == 88:
                    fid = struct.unpack_from('<H', body, 0)[0]
                    self.font_names[fid] = swf_extract.cstring(body, 2)[0]
                elif code == 8:
                    tables = body
                elif code in (20, 36):
                    self.bitmaps[struct.unpack_from('<H', body, 0)[0]] = ('lossless', code, body)
                elif code in (6, 21, 35, 90):
                    self.bitmaps[struct.unpack_from('<H', body, 0)[0]] = ('jpeg', code, body)
                elif code == 78:
                    r = Reader(body)
                    cid = r.u16()
                    self.scale9[cid] = r.rect()
                elif code == 76:
                    count = struct.unpack_from('<H', body, 0)[0]
                    pos = 2
                    for _ in range(count):
                        cid = struct.unpack_from('<H', body, pos)[0]
                        name, pos = swf_extract.cstring(body, pos + 2)
                        self.classes[name] = cid
                elif code in (1, 4, 5, 26, 28, 43, 70):
                    root_tags.append((code, body))
            except Exception as error:  # one odd tag should not stop the export
                print(f'  skipped tag {code}: {error}', file=sys.stderr)
        self.jpeg_tables = tables
        self.root_frames, self.root_labels = parse_timeline(b''.join(struct.pack('<H', (c << 6) | 0x3f) + struct.pack('<I', len(b)) + b for c, b in root_tags))

    def export_bitmaps(self, out_dir, url_prefix):
        """Write bitmaps; returns id -> (url, width, height). JPEGs without alpha stay JPEG."""
        os.makedirs(out_dir, exist_ok=True)
        urls = {}
        for bid, (kind, code, body) in self.bitmaps.items():
            try:
                if kind == 'lossless':
                    _, img = swf_extract.lossless(body, code == 36)
                    name = f'{bid}.png'
                    img.save(os.path.join(out_dir, name), optimize=True)
                else:
                    _, img = swf_extract.jpeg(body, code, self.jpeg_tables)
                    has_alpha = img.getextrema()[3][0] < 255
                    if has_alpha:
                        name = f'{bid}.png'
                        img.save(os.path.join(out_dir, name), optimize=True)
                    else:
                        name = f'{bid}.jpg'
                        img.convert('RGB').save(os.path.join(out_dir, name), quality=92)
                urls[bid] = (url_prefix + name, img.width, img.height)
            except Exception as error:
                print(f'  bitmap {bid} skipped: {error}', file=sys.stderr)
        return urls

    def svg_library(self, bitmap_urls):
        """<svg> with every shape and static text as <g id="c<id>">."""
        w = SvgWriter(bitmap_urls)
        for sid, shape in sorted(self.shapes.items()):
            w.bodies.append(f'<g id="c{sid}">{w.shape_body(shape)}</g>')
        for tid, text in sorted(self.texts.items()):
            w.bodies.append(f'<g id="c{tid}">{text_body(text, self.fonts)}</g>')
        return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>'
                + ''.join(w.defs) + ''.join(w.bodies) + '</defs></svg>')

    def json_library(self, font_families):
        def place(p):
            q = {k: v for k, v in p.items() if k in ('id', 'depth', 'matrix', 'cxform', 'name', 'clipDepth', 'filters', 'blend', 'visible', 'ratio')}
            if 'cxform' in q and q['cxform'] == [[1.0, 1.0, 1.0, 1.0], [0, 0, 0, 0]]:
                del q['cxform']
            return q
        chars = {}
        for sid, s in self.shapes.items():
            chars[sid] = {'type': 'shape', 'bounds': s['bounds']}
        for tid, t in self.texts.items():
            chars[tid] = {'type': 'text', 'bounds': t['bounds']}
        for sid, s in self.sprites.items():
            chars[sid] = {'type': 'sprite', 'frames': [[place(p) for p in f] for f in s['frames']], 'labels': s['labels']}
            if sid in self.scale9:
                chars[sid]['scale9'] = self.scale9[sid]
        for bid, b in self.buttons.items():
            chars[bid] = {'type': 'button', 'states': {k: [place(p) for p in v] for k, v in b['states'].items()}}
            if bid in self.scale9:
                chars[bid]['scale9'] = self.scale9[bid]
        for eid, e in self.edits.items():
            field = dict(e)
            field['type'] = 'edittext'
            font = self.fonts.get(e['font'])
            if font:
                field['fontFamily'] = font_families.get(e['font'])
                field['bold'] = font['bold']
                field['italic'] = font['italic']
                if font['ascent'] is not None:
                    field['ascent'] = font['ascent'] / font['em']
                    field['descent'] = font['descent'] / font['em']
            chars[eid] = field
        return {'characters': {str(k): v for k, v in sorted(chars.items())},
                'classes': self.classes,
                'root': {'frames': [[place(p) for p in f] for f in self.root_frames], 'labels': self.root_labels}}


# --- fonts to TrueType -----------------------------------------------------------------------

def orient(loops):
    """TrueType fills by winding: outer contours clockwise, holes counter-clockwise (y up).
    Flash glyphs fill by even-odd, so nesting depth decides which is which."""
    polys = []
    for loop in loops:
        pts = []
        for x0, y0, c, x1, y1 in loop:
            pts.append((x0, -y0))
            if c is not None:
                pts.append(((x0 + 2 * c[0] + x1) / 4, -(y0 + 2 * c[1] + y1) / 4))
        polys.append(pts)

    def area(pts):
        return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2

    def inside(pt, pts):
        x, y = pt
        hit = False
        for i in range(len(pts)):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
            if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / ((y1 - y0) or 1e-9) + x0:
                hit = not hit
        return hit

    result = []
    for i, loop in enumerate(loops):
        if len(polys[i]) < 3:
            continue
        depth = sum(1 for j in range(len(loops)) if j != i and len(polys[j]) >= 3 and inside(polys[i][0], polys[j]))
        clockwise = area(polys[i]) < 0
        if clockwise != (depth % 2 == 0):
            loop = [(e[3], e[4], e[2], e[0], e[1]) for e in reversed(loop)]
        result.append(loop)
    return result


def write_font(font, family, path):
    """One embedded font as a TrueType file (1024 units per em)."""
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    unit = font['em'] / 1024.0
    order = ['.notdef']
    cmap = {}
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (512, 0)}
    seen = set()
    for i, records in enumerate(font['glyphs']):
        code = font['codes'][i]
        if code in seen or code < 32:
            continue
        seen.add(code)
        name = f'g{i}'
        pen = TTGlyphPen(None)
        xmin = None
        for loop in orient(contours(glyph_edges(records))):
            if not loop:
                continue
            pt = lambda x, y: (round(x / unit), round(-y / unit))  # noqa: E731
            pen.moveTo(pt(loop[0][0], loop[0][1]))
            for x0, y0, c, x1, y1 in loop:
                if c is None:
                    pen.lineTo(pt(x1, y1))
                else:
                    pen.qCurveTo(pt(*c), pt(x1, y1))
                xs = (x0, x1) if c is None else (x0, c[0], x1)
                xmin = min(xs) if xmin is None else min(xmin, *xs)
            pen.closePath()
        glyphs[name] = pen.glyph()
        advance = font['advances'][i] if font['advances'] else 1024 * unit * 0.6
        metrics[name] = (max(0, round(advance / unit)), round((xmin or 0) / unit))
        order.append(name)
        cmap[code] = name
    ascent = round((font['ascent'] if font['ascent'] is not None else 900 * unit) / unit)
    descent = round((font['descent'] if font['descent'] is not None else 200 * unit) / unit)
    style = ('Bold ' if font['bold'] else '') + ('Italic' if font['italic'] else '')
    style = style.strip() or 'Regular'
    fb = FontBuilder(1024, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ascent, descent=-descent)
    fb.setupNameTable({'familyName': family, 'styleName': style})
    fs_selection = (0x20 if font['bold'] else 0) | (0x01 if font['italic'] else 0) or 0x40
    fb.setupOS2(sTypoAscender=ascent, sTypoDescender=-descent, sTypoLineGap=max(0, round(font['leading'] / unit)),
                usWinAscent=ascent, usWinDescent=descent, usWeightClass=700 if font['bold'] else 400, fsSelection=fs_selection)
    fb.setupPost()
    fb.font['head'].macStyle = (1 if font['bold'] else 0) | (2 if font['italic'] else 0)
    # A fixed date instead of "now", so rebuilding gives byte-identical files (they are tracked in git).
    fb.font['head'].created = fb.font['head'].modified = 0
    fb.font.recalcTimestamp = False
    fb.save(path)


def export_fonts(library, out_dir, url_prefix):
    """Write one TrueType file per family/style (the embedding with most glyphs wins).
    Returns (font id -> CSS family name, [@font-face entries])."""
    best = {}
    for fid, font in library.fonts.items():
        if len(font['glyphs']) < 10:
            continue
        key = (font['name'].lower(), font['bold'], font['italic'])
        if key not in best or len(font['glyphs']) > len(library.fonts[best[key]]['glyphs']):
            best[key] = fid
    families = {}
    faces = []
    try:
        import fontTools  # noqa: F401
    except ImportError:
        print('  fontTools not installed: menus will use system fonts (pip install fonttools)', file=sys.stderr)
        best = {}
    os.makedirs(out_dir, exist_ok=True)
    for (name, bold, italic), fid in sorted(best.items()):
        family = 'BBH ' + ' '.join(w.capitalize() for w in name.split())
        file = '{}{}{}.ttf'.format(name.replace(' ', '-'), '-bold' if bold else '', '-italic' if italic else '')
        try:
            write_font(library.fonts[fid], family, os.path.join(out_dir, file))
        except Exception as error:
            print(f'  font {name} skipped: {error}', file=sys.stderr)
            continue
        faces.append({'family': family, 'url': url_prefix + file, 'bold': bold, 'italic': italic})
    for fid, font in library.fonts.items():
        family = 'BBH ' + ' '.join(w.capitalize() for w in font['name'].lower().split())
        if any(f['family'] == family for f in faces):
            families[fid] = family
    return families, faces


def symbol_frames(library, class_name):
    """A vector MovieClip as standalone SVG images, one per frame, for drawing into
    bitmaps (the game's particles). Single-child sprites are followed down, keeping
    their blur filter and alpha. Returns {frames, bounds, blur, alpha} or None."""
    cid = library.classes.get(class_name)
    blur, alpha = 0.0, 1.0
    while cid in library.sprites:
        frames = library.sprites[cid]['frames']
        if len(frames) == 1 and len(frames[0]) == 1 and frames[0][0].get('id') in library.sprites:
            place = frames[0][0]
            for f in place.get('filters') or []:
                if f['type'] == 'blur':
                    blur = max(blur, f['blurX'], f['blurY'])
            if place.get('cxform'):
                alpha *= place['cxform'][0][3]
            cid = place['id']
            continue
        break
    if cid not in library.sprites:
        return None
    writer = SvgWriter({})
    shapes = []
    for frame in library.sprites[cid]['frames']:
        ids = [p['id'] for p in frame if p.get('id') in library.shapes]
        if not ids:
            continue
        b = [min(library.shapes[i]['bounds'][k] for i in ids) if k < 2 else max(library.shapes[i]['bounds'][k] for i in ids) for k in range(4)]
        body = ''.join(writer.shape_body(library.shapes[i]) for i in ids)
        shapes.append((b, body))
    if not shapes:
        return None
    x0 = min(b[0] for b, _ in shapes)
    y0 = min(b[1] for b, _ in shapes)
    x1 = max(b[2] for b, _ in shapes)
    y1 = max(b[3] for b, _ in shapes)
    w, h = x1 - x0, y1 - y0
    svgs = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{num(w)}" height="{num(h)}" viewBox="{num(x0)} {num(y0)} {num(w)} {num(h)}">'
            + ''.join(writer.defs) + body + '</svg>' for _, body in shapes]
    return {'frames': svgs, 'bounds': [x0, y0, x1, y1], 'blur': blur, 'alpha': alpha}


def tinted_bitmap_frames(library, class_name):
    """A MovieClip showing one bitmap-filled shape under a different colour
    transform on each frame (the flamer's FireLayer): the bitmap as a PNG data
    URL, the rectangle it fills, the clip's offset and every frame's colour
    transform [[r, g, b, a] multipliers, [r, g, b, a] offsets]. None if absent."""
    cid = library.classes.get(class_name)
    sprite = library.sprites.get(cid)
    if not sprite or not sprite['frames'] or not sprite['frames'][0]:
        return None
    first = sprite['frames'][0][0]
    offset = (first.get('matrix') or [1, 0, 0, 1, 0, 0])[4:6]
    inner = first.get('id')
    while inner in library.sprites:
        places = library.sprites[inner]['frames'][0]
        if len(places) != 1:
            return None
        inner = places[0].get('id')
    shape = library.shapes.get(inner)
    if not shape:
        return None
    fill = next((f for f in shape['fills'] if f.get('type') == 'bitmap' and f.get('bitmap') in library.bitmaps), None)
    if not fill:
        return None
    kind, code, body = library.bitmaps[fill['bitmap']]
    if kind == 'lossless':
        _, img = swf_extract.lossless(body, code == 36)
    else:
        _, img = swf_extract.jpeg(body, code, library.jpeg_tables)
    out = io.BytesIO()
    img.save(out, 'PNG', optimize=True)
    import base64
    identity = [[1, 1, 1, 1], [0, 0, 0, 0]]
    colors = []
    for frame in sprite['frames']:
        place = frame[0] if frame else {}
        colors.append(place.get('cxform') or identity)
    return {
        'image': 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode('ascii'),
        'rect': shape['bounds'],
        'offset': offset,
        'colors': colors,
    }


def export(data, out_dir, url_prefix='assets/game/ui/'):
    library = Library(data)
    bitmap_urls = library.export_bitmaps(os.path.join(out_dir, 'bitmaps'), url_prefix + 'bitmaps/')
    families, faces = export_fonts(library, os.path.join(out_dir, 'fonts'), url_prefix + 'fonts/')
    with open(os.path.join(out_dir, 'library.svg'), 'w', encoding='utf-8') as f:
        f.write(library.svg_library(bitmap_urls))
    info = library.json_library(families)
    info['fonts'] = faces
    with open(os.path.join(out_dir, 'library.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, separators=(',', ':'))
    return library


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('swf')
    parser.add_argument('--out', required=True)
    parser.add_argument('--url', default='assets/game/ui/', help='URL prefix of --out as seen from the page')
    args = parser.parse_args()
    with open(args.swf, 'rb') as f:
        data = f.read()
    os.makedirs(args.out, exist_ok=True)
    library = export(data, args.out, args.url)
    print(f'{len(library.shapes)} shapes, {len(library.sprites)} sprites, {len(library.buttons)} buttons, '
          f'{len(library.texts)} texts, {len(library.edits)} text fields, {len(library.fonts)} fonts, {len(library.bitmaps)} bitmaps')


if __name__ == '__main__':
    main()
