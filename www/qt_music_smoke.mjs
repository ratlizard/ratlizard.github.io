// Do the game's tunes reach the mixer through QuickTime's instruments?
//
// The worker's half is run here as the worker runs it: the same files in the
// same order in one global scope, then qtTuneWav. The tunes are read off the
// module's disk the way the page reads them, their checksums are held to the
// page's table (the fork files a substitute under that number, so one wrong
// bit is a render nothing ever plays), and the theme's render is installed
// and listened for: the module has to call it a recording, and twenty seconds
// of the title screen have to differ from the same seconds without it.
//
// Usage: node qt_music_smoke.mjs <archive> <QUICKTIM.EXE>
// The instruments are Apple's and Roland's and are not in this repository;
// grimoire's suite leaves the installer at $TMPDIR/QUICKTIM.EXE.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [, , archivePath, instrumentsPath] = process.argv;
if (!archivePath || !instrumentsPath) { console.error('usage: node qt_music_smoke.mjs <archive> <QUICKTIM.EXE>'); process.exit(2); }
const here = n => new URL('./' + n, import.meta.url);
const fail = m => { console.error('FAIL: ' + m); process.exit(1); };

// --- the worker's scripts, as importScripts loads them
const worker = readFileSync(here('qt-music.js'), 'utf8');
const names = worker.match(/importScripts\(\.\.\.\[([^\]]+)\]/);
if (!names) fail('could not find the worker\'s importScripts list in qt-music.js');
const order = [...names[1].matchAll(/'([^']+)'/g)].map(m => 'delv/' + m[1] + '.js');
for (const f of [...order, 'delv/delv-archive.js', 'qt-music.js']) vm.runInThisContext(readFileSync(here(f), 'utf8'), { filename: f });
const g = n => vm.runInThisContext(n);
console.log(`ok: ${order.length} vendored scripts and qt-music.js load in one scope with nothing else`);

const page = readFileSync(here('index.html'), 'utf8');
const tunesFrom = page.indexOf('const GAME_TUNES = [');
const GAME_TUNES = vm.runInThisContext('(' + page.slice(tunesFrom + 'const GAME_TUNES = '.length, page.indexOf('];', tunesFrom) + 1) + ')');

// --- the module
const wasmBytes = readFileSync(here('cythera_web.wasm'));
const dec = new TextDecoder(), enc = new TextEncoder();
let mem;
const env = { cw_log: (p, n) => { const m = dec.decode(new Uint8Array(mem.buffer, p, n)); if (m.startsWith('[TUNE]')) console.log(' ', m); } };
const game = readFileSync(archivePath);
async function boot() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, { env });
  const w = instance.exports; mem = w.memory; w.cw_init();
  const p = w.cw_alloc(game.length); new Uint8Array(mem.buffer, p, game.length).set(game);
  if (w.cw_boot(p, game.length, Math.floor(Date.now() / 1000) + 2082844800, 640, 480) !== 0) fail('boot');
  return w;
}
const put = (w, u8) => { const p = w.cw_alloc(u8.length); new Uint8Array(mem.buffer, p, u8.length).set(u8); return p; };

// --- the tunes, off the module's disk as the page's readGameTunes takes them
const w0 = await boot();
const name = enc.encode('Cythera Data');
let p = put(w0, name);
if (!w0.cw_vfs_find(p, name.length)) fail('Cythera Data is not on the disk');
const path = new Uint8Array(mem.buffer, w0.cw_found_ptr(), w0.cw_found_len()).slice();
p = put(w0, path);
if (!w0.cw_vfs_stage(p, path.length)) fail('could not stage Cythera Data');
const data = new Uint8Array(mem.buffer, w0.cw_staged_data_ptr(), w0.cw_staged_data_len()).slice();
const arc = g('openDelverArchive')(data), tunes = [];
for (let resid = 0x9000; resid <= 0x90FF; resid++) {
  const d = g('getResourceBytes')(arc, resid);
  if (d && d.length > 8) tunes.push({ resid, data: d, sum: g('qtTuneStreamChecksum')(d) });
}
if (tunes.length !== GAME_TUNES.length) fail(`${tunes.length} tunes in Cythera Data, ${GAME_TUNES.length} in the page's table`);
tunes.forEach((t, i) => { if (t.sum !== (GAME_TUNES[i].sum >>> 0)) fail(`0x${t.resid.toString(16)} checksums to ${t.sum.toString(16)}, the page's table says ${GAME_TUNES[i].sum.toString(16)} (${GAME_TUNES[i].name})`); });
// The control: one bit of a tune changed has to change its number.
const bent = tunes[0].data.slice(); bent[bent.length - 9] ^= 1;
if (g('qtTuneStreamChecksum')(bent) === tunes[0].sum) fail('the checksum did not notice a changed tune');
console.log(`ok: ${tunes.length} tunes read off the disk, each checksum the page's table's, and a changed tune's differs`);

