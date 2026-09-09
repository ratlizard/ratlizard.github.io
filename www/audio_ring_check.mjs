// The audio ring, lifted out of index.html and run here.
//
// The page used to hand the speaker one AudioBufferSourceNode per animation
// frame. Splicing nodes end to end puts a full-scale step at every join --
// measured in Chrome against a 440 Hz sine, offline, the second differences
// at the joins were 26x those mid-chunk, a step of 0.51 on an amplitude of
// 0.5, sixty times a second. That was the crackle, and neither resampling the
// samples here nor aligning every chunk to an exact output frame moved the
// number. One AudioWorklet node reading a ring measured 1.0x, the same as a
// single unbroken buffer, which is what replaced it.
//
// What this checks is the processor that does the reading: that a stream fed
// to it in pieces comes out with no discontinuity anywhere, that it bends
// rather than clicking when it runs dry and picks up again, that a ring
// flooded past its capacity stays bounded, and that reset empties it.
//
// The measure is the largest second difference anywhere in the output, which
// does not depend on knowing where the joins fell. Two things put one there
// even when nothing is wrong: the wave's own curvature, 1.7e-3 for 440 Hz at
// 48 kHz, and the corner at each guest sample left by reading between samples
// in a straight line, 3.6e-3 -- the same roughness Chrome's own resampling
// leaves, and small against an 8-bit source. A step or a skipped sample is far
// above both: skipping three samples at every feed, the negative control this
// was written against, reads 1.9e-1.
//
// Usage: node audio_ring_check.mjs
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const m = page.match(/const AUDIO_WORKLET_SOURCE = `([\s\S]*?)`;\n/);
if (!m) { console.error('could not find AUDIO_WORKLET_SOURCE in index.html'); process.exit(1); }

const RATE = 22050, CTX = 48000, QUANTUM = 128, FREQ = 440, AMP = 0.5;
const OWN = AMP * Math.pow(2 * Math.PI * FREQ / CTX, 2);   // the wave's own second difference
// The corner left at each guest sample by reading between samples in a
// straight line: the curvature over one guest sample, in output steps.
const KNOT = AMP * Math.pow(2 * Math.PI * FREQ / RATE, 2) * (RATE / CTX);
let registered = null;
globalThis.sampleRate = CTX;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = globalThis.__port; } };
globalThis.registerProcessor = (name, cls) => { registered = { name, cls }; };
new Function(m[1])();
if (!registered || registered.name !== 'guest-audio') { console.error('the source did not register guest-audio'); process.exit(1); }

let failures = 0;
const ok = (what, detail) => console.log(`  ok   ${what}${detail ? '  — ' + detail : ''}`);
const fail = (what, detail) => { failures++; console.log(`  FAIL ${what}${detail ? '  — ' + detail : ''}`); };
const check = (cond, what, detail) => cond ? ok(what, detail) : fail(what, detail);

function makeProcessor(capacity) {
  const sent = [];
  globalThis.__port = { postMessage: msg => sent.push(msg), onmessage: null };
  const port = globalThis.__port;
  const p = new registered.cls({ processorOptions: { rate: RATE, capacity } });
  return { p, sent, feed: data => port.onmessage({ data }) };
}
function run(p, quanta, into) {
  for (let q = 0; q < quanta; q++) {
    const buf = new Float32Array(QUANTUM);
    p.process([], [[buf]], {});
    for (let i = 0; i < QUANTUM; i++) into.push(buf[i]);
  }
}
const sine = (n, from = 0) => {
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = AMP * Math.sin(2 * Math.PI * FREQ * (from + i) / RATE);
  return f;
};
// The largest second difference over a stretch, skipping the first samples,
// where the output is still coming up from silence.
function roughest(o, skip = 256) {
  let worst = 0, at = -1;
  for (let i = skip; i < o.length - 1; i++) {
    const v = Math.abs(o[i + 1] - 2 * o[i] + o[i - 1]);
    if (v > worst) { worst = v; at = i; }
  }
  return { worst, at };
}

