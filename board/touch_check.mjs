// Does a finger on the Board work the player when its browser gives the page
// no pointer events? Boots the packed bundle (board/dist, from pack.sh) in
// headless Chrome at the panel's 1920x1080 with a stand-in for the Board's
// bridge, so the SDK reports isOnDevice, then plays finger frames into the
// SDK's touch channel the way the Board does and checks that the player
// answers: Play starts the game, Menu opens and closes its panel, a tap on the
// game reaches the canvas, and nothing throws. A tap on an empty part of the
// bar must open nothing; that is the run where the check can fail.
//
// Usage: node touch_check.mjs        (after ./pack.sh)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const dist = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const p of [CHROME, join(dist, 'index.html'), join(dist, 'cythera_web.wasm')])
  if (!existsSync(p)) { console.log(`skip: ${p} is not here`); process.exit(0); }

const PORT = 8751, CDP = 9351, W = 1920, H = 1080;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: dist, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'cw-board-touch'),
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

// The stand-in bridge: the calls probe.js makes, and a touch channel for
// frames in the SDK's JSON form ({c: [{id, x, y, o, t, p, g, touched}]}).
// The Board sends a contact only when it changes, Began 1, Moved 2, Ended 3.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.BoardSDK = { setPauseContext() {}, updatePauseContext() {}, clearPauseContext() {},
    getPauseResult() { return 'null'; }, quit() {}, isReady() { return true; }, areServicesReady() { return true; } };
  window.boardTouch = { onmessage: null, postMessage(m) { window.__touchChannel = m; } };
  window.__frame = cs => window.boardTouch.onmessage({ data: JSON.stringify({ c: cs.map(c =>
    ({ id: c.id, x: c.x, y: c.y, o: 0, t: 0, p: c.p, g: 0, touched: 1 })) }) });
  window.__canvasDowns = 0;
  addEventListener('DOMContentLoaded', () => document.querySelector('canvas')
    .addEventListener('pointerdown', () => window.__canvasDowns++));
` });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, screenWidth: W, screenHeight: H, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);

let failures = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = what => console.log(`  ok   ${what}`);

let nextId = 1;
// A finger held for 250 ms: down, a still frame after the adapter's wait, up.
const tap = async (x, y) => {
  const id = nextId++;
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 1 }])`); await sleep(250);
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 2 }])`); await sleep(50);
  await run(`__frame([{ id: ${id}, x: ${x}, y: ${y}, p: 3 }])`); await sleep(300);
};
const centre = sel => run(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
  return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
const shown = sel => run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden; })()`);

if (await run(`window.__touchChannel`) !== 'subscribe') fail('the SDK subscribed to touch', String(await run(`window.__touchChannel`)));
else ok('the SDK took the stand-in for a Board and subscribed to touch');

await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');
await tap(...await centre('#play'));
try { await waitFor(() => run(`document.body.classList.contains('playing')`), 'play to start', 60000); ok('a finger on Play starts the game'); }
catch (e) { fail('a finger on Play', e.message); }
const how = await run(`document.querySelector('pre').textContent.match(/touch: (.*)/)?.[1]`);
if (how !== 'replayed from Board.input') fail('the adapter settled on replaying', String(how)); else ok('the adapter settled on replaying fingers');

// The failing case first: an empty stretch of the bar opens nothing.
await tap(W - 40, 20);
if (await shown('#menupanel')) fail('a tap on nothing', 'the menu panel opened'); else ok('a finger on an empty part of the bar opens nothing');

await tap(...await centre('#menubtn'));
if (!await shown('#menupanel')) fail('a finger on Menu', 'the panel did not open'); else ok('a finger on Menu opens its panel');
await tap(...await centre('#menuclose'));
if (await shown('#menupanel')) fail('a finger on Close', 'the panel stayed open'); else ok('a finger on Close shuts it');

const before = await run(`__canvasDowns`);
await tap(...await centre('canvas'));
if (await run(`__canvasDowns`) <= before) fail('a finger on the game', 'no pointerdown reached the canvas'); else ok('a finger on the game reaches the canvas');

if (thrown.length) fail('nothing throws', thrown.slice(0, 3).join(' | ')); else ok('nothing threw');
console.log(failures ? `\n${failures} failure(s)` : '\ntouch ok');
stop();
process.exit(failures ? 1 : 0);
