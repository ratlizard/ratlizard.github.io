/* mac-stuffit.js -- read the table of contents of a StuffIt archive, take out
   the files that were stored, and decompress the one method that matters.
   =========================================================================

   Cythera's installer is mirrored as a StuffIt archive -- archive.org's
   `cythera.sit` and old.mac.gdn's `Cythera_Installer.sit` are StuffIt 5,
   Ambrosia's own `Cythera_1.0.4_Installer.sit` is the classic `SIT!`
   format -- and in every one of them the file that matters, the installer
   application's 6.8 MB data fork, is STORED: method 0, no compression at
   all. That is also true of the 28 MB four-in-one bundle the page's own
   gate downloads: all four installers' data forks in it are stored, and
   only their resource forks are compressed, which the page has no use for.
   So reading the catalog and handing back stored forks was enough for a
   long time, and this file did no more than that.

   **It decompresses method 13 as well since 15 September 2026**, because
   the patches section needs it. Every add-on the community released is
   inside a StuffIt archive, and the one Magpie patch that exists is a
   method-13 fork inside `614_MagpiePumpkinPatch.sit.hqx` -- so the page
   could list that archive and not open what was in it, and using the
   section meant unpacking the .sit on a desktop first. See the method 13
   section at the foot of this file for what it is and where it came from.
   It also opens Pandora's Box, and the STANDALONE `Cythera_1.0.1` and
   `1.0.2` installer archives, whose forks are method 13 where the bundle's
   are stored -- which is worth stating plainly, because an earlier version
   of this comment named those two versions in a way that read as though
   the page had never been able to reach them. It always could, through the
   bundle.

   **And method 15, Arsenic, since 16 September 2026**, which is what the
   rest of the corpus is: the 3D Cursors add-on, the I.M.Cheater saved game,
   and every resource fork in the four-in-one bundle. Until then the page
   could list those files and not hand them over, and the installer's own
   resource fork -- where its VISE icon is -- could only be reached from a
   MacBinary copy. See the Arsenic section at the foot of this file.

   WHERE THE FORMAT CAME FROM

   Copied, as CLAUDE.md's licensing note allows for infrastructure with no
   oracle role: the two header layouts are those in `stuffit-rs` 0.1.5
   (Ben Letchford, MIT OR Apache-2.0), which in turn cites The Unarchiver's
   `XADStuffItParser.m` and `XADStuffIt5Parser.m`. Checked against the six
   archives above by `utilities/vise_check.mjs`: fork lengths as listed by
   `lsar`, and the stored data fork byte-identical to the one inside
   Bryce Schroeder's Cythera.bin.

   LOAD ORDER: after mac-bytes.js (u16be, u32be, fourcc, decodeMacRoman).
   A classic script, like the rest of js/: no import, no export, globals. */

const SIT5_SIGNATURE = 'StuffIt (c)199';        // the 80-byte banner starts so
const SIT_METHOD_NAMES = {
  0: 'stored', 1: 'RLE', 2: 'LZW', 3: 'Huffman', 5: 'LZAH', 6: 'fixed Huffman',
  8: 'MW', 13: 'LZ+Huffman', 14: 'Installer', 15: 'Arsenic'
};

/* StuffIt X, the .sitx format, opens with "StuffIt!". It is a different format
   from the two above rather than a later version of them, with compressors of
   its own, and this file reads none of it. Recognised only so that a refusal
   can say what the file is. */
function looksLikeStuffItX(bytes) {
  return !!bytes && bytes.length >= 8 && latin1(bytes.subarray(0, 8)) === 'StuffIt!';
}

function looksLikeStuffIt(bytes) {
  if (!bytes || bytes.length < 96) return false;
  if (fourcc(bytes, 0) === 'SIT!' && fourcc(bytes, 10) === 'rLau') return true;
  return latin1(bytes.subarray(0, SIT5_SIGNATURE.length)) === SIT5_SIGNATURE && bytes[82] === 5;
}

/* The catalog, with nothing decompressed. Returns
 *
 *   { format, entries: [{ path, name, isFolder, type, creator, finderFlags,
 *                         dataLen, dataPackedLen, dataMethod, dataOffset,
 *                         rsrcLen, rsrcPackedLen, rsrcMethod, rsrcOffset }] }
 *
 * where dataOffset / rsrcOffset are where each fork's bytes sit in the
 * archive, stored or not. */
function parseStuffItArchive(bytes) {
  if (!looksLikeStuffIt(bytes)) throw new Error('not a StuffIt archive');
  return fourcc(bytes, 0) === 'SIT!' ? parseStuffItClassic(bytes) : parseStuffIt5(bytes);
}

/* ---- SIT! (StuffIt 1.5.1 through 4) ------------------------------------
 * A 22-byte archive header, then 112-byte entry headers each followed by
 * that entry's resource fork bytes and then its data fork bytes. Folders
 * are entries whose method byte is 0x20 (start) or 0x21 (end). */
function parseStuffItClassic(bytes) {
  const total = Math.min(u32be(bytes, 6), bytes.length);
  const entries = [];
  const path = [];
  let at = 22;
  while (at + 112 <= total) {
    const h = bytes.subarray(at, at + 112);
    const rsrcMethodByte = h[0], dataMethodByte = h[1];
    const nameLen = Math.min(h[2], 31);
    const name = decodeMacRoman(h.subarray(3, 3 + nameLen));
    at += 112;
    if (dataMethodByte === 0x20 || rsrcMethodByte === 0x20) { path.push(name); continue; }
    if (dataMethodByte === 0x21 || rsrcMethodByte === 0x21) { path.pop(); continue; }
    const rsrcLen = u32be(h, 84), dataLen = u32be(h, 88);
    const rsrcPackedLen = u32be(h, 92), dataPackedLen = u32be(h, 96);
    entries.push({
      path: path.concat([name]).join('/'), name, isFolder: false,
      type: fourcc(h, 66), creator: fourcc(h, 70), finderFlags: u16be(h, 74),
      rsrcLen, rsrcPackedLen, rsrcMethod: rsrcMethodByte & 0x0F, rsrcOffset: at,
      dataLen, dataPackedLen, dataMethod: dataMethodByte & 0x0F, dataOffset: at + rsrcPackedLen,
      encrypted: !!((dataMethodByte | rsrcMethodByte) & 0x10)
    });
    at += rsrcPackedLen + dataPackedLen;
  }
  return { format: 'StuffIt (classic)', entries };
}

