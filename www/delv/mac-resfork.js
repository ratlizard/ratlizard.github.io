/* mac-resfork.js — reading a classic Mac resource fork.
 *
 * Needs mac-bytes.js. Load it first.
 *
 * A resource fork is a data area, a map, and a type list that indexes into
 * both. Every structural offset here is validated before it is followed, for
 * two reasons that both turned out to matter: a fork whose map is truncated or
 * garbage should say so rather than list invented resources, and callers use
 * "does this parse?" as a format sniff, so a parser that accepts anything makes
 * the sniff useless.
 *
 * openResourceFork(bytes) returns a fork object rather than setting globals, so
 * two forks can be open at once -- which is the point of putting it here.
 * index.html holds the Cythera Data *data* fork open as the game archive and
 * its *resource* fork at the same time, and the application's fork beside them.
 */

const RESOURCE_ATTRS = [
  [0x40, 'system heap'], [0x20, 'purgeable'], [0x10, 'locked'],
  [0x08, 'protected'], [0x04, 'preload'], [0x02, 'changed']
];

function resourceAttrNames(a) {
  return RESOURCE_ATTRS.filter(([bit]) => a & bit).map(([, name]) => name);
}

function openResourceFork(bytes) {
  const inRange = (off, len, what) => {
    if (!(off >= 0) || off + len > bytes.length)
      throw new Error(`${what} runs past the end of the fork (offset ${off}, ${len} bytes, file is ${bytes.length})`);
  };
  if (bytes.length < 286) throw new Error('too small to be a resource fork (header + map need 286 bytes)');

  const dataOff = u32be(bytes, 0);
  const mapOff = u32be(bytes, 4);
  const dataLen = u32be(bytes, 8);
  const mapLen = u32be(bytes, 12);
  inRange(mapOff, 30, 'resource map');
  inRange(dataOff, 0, 'resource data area');

  const typeListOffRel = u16be(bytes, mapOff + 24);
  const nameListOffRel = u16be(bytes, mapOff + 26);
  const typeListAbs = mapOff + typeListOffRel;
  inRange(typeListAbs, 2, 'type list');
  const numTypes = u16be(bytes, typeListAbs) + 1;
  inRange(typeListAbs + 2, numTypes * 8, `type list (${numTypes} types)`);

  const typeList = [];
  let pos = typeListAbs + 2;
  for (let i = 0; i < numTypes; i++) {
    const rtype = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
    typeList.push({ type: rtype, count: u16be(bytes, pos + 4) + 1, refListOff: u16be(bytes, pos + 6) });
    pos += 8;
  }

  const nameListAbs = mapOff + nameListOffRel;
  const resourcesByType = {};
  for (const t of typeList) {
    const refListAbs = typeListAbs + t.refListOff;
    inRange(refListAbs, t.count * 12, `reference list for '${t.type}'`);
    const list = [];
    let rp = refListAbs;
    for (let i = 0; i < t.count; i++) {
      // Resource IDs are signed; system resources use negative ones, and
      // reading them unsigned listed SIZE #-1 as #65535.
      const id = i16be(bytes, rp);
      const nameOffSigned = i16be(bytes, rp + 2);   // -1 when unnamed
      const attrsAndDataOff = u32be(bytes, rp + 4);
      const attrs = (attrsAndDataOff >>> 24) & 0xFF;
      const dataOffRel = attrsAndDataOff & 0xFFFFFF;
      let name = null;
      if (nameOffSigned !== -1) {
        const nAbs = nameListAbs + nameOffSigned;
        // A bad name offset should cost one name, not the whole fork.
        if (nAbs >= 0 && nAbs < bytes.length) {
          const nLen = Math.min(bytes[nAbs], bytes.length - nAbs - 1);
          name = decodeMacRoman(bytes.subarray(nAbs + 1, nAbs + 1 + nLen));
        }
      }
      // The four bytes after the offset are the Resource Manager's in-memory
      // handle. They are meaningless in a file and nothing here reads them --
      // but Cythera's application fork has live ones in it, so a rewrite that
      // zeroed them would not come back byte-identical, and the writer below
      // carries them through. See its header on the four junk fields.
      list.push({ id, name, attrs, dataOffRel, nameOff: nameOffSigned, handle: u32be(bytes, rp + 8) });
      rp += 12;
    }
    resourcesByType[t.type] = list;
  }

  // Slicing every resource of a type on every keystroke was the single biggest
  // cost in the browser's list render; a fork never changes while it is open,
  // so each payload is sliced once and kept.
  const cache = new Map();

  const fork = {
    bytes, dataOff, mapOff, dataLen, mapLen, typeList, resourcesByType,

    // Reading a length costs nothing; copying the bytes does. A list only needs
    // sizes, so it asks for this and never touches the payload.
    sizeOf(type, entry) {
      const abs = dataOff + entry.dataOffRel;
      if (abs + 4 > bytes.length)
        throw new Error(`data offset ${abs} is past the end of the fork (${bytes.length} bytes)`);
      const len = u32be(bytes, abs);
      // slice() clamps, so without this an overlong length silently yields a
      // short buffer and the decoders report a corrupt resource instead of a
      // corrupt map.
      if (abs + 4 + len > bytes.length)
        throw new Error(`declares ${len.toLocaleString()} bytes but only ${(bytes.length - abs - 4).toLocaleString()} remain in the fork`);
      return len;
    },

    dataOf(type, entry) {
      const key = type + '\u0000' + entry.id;   // NUL: type names can contain spaces
      const hit = cache.get(key);
      if (hit) return hit;
      const abs = dataOff + entry.dataOffRel;
      const d = bytes.slice(abs + 4, abs + 4 + fork.sizeOf(type, entry));
      cache.set(key, d);
      return d;
    },

    // Every resource, in type order, for a caller that wants to sweep the fork.
    all() {
      const out = [];
      for (const t of typeList) for (const e of resourcesByType[t.type]) out.push({ type: t.type, entry: e });
      return out;
    },

    total() {
      let n = 0;
      for (const k in resourcesByType) n += resourcesByType[k].length;
      return n;
    }
  };
  return fork;
}

