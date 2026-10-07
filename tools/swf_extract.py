"""Extract bitmaps and sounds from a Flash SWF into web-friendly files.

    python3 tools/swf_extract.py BBH.swf     --out client/assets/game
    python3 tools/swf_extract.py assets.swf  --out client/assets/game

Every bitmap is written as PNG and every sound as MP3 (or WAV for raw PCM),
named after its ActionScript symbol class with the package and the Flex
`Owner_` prefix removed, e.g. `AssetsMain_Barrel1` -> `images/Barrel1.png`,
`boxhead.sounds.SoundList_PistolFire01` -> `sounds/PistolFire01.mp3`.
Embedded SWFs (DefineBinaryData) are extracted recursively.

Requires Pillow (`pip install pillow`).
"""
import argparse
import io
import json
import lzma
import os
import struct
import sys
import zlib

from PIL import Image


def read_swf(data):
    sig = data[:3]
    if sig == b'CWS':
        data = data[:8] + zlib.decompress(data[8:])
    elif sig == b'ZWS':
        # LZMA SWF: 4 byte compressed length, 5 byte props, then raw stream.
        props = data[12:17]
        dec = lzma.LZMADecompressor(lzma.FORMAT_RAW, filters=[lzma._decode_filter_properties(lzma.FILTER_LZMA1, props)])
        data = b'FWS' + data[3:8] + dec.decompress(data[17:])
    elif sig != b'FWS':
        raise ValueError('not a SWF file')
    nbits = data[8] >> 3
    pos = 8 + (5 + 4 * nbits + 7) // 8 + 4
    while pos < len(data):
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


def cstring(body, pos):
    end = body.index(b'\0', pos)
    return body[pos:end].decode('utf-8', 'replace'), end + 1


def short_name(symbol):
    name = symbol.rsplit('.', 1)[-1]
    for prefix in ('AssetsMain_', 'SoundList_', 'Assets_', 'Textures_', 'Intros_', 'StoredText_'):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def lossless(body, alpha):
    cid, fmt, width, height = struct.unpack_from('<HBHH', body, 0)
    pos = 7
    if fmt == 3:
        ncolors = body[pos] + 1
        pos += 1
    raw = zlib.decompress(body[pos:])
    if fmt == 3:
        entry = 4 if alpha else 3
        palette = raw[:ncolors * entry]
        stride = (width + 3) & ~3
        pixels = raw[ncolors * entry:]
        img = Image.new('RGBA', (width, height))
        out = img.load()
        for y in range(height):
            for x in range(width):
                i = pixels[y * stride + x] * entry
                if alpha:
                    r, g, b, a = palette[i:i + 4]
                    out[x, y] = unpremultiply(r, g, b, a)
                else:
                    out[x, y] = (palette[i], palette[i + 1], palette[i + 2], 255)
        return cid, img
    if fmt == 5:
        # 32-bit ARGB, premultiplied when the tag carries alpha.
        img = Image.frombuffer('RGBA', (width, height), raw[:width * height * 4], 'raw', 'ARGB', 0, 1)
        if alpha:
            img = Image.frombytes('RGBa', img.size, img.tobytes()).convert('RGBA')
        else:
            img.putalpha(255)
        return cid, img
    if fmt == 4:
        stride = ((width * 2) + 3) & ~3
        img = Image.new('RGBA', (width, height))
        out = img.load()
        for y in range(height):
            for x in range(width):
                v = struct.unpack_from('>H', raw, y * stride + x * 2)[0]
                out[x, y] = (((v >> 10) & 31) << 3, ((v >> 5) & 31) << 3, (v & 31) << 3, 255)
        return cid, img
    raise ValueError(f'unsupported lossless format {fmt}')


