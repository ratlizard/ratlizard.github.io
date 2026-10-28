"""Writes some of the program's color cursors ('crsr') as PNG files, for the
chef's dial (Rings.java): python3 cursors.py <Cythera.rsrc> <out folder> <id>...

A crsr resource has a PixMap, its pixels and its color table at offsets from
its start, and a one-bit mask (Inside Macintosh: Imaging With QuickDraw,
'crsr'). A pixel is drawn where the mask is set; where it is clear the
cursor inverts the screen, which a picture of it cannot show, so those
pixels are left clear.
"""
import struct
import sys
from PIL import Image


def crsr_resources(path):
    d = open(path, 'rb').read()
    data_at, map_at = struct.unpack('>II', d[:8])
    types = map_at + struct.unpack('>H', d[map_at + 24:map_at + 26])[0]
    found = {}
    for t in range(struct.unpack('>H', d[types:types + 2])[0] + 1):
        e = types + 2 + t * 8
        if d[e:e + 4] != b'crsr':
            continue
        count = struct.unpack('>H', d[e + 4:e + 6])[0] + 1
        refs = types + struct.unpack('>H', d[e + 6:e + 8])[0]
        for r in range(count):
            x = refs + r * 12
            rid = struct.unpack('>h', d[x:x + 2])[0]
            at = data_at + (struct.unpack('>I', d[x + 4:x + 8])[0] & 0xFFFFFF)
            length = struct.unpack('>I', d[at:at + 4])[0]
            found[rid] = d[at + 4:at + 4 + length]
    return found


def decode(c):
    pixmap, pixels = struct.unpack('>II', c[2:10])
    mask = c[0x2C:0x4C]
    row_bytes = struct.unpack('>H', c[pixmap + 4:pixmap + 6])[0] & 0x3FFF
    depth = struct.unpack('>H', c[pixmap + 32:pixmap + 34])[0]
    table = struct.unpack('>I', c[pixmap + 42:pixmap + 46])[0]
    colors = {}
    for i in range(struct.unpack('>H', c[table + 6:table + 8])[0] + 1):
        v, r, g, b = struct.unpack('>HHHH', c[table + 8 + i * 8:table + 16 + i * 8])
        colors[v] = (r >> 8, g >> 8, b >> 8)
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y in range(16):
        for x in range(16):
            if not (mask[y * 2 + x // 8] >> (7 - x % 8)) & 1:
                continue
            byte = c[pixels + y * row_bytes + x * depth // 8]
            v = (byte >> (8 - depth - (x * depth) % 8)) & ((1 << depth) - 1)
            im.putpixel((x, y), colors.get(v, (0, 0, 0)) + (255,))
    return im


if __name__ == '__main__':
    found = crsr_resources(sys.argv[1])
    for rid in sys.argv[3:]:
        decode(found[int(rid)]).save('%s/%s.png' % (sys.argv[2], rid))
