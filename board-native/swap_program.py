#!/usr/bin/env python3
"""swap_program.py PACK APP OUT: writes the web pack PACK (KPK2, from
cythera-web's pack_game example) to OUT with the program's forks replaced by
APP's, a folder holding Cythera.data and Cythera.rsrc as grimoire's
utilities/app_patch.mjs writes them. The program is the pack's one APPL file
with creator Delv. app_patch.mjs accepts only Cythera 1.0.4's program, and
the installed folder's program is byte for byte cythera-reference's
Cythera.hqx (25 October 2026), so APP built from either fits the pack.

A KPK2 pack is "KPK2", a 32-bit count, then per file: a 16-bit name length,
the name, type, creator, 16-bit Finder flags, then the data fork and the
resource fork, each a 32-bit length and its bytes (the fork's
append_web_pack_files). All big-endian.
"""
import pathlib, struct, sys

pack_path, app_dir, out_path = sys.argv[1:]
pack = pathlib.Path(pack_path).read_bytes()
if pack[:4] != b"KPK2":
    sys.exit(f"{pack_path} is not a KPK2 web pack")
data = pathlib.Path(app_dir, "Cythera.data").read_bytes()
rsrc = pathlib.Path(app_dir, "Cythera.rsrc").read_bytes()

count, = struct.unpack_from(">I", pack, 4)
at, out, found = 8, bytearray(pack[:8]), []
for _ in range(count):
    start = at
    name_len, = struct.unpack_from(">H", pack, at); at += 2
    name = pack[at:at + name_len].decode("utf-8"); at += name_len
    kind, creator = pack[at:at + 4], pack[at + 4:at + 8]; at += 10
    data_len, = struct.unpack_from(">I", pack, at); at += 4
    at += data_len
    rsrc_len, = struct.unpack_from(">I", pack, at); at += 4 + rsrc_len
    if kind == b"APPL" and creator == b"Delv":
        found.append(name)
        out += pack[start:start + 2 + name_len + 10]
        out += struct.pack(">I", len(data)) + data + struct.pack(">I", len(rsrc)) + rsrc
        print(f"{name}: forks replaced ({data_len} + {rsrc_len} bytes, now {len(data)} + {len(rsrc)})")
    else:
        out += pack[start:at]
if at != len(pack):
    sys.exit(f"{pack_path}: {len(pack) - at} bytes after the last file")
if len(found) != 1:
    sys.exit(f"{pack_path}: {len(found)} programs found, not one")
pathlib.Path(out_path).write_bytes(out)