/* ---- StuffIt 5 -----------------------------------------------------------
 * An 80-byte banner, a small header, and a linked list of entries whose
 * offsets are XORed with 0xA5A5A5A5 unless the archive says otherwise. The
 * entry header is 48 bytes plus the name, an optional comment, then a
 * metadata block carrying the Finder identity and, when bit 0 of its first
 * word is set, the resource fork's lengths. The forks follow: resource fork
 * first, then data fork. */
function parseStuffIt5(bytes) {
  const flags = bytes[83];
  const plain = !!(flags & 0x10);
  const off = v => (plain ? v : (v ^ 0xA5A5A5A5)) >>> 0;
  let at = off(u32be(bytes, 88));
  let remaining = u16be(bytes, 92);
  const entries = [];
  const dirs = new Map();
  /* Where to carry on after each folder ends. A folder's header gives the
     offset of its first child, and the walk jumps there -- so without
     somewhere to put the folder's OWN next-entry pointer, the walk descends
     into the first folder it meets and never comes back up. That is not
     hypothetical: `Cythera Installed Folder with Preferences & License.sit`
     listed 12 entries of 51, everything in it stopping at the end of the
     first folder, and the six single-file archives this page was written
     against have no nested folders at all so nothing noticed for a year.
     One stack entry per open folder, popped by the folder's end marker. */
  const resume = [];
  while (remaining > 0 && at + 48 <= bytes.length) {
    const start = at;
    if (u32be(bytes, at) !== 0xA5A5A5A5) throw new Error('StuffIt 5 entry marker missing at 0x' + at.toString(16));
    const version = bytes[at + 4];
    const headerSize = u16be(bytes, at + 6);
    const eflags = bytes[at + 9];
    const nextOff = u32be(bytes, at + 22);
    const dirOff = off(u32be(bytes, at + 26));
    const nameLen = u16be(bytes, at + 30);
    const dataLen = u32be(bytes, at + 34), dataPackedLen = u32be(bytes, at + 38);
    const isFolder = !!(eflags & 0x40);
    const dataMethod = isFolder ? 0 : bytes[at + 46];
    const childCount = isFolder ? u16be(bytes, at + 46) : 0;
    at += 48;
    const name = decodeMacRoman(bytes.subarray(at, at + nameLen));
    at += nameLen;
    if (isFolder && nameLen === 0) {            // end-of-folder marker
      // The stack first, the marker's own pointer as a fallback, and never a
      // jump to zero: a folder with nothing after it at its level has a null
      // next-entry pointer, and following it would land on the header at
      // offset 0 and throw on the marker check.
      const back = resume.length ? resume.pop() : 0;
      const to = back || nextOff;
      if (to) { at = to; continue; }
      break;
    }
    if (at < start + headerSize) {              // a comment
      const commentLen = u16be(bytes, at);
      at += 4 + commentLen;
    }
    const meta = u16be(bytes, at);
    const type = fourcc(bytes, at + 4), creator = fourcc(bytes, at + 8);
    const finderFlags = u16be(bytes, at + 12);
    at += 14 + (version === 1 ? 22 : 18);
    let rsrcLen = 0, rsrcPackedLen = 0, rsrcMethod = 0;
    const hasRsrc = !isFolder && !!(meta & 1);
    if (hasRsrc) {
      rsrcLen = u32be(bytes, at); rsrcPackedLen = u32be(bytes, at + 4);
      rsrcMethod = bytes[at + 12];
      const passLen = bytes[at + 13];
      at += 14;
      if ((eflags & 0x20) && passLen) at += passLen;
    }
    const parent = dirs.get(dirOff) || '';
    const path = parent ? parent + '/' + name : name;
    if (isFolder) {
      dirs.set(start, path);
      entries.push({ path, name, isFolder: true, type, creator, finderFlags,
                     dataLen: 0, dataPackedLen: 0, dataMethod: 0, dataOffset: 0,
                     rsrcLen: 0, rsrcPackedLen: 0, rsrcMethod: 0, rsrcOffset: 0 });
      remaining += childCount;
      if (dataLen && dataLen !== 0xFFFFFFFF) { resume.push(nextOff); at = dataLen; }   // first child
    } else {
      entries.push({ path, name, isFolder: false, type, creator, finderFlags,
                     rsrcLen, rsrcPackedLen, rsrcMethod, rsrcOffset: at,
                     dataLen, dataPackedLen, dataMethod, dataOffset: at + rsrcPackedLen,
                     encrypted: !!(eflags & 0x20) });
      at += rsrcPackedLen + dataPackedLen;
    }
    remaining--;
  }
  return { format: 'StuffIt 5', entries };
}

/* One fork of one entry: stored, or decompressed if the method is one this
 * file implements. `which` is 'data' or 'rsrc'. Throws, naming the method,
 * for anything else, and the message is what tells a user which file to
 * extract by hand.
 *
 * Was `stuffItStoredFork` until method 13 landed. Renamed rather than kept
 * beside a second entry point, because two classic scripts share one global
 * scope and a name here can only mean one thing. */
function stuffItFork(bytes, entry, which) {
  const len = which === 'data' ? entry.dataLen : entry.rsrcLen;
  if (!len) return new Uint8Array(0);
  const method = which === 'data' ? entry.dataMethod : entry.rsrcMethod;
  const packedLen = which === 'data' ? entry.dataPackedLen : entry.rsrcPackedLen;
  const offset = which === 'data' ? entry.dataOffset : entry.rsrcOffset;
  if (entry.encrypted) throw new Error('"' + entry.name + '" is encrypted');
  if (offset + packedLen > bytes.length) throw new Error('"' + entry.name + '" runs past the end of the archive');
  if (method === 0) {
    // A stored fork's packed length IS its length. When it is not, the entry
    // says stored and is not, and handing back the first `len` bytes would
    // quietly produce a wrong file rather than an error.
    if (packedLen !== len)
      throw new Error('"' + entry.name + '" ' + which + ' fork says it is stored but is ' +
                      packedLen + ' bytes for a length of ' + len);
    return bytes.subarray(offset, offset + len);
  }
  if (method === 13 || method === 15) {
    const packed = bytes.subarray(offset, offset + packedLen);
    const out = method === 13 ? sit13Decompress(packed, len) : arsenicDecompress(packed, len);
    if (out.length !== len)
      throw new Error('"' + entry.name + '" ' + which + ' fork decompressed to ' + out.length +
                      ' bytes where the catalog says ' + len);
    return out;
  }
  throw new Error('"' + entry.name + '" ' + which + ' fork is compressed with StuffIt method ' + method +
                  ' (' + (SIT_METHOD_NAMES[method] || 'unknown') + '), which this page does not decompress');
}

