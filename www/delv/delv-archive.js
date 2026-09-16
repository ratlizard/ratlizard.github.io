/* delv-archive.js -- the Cythera archive itself: its master index, its
 * resources, the encryption laid over them, and the record formats stored
 * inside.
 *
 * This file, delv-graphics.js and delv-script.js were the Delver-specific half
 * of index.html's inline script, which had reached 9,800 lines.
 * They came out because at that size the code that decodes a 1999 game and the
 * code that draws a web page had become indistinguishable, and because the two
 * delvmod cross-checks -- the only things here that can tell a wrong decoder
 * from a right one -- had nothing to point at but "the page".
 *
 * WHAT THIS IS NOT. It is not a library, and calling it one would mislead
 * whoever reads it next. `fileBytes` and `masterIndexGlobal` below are the
 * open archive, and getResourceBytes() reads them as ambient globals rather
 * than taking them as arguments; the tables memoised in here are still dropped
 * by resetDerivedCaches() over in the page. A classic script shares one global
 * scope with the document, so extracting these files changed none of that and
 * was not meant to. What it buys is that the domain code can be read on its
 * own and that a harness can name the file it is checking. Threading the
 * archive through as a parameter is a different and much larger job.
 *
 * CLASSIC SCRIPT, deliberately -- no `type="module"`, no import, no export.
 * A module is fetched with CORS, and a page opened from file:// has an opaque
 * origin, so a module would not load at all when the page is double-clicked
 * rather than served. utilities/page_scripts.mjs throws if it finds one.
 *
 * LOAD ORDER: after js/mac-bytes.js, whose u16be/u32be/decodeMacRoman this
 * uses, after js/mac-containers.js and js/mac-vise.js (extractDelverArchive
 * unwraps a container or an installer), and before delv-graphics.js and
 * delv-script.js.
 *
 * The encryption lists near the bottom are delvmod's, not this project's, and
 * utilities/delv_crosscheck.mjs re-reads them out of delvmod's Python on every
 * run. The comment above smartDecrypt says what guessing them cost.
 */

let fileBytes = null;
let masterIndexGlobal = null;
function parseDelverStringTable(p) {
  if (!p || p.length < 6) return null;
  const hdr = u16be(p, 0);
  if ((hdr & 0xF000) !== 0x9000) return null;
  const count = hdr & 0x0FFF;
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 2 + i * 4;
    if (e + 4 > p.length) break;
    const off = u16be(p, e+2);
    if (off >= p.length) { out.push(''); continue; }
    let end = off; while (end < p.length && p[end] !== 0) end++;
    out.push(decodeMacRoman(p.subarray(off, end)));
  }
  return out;
}
// A cursor over the archive. The readers themselves live in js/mac-bytes.js,
// so this only keeps the position: `pstring` decodes Mac Roman rather than
// Latin-1, which is what the archive's title actually is -- the two agree on
// ASCII and disagree on every accented character.
class BinReader {
  constructor(bytes) { this.data = bytes; this.pos = 0; }
  seek(p) { this.pos = p; }
  u8() { return this.data[this.pos++]; }
  u16() { const v = u16be(this.data, this.pos); this.pos += 2; return v; }
  u32() { const v = u32be(this.data, this.pos); this.pos += 4; return v; }
  pstring(off) { return pstring(this.data, off !== undefined ? off : this.pos); }
}

// Called tens of thousands of times while the cross-reference and script-text
// indexes are built, so it reads the two words directly rather than allocating
// a BinReader per call. It also validates the pair now: slice() clamps, so a
// corrupt length used to yield a short buffer that looked like a real (but
// truncated) resource instead of an error.
function getResourceBytes(resid) {
  const subn = Math.floor(resid / 0x100) - 1;
  const n = resid % 0x100;
  const mi = masterIndexGlobal && masterIndexGlobal[subn];
  if (!mi || !mi[0]) return null;
  const [subOff, subLen] = mi;
  if (n*8 + 8 > subLen) return null;
  const p = subOff + n*8;
  const roff = ((fileBytes[p]*0x1000000) + (fileBytes[p+1]<<16) + (fileBytes[p+2]<<8) + fileBytes[p+3]) >>> 0;
  const rlen = ((fileBytes[p+4]*0x1000000) + (fileBytes[p+5]<<16) + (fileBytes[p+6]<<8) + fileBytes[p+7]) >>> 0;
  if (!roff || roff + rlen > fileBytes.length) return null;
  return fileBytes.slice(roff, roff+rlen);
}

// How many entries a subindex actually declares. The builders below used to
// ask for all 256 ids in every populated subindex -- 8,704 lookups where 1,600
// exist -- because the count was never consulted.
function subindexCount(subn) {
  const mi = masterIndexGlobal && masterIndexGlobal[subn];
  return mi && mi[0] ? Math.min(256, Math.floor(mi[1] / 8)) : 0;
}

function parseCompositionWord(t) {
  const resid = 0x8E00 + ((t >> 4) & 0xFF);
  const tileInSheet = t & 0x0F;
  const segment = (t >> 12) & 0xF;
  return {resid, tileInSheet, segment};
}

// BinHex 4.0, MacBinary and AppleSingle/AppleDouble are decoded by
// js/mac-containers.js. The retired resource fork browser page loaded it as
// well: both pages had their own copy, and each had fixed a bug the other still had.

// Where the master index is, and how long it is, per delvmod's
// archive.load_header/load_index: an (offset,length) pair at 0x80, and the
// index entries start 8 bytes into it -- the first pair describes the index
// itself. Cythera Data says 0x80/0x800, so the entries run 0x88..0x87F and
// there are length/8 - 1 = 255 of them.
//
// This used to be hardcoded as "256 pairs at 0x88", which invented a subindex
// 255: that entry sits at 0x880, one slot PAST the end of the index, so the
// reader was taking the first subindex's own data as an index entry and
// getting off=0xA07F5000 len=0xFFFF0000. It was bounds-checked away rather
// than explained. There is no subindex 255 -- those bytes were never anything
// but what follows the index.
function delverMasterIndexExtent(bytes) {
  if (!bytes || bytes.length < 0x88) return null;
  const off = u32be(bytes, 0x80), len = u32be(bytes, 0x84);
  // 16 bytes is the smallest index that could hold one entry after its own
  // self-describing pair, and the whole thing has to be inside the file.
  if (off < 0x80 || len < 16 || len % 8 !== 0 || off + len > bytes.length) return null;
  // Nothing past the index can be a subindex, so this is also the floor every
  // entry's offset has to clear.
  return { off, len, first: off + 8, count: Math.min(256, len / 8 - 1), dataStart: off + len };
}

// Does this buffer actually hold a Delver archive? The answer is read from
// the structure the archive is built out of, and from nothing else: a title,
// a master index whose every entry is either empty or a whole number of
// 8-byte records inside the file, and inside every subindex it names, resource
// entries that are likewise either empty or inside the file. That is the
// shape delvmod's load_header/load_index walks, and it is what tells a data
// fork from a resource fork, from BinHex ASCII, from an unrelated file.
//
// It used to demand eight populated subindexes as well, which was a count
// standing in for a check. The shipped Cythera Data has 34, so eight looked
// safe; a Cythera SAVED GAME has six (the party's records, its combat-AI
// scripts, the prop list of the zone the player stands in, one portrait, and
// two subindexes the scenario never has), and a patch file -- Magpie's Pumpkin Patch, twelve
// tile sheets -- has two. Every one of them was refused, so the page could
// not open a player file at all: utilities/addons_check.mjs opens all seven
// third-party archives in the community's add-ons, and all seven were on its
// refused list. The rule above accepts all seven and the shipped archive, and refuses
// every other file in the same corpus: the application's PEF data fork, both
// resource forks, the BinHex texts, the installers, JPEGs, an .rtf, a TEXT
// file. What made the eight seem necessary was that the entries were only
// COUNTED: a stray value that happened to pass was tolerated, so the count
// had to be high enough that stray values could not reach it. Requiring that
// no entry be stray is the stronger test and needs no threshold.
//
// The player name is the pstring at 0x20 -- delvmod's `player_name`, empty in
// the scenario file -- so a caller can say what it opened.
function describeDelverArchive(bytes) {
  if (!bytes || bytes.length < 0x888)
    return { ok: false, reason: 'only ' + (bytes ? bytes.length : 0) + ' bytes, too small to hold a master index' };
  // Byte 0 is the length of the archive's title, which is the first thing in
  // the file. Checking it matters more than it looks: without it a MacBinary
  // or AppleSingle file WRAPPING a real archive passes, because the wrapper
  // pushes everything 128 (or 38) bytes along and enough of the shifted
  // garbage at 0x88 still reads as plausible offsets.
  const tlen = bytes[0];
  let title = '';
  if (tlen >= 1 && tlen <= 63) {
    let printable = true;
    for (let i = 1; i <= tlen; i++) if (bytes[i] < 0x20 || bytes[i] === 0x7F) { printable = false; break; }
    if (printable) title = decodeMacRoman(bytes.subarray(1, 1 + tlen));
  }
  if (!title) return { ok: false, title: '', reason: 'no title string at byte 0' };
  const mi = delverMasterIndexExtent(bytes);
  if (!mi) return { ok: false, title, reason: 'no usable master index (offset,length) pair at 0x80' };
  const player = (bytes[0x20] >= 1 && bytes[0x20] <= 31) ? pstring(bytes, 0x20) : '';
  let populated = 0;
  for (let i = 0; i < mi.count; i++) {
    const off = u32be(bytes, mi.first + i*8), len = u32be(bytes, mi.first + i*8 + 4);
    if (!off && !len) continue;
    if (!(off >= mi.dataStart && len > 0 && len % 8 === 0 && off + len <= bytes.length))
      return { ok: false, title, player, populated, reason: 'master index entry ' + i + ' at 0x' +
        (mi.first + i*8).toString(16).toUpperCase() + ' is neither empty nor a subindex inside the file' };
    // Every entry of the subindex, too: a resource is (offset,length) and
    // both lie past the index and inside the file, or the entry is empty.
    const n = Math.min(256, len / 8);
    for (let k = 0; k < n; k++) {
      const roff = u32be(bytes, off + k*8), rlen = u32be(bytes, off + k*8 + 4);
      if (!roff && !rlen) continue;
      if (roff < mi.dataStart || roff + rlen > bytes.length)
        return { ok: false, title, player, populated, reason: 'subindex ' + i + ' entry ' + k +
          ' points outside the file' };
    }
    populated++;
  }
  if (!populated)
    return { ok: false, title, player, populated, reason: 'the master index at 0x' + mi.first.toString(16).toUpperCase() +
      ' names no subindex at all' };
  return { ok: true, title, player, populated };
}

