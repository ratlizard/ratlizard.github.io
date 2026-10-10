// Does the real page play the game's music on QuickTime's instruments?
//
// qt_music_smoke.mjs proves the render and the install under Node. This is
// the rest, which only a browser has: the worker starting and importing its
// scripts, the instruments fetched from archive.org and kept in IndexedDB,
// each tune installed while the game runs, and a second visit that fetches
// nothing and has the theme before the title screen asks for it. Then the
// Music panel's checkbox off, which has to leave no render installed.
//
// It fetches 7 MB from archive.org, so it is run by hand after touching the
// music path and is not one of the quick checks. It needs Google Chrome,
// `www/cythera_web.wasm` and a game archive, and says so and stops rather
// than passing when one is missing. The plumbing is layout_probe.mjs's.
//
// Usage: node qt_music_probe.mjs [game.sit]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const game = process.argv.find(a => !a.startsWith('-') && a.endsWith('.sit')) || 'game.sit';

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
const PORT = 8751, CDP = 9351;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
  { cwd: here, stdio: 'ignore' });
const browser = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`,
  '--user-data-dir=' + join(process.env.TMPDIR || '/tmp', 'cw-qt-music-probe-' + process.pid),
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
// On a phone the bar is a row that scrolls, so a control is brought into view
// first, as a thumb would, and clear of the arrows over its ends.
const click = async sel => {
  const at = await run(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null; if (e.closest('#barrow')) e.scrollIntoView({ inline: 'center', block: 'nearest' });
    const r = e.getBoundingClientRect();
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


const log = () => run(`document.getElementById('log').textContent`);
const music = async () => (await log()).split('\n').filter(l => l.startsWith('music:'));
const start = async () => {
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await sleep(1200);
  await waitFor(() => run(`!document.getElementById('play').disabled`), 'the module');
  await click('#play');
  await waitFor(() => run(`document.body.classList.contains('playing')`), 'play to start');
};
const table = async () => {
  await run(`renderMusic()`); await sleep(300);
  return run(`[...document.querySelectorAll('#musictable tr')].slice(1).map(r => r.cells[1].textContent)`);
};
const DONE = /music: (\d+) of the game's tunes rendered on QuickTime 3's instruments in ([\d.]+) s/;

// ---- the measure to hold the cost against: the same seconds with the checkbox off
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);
await run(`localStorage.setItem('qtmusic', '0')`);
await start();
await sleep(15000);
const plain = await run(`mem.buffer.byteLength >> 20`);
(await run(`wasm.cw_tune_count()`)) === 0 ? ok('the checkbox off at boot', `no tune installed; the module's heap is ${plain} MB`)
  : fail('the checkbox off at boot', 'a tune was installed');
await run(`localStorage.removeItem('qtmusic')`);

// ---- a first visit: nothing kept, so the instruments come from archive.org
await start();
let lines;
try {
  await waitFor(async () => DONE.test(await log()), 'the tunes to be rendered', 300000, 1000);
  lines = await music();
  if (!lines.some(l => l.includes('fetching QuickTime 3'))) fail('first visit', 'the instruments were not fetched: ' + lines.join(' | '));
  else ok('first visit', lines.join(' | '));
  const rows = await table();
  const on = rows.filter(t => t.includes('QuickTime')).length;
  on === rows.length && rows.length === 11 ? ok('the Music panel', `${on} of ${rows.length} tunes on QuickTime's instruments`)
    : fail('the Music panel', `${on} of ${rows.length} rows say QuickTime: ${rows.join(' | ')}`);
} catch (e) { fail('first visit', e.message + ': ' + (await music()).join(' | ')); }

// ---- a second visit: the instruments are kept, and the theme is in before the game starts
await start();
try {
  const early = await run(`qt.installed.size`);
  early >= 1 ? ok('second visit', `${early} tune(s) installed by the time the game started`)
    : fail('second visit', 'the game started with no render installed');
  await waitFor(async () => DONE.test(await log()), 'the tunes to be rendered', 120000, 500);
  lines = await music();
  lines.some(l => l.includes('fetching')) ? fail('second visit', 'fetched the instruments again') : ok('second visit', lines.join(' | '));
  const heap = await run(`mem.buffer.byteLength >> 20`);
  ok('the module\'s heap', `${heap} MB with eleven tunes installed, ${plain} MB with none`);
} catch (e) { fail('second visit', e.message + ': ' + (await music()).join(' | ')); }

// ---- the checkbox off: the built-in instruments, and nothing of QuickTime's installed
try {
  await run(`(() => { const c = document.getElementById('qtmusic'); c.checked = false; return c.onchange({ target: c }); })()`);
  await sleep(500);
  const rows = await table(), left = await run(`wasm.cw_tune_count()`);
  rows.some(t => t.includes('QuickTime')) || left ? fail('the checkbox off', `${left} tune(s) still installed: ${rows.join(' | ')}`)
    : ok('the checkbox off', 'no tune installed, every row the game\'s own');
  await run(`(() => { const c = document.getElementById('qtmusic'); c.checked = true; return c.onchange({ target: c }); })()`);
  await waitFor(async () => (await run(`qt.installed.size`)) === 11, 'the tunes to come back', 120000, 500);
  ok('the checkbox on again', '11 tunes installed');
} catch (e) { fail('the checkbox', e.message); }

ws.close();
console.log(failures ? `${failures} failure(s)` : 'the game\'s music plays on QuickTime\'s instruments in a browser');
process.exit(failures ? 1 : 0);