/* ---- StuffIt method 13, LZ77 + Huffman ------------------------------------

   WHY THIS IS HERE. Everything the Cythera community ever released is inside
   a StuffIt archive, and the one Magpie patch that exists -- the file the
   page's patches section is for -- is method 13 inside
   `614_MagpiePumpkinPatch.sit.hqx`. Without this, using that section meant
   unpacking the .sit on a desktop with `unar` first, which is not a thing a
   phone can do, so the feature's front door was shut to exactly the person
   most likely to want it. Method 13 also opens Pandora's Box and the 1.0.1
   and 1.0.2 installers, whose forks are both method 13.

   WHERE IT CAME FROM. Ported, near line for line, from `Sit13Decoder` in
   `stuffit-rs` 0.1.8 (Ben Letchford, MIT OR Apache-2.0) -- the same source
   this file's header layouts came from, and it in turn carries the tables
   from The Unarchiver's `XADStuffIt13Handle.m` (LGPL), which is where the
   comments in that crate point. CLAUDE.md's licensing note allows this for
   infrastructure with no oracle role, with attribution in the header, and
   this is the case it describes: there is no second implementation of
   StuffIt here to check against, and writing a bit-exact decompressor from
   a prose description is not a thing to do when a correct one is readable.

   WHY NOT WEBASSEMBLY, which would have been wholesale rather than a port:
   the crate compiles to wasm perfectly well, and the site could not load it.
   There is no build step here and adding one is a standing no; and `js/`
   has to keep working from `file://`, where fetching a .wasm fails the same
   CORS check that rules out module scripts. Inlining a wasm blob as base64
   would clear the second objection and not the first, and would put a
   binary nobody can rebuild into a repository whose whole design is that
   every file is served exactly as committed. So: a port, unmodified in
   structure, with the tables copied verbatim.

   WHAT IT IS. An LZ77 window with three Huffman codes over it: `first` for
   the literal or match token when the last thing emitted was a literal,
   `second` for the same when the last thing was a match, and `offset` for
   the bit length of the match distance. The first nibble of the stream says
   which set of codes to use -- 0 for codes written into the stream ahead of
   the data, 1 to 5 for one of five built-in sets -- and our own files use
   0, 1 and 2. */

/* Bits, low bit first, which is the order method 13 reads in.

   The Rust keeps a 64-bit accumulator. JavaScript's bitwise operators are
   32-bit, so this keeps at most 24 bits buffered and refills before each
   read: the widest single read the format asks for is 15 bits, so 24 is
   always enough and the accumulator never reaches bit 32.

   Running out of input is not an error here. The Rust would underflow its
   bit count; this returns the zeros past the end and lets the caller stop,
   which it does -- decompress ends on the output length, and a truncated
   stream shows up as a short result that stuffItFork rejects by length. */
function sit13Bits(data) {
  let pos = 0, buf = 0, n = 0;
  const fill = () => {
    while (n <= 24 && pos < data.length) { buf = (buf | (data[pos++] << n)) >>> 0; n += 8; }
  };
  return {
    bits(k) {
      if (!k) return 0;
      fill();
      const v = buf & ((1 << k) - 1);
      if (n < k) { buf = 0; n = 0; } else { buf = buf >>> k; n -= k; }
      return v;
    },
    bit() { return this.bits(1); }
  };
}

/* A Huffman tree as a flat array of [zero, one] pairs. EMPTY is -1, and a
   leaf is a node whose two slots hold the same symbol -- which is how the
   Rust spells it, and it works because child indices start at 1 (the root is
   0 and is nobody's child), so a symbol can never be mistaken for a link. */
const SIT13_EMPTY = -1;
function sit13TreeFromLengths(lengths, numSymbols) {
  const tree = [[SIT13_EMPTY, SIT13_EMPTY]];
  let code = 0;
  for (let length = 1; length <= 32; length++) {
    for (let i = 0; i < numSymbols; i++) {
      if (lengths[i] !== length) continue;
      let node = 0;
      // The code's bits go in most significant first, though the stream is
      // read least significant first. Both are the Rust's, and swapping
      // either produces a tree that decodes plausible garbage.
      for (let bitPos = length - 1; bitPos >= 0; bitPos--) {
        const bit = (code >>> bitPos) & 1;
        if (tree[node][bit] === SIT13_EMPTY) { tree[node][bit] = tree.length; tree.push([SIT13_EMPTY, SIT13_EMPTY]); }
        node = tree[node][bit];
      }
      tree[node][0] = i; tree[node][1] = i;
      code++;
    }
    code <<= 1;
  }
  return tree;
}
// The metacode's codes are given outright rather than by length, and its bits
// go in least significant first. The asymmetry with the function above is the
// format's, not a slip.
function sit13TreeFromCodes(codes, lengths, numSymbols) {
  const tree = [[SIT13_EMPTY, SIT13_EMPTY]];
  for (let i = 0; i < numSymbols; i++) {
    const length = lengths[i];
    if (length <= 0) continue;
    let node = 0;
    for (let bitPos = 0; bitPos < length; bitPos++) {
      const bit = (codes[i] >>> bitPos) & 1;
      if (tree[node][bit] === SIT13_EMPTY) { tree[node][bit] = tree.length; tree.push([SIT13_EMPTY, SIT13_EMPTY]); }
      node = tree[node][bit];
    }
    tree[node][0] = i; tree[node][1] = i;
  }
  return tree;
}
function sit13Decode(tree, br) {
  let node = 0;
  for (;;) {
    if (tree[node][0] === tree[node][1]) return tree[node][0];
    const next = tree[node][br.bit()];
    if (next === SIT13_EMPTY) return -1;
    node = next;
  }
}

