// Does the page fit the phone? Boots the real page in headless Chrome at phone
// sizes -- the module loaded, the game running, every panel opened -- and
// checks that nothing is off the screen.
//
// This exists because the layout faults this page has had were all of one
// shape: a number guessed at instead of measured. The canvas subtracted a
// nominal 40 px bar and the bar was 76; the panels hung off a nominal 48 px
// bar and it was 78 while the module was still loading; `width` and
// `max-height` were the content box and the padding put 399 px of panel on a
// 393 px screen. None of them are visible in the source and all of them are
// one measurement away.
//
// It needs Google Chrome and `www/cythera_web.wasm`; it says so and stops
// rather than passing when either is missing, because the one outcome worth
// designing against here is silence that reads as a pass.
//
// Usage: node layout_probe.mjs [game.sit]     (--dump prints every measurement)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const game = process.argv.find(a => !a.startsWith('-') && a.endsWith('.sit')) || 'game.sit';
const dump = process.argv.includes('--dump');

// The sizes are a phone's, not a desktop's: an iPhone 15 in portrait with
// Chrome's toolbars up and the same phone turned. A panel that fits 852x340
// fits every window wider and taller than it.
const SIZES = [['portrait', 393, 720], ['landscape', 852, 340]];
const PANELS = [['#menubtn', '#menupanel', '#menuclose'], ['#cheatbtn', '#cheatpanel', '#cheatclose'],
                ['#saves', '#savespanel', '#savesclose'], ['#musicbtn', '#musicpanel', '#musicclose'],
                ['#patchbtn', '#patchpanel', '#patchclose']];

let failures = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = (what, detail) => console.log(`  ok   ${what}${detail ? '  — ' + detail : ''}`);

for (const [what, path] of [['Google Chrome', CHROME], ['the built module', join(here, 'cythera_web.wasm')],
                            ['the game archive', join(here, game)]]) {
  if (!existsSync(path)) { console.log(`skip: ${what} is not here (${path})`); process.exit(0); }
}

// ---- the plumbing: a page served over http, and CDP over a WebSocket -------
// The page is served rather than opened as a file because `instantiateStreaming`
// needs a wasm content type, and Chrome is driven over the protocol rather than
// by a driver library so that this file has no dependencies.
const PORT = 8749, CDP = 9349;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: here, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'cw-layout-probe'),
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
// A real mouse event, not element.click(): the page's own handlers are what is
// being measured, and Play makes its AudioContext inside the tap.
const click = async sel => {
  const at = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!at) throw new Error('no such control: ' + sel);
  for (const type of ['mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 });
};
const box = sel => run(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
  if (!e || e.hidden) return null; const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
           right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; })()`);

await send('Page.enable'); await send('Runtime.enable');

// ---- the measurements ------------------------------------------------------
for (const [name, w, h] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');
  await click('#play');
  try { await waitFor(() => run(`document.body.classList.contains('playing')`), 'play to start'); }
  catch (e) {
    fail(`${name} ${w}x${h}`, (await run(`document.getElementById('log').textContent.slice(-400)`)) || e.message);
    continue;
  }
  await sleep(3000);

  const bar = await box('#bar');
  const view = await run(`({ docH: Math.round(document.documentElement.getBoundingClientRect().height),
    docW: Math.round(document.documentElement.scrollWidth), touch: document.body.classList.contains('touch') })`);

  // The page is exactly as tall as the window shows and does not scroll. It
  // came to 756 px in a 720 px window once, and the game's character row was
  // the part below the fold.
  if (view.docH !== h || view.docW > w)
    fail(`${name} the page is the window`, `document ${view.docW}x${view.docH} in a ${w}x${h} window`);
  else ok(`${name} the page is exactly the window, and does not scroll`, `${w}x${h}`);

  if (!view.touch) fail(`${name} the touch shell`, 'a coarse pointer did not turn it on');

  const off = [];
  for (const [button, panel, closer] of PANELS) {
    await click(button); await sleep(500);
    const p = await box(panel), c = await box(closer);
    if (!p) { fail(`${name} ${panel}`, 'it did not open'); continue; }
    if (p.left < 0 || p.right > w || p.bottom > h || p.top < 0)
      off.push(`${panel} ${p.left}..${p.right} x ${p.top}..${p.bottom}`);
    // It hangs off the bar's real height rather than a number written into the
    // stylesheet, so it neither hides the bar nor floats below it.
    else if (p.top < bar.h || p.top > bar.h + 16) off.push(`${panel} top ${p.top} against a ${bar.h} px bar`);
    else if (!c || c.bottom > h) off.push(`${panel} Close is at ${c ? c.bottom : 'nowhere'}`);
    if (dump) console.log(`       ${panel} ${p.left}..${p.right} x ${p.top}..${p.bottom}`);
    await click(closer); await sleep(200);
  }
  for (const pad of ['#move', '#act']) {
    const p = await box(pad);
    if (!p) off.push(`${pad} is not shown`);
    else if (p.left < 0 || p.right > w || p.bottom > h || p.top < 0)
      off.push(`${pad} ${p.left}..${p.right} x ${p.top}..${p.bottom}`);
    if (dump && p) console.log(`       ${pad} ${p.left}..${p.right} x ${p.top}..${p.bottom}`);
  }
  if (off.length) fail(`${name} everything is on the screen`, off.join('; '));
  else ok(`${name} every panel and pad is on the screen, under a ${bar.h} px bar`);
}

console.log(failures ? `\n${failures} failure(s)` : '\nlayout ok');
stop();
process.exit(failures ? 1 : 0);