/* ---- writing a resource fork ---------------------------------------------
 *
 * The reader above has been here since the beginning; this is new, and it is
 * the piece that was standing between this repository and three things it
 * wanted. Putting another TrueType in place of the game's `sfnt` needs it
 * (the styles name the family, not the file). Building Cythera's preferences
 * file needs it, which is what turns the cheat keys from a thing that is
 * documented into a thing a visitor can switch on: the code `©gra` is refused
 * unless bit 0 of byte 3 of `'Pref'` 130 is set, and nothing in the game ever
 * sets it. And a fork is simply the other half of a Mac file, which this site
 * can otherwise only take apart.
 *
 * THE LAYOUT IS THE RESOURCE MANAGER'S OWN, and it is worth saying how it was
 * settled rather than guessed. Both of Cythera's forks were measured before a
 * line of this was written: the data area starts at 256 in each, every
 * resource sits flush against the one before it (450 gaps between resources
 * across the two files, every one of them zero -- no padding, no alignment),
 * the type list begins 28 bytes into the map, the name list follows the
 * reference lists, and the map's attribute word is zero. So this writes
 * exactly that, and `utilities/resfork_write_check.mjs` proves it by handing
 * each of the game's forks back through and requiring the bytes to come out
 * the same.
 *
 * FOUR FIELDS ARE JUNK, AND THEY ARE JUNK ON PURPOSE. The 240 bytes after the
 * header (112 for the system, 128 for the application), the 16 bytes at the
 * head of the map that are meant to be a copy of the header, the next-map
 * handle and the file reference number are all *memory* in a file: whatever
 * happened to be in the Resource Manager's structures when it wrote. In
 * Cythera's two forks they hold nonsense -- `121461076` for a handle -- and
 * they are where the installer's copy of the game and the BinHex copy differ
 * and nowhere else. A fork this writes fresh zeroes them, which is what a
 * clean writer should do; a fork being rewritten passes its own back through
 * `opts` so the round trip is exact. Neither the Resource Manager nor anything
 * else reads them.
 *
 * The spec is a plain array, so a caller building a fork from nothing writes
 * an array literal and never sees an offset:
 *
 *     writeResourceFork([{ type: 'Pref', id: 130, name: 'UI Prefs',
 *                          data: new Uint8Array([0x9A, 0x80, 0x00, 0x01]) }])
 *
 * `resourceForkSpec(fork)` turns an opened fork back into that array, in the
 * order its data area actually has rather than in type order -- the two are
 * the same in Cythera's forks and there is no reason to assume it in general.
 */