/* One code table written into the stream, as a run-length coding of its own
   symbol lengths through the metacode. Verbatim from the Rust, including the
   trailing write after the switch, which is what makes most branches advance
   two entries rather than one. */
function sit13ParseCode(br, numCodes, metatree) {
  const lengths = new Array(numCodes).fill(0);
  let length = 0, i = 0;
  while (i < numCodes) {
    const val = sit13Decode(metatree, br);
    if (val < 0) throw new Error('StuffIt method 13: the code table is malformed');
    if (val === 31) length = -1;
    else if (val === 32) length += 1;
    else if (val === 33) length -= 1;
    else if (val === 34) { if (br.bit()) { lengths[i] = length; i++; } }
    else if (val === 35) { let c = br.bits(3) + 2;  while (c > 0 && i < numCodes) { lengths[i++] = length; c--; } }
    else if (val === 36) { let c = br.bits(6) + 10; while (c > 0 && i < numCodes) { lengths[i++] = length; c--; } }
    else length = val + 1;
    if (i < numCodes) { lengths[i] = length; i++; }
  }
  return sit13TreeFromLengths(lengths, numCodes);
}

/* `packed` is one fork's compressed bytes, `outLen` the length the catalog
   says it should come back as. Returns what it managed; the caller checks
   the length, so a stream that stops early is an error there rather than a
   silently short file here. */
