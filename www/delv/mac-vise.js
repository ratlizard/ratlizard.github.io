/* mac-vise.js -- open an Installer VISE 3 archive.
   =========================================================================

   Cythera shipped as one file: "Cythera Installer", an application built with
   MindVision's Installer VISE 3.6. Its data fork is an `SVCT` archive holding
   the whole install tree -- the game, its data file, the Combat AI scripts,
   the documentation, the licence, the InputSprocket drivers -- with both forks
   of every file. `parseViseArchive()` reads that catalog and `viseExtract()`
   gives back a file's two forks. Nothing here knows Cythera exists: it is the
   installer's format, and a MacBinary of any VISE 3 installer opens the same
   way.

   WHERE THE FORMAT CAME FROM

   This is the case CLAUDE.md's licensing note names: copy freely where there
   is no oracle role. The catalog layout, the byte-substitution table and the
   fact that what is left after it is a raw DEFLATE stream were read from
   `src/game/vise.rs` in ratlizard/wolflizard (GPL-3.0-or-later), which in turn
   credits ScummVM's `common/compression/vise.cpp` for the table. The
   DelvTechWiki page on the installer (delvmod/wiki/) documents the same
   catalog fields from the community side, and identified the CRC.

   Three things were established here, against the 1.0.4 installer, and are
   not in either source:

   - Which directory a file is in. vise.rs reads a 16-bit field at record
     offset 92 as the parent; in this file that field is the file's DEPTH
     (0 at the top, 1, 2), and reading it as a parent puts every second-level
     file into whichever directory happened to be listed second. The parent is
     the 32-bit directory ID at offset 84, matched against the ID each
     directory record declares at ITS offset 24 (its own parent at 28; 2 is
     the root). `viseExtract` was checked file by file against the installed
     folder.
   - Where a grouped file's resource fork is. VISE packs small files that sit
     together into one stream: the nine Combat AI files share a single 6,580-
     byte stream holding data fork, resource fork, data fork, resource fork…
     Bit 0x10 of record byte 8 marks a file packed that way. For one, record
     offset 100 is the file's data fork offset inside that decoded stream,
     and offset 104 is its resource fork offset -- not, as vise.rs assumes,
     the same offset applied to a second stream. The CRC settled it: with the
     fork taken from offset 104 every grouped file's checksum matches, and
     with it taken any other way none does. The flag, not the offsets, is
     what says a file is grouped: in the 1.0.2 and 1.0.3 installers both
     offset fields hold leftover memory for every ungrouped file (the same
     two garbage words in each), and reading them as offsets asks for a fork
     four gigabytes into a six-megabyte stream. The 1.0.4 installer happens
     to have zeros there, which is how the offsets looked like the rule for
     a day.
   - What the CRC covers. Record offset 80 is CRC-32 (the ordinary reflected
     one, PNG's and ZIP's) over the data fork followed by the resource fork.
     Every one of the 53 entries verifies.

   THE STREAM

   Each packed stream is DEFLATE with two twists. Before inflating, every pair
   of bytes is swapped and each byte is put through the substitution table
   below; VISE's decompressor read its input a 16-bit word at a time, which is
   also why a STORED block's length words start on a word boundary rather
   than RFC 1951's byte boundary. The catalog's fork lengths are authoritative:
   the original stops after that many bytes whatever the bitstream would yield.
   `inflateRaw` below is a plain RFC 1951 decoder written for this file rather
   than a dependency -- the page has none and works from file:// -- with the
   stored-block alignment as a parameter, tried at 8 first and at 16 when that
   fails, which is the order systemless uses and covers the five streams in
   this installer that standard zlib refuses. One more word-reader habit was
   needed for the largest of the five: after a STORED block of odd length the
   next block header also begins on a word boundary, not the byte after.

   LOAD ORDER: after mac-bytes.js (u16be, u32be, fourcc, decodeMacRoman,
   crc32), mac-containers.js (sniffMacContainer) and mac-stuffit.js
   (parseStuffItArchive, stuffItFork) -- sniffViseInstaller uses both.
   A classic script, like the rest of js/: no import, no export, globals. */

