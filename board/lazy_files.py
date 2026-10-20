#!/usr/bin/env python3
"""lazy_files.py SRC DEST: copy every file under SRC into DEST/<n>.bin and
write DEST/manifest.json, the list the page registers as lazy files with
cw_import_lazy (a file's key is its place in the list). Paths in the list are
guest paths relative to the application, as under SRC. Identical files are
stored once and listed under every path (the two Carmen discs share Data/)."""
import hashlib, json, os, shutil, sys

src, dest = sys.argv[1], sys.argv[2]
os.makedirs(dest, exist_ok=True)
entries, stored = [], {}
for root, dirs, files in os.walk(src, followlinks=True):
    dirs.sort()
    for name in sorted(files):
        if name.startswith('.'):
            continue
        path = os.path.join(root, name)
        rel = os.path.relpath(path, src)
        digest = hashlib.md5(open(path, 'rb').read()).hexdigest()
        if digest not in stored:
            stored[digest] = f'{len(stored)}.bin'
            shutil.copyfile(path, os.path.join(dest, stored[digest]))
        entries.append({'path': rel, 'size': os.path.getsize(path), 'url': 'files/' + stored[digest],
                        'type': 0x3F3F3F3F, 'creator': 0x3F3F3F3F})
json.dump(entries, open(os.path.join(dest, 'manifest.json'), 'w'), indent=0)
total = sum(os.path.getsize(os.path.join(dest, f)) for f in stored.values())
print(f'lazy_files: {len(entries)} files, {len(stored)} stored, {total / 1048576:.0f} MB')
