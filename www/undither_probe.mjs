// Does the Undither button's filter do what grimoire's does? Boots the real
// page in headless Chrome, lets the game reach its start board, and puts one
// frame through three things: the page's WebGL filter, the same filter with
// the lock on the game's animated colours taken off, and grimoire's own
// undither() from js/delv-graphics.js run on the CPU with the two stages the
// GPU version leaves out (stray-colour repair, the 2x supersample) switched
// off. It fails if the filter changes nothing, if the GPU and grimoire
// disagree by more than a rounding error, or if a pixel in an animated colour
// is touched while the lock is on -- and it says whether the lock was put to
// the test at all, which it is only if taking it off changes such a pixel.
//
// It needs Google Chrome, `www/cythera_web.wasm`, the game archive and
// grimoire's checkout beside this repository (for js/delv-graphics.js); it
// says which is missing and stops rather than passing. Chrome runs without a
// GPU here, so WebGL is its software renderer: that is a check of the maths,
// not of a phone's speed.
//
// Usage: node undither_probe.mjs [game.sit] [--dump <dir>] [--wait <seconds>]
//   --dump writes raw.png and undithered.png, the frame before and after.
//   --wait lets the game run that much longer first: the frame is otherwise
//   the title picture, and the start board is about fifteen seconds on.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const game = process.argv.find(a => a.endsWith('.sit')) || 'game.sit';
const dumpAt = process.argv.indexOf('--dump');
const dumpDir = dumpAt > 0 ? process.argv[dumpAt + 1] : null;
const waitAt = process.argv.indexOf('--wait');
const extraWait = waitAt > 0 ? Number(process.argv[waitAt + 1]) * 1000 : 0;
const grimoireGraphics = join(here, '..', '..', 'grimoire', 'js', 'delv-graphics.js');

let failures = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = (what, detail) => console.log(`  ok   ${what}${detail ? '  — ' + detail : ''}`);

for (const [what, path] of [['Google Chrome', CHROME], ['the built module', join(here, 'cythera_web.wasm')],
                            ['the game archive', join(here, game)], ["grimoire's delv-graphics.js", grimoireGraphics]]) {
  if (!existsSync(path)) { console.log(`skip: ${what} is not here (${path})`); process.exit(0); }
}

// ---- the plumbing, as layout_probe.mjs has it ------------------------------
const PORT = 8751, CDP = 9351;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: here, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'cw-undither-probe'),
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
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
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const click = async sel => {
  const at = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!at) throw new Error('no such control: ' + sel);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);
await run(`localStorage.removeItem('undither')`);
await send('Page.reload');
await sleep(1200);
await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');

// ---- the switch ------------------------------------------------------------
if (await run(`document.getElementById('undither').getAttribute('aria-pressed')`) !== 'false')
  fail('the button starts off', 'aria-pressed is not "false" on a first visit');
else ok('the button starts off');

await click('#play');
await waitFor(() => run(`document.body.classList.contains('playing') && screenLit > 0.5`), 'the start board');
await sleep(3000 + extraWait);

await click('#undither');
const on = await run(`({ pressed: document.getElementById('undither').getAttribute('aria-pressed'),
  stored: localStorage.getItem('undither'), built: !!unditherGL })`);
if (!on.built) fail('the filter is built', 'no WebGL pipeline: ' + (await run(`document.getElementById('log').textContent.slice(-300)`)));
else if (on.pressed !== 'true' || on.stored !== '1') fail('the button turns it on and remembers', JSON.stringify(on));
else ok('the button turns it on, and the choice is remembered');
if (!on.built) process.exit(1);