/* ---- the byte substitution -------------------------------------------- */
/* The inverse of what VISE applied on the way in. Index by the byte read
 * from the file (after the pair swap) to get the DEFLATE byte. */
const VISE_DEOBFUSCATION_TABLE = new Uint8Array([
  0x6a, 0xb7, 0x36, 0xec, 0x15, 0xd9, 0xc8, 0x73, 0xe8, 0x38, 0x9a, 0xdf, 0x21, 0x25, 0xd0, 0xcc,
  0xfd, 0xdc, 0x16, 0xd7, 0xe3, 0x43, 0x05, 0xc5, 0x8f, 0x48, 0xda, 0xf2, 0x3f, 0x10, 0x23, 0x6c,
  0x77, 0x7c, 0xf9, 0xa0, 0xa3, 0xe9, 0xed, 0x46, 0x8b, 0xd8, 0xac, 0x54, 0xce, 0x2d, 0x19, 0x5e,
  0x6d, 0x7d, 0x87, 0x5d, 0xfa, 0x5b, 0x9b, 0xe0, 0xc7, 0xee, 0x9f, 0x52, 0xa9, 0xb9, 0x0a, 0xd1,
  0xfe, 0x78, 0x76, 0x4a, 0x3d, 0x44, 0x5a, 0x96, 0x90, 0x1f, 0x26, 0x9d, 0x58, 0x1b, 0x8e, 0x57,
  0x59, 0xc3, 0x0b, 0x6b, 0xfc, 0x1d, 0xe6, 0xa2, 0x7f, 0x92, 0x4f, 0x40, 0xb4, 0x06, 0x72, 0x4d,
  0xf4, 0x34, 0xaa, 0xd2, 0x49, 0xad, 0xef, 0x22, 0x1a, 0xb5, 0xba, 0xbf, 0x29, 0x68, 0x89, 0x93,
  0x3e, 0x32, 0x04, 0xf5, 0xde, 0xe1, 0x6f, 0xfb, 0x67, 0xe4, 0x7e, 0x08, 0xaf, 0xf0, 0xab, 0x41,
  0x82, 0xea, 0x50, 0x0f, 0x2a, 0xc6, 0x35, 0xb3, 0xa8, 0xca, 0xe5, 0x4c, 0x45, 0x8a, 0x97, 0xae,
  0xd6, 0x66, 0x27, 0x53, 0xc9, 0x1c, 0x3c, 0x03, 0x99, 0xc1, 0x09, 0x2e, 0x69, 0x37, 0x8d, 0x2f,
  0x60, 0xc2, 0xa6, 0x18, 0x4e, 0x7a, 0xb8, 0xcf, 0xa7, 0x3a, 0x17, 0xd5, 0x9e, 0xf1, 0x84, 0x51,
  0x0d, 0xa4, 0x64, 0xc4, 0x1e, 0xb1, 0x30, 0x98, 0xbb, 0x79, 0x01, 0xf6, 0x62, 0x0e, 0xb2, 0x63,
  0x91, 0xcb, 0xff, 0x80, 0x71, 0xe7, 0xd4, 0x00, 0xdb, 0x75, 0x2c, 0xbd, 0x39, 0x33, 0x94, 0xbc,
  0x8c, 0x3b, 0xb6, 0x20, 0x85, 0x24, 0x88, 0x2b, 0x70, 0x83, 0x6e, 0x7b, 0x9c, 0xbe, 0x14, 0x47,
  0x65, 0x4b, 0x56, 0x81, 0xf8, 0x12, 0x11, 0x28, 0xeb, 0x55, 0x74, 0xa1, 0x31, 0xf7, 0xb0, 0x13,
  0x86, 0xdd, 0x5f, 0x42, 0xd3, 0x02, 0x61, 0x95, 0x0c, 0x5c, 0xa5, 0xcd, 0xc0, 0x07, 0xe2, 0xf3
]);