function sit13Decompress(packed, outLen) {
  const out = new Uint8Array(outLen);
  let n = 0;
  if (!outLen) return out;
  const br = sit13Bits(packed);

  const first = br.bits(8);
  const code = first >> 4;
  let firstTree, secondTree, offsetTree;
  if (code === 0) {
    const meta = sit13TreeFromCodes(SIT13_META_CODES, SIT13_META_LENGTHS, 37);
    firstTree = sit13ParseCode(br, 321, meta);
    // Bit 3 says the second code is the first one over again, which is how a
    // stream avoids writing 321 lengths twice.
    secondTree = (first & 0x08) ? firstTree : sit13ParseCode(br, 321, meta);
    offsetTree = sit13ParseCode(br, (first & 0x07) + 10, meta);
  } else if (code < 6) {
    const idx = code - 1;
    firstTree  = sit13TreeFromLengths(SIT13_FIRST[idx], 321);
    secondTree = sit13TreeFromLengths(SIT13_SECOND[idx], 321);
    offsetTree = sit13TreeFromLengths(SIT13_OFFSET[idx], SIT13_OFFSET[idx].length);
  } else {
    throw new Error('StuffIt method 13: code ' + code + ' is not one of the six the format has');
  }

  let cur = firstTree;
  while (n < outLen) {
    const val = sit13Decode(cur, br);
    if (val < 0) break;
    if (val < 256) { out[n++] = val; cur = firstTree; continue; }
    if (val >= 320) break;
    // A match. The code to read the NEXT token with changes here and stays
    // changed until a literal puts it back, which is the whole of what the
    // two tables are for.
    cur = secondTree;
    let length = val - 256 + 3;
    if (val === 318) length = br.bits(10) + 65;
    else if (val === 319) length = br.bits(15) + 65;
    const bitLen = sit13Decode(offsetTree, br);
    if (bitLen < 0) break;
    const offset = bitLen === 0 ? 1 : bitLen === 1 ? 2
                 : (1 << (bitLen - 1)) + br.bits(bitLen - 1) + 1;
    if (offset > n) break;
    for (let k = 0; k < length && n < outLen; k++) { out[n] = out[n - offset]; n++; }
  }
  return n === outLen ? out : out.subarray(0, n);
}
const SIT13_META_CODES = [1496,88,64,192,0,120,43,20,12,28,27,11,16,32,56,24,216,3032,384,1664,896,3968,1920,1152,128,640,984,4056,2008,2520,472,4,1,2,7,3,8];
const SIT13_META_LENGTHS = [11,8,8,8,8,7,6,5,5,5,5,6,5,6,7,7,9,12,10,11,11,12,12,11,11,11,12,12,12,12,12,5,2,2,3,4,5];
const SIT13_FIRST = [[4,5,7,8,8,9,9,9,9,7,9,9,9,8,9,9,9,9,9,9,9,9,9,10,9,9,10,10,9,10,9,9,5,9,9,9,9,10,9,9,9,9,9,9,9,9,7,9,9,8,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,8,9,9,8,8,9,9,9,9,9,9,9,7,8,9,7,9,9,7,7,9,9,9,9,10,9,10,10,10,9,9,9,5,9,8,7,5,9,8,8,7,9,9,8,8,5,5,7,10,5,8,5,8,9,9,9,9,9,10,9,9,10,9,9,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,9,9,10,10,9,10,10,10,10,10,10,10,9,10,10,10,9,10,9,5,6,5,5,8,9,9,9,9,9,9,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,9,9,9,10,9,10,9,10,9,10,9,10,10,10,9,10,9,10,10,9,9,9,6,9,9,10,9,5],[4,7,7,8,7,8,8,8,8,7,8,7,8,7,9,8,8,8,9,9,9,9,10,10,9,10,10,10,10,10,9,9,5,9,8,9,9,11,10,9,8,9,9,9,8,9,7,8,8,8,9,9,9,9,9,10,9,9,9,10,9,9,10,9,8,8,7,7,7,8,8,9,8,8,9,9,8,8,7,8,7,10,8,7,7,9,9,9,9,10,10,11,11,11,10,9,8,6,8,7,7,5,7,7,7,6,9,8,6,7,6,6,7,9,6,6,6,7,8,8,8,8,9,10,9,10,9,9,8,9,10,10,9,10,10,9,9,10,10,10,10,10,10,10,9,10,10,11,10,10,10,10,10,10,10,11,10,11,10,10,9,11,10,10,10,10,10,10,9,9,10,11,10,11,10,11,10,12,10,11,10,12,11,12,10,12,10,11,10,11,11,11,9,10,11,11,11,12,12,10,10,10,11,11,10,11,10,10,9,11,10,11,10,11,11,11,10,11,11,12,11,11,10,10,10,11,10,10,11,11,12,10,10,11,11,12,11,11,10,11,9,12,10,11,11,11,10,11,10,11,10,11,9,10,9,7,3,5,6,6,7,7,8,8,8,9,9,9,11,10,10,10,12,13,11,12,12,11,13,12,12,11,12,12,13,12,14,13,14,13,15,13,14,15,15,14,13,15,15,14,15,14,15,15,14,15,13,13,14,15,15,14,14,16,16,15,15,15,12,15,10],[6,6,6,6,6,9,8,8,4,9,8,9,8,9,9,9,8,9,9,10,8,10,10,10,9,10,10,10,9,10,10,9,9,9,8,10,9,10,9,10,9,10,9,10,9,9,8,9,8,9,9,9,10,10,10,10,9,9,9,10,9,10,9,9,7,8,8,9,8,9,9,9,8,9,9,10,9,9,8,9,8,9,8,8,8,9,9,9,9,9,10,10,10,10,10,9,8,8,9,8,9,7,8,8,9,8,10,10,8,9,8,8,8,10,8,8,8,8,9,9,9,9,10,10,10,10,10,9,7,9,9,10,10,10,10,10,9,10,10,10,10,10,10,9,9,10,10,10,10,10,10,10,10,9,10,10,10,10,10,10,9,10,10,10,10,10,10,10,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,9,8,9,10,10,10,10,10,10,10,10,10,10,9,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,9,10,10,10,10,10,10,9,10,10,10,10,10,10,9,9,9,10,10,10,10,10,10,9,9,10,9,9,8,9,8,9,4,6,6,6,7,8,8,9,9,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,7,10,10,10,7,10,10,7,7,7,7,7,6,7,10,7,7,10,7,7,7,6,7,6,6,7,7,6,6,9,6,9,10,6,10],[2,6,6,7,7,8,7,8,7,8,8,9,8,9,9,9,8,8,9,9,9,10,10,9,8,10,9,10,9,10,9,9,6,9,8,9,9,10,9,9,9,10,9,9,9,9,8,8,8,8,8,9,9,9,9,9,9,9,9,9,9,10,10,9,7,7,8,8,8,8,9,9,7,8,9,10,8,8,7,8,8,10,8,8,8,9,8,9,9,10,9,11,10,11,9,9,8,7,9,8,8,6,8,8,8,7,10,9,7,8,7,7,8,10,7,7,7,8,9,9,9,9,10,11,9,11,10,9,7,9,10,10,10,11,11,10,10,11,10,10,10,11,11,10,9,10,10,11,10,11,10,11,10,10,10,11,10,11,10,10,9,10,10,11,10,11,10,11,9,10,10,10,10,11,10,11,10,11,10,11,11,11,10,12,10,11,10,11,10,11,11,10,8,10,10,11,10,11,11,11,10,11,10,11,10,11,11,11,9,10,11,11,10,11,11,11,10,11,11,11,10,10,10,10,10,11,10,10,11,11,10,10,9,11,10,10,11,11,10,10,10,11,10,10,10,10,10,10,9,11,10,10,8,10,8,6,5,6,6,7,7,8,8,8,9,10,11,10,10,11,11,12,12,10,11,12,12,12,12,13,13,13,13,13,12,13,13,15,14,12,14,15,16,12,12,13,15,14,16,15,17,18,15,17,16,15,15,15,15,13,13,10,14,12,13,17,17,18,10,17,4],[7,9,9,9,9,9,9,9,9,8,9,9,9,7,9,9,9,9,9,9,9,9,9,10,9,10,9,10,9,10,9,9,5,9,7,9,9,9,9,9,7,7,7,9,7,7,8,7,8,8,7,7,9,9,9,9,7,7,7,9,9,9,9,9,9,7,9,7,7,7,7,9,9,7,9,9,7,7,7,7,7,9,7,8,7,9,9,9,9,9,9,9,9,9,9,9,9,7,8,7,7,7,8,8,6,7,9,7,7,8,7,5,6,9,5,7,5,6,7,7,9,8,9,9,9,9,9,9,9,9,10,9,10,10,10,9,9,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,9,10,10,10,9,9,10,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,9,10,10,10,9,10,10,10,9,9,9,10,10,10,10,10,9,10,9,10,10,9,10,10,9,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,10,10,10,10,10,9,10,9,10,9,10,10,9,5,6,8,8,7,7,7,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,10,9,10,10,5,10,8,9,8,9]];
const SIT13_SECOND = [[4,5,6,6,7,7,6,7,7,7,6,8,7,8,8,8,8,9,6,9,8,9,8,9,9,9,8,10,5,9,7,9,6,9,8,10,9,10,8,8,9,9,7,9,8,9,8,9,8,8,6,9,9,8,8,9,9,10,8,9,9,10,8,10,8,8,8,8,8,9,7,10,6,9,9,11,7,8,8,9,8,10,7,8,6,9,10,9,9,10,8,11,9,11,9,10,9,8,9,8,8,8,8,10,9,9,10,10,8,9,8,8,8,11,9,8,8,9,9,10,8,11,10,10,8,10,9,10,8,9,9,11,9,11,9,10,10,11,10,12,9,12,10,11,10,11,9,10,10,11,10,11,10,11,10,11,10,10,10,9,9,9,8,7,6,8,11,11,9,12,10,12,9,11,11,11,10,12,11,11,10,12,10,11,10,10,10,11,10,11,11,11,9,12,10,12,11,12,10,11,10,12,11,12,11,12,11,12,10,12,11,12,11,11,10,12,10,11,10,12,10,12,10,12,10,11,11,11,10,11,11,11,10,12,11,12,10,10,11,11,9,12,11,12,10,11,10,12,10,11,10,12,10,11,10,7,5,4,6,6,7,7,7,8,8,7,7,6,8,6,7,7,9,8,9,9,10,11,11,11,12,11,10,11,12,11,12,11,12,12,12,12,11,12,12,11,12,11,12,11,13,11,12,10,13,10,14,14,13,14,15,14,16,15,15,18,18,18,9,18,8],[5,6,6,6,6,7,7,7,7,7,7,8,7,8,7,7,7,8,8,8,8,9,8,9,8,9,9,9,7,9,8,8,6,9,8,9,8,9,8,9,8,9,8,9,8,9,8,8,8,8,8,9,8,9,8,9,9,10,8,10,8,9,9,8,8,8,7,8,8,9,8,9,7,9,8,10,8,9,8,9,8,9,8,8,8,9,9,9,9,10,9,11,9,10,9,10,8,8,8,9,8,8,8,9,9,8,9,10,8,9,8,8,8,11,8,7,8,9,9,9,9,10,9,10,9,10,9,8,8,9,9,10,9,10,9,10,8,10,9,10,9,11,10,11,9,11,10,10,10,11,9,11,9,10,9,11,9,11,10,10,9,10,9,9,8,10,9,11,9,9,9,11,10,11,9,11,9,11,9,11,10,11,10,11,10,11,9,10,10,11,10,10,8,10,9,10,10,11,9,11,9,10,10,11,9,10,10,9,9,10,9,10,9,10,9,10,9,11,9,11,10,10,9,10,9,11,9,11,9,11,9,10,9,11,9,11,9,11,9,10,8,11,9,10,9,10,9,10,8,10,8,9,8,9,8,7,4,4,5,6,6,6,7,7,7,7,8,8,8,7,8,8,9,9,10,10,10,10,10,10,11,11,10,10,12,11,11,12,12,11,12,12,11,12,12,12,12,12,12,11,12,11,13,12,13,12,13,14,14,14,15,13,14,13,14,18,18,17,7,16,9],[5,6,6,6,6,7,7,7,6,8,7,8,7,9,8,8,7,7,8,9,9,9,9,10,8,9,9,10,8,10,9,8,6,10,8,10,8,10,9,9,9,9,9,10,9,9,8,9,8,9,8,9,9,10,9,10,9,9,8,10,9,11,10,8,8,8,8,9,7,9,9,10,8,9,8,11,9,10,9,10,8,9,9,9,9,8,9,9,10,10,10,12,10,11,10,10,8,9,9,9,8,9,8,8,10,9,10,11,8,10,9,9,8,12,8,9,9,9,9,8,9,10,9,12,10,10,10,8,7,11,10,9,10,11,9,11,7,11,10,12,10,12,10,11,9,11,9,12,10,12,10,12,10,9,11,12,10,12,10,11,9,10,9,10,9,11,11,12,9,10,8,12,11,12,9,12,10,12,10,13,10,12,10,12,10,12,10,9,10,12,10,9,8,11,10,12,10,12,10,12,10,11,10,12,8,12,10,11,10,10,10,12,9,11,10,12,10,12,11,12,10,9,10,12,9,10,10,12,10,11,10,11,10,12,8,12,9,12,8,12,8,11,10,11,10,11,9,10,8,10,9,9,8,9,8,7,4,3,5,5,6,5,6,6,7,7,8,8,8,7,7,7,9,8,9,9,11,9,11,9,8,9,9,11,12,11,12,12,13,13,12,13,14,13,14,13,14,13,13,13,12,13,13,12,13,13,14,14,13,13,14,14,14,14,15,18,17,18,8,16,10],[4,5,6,6,6,6,7,7,6,7,7,9,6,8,8,7,7,8,8,8,6,9,8,8,7,9,8,9,8,9,8,9,6,9,8,9,8,10,9,9,8,10,8,10,8,9,8,9,8,8,7,9,9,9,9,9,8,10,9,10,9,10,9,8,7,8,9,9,8,9,9,9,7,10,9,10,9,9,8,9,8,9,8,8,8,9,9,10,9,9,8,11,9,11,10,10,8,8,10,8,8,9,9,9,10,9,10,11,9,9,9,9,8,9,8,8,8,10,10,9,9,8,10,11,10,11,11,9,8,9,10,11,9,10,11,11,9,12,10,10,10,12,11,11,9,11,11,12,9,11,9,10,10,10,10,12,9,11,10,11,9,11,11,11,10,11,11,12,9,10,10,12,11,11,10,11,9,11,10,11,10,11,9,11,11,9,8,11,10,11,11,10,7,12,11,11,11,11,11,12,10,12,11,13,11,10,12,11,10,11,10,11,10,11,10,11,10,12,11,11,10,11,10,10,10,11,10,12,11,12,10,11,9,11,10,11,10,11,10,12,9,11,11,11,9,11,10,10,9,11,10,10,9,10,9,7,4,5,5,5,6,6,7,6,8,7,8,9,9,7,8,8,10,9,10,10,12,10,11,11,11,11,10,11,12,11,11,11,11,11,13,12,11,12,13,12,12,12,13,11,9,12,13,7,13,11,13,11,10,11,13,15,15,12,14,15,15,15,6,15,5],[8,10,11,11,11,12,11,11,12,6,11,12,10,5,12,12,12,12,12,12,12,13,13,14,13,13,12,13,12,13,12,15,4,10,7,9,11,11,10,9,6,7,8,9,6,7,6,7,8,7,7,8,8,8,8,8,8,9,8,7,10,9,10,10,11,7,8,6,7,8,8,9,8,7,10,10,8,7,8,8,7,10,7,6,7,9,9,8,11,11,11,10,11,11,11,8,11,6,7,6,6,6,6,8,7,6,10,9,6,7,6,6,7,10,6,5,6,7,7,7,10,8,11,9,13,7,14,16,12,14,14,15,15,16,16,14,15,15,15,15,15,15,15,15,14,15,13,14,14,16,15,17,14,17,15,17,12,14,13,16,12,17,13,17,14,13,13,14,14,12,13,15,15,14,15,17,14,17,15,14,15,16,12,16,15,14,15,16,15,16,17,17,15,15,17,17,13,14,15,15,13,12,16,16,17,14,15,16,15,15,13,13,15,13,16,17,15,17,17,17,16,17,14,17,14,16,15,17,15,15,14,17,15,17,15,16,15,15,16,16,14,17,17,15,15,16,15,17,15,14,16,16,16,16,16,12,4,4,5,5,6,6,6,7,7,7,8,8,8,8,9,9,9,9,9,10,10,10,11,10,11,11,11,11,11,12,12,12,13,13,12,13,12,14,14,12,13,13,13,13,14,12,13,13,14,14,14,13,14,14,15,15,13,15,13,17,17,17,9,17,7]];
const SIT13_OFFSET = [[5,6,3,3,3,3,3,3,3,4,6],[5,6,4,4,3,3,3,3,3,4,4,4,6],[6,7,4,4,3,3,3,3,3,4,4,4,5,7],[3,6,5,4,2,3,3,3,4,4,6],[6,7,7,6,4,3,2,2,3,3,6]];