function extractDelverArchive(bytes, opts) {
  opts = opts || {};
  const notes = [];
  const direct = describeDelverArchive(bytes);
  if (direct.ok) return { bytes, via: 'data fork', info: direct };
  notes.push('read as-is, ' + direct.reason);

  // The whole game at once: Cythera's installer is an Installer VISE
  // archive (js/mac-vise.js) holding the archive, the application, the
  // Combat AI scripts and the documentation, each with both forks. The
  // archive is the one file of type 'DelS' in it. What comes back carries
  // the installer too, so the page can keep the other files.
  const installer = sniffViseInstaller(bytes, opts.pick);
  if (installer) {
    const arc = installer.archive;
    const entry = arc.entries.find(e => e.type === 'DelS');
    if (!entry) throw new Error('That is an ' + arc.versionName + ' installer' +
      (installer.container && installer.container.name ? ' ("' + installer.container.name + '")' : '') +
      ' with ' + arc.entries.length + ' files and no Delver archive among them.');
    const got = viseExtract(arc, entry);
    const d = describeDelverArchive(got.data);
    if (!d.ok) throw new Error('"' + entry.name + '" inside the installer is not a Delver archive: ' + d.reason);
    const label = arc.versionName + ' installer' +
      (installer.container && installer.container.name ? ' "' + installer.container.name + '"' : '') +
      (installer.container ? ' in ' + installer.container.kind : '');
    return { bytes: got.data, via: label, info: d,
             forks: { kind: label, name: entry.name, type: entry.type, creator: entry.creator,
                      data: got.data, rsrc: got.rsrc },
             installer: { archive: arc, container: installer.container, entry, crcOk: got.crcOk,
                          installers: installer.installers, picked: installer.picked } };
  }

  /* A StuffIt archive with a Delver archive inside it, which is how every
     community add-on is actually distributed. This runs AFTER the installer
     sniff on purpose: `sniffViseInstaller` also looks inside StuffIt, and an
     installer stored in one must keep going down the installer path, which
     knows about CRCs and about picking between several installers.

     Since method 13 became readable this is no longer a rare case -- the one
     Magpie patch that exists is a method-13 fork inside
     `614_MagpiePumpkinPatch.sit.hqx`, and before this the page could list
     that archive and not open what was in it.

     The first entry whose data fork reads as a Delver archive wins, and a
     fork that will not decompress is stepped over rather than thrown on, so
     one Arsenic-compressed file in an archive does not hide a readable one
     beside it. What comes back names the entry, because a .sit usually holds
     several files and "which one did it open" is the first question. */
  const fromStuffIt = (buf, wrapper) => {
    if (typeof looksLikeStuffIt !== 'function' || !looksLikeStuffIt(buf)) return null;
    let arc = null;
    try { arc = parseStuffItArchive(buf); } catch (e) { return null; }
    const where = arc.format + ' archive' + (wrapper ? ' in ' + wrapper : '');
    const refused = [];
    for (const e of arc.entries) {
      if (e.isFolder || !e.dataLen) continue;
      let data;
      try { data = stuffItFork(buf, e, 'data'); }
      catch (err) { refused.push(e.name + ' (' + err.message.replace(/^"[^"]*" data fork /, '') + ')'); continue; }
      const d = describeDelverArchive(data);
      if (!d.ok) { notes.push('"' + e.name + '" in the ' + where + ', ' + d.reason); continue; }
      let rsrc = null;
      try { rsrc = stuffItFork(buf, e, 'rsrc'); } catch (err) { rsrc = null; }
      return { bytes: data, via: where, info: d,
               forks: { kind: where, name: e.name, type: e.type, creator: e.creator, data, rsrc } };
    }
    if (refused.length) notes.push('in the ' + where + ', could not decompress ' + refused.join(', '));
    return null;
  };
  const bare = fromStuffIt(bytes, '');
  if (bare) return bare;

  // sniffMacContainer knows the order these have to be tried in, and why.
  const forks = sniffMacContainer(bytes);
  const kind = forks ? forks.kind : '';

  if (forks) {
    for (const which of ['data', 'rsrc']) {
      const buf = forks[which];
      if (!buf || !buf.length) continue;
      const d = describeDelverArchive(buf);
      if (d.ok) return { bytes: buf, via: kind + ' ' + (which === 'data' ? 'data fork' : 'resource fork'), info: d, forks };
      notes.push(kind + ' ' + which + ' fork, ' + d.reason);
    }
    /* A StuffIt archive inside the wrapper, which is what a community add-on
       downloaded as a .hqx actually is: BinHex around a .sit around the file.
       Tried after the forks themselves, so a wrapper holding the archive
       outright still takes the shorter path. */
    for (const which of ['data', 'rsrc']) {
      const buf = forks[which];
      if (!buf || !buf.length) continue;
      const inner = fromStuffIt(buf, kind);
      if (inner) { inner.forks.outer = forks; return inner; }
    }
    const t = (forks.type || '').trim(), c = (forks.creator || '').trim();
    throw new Error('That is a ' + kind + ' file' + (forks.name ? ' holding "' + forks.name + '"' : '') +
      (t ? " (type '" + t + "', creator '" + c + "')" : '') +
      (t === 'APPL' ? ' — the Cythera application, not its data.' : '.') +
      " The archives this tool reads are “Cythera Data” (type 'DelS', creator 'Delv') and a Cythera saved game (type 'DelP'). [" + notes.join('; ') + ']');
  }
  throw new Error('Not a Delver archive: ' + notes.join('; ') +
    '. Expected "Cythera Data" itself, a .hqx / MacBinary / AppleSingle wrapper around it, ' +
    'or the Cythera installer (.sit or Cythera.bin).');
}

function bitsOfSingle(data, size, index) {
  let result = 0;
  for (let i=0; i<size; i++) {
    const bitPos = index + i; const byteI = bitPos >> 3; const bitI = bitPos & 7;
    const byte = byteI < data.length ? data[byteI] : 0;
    const bit = (byte >> (7-bitI)) & 1;
    result = (result << 1) | bit;
  }
  return result >>> 0;
}

function ncbitsOf(data, fields) {
  let result = 0;
  for (const [size, index] of fields) { result = (result * Math.pow(2,size)) + bitsOfSingle(data, size, index); }
  return result;
}

// BUGFIX: Calculated the accurate final required byte bound rather than estimating blindly to avoid 
// an out-of-bounds byte index error grabbing extra garbage payload bits.
function bitsOf(data, size, index) {
  if (size === 0) return 0;
  const byteIndex0 = Math.floor(index/8);
  const bitIndex = index % 8;
  const lastByteNeeded = Math.floor((index + size - 1) / 8);
  const bitSize = size % 8;
  let byteIndex = byteIndex0;
  let truncated = false;
  let result = (data[byteIndex] !== undefined ? data[byteIndex] : 0) & (0xFF >> bitIndex);
  while (byteIndex < lastByteNeeded) {
    byteIndex += 1;
    if (data.length === byteIndex) { result <<= 8; truncated = true; break; }
    result = (result << 8) | (data[byteIndex] !== undefined ? data[byteIndex] : 0);
  }
  // When the requested range runs off the end of the buffer we shifted in a
  // padding byte above and must shift it back out, matching the reference
  // implementation. Without this the value comes back 256x too large.
  result >>= truncated ? 8 : (8 - ((index + size) % 8)) % 8;
  return result;
}

// --- Structured "Delver atom Array" parser -------------------------------
// Ported from delv/script.py (Array.demarshal / read_atom). Character
// Names (0x0201), Sign/Scroll/Quest/Book/Bookshelf Text, Ring and
// Gravestone Inscriptions all share this exact format: a 2-byte header
// (top nibble = typecode, must be 9; low 12 bits = entry count) followed
// by N 4-byte reference records. Each record's high bit marks it as a
// "dref": byte0 (minus 0x80, high byte of a resid) + byte1 (low byte of
// resid) + bytes 2-3 (uint16 offset). For this resource family the
// encoded resid is bogus/self-referential (see CharacterNameArray's
// override_dref) -- the string data lives at `offset` within this SAME
// resource's bytes, not in the referenced resid. We just read offset and
// grab the NUL-terminated MacRoman string living there.
const DELVER_TEXT_ARRAY_RESIDS = new Set([
  0x0201, 0x0218, 0x0219, 0x021A, 0x021B, 0x021D, 0x021F, 0x0220
]);
function parseDelverTextArray(data) {
  if (data.length < 2) return null;
  const header = u16be(data, 0);
  const typecode = (header >> 12) & 0xF;
  const count = header & 0x0FFF;
  if (typecode !== 9) return null; // not an Array-type resource
  const entries = [];
  let p = 2;
  for (let n = 0; n < count && p + 4 <= data.length; n++) {
    const b0 = data[p];
    // Per the wiki's Word page every atom is a 4-byte word, so a non-dref
    // atom advances by 4 like any other. Skipping 1 byte desynced the rest
    // of the array behind it.
    if (b0 < 0x80) { p += 4; continue; } // inline atom, not a dref (rare)
    const off = u16be(data, p+2);
    p += 4;
    if (off >= data.length) { entries.push({ index: n, offset: off, str: '(offset out of range)' }); continue; }
    let end = off;
    while (end < data.length && data[end] !== 0) end++;
    const str = decodeMacRoman(data.slice(off, end));
    entries.push({ index: n, offset: off, str });
  }
  return entries;
}

// --- Map (subindex 127 / 0x80xx) structured header parser -----------------
// Ported from delv/level.py Map.load_from_bfile(). The layout below matches
// the wiki's Cythera Map page field for field -- including the four cardinal
// exit ports, which that page does document by name and in order (North,
// East, South, West; uint16 each) at exactly these offsets. This parser
// agrees with the wiki here rather than adding anything to it.
function parseDelverMap(data) {
  if (data.length < 32) return null;
  const width = u16be(data, 0), height = u16be(data, 2), unknown = u16be(data, 4);
  const roofLayerSize = u16be(data, 6), roofUnderlayerSize = u16be(data, 8);
  const hEdge = data[10], vEdge = data[11];
  const exitN = u16be(data, 12), exitE = u16be(data, 14), exitS = u16be(data, 16), exitW = u16be(data, 18);
  // Sanity bounds -- reject anything that isn't a plausible Map header.
  // The format's own ceiling is 4096x4096 (prop coordinates are 12-bit), per
  // the wiki, so that is the limit enforced here. Cythera's own maps are far
  // smaller -- the largest is 64x64 -- but a hand-edited or fan-made archive
  // is entitled to the full range, and the old 320-per-axis guard would have
  // rejected it outright while the comment claimed 1024. A total-tile cap
  // still applies so a bad decrypt guess cannot trigger a runaway allocation.
  if (width === 0 || height === 0 || width > 4096 || height > 4096) return null;
  if (width * height > 4194304) return null;
  // 12 bytes padding at offset 20-31, then roof data, then map_data
  const roofWords = 0x20*(roofLayerSize + roofUnderlayerSize);
  const roofStart = 32;
  const mapStart = roofStart + roofWords*2;
  const mapEnd = mapStart + width*height*2;
  // The header must actually be followed by enough bytes to hold the
  // declared map_data grid -- otherwise this almost certainly is not a
  // real Map resource (e.g. wrong subindex, or auto-decrypt guessed wrong).
  if (mapStart < 0 || mapEnd > data.length + 4) return null;
  return {
    width, height, unknown, roofLayerSize, roofUnderlayerSize,
    horizontalEdgePropagation: hEdge, verticalEdgePropagation: vEdge,
    exitZoneportNorth: exitN, exitZoneportEast: exitE,
    exitZoneportSouth: exitS, exitZoneportWest: exitW,
    roofDataOffset: roofStart, mapDataOffset: mapStart,
    mapDataLength: width*height
  };
}

// --- PropList (subindex 128 / 0x81xx) 16-byte record parser --------------
// Ported from delv/level.py PropList.load_from_bfile(), with one correction.
//
// delvmod names the uint16 at +8/+9 `propref` and the uint32 at +10..13
// `storeref`. That is backwards. The wiki's subindex 128 page has StoreRef as
// the 2 bytes at +8/+9, and it has evidence: those 2 bytes match the symbol
// keys in 0xF015 exactly. Checked against this archive -- in prop list 0x8102
// (Odemia) the water trough at (47,44) has 00 07 at +8/+9 and F015 contains
// {0x0007, "Od_Trough1"}; the blacksmith's bellows at (45,46) has 00 06 and
// F015 has {0x0006, "Od_Bellows1"}. Reading a uint32 at +10 straddled the
// boundary and picked up nothing meaningful.
//
// The wiki's field table also lists an "Other Prop reference, uint32?" which
// would occupy +8..+11 and therefore overlap StoreRef. It is zero in every
// record in the scenario file -- prop-to-prop references are made at runtime
// -- so there is nothing here to tell the two readings apart. Both are
// reported below, with the 6 bytes after StoreRef kept as raw tail.
function parseDelverPropList(data) {
  const records = [];
  const recSize = 16;
  for (let p = 0; p + recSize <= data.length; p += recSize) {
    const flags = data[p];
    // read_xy24: 3 bytes packing 12-bit x, 12-bit y
    const raw = (data[p+1] << 16) | u16be(data, p+2);
    const x = raw >> 12, y = raw & 0x0FFF;
    // ...except when the prop is not on the floor at all. delvmod's level.py
    // (textual_location / inside_something) and the wiki's subindex 128 page
    // agree that the location word doubles as a containment link: flags & 0x10
    // means a character is holding it and the low 16 bits are that character's
    // number, flags & 0x08 means it is inside another prop in this same list at
    // index (low16 - 0x100), and both bits together mean the character has it
    // equipped. This viewer read those bytes as x,y unconditionally, so every
    // contained prop in the shipped archive was being placed at coordinates
    // that mean nothing: 985 of the 14,485 records -- 866 inside another prop,
    // 119 carried by a character, 32 of those equipped -- plus 5 deleted
    // records, which carry the same bits and are excluded here. 0x01 is
    // "okay to take".
    const carried = !!(flags & 0x10), inside = !!(flags & 0x08);
    const holder = raw & 0xFFFF;
    const aw = u16be(data, p+4);
    const aspectRot = (aw >> 10) & 0x3F, proptype = aw & 0x03FF;
    const d3 = u16be(data, p+6);
    const storeref = u16be(data, p+8);
    const otherprop = u32be(data, p+8);
    const u = u16be(data, p+14);
    let tail = '';
    for (let k = p+10; k < p+16; k++) tail += data[k].toString(16).padStart(2,'0');
    records.push({
      index: records.length, flags, x, y, aspect: aspectRot & 0x1F,
      rotated: aspectRot & 0x20, proptype, d1: d3 >> 8, d2: d3 & 0xFF,
      d3, storeref, otherprop, tail, u,
      onMap: !carried && !inside && flags !== 0xFF,
      carriedBy: carried ? holder : null,
      container: (!carried && inside) ? holder - 0x100 : null,
      equipped: carried && inside,
      takeable: !!(flags & 0x01)
    });
  }
  return records;
}

// --- Schedule List (resource 0xF00B) parser -------------------------------
// Ported from delv/schedule.py ScheduleList. 0x100 uint16 lengths, one per
// possible character, followed by that many EIGHT-byte entries each, packed
// in order. Eight is what the wiki's Schedules page says and what the loop
// below has always read -- the old "7-byte" comment was the thing that was
// wrong, not the code.
//   hour u8 | flags u8 (ends up as character field 0x15) | script u16
//   | level u8 | position xy24
function parseDelverScheduleList(data) {
  if (data.length < 512) return null;
  const lengths = [];
  for (let i = 0; i < 256; i++) lengths.push(u16be(data, i*2));
  let p = 512;
  const schedules = [];
  for (let ci = 0; ci < 256; ci++) {
    const len = lengths[ci];
    const entries = [];
    for (let n = 0; n < len && p + 8 <= data.length; n++) {
      const hour = data[p], mode = data[p+1];
      const scripting = u16be(data, p+2);
      const level = data[p+4];
      // read_xy24: 3 bytes packing 12-bit x, 12-bit y
      const raw = (data[p+5] << 16) | u16be(data, p+6);
      const x = raw >> 12, y = raw & 0x0FFF;
      p += 8;
      entries.push({ hour, mode, scripting, level, x, y });
    }
    if (len) schedules.push({ character: ci, entries });
  }
  return schedules;
}

function decryptResource(data, resid) {
  // Delver Archive resource cipher, taken verbatim from the reference
  // delv.archive.decrypt() implementation. The resource's own ID is used
  // as the "prokey" seed for a rolling multiplicative PRNG whose low byte
  // is XORed against each byte of ciphertext.
  const out = new Uint8Array(data.length);
  let key = (resid ^ (resid >> 8)) & 0xFFFF;
  const m = ((resid & 0x3F) << 2) + 1;
  const b = resid >> 6;
  for (let i = 0; i < data.length; i++) {
    key = (key * m + b) & 0xFFFF;
    out[i] = data[i] ^ (key & 0xFF);
  }
  return out;
}

function printableRatio(data) {
  if (!data.length) return 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b >= 32 && b <= 126) count++;
  }
  return count / data.length;
}