/* ---- raw DEFLATE ------------------------------------------------------- */
/* RFC 1951, decoded the way zlib's `puff` does it: canonical Huffman codes
 * held as a count-per-length table and a symbol list, one bit at a time.
 * Slower than a table-driven inflater and fast enough -- the 2.9 MB stream
 * that holds Cythera Data inflates in well under a second -- and small enough
 * to read against the RFC in one sitting, which matters more here. */
const INFLATE_LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const INFLATE_LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const INFLATE_DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const INFLATE_DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const INFLATE_CLEN_ORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

/* Build a canonical decoding table from a list of code lengths. Returns
 * {count, symbol}: count[len] is how many codes have that length, symbol[]
 * the symbols in canonical order. An over-subscribed set is an error; an
 * incomplete one is allowed (a single distance code is common). */
function inflateBuildTable(lengths, n) {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  if (count[0] === n) return { count, symbol: new Uint16Array(0) };   // no codes at all
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) throw new Error('over-subscribed Huffman code');
  }
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

/* Inflate a raw DEFLATE stream into at most `expected` bytes.
 *
 *   storedAlign   8 for RFC 1951; 16 for VISE, whose STORED blocks begin on a
 *                 16-bit word boundary.
 *
 * Stops as soon as `expected` bytes exist, whatever the bitstream still
 * holds. Runs on past a final block if the output is still short and input
 * remains -- systemless found installers whose streams are several finished
 * DEFLATE members back to back, each starting on a word. Throws on a
 * malformed stream or on running out of input. */