/* ---- StuffIt method 15, Arsenic --------------------------------------------

   WHY THIS IS HERE. Method 13 opened the add-ons; this opens what is inside
   the rest of them. Every resource fork in archive.org's four-in-one bundle
   is Arsenic, and so are the 3D Cursors add-on and the I.M.Cheater saved
   game -- so the page could list a file and not hand it over, and the
   installer's own resource fork, which is where its VISE icon lives, was
   reachable only from a MacBinary copy.

   WHAT IT IS. Arsenic is bzip2's shape under a different coder: the block is
   Burrows-Wheeler transformed, move-to-front coded, run-length coded, and the
   symbols are written by an adaptive binary-free arithmetic coder rather than
   Huffman. Decoding runs the same pipeline backwards.

   - **The coder** keeps a 26-bit range and code word, reads bits high bit
     first, and takes a symbol by dividing the code by the range over the
     model's total frequency. Every model is adaptive: a symbol's frequency
     rises by the model's increment each time it is read, and when the total
     passes the model's limit every frequency halves.
   - **The selector model** codes eleven outcomes: 0 and 1 are the two digits
     of a run of the move-to-front list's head (bijective base 2, as bzip2's
     RUNA and RUNB), 2 is "the next symbol is index 1", 3 to 9 choose one of
     seven index models covering 2, 4, 8, 16, 32, 64 and 128 indices, and 10
     ends the block.
   - **The inverse transform** is the usual counting sort: the number of bytes
     below each value gives each row's place, and walking that vector from the
     index the block carries reproduces the original order.
   - **Randomisation** is a flag on the block. When it is set, the byte at
     every position named by a walk of the 256-entry table has its low bit
     flipped back. Nothing in the Cythera corpus sets it, so that path is
     written from the specification and is not exercised by the check.
   - **The last stage** is a run-length code: four equal bytes are followed by
     a count of how many more of them there are.

   WHERE THE FORMAT CAME FROM. Ported from `SitArsenicDecoder` in stuffit-rs
   0.1.8 (Ben Letchford, MIT OR Apache-2.0), the same crate this file's header
   layouts came from, which carries The Unarchiver's tables and cites
   `XADStuffItArsenicHandle.m`. The randomisation table is transcribed from
   it. `utilities/sit_methods_check.mjs` holds the result to `unar` byte for
   byte, which is the implementation all of these descend from. */