function resourceForkSpec(fork) {
  const out = [];
  for (const t of fork.typeList)
    for (const e of fork.resourcesByType[t.type])
      out.push({ type: t.type, id: e.id, name: e.name, attrs: e.attrs, handle: e.handle,
                 data: fork.dataOf(t.type, e), dataOffRel: e.dataOffRel, nameOff: e.nameOff });
  /* The array is the MAP's order -- types as the type list has them, and
     within a type the reference list's order. `dataOffRel` on each resource
     is where its bytes actually sit, which is a third order again: in Cythera
     Data two `eSTM` resources are listed one way in the map and the other way
     in the data area, and a writer that assumed one order for both swapped
     their attribute bytes. Three orders, all of them real, none derivable
     from the others. */
  return {
    resources: out,
    typeOrder: fork.typeList.map(t => t.type),
    reserved: fork.bytes.slice(16, 256),
    mapPreamble: fork.bytes.slice(fork.mapOff, fork.mapOff + 24)
  };
}

function writeResourceFork(resources, opts) {
  opts = opts || {};
  const list = Array.isArray(resources) ? resources : resources.resources;
  if (!Array.isArray(list)) throw new Error('writeResourceFork wants an array of resources');
  const reserved = opts.reserved || (resources && resources.reserved) || null;
  const preamble = opts.mapPreamble || (resources && resources.mapPreamble) || null;
  const wantedTypes = opts.typeOrder || (resources && resources.typeOrder) || null;

  /* Two orders, and they are not the same one. The DATA AREA is written in the
     order the array gives, because that is the order a rewrite has to keep.
     The TYPE LIST is written in `typeOrder` when a caller supplies one and in
     first-appearance order otherwise -- Cythera Data's map lists `LINF`
     second and its data area starts with `eBRS`, so a writer that inferred
     one from the other could not reproduce the file it had just read.
     Within a type the resources keep the order they were handed in. */
  const types = [];
  const byType = new Map();
  for (const r of list) {
    if (!/^.{4}$/.test(r.type)) throw new Error('a resource type must be four characters, not "' + r.type + '"');
    if (!byType.has(r.type)) { byType.set(r.type, []); types.push(r.type); }
    byType.get(r.type).push(r);
  }
  if (wantedTypes) {
    const known = new Set(types);
    for (const t of wantedTypes) if (!known.has(t)) throw new Error("typeOrder names '" + t + "', which no resource has");
    if (wantedTypes.length !== types.length) throw new Error('typeOrder names ' + wantedTypes.length + ' types but the resources have ' + types.length);
    types.length = 0;
    for (const t of wantedTypes) types.push(t);
  }
  if (!types.length) throw new Error('a resource fork needs at least one resource');
  for (const t of types) if (byType.get(t).length > 65536)
    throw new Error("more than 65,536 resources of type '" + t + "'");

  /* The data area is written in `dataOffRel` order when every resource says
     where it came from -- which is what a rewrite of an existing fork
     supplies -- and in array order otherwise, which is what a fork built from
     nothing wants. The map is written in array order either way. */
  const placed = list.every(r => typeof r.dataOffRel === 'number')
    ? list.slice().sort((a, b) => a.dataOffRel - b.dataOffRel) : list;
  let dataLen = 0;
  for (const r of list) dataLen += 4 + (r.data ? r.data.length : 0);
  const dataOff = 256;

  // ---- the map's shape, worked out before anything is written -------------
  // 24 bytes of preamble, 2 type-list offset, 2 name-list offset, then the
  // type list (2 + 8 per type), then a 12-byte reference for every resource,
  // then the names.
  const typeListOff = 28;
  const refListsOff = typeListOff + 2 + types.length * 8;
  const nameListOff = refListsOff + list.length * 12;
  /* Every named resource gets its OWN entry in the name list, even where two
     share a name -- the Resource Manager does not pool them, and this is the
     one thing about the layout that had to be measured rather than reasoned
     out. Sharing them made this writer's output 19 bytes short on Cythera Data
     and 38 short on Cythera, and both numbers turned out to be exactly the
     duplicated names: "TxSt" and "ArgosANouveau" in the one, "-Reg Error",
     "-Main dialog text" and "-30 days" in the other. Everything before the
     name list was already byte-identical, so the arithmetic named the bug.
     The names are written in reference-list order, which is the order the map
     is walked in and therefore the order they land in. */
  const nameOf = r => (r.name === null || r.name === undefined || r.name === '') ? null : r.name;
  const named = list.filter(r => nameOf(r) !== null);
  const macOf = r => encodeMacRoman(nameOf(r)).slice(0, 255);
  /* A FOURTH order. Where a resource says which offset its name had, the name
     goes back there; Cythera Data's name list is not in reference-list order
     and writing it that way moved two `eSTM` names eight bytes and nothing
     else. A fork built from nothing has no such offsets and the names are
     simply laid down one after another as the map is walked. */
  const keepNameOffs = named.length > 0 && named.every(r => typeof r.nameOff === 'number' && r.nameOff >= 0);
  let nameBytes = 0;
  if (keepNameOffs) for (const r of named) nameBytes = Math.max(nameBytes, r.nameOff + 1 + macOf(r).length);
  else for (const r of named) nameBytes += 1 + macOf(r).length;
  const mapLen = nameListOff + nameBytes;
  // The map's fields are 24 bits for a data offset and 16 for a name or type
  // offset. Masking silently past them wrote a fork that read as another
  // fork, so a size the format cannot hold is refused instead.
  if (dataLen > 0xFFFFFF) throw new Error('a resource fork holds at most 16 MB of resource data, not ' + dataLen + ' bytes');
  if (mapLen > 0xFFFF) throw new Error('a resource map is at most 64 KB, not ' + mapLen + ' bytes');
  const out = new Uint8Array(dataOff + dataLen + mapLen);

  const put32 = (at, v) => { out[at] = (v >>> 24) & 0xFF; out[at + 1] = (v >>> 16) & 0xFF; out[at + 2] = (v >>> 8) & 0xFF; out[at + 3] = v & 0xFF; };
  const put16 = (at, v) => { out[at] = (v >>> 8) & 0xFF; out[at + 1] = v & 0xFF; };

  const mapOff = dataOff + dataLen;
  put32(0, dataOff); put32(4, mapOff); put32(8, dataLen); put32(12, mapLen);
  if (reserved && reserved.length === 240) out.set(reserved, 16);

  // ---- the resources themselves -------------------------------------------
  let at = dataOff;
  const relOf = new Map();
  for (const r of placed) {
    relOf.set(r, at - dataOff);
    const d = r.data || new Uint8Array(0);
    put32(at, d.length);
    out.set(d, at + 4);
    at += 4 + d.length;
  }

  // ---- the map -------------------------------------------------------------
  if (preamble && preamble.length === 24) out.set(preamble, mapOff);
  put16(mapOff + 24, typeListOff);
  put16(mapOff + 26, nameListOff);
  put16(mapOff + typeListOff, types.length - 1);
  let tp = mapOff + typeListOff + 2;
  let rp = mapOff + refListsOff;
  let nameAt = 0;
  for (const t of types) {
    const rs = byType.get(t);
    const mac = encodeMacRoman(t);
    for (let i = 0; i < 4; i++) out[tp + i] = mac[i] === undefined ? 0x20 : mac[i];
    put16(tp + 4, rs.length - 1);
    // The reference-list offset is measured from the start of the TYPE LIST,
    // not from the start of the map -- an off-by-28 here reads as a fork whose
    // every resource is 28 bytes into the one before it, which is exactly what
    // the first draft of this did.
    put16(tp + 6, (rp - mapOff) - typeListOff);
    tp += 8;
    for (const r of rs) {
      const id = r.id | 0;
      put16(rp, id < 0 ? id + 0x10000 : id);
      const nm = nameOf(r);
      if (nm !== null) {
        const mac = macOf(r);
        const off = keepNameOffs ? r.nameOff : nameAt;
        const nAt = mapOff + nameListOff + off;
        out[nAt] = mac.length;
        out.set(mac, nAt + 1);
        put16(rp + 2, off);
        if (!keepNameOffs) nameAt += 1 + mac.length;
      } else put16(rp + 2, 0xFFFF);
      put32(rp + 4, (((r.attrs || 0) & 0xFF) << 24) | (relOf.get(r) & 0xFFFFFF));
      put32(rp + 8, r.handle || 0);   // the in-memory handle: zero unless carried
      rp += 12;
    }
  }
  return out;
}
