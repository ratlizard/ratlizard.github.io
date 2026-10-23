// The packed player on a Board, checked as far as a desktop browser can.
// Boots the bundle (board/dist, from pack.sh) in headless Chrome at the
// panel's 1920x1080 with a stand-in for the Board's bridge, so the SDK reports
// isOnDevice, and checks three things:
//
//   touch     finger frames played into the SDK's touch channel the way the
//             Board sends them, with no pointer events from the browser,
//             start the game, open and close the menu and reach the canvas;
//   keyboard  the Type button shows the drawn keyboard, its keys reach the
//             page's typing path, and the hidden input is never focused;
//   saves     a real character written to the browser store is copied to a
//             Board save; with the browser store emptied, a reload writes it
//             back before Play, byte for byte; deleting it in the Saves panel
//             removes the Board save, and nothing else.
//
// The stand-in's saves are kept in localStorage, so they outlive a reload as
// the Board's would. A tap on an empty part of the bar must open nothing, and
// the emptied store must not remove any Board save; those are the runs where
// the check can fail.
//
// Usage: node board_check.mjs        (after ./pack.sh)
//   CHARACTER  a saved character as data.fork, resource.fork and
//              metadata.json (default: the playthrough kit's s-base)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHARACTER = process.env.CHARACTER || join(process.env.HOME, 'e-z-g-cythera/playthrough-2026-09-08/saves/s-base');
for (const p of [CHROME, join(dist, 'index.html'), join(dist, 'cythera_web.wasm'), join(CHARACTER, 'data.fork')])
  if (!existsSync(p)) { console.log(`skip: ${p} is not here`); process.exit(0); }

const PORT = 8751, CDP = 9351, W = 1920, H = 1080;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dist, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', `cw-board-check-${process.pid}`),
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const stop = () => { browser.kill('SIGKILL'); server.kill('SIGKILL'); };
process.on('exit', stop);

const waitFor = async (fn, what, ms = 180000, every = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null); if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
};
const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json())
  .find(t => t.type === 'page' && t.webSocketDebuggerUrl), 'chrome', 30000, 100);
await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok, 'the server', 20000, 100);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('websocket: ' + e.message)); });
let seq = 0; const pending = new Map(); const thrown = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') thrown.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (!m.id || !pending.has(m.id)) return;
  const [res, rej] = pending.get(m.id); pending.delete(m.id);
  m.error ? rej(new Error(m.error.message)) : res(m.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params }));
});
const run = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// The stand-in bridge: the calls board.js makes, a touch channel for frames
// in the SDK's JSON form ({c: [{id, x, y, o, t, p, g, touched}]}), and a save
// system in localStorage. The Board sends a contact only when it changes,
// Began 1, Moved 2, Ended 3, and answers an async call with a request number
// at once and the result later, through window.__board.resolve.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const S = () => JSON.parse(localStorage.getItem('__standin') || '{"n":0,"saves":{}}');
  const keep = s => localStorage.setItem('__standin', JSON.stringify(s));
  let req = 0;
  const answer = (v, ms = 5) => { const id = ++req; setTimeout(() => window.__board.resolve(id, JSON.stringify(v)), ms); return id; };
  const meta = (id, s) => ({ id, description: s.description, createdAt: 0, updatedAt: 0, playedTime: 0,
    fileSize: s.data.length, gameVersion: s.v, playerCount: 1, hasCoverImage: false, players: [] });
  window.BoardSDK = { setPauseContext() {}, updatePauseContext() {}, clearPauseContext() {},
    getPauseResult() { return 'null'; }, quit() {}, isReady() { return true; }, areServicesReady() { return true; },
    getMaxSaveDataSize() { return 4e6; }, getMaxSaveDescriptionLength() { return 64; },
    createSave(d, data, t, v) { const s = S(); const id = 'save' + (++s.n); s.saves[id] = { description: d, data, v }; keep(s); return answer(meta(id, s.saves[id])); },
    updateSave(id, d, data, t, v) { const s = S(); s.saves[id] = { description: d, data, v }; keep(s); return answer(null); },
    loadSave(id) { return answer({ data: S().saves[id].data }); },
    // Slow on purpose after the reload (__slowList): Play is pressed before
    // the list is answered, so a Play that does not wait for the restore
    // boots without the saves.
    listSaves() { return answer(Object.entries(S().saves).map(([id, s]) => meta(id, s)),
      Number(localStorage.getItem('__slowList') || 5)); },
    removePlayersFromSave(id) { const s = S(); delete s.saves[id]; keep(s); return answer(null); } };
  window.__standinSaves = () => Object.values(S().saves).map(s => s.description);
  window.boardTouch = { onmessage: null, postMessage(m) { window.__touchChannel = m; } };
  window.__frame = cs => window.boardTouch.onmessage({ data: JSON.stringify({ c: cs.map(c =>
    ({ id: c.id, x: c.x, y: c.y, o: 0, t: 0, p: c.p, g: 0, touched: 1 })) }) });
  window.__canvasDowns = 0;
  addEventListener('DOMContentLoaded', () => { const c = document.querySelector('canvas');
    if (c) c.addEventListener('pointerdown', () => window.__canvasDowns++); });