function byteEntropy(data) {
  if (!data.length) return 0;
  const counts = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) counts[data[i]]++;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / data.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// Subindices holding pure binary structured data. These are NEVER encrypted,
// and running the speculative decryptor on them corrupts the bytes -- which
// previously made 36 of 42 Map headers unparseable and pushed prop
// coordinates far outside the map bounds (so props silently drew off-canvas).
/* Which subindexes are encrypted is not something to guess at.
 *
 * The archive format does not flag it, so this file used to decrypt every
 * resource speculatively and keep whichever version looked more like
 * plaintext. That heuristic had already grown three escalating special cases
 * (all-zero payloads, a container-structure test, a named-script test), each
 * one added after it got a specific resource wrong -- which is what it looks
 * like when a guess is standing in for knowledge.
 *
 * delvmod states it outright. From its Scenario class, in
 * sources/github_delvmod/code/delv/archive.py:
 *
 *   known_encrypted = [1,2,4,7,8,9,10,11,12,13,14,15,16,19,20,23,24,25,26,27,29,47]
 *   known_clear     = [0,3,127,128,131,135,137,141,142,143,144,187,239,254]
 *   single_known    = {0x0210: False}
 *
 * Checked against the whole archive, the heuristic disagreed with that table
 * on 18 of 1,558 resources, always by leaving an encrypted resource
 * undecrypted. 0x1415 is the clearest of them: its decrypted form contains
 * "Sewers" and readable structure, its stored form is noise, and the scores
 * were 0.238 raw against 0.223 decrypted -- a coin flip, lost.
 *
 * The heuristic below is still here, and still needed: it now runs only for
 * subindexes the table has no opinion about, which is exactly what a modded
 * archive with new subindexes would be.
 *
 * utilities/delv_crosscheck.mjs re-reads these three lists out of the Python
 * and fails if the copies here drift from them. */
const DELV_ENCRYPTED_SUBN = new Set([1,2,4,7,8,9,10,11,12,13,14,15,16,19,20,23,24,25,26,27,29,47]);
const DELV_CLEAR_SUBN = new Set([0,3,127,128,131,135,137,141,142,143,144,187,239,254]);
const DELV_CLEAR_RESID = new Set([0x0210]);
/* The two subindexes only a PLAYER FILE has, and they are kept apart from the
   three tables above on purpose: those are delvmod's, compared against
   delvmod's own source by `delv_crosscheck.mjs`, and adding to them would
   turn the oracle into a mirror. This one is ours, and it is read out of the
   executable rather than guessed.

   Every segment the engine writes into a player file goes through
   `TCachedSegFiles::SaveSegment` / `TSegFile::SaveSegment`, which do not
   encrypt: `SaveLevelProps` writes 0x81zz, 0x82zz and 0xF306, `SaveGlobals`
   writes 0xF009 and 0xF00E, `THeap::Save` writes 0xF307 and 0xF308,
   `TToDo::SaveToDo` 0x0401, `TStatusWindow::SaveMacros` 0x0404,
   `CreatePlayer` 0x8800 and `TDelverApp::SaveToFile` 0x0400. The one routine
   that encrypts, `SaveEncryptedSegment`, has exactly one caller —
   `TInterp::DoInterpAt`, the script interpreter writing a script resource
   back — so in a player file the script subindexes are encrypted and nothing
   else is. 129 (0x82zz, the map memory) and 242 (0xF3zz, the script heap)
   never occur in a scenario, so naming them clear here costs the scenario
   nothing.

   It mattered: both are zero-filled early in a game, the heuristic below
   scores zeros worse than the noise they would decrypt to, and a saved game's
   map memory and heap were being served as garbage. */
const DELV_PLAYER_CLEAR_SUBN = new Set([129, 242]);

