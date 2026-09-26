// Do two fingers zoom without clicking, and does one finger still land where
// it touches? Boots the real page in headless Chrome at a phone's portrait
// size with touch emulated, lets the game reach its start board, and drives
// touches through the protocol while counting every press and release that
// reaches the module:
//
//   - a pinch zooms the screen and presses nothing;
//   - the finger left on the glass after a pinch neither presses nor clicks;
//   - a tap on the zoomed screen presses the guest pixel under it, worked out
//     here from the transform independently of the page's own guestPoint;
//   - a finger that moves at once presses at once, where it landed;
//   - pinching back out returns the screen to fitting the stage.
//
// The negative control is a second finger that arrives after the page has
// stopped waiting for one: that must reach the module as a press and a
// release, which shows the count sees presses at all.
//
// It needs Google Chrome, `www/cythera_web.wasm` and the game archive, and says
// which is missing and stops rather than passing.
//
// Usage: node pinch_probe.mjs [game.sit]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const game = process.argv.find(a => a.endsWith('.sit')) || 'game.sit';

let failures = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = (what, detail) => console.log(`  ok   ${what}${detail ? '  — ' + detail : ''}`);
const check = (cond, what, detail) => cond ? ok(what, detail) : fail(what, detail);

for (const [what, path] of [['Google Chrome', CHROME], ['the built module', join(here, 'cythera_web.wasm')],
                            ['the game archive', join(here, game)]]) {
  if (!existsSync(path)) { console.log(`skip: ${what} is not here (${path})`); process.exit(0); }
}

// ---- the plumbing, as layout_probe.mjs has it ------------------------------
const PORT = 8753, CDP = 9353;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: here, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'cw-pinch-probe'),
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const stop = () => { browser.kill('SIGKILL'); server.kill('SIGKILL'); };
process.on('exit', stop);

const waitFor = async (fn, what, ms = 180000, every = 250) => {
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
let seq = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (!m.id || !pending.has(m.id)) return;
  const [res, rej] = pending.get(m.id); pending.delete(m.id);
  m.error ? rej(new Error(m.error.message)) : res(m.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, [res, rej]); ws.send(JSON.stringify({ id, method, params }));
});
const run = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
// A point is [x, y] or [x, y, id]; the id defaults to its place in the list.
// Chrome's touchEnd releases the points it is given and leaves the rest down,
// so lifting one of two fingers names that finger's id.
const touch = (type, points) => send('Input.dispatchTouchEvent',
  { type, touchPoints: points.map(([x, y, id], i) => ({ x, y, id: id ?? i })) });