// --- the instruments and a render
const lib = g('qtInstrumentsFromFile')(new Uint8Array(readFileSync(instrumentsPath)));
const t0 = performance.now();
const theme = g('qtTuneWav')(tunes[0].data, lib);
const ms = performance.now() - t0;
const wav = theme.wav, dv = new DataView(wav.buffer);
if (dec.decode(wav.subarray(0, 4)) !== 'RIFF' || dv.getUint16(22, true) !== 2 || dv.getUint32(24, true) !== 22050 || dv.getUint16(34, true) !== 8)
  fail('the render is not 8-bit stereo at 22,050 Hz, which is what the fork mixes without converting');
if (theme.missing.length) fail('the theme has no instrument for part ' + theme.missing.join(', '));
if (Math.abs(theme.seconds - 97.1) > 1) fail(`the theme rendered ${theme.seconds.toFixed(1)} s long; it is 96 s and a second of tail`);
if (wav[wav.length - 1] !== 128 && wav[wav.length - 1] !== 127 && wav[wav.length - 1] !== 129) fail('the render ends on a cut, not a fade');
console.log(`ok: ${lib.ids.length} instruments; the theme rendered in ${ms.toFixed(0)} ms, ${theme.seconds.toFixed(1)} s, ${(wav.length / 1048576).toFixed(1)} MB`);

// --- does it reach the mixer?
async function themeAudio(install) {
  const w = await boot();
  if (install) {
    const mp = put(w, wav);
    const kind = w.cw_tune_install(tunes[0].sum, mp, wav.length);
    w.cw_free(mp, wav.length);
    if (kind !== 2) fail(`the module read the render as kind ${kind}, expected 2 (a recording)`);
  }
  let done = 0; while (done < 80_000_000) done += w.cw_run_headless(2_000_000);
  w.cw_audio_drain();
  const VBL = 60.15, RATE = 22050, tick0 = w.cw_tick(), chunks = [];
  for (let f = 0; f < 20 * 60; f++) {
    const deadline = tick0 + Math.floor((f + 1) / 60 * VBL);
    let s = 0; while (w.cw_tick() < deadline && s < 2_000_000) { const r = w.cw_run(2_000_000 - s, deadline, 0); if (!r || !w.cw_running()) break; s += r; }
    w.cw_mix_audio(Math.round(RATE / 60));
    const ptr = w.cw_audio_drain(), n = w.cw_audio_len();
    if (n) chunks.push(Buffer.from(new Uint8Array(mem.buffer, ptr, n)));
  }
  return Buffer.concat(chunks);
}
const own = await themeAudio(false), swapped = await themeAudio(true);
const loud = b => { let n = 0; for (let i = 0; i < b.length; i += 8) if (Math.abs(b[i] - 128) > 4) n++; return n; };
if (!loud(own)) fail('the game\'s own theme played silence, so this run says nothing');
if (!loud(swapped)) fail('the rendered theme played silence');
if (own.length === swapped.length && own.equals(swapped)) fail('installing the render changed nothing that reached the mixer');
console.log(`ok: the theme's render installed as a recording and changed the music: ${loud(own)} non-silent checks of the built-in instruments, ${loud(swapped)} of QuickTime's`);