function smartDecrypt(data, resid) {
  const subn = Math.floor(resid / 0x100) - 1;
  if (DELV_CLEAR_RESID.has(resid) || DELV_CLEAR_SUBN.has(subn) || DELV_PLAYER_CLEAR_SUBN.has(subn)) {
    return { data: data, wasDecrypted: false, rawScore: 0, decScore: 0, exempt: true, known: true };
  }
  if (DELV_ENCRYPTED_SUBN.has(subn)) {
    return { data: decryptResource(data, resid), wasDecrypted: true, rawScore: 0, decScore: 0, known: true };
  }
  // Beyond here the archive is telling us nothing and neither is delvmod, so
  // decrypt speculatively and keep whichever version looks more like
  // plaintext: higher printable-ASCII ratio, lower entropy.
  const decrypted = decryptResource(data, resid);
  // A resource that decrypts to nothing but zero bytes is an empty
  // placeholder, and that is a certainty, not a guess -- the odds of the
  // keystream matching arbitrary ciphertext across every byte are nil.
  // The scoring heuristic cannot see this: all-zeros has no printable
  // characters at all, so ciphertext noise beats it and 0x033F, 0x0500 and
  // 0x0540 were all being shown as raw garbage.
  let allZero = decrypted.length > 0;
  for (let i = 0; i < decrypted.length; i++) if (decrypted[i] !== 0) { allZero = false; break; }
  let rawZero = data.length > 0;
  for (let i = 0; i < data.length; i++) if (data[i] !== 0) { rawZero = false; break; }
  if (allZero && !rawZero) return { data: decrypted, wasDecrypted: true, rawScore: 0, decScore: 0, allZero: true };
  /* And the same certainty the other way round, which was missing until
     7 September 2026. A resource that is ALREADY nothing but zero bytes
     cannot be ciphertext: the keystream is never all zeros, so no plaintext
     encrypts to this. The scoring heuristic cannot see that either -- zeros
     have no printable characters, so the noise it would decrypt to wins --
     and a saved game is where it showed: three of a player file's own
     subindexes (0x82zz map memory, 0xF307 and 0xF308, the script heap) are
     zero-filled in an early save and were all being served as garbage. */
  if (rawZero) return { data: data, wasDecrypted: false, rawScore: 0, decScore: 0, allZero: true };
  const rawScore = printableRatio(data) - byteEntropy(data) / 32;
  const decScore = printableRatio(decrypted) - byteEntropy(decrypted) / 32;
  // Byte statistics alone get it wrong for small script resources: 0x1050 and
  // 0x1914 happen to begin with 0x81 in their encrypted form, which reads as a
  // function header and wins on printable ratio. Now that the container format
  // is understood, ask which candidate actually parses -- structure beats
  // statistics whenever exactly one of the two is well formed.
  if (typeof dvmPlausibleContainer === 'function') {
    // Subindex 3's named scripts are plaintext but look like nothing to the
    // container test, and their bytecode has few printable bytes, so the score
    // heuristic was "decrypting" all fourteen into noise. A leading Pascal
    // name is decisive structure -- keystream output does not spell "Defend".
    const rawNamed = (typeof dvmNamedScript === 'function') && dvmNamedScript(data);
    const decNamed = (typeof dvmNamedScript === 'function') && dvmNamedScript(decrypted);
    if (rawNamed && !decNamed) return { data: data, wasDecrypted: false, rawScore: 0, decScore: 0, byStructure: true };
    if (decNamed && !rawNamed) return { data: decrypted, wasDecrypted: true, rawScore: 0, decScore: 0, byStructure: true };
    const rawOk = dvmPlausibleContainer(data, resid);
    const decOk = dvmPlausibleContainer(decrypted, resid);
    if (decOk && !rawOk) return { data: decrypted, wasDecrypted: true, rawScore, decScore, byStructure: true };
    if (rawOk && !decOk) return { data: data, wasDecrypted: false, rawScore, decScore, byStructure: true };
  }
  if (decScore > rawScore) {
    return { data: decrypted, wasDecrypted: true, rawScore, decScore };
  }
  return { data: data, wasDecrypted: false, rawScore, decScore };
}

function extractPascalStrings(data) {
  // Classic Pascal-style strings: a single length-prefix byte followed by
  // that many printable bytes. The cap here used to be 63, which silently
  // chopped Cythera's dialogue -- many lines run well past 100 characters
  // (one is 160). A Pascal length byte allows up to 255.
  let entries = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i];
    if (len > 2 && len <= 255 && i + 1 + len <= data.length) {
      let isPrintable = true;
      let str = '';
      for (let j = 0; j < len; j++) {
        const code = data[i + 1 + j];
        if (code >= 32 && code <= 126) {
          str += String.fromCharCode(code);
        } else if (code === 13 || code === 10) {
          str += '\n';
        } else {
          isPrintable = false;
          break;
        }
      }
      // A real Pascal string ends where it ends. If the byte straight after
      // the run is still printable text, the "length" was almost certainly a
      // letter from a C string and this reading cuts a word in half -- which
      // is exactly how "a glowing triangle" became "a glowing tria".
      const after = i + 1 + len;
      const runsOn = after < data.length && data[after] >= 32 && data[after] <= 126;
      if (isPrintable && !runsOn) {
        entries.push({ offset: i, str, kind: 'pascal' });
        i += len + 1;
        continue;
      }
    }
    i++;
  }
  return entries;
}

function extractCStrings(data, minLen = 3) {
  // Many Cythera text/script resources actually use plain NUL-terminated
  // C-style strings rather than Pascal strings. Scan for runs of printable
  // ASCII bytes bounded by 0x00 bytes (or the ends of the buffer).
  let entries = [];
  let cur = '';
  let start = 0;
  let ok = true;
  for (let i = 0; i <= data.length; i++) {
    const b = i < data.length ? data[i] : 0;
    if (b === 0) {
      if (ok && cur.length >= minLen) {
        entries.push({ offset: start, str: cur, kind: 'cstr' });
      }
      cur = '';
      start = i + 1;
      ok = true;
    } else if (b >= 32 && b <= 126) {
      cur += String.fromCharCode(b);
    } else {
      ok = false;
    }
  }
  return entries;
}

function extractReadableStrings(data, resid) {
  // If the resource is a Delver container, its own structure says where the
  // strings are, and that beats any scan. The byte-level scans below are the
  // fallback for data that is not a container at all.
  if (resid !== undefined) {
    const owned = dvmStringObjects(data, resid);
    if (owned.length) {
      return owned.map(e =>
        '0x' + e.offset.toString(16).padStart(4, '0') + '  ' + JSON.stringify(e.str)
      ).join('\n\n');
    }
  }
  const pascal = extractPascalStrings(data);
  const cstrs = extractCStrings(data);
  const all = pascal.concat(cstrs).sort((a, b) => a.offset - b.offset);
  if (!all.length) return null;
  return all.map(e =>
    '0x' + e.offset.toString(16).padStart(4, '0') + '  [' + e.kind + ']  "' + e.str + '"'
  ).join('\n');
}

function hexDump(data) {
  let out = '';
  const limit = Math.min(data.length, 2048);
  for (let i = 0; i < limit; i += 16) {
    let hex = i.toString(16).padStart(4, '0') + '  ';
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (i + j < data.length) {
        const b = data[i + j];
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
      } else {
        hex += '   ';
      }
    }
    out += hex + ' |' + ascii + '|\n';
  }
  if (data.length > limit) out += '... (truncated, ' + data.length + ' bytes total)\n';
  return out;
}

/* ---- Writing ----------------------------------------------------------- */
/* Everything above reads an archive; from here down is the other direction.
 *
 * writeDelverArchive() mirrors delvmod's Archive.to_file() operation for
 * operation, deliberately: header pstrings at 0 and 0x20, the three unknown
 * bytes, the (offset,length) pair that describes the master index itself,
 * 0x800 bytes of padding, then every resource in subindex order and slot
 * order, then one 256-entry subindex table per populated subindex, then the
 * master index pairs filled in last. Being byte-identical to the reference
 * implementation is the point -- utilities/delv_write_check.mjs builds
 * archives with delvmod and fails if this function's output differs by one
 * byte, which is the same arrangement that keeps decompressDCG honest.
 * If you change the layout here, you are no longer writing Delver archives,
 * you are writing something delvmod happens to be able to read.
 *
 * Two behaviours worth calling out because they look like bugs and are
 * delvmod's own, kept for equivalence:
 *   - A zero-length resource is dropped entirely (delvmod's `if res:` uses
 *     __len__, so an empty resource is falsy and never written).
 *   - Every subindex table is written as 256 entries / 2048 bytes and the
 *     master index records length 2048, whatever the table's own length
 *     said in the file this data came from.
 */

// The cipher is a keystream XOR, so it is its own inverse: encrypting IS
// decrypting. The alias exists so call sites say what they mean.
const encryptResource = decryptResource;

function writeDelverArchive(spec) {
  const mio = spec.masterIndexOffset ?? 0x80;
  const masterLen = spec.masterIndexLength ?? 0x800;
  // Group resources into subindex slot arrays, dropping empties (see above).
  const slots = new Array(256).fill(null);
  for (const r of (spec.resources || [])) {
    if (!r.data || !r.data.length) continue;
    const subn = Math.floor(r.resid / 0x100) - 1;
    const n = r.resid % 0x100;
    if (subn < 0 || subn > 255) throw new Error('resid out of range: 0x' + r.resid.toString(16));
    if (subn >= masterLen / 8 - 1) throw new Error('subindex ' + subn + ' does not fit a master index of length 0x' + masterLen.toString(16));
    if (!slots[subn]) slots[subn] = new Array(256).fill(null);
    slots[subn][n] = r;
  }

  // A zero-initialised growable buffer; the gaps delvmod creates by seeking
  // forward (between the header fields, and the whole pad) stay zero here
  // by construction.
  let buf = new Uint8Array(0x20000);
  let end = 0;
  const ensure = (need) => {
    if (need > buf.length) {
      const nb = new Uint8Array(Math.max(need, buf.length * 2));
      nb.set(buf);
      buf = nb;
    }
    if (need > end) end = need;
  };
  const w8 = (v, at) => { ensure(at + 1); buf[at] = v & 0xFF; };
  const w32 = (v, at) => {
    ensure(at + 4);
    buf[at] = (v >>> 24) & 0xFF; buf[at + 1] = (v >>> 16) & 0xFF;
    buf[at + 2] = (v >>> 8) & 0xFF; buf[at + 3] = v & 0xFF;
  };
  const wbytes = (b, at) => { ensure(at + b.length); buf.set(b, at); };
  const wpstring = (s, at) => {
    const eb = encodeMacRoman(s || '');
    w8(eb.length, at);
    wbytes(eb, at + 1);
  };

  wpstring(spec.scenarioTitle ?? 'Cythera: Fate of Alaric', 0);
  wpstring(spec.playerName ?? '', 0x20);
  w8(spec.unknown40 ?? 0x13, 0x40);
  w8(spec.formatMajor ?? 2, 0x42);
  w8(spec.formatMinor ?? 0, 0x43);
  w8(spec.unknown48 ?? 2, 0x48);
  w32(mio, mio);
  w32(masterLen, mio + 4);

  // delvmod pads a fixed 0x800 after the header regardless of the master
  // index length it just wrote, so the first resource lands at mio + 0x808.
  let pos = mio + 8 + 0x800;
  ensure(pos);

  // Pass 1: resource data, subindex-ascending, slot-ascending. Encryption is
  // applied on the way out; spec data is always plaintext.
  const placed = new Map();
  for (let subn = 0; subn < 256; subn++) {
    const sl = slots[subn];
    if (!sl) continue;
    for (let n = 0; n < 256; n++) {
      const r = sl[n];
      if (!r) continue;
      const stored = r.encrypted ? encryptResource(r.data, r.resid) : r.data;
      placed.set(r, [pos, r.data.length]);
      wbytes(stored, pos);
      pos += stored.length;
    }
  }

  // Pass 2: one 256-entry table per populated subindex, remembering where
  // each went for the master index.
  const master = [];
  for (let subn = 0; subn < 256; subn++) {
    const sl = slots[subn];
    if (!sl) continue;
    master.push([subn, pos]);
    for (let n = 0; n < 256; n++) {
      const at = placed.get(sl[n]);
      w32(at ? at[0] : 0, pos);
      w32(at ? at[1] : 0, pos + 4);
      pos += 8;
    }
  }

  // Pass 3: the master index, back at the start. Empty subindexes stay as
  // the zeros the pad already holds, which is exactly the (0,0) delvmod
  // writes for them.
  for (const [subn, off] of master) {
    const at = mio + 8 + subn * 8;
    w32(off, at);
    w32(0x800, at + 4);
  }
  return buf.slice(0, end);
}

