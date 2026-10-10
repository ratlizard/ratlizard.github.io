/* mac-installshield.js -- the files inside an InstallShield 3 `data.z`, and
   the PKWARE Data Compression Library "implode" each one is packed with.
   =========================================================================

   WHY A WINDOWS INSTALLER, IN A TREE ABOUT CLASSIC MAC FILES. QuickTime's
   instruments. The music of a QTMA tune is played by QuickTime Musical
   Instruments, a sample set QuickTime shipped, and the one place on the
   internet a page can fetch that set from is archive.org's copy of the
   QuickTime 3 CD (item `apple-quicktime-3`). The CD is a hybrid: its Mac
   half is HFS, which archive.org cannot open, so the whole 15 MB image would
   have to come down; its PC half is ISO 9660, which archive.org opens and
   serves a file at a time through /cors/. The PC half holds one file,
   QUICKTIM.EXE, a self-extracting zip whose one entry, `data.z`, is this
   format, and one of its 21 files is `QuickTimeMusicalInstruments.qtx`: a
   few hundred bytes of Windows stub with the Mac resource fork after it
   (`qtxResourceFork` in js/mac-qtmusic.js). Its 235 instruments are byte for
   byte the QuickTime 4.0 Mac set's, so this is the Mac sound, reached by a
   Windows road.

   THE ARCHIVE, as read off QUICKTIM.EXE's own (no specification was used,
   and none is on the disk). Little-endian throughout.
     header, 255 bytes: u32 0x8C655D13 at 0; u16 file count at 0x0C;
       u32 directory table offset at 0x29; u16 directory count at 0x31;
       u32 file table offset at 0x33.
     directory entry: u16 file count, u16 entry length, u16 name length, name.
     file entry: u16 directory index at +1; u32 size at +3; u32 packed size
       at +7; u32 offset of the packed data at +11; u16 entry length at +23;
       u8 name length at +29, the name at +30.
   The reading was proved by the numbers agreeing with one another: each
   file's offset is the one before plus its packed size, the first is 255,
   and the instruments come out at the size the table gives and open as a
   resource fork whose instruments match the Mac copy.

   THE COMPRESSION is PKWARE's DCL implode ("blast", after Mark Adler's
   decoder in zlib's contrib/, which this follows in shape, written afresh
   from the format). Two header bytes: whether literals are Huffman coded,
   and the dictionary size as a count of low distance bits (4, 5 or 6). Then
   a bit stream, least significant bit first: a 0 is a literal, a 1 a match
   whose length and distance are Huffman coded with fixed tables. Every file
   in QuickTime 3's archive has uncoded literals, so the coded-literal table
   is not carried and a stream that asks for it is refused by name: a table
   typed from memory with nothing to hold it to would be a guess.

   Classic script; the page's global scope. */

/* The fixed Huffman tables of the length and distance codes, in DCL's
   compact form: each byte is (count - 1) << 4 | bit length, a run of that
   many symbols with that length. */
const DCL_LEN_REP  = [2, 35, 36, 53, 38, 23];
const DCL_DIST_REP = [2, 20, 53, 230, 247, 151, 248];
const DCL_LEN_BASE  = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const DCL_LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

function dclTable(rep) {
  const lengths = [];
  for (const b of rep) for (let k = (b >> 4) + 1; k > 0; k--) lengths.push(b & 15);
  const count = new Array(14).fill(0);
  for (const l of lengths) count[l]++;
  const offs = [0, 0];
  for (let l = 1; l < 13; l++) offs[l + 1] = offs[l] + count[l];
  const symbol = new Array(lengths.length);
  lengths.forEach((l, s) => { if (l) symbol[offs[l]++] = s; });
  return { count, symbol };
}
let DCL_TABLES = null;