function inflateRaw(input, expected, storedAlign) {
  const out = new Uint8Array(expected);
  let outPos = 0;
  let inPos = 0, bitBuf = 0, bitCnt = 0;

  function bits(n) {
    let v = bitBuf;
    while (bitCnt < n) {
      if (inPos >= input.length) throw new Error('DEFLATE input ran out');
      v |= input[inPos++] << bitCnt;
      bitCnt += 8;
    }
    bitBuf = v >>> n;
    bitCnt -= n;
    return v & ((1 << n) - 1);
  }
  function decode(h) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('bad Huffman code');
  }
  function alignInput(toBits) {
    bitBuf = 0; bitCnt = 0;          // drop the rest of the current byte
    if (toBits === 16 && (inPos & 1)) inPos++;
  }
  function codes(lencode, distcode) {
    for (;;) {
      let sym = decode(lencode);
      if (sym < 256) {
        out[outPos++] = sym;
        if (outPos === expected) return true;
        continue;
      }
      if (sym === 256) return false;
      sym -= 257;
      if (sym >= 29) throw new Error('bad length symbol');
      const len = INFLATE_LEN_BASE[sym] + bits(INFLATE_LEN_EXTRA[sym]);
      const dsym = decode(distcode);
      if (dsym >= 30) throw new Error('bad distance symbol');
      const dist = INFLATE_DIST_BASE[dsym] + bits(INFLATE_DIST_EXTRA[dsym]);
      if (dist > outPos) throw new Error('distance reaches before the start of the output');
      let from = outPos - dist;
      for (let i = 0; i < len; i++) {
        out[outPos++] = out[from++];
        if (outPos === expected) return true;
      }
    }
  }

  let fixedLen = null, fixedDist = null;
  for (;;) {
    const last = bits(1);
    const type = bits(2);
    let done = false;
    if (type === 0) {
      alignInput(storedAlign);
      if (inPos + 4 > input.length) throw new Error('stored block header ran out');
      const len = input[inPos] | (input[inPos + 1] << 8);
      const nlen = input[inPos + 2] | (input[inPos + 3] << 8);
      if (len !== (~nlen & 0xFFFF))
        throw new Error('stored block length check failed at input byte ' + inPos + ', output byte ' + outPos);
      inPos += 4;
      if (inPos + len > input.length) throw new Error('stored block ran out');
      const take = Math.min(len, expected - outPos);
      out.set(input.subarray(inPos, inPos + take), outPos);
      outPos += take;
      inPos += len;
      // A word reader that just copied an odd number of bytes is holding
      // half a word; the next block header starts on the word after it.
      if (storedAlign === 16 && (inPos & 1)) inPos++;
      done = outPos === expected;
    } else if (type === 1) {
      if (!fixedLen) {
        const l = new Uint8Array(288);
        for (let i = 0; i < 144; i++) l[i] = 8;
        for (let i = 144; i < 256; i++) l[i] = 9;
        for (let i = 256; i < 280; i++) l[i] = 7;
        for (let i = 280; i < 288; i++) l[i] = 8;
        fixedLen = inflateBuildTable(l, 288);
        const d = new Uint8Array(30).fill(5);
        fixedDist = inflateBuildTable(d, 30);
      }
      done = codes(fixedLen, fixedDist);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw new Error('bad dynamic block counts');
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[INFLATE_CLEN_ORDER[i]] = bits(3);
      const lencode0 = inflateBuildTable(lengths, 19);
      let index = 0;
      while (index < nlen + ndist) {
        let sym = decode(lencode0);
        if (sym < 16) { lengths[index++] = sym; continue; }
        let len = 0, rep;
        if (sym === 16) {
          if (index === 0) throw new Error('repeat with no previous length');
          len = lengths[index - 1]; rep = 3 + bits(2);
        } else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (index + rep > nlen + ndist) throw new Error('too many code lengths');
        while (rep--) lengths[index++] = len;
      }
      if (lengths[256] === 0) throw new Error('no end-of-block code');
      const lencode = inflateBuildTable(lengths.subarray(0, nlen), nlen);
      const distcode = inflateBuildTable(lengths.subarray(nlen, nlen + ndist), ndist);
      done = codes(lencode, distcode);
    } else {
      throw new Error('reserved block type');
    }
    if (done) break;
    if (last) {
      if (outPos >= expected) break;
      // A finished member with output still owed: the next one starts on
      // the next word (byte, for a standard stream).
      alignInput(storedAlign);
      if (inPos >= input.length) throw new Error('stream ended after ' + outPos + ' of ' + expected + ' bytes');
    }
  }
  if (outPos !== expected) throw new Error('stream yielded ' + outPos + ' of ' + expected + ' bytes');
  return out;
}

/* ---- the archive ------------------------------------------------------- */
const VISE_MAGIC = 'SVCT';
const VISE_CATALOG_MAGIC = 'CVCT';
const VISE_HEADER_LEN = 44;
const VISE_CATALOG_HEADER_LEN = 20;
const VISE_VERSIONS = {
  0x80010201: 'Installer VISE 3.5',
  0x80010202: 'Installer VISE 3.5 Lite',
  0x80010300: 'Installer VISE 3.6 Lite',
  0x80010307: 'Installer VISE 3.6'          // the extended catalog; Cythera's
};
const VISE_DIRECTORY_RECORD_LEN = 78;
const VISE_FILE_RECORD_LEN = 120;
const VISE_EXTENDED_CATALOG_PREFIX_LEN = 80;   // 'PACK…', before the first entry
const VISE_EXTENDED_DIRECTORY_SUFFIX_LEN = 66;
const VISE_EXTENDED_FILE_SUFFIX_LEN = 62;
const VISE_ROOT_DIRECTORY_ID = 2;

function looksLikeVise(bytes) {
  return !!bytes && bytes.length >= VISE_HEADER_LEN && fourcc(bytes, 0) === VISE_MAGIC;
}