def unpremultiply(r, g, b, a):
    if a == 0:
        return (0, 0, 0, 0)
    return (min(255, r * 255 // a), min(255, g * 255 // a), min(255, b * 255 // a), a)


def strip_jpeg(data):
    # Flash sometimes prefixes an extra FFD9FFD8 pair; Pillow rejects it.
    if data[:4] == b'\xff\xd9\xff\xd8':
        data = data[4:]
    return data.replace(b'\xff\xd9\xff\xd8', b'', 1) if data.count(b'\xff\xd8') > 1 else data


def jpeg(body, code, tables):
    cid = struct.unpack_from('<H', body, 0)[0]
    if code == 6:
        # DefineBits shares one JPEGTables tag: tables (minus EOI) + image (minus SOI).
        image = body[2:]
        if tables and len(tables) > 4:
            image = tables[:-2] + image[2:]
        return cid, Image.open(io.BytesIO(strip_jpeg(image))).convert('RGBA')
    if code == 21:
        return cid, Image.open(io.BytesIO(strip_jpeg(body[2:]))).convert('RGBA')
    offset = struct.unpack_from('<I', body, 2)[0]
    start = 6 if code == 35 else 8
    img = Image.open(io.BytesIO(strip_jpeg(body[start:start + offset]))).convert('RGBA')
    alpha_data = body[start + offset:]
    if alpha_data[:4] == b'\x89PNG' or alpha_data[:3] == b'GIF':
        return cid, img
    if alpha_data:
        try:
            img.putalpha(Image.frombytes('L', img.size, zlib.decompress(alpha_data)))
            # The JPEG colours are premultiplied by the alpha channel.
            img = Image.frombytes('RGBa', img.size, img.tobytes()).convert('RGBA')
        except (zlib.error, ValueError):
            pass
    return cid, img


SOUND_RATES = (5512, 11025, 22050, 44100)


def sound(body):
    cid, flags, samples = struct.unpack_from('<HBI', body, 0)
    fmt = flags >> 4
    rate = SOUND_RATES[(flags >> 2) & 3]
    width = 2 if flags & 2 else 1
    channels = 2 if flags & 1 else 1
    data = body[7:]
    if fmt == 2:
        return cid, 'mp3', data[2:]  # skip SeekSamples
    if fmt in (0, 3):
        out = io.BytesIO()
        import wave
        with wave.open(out, 'wb') as w:
            w.setnchannels(channels)
            w.setsampwidth(width)
            w.setframerate(rate)
            w.writeframes(data)
        return cid, 'wav', out.getvalue()
    return cid, None, None


def extract(data, out, manifest, depth=0):
    images, sounds, binaries, symbols = {}, {}, {}, {}
    tables = None
    for code, body in read_swf(data):
        try:
            if code == 8:
                tables = body
            elif code in (20, 36):
                cid, img = lossless(body, code == 36)
                images[cid] = img
            elif code in (6, 21, 35, 90):
                cid, img = jpeg(body, code, tables)
                images[cid] = img
            elif code == 14:
                cid, ext, payload = sound(body)
                if ext:
                    sounds[cid] = (ext, payload)
            elif code == 87:
                binaries[struct.unpack_from('<H', body, 0)[0]] = body[6:]
            elif code == 76:
                count = struct.unpack_from('<H', body, 0)[0]
                pos = 2
                for _ in range(count):
                    cid = struct.unpack_from('<H', body, pos)[0]
                    name, pos = cstring(body, pos + 2)
                    symbols[cid] = name
        except Exception as error:  # keep going: one odd tag should not stop the export
            print(f'  skipped tag {code}: {error}', file=sys.stderr)

    os.makedirs(os.path.join(out, 'images'), exist_ok=True)
    os.makedirs(os.path.join(out, 'sounds'), exist_ok=True)
    for cid, img in images.items():
        if cid not in symbols:
            continue  # only named bitmaps are addressable by the game
        name = short_name(symbols[cid])
        img.save(os.path.join(out, 'images', name + '.png'), optimize=True)
        manifest['images'][name] = {'w': img.width, 'h': img.height}
    for cid, (ext, payload) in sounds.items():
        if cid not in symbols:
            continue
        name = short_name(symbols[cid])
        with open(os.path.join(out, 'sounds', f'{name}.{ext}'), 'wb') as f:
            f.write(payload)
        manifest['sounds'][name] = f'{name}.{ext}'
    for cid, payload in binaries.items():
        if payload[:3] in (b'FWS', b'CWS', b'ZWS'):
            extract(payload, out, manifest, depth + 1)
    print(f'{"  " * depth}{len(images)} bitmaps, {len(sounds)} sounds, {len(binaries)} embedded files')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('swf', nargs='+')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    path = os.path.join(args.out, 'manifest.json')
    manifest = {'images': {}, 'sounds': {}}
    if os.path.exists(path):
        with open(path) as f:
            manifest.update(json.load(f))
    for swf in args.swf:
        print(swf)
        with open(swf, 'rb') as f:
            extract(f.read(), args.out, manifest)
    manifest['images'] = dict(sorted(manifest['images'].items()))
    manifest['sounds'] = dict(sorted(manifest['sounds'].items()))
    with open(path, 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main()