/* The parse that writeDelverArchive is the inverse of: an archive buffer in,
 * a writer spec out, with every resource as plaintext plus the encryption
 * verdict smartDecrypt reached for it. writeDelverArchive(delverArchiveSpec(b))
 * is the round trip the harness proves byte-exact against delvmod, and it is
 * the seam a future save-modified-archive feature edits in the middle of. */
function delverArchiveSpec(bytes) {
  const mi = delverMasterIndexExtent(bytes);
  if (!mi) return null;
  const spec = {
    scenarioTitle: pstring(bytes, 0),
    playerName: pstring(bytes, 0x20),
    /* 0x42 and 0x43 are the format's major and minor, and they were
       `unknown42` and unread until 14 September 2026. Magpie reads both out of
       the game's header and out of each patch's, and compares them at
       `0xb6d0`, which is not an equality test: the majors must match exactly
       and the game's minor must be at least the patch's. Both the shipped
       archive and the Pumpkin Patch carry 02 00, so the format is 2.0 and the
       rule is the ordinary one. The writer emits the minor now rather than
       leaving the pad's zero there; on every archive this project has seen it
       IS zero, so the write snapshot does not move. */
    formatMajor: bytes[0x42], formatMinor: bytes[0x43],
    unknown40: bytes[0x40], unknown48: bytes[0x48],
    masterIndexOffset: mi.off, masterIndexLength: mi.len,
    resources: []
  };
  for (let subn = 0; subn < mi.count; subn++) {
    const p0 = mi.first + subn * 8;
    const subOff = u32be(bytes, p0), subLen = u32be(bytes, p0 + 4);
    if (!subOff || subOff + subLen > bytes.length) continue;
    const nmax = Math.min(256, Math.floor(subLen / 8));
    for (let n = 0; n < nmax; n++) {
      const p = subOff + n * 8;
      const roff = u32be(bytes, p), rlen = u32be(bytes, p + 4);
      if (!roff || !rlen || roff + rlen > bytes.length) continue;
      const resid = (subn + 1) * 0x100 + n;
      const raw = bytes.slice(roff, roff + rlen);
      const dec = smartDecrypt(raw, resid);
      // fileOffset/fileLength are where this resource's CIPHERTEXT sits in the
      // file it was read from. Nothing needed them until the patch route: the
      // cipher is a position-indexed keystream XOR, so editing plaintext
      // changes exactly the same byte positions in the file, and knowing where
      // the resource starts turns an edit into a handful of (offset, byte)
      // pairs instead of a five-megabyte archive.
      spec.resources.push({ resid, data: dec.data, encrypted: dec.wasDecrypted,
                            fileOffset: roff, fileLength: rlen });
    }
  }
  return spec;
}

/* ---- applying a Magpie patch ----------------------------------------------
   The closest thing Cythera has to an add-on system, and it is not a plug-in
   folder: nothing in the game reads one. A Magpie patch is a Delver Archive
   carrying the same scenario header as `Cythera Data` and holding only the
   resources to replace -- the Pumpkin Patch is 57,662 bytes against the
   archive's 5.6 MB, twelve tile sheets (subindex 141, 55 of their 192 tiles
   redrawn: jack-o'-lanterns, autumn foliage, blood on the blades) and one
   resource of Magpie's own. Magpie merged it into the data file on disk in 2000; this does the same
   merge in memory, so the browser player can boot a patched archive without
   anything being written back to a real file.

   THE MERGE IS BY RESOURCE ID AND NOTHING ELSE. Take the base archive's spec,
   replace each resource whose id the patch also carries, re-serialize. The
   cipher is keyed by the resource id and indexed from the start of the
   resource (see `decryptResource`), not by where the resource sits in the
   file, so moving a resource to a new offset is safe and the plaintext the
   patch supplies re-encrypts to the same bytes wherever it lands.

   WHAT IT REFUSES, and why each one is a real file someone will try:
   - a patch for another scenario: the title at offset 0 must match, or the
     resource ids mean something else entirely;
   - a saved game: `DelP` is the type of both a player file and a patch, and
     five of the twelve community add-ons are player files. A non-empty player
     name at 0x20 is the difference, and those go through the character import
     instead;
   - anything that is not a Delver Archive at all.

   A resource id the patch holds that the base does not is REPORTED AND
   SKIPPED rather than added, and so is one whose encryption verdict the two
   sides disagree about. The one real patch carries exactly one such
   resource, 0xFFFF in a subindex the game's archive does not have, which is
   Magpie's own bookkeeping and not game content. Adding ids the base lacks is
   how a patch would grow the archive into shapes nothing here has ever seen;
   the count comes back so a caller can say so. */
function mergeDelverPatch(baseBytes, patchBytes) {
  const base = delverArchiveSpec(baseBytes);
  if (!base) throw new Error('the game archive is not a Delver Archive');
  const patch = delverArchiveSpec(patchBytes);
  if (!patch) throw new Error('that file is not a Delver Archive, so it is not a Magpie patch');
  if (patch.playerName)
    throw new Error('that is a saved game (' + patch.playerName + '), not a patch — import it as a character instead');
  if (patch.scenarioTitle !== base.scenarioTitle)
    throw new Error('that patch is for ' + JSON.stringify(patch.scenarioTitle) +
                    ', and this game is ' + JSON.stringify(base.scenarioTitle));
  if (!patch.resources.length) throw new Error('that patch holds no resources');

  const byId = new Map(base.resources.map(r => [r.resid, r]));
  const replaced = [], skipped = [], disagreed = [];
  for (const r of patch.resources) {
    const target = byId.get(r.resid);
    if (!target) { skipped.push(r.resid); continue; }
    // Both sides ran the same smartDecrypt on the same id. When they reach
    // different verdicts one of the two plaintexts is not plaintext, and the
    // writer re-encrypts from the base's verdict -- so writing this resource
    // would put garbage in the archive. Leave the original in place and say
    // so. DELV_CLEAR_SUBN covers subindex 141, where the one real patch
    // works, so this is a guard rather than a path anything has taken.
    if (!!r.encrypted !== !!target.encrypted) { disagreed.push(r.resid); continue; }
    target.data = r.data;
    replaced.push(r.resid);
  }
  if (!replaced.length)
    throw new Error('none of that patch\'s ' + patch.resources.length +
                    ' resource(s) could be applied to the game archive');
  return { bytes: writeDelverArchive(base), replaced, skipped, disagreed,
           title: patch.scenarioTitle };
}

/* ---- reading a patch without applying it ----------------------------------
   `mergeDelverPatch` above answers "what would this do to my file"; these
   answer "what IS this file", which is what a page has to say before anyone
   presses anything. Both were read out of Magpie's own PowerPC code in
   September 2026 (the reading is in `GRIMOIRE-NOTES.md`), and both are
   confirmed against the one real patch on this disk.

   TWO RESOURCES, AND THEY LIVE ON OPPOSITE SIDES. `0xFFFF` is the PATCH's
   descriptor, the 568 bytes Magpie shows a row of; `0xFFFE` is the GAME
   file's list of what has been applied to it, and it is nothing but an array
   of 16-byte UUIDs with no name, no version and no order in it. That is why
   Magpie needs every patch file present to name what is installed, and why
   this page can only say "installed" of a patch it has been handed.
   Neither resource is in the shipped `Cythera Data`. */
const DELV_PATCH_DESCRIPTOR = 0xFFFF;
const DELV_PATCH_INSTALLED = 0xFFFE;
const DELV_PATCH_DESCRIPTOR_LENGTH = 568;

/* ONE BYTE AT +26 CARRIES BOTH THE TYPE AND THE TRUST LEVEL, and the mapping
   is now read rather than guessed. It was deliberately left at the single
   value the binary tests outright -- 0 is Bug Fix, from the "Bug fixes are
   always installed, and can not be removed" branch -- because naming the rest
   from the order of `STR# 128` would have been a guess wearing a name.

   Recovered 15 September 2026 from the row drawer's two dispatches at
   `code+0x0d4` and `code+0x134`, which set a type index and a trust index
   into `STR# 128` and then draw them as one label. `STR# 128` is, in order:
   Bug Fix, Expansion, Add On, Plug In, "Official ", "Approved ",
   "Unofficial", Invalid, Not Installed, Installed, then the six action words.
   The two prefixes carry a trailing space because the label is concatenated.

   Two things the table shows that no reading of the strings would have:

   - **Code 2 selects neither a type nor a trust level**, so a patch carrying
     it draws with no label at all. That is the value the digest validator
     writes over this byte when a descriptor fails its check, and it is how a
     bad patch "comes out of the list wearing a different type" -- it comes
     out wearing none.
   - **"Unofficial" is never selected.** The string is there and this dispatch
     cannot reach it; a patch with no trust level shows the bare type. So the
     honest designation for a community patch is 5, not 7. */
const DELV_PATCH_TYPES = {
  0: { type: 'Bug Fix' },
  1: { type: 'Expansion' },
  2: {},                                        // what a failed digest leaves
  3: { type: 'Add On',  trust: 'Official' },
  4: { type: 'Add On',  trust: 'Approved' },
  5: { type: 'Add On' },
  6: { type: 'Plug In', trust: 'Official' },
  7: { type: 'Plug In', trust: 'Approved' },
  8: { type: 'Plug In' },
};
/* The code a patch made here carries. 5 is Add On with no trust level, which
   is what a community patch honestly is: 3 is Official and would have this
   page's output claiming to be Ambrosia's, which is what it did until the
   maintainer saw "Official Add On" against a patch he had just made. */
const DELV_PATCH_EXPORT_TYPE = 5;

/* WHO MADE A PATCH IS NOT IN THE PATCH. The descriptor has room for it and
   the Pumpkin Patch leaves it empty, so a page that wants to credit an author
   has to carry the name itself, keyed by the one thing a patch does say about
   its identity. That is the UUID, which is also the only thing Magpie matches
   on.

   This is the built-in-name-table rule applied to a person: an entry keeps
   only what the file does not say, and every entry names where it came from.
   `source` is not shown as a citation; it is here so that an entry can be
   checked or removed by someone who was not in the room.

   One entry, because one Magpie patch is known to exist. Glenn Andreas made
   both the patch and Magpie: Ambrosia announced it in the community's topic
   528 over Andrew Welch's signature ("Glenn Andreas has released a cool patch
   for Cythera entitled 'Magpie Pumpkin Patch'"), and Glenn answers in the
   same thread describing how he made it, with the editor and a patch maker he
   did not release. */
const DELV_PATCH_AUTHORS = {
  '00b21e58-a47f-11d4-8a4a-000502c9f8b7': {
    name: 'Glenn Andreas',
    title: 'Magpie Pumpkin Patch',
    source: 'Cythera web board topic 528, announced by Ambrosia and answered by its author'
  }
};