/* Read the catalog. `bytes` is the SVCT data fork itself. Returns
 *
 *   { version, versionName, catalogOffset, bytes, dirs: [...], entries: [...] }
 *
 * where each entry is one file:
 *
 *   path            "Cythera 1.0.4 ƒ/Cythera Data" -- directory names joined
 *                   with '/', from the directory IDs
 *   name, dirId, type, creator, finderFlags, created, modified
 *   dataLen, rsrcLen           uncompressed, from the catalog: authoritative
 *   packedOffset, packedLen    the stream holding the data fork (or, for a
 *                              grouped file, both forks)
 *   rsrcPackedOffset, rsrcPackedLen   the resource fork's own stream, when
 *                              it has one; 0/0 for a grouped file
 *   dataOffset, rsrcOffset     where each fork starts inside the decoded
 *                              stream (0 for an ungrouped file)
 *   grouped                    true when both forks come from packedOffset
 *   crc                        CRC-32 over data fork + resource fork
 *
 * Nothing is decompressed here; viseExtract does that on demand and caches
 * each decoded stream on the archive, so the nine files that share one
 * stream cost one inflate between them. */
function parseViseArchive(bytes) {
  if (!looksLikeVise(bytes)) throw new Error('not an Installer VISE archive: no SVCT signature');
  const version = u32be(bytes, 16);
  const versionName = VISE_VERSIONS[version];
  if (!versionName) throw new Error('unsupported Installer VISE archive version 0x' + version.toString(16));
  const extended = version === 0x80010307;
  const catalogOffset = u32be(bytes, 36);
  if (!catalogOffset || catalogOffset + VISE_CATALOG_HEADER_LEN > bytes.length)
    throw new Error('catalog offset 0x' + catalogOffset.toString(16) + ' is outside the archive' +
                    (catalogOffset ? '' : ' (a continuation segment of a multi-part installer, not the first part)'));
  if (fourcc(bytes, catalogOffset) !== VISE_CATALOG_MAGIC)
    throw new Error('no CVCT catalog at 0x' + catalogOffset.toString(16));
  const entryCount = u16be(bytes, catalogOffset + 16);
  let cursor = catalogOffset + VISE_CATALOG_HEADER_LEN;
  if (extended) {
    if (fourcc(bytes, cursor) !== 'PACK') throw new Error('extended catalog without its PACK prefix');
    cursor += VISE_EXTENDED_CATALOG_PREFIX_LEN;
  }
  const need = (n, what) => {
    if (cursor + n > bytes.length) throw new Error('catalog truncated in ' + what);
  };

  const dirs = [];
  const dirById = new Map();
  const entries = [];
  for (let index = 0; index < entryCount; index++) {
    need(4, 'entry ' + index);
    const magic = fourcc(bytes, cursor);
    cursor += 4;
    if (magic === 'DVCT') {
      need(VISE_DIRECTORY_RECORD_LEN, 'directory ' + index);
      const rec = cursor;
      const id = u32be(bytes, rec + 24);
      const parentId = u32be(bytes, rec + 28);
      const nameLen = bytes[rec + 76];
      cursor += VISE_DIRECTORY_RECORD_LEN;
      if (version === 0x80010300) cursor += 6;
      else if (extended) cursor += VISE_EXTENDED_DIRECTORY_SUFFIX_LEN;
      need(nameLen, 'directory name ' + index);
      const name = decodeMacRoman(bytes.subarray(cursor, cursor + nameLen));
      cursor += nameLen;
      const parent = dirById.get(parentId);
      const dir = { index, id, parentId, name, path: parent ? parent.path + '/' + name : name };
      dirs.push(dir);
      dirById.set(id, dir);
    } else if (magic === 'FVCT') {
      need(VISE_FILE_RECORD_LEN, 'file ' + index);
      const rec = cursor;
      const type = fourcc(bytes, rec + 40), creator = fourcc(bytes, rec + 44);
      const finderFlags = u16be(bytes, rec + 48);
      const created = u32be(bytes, rec + 56), modified = u32be(bytes, rec + 60);
      const grouped = extended && !!(bytes[rec + 8] & 0x10);
      const packedLen = u32be(bytes, rec + 64), dataLen = u32be(bytes, rec + 68);
      const rsrcPackedLenDeclared = u32be(bytes, rec + 72), rsrcLen = u32be(bytes, rec + 76);
      const crc = u32be(bytes, rec + 80);
      const dirId = u32be(bytes, rec + 84);
      const packedOffset = u32be(bytes, rec + 96);
      const dataOffset = grouped ? u32be(bytes, rec + 100) : 0;
      const rsrcOffset = grouped ? u32be(bytes, rec + 104) : 0;
      const nameLen = bytes[rec + 118];
      cursor += VISE_FILE_RECORD_LEN;
      if (extended) cursor += VISE_EXTENDED_FILE_SUFFIX_LEN;
      need(nameLen, 'file name ' + index);
      const name = decodeMacRoman(bytes.subarray(cursor, cursor + nameLen));
      cursor += nameLen;
      // A grouped file names an offset inside the shared stream for each
      // fork; an ungrouped file has its resource fork in a second stream
      // straight after the first.
      const rsrcPackedOffset = grouped || !rsrcLen ? 0 : packedOffset + packedLen;
      const rsrcPackedLen = grouped || !rsrcLen ? 0 : rsrcPackedLenDeclared;
      if (packedOffset + packedLen > bytes.length || rsrcPackedOffset + rsrcPackedLen > bytes.length)
        throw new Error('"' + name + '" points past the end of the archive');
      const dir = dirById.get(dirId);
      entries.push({
        index, name, dirId, type, creator, finderFlags, created, modified,
        path: dir ? dir.path + '/' + name : name,
        dataLen, rsrcLen, packedOffset, packedLen, rsrcPackedOffset, rsrcPackedLen,
        dataOffset, rsrcOffset, grouped, crc
      });
    } else {
      throw new Error('catalog entry ' + index + ' has signature "' + magic + '", not DVCT or FVCT');
    }
  }
  return { version, versionName, catalogOffset, bytes, dirs, entries, _streams: new Map() };
}