/* Explode one DCL stream to `expected` bytes. */
function dclExplode(input, expected) {
  if (!DCL_TABLES) DCL_TABLES = { len: dclTable(DCL_LEN_REP), dist: dclTable(DCL_DIST_REP) };
  if (input.length < 2) throw new Error('too short for a DCL stream');
  const coded = input[0], dictBits = input[1];
  if (coded === 1) throw new Error('a DCL stream with coded literals, which this page does not read');
  if (coded !== 0) throw new Error('not a DCL stream (literal flag ' + coded + ')');
  if (dictBits < 4 || dictBits > 6) throw new Error('not a DCL stream (dictionary ' + dictBits + ')');
  const out = new Uint8Array(expected);
  let pos = 2, buf = 0, cnt = 0, o = 0;
  const bits = n => {
    while (cnt < n) {
      if (pos >= input.length) throw new Error('DCL stream ran out of input at byte ' + o + ' of ' + expected);
      buf |= input[pos++] << cnt; cnt += 8;
    }
    const v = buf & ((1 << n) - 1);
    buf >>>= n; cnt -= n;
    return v;
  };
  // DCL's codes are stored bit-inverted, hence the ^ 1.
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 13; len++) {
      code |= bits(1) ^ 1;
      const c = h.count[len];
      if (code - first < c) return h.symbol[index + code - first];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('a bad code in the DCL stream');
  };
  while (true) {
    if (bits(1)) {
      const sym = decode(DCL_TABLES.len);
      const len = DCL_LEN_BASE[sym] + bits(DCL_LEN_EXTRA[sym]);
      if (len === 519) break;                     // the end code
      const lowBits = len === 2 ? 2 : dictBits;
      const dist = (decode(DCL_TABLES.dist) << lowBits) + bits(lowBits) + 1;
      if (dist > o) throw new Error('a DCL match reaches before the start of the file');
      if (o + len > expected) throw new Error('DCL stream runs past the ' + expected + ' bytes it should make');
      for (let k = 0; k < len; k++, o++) out[o] = out[o - dist];
    } else {
      if (o >= expected) throw new Error('DCL stream runs past the ' + expected + ' bytes it should make');
      out[o++] = bits(8);
    }
  }
  if (o !== expected) throw new Error('DCL stream made ' + o + ' bytes where ' + expected + ' were expected');
  return out;
}

const IS3_SIGNATURE = 0x8C655D13;
const isU16 = (b, o) => b[o] | (b[o + 1] << 8);
const isU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function looksLikeInstallShield3(bytes) {
  return bytes && bytes.length >= 255 && isU32(bytes, 0) === IS3_SIGNATURE;
}

/* The archive's files, each { path, len, packedLen, offset }. */
function parseInstallShield3(bytes) {
  if (!looksLikeInstallShield3(bytes)) throw new Error('not an InstallShield 3 archive');
  const files = isU16(bytes, 0x0C);
  const dirOff = isU32(bytes, 0x29), dirs = isU16(bytes, 0x31), fileOff = isU32(bytes, 0x33);
  const dirNames = [];
  let p = dirOff;
  for (let i = 0; i < dirs; i++) {
    if (p + 6 > bytes.length) throw new Error('the directory table runs past the end of the archive');
    const n = isU16(bytes, p + 4);
    dirNames.push(decodeMacRoman(bytes.subarray(p + 6, p + 6 + n)).replace(/\\/g, '/'));
    p += isU16(bytes, p + 2);
  }
  const entries = [];
  p = fileOff;
  for (let i = 0; i < files; i++) {
    if (p + 30 > bytes.length) throw new Error('the file table runs past the end of the archive');
    const dir = dirNames[isU16(bytes, p + 1)] || '';
    const n = bytes[p + 29];
    const name = decodeMacRoman(bytes.subarray(p + 30, p + 30 + n));
    const e = { path: dir ? dir + '/' + name : name, len: isU32(bytes, p + 3),
                packedLen: isU32(bytes, p + 7), offset: isU32(bytes, p + 11) };
    if (e.offset + e.packedLen > bytes.length) throw new Error('"' + e.path + '" runs past the end of the archive');
    entries.push(e);
    const step = isU16(bytes, p + 23);
    if (!step) throw new Error('a file entry of length 0');
    p += step;
  }
  return { format: 'InstallShield 3', entries };
}

function installShield3File(bytes, entry) {
  return dclExplode(bytes.subarray(entry.offset, entry.offset + entry.packedLen), entry.len);
}