// 1. a stream fed in pieces comes out whole
{
  const CHUNK = 368, cap = Math.round(RATE * 0.5);
  const { p, feed } = makeProcessor(cap);
  let fed = 0;
  for (let i = 0; i < 6; i++) { feed(sine(CHUNK, fed)); fed += CHUNK; }
  const o = [];
  // Six quanta of output take 352.8 guest samples, so feeding 368 each time
  // keeps the ring a little ahead without ever letting it run dry.
  for (let i = 0; i < 60; i++) { run(p, 6, o); feed(sine(CHUNK, fed)); fed += CHUNK; }
  const { worst, at } = roughest(o);
  check(worst < 2 * KNOT, 'a stream fed in pieces comes out with no step anywhere',
        `roughest ${worst.toExponential(2)} at sample ${at}, allowed ${(2 * KNOT).toExponential(2)}, reading between samples costs ${KNOT.toExponential(2)}`);
  let peak = 0; for (const v of o) peak = Math.max(peak, Math.abs(v));
  check(peak > 0.45 && peak < 0.55, 'the level is what was fed in', `peak ${peak.toFixed(3)}, fed ${AMP}`);
}

// 2. running dry bends rather than clicking, fades, and picks up again
{
  const { p, feed } = makeProcessor(Math.round(RATE * 0.5));
  feed(sine(2000));
  const o = [];
  run(p, 20, o);                 // still fed
  const dryFrom = o.length;
  run(p, 90, o);                 // past the 2000: running dry
  const { worst } = roughest(o.slice(dryFrom - 256), 0);
  check(worst < 2 * KNOT, 'running dry bends rather than clicking',
        `roughest ${worst.toExponential(2)}, allowed ${(2 * KNOT).toExponential(2)}`);
  check(Math.abs(o[o.length - 1]) < 0.01, 'and fades to silence', `ended at ${Math.abs(o[o.length - 1]).toExponential(2)}`);
  feed(sine(4000, 2000));
  const back = [];
  run(p, 20, back);
  let peak = 0; for (const v of back) peak = Math.max(peak, Math.abs(v));
  check(peak > 0.4, 'and picks up when samples arrive again', `peak ${peak.toFixed(3)}`);
  // The join back on is the one the fade would otherwise have made loud: the
  // output had faded to nothing and the source is wherever it left off.
  const rough = roughest([o[o.length - 2], o[o.length - 1], ...back], 0);
  check(rough.worst < 2 * KNOT, 'and comes back without a click',
        `roughest ${rough.worst.toExponential(2)} at sample ${rough.at}, allowed ${(2 * KNOT).toExponential(2)}`);
}

// 3. a ring flooded past its capacity stays bounded, keeps playing, and does
//    not step where it drops the oldest -- which is what a load does to it
{
  const cap = 1024;
  const { p, feed, sent } = makeProcessor(cap);
  const o = [];
  feed(sine(512)); run(p, 2, o);
  const floodFrom = o.length;
  for (let i = 1; i < 8; i++) feed(sine(512, i * 512));   // 4096 into a 1024 ring, mid-play
  run(p, 8, o);
  let peak = 0; for (const v of o) peak = Math.max(peak, Math.abs(v));
  check(peak <= 1, 'a flooded ring stays inside full scale', `peak ${peak.toFixed(3)}`);
  check(peak > 0.4, 'and is still playing', `peak ${peak.toFixed(3)}`);
  const rough = roughest(o.slice(floodFrom - 2), 0);
  check(rough.worst < 2 * KNOT, 'and does not step where it drops the oldest',
        `roughest ${rough.worst.toExponential(2)}, allowed ${(2 * KNOT).toExponential(2)}`);
  const report = sent.filter(x => x && typeof x === 'object' && 'consumed' in x).pop();
  check(!!report, 'it reports what it has consumed',
        report ? `consumed ${report.consumed.toFixed(1)}, ran dry ${report.starved} times` : 'nothing reported');
}

// 4. reset empties it
{
  const { p, feed } = makeProcessor(Math.round(RATE * 0.5));
  const o = [];
  feed(sine(4000)); run(p, 4, o);
  feed('reset');
  const after = [];
  run(p, 8, after);
  let peak = 0; for (const v of after) peak = Math.max(peak, Math.abs(v));
  check(peak < 0.05, 'reset empties the ring', `down to ${peak.toExponential(2)}`);
}

console.log(failures ? `\n${failures} failure(s)` : '\naudio ring ok');
process.exit(failures ? 1 : 0);
