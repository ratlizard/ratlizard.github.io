// Cythera's saves, in the Board's save system as well as the browser.
//
// Every file the game writes is stored by the player in IndexedDB (database
// cythera-saves, store files), one record per file. The Board's documentation
// does not cover whether IndexedDB survives from one launch to the next, so
// each record is also copied to a separate Board save, described by the
// file's name. At launch, before Play can start the game, any record that is
// missing from the browser, or older there, is written back from the Board's
// saves.
//
// A Board save is removed only for a record that was in the browser during
// this launch and was then deleted from the Saves panel. A record missing at
// launch is restored, never read as deleted, so an emptied browser store
// cannot empty the Board's saves.

const DB = "cythera-saves";
const STORE = "files";
const EVERY = 10000; // ms between copies; the page stores the game's writes every 2 s
const MAGIC = 0x53425943; // "CYBS", little-endian, at the start of every payload
const VERSION = "1";

// The store and its version are the page's. It is opened here at whatever
// version exists, and created only on a fresh install restoring from the
// Board before the page has opened it.
function openDb(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("game", "game");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Closed at once when the page opens a newer version, so its upgrade goes ahead.
      db.onversionchange = () => db.close();
      if (db.objectStoreNames.contains(STORE)) return resolve(db);
      const next = db.version + 1;
      db.close();
      openDb(next).then(resolve, reject);
    };
    req.onerror = () => reject(req.error);
  });
}
async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && out.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const allRecords = () => withStore("readonly", (st) => st.getAll());
const putRecord = (rec) => withStore("readwrite", (st) => st.put(rec));

// A payload: MAGIC, the header's length, the record's fields other than its
// forks as JSON, then the data fork and the resource fork.
export function encode(rec) {
  const { data, rsrc, ...fields } = rec;
  const head = new TextEncoder().encode(JSON.stringify({ ...fields, dataLen: data.length, rsrcLen: rsrc.length }));
  const out = new Uint8Array(8 + head.length + data.length + rsrc.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, head.length, true);
  out.set(head, 8);
  out.set(data, 8 + head.length);
  out.set(rsrc, 8 + head.length + data.length);
  return out;
}
export function decode(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || dv.getUint32(0, true) !== MAGIC) return null;
  const n = dv.getUint32(4, true);
  const { dataLen, rsrcLen, ...rec } = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
  rec.data = bytes.slice(8 + n, 8 + n + dataLen);
  rec.rsrc = bytes.slice(8 + n + dataLen, 8 + n + dataLen + rsrcLen);
  return rec;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startSaveMirror(save, session, report) {
  const mirrored = new Map(); // record key -> { id, savedAt } of its Board save
  const present = new Set(); // record keys seen in the browser during this launch
  let restoring = true;

  const restored = (async () => {
    for (let i = 0; i < 50 && !session.areServicesReady(); i++) await sleep(200);
    const have = new Map((await allRecords()).map((r) => [r.key, r]));
    let written = 0;
    for (const meta of await save.list()) {
      let rec = null;
      try { rec = decode(await save.load(meta.id)); } catch (e) { report("saves", `could not read ${meta.description}: ${e.message}`); }
      if (!rec || !rec.key) continue;
      mirrored.set(rec.key, { id: meta.id, savedAt: rec.savedAt });
      const mine = have.get(rec.key);
      if (!mine || (mine.savedAt || 0) < (rec.savedAt || 0)) {
        await putRecord(rec);
        written++;
      }
    }
    report("saves", `${mirrored.size} on the Board, ${written} written back to the browser`);
  })().catch((e) => report("saves", "restore failed: " + e.message))
    .finally(() => { restoring = false; });

  // Play waits for the restore, because the page reads the store once, when
  // the game loads, and a record written after that is not on the game's disk.
  const play = document.getElementById("play");
  let queued = false;
  addEventListener("click", (e) => {
    if (!restoring || e.target !== play) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (!queued) { queued = true; restored.then(() => play.click()); }
  }, { capture: true });

  async function copy() {
    await restored;
    const maxData = save.getMaxDataSize();
    const maxName = save.getMaxDescriptionLength();
    const now = new Set();
    for (const rec of await allRecords()) {
      now.add(rec.key);
      present.add(rec.key);
      const m = mirrored.get(rec.key);
      if (m && m.savedAt === rec.savedAt) continue;
      const bytes = encode(rec);
      const name = rec.path.split("/").pop().slice(0, maxName);
      if (bytes.length > maxData) {
        report("saves", `${name} is ${bytes.length} bytes, over the Board's ${maxData}; not copied`);
        continue;
      }
      if (m) {
        await save.update(m.id, name, bytes, 0, VERSION);
        m.savedAt = rec.savedAt;
      } else {
        const meta = await save.create(name, bytes, 0, VERSION);
        mirrored.set(rec.key, { id: meta.id, savedAt: rec.savedAt });
      }
    }
    for (const key of [...present]) {
      if (now.has(key)) continue;
      present.delete(key);
      const m = mirrored.get(key);
      if (m) { await save.removePlayersFromSave(m.id); mirrored.delete(key); }
    }
  }

  // One copy at a time. A call made during a copy waits for it and then runs
  // again, so a quit copies everything in the store at the moment Quit was chosen.
  let running = null;
  function flush() {
    const after = running || Promise.resolve();
    const next = after.then(copy).catch((e) => report("saves", "copy failed: " + e.message));
    running = next.finally(() => { if (running === next) running = null; });
    return next;
  }
  setInterval(flush, EVERY);
  return { flush, restored };
}