// The 256 gaps between the positions a randomised block flips. Transcribed
// from stuffit-rs, which took it from The Unarchiver.
const ARSENIC_RANDOM = [
  0xee, 0x56, 0xf8, 0xc3, 0x9d, 0x9f, 0xae, 0x2c, 0xad, 0xcd, 0x24, 0x9d, 0xa6, 0x101, 0x18,
  0xb9, 0xa1, 0x82, 0x75, 0xe9, 0x9f, 0x55, 0x66, 0x6a, 0x86, 0x71, 0xdc, 0x84, 0x56, 0x96, 0x56,
  0xa1, 0x84, 0x78, 0xb7, 0x32, 0x6a, 0x03, 0xe3, 0x02, 0x11, 0x101, 0x08, 0x44, 0x83, 0x100, 0x43,
  0xe3, 0x1c, 0xf0, 0x86, 0x6a, 0x6b, 0x0f, 0x03, 0x2d, 0x86, 0x17, 0x7b, 0x10, 0xf6, 0x80, 0x78,
  0x7a, 0xa1, 0xe1, 0xef, 0x8c, 0xf6, 0x87, 0x4b, 0xa7, 0xe2, 0x77, 0xfa, 0xb8, 0x81, 0xee, 0x77,
  0xc0, 0x9d, 0x29, 0x20, 0x27, 0x71, 0x12, 0xe0, 0x6b, 0xd1, 0x7c, 0x0a, 0x89, 0x7d, 0x87, 0xc4,
  0x101, 0xc1, 0x31, 0xaf, 0x38, 0x03, 0x68, 0x1b, 0x76, 0x79, 0x3f, 0xdb, 0xc7, 0x1b, 0x36, 0x7b,
  0xe2, 0x63, 0x81, 0xee, 0x0c, 0x63, 0x8b, 0x78, 0x38, 0x97, 0x9b, 0xd7, 0x8f, 0xdd, 0xf2, 0xa3,
  0x77, 0x8c, 0xc3, 0x39, 0x20, 0xb3, 0x12, 0x11, 0x0e, 0x17, 0x42, 0x80, 0x2c, 0xc4, 0x92, 0x59,
  0xc8, 0xdb, 0x40, 0x76, 0x64, 0xb4, 0x55, 0x1a, 0x9e, 0xfe, 0x5f, 0x06, 0x3c, 0x41, 0xef, 0xd4,
  0xaa, 0x98, 0x29, 0xcd, 0x1f, 0x02, 0xa8, 0x87, 0xd2, 0xa0, 0x93, 0x98, 0xef, 0x0c, 0x43, 0xed,
  0x9d, 0xc2, 0xeb, 0x81, 0xe9, 0x64, 0x23, 0x68, 0x1e, 0x25, 0x57, 0xde, 0x9a, 0xcf, 0x7f, 0xe5,
  0xba, 0x41, 0xea, 0xea, 0x36, 0x1a, 0x28, 0x79, 0x20, 0x5e, 0x18, 0x4e, 0x7c, 0x8e, 0x58, 0x7a,
  0xef, 0x91, 0x02, 0x93, 0xbb, 0x56, 0xa1, 0x49, 0x1b, 0x79, 0x92, 0xf3, 0x58, 0x4f, 0x52, 0x9c,
  0x02, 0x77, 0xaf, 0x2a, 0x8f, 0x49, 0xd0, 0x99, 0x4d, 0x98, 0x101, 0x60, 0x93, 0x100, 0x75,
  0x31, 0xce, 0x49, 0x20, 0x56, 0x57, 0xe2, 0xf5, 0x26, 0x2b, 0x8a, 0xbf, 0xde, 0xd0, 0x83, 0x34,
  0xf4, 0x17
];