` });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, screenWidth: W, screenHeight: H, deviceScaleFactor: 1, mobile: true });
const open = async () => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');
};

let failures = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = what => console.log(`  ok   ${what}`);
const check = (good, what, why) => good ? ok(what) : fail(what, why);

let nextId = 1;
// A finger held for 250 ms: down, a still frame after the adapter's wait, up.
const tap = async (x, y) => {
  const id = nextId++;
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 1 }])`); await sleep(250);
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 2 }])`); await sleep(50);
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 3 }])`); await sleep(150);
};
const centre = el => run(`(() => { const r = (${el}).getBoundingClientRect();
  return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
const tapOn = async sel => tap(...await centre(`document.querySelector(${JSON.stringify(sel)})`));
const tapKey = async label => tap(...await centre(`[...document.querySelectorAll('#keys .k')].find(k => k.textContent === ${JSON.stringify(label)})`));
const shown = sel => run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden; })()`);
const probeFact = k => run(`window.__boardFacts?.[${JSON.stringify(k)}]`);

// ---- touch -----------------------------------------------------------------
await open();
check(await run(`window.__touchChannel`) === 'subscribe', 'the SDK took the stand-in for a Board and subscribed to touch', 'no subscribe');
await tapOn('#play');
try { await waitFor(() => run(`document.body.classList.contains('playing')`), 'play to start', 60000); ok('a finger on Play starts the game'); }
catch (e) { fail('a finger on Play', e.message); }
// The game is the stage's size, drawn one to one (board.js boardScreen): the
// page alone would make it 480 high and scale it up.
const size = await run(`(() => { const c = document.getElementById('screen'), r = c.getBoundingClientRect(), s = document.getElementById('stage');
  return [c.width, c.height, Math.round(r.width * devicePixelRatio), Math.round(r.height * devicePixelRatio), s.clientWidth, s.clientHeight]; })()`);
check(size[0] === size[4] && size[1] === size[5] && size[0] === size[2] && size[1] === size[3],
  `the game is the stage's ${size[4]}x${size[5]}, drawn one to one`, `the game ${size[0]}x${size[1]}, drawn at ${size[2]}x${size[3]}, stage ${size[4]}x${size[5]}`);
check(await run(`!document.getElementById('boardprobe')`), 'a build without REMOTE puts no probe box on the page', 'the box is there');
// Cythera's bottom panels start at about 934 px of the panel's 1080.
const padBottoms = await run(`[...document.querySelectorAll('#move, #act')].map(p => Math.round(p.getBoundingClientRect().bottom))`);
check(padBottoms.length === 2 && padBottoms.every(b => b > 0 && b <= 925), 'the pads end above the game\'s bottom panels', padBottoms.join(','));
const how = await probeFact('touch');
check(how === 'replayed from Board.input', 'the adapter settled on replaying fingers', String(how));
await tap(W - 40, 20);
check(!await shown('#menupanel'), 'a finger on an empty part of the bar opens nothing', 'the menu panel opened');
await tapOn('#menubtn');
check(await shown('#menupanel'), 'a finger on Menu opens its panel', 'the panel did not open');
await tapOn('#menuclose');
check(!await shown('#menupanel'), 'a finger on Close shuts it', 'the panel stayed open');
const before = await run(`__canvasDowns`);
await tapOn('canvas');
check(await run(`__canvasDowns`) > before, 'a finger on the game reaches the canvas', 'no pointerdown reached the canvas');

// ---- keyboard --------------------------------------------------------------
await run(`window.__typed = []; { const real = typeChar; typeChar = ch => { __typed.push(ch); real(ch); }; }
  document.getElementById('kb').addEventListener('keydown', e => __typed.push('<' + e.key + '>'))`);
check(!await shown('#keys'), 'the keyboard is hidden until Type is pressed', 'it was showing');
await tapOn('#kbtoggle');
check(await shown('#keys'), 'Type shows the keyboard', 'it did not appear');
const kbox = await run(`(() => { const r = document.getElementById('keys').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()`);
check(kbox[0] >= 0 && kbox[1] >= 0 && kbox[2] <= W && kbox[3] <= H, 'the keyboard is on the screen', kbox.join(','));
{ const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dist, 'keyboard.png'), Buffer.from(data, 'base64')); }
for (const k of ['⇧', 'a', 'b', 'space', '⌫', 'Return']) await tapKey(k);
const typed = await run(`__typed.join('|')`);
check(typed === 'A|b| |<Backspace>|<Enter>', 'Shift a b space Backspace Return reach the page as A, b, space and the two keys', typed);
check(await run(`document.activeElement !== document.getElementById('kb')`), 'the hidden input is never focused, so no system keyboard opens', 'it was focused');
await tapKey('Hide');
check(!await shown('#keys'), 'Hide puts the keyboard away', 'it is still showing');