/* Undo the pair swap and the substitution, then inflate to `needed` bytes. */
function viseDecodeStream(packed, needed) {
  if (!needed) return new Uint8Array(0);
  if (!packed.length) throw new Error('an empty stream cannot yield ' + needed + ' bytes');
  const plain = new Uint8Array(packed.length);
  const n = packed.length & ~1;
  for (let i = 0; i < n; i += 2) {
    plain[i] = VISE_DEOBFUSCATION_TABLE[packed[i + 1]];
    plain[i + 1] = VISE_DEOBFUSCATION_TABLE[packed[i]];
  }
  if (packed.length & 1) plain[n] = VISE_DEOBFUSCATION_TABLE[packed[n]];
  let firstErr;
  for (const align of [8, 16]) {
    try { return inflateRaw(plain, needed, align); }
    catch (e) { if (!firstErr) firstErr = e; }
  }
  throw new Error('stream would not inflate: ' + firstErr.message);
}

/* The decoded bytes of the stream at `offset`, long enough to hold `needed`.
 * Cached per archive: a grouped stream is asked for by every file in it. The
 * cache keeps the longest decode asked for so far, so a later request for
 * more re-inflates rather than reading past the end. */
function viseStream(archive, offset, length, needed) {
  const have = archive._streams.get(offset);
  if (have && have.length >= needed) return have;
  const decoded = viseDecodeStream(archive.bytes.subarray(offset, offset + length), needed);
  archive._streams.set(offset, decoded);
  return decoded;
}

/* Both forks of one entry, as fresh Uint8Arrays, and whether the catalog's
 * CRC agrees with them. A mismatch is reported, not thrown: the caller
 * decides whether a file it can see is worth keeping. */