// An adaptive frequency table. `first` is the symbol the first slot stands
// for, so a model can code a range that does not start at zero.
function arsModel(first, n, increment, limit) {
  const freq = new Uint16Array(n).fill(increment);
  return { first, n, freq, increment, limit, total: n * increment,
    reset() { this.freq.fill(this.increment); this.total = this.n * this.increment; },
    update(i) {
      this.freq[i] += this.increment;
      this.total += this.increment;
      if (this.total > this.limit) {
        this.total = 0;
        for (let k = 0; k < this.n; k++) { this.freq[k] = (this.freq[k] + 1) >> 1; this.total += this.freq[k]; }
      }
    } };
}

const ARS_BITS = 26, ARS_ONE = 1 << (ARS_BITS - 1), ARS_HALF = 1 << (ARS_BITS - 2);

function arsDecoder(data) {
  const d = { data, pos: 0, buf: 0, bits: 0, range: ARS_ONE, code: 0 };
  d.bit = function () {
    if (this.bits === 0) {
      if (this.pos >= this.data.length) return 0;      // past the end reads zeroes
      this.buf = this.data[this.pos++]; this.bits = 8;
    }
    this.bits--;
    return (this.buf >> this.bits) & 1;
  };
  for (let i = 0; i < ARS_BITS; i++) d.code = (d.code << 1) | d.bit();
  d.symbol = function (m) {
    const step = Math.floor(this.range / m.total);
    const want = Math.floor(this.code / step);
    let cum = 0, n = 0;
    while (n < m.n - 1 && cum + m.freq[n] <= want) { cum += m.freq[n]; n++; }
    const size = m.freq[n], low = step * cum;
    this.code -= low;
    // The last symbol takes what is left of the range rather than its own
    // share of it, so that the range never loses a count to the division.
    this.range = (cum + size === m.total) ? this.range - low : size * step;
    while (this.range <= ARS_HALF) { this.range <<= 1; this.code = (this.code << 1) | this.bit(); }
    m.update(n);
    return m.first + n;
  };
  // Little end first, which is the order the header fields are written in.
  d.bitString = function (m, n) {
    let v = 0;
    for (let i = 0; i < n; i++) if (this.symbol(m)) v |= 1 << i;
    return v >>> 0;
  };
  return d;
}

function arsenicDecompress(packed, outLen) {
  const dec = arsDecoder(packed);
  const out = new Uint8Array(outLen);
  let written = 0;
  const header = arsModel(0, 2, 1, 256);
  if (dec.bitString(header, 8) !== 0x41 || dec.bitString(header, 8) !== 0x73)
    throw new Error('that is not an Arsenic stream: it does not begin "As"');
  const blockBits = dec.bitString(header, 4) + 9;

  const selector = arsModel(0, 11, 8, 1024);
  const index = [arsModel(2, 2, 8, 1024), arsModel(4, 4, 4, 1024), arsModel(8, 8, 4, 1024),
                 arsModel(16, 16, 4, 1024), arsModel(32, 32, 2, 1024), arsModel(64, 64, 2, 1024),
                 arsModel(128, 128, 1, 1024)];

  while (written < outLen) {
    if (dec.symbol(header) !== 0) break;               // the end of the last block
    const randomised = dec.symbol(header) !== 0;
    const start = dec.bitString(header, blockBits);

    // The move-to-front pass, straight into the block, which cannot outgrow
    // the size the header declared.
    const block = new Uint8Array(1 << blockBits);
    let bn = 0;
    const put = v => { if (bn >= block.length) throw new Error('an Arsenic block ran past the size its header declared'); block[bn++] = v; };
    const mtf = []; for (let i = 0; i < 256; i++) mtf.push(i);
    for (;;) {
      let sel = dec.symbol(selector);
      if (sel <= 1) {
        // A run of the list's head, in bijective base 2: each digit is worth
        // twice the last, and 0 counts once where 1 counts twice.
        let place = 1, run = 0;
        while (sel < 2) { run += (sel === 0 ? place : 2 * place); place *= 2; sel = dec.symbol(selector); }
        const head = mtf[0];
        for (let i = 0; i < run; i++) put(head);
        if (sel === 10) break;
      } else if (sel === 10) break;
      const at = sel === 2 ? 1 : dec.symbol(index[sel - 3]);
      const v = mtf.splice(at, 1)[0];
      mtf.unshift(v);
      put(v);
    }
    if (start >= bn) break;
    selector.reset();
    for (const m of index) m.reset();

    // The inverse transform: where each byte of the sorted column came from.
    const counts = new Uint32Array(256);
    for (let i = 0; i < bn; i++) counts[block[i]]++;
    const place = new Uint32Array(256);
    for (let i = 0, sum = 0; i < 256; i++) { place[i] = sum; sum += counts[i]; }
    const transform = new Uint32Array(bn);
    for (let i = 0; i < bn; i++) transform[place[block[i]]++] = i;

    let idx = start, taken = 0, run = 0, same = 0, last = 0;
    let randAt = 0, randNext = ARSENIC_RANDOM[0];
    while ((taken < bn || run > 0) && written < outLen) {
      if (run > 0) { out[written++] = last; run--; continue; }
      idx = transform[idx];
      let b = block[idx];
      if (randomised && randNext === taken) {
        b ^= 1;
        randAt = (randAt + 1) & 255;
        randNext += ARSENIC_RANDOM[randAt];
      }
      taken++;
      if (same === 4) {
        // Four of a kind, and this byte says how many more.
        same = 0;
        if (b === 0) continue;
        run = b - 1;
        out[written++] = last;
      } else {
        if (b === last) same++; else { same = 1; last = b; }
        out[written++] = b;
      }
    }
  }
  return written === outLen ? out : out.subarray(0, written);
}