/* ---- the descriptor's check value -----------------------------------------
   The eight bytes at descriptor +0, which Magpie verifies before it will list
   a patch at all: a descriptor that fails is marked unusable and its type byte
   overwritten with 2. Until 15 September 2026 this project could read the
   value and not produce one, so a patch written here could be applied by this
   page and by the browser player but would never have installed in Magpie.

   IT IS A 64-BIT CRC, and it was recovered by reading Magpie's own PowerPC
   code rather than by guessing: `0x8900` seeds an eight-entry basis from the
   polynomial, `0x89c0` makes the 256-entry table out of it, and `0x8ac0` runs
   the loop. An earlier attempt transcribed those three routines and failed
   against about four hundred variants of word order, bit order, reflection,
   shift and range. It failed because of two steps that are in the code and
   are not in any description of a CRC:

   - **THE LENGTH IS FED IN AFTER THE DATA.** When the buffer runs out, a
     second loop at `0x8b4c` keeps going with the LENGTH in place of a byte,
     shifting it right eight each time until it is zero. So the digest covers
     the message and then its length, low byte first.
   - **THE RESULT IS COMPLEMENTED.** `0x8ba0` is `not r4` and `not r3`, the
     last thing the routine does before returning.

   Miss either and every byte of the answer is wrong, which is exactly what a
   transcription that reasoned from "it is a CRC-32 polynomial" would produce.

   THE INDEX IS `(crc >> 24) & 0xFF`, not `crc >> 56` as a 64-bit CRC would
   normally use. That is what the code does (`li r5, 24` before the shift
   helper) and it is left alone rather than tidied.

   HELD TO ONE SAMPLE, and it is the only one that exists: the Magpie Pumpkin
   Patch, whose descriptor states `c49ba981 0778a4b9`. A 64-bit value matching
   by accident is not a thing that happens, so the algorithm is right; what
   one sample cannot prove is that Magpie ACCEPTS what we write, which wants a
   pass of Magpie under Mac OS 9 and is the one confirmation still outstanding. */
const DELV_PATCH_CRC_POLY = { hi: 0x04C11D37, lo: 0x04C11DB7 };
let _delvPatchCrcTable = null;
function delvPatchCrcTable() {
  if (_delvPatchCrcTable) return _delvPatchCrcTable;
  const xor = (a, b) => ({ hi: (a.hi ^ b.hi) >>> 0, lo: (a.lo ^ b.lo) >>> 0 });
  const shl1 = c => ({ hi: ((c.hi << 1) | (c.lo >>> 31)) >>> 0, lo: (c.lo << 1) >>> 0 });
  // 0x8900: eight entries, each the previous shifted up one and reduced by
  // the polynomial when the bit that fell off the top was set.
  const basis = [DELV_PATCH_CRC_POLY];
  for (let i = 1; i < 8; i++) {
    const prev = basis[i - 1], shifted = shl1(prev);
    basis.push((prev.hi & 0x80000000) ? xor(shifted, DELV_PATCH_CRC_POLY) : shifted);
  }
  // 0x89c0: one entry per byte, the XOR of the basis entries its bits select.
  const table = new Array(256);
  for (let b = 0; b < 256; b++) {
    let v = { hi: 0, lo: 0 };
    for (let k = 0; k < 8; k++) if (b & (1 << k)) v = xor(v, basis[k]);
    table[b] = v;
  }
  return (_delvPatchCrcTable = table);
}

/* `bytes` is what the digest covers and `length` is the number the routine is
   handed, which is also what gets folded in at the end. Magpie passes the
   descriptor from +8 and a length of `statedLength - 8`, which is what
   `delverPatchCheckValue` below does; this takes both so the two can be told
   apart in a check. */
function delvPatchCrc(bytes, length) {
  const table = delvPatchCrcTable();
  const xor = (a, b) => ({ hi: (a.hi ^ b.hi) >>> 0, lo: (a.lo ^ b.lo) >>> 0 });
  const shl8 = c => ({ hi: ((c.hi << 8) | (c.lo >>> 24)) >>> 0, lo: (c.lo << 8) >>> 0 });
  const top = c => (((c.lo >>> 24) | (c.hi << 8)) >>> 0) & 0xFF;   // (crc >> 24) low byte
  let c = { hi: 0, lo: 0 };
  for (let i = 0; i < bytes.length; i++) c = xor(shl8(c), table[(top(c) ^ bytes[i]) & 0xFF]);
  for (let n = length; n > 0; n >>= 8) c = xor(shl8(c), table[(top(c) ^ n) & 0xFF]);
  return { hi: (~c.hi) >>> 0, lo: (~c.lo) >>> 0 };
}

/* The eight bytes Magpie expects at the head of a 568-byte descriptor, given
   the descriptor. The covered range is +8 to the end of the stated length,
   and the length handed to the routine is that range's size. */
function delverPatchCheckValue(descriptor) {
  const stated = descriptor.length >= 26 ? u16be(descriptor, 24) : descriptor.length;
  const end = Math.min(stated || descriptor.length, descriptor.length);
  const c = delvPatchCrc(descriptor.subarray(8, end), Math.max(0, end - 8));
  const out = new Uint8Array(8);
  out[0] = (c.hi >>> 24) & 0xFF; out[1] = (c.hi >>> 16) & 0xFF;
  out[2] = (c.hi >>> 8) & 0xFF;  out[3] = c.hi & 0xFF;
  out[4] = (c.lo >>> 24) & 0xFF; out[5] = (c.lo >>> 16) & 0xFF;
  out[6] = (c.lo >>> 8) & 0xFF;  out[7] = c.lo & 0xFF;
  return out;
}

/* A 16-byte version-1 UUID in the usual 8-4-4-4-12 spelling. Magpie compares
   these byte for byte (`IsUUIDEqual`) and never parses one, so the text is
   for a reader rather than for any comparison here. */
function delverUuidText(bytes, at) {
  at = at || 0;
  if (!bytes || at + 16 > bytes.length) return '';
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += bytes[at + i].toString(16).padStart(2, '0');
  }
  return s;
}

/* The descriptor of a patch, from the patch archive's own spec. Null when the
   file carries no `0xFFFF` at all, which is the ordinary answer for a saved
   game and for the shipped archive.

   THE DESCRIPTION IS AT +0x138 AND THE DISASSEMBLY SAID +0x13B. The reading
   of Magpie's row drawer put it three bytes later; the file itself is
   unambiguous, a length byte of 82 at +0x138 followed by exactly 82 bytes of
   text and then zeroes to the end, which is a Pascal string at +0x138 and
   nothing else. The sample wins and the discrepancy is recorded rather than
   smoothed over: it means one of the two readings of that routine is wrong,
   and only the offset is affected. */
/* Is this archive a Magpie patch, decided without decrypting the whole of it?
   `delverArchiveSpec` walks and decrypts every resource, which on the 5.6 MB
   scenario is real time to spend on a file that has only just been dropped,
   and the question here is whether ONE resource is present. The descriptor is
   0xFFFF, so its subindex and entry are read straight out of the master index
   and that resource alone is decrypted. Returns what delverPatchDescriptor
   returns, or null for the scenario, a saved game, or anything else. */
function delverArchivePatchPeek(bytes) {
  const mi = delverMasterIndexExtent(bytes);
  if (!mi) return null;
  const subn = (DELV_PATCH_DESCRIPTOR >> 8) - 1, n = DELV_PATCH_DESCRIPTOR & 0xFF;
  if (subn >= mi.count) return null;
  const p0 = mi.first + subn * 8;
  const subOff = u32be(bytes, p0), subLen = u32be(bytes, p0 + 4);
  if (!subOff || subOff + subLen > bytes.length || subLen < (n + 1) * 8) return null;
  const p = subOff + n * 8;
  const roff = u32be(bytes, p), rlen = u32be(bytes, p + 4);
  if (!roff || !rlen || roff + rlen > bytes.length) return null;
  const dec = smartDecrypt(bytes.slice(roff, roff + rlen), DELV_PATCH_DESCRIPTOR);
  return delverPatchDescriptor({ resources: [{ resid: DELV_PATCH_DESCRIPTOR, data: dec.data }] });
}