function viseExtract(archive, entry) {
  let data = new Uint8Array(0), rsrc = new Uint8Array(0);
  if (entry.dataLen) {
    const s = viseStream(archive, entry.packedOffset, entry.packedLen, entry.dataOffset + entry.dataLen);
    data = s.slice(entry.dataOffset, entry.dataOffset + entry.dataLen);
  }
  if (entry.rsrcLen) {
    const s = entry.grouped
      ? viseStream(archive, entry.packedOffset, entry.packedLen, entry.rsrcOffset + entry.rsrcLen)
      : viseStream(archive, entry.rsrcPackedOffset, entry.rsrcPackedLen, entry.rsrcLen);
    rsrc = s.slice(entry.rsrcOffset, entry.rsrcOffset + entry.rsrcLen);
  }
  let both = data;
  if (rsrc.length) { both = new Uint8Array(data.length + rsrc.length); both.set(data, 0); both.set(rsrc, data.length); }
  return { data, rsrc, crcOk: crc32(both) === entry.crc };
}

/* Is this file an installer? Accepts the SVCT fork bare, inside any
 * container mac-containers.js opens -- Bryce Schroeder's Cythera.bin is a
 * MacBinary of the installer application, type APPL creator VIS3 -- or
 * inside a StuffIt archive that stored it (mac-stuffit.js), which is how
 * archive.org and old.mac.gdn mirror it and how Ambrosia's own
 * Cythera_1.0.4_Installer.sit carries it. A StuffIt archive can hold
 * several: archive.org's "Cythera installers.sit" has 1.0.1 through 1.0.4
 * side by side. Returns
 *
 *   { container, archive, installers: [{ name, path, dataLen }], picked }
 *
 * for the installer chosen -- `pick`, by name, or else the newest by name
 * order (1.0.4 sorts after 1.0.3) -- and the list of every installer found,
 * so a page can offer the others. Null for a file that is not an installer
 * at all, a container included, so extractDelverArchive can go on to treat
 * it as the archive itself. Throws when the bytes claim to be an installer
 * and its catalog cannot be read, and when a StuffIt archive holds one the
 * page cannot take out. */
function sniffViseInstaller(bytes, pick) {
  if (!bytes || !bytes.length) return null;
  if (looksLikeVise(bytes)) {
    const archive = parseViseArchive(bytes);
    return { container: null, archive, installers: [{ name: '', path: '', dataLen: bytes.length }], picked: '' };
  }
  if (looksLikeStuffIt(bytes)) {
    const sit = parseStuffItArchive(bytes);
    const found = [];
    let refused = null;
    for (const e of sit.entries) {
      if (e.isFolder || e.type !== 'APPL' || e.dataLen < VISE_HEADER_LEN) continue;
      // Stored, and an SVCT: an installer. Compressed: remembered, and
      // reported if it turns out to be the only one.
      let data;
      try { data = stuffItFork(bytes, e, 'data'); }
      catch (err) { if (e.creator === 'VIS3' && !refused) refused = err; continue; }
      if (!looksLikeVise(data)) continue;
      found.push({ name: e.name, path: e.path, dataLen: e.dataLen, entry: e, data });
    }
    if (!found.length) {
      if (refused) throw new Error('That is a ' + sit.format + ' archive holding an installer, but ' + refused.message + '.');
      return null;
    }
    found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const chosen = found.find(f => f.name === pick) || found[found.length - 1];
    let rsrc = new Uint8Array(0);
    try { rsrc = stuffItFork(bytes, chosen.entry, 'rsrc'); } catch (err) { /* compressed, and not needed */ }
    const container = { kind: sit.format + ' archive', name: chosen.name, type: chosen.entry.type,
                        creator: chosen.entry.creator, data: chosen.data, rsrc };
    return { container, archive: parseViseArchive(chosen.data),
             installers: found.map(f => ({ name: f.name, path: f.path, dataLen: f.dataLen })), picked: chosen.name };
  }
  const c = sniffMacContainer(bytes);
  if (!c || !c.data || !looksLikeVise(c.data)) return null;
  return { container: c, archive: parseViseArchive(c.data),
           installers: [{ name: c.name, path: c.name, dataLen: c.data.length }], picked: c.name };
}
