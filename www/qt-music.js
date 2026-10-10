/* qt-music.js -- the game's own tunes, played through QuickTime 3's
   instruments.

   A tune in Cythera Data holds notes and the instrument each part asks for,
   never a sound: QuickTime played it through QuickTime Musical Instruments,
   a set of Roland samples in an extension beside it. The fork synthesises a
   tune itself with a plain harmonic series, which plays the right notes and
   is not the instrument anyone heard. Grimoire reads the real set and plays
   a tune through it (delv/mac-qtmusic.js, a copy of its file; the reading of
   QuickTime's synthesizer is in that file's header), and the fork already
   plays a recording installed for a tune in the tune's place
   (cw_tune_install). So this renders each tune with grimoire's synth and
   hands the page a recording of it, and nothing in the fork changes.

   The instruments are Roland's and Apple's and are not in this repository.
   The page fetches them from archive.org's copy of the QuickTime 3 CD, as
   grimoire does, and keeps the two megabytes it needs.

   Loaded three ways: by the page as a classic script, for the checksum; as
   a worker, by the page, to render off the thread the game runs on (a tune
   takes a second or two on a desktop and several on a phone); and by
   qt_music_smoke.mjs under Node. */

/* The checksum the fork files a substitute under (its tune_stream_checksum):
   acc.rotate_left(5) ^ word over the stream as the runtime reads it, from the
   end of the 'musi' atom up to and including the end marker that falls on an
   event boundary. The marker's value turns up inside longer events, so the
   walk follows event lengths. */
function qtTuneStreamChecksum(data) {
  const u32 = o => ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
  let acc = 0;
  const fold = w => { acc = (((acc << 5) | (acc >>> 27)) ^ w) >>> 0; };
  for (let i = u32(0); i + 4 <= data.length;) {
    const w = u32(i);
    fold(w);
    if (w === 0x60000000) break;
    const ext = w >>> 30, len = ext === 3 ? (w & 0xFFFF) : ext === 2 ? 2 : 1;
    if (len === 0) break;
    for (let k = 1; k < len; k++) {
      if (i + k * 4 + 4 > data.length) return acc;
      fold(u32(i + k * 4));
    }
    i += len * 4;
  }
  return acc;
}

/* What the fork's mixer takes without converting: its Sound Manager channel
   carries unsigned 8-bit samples at 22,050 Hz, and a 16-bit recording is
   reduced to that as it is installed. Rendering to it directly keeps what the
   module holds to 44 KB a second of music. */
const QT_OUT_RATE = 22050;
/* The fork plays a recording to its end before it starts the tune's next
   turn, where QuickTime started the next on time and let the last notes ring
   over it. The synth leaves two seconds for the releases; one is kept, with
   the last third of it faded, so a tune that comes round again is a second
   late and does not end on a cut. */
const QT_TAIL_SECONDS = 1, QT_FADE_SECONDS = 0.3;

/* A tune resource to a WAV the fork installs: { wav, seconds, missing }. */
function qtTuneWav(data, lib) {
  const tune = qtmaTune(data);
  const r = qtmaRender(tune.seq.events, tune.tones, lib, { rate: QT_OUT_RATE, unitsPerSecond: QTMA_UNITS_PER_SECOND });
  const lastUnit = tune.seq.events.reduce((m, e) => Math.max(m, e.t + (e.dur || 0)), 0);
  const n = Math.min(r.left.length, Math.round((lastUnit / QTMA_UNITS_PER_SECOND + QT_TAIL_SECONDS) * QT_OUT_RATE));
  const fade = Math.min(n, Math.round(QT_FADE_SECONDS * QT_OUT_RATE));
  const wav = new Uint8Array(44 + n * 2), dv = new DataView(wav.buffer);
  const tag = (o, s) => { for (let i = 0; i < 4; i++) wav[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, QT_OUT_RATE, true); dv.setUint32(28, QT_OUT_RATE * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 8, true);
  tag(36, 'data'); dv.setUint32(40, n * 2, true);
  const byte = x => Math.max(0, Math.min(255, Math.round(x * 127 + 128)));
  for (let i = 0; i < n; i++) {
    const g = i >= n - fade ? (n - i) / fade : 1;
    wav[44 + 2 * i] = byte(r.left[i] * g);
    wav[45 + 2 * i] = byte(r.right[i] * g);
  }
  return { wav, seconds: n / QT_OUT_RATE, missing: r.missing };
}

/* The worker. It is given the instruments once, as whatever file holds them
   (QUICKTIM.EXE, the .qtx, or the resource fork the page kept from an earlier
   visit), and then one tune at a time. */
if (typeof importScripts === 'function' && typeof document === 'undefined') {
  const v = self.location.search;
  importScripts(...['mac-bytes', 'mac-resfork', 'mac-media', 'mac-vise', 'mac-installshield', 'mac-qtmusic'].map(n => 'delv/' + n + '.js' + v));
  let lib = null;
  self.onmessage = e => {
    const m = e.data;
    try {
      if (m.op === 'instruments') {
        lib = qtInstrumentsFromFile(m.bytes);
        self.postMessage({ op: 'instruments', fork: lib.forkBytes, count: lib.ids.length });
      } else if (m.op === 'tune') {
        const t0 = performance.now();
        const r = qtTuneWav(m.data, lib);
        self.postMessage({ op: 'tune', sum: m.sum, wav: r.wav, seconds: r.seconds, missing: r.missing, ms: performance.now() - t0 }, [r.wav.buffer]);
      }
    } catch (err) {
      self.postMessage({ op: 'error', during: m.op, sum: m.sum, message: String(err && err.message || err) });
    }
  };
}