// ---- one frame, three ways --------------------------------------------------
const src = readFileSync(grimoireGraphics, 'utf8');
await run(`window.__grimoire = (() => { ${src}\n; return { undither, UD }; })(); true`);
const r = await run(`(() => {
  const ip = wasm.cw_render_indices();
  if (!ip) return { noIndices: true };
  const idx = new Uint8Array(mem.buffer, ip, W * H).slice();
  const raw = new Uint8Array(mem.buffer, wasm.cw_render(), W * H * 4).slice();
  const read = document.createElement('canvas'); read.width = W; read.height = H;
  const rc = read.getContext('2d', { willReadFrequently: true });
  const gpu = lock => {
    unditherGL.indices(lock ? idx : null, W, H); unditherGL.draw(raw);
    rc.drawImage(unditherGL.canvas, 0, 0); return rc.getImageData(0, 0, W, H).data;
  };
  const locked = gpu(true), unlocked = gpu(false);
  const lockMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) lockMask[i] = idx[i] >= 0xE0 && idx[i] < 0xFC ? 1 : 0;
  const P = Object.assign({}, __grimoire.UD, { stray: 0, upscale: 1, supersample: false, passes: 1 });
  const ref = __grimoire.undither(new Uint8ClampedArray(raw), W, H, P, lockMask, null).out;
  const px = (a, i) => a[i * 4] !== raw[i * 4] || a[i * 4 + 1] !== raw[i * 4 + 1] || a[i * 4 + 2] !== raw[i * 4 + 2];
  let changed = 0, animated = 0, animTouched = 0, animTouchedUnlocked = 0, sum = 0, worst = 0, refChanged = 0;
  for (let i = 0; i < W * H; i++) {
    if (px(locked, i)) changed++;
    if (px(ref, i)) refChanged++;
    if (lockMask[i]) { animated++; if (px(locked, i)) animTouched++; if (px(unlocked, i)) animTouchedUnlocked++; }
    for (let c = 0; c < 3; c++) { const d = Math.abs(locked[i * 4 + c] - ref[i * 4 + c]); sum += d; if (d > worst) worst = d; }
  }
  const png = a => { rc.putImageData(new ImageData(new Uint8ClampedArray(a), W, H), 0, 0); return read.toDataURL('image/png'); };
  return { W, H, changed, refChanged, animated, animTouched, animTouchedUnlocked,
           meanDiff: sum / (W * H * 3), worst, raw: png(raw), out: png(locked) };
})()`);

if (r.noIndices) { fail('the module gives the palette indices', 'cw_render_indices answered null: the screen is not 8 bits deep, or not the page\'s size'); process.exit(1); }
ok('the module gives the palette indices', `${r.W}x${r.H}`);
if (!r.changed) fail('the filter changes the frame', 'not one pixel differs from the game\'s own');
else ok('the filter changes the frame', `${r.changed} of ${r.W * r.H} pixels (grimoire's changes ${r.refChanged})`);
// The mobile shell's port was measured against grimoire at 0.035 of 255 on
// average and 1 at worst; allow a little for a software renderer's floats.
if (r.meanDiff > 0.25 || r.worst > 3) fail('the GPU agrees with grimoire', `mean ${r.meanDiff.toFixed(3)}, worst ${r.worst} of 255`);
else ok('the GPU agrees with grimoire', `mean |difference| ${r.meanDiff.toFixed(3)} of 255, worst ${r.worst}`);
if (r.animTouched) fail('animated colours are left alone', `${r.animTouched} of ${r.animated} changed`);
else ok('animated colours are left alone', `${r.animated} such pixels, none changed`);
if (r.animTouchedUnlocked) ok('the lock was tested', `without it ${r.animTouchedUnlocked} of them change`);
else console.log(`  note the lock was not tested: this frame's ${r.animated} animated pixels are unchanged even without it`);

if (dumpDir) {
  mkdirSync(dumpDir, { recursive: true });
  for (const [name, url] of [['raw.png', r.raw], ['undithered.png', r.out]])
    writeFileSync(join(dumpDir, name), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  frames in ${dumpDir}`);
}
console.log(failures ? `\n${failures} failed` : '\nundither ok');
process.exit(failures ? 1 : 0);