function delverPatchDescriptor(spec) {
  if (!spec || !spec.resources) return null;
  const r = spec.resources.find(x => x.resid === DELV_PATCH_DESCRIPTOR);
  if (!r || r.data.length < 0x139) return null;
  const d = r.data;
  const stated = u16be(d, 24);
  return {
    // +0 is a 64-bit check value over the rest, and Magpie only ever verifies
    // it: the producer is Glenn Andreas's patch maker and is not in the
    // binary. Reading or applying a patch never needs to reproduce one, so it
    // is carried as text and judged on by nothing here.
    checkValue: Array.from(d.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(''),
    // Since the routine was recovered, the page can do what Magpie does and
    // say whether the descriptor is intact rather than only quoting it.
    checkValueValid: (() => {
      const want = delverPatchCheckValue(d);
      for (let i = 0; i < 8; i++) if (want[i] !== d[i]) return false;
      return true;
    })(),
    uuid: d.slice(8, 24),
    uuidText: delverUuidText(d, 8),
    // +24 is the descriptor's own length. Magpie refuses anything but 568, so
    // a disagreement here is a patch Magpie would not have listed either.
    statedLength: stated,
    actualLength: d.length,
    lengthAgrees: stated === DELV_PATCH_DESCRIPTOR_LENGTH && d.length === DELV_PATCH_DESCRIPTOR_LENGTH,
    // +26 is the type and trust code. See the table above for why only 0 is
    // named, and why 2 is worth saying something about.
    typeCode: d[26],
    typeName: (DELV_PATCH_TYPES[d[26]] || {}).type || null,
    trustName: (DELV_PATCH_TYPES[d[26]] || {}).trust || null,
    // How Magpie's own list would label it: the trust prefix and the type,
    // and nothing at all when the code selects neither.
    typeLabel: [(DELV_PATCH_TYPES[d[26]] || {}).trust, (DELV_PATCH_TYPES[d[26]] || {}).type].filter(Boolean).join(' ') || null,
    typeOverwritten: d[26] === 2,
    // +28 is the descriptor's own file offset, compared against the patch
    // archive's subindex-255 offset. A descriptor lifted out of one file and
    // into another fails this and nothing else would notice.
    selfOffset: u32be(d, 28),
    fileOffset: r.fileOffset,
    selfOffsetAgrees: u32be(d, 28) === r.fileOffset,
    description: pstring(d, 0x138)
  };
}

/* The UUIDs a game archive says have been applied to it. An absent `0xFFFE`
   and an empty one mean the same thing and are not distinguished: Magpie
   treats a missing resource as an empty list (`NewHandle(0)`), and an
   unpatched `Cythera Data` simply has no such resource. */
function delverInstalledPatchIds(spec) {
  if (!spec || !spec.resources) return [];
  const r = spec.resources.find(x => x.resid === DELV_PATCH_INSTALLED);
  if (!r) return [];
  const out = [];
  for (let at = 0; at + 16 <= r.data.length; at += 16) out.push(delverUuidText(r.data, at));
  return out;
}

/* Everything a reader needs about one patch against one game file, as data:
   who it says it is, whether the game file has it, whether Magpie would take
   it, and every resource it names with the shipped one beside it.

   IT APPLIES NOTHING AND DECODES NOTHING. The report is offsets, lengths and
   verdicts; a caller that wants to draw the two versions of a tile sheet has
   both sets of bytes here and decodes them itself. That keeps this checkable
   against the file rather than against a canvas, and it is why the whole
   report can be built for a patch the page will never merge.

   `usable` is Magpie's own gate and not a judgement of our own: it is the
   three tests the scan runs before a patch reaches the list. A patch that
   fails one is reported with the reason rather than refused, because the
   reason is the interesting part. */
function describeDelverPatch(baseSpec, patchSpec) {
  if (!baseSpec || !patchSpec) return null;
  const desc = delverPatchDescriptor(patchSpec);
  const installed = delverInstalledPatchIds(baseSpec);
  const byId = new Map(baseSpec.resources.map(r => [r.resid, r]));
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  const resources = [];
  for (const p of patchSpec.resources) {
    if (p.resid === DELV_PATCH_DESCRIPTOR || p.resid === DELV_PATCH_INSTALLED) continue;
    const b = byId.get(p.resid);
    resources.push({
      resid: p.resid,
      subn: (p.resid >> 8) - 1,
      patchData: p.data, patchLength: p.data.length, patchEncrypted: !!p.encrypted,
      baseData: b ? b.data : null, baseLength: b ? b.data.length : null,
      baseEncrypted: b ? !!b.encrypted : null,
      // The three verdicts mergeDelverPatch reaches, named so a reader can be
      // told why a resource will not move before pressing anything.
      inBase: !!b,
      encryptionAgrees: b ? (!!p.encrypted === !!b.encrypted) : null,
      identical: b ? same(p.data, b.data) : false
    });
  }

  const reasons = [];
  if (patchSpec.playerName)
    reasons.push('it carries a player name, so it is a saved game rather than a patch');
  if (patchSpec.scenarioTitle !== baseSpec.scenarioTitle)
    reasons.push('it is for ' + JSON.stringify(patchSpec.scenarioTitle) +
                 ' and this file is ' + JSON.stringify(baseSpec.scenarioTitle));
  if (baseSpec.formatMajor !== patchSpec.formatMajor)
    reasons.push('its format major is ' + patchSpec.formatMajor +
                 ' and this file is ' + baseSpec.formatMajor);
  else if (baseSpec.formatMinor < patchSpec.formatMinor)
    reasons.push('it needs format minor ' + patchSpec.formatMinor +
                 ' and this file is ' + baseSpec.formatMinor);
  if (desc && !desc.lengthAgrees)
    reasons.push('its descriptor states ' + desc.statedLength + ' bytes and Magpie takes only ' +
                 DELV_PATCH_DESCRIPTOR_LENGTH);
  if (desc && !desc.selfOffsetAgrees)
    reasons.push('its descriptor was written for another file: it names offset ' +
                 desc.selfOffset + ' and sits at ' + desc.fileOffset);

  return {
    descriptor: desc,
    scenarioTitle: patchSpec.scenarioTitle,
    playerName: patchSpec.playerName,
    format: patchSpec.formatMajor + '.' + patchSpec.formatMinor,
    baseFormat: baseSpec.formatMajor + '.' + baseSpec.formatMinor,
    installedIds: installed,
    // Identity is the UUID and only the UUID: there is no name in the list to
    // match on, which is the whole shape of Magpie's problem.
    isInstalled: !!(desc && desc.uuidText && installed.indexOf(desc.uuidText) >= 0),
    resources,
    willReplace: resources.filter(r => r.inBase && r.encryptionAgrees).length,
    notInBase: resources.filter(r => !r.inBase).map(r => r.resid),
    disagreed: resources.filter(r => r.inBase && !r.encryptionAgrees).map(r => r.resid),
    unchanged: resources.filter(r => r.identical).map(r => r.resid),
    usable: !reasons.length,
    reasons
  };
}

/* ---- two archives against each other --------------------------------------
   `describeDelverPatch` above answers "what would this patch do to my file",
   which is one archive against a SUBSET of another. This is the general case:
   two whole archives, resource by resource. It is what a version comparison
   is made of, and it is also how the page knows what to put in a patch it
   writes -- the edits you made are simply the diff between the file as it
   arrived and the file as it stands.

   IT READS NO AMBIENT STATE, which is the whole reason this is possible at
   all. The save comparison in the handoff is blocked because it needs
   `getResourceBytes`, which reads the open archive out of `fileBytes` as a
   global; nothing here does, so two archives can be open at once as data
   even though they cannot both be the page's "open file".

   ORDER IS MEANINGFUL: `a` is the older or the original, `b` the newer or the
   edited. Added and removed are named from a's point of view.

   It compares PLAINTEXT, not stored bytes. Two archives can hold the same
   resource encrypted in one and clear in the other and the resource has not
   changed; comparing what was stored would call that a difference, and every
   rebuild would look like a change to half the file. `encryptionChanged` says
   so separately for the handful where the verdict differs. */
function describeDelverDiff(a, b) {
  if (!a || !b) return null;
  const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const am = new Map(a.resources.map(r => [r.resid, r]));
  const bm = new Map(b.resources.map(r => [r.resid, r]));
  const changed = [], added = [], removed = [], encryptionChanged = [];
  let unchanged = 0;
  for (const [resid, ar] of am) {
    const br = bm.get(resid);
    if (!br) { removed.push({ resid, subn: (resid >> 8) - 1, a: ar }); continue; }
    if (!!ar.encrypted !== !!br.encrypted) encryptionChanged.push(resid);
    if (same(ar.data, br.data)) { unchanged++; continue; }
    changed.push({ resid, subn: (resid >> 8) - 1, a: ar, b: br,
                   aLength: ar.data.length, bLength: br.data.length });
  }
  for (const [resid, br] of bm) if (!am.has(resid)) added.push({ resid, subn: (resid >> 8) - 1, b: br });
  const bySubn = new Map();
  for (const r of changed.concat(added, removed)) {
    if (!bySubn.has(r.subn)) bySubn.set(r.subn, { subn: r.subn, changed: 0, added: 0, removed: 0 });
    const g = bySubn.get(r.subn);
    if (r.a && r.b) g.changed++; else if (r.b) g.added++; else g.removed++;
  }
  return {
    changed, added, removed, encryptionChanged, unchanged,
    aCount: am.size, bCount: bm.size,
    identical: !changed.length && !added.length && !removed.length,
    // Sorted so the biggest difference leads, which is what a reader wants to
    // open first; the ordering is presentation and the lists above are not
    // reordered, so a caller that wants file order still has it.
    groups: [...bySubn.values()].sort((x, y) =>
      (y.changed + y.added + y.removed) - (x.changed + x.added + x.removed) || x.subn - y.subn),
    titleChanged: a.scenarioTitle !== b.scenarioTitle,
    formatChanged: a.formatMajor !== b.formatMajor || a.formatMinor !== b.formatMinor
  };
}

/* ---- writing a Magpie patch -----------------------------------------------
   The inverse of the patches section: given a base archive and the ids that
   changed, write an archive shaped like a Magpie patch -- the base's scenario
   header, the changed resources and nothing else, and a descriptor at
   `0xFFFF` saying what it is.

   IT WRITES A REAL CHECK VALUE since 15 September 2026. The descriptor's
   first eight bytes are a 64-bit CRC that Magpie verifies before it will list
   a patch, and this wrote zeroes there for as long as the routine was unread.
   `delverPatchCheckValue` computes it now -- see that function for how it was
   recovered and for the two steps that had defeated the earlier attempt --
   so a patch written here is intact by Magpie's own test.

   THAT IS NOT THE SAME AS KNOWING MAGPIE INSTALLS IT. The algorithm is held
   to the one real patch that exists and reproduces its value exactly, and a
   64-bit value does not match by accident; what no check here can reach is
   whether Magpie, running under Mac OS 9, accepts a descriptor we assembled.
   That wants one pass of the real program and is the confirmation still
   outstanding.

   THE SELF-OFFSET NEEDS TWO PASSES. Descriptor +28 holds the descriptor's own
   offset in the file, and where it lands is decided by the writer. So the
   archive is written once to find out, the descriptor is corrected, and it is
   written again. The second write moves nothing -- the descriptor's length
   does not change -- which the check asserts rather than assumes. */
function writeDelverPatch(baseSpec, resids, opts) {
  opts = opts || {};
  if (!baseSpec) throw new Error('no archive to take resources from');
  const wanted = [...new Set(resids || [])].sort((x, y) => x - y);
  if (!wanted.length) throw new Error('nothing has changed, so there is nothing to put in a patch');
  const byId = new Map(baseSpec.resources.map(r => [r.resid, r]));
  const missing = wanted.filter(id => !byId.has(id));
  if (missing.length) throw new Error('not in the archive: ' + missing.map(i => '0x' + i.toString(16)).join(', '));

  const description = String(opts.description || '').slice(0, 255);
  // Defaulting to 0 would make a caller that forgets the option write a Bug
  // Fix, the one code Magpie refuses to uninstall. The page always passes
  // this explicitly; the default is here so that forgetting is harmless.
  const typeCode = opts.typeCode === undefined ? DELV_PATCH_EXPORT_TYPE : (opts.typeCode & 0xFF);
  // Magpie matches on the UUID and nothing else, and never parses one, so a
  // random 16 bytes is as good an identity as a real version-1 UUID would be.
  // The version and variant nibbles are set so it reads as a v4 rather than
  // pretending to be the v1 Glenn's maker produced.
  let uuid = opts.uuid;
  if (!uuid) {
    uuid = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(uuid);
    else for (let i = 0; i < 16; i++) uuid[i] = Math.floor(Math.random() * 256);
    uuid[6] = (uuid[6] & 0x0F) | 0x40;
    uuid[8] = (uuid[8] & 0x3F) | 0x80;
  }

  const descriptorFor = selfOffset => {
    const d = new Uint8Array(DELV_PATCH_DESCRIPTOR_LENGTH);
    d.set(uuid, 8);
    d[24] = (DELV_PATCH_DESCRIPTOR_LENGTH >> 8) & 0xFF;
    d[25] = DELV_PATCH_DESCRIPTOR_LENGTH & 0xFF;
    d[26] = typeCode;
    d[28] = (selfOffset >>> 24) & 0xFF; d[29] = (selfOffset >>> 16) & 0xFF;
    d[30] = (selfOffset >>> 8) & 0xFF;  d[31] = selfOffset & 0xFF;
    const text = encodeMacRoman(description);
    d[0x138] = Math.min(text.length, 255);
    d.set(text.subarray(0, 255), 0x139);
    // Last, because it covers everything above it.
    d.set(delverPatchCheckValue(d), 0);
    return d;
  };
  const build = selfOffset => writeDelverArchive({
    scenarioTitle: baseSpec.scenarioTitle,
    playerName: '',
    formatMajor: baseSpec.formatMajor, formatMinor: baseSpec.formatMinor,
    unknown40: baseSpec.unknown40, unknown48: baseSpec.unknown48,
    resources: wanted.map(id => byId.get(id))
      .map(r => ({ resid: r.resid, data: r.data, encrypted: r.encrypted }))
      .concat([{ resid: DELV_PATCH_DESCRIPTOR, data: descriptorFor(selfOffset), encrypted: false }])
  });

  const once = build(0);
  const placed = delverArchiveSpec(once).resources.find(r => r.resid === DELV_PATCH_DESCRIPTOR);
  if (!placed) throw new Error('the descriptor did not survive the first write');
  const bytes = build(placed.fileOffset);
  const back = delverPatchDescriptor(delverArchiveSpec(bytes));
  return { bytes, resids: wanted, uuid, uuidText: delverUuidText(uuid, 0),
           description, typeCode, descriptorOffset: placed.fileOffset,
           // Read back rather than asserted: the descriptor that matters is
           // the one in the file, after the second write moved it.
           checkValueWritten: true,
           checkValue: back && back.checkValue,
           checkValueValid: !!(back && back.checkValueValid) };
}

/* ---- editing a map -------------------------------------------------------
   Two writers, deliberately the smallest two that could work. The map editor
   they were written for was cut from index.html in v1.29.0 -- the page reads
   maps and edits records, and a painting tool was the one thing on it whose
   cost had no floor -- but the writers and their check stay: a proven writer
   is cheap to keep and is what any later structured edit of a map would
   start from.

   A map resource is a header, a roof block and then one big-endian tile word
   per square, so **painting terrain is a patch, not a re-serialization**:
   `writeDelverMapTiles` copies the resource and writes two bytes per square
   changed. Nothing else in the resource is touched, and that is the property
   `delv_write_check.mjs` requires -- every other byte identical, the changed
   squares reading back as asked. A whole-map serializer would have to
   reproduce the roof block and the twelve bytes of padding at 20..31 that
   nothing in this project understands, and would risk all of it to move one
   tile.

   The prop list is the other way round: `writeDelverPropList` above already
   re-serializes the whole list and is proven the exact inverse of the parser
   over all 14,485 records in the shipped archive, so adding and removing go
   through it. `makeDelverPropRecord` exists so the page never has to invent
   the fields a fresh record needs -- particularly `tail`, six bytes the
   parser keeps as hex and nothing here understands.

   REMOVING A PROP DOES NOT REMOVE THE RECORD, and that is the important part.
   A record can be inside another prop in the same list, and the link is that
   prop's INDEX -- so splicing an entry out silently re-points every
   containment link after it. The file's own answer is a record whose flags
   are 0xFF: delvmod's `show_in_map` drops one (`if self.flags == 0xFF: return
   False`), this file's parser drops one, and the shipped archive carries
   exactly five. So Erase writes 0xFF and leaves the record where it is, every
   index intact. */
function writeDelverMapTiles(data, m, edits) {
  if (!m || !edits || !edits.length) return data;
  const out = data.slice();
  for (const e of edits) {
    const x = e.x | 0, y = e.y | 0;
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
    const o = m.mapDataOffset + (x + y * m.width) * 2;
    if (o + 1 >= out.length) continue;
    out[o] = (e.tile >> 8) & 0xFF;
    out[o + 1] = e.tile & 0xFF;
  }
  return out;
}
// A prop record with every field a fresh one needs and nothing invented: the
// six tail bytes are zero, which is what an unplaced record in the archive
// has, and the flags default to 0 -- on the map, not takeable.
function makeDelverPropRecord(p) {
  return {
    flags: p.flags === undefined ? 0 : (p.flags & 0xFF),
    x: p.x & 0xFFF, y: p.y & 0xFFF,
    aspect: (p.aspect || 0) & 0x1F, rotated: p.rotated ? 0x20 : 0,
    proptype: p.proptype & 0x3FF,
    d3: (p.d3 || 0) & 0xFFFF, storeref: (p.storeref || 0) & 0xFFFF,
    tail: '000000000000'
  };
}
// The record a square shows, topmost first: the list is drawn in order, so
// the LAST record on a square is the one on top of the pile.
function delverPropsAtSquare(records, x, y) {
  return records.filter(r => r.onMap && r.x === x && r.y === y).reverse();
}

/* The inverse of parseDelverPropList, record for record. It can be exact
 * because the parse is lossless even where it looks lossy: x and y jointly
 * carry all 24 bits of the location word (holder links included -- a carried
 * prop's holder number is just what those bits mean, not different bits),
 * and `tail` keeps bytes 10..15 verbatim, covering delvmod's storeref u32
 * and trailing u16 that the parser only summarises. So editing a record is:
 * parse the list, change fields, write it back -- and an untouched list
 * writes back byte-identical, which delv_write_check.mjs proves over every
 * prop list in the real archive. Records are 16 bytes; a list whose length
 * is not a multiple of 16 keeps its trailing fragment only if the caller
 * re-appends it (none in the shipped archive has one). */
/* ---- the character records, 0xF009 ---------------------------------------
   512 fixed 32-byte records, one per character index -- the same index that
   names them in 0x0201, talks for them in 0x18nn and schedules them in
   0xF00B. In `Cythera Data` they are where everybody starts; in a **saved
   game** they are the live state of the world, which is why they are the
   whole of what a save editor edits.

   The field map is delvmod's wiki page for F009, which was worked out by
   diffing the shipped table against saves taken either side of a change
   (Hector before and after joining the party is the worked example there).
   Two fields are not from it: **nutrition at byte 27**, read out of the
   executable -- `TGameViewer::DoTicks` takes one off byte 27 of this record
   every game hour (the sheet's Hunger section is drawn from that trace) --
   and byte 28's
   neighbours, left unnamed. In I.M.Cheater, the community's cheated save,
   the hero's byte 27 is 24 (a full stomach) and byte 28 is 0xFF (255
   training points), which is exactly what the file is famous for.

   THE UNKNOWN BYTES ARE KEPT AS BYTES, not as a hex tail. `parseDelverPropList`
   keeps its six unexplained bytes in a `tail` string because they are
   contiguous; here what is not understood is scattered through the record --
   6..7, 22..26, 29..31, and a second appearance word at 20..21 that is
   usually but NOT always the same as the one at 4..5 (the hero's differ in
   I.M.Cheater: aspect 13 against 0). So each record keeps `raw`, its own 32
   bytes, and the writer starts from that copy and lays the named fields back
   over it. That makes `write(parse(x))` exactly `x` for any record, named
   fields or not, and it makes an edit touch only the bytes the edit is
   about -- which for a file whose format is two thirds understood is the
   only honest way to write one back.

   `delv_write_check.mjs` requires the round trip byte for byte over the
   shipped table and over a saved game's when one is present. */
const DELV_CHAR_RECORD = 32;
function parseDelverCharacterRecords(data) {
  const out = [];
  for (let i = 0; i + DELV_CHAR_RECORD <= data.length; i += DELV_CHAR_RECORD) {
    const raw = data.slice(i, i + DELV_CHAR_RECORD);
    const ap = (raw[4] << 8) | raw[5];
    const xy = (raw[1] << 16) | (raw[2] << 8) | raw[3];
    out.push({
      index: out.length, raw,
      zone: raw[0], x: xy >> 12, y: xy & 0xFFF,
      proptype: ap & 0x3FF, aspect: ap >> 10,
      state: raw[8],                       // C0/D0/80 on the placed, 00 otherwise
      body: raw[9], reflex: raw[10], mind: raw[11],
      xp: (raw[12] << 8) | raw[13],
      health: raw[14], healthMax: raw[15],
      magic: raw[16], magicMax: raw[17],
      party: raw[18],                      // 0 until Hector joins, 5 after
      level: raw[19],
      nutrition: raw[27], training: raw[28]
    });
  }
  // Both tables in hand are an exact multiple of 32, but a fragment at the
  // end would be lost silently, so it rides along on the array and the writer
  // puts it back -- the prop-list writer's rule made safe rather than
  // written down.
  out.tail = data.slice(out.length * DELV_CHAR_RECORD);
  return out;
}
// True where a record is in use at all: an unused slot is 32 zero bytes, and
// a slot that is only a zone byte (the tail of the shipped table) is not a
// character either.
function delverCharacterInUse(r) { return !!(r && (r.proptype || r.healthMax || r.body)); }
function writeDelverCharacterRecords(records) {
  const tail = records.tail || new Uint8Array(0);
  const out = new Uint8Array(records.length * DELV_CHAR_RECORD + tail.length);
  out.set(tail, records.length * DELV_CHAR_RECORD);
  for (let i = 0; i < records.length; i++) {
    const r = records[i], p = i * DELV_CHAR_RECORD;
    out.set(r.raw, p);
    out[p] = r.zone & 0xFF;
    const xy = ((r.x & 0xFFF) << 12) | (r.y & 0xFFF);
    out[p+1] = (xy >> 16) & 0xFF; out[p+2] = (xy >> 8) & 0xFF; out[p+3] = xy & 0xFF;
    const ap = ((r.aspect & 0x3F) << 10) | (r.proptype & 0x3FF);
    out[p+4] = (ap >> 8) & 0xFF; out[p+5] = ap & 0xFF;
    out[p+8] = r.state & 0xFF;
    out[p+9] = r.body & 0xFF; out[p+10] = r.reflex & 0xFF; out[p+11] = r.mind & 0xFF;
    out[p+12] = (r.xp >> 8) & 0xFF; out[p+13] = r.xp & 0xFF;
    out[p+14] = r.health & 0xFF; out[p+15] = r.healthMax & 0xFF;
    out[p+16] = r.magic & 0xFF; out[p+17] = r.magicMax & 0xFF;
    out[p+18] = r.party & 0xFF;
    out[p+19] = r.level & 0xFF;
    out[p+27] = r.nutrition & 0xFF; out[p+28] = r.training & 0xFF;
  }
  return out;
}

function writeDelverPropList(records) {
  const out = new Uint8Array(records.length * 16);
  for (let i = 0; i < records.length; i++) {
    const r = records[i], p = i * 16;
    out[p] = r.flags & 0xFF;
    const raw = ((r.x & 0xFFF) << 12) | (r.y & 0xFFF);
    out[p+1] = (raw >> 16) & 0xFF; out[p+2] = (raw >> 8) & 0xFF; out[p+3] = raw & 0xFF;
    const aw = (((r.aspect & 0x1F) | (r.rotated ? 0x20 : 0)) << 10) | (r.proptype & 0x3FF);
    out[p+4] = (aw >> 8) & 0xFF; out[p+5] = aw & 0xFF;
    out[p+6] = (r.d3 >> 8) & 0xFF; out[p+7] = r.d3 & 0xFF;
    out[p+8] = (r.storeref >> 8) & 0xFF; out[p+9] = r.storeref & 0xFF;
    for (let k = 0; k < 6; k++) out[p+10+k] = parseInt(r.tail.substr(k*2, 2), 16) || 0;
  }
  return out;
}
