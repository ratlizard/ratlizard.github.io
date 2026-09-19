// Execute the page's script top to bottom under a stub document, so a
// declaration used before its line (a TDZ ReferenceError, which killed the
// touch pads on a phone) fails here and not there. Parsing alone did not
// catch it. Usage: node page_smoke.mjs
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
const el = id => ({ id, style: { setProperty() {}, removeProperty() {} }, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; },
  setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
  getContext() { return { putImageData() {}, clearRect() {} }; }, querySelector() { return el('q'); }, querySelectorAll() { return []; },
  appendChild() {}, focus() {}, blur() {}, click() {}, set textContent(v) {}, set innerHTML(v) {}, hidden: true, disabled: false, value: '', checked: false, files: [] });
const document = { getElementById: id => { if (!ids.includes(id)) throw new Error(`no element #${id}`); return el(id); }, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('new'), body: el('body'), documentElement: el('html'), activeElement: null, hidden: false };
const window = { addEventListener() {}, innerWidth: 393, innerHeight: 700, AudioContext: function () {} };
const stubs = { document, window, matchMedia: () => ({ matches: true }), localStorage: { getItem: () => null, setItem() {} }, navigator: { storage: {} },
  location: { search: '' }, requestAnimationFrame() {}, setInterval() {}, setTimeout: () => 0, clearTimeout() {}, performance: { now: () => 0 },
  WebAssembly: { instantiateStreaming: () => new Promise(() => {}), instantiate: () => new Promise(() => {}) }, fetch: () => new Promise(() => {}),
  indexedDB: { open: () => ({}) }, TextDecoder, TextEncoder, URLSearchParams, console, Math, JSON, Object, Number, String, Array, Promise, Error, Map, Set, Uint8Array, Uint8ClampedArray, DataView, Blob: function () {}, URL, confirm: () => false, alert() {} };
const fn = new Function(...Object.keys(stubs), script.replace(/^\s*'use strict';/, ''));
fn(...Object.values(stubs));
console.log('page script ran to the end');

// The vendored grimoire files and this script share one global scope, so a
// top-level name declared in both is one silently replacing the other. The
// page's own fourcc(n) did exactly that to grimoire's fourcc(bytes, offset),
// and every StuffIt, BinHex and MacBinary read on the page went wrong with it.
const tops = src => new Set([...src.matchAll(/^(?:async\s+)?(?:function\s*\*?\s*|(?:const|let|var|class)\s+)([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const mine = tops(script), clashes = [];
for (const f of [...html.matchAll(/<script src="(delv\/[^"]+)"/g)].map(m => m[1]))
  for (const name of tops(readFileSync(new URL('./' + f, import.meta.url), 'utf8'))) if (mine.has(name)) clashes.push(`${name} (${f})`);
if (clashes.length) { console.error('FAIL: the page redeclares names the vendored scripts define: ' + clashes.join(', ')); process.exit(1); }
console.log('no top-level name is declared both here and in delv/');