// ---- saves -----------------------------------------------------------------
const NAME = 'BoardCheck01';
const md = JSON.parse(readFileSync(join(CHARACTER, 'metadata.json'), 'utf8'));
const b64 = f => readFileSync(join(CHARACTER, f)).toString('base64');
const sum = `(u8 => { let h = 0; for (const b of u8) h = (h * 31 + b) >>> 0; return u8.length + ':' + h; })`;
const expected = await run(`(${sum})(Uint8Array.from(atob(${JSON.stringify(b64('data.fork'))}), c => c.charCodeAt(0)))`);
await run(`putSave({ path: gameFolder() + ${JSON.stringify(NAME)}, type: ${md.file_type}, creator: ${md.creator},
  flags: ${md.finder_flags}, created: ${md.created_date}, modified: ${md.modified_date},
  data: Uint8Array.from(atob(${JSON.stringify(b64('data.fork'))}), c => c.charCodeAt(0)),
  rsrc: Uint8Array.from(atob(${JSON.stringify(b64('resource.fork'))}), c => c.charCodeAt(0)), savedAt: Date.now() })`);
try {
  await waitFor(() => run(`__standinSaves().includes(${JSON.stringify(NAME)})`), 'the Board save', 25000, 500);
  ok(`a character in the browser store is copied to a Board save named ${NAME}`);
} catch (e) { fail('the copy to the Board', e.message); }
// The game writes other files while it runs, and each record in the browser
// store is copied to a separate Board save, so the count is read once the
// number of Board saves matches the number of records.
const records = () => run(`new Promise(res => { const r = indexedDB.open('cythera-saves'); r.onsuccess = () => {
  const g = r.result.transaction('files').objectStore('files').count(); g.onsuccess = () => { r.result.close(); res(g.result); }; }; })`);
const boardCount = await waitFor(async () => {
  const n = await records(); return n && (await run(`__standinSaves()`)).length === n && n; }, 'a Board save for every record', 30000, 1000)
  .catch(e => { fail('a Board save for every record', e.message); return 0; });

// Empty the browser store from another page of the same site, with no
// connection open to it, then reload with the Board's save list slowed past
// the moment Play is pressed.
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/delv/README.md` }); await sleep(800);
await run(`new Promise((res, rej) => { const r = indexedDB.deleteDatabase('cythera-saves'); r.onsuccess = res; r.onerror = rej; r.onblocked = () => rej(new Error('blocked')); })`);
await run(`localStorage.setItem('__slowList', '30000')`);
await open();
await run(`localStorage.removeItem('__slowList')`);
check(await probeFact('saves') === undefined, 'Play is pressed while the Board is still answering', String(await probeFact('saves')));
await tapOn('#play');
const restoredFact = await waitFor(() => probeFact('saves'), 'the restore', 45000).catch(e => e.message);
check(restoredFact === `${boardCount} on the Board, ${boardCount} written back to the browser`, 'with the browser store emptied, every Board save is written back', restoredFact);
const back = await run(`new Promise(res => { const r = indexedDB.open('cythera-saves'); r.onsuccess = () => {
  const g = r.result.transaction('files').objectStore('files').getAll(); g.onsuccess = () => {
  const rec = g.result.find(x => x.path.endsWith('/' + ${JSON.stringify(NAME)})); r.result.close();
  res(rec ? (${sum})(rec.data) : null); }; }; })`);
check(back === expected, `${NAME} is back in the browser store byte for byte`, `${back} against ${expected}`);
await waitFor(() => run(`document.body.classList.contains('playing')`), 'play to start', 60000).catch(() => {});
const bootLine = await run(`(document.getElementById('log').textContent.match(/(\\d+) save file\\(s\\) restored/) || [])[1]`);
check(Number(bootLine) === boardCount, `Play waited for the restore: the game booted with all ${boardCount} files on its disk`, `the boot line has ${bootLine}`);
await sleep(12000);
check((await run(`__standinSaves()`)).length === boardCount, 'the emptied browser store removed no Board save', `${(await run(`__standinSaves()`)).length} left of ${boardCount}`);

await run(`listSaves().then(rs => { const rec = rs.find(r => r.path.endsWith('/' + ${JSON.stringify(NAME)})); return rec && deleteSave(rec); })`);
try {
  await waitFor(() => run(`!__standinSaves().includes(${JSON.stringify(NAME)})`), 'the Board save to go', 25000, 500);
  ok(`deleting ${NAME} in the Saves panel removes its Board save`);
} catch (e) { fail('a delete reaching the Board', e.message); }
check((await run(`__standinSaves()`)).length === boardCount - 1, 'and no other Board save', `${(await run(`__standinSaves()`)).length} left`);

check(!thrown.length, 'nothing threw', thrown.slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} failure(s)` : '\nboard ok');
stop();
process.exit(failures ? 1 : 0);