const clickAt = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased'])
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 720, deviceScaleFactor: 3, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);
await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');
const play = await run(`(() => { const r = document.getElementById('play').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await clickAt(play.x, play.y);
await waitFor(() => run(`document.body.classList.contains('playing') && screenLit > 0.5`), 'the start board');
await sleep(15000);

// Every press and release that reaches the module, with where it went. A
// plain copy of the exports rather than a Proxy: their properties are
// read-only and non-configurable, a Proxy may not answer them with anything
// else, and the page's own calls then throw -- which this probe's control
// caught the first time round.
await run(`window.__io = []; { const real = wasm; wasm = { ...real,
  cw_mouse_down: (...a) => { __io.push(['down', ...a]); return real.cw_mouse_down(...a); },
  cw_mouse_up: (...a) => { __io.push(['up', ...a]); return real.cw_mouse_up(...a); } }; } true`);
const io = () => run(`__io.splice(0)`);
const state = () => run(`({ s: zoom.s, x: zoom.x, y: zoom.y, t: canvas.style.transform })`);
const box = await run(`stageBox()`);
const cx = box.left + box.w / 2, cy = box.top + box.h / 2;

// ---- a pinch out -----------------------------------------------------------
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
for (let k = 1; k <= 6; k++) { await touch('touchMove', [[cx - 40 - 16 * k, cy], [cx + 40 + 16 * k, cy]]); await sleep(30); }
let z = await state();
check(z.s > 1.5 && z.t.includes('scale'), 'two fingers zoom', `scale ${z.s.toFixed(2)}`);
// Lift the right finger, drag the left one about, then lift it too. The zoom
// must not move while it drags.
await touch('touchEnd', [[cx + 136, cy, 1]]);
const held = await state();
for (let k = 1; k <= 3; k++) { await touch('touchMove', [[cx - 136 + 20 * k, cy + 10 * k, 0]]); await sleep(30); }
await touch('touchEnd', [[cx - 76, cy + 30, 0]]);
await sleep(400);
let got = await io();
const after = await state();
check(got.length === 0, 'a pinch, and the finger left after it, press nothing', got.length ? JSON.stringify(got) : 'no press, no release');
check(after.s === held.s && after.x === held.x && after.y === held.y, 'the finger left after a pinch does not move the view',
  `scale ${held.s.toFixed(2)} before, ${after.s.toFixed(2)} after`);

// ---- a tap on the zoomed screen ---------------------------------------------
z = await state();
const P = [box.left + box.w * 0.3, box.top + box.h * 0.6];
const expect = await run(`(() => {
  const local = [${P[0]} - ${box.left}, ${P[1]} - ${box.top}];
  const u = [(local[0] - zoom.x) / zoom.s, (local[1] - zoom.y) / zoom.s];
  const fit = Math.min(${box.w} / W, ${box.h} / H);
  const ox = (${box.w} - W * fit) / 2, oy = (${box.h} - H * fit) / 2;
  return [Math.round((u[1] - oy) / fit), Math.round((u[0] - ox) / fit)];
})()`);
await touch('touchStart', [P]); await sleep(30); await touch('touchEnd', []);
await sleep(500);
got = await io();
const down = got.find(e => e[0] === 'down');
check(got.length === 2 && down && Math.abs(down[1] - expect[0]) <= 1 && Math.abs(down[2] - expect[1]) <= 1,
  'a tap on the zoomed screen presses the pixel under it',
  down ? `pressed (${down[1]},${down[2]}), under the finger (${expect[0]},${expect[1]}), at scale ${z.s.toFixed(2)}` : JSON.stringify(got));

// ---- a finger that moves at once ---------------------------------------------
const D = [box.left + box.w * 0.5, box.top + box.h * 0.7];
const dExpect = await run(`guestPoint({ clientX: ${D[0]}, clientY: ${D[1]} })`);
await touch('touchStart', [D]); await touch('touchMove', [[D[0] + 30, D[1]]]);
await sleep(20);
got = await io();
const early = got.find(e => e[0] === 'down');
check(early && early[1] === dExpect[0] && early[2] === dExpect[1], 'a finger that moves presses at once, where it landed',
  early ? `(${early[1]},${early[2]})` : 'no press within 20 ms of moving');
await touch('touchEnd', []); await sleep(400); await io();

// ---- the negative control: a second finger too late ---------------------------
await touch('touchStart', [[cx - 40, cy]]); await sleep(200);
await touch('touchStart', [[cx - 40, cy], [cx + 40, cy]]); await sleep(100);
await touch('touchEnd', []); await sleep(400);
got = await io();
check(got.filter(e => e[0] === 'down').length === 1 && got.filter(e => e[0] === 'up').length === 1,
  'control: a second finger after the wait finds a press to let go', JSON.stringify(got.map(e => e[0])));

// ---- pinching back out -------------------------------------------------------
await touch('touchStart', [[cx - 150, cy], [cx + 150, cy]]);
for (let k = 1; k <= 8; k++) { await touch('touchMove', [[cx - 150 + 17 * k, cy], [cx + 150 - 17 * k, cy]]); await sleep(30); }
await touch('touchEnd', []); await sleep(300);
z = await state();
check(z.s === 1 && z.t === '', 'pinching back out fits the stage again', `scale ${z.s}`);
got = await io();
check(got.length === 0, 'and presses nothing', got.length ? JSON.stringify(got) : '');

console.log(failures ? `\n${failures} failed` : '\npinch ok');
process.exit(failures ? 1 : 0);
