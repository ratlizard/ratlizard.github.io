/* mac-qtmusic.js -- QuickTime Musical Instruments, read; and a QTMA tune
   played through them.
   =========================================================================

   WHAT THE GAME SOUNDED LIKE. A QTMA tune holds notes and the instrument each
   part asks for, never a sound. QuickTime played it through QuickTime Musical
   Instruments, a set of 8-bit samples (Roland's "GM/GS Sound Set",
   copyright 1997) in an extension beside QuickTime. So the music as players
   heard it is these samples, and nothing General MIDI plays is it.

   WHICH SET. Two are on the disk, and they differ. QuickTime 2.5's (Mac OS
   7.6) has 61 instruments. QuickTime 3.0's and 4.0's have 235, and they are
   the same 235 byte for byte: the Mac 4.0 copy from the Mac OS 9.0 image
   matched every one inside the Windows 3.0 copy archive.org serves. Cythera
   (1999) came after QuickTime 3, so it is that set this plays. Where the page
   gets it is js/mac-installshield.js's header; how it is read is below.

   THE INSTRUMENTS ARE APPLE'S DOCUMENTED FORMAT, read from QuickTimeMusic.h
   (cythera-reference/apple-documentation/qtma/), not guessed. Each 'ssai'
   resource is a QuickTime atom container: a 12-byte header, then atoms of
   { u32 size, type, u32 id, u16 0, u16 child count, u32 0 } and a body. Its
   root 'sean' holds:
     'tone'  a ToneDescription: the name at +36, instrument and GM number at
             +68 and +72;
     'knbl'  an InstKnobList: count, flags, then { knob, value } pairs, the
             knobs kQTMSKnob* (0x02000000 + n): times in milliseconds,
             levels in 16.16 (65536 is full);
     'sinf'  one per key range, each holding an 'sdsc', an InstSampleDescRec:
             format ('raw ' is 8-bit offset binary), channels, sample size,
             rate 16.16, the sample's id, offset, length, loop type, loop
             start and end, and the key the sample sounds at with the low and
             high keys it covers;
     'smin'  one per sample, id the 'sdsc's sampleDataID, its 'sdat' the PCM.
   The resource id is the instrument number: 1 to 128 the General MIDI
   programs, bank * 128 + program the GS variations, 16384 + n the drum kits.

   WHICH INSTRUMENT A PART GETS. Cythera's tunes ask for GS numbers in banks
   80 and 81 (10455 is bank 81, program 87), which no set has, alongside the
   GM number. QuickTime fell back to the GM number, as far as can be told
   without a recording to compare; the kits (16385, the Standard Kit) are in
   the set as asked. `qtToneInstrument` is that rule.

   THE SYNTHESIS IS OURS, HELD TO QUICKTIME'S WHERE THAT IS READ, which
   since 6 October 2026 is most of it (the QuickTime Music extension of
   QuickTime 4, whose PowerPC synthesizer names its routines; the
   workbench's GRIMOIRE-NOTES.md, under grimoire/qt-instruments-v56peg).
   From its code: each key range's sample and its own knobs over the
   instrument's; the volume envelope with its two scalings (QT_ENV); the
   pitch envelope; the volume and pitch LFOs and the mod wheel that
   deepens them; the velocity window and sensitivity, the pitch
   sensitivity, the transpose; the part's volume and expression, its pan
   or the instrument's own with its key scaling, in the synthesizer's
   straight pan law; the wheel and the sustain pedal; a re-struck note and
   an exclusion group cutting what sounds, and the taking of a voice when
   none is free (QT_VOICES). Measured, not read: how a note's velocity
   becomes its level (QT_VELOCITY_POWER).

   WHAT IS STILL NOT HERE, each for a reason. Reverb: the synthesizer's
   Reverb setting is off by default, and a voice goes to the reverb bus
   only when it is on and the part's reverb controller is at its
   threshold or over. Portamento and the part and tune transposes: the
   synthesizer takes them (controllers 5, 65, 40 and 41) and no shipped
   tune sends them. The "Overall Volume" knob: no instrument in the set
   carries it. Envelope 1 and the filter: the set's instruments name no
   use for either. The output: the synthesizer measures the machine as it
   starts and picks its rate, its interpolation, mono or stereo and 8 or
   16 bits (MeasureMusicPerformance, TryConfiguration and
   SetSynthFeaturesByHardware, by their names; not read), so what a given
   Mac played at is not in the file; this renders at the rate asked for,
   interpolating, in stereo. Controller 33, aftertouch, which the tunes
   send some 4,300 times, is not among the fourteen the synthesizer takes.

   Classic script; the page's global scope. */

const QTMS_KNOB = { attack: 1, decay: 2, sustain: 3, keyToDecay: 5, release: 6, transpose: 0x12,
                    defaultPan: 0x19, panKeyScaling: 0x1A, exclusionGroup: 0x1C,
                    sustainTime: 0x1D, sustainInfinite: 0x1E, velocityLow: 0x20, velocityHigh: 0x21,
                    velocitySensitivity: 0x22, pitchSensitivity: 0x23, logCurves: 0x26,
                    pitchEnvelope: 0x35, pitchEnvelopeDepth: 0x36, velToAttack: 0x3F };
/* THE ENVELOPE IS QUICKTIME'S, read on 6 October 2026 from the QuickTime
   Music extension of QuickTime 4 (the Mac OS 9.0 image; resource 'musk',
   PowerPC, its routines' names in its traceback tables; the workbench's
   GRIMOIRE-NOTES.md has the reading under grimoire/qt-instruments-v56peg).

   StartNoteKeyrange copies the key range's knobs into the voice and calls
   SetADSRStuff with: the attack time times FixPow(knob 0x3F, velocity
   over 128), which the synthesizer calls "Velocity To Attack Time"; the
   decay time times FixPow(knob 5, key over 128), "Key To Decay Time"; the
   sustain level, the sustain time, the release time, and a flag word of
   knob 0x26, "Log Curves", with knob 0x1E, "Infinite Sustain", above it.
   A stage whose bit is set in Log Curves (1 attack, 2 decay, 4 sustain,
   8 release) multiplies the level each step by FixPow(1/65536, step over
   its time): it crosses a factor of 65,536, 96.3 dB, in its time, and a
   decay stops where it meets the sustain level. A stage whose bit is
   clear moves in a straight line. With Infinite Sustain the level holds
   until the key comes up; without, it falls to nothing over the sustain
   time. A voice ends when its level is under 1/65,536. Every instrument
   in the set has Log Curves 14 and Infinite Sustain 1, and a knob an
   instrument leaves out has the default in the synthesizer's 'SSkn'
   resource: decay 1,000 ms, sustain a half, sustain time 5,000 ms,
   release 180 ms, Log Curves 4, both scalings 1.

   Before this the envelope was a guess from the knobs' names: a fall of
   72 dB in the decay time spread to end on the sustain level, the two
   scalings unused, and a kit's note played to its sample's end whatever
   its length. The kit needs no rule of its own: its release is 40 s. */
const QT_ENV = { span: 1 / 65536, floor: 1 / 65536 };
/* HOW LOUD A NOTE IS, where the reading and the recordings disagree. The
   synthesizer takes a note's level as (velocity + 1) / 128 times its
   velocity sensitivity (StartNoteKeyrange; 100 per cent in every
   instrument), and multiplies it by the part's volumes and the envelope,
   all in straight proportion (Serve_This_One). Held to the soundtrack's
   "(Classic)" recordings of the eleven tunes, though, the square of that
   level is nearer than the level itself on every tune, by the spectrum,
   the onsets and the loudness contour, with this envelope as with the
   guessed one (the workbench's tools/qtma-fit/). So something ahead of the
   synthesizer would have to shape velocity, and nothing does: the tune
   player hands NAPlayNote the event's seven bits and the note allocator
   hands MusicPlayNote the same number (both 68K, in the same extension,
   read the same day), and the mixers multiply a sample by the gain and
   shift. So by its code QuickTime is in straight proportion from the
   event to the output, and the recordings are not: either they were not
   made by QuickTime itself (a SoundFont synthesizer playing these same
   samples squares velocity as a matter of course), or something outside
   the three components does it. The square is used because it is what
   the recordings sound like; a capture of the game playing in an
   emulated Mac would settle it. opts.velExp overrides it. */
const QT_VELOCITY_POWER = 2;
/* How many notes sound at once. The synthesizer asks for 14 by default
   ('SSkn': Requested Polyphony, 1 to 48) and then sets its features by the
   machine (SetSynthFeaturesByHardware), so what a given Mac had is not in
   the file. Held to the recordings, a limit of 14 is worse than none on
   three tunes (Seldane's spectrum 0.984 to 0.957) and 24 is the same as
   none, so whatever made the recordings had more than 14; 32 leaves the
   tunes as they are and keeps the rule in play for a denser one. */
const QT_VOICES = 32;
const QT_CUT_FRAMES = rate => Math.max(8, Math.round(rate * 0.004));

/* A TUNE'S LAYOUT AND ITS READER. The bit fields are Apple's, from
   QuickTimeMusic.h (Universal Interfaces 3.3.1). Durations are in the
   tune's own time scale, which Cythera sets to 600 a second (GMSInit).
   These were in js/page-export.js until 9 October 2026 and came here so
   that this file, with the readers it names, plays a tune without the
   page: the browser player takes it as it is. */
// The time scale Cythera's GMSInit gives its tunes.
const QTMA_UNITS_PER_SECOND = 600;
const QTMA = {
  RestEventType:0, NoteEventType:1, ControlEventType:2, MarkerEventType:3,
  XNoteEventType:0x9, XControlEventType:0xA, GeneralEventType:0xF,
  EventLengthFieldPos:30, EventLengthFieldWidth:2,
  EventTypeFieldPos:29, EventTypeFieldWidth:3,
  XEventTypeFieldPos:28, XEventTypeFieldWidth:4,
  EventPartFieldPos:24, EventPartFieldWidth:5,
  XEventPartFieldPos:16, XEventPartFieldWidth:12,
  RestDurPos:0, RestDurWidth:24,
  NotePitchPos:18, NotePitchWidth:6, NotePitchOffset:32,
  NoteVolPos:11, NoteVolWidth:7,
  NoteDurPos:0, NoteDurWidth:11,
  XNotePitchPos:0, XNotePitchWidth:16,
  XNoteDurPos:0, XNoteDurWidth:22,
  XNoteVolPos:22, XNoteVolWidth:7,
  CtlControllerPos:16, CtlControllerWidth:8,
  CtlValuePos:0, CtlValueWidth:16,
  MarkerSubtypePos:16, MarkerSubtypeWidth:8,
  MarkerValuePos:0, MarkerValueWidth:16,
  GeneralSubtypePos:16, GeneralSubtypeWidth:14,
  GeneralLengthPos:0, GeneralLengthWidth:16,
  GeneralEventNoteRequest:1,
  MarkerEventEnd:0,
  EndMarkerValue:0x60000000
};
function qEXT(val, pos, width){ return (val >>> pos) & ((width>=32)?0xFFFFFFFF:((1<<width)-1)); }
function qEventType(x){
  const t = qEXT(x, QTMA.EventTypeFieldPos, QTMA.EventTypeFieldWidth);
  return (t>3) ? qEXT(x, QTMA.XEventTypeFieldPos, QTMA.XEventTypeFieldWidth) : t;
}
function qEventLenLongs(words, i){
  const x = words[i];
  const ext = qEXT(x, QTMA.EventLengthFieldPos, QTMA.EventLengthFieldWidth);
  if (ext !== 3) return (ext === 2) ? 2 : 1;
  return qEXT(x, QTMA.GeneralLengthPos, QTMA.GeneralLengthWidth);
}
function qExtractGmFromNoteReq(bytes){
  // NoteRequest = NoteRequestInfo(8) + ToneDescription(76);
  // gmNumber is the last long of ToneDescription.
  if (bytes.length < 8+76) return null;
  const o = 8+72;
  const gm = u32be(bytes, o);
  return (gm>=0 && gm<=128) ? gm : null;
}
function qParseTune(words){
  const events = [], noteRequests = {}, tones = {};
  let t = 0, i = 0;
  const n = words.length;
  let guard = 0;
  while (i < n && guard++ < 500000) {
    const x = words[i];
    if (x === QTMA.EndMarkerValue) break;
    const ln = qEventLenLongs(words, i);
    if (ln <= 0 || i + ln > n) break;
    const et = qEventType(x);
    if (et === QTMA.RestEventType) {
      t += qEXT(x, QTMA.RestDurPos, QTMA.RestDurWidth);
    } else if (et === QTMA.NoteEventType) {
      events.push({t, k:'note',
        part: qEXT(x, QTMA.EventPartFieldPos, QTMA.EventPartFieldWidth),
        pitch: qEXT(x, QTMA.NotePitchPos, QTMA.NotePitchWidth) + QTMA.NotePitchOffset,
        vol: qEXT(x, QTMA.NoteVolPos, QTMA.NoteVolWidth),
        dur: qEXT(x, QTMA.NoteDurPos, QTMA.NoteDurWidth)});
    } else if (et === QTMA.XNoteEventType) {
      const w1 = words[i], w2 = words[i+1];
      events.push({t, k:'note',
        part: qEXT(w1, QTMA.XEventPartFieldPos, QTMA.XEventPartFieldWidth),
        pitch: qEXT(w1, QTMA.XNotePitchPos, QTMA.XNotePitchWidth),
        vol: qEXT(w2, QTMA.XNoteVolPos, QTMA.XNoteVolWidth),
        dur: qEXT(w2, QTMA.XNoteDurPos, QTMA.XNoteDurWidth)});
    } else if (et === QTMA.ControlEventType) {
      events.push({t, k:'ctl',
        part: qEXT(x, QTMA.EventPartFieldPos, QTMA.EventPartFieldWidth),
        ctl: qEXT(x, QTMA.CtlControllerPos, QTMA.CtlControllerWidth),
        val: qEXT(x, QTMA.CtlValuePos, QTMA.CtlValueWidth)});
    } else if (et === QTMA.MarkerEventType) {
      const sub = qEXT(x, QTMA.MarkerSubtypePos, QTMA.MarkerSubtypeWidth);
      const val = qEXT(x, QTMA.MarkerValuePos, QTMA.MarkerValueWidth);
      if (sub === QTMA.MarkerEventEnd && val === 0) break;
    } else if (et === QTMA.GeneralEventType) {
      const w1 = words[i], wlast = words[i+ln-1];
      const part = qEXT(w1, QTMA.XEventPartFieldPos, QTMA.XEventPartFieldWidth);
      const sub = qEXT(wlast, QTMA.GeneralSubtypePos, QTMA.GeneralSubtypeWidth);
      if (sub === QTMA.GeneralEventNoteRequest && ln >= 4) {
        const nb = new Uint8Array((ln-2)*4);
        for (let k=0;k<ln-2;k++){
          const w = words[i+1+k];
          nb[k*4]=(w>>>24)&0xFF; nb[k*4+1]=(w>>>16)&0xFF;
          nb[k*4+2]=(w>>>8)&0xFF; nb[k*4+3]=w&0xFF;
        }
        const gm = qExtractGmFromNoteReq(nb);
        if (gm !== null) noteRequests[part] = gm;
        // The whole request, for playing through QuickTime's own instruments
        // (js/mac-qtmusic.js), which a kit's 16385 needs and the GM number drops.
        if (nb.length >= 8+76)
          tones[part] = {instrument: u32be(nb, 8+68) | 0, gm: u32be(nb, 8+72) | 0};
      }
    }
    i += ln;
  }
  return {events, noteRequests, tones};
}
/* A tune resource read: its 'musi' atom is the header, whose note requests
   name each part's instrument, and the events follow it. Returns the two
   as qParseTune reads them and the parts' tones, the stream's over the
   header's. */
function qtmaTune(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 8) throw new Error('Resource too short to be a QTMA tune.');
  const musiLen = dv.getUint32(0);
  const atom = fourcc(data, 4);
  if (atom !== 'musi')
    throw new Error("Not a QTMA 'musi' atom (found '" + atom + "').");
  const toWords = (start, end) => {
    let len = end - start; len -= len % 4;
    const w = new Array(len/4);
    for (let k=0;k<len/4;k++) w[k] = dv.getUint32(start + k*4);
    return w;
  };
  const hdr = qParseTune(toWords(8, musiLen));
  const seq = qParseTune(toWords(musiLen, data.length));
  return { hdr, seq, tones: Object.assign({}, hdr.tones, seq.tones) };
}

/* The resource fork of a QuickTime extension. A Mac file's is its own; a
   Windows .qtx is a small PE image with the fork after its last section. */
function qtxResourceFork(bytes) {
  if (bytes.length > 0x40 && bytes[0] === 0x4D && bytes[1] === 0x5A) {
    const le32 = o => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    const pe = le32(0x3C);
    if (bytes[pe] !== 0x50 || bytes[pe + 1] !== 0x45) throw new Error('an MZ file with no PE header');
    const sections = bytes[pe + 6] | (bytes[pe + 7] << 8);
    const opt = bytes[pe + 20] | (bytes[pe + 21] << 8);
    let end = 0;
    for (let i = 0; i < sections; i++) {
      const s = pe + 24 + opt + 40 * i;
      end = Math.max(end, le32(s + 20) + le32(s + 16));
    }
    return bytes.subarray(end);
  }
  return bytes;
}

/* Every atom under [start, end), depth first, each { type, id, start, end, depth }
   with start and end the body's. */
function qtAtoms(bytes, start, end, depth, out) {
  out = out || [];
  depth = depth || 0;
  let o = start;
  while (o + 20 <= end) {
    const size = u32be(bytes, o);
    if (size < 20 || o + size > end) throw new Error('an atom of ' + size + ' bytes at ' + o + ' does not fit');
    const atom = { type: String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]),
                   id: u32be(bytes, o + 8), start: o + 20, end: o + size, depth };
    out.push(atom);
    if (u16be(bytes, o + 14)) qtAtoms(bytes, o + 20, o + size, depth + 1, out);
    o += size;
  }
  return out;
}

/* One 'ssai' resource, read. Its samples may be in another instrument's
   resource: of the 1,544 key ranges in the QuickTime 3 set, the GS
   variations' borrow the base instrument's samples (an 'iref' beside the
   'sdsc' names it), and sample ids are unique across the whole set, so
   `sampleOf(id)` looks one up wherever it is. A key range may carry a 'knbl'
   of its own, which overrides the instrument's: 535 of them carry a whole
   envelope, 319 a transpose (knob 0x12, semitones in 8.8). */
function qtAtomicInstrument(bytes, sampleOf) {
  const atoms = qtAtoms(bytes, 12, bytes.length);
  const s32 = o => u32be(bytes, o) | 0;
  const knobsIn = a => {
    const out = {}, n = u32be(bytes, a.start);
    for (let k = 0; k < n; k++) {
      const id = u32be(bytes, a.start + 8 + 8 * k);
      if ((id & 0xFF000000) === 0x02000000) out[id & 0xFFFF] = s32(a.start + 12 + 8 * k);
    }
    return out;
  };
  const inst = { name: '', number: 0, gm: 0, knobs: {}, regions: [] };
  let region = null;
  for (const a of atoms) {
    if (a.depth === 1 && a.type === 'tone') {
      inst.name = decodeMacRoman(bytes.subarray(a.start + 37, a.start + 37 + bytes[a.start + 36])).trim();
      inst.number = s32(a.start + 68); inst.gm = s32(a.start + 72);
    } else if (a.depth === 1 && a.type === 'knbl') {
      inst.knobs = knobsIn(a);
    } else if (a.depth === 1) {
      region = null;
    } else if (a.depth === 2 && a.type === 'sdsc') {
      const o = a.start;
      region = {
        format: String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]),
        channels: u16be(bytes, o + 4), bits: u16be(bytes, o + 6), rate: u32be(bytes, o + 8) / 65536,
        sampleId: u16be(bytes, o + 12), offset: s32(o + 14), length: s32(o + 18),
        loopType: s32(o + 22), loopStart: s32(o + 26), loopEnd: s32(o + 30),
        root: s32(o + 34), low: s32(o + 38), high: s32(o + 42), knobs: {} };
      inst.regions.push(region);
    } else if (a.depth === 2 && a.type === 'knbl' && region) {
      region.knobs = knobsIn(a);
    }
  }
  for (const r of inst.regions) {
    r.knobs = Object.assign({}, inst.knobs, r.knobs);
    const raw = sampleOf(r.sampleId);
    if (!raw) throw new Error('"' + inst.name + '" names sample ' + r.sampleId + ', which the set does not hold');
    if (r.channels !== 1 || !((r.format === 'raw ' && r.bits === 8) || (r.format === 'twos' && r.bits === 16)))
      throw new Error('"' + inst.name + '" has a ' + r.channels + '-channel ' + r.bits + '-bit \'' + r.format + '\' sample');
    const n = Math.max(0, Math.min(r.length, (raw.length - r.offset) / (r.bits / 8) | 0));
    const pcm = new Float32Array(n);
    if (r.bits === 8) for (let i = 0; i < n; i++) pcm[i] = (raw[r.offset + i] - 128) / 128;
    else for (let i = 0; i < n; i++) pcm[i] = ((raw[r.offset + 2 * i] << 24 >> 16) | raw[r.offset + 2 * i + 1]) / 32768;
    r.pcm = pcm;
  }
  return inst;
}

/* A set of instruments from a resource fork: { ids, has(n), get(n) }.
   Instruments are read the first time one is asked for; the samples' index
   is built across every instrument the first time any is. */
function qtInstrumentLibrary(forkBytes) {
  const fork = openResourceFork(forkBytes);
  const entries = fork.resourcesByType['ssai'] || [];
  if (!entries.length) throw new Error('no instruments (\'ssai\' resources) in this file');
  const byId = new Map(entries.map(e => [e.id, e]));
  const read = new Map();
  let samples = null;
  const sampleOf = id => {
    if (!samples) {
      samples = new Map();
      for (const e of entries) {
        const d = fork.dataOf('ssai', e);
        let smin = null;
        for (const a of qtAtoms(d, 12, d.length)) {
          if (a.depth === 1) smin = a.type === 'smin' ? a.id : null;
          else if (a.depth === 2 && a.type === 'sdat' && smin !== null) samples.set(smin, d.subarray(a.start, a.end));
        }
      }
    }
    return samples.get(id);
  };
  return {
    forkBytes,
    ids: [...byId.keys()].sort((a, b) => a - b),
    has: n => byId.has(n),
    get(n) {
      if (!read.has(n)) read.set(n, byId.has(n) ? qtAtomicInstrument(fork.dataOf('ssai', byId.get(n)), sampleOf) : null);
      return read.get(n);
    }
  };
}

/* The instruments from whatever the visitor or archive.org handed over:
   QuickTime 3's Windows installer (QUICKTIM.EXE), its data.z, the .qtx, or a
   Mac file's resource fork. */
function qtInstrumentsFromFile(bytes) {
  if (bytes[0] === 0x4D && bytes[1] === 0x5A) {
    const dataZ = qtInstallerDataZ(bytes);
    if (dataZ) return qtInstrumentsFromFile(dataZ);
    return qtInstrumentLibrary(qtxResourceFork(bytes));
  }
  if (looksLikeInstallShield3(bytes)) {
    const arc = parseInstallShield3(bytes);
    const e = arc.entries.find(x => /QuickTimeMusicalInstruments\.qtx$/i.test(x.path));
    if (!e) throw new Error('this installer does not hold QuickTimeMusicalInstruments.qtx');
    return qtInstrumentLibrary(qtxResourceFork(installShield3File(bytes, e)));
  }
  return qtInstrumentLibrary(bytes);
}

/* QUICKTIM.EXE is a self-extracting zip whose central directory does not
   agree with where its entries are (7-Zip says the same), so the one entry
   is taken from its local header, which carries the sizes, and held to its
   CRC-32. Returns null for an .exe that holds no data.z. */
function qtInstallerDataZ(exe) {
  const le16 = o => exe[o] | (exe[o + 1] << 8);
  const le32 = o => (exe[o] | (exe[o + 1] << 8) | (exe[o + 2] << 16) | (exe[o + 3] << 24)) >>> 0;
  for (let h = 0; h + 30 < exe.length; h++) {
    if (exe[h] !== 0x50 || exe[h + 1] !== 0x4B || exe[h + 2] !== 3 || exe[h + 3] !== 4) continue;
    const nameLen = le16(h + 26);
    const name = String.fromCharCode(...exe.subarray(h + 30, h + 30 + nameLen));
    if (!/(^|[\\/])data\.z$/i.test(name)) continue;
    const method = le16(h + 8), crc = le32(h + 14), packed = le32(h + 18), len = le32(h + 22);
    const start = h + 30 + nameLen + le16(h + 28);
    let out;
    if (method === 0) out = exe.slice(start, start + len);
    else if (method === 8) out = inflateRaw(exe.subarray(start, start + packed), len, 8);
    else throw new Error('data.z is packed with zip method ' + method);
    if (crc32(out) !== crc) throw new Error('data.z fails its CRC-32');
    return out;
  }
  return null;
}

function qtToneInstrument(lib, tone) {
  if (!tone) return null;
  if (lib.has(tone.instrument)) return lib.get(tone.instrument);
  if (tone.instrument >= 16384 && lib.has(16385)) return lib.get(16385);
  if (tone.gm >= 1 && tone.gm <= 128 && lib.has(tone.gm)) return lib.get(tone.gm);
  return null;
}

/* Play a tune's events (qParseTune's: times and lengths in 1/unitsPerSecond)
   through the instruments. Returns { left, right, rate, missing }: two
   Float32Arrays scaled so the loudest sample is just under full, and the
   parts whose instrument the set does not have. */
function qtmaRender(events, tones, lib, opts) {
  opts = opts || {};
  const rate = opts.rate || 44100, ups = opts.unitsPerSecond || 600;
  const tail = 2;   // seconds after the last note for releases to ring out
  // opts.lastUnit and opts.raw are for rendering one part of a tune on its
  // own, as long as the whole and at the level it has in the whole.
  const lastUnit = opts.lastUnit || events.reduce((m, e) => Math.max(m, e.t + (e.dur || 0)), 0);
  const frames = Math.ceil((lastUnit / ups + tail) * rate);
  const left = new Float32Array(frames), right = new Float32Array(frames);

  const parts = {};
  const missing = [];
  const partOf = p => {
    if (!parts[p]) {
      const inst = qtToneInstrument(lib, tones[p]);
      if (!inst && tones[p]) missing.push(p);
      parts[p] = { inst, volume: 1, pan: 0.5, bend: 0, sustain: false, held: [] };
    }
    return parts[p];
  };

  // Controllers and notes in time order. A voice takes the part's state
  // as it starts and follows the wheel and the mod wheel while it sounds.
  const ctlTimeline = {};
  for (const e of events) if (e.k === 'ctl') (ctlTimeline[e.part] = ctlTimeline[e.part] || []).push(e);
  const fixed = v => (v >= 0x8000 ? v - 0x10000 : v) / 256;
  const stateAt = (p, t) => {
    const s = { volume: 1, expression: 1, pan: 0, bend: 0, wheel: 0, sustainOffAfter: null };
    let sustainOn = false;
    for (const e of ctlTimeline[p] || []) {
      if (e.t > t) {
        if (sustainOn && e.ctl === 64 && fixed(e.val) <= 0) { s.sustainOffAfter = e.t; break; }
        continue;
      }
      const v = fixed(e.val);
      if (e.ctl === 7) s.volume = Math.max(0, Math.min(127, v)) / 127;
      else if (e.ctl === 11) s.expression = Math.max(0, Math.min(127, v)) / 127;
      else if (e.ctl === 10) s.pan = v;
      else if (e.ctl === 32) s.bend = v;
      else if (e.ctl === 1) s.wheel = Math.max(0, v);
      else if (e.ctl === 64) sustainOn = v > 0;
    }
    s.sustainOn = sustainOn;
    return s;
  };
  const liveSteps = (p, t0, t1) => (ctlTimeline[p] || []).filter(e => (e.ctl === 32 || e.ctl === 1) && e.t > t0 && e.t < t1);

  /* An envelope, stepped a frame at a time (QT_ENV has the reading): times
     in frames, `logs` the stage's bit of Log Curves shifted down to 1
     attack, 2 decay, 4 sustain, 8 release. */
  const makeEnv = (attack, decay, susLevel, susTime, forever, release, logs) => {
    const fall = n => Math.pow(QT_ENV.span, 1 / Math.max(1, n));
    const decayMul = fall(decay), susMul = fall(susTime), relMul = fall(release);
    const decayAdd = (susLevel - 1) / Math.max(1, decay), susAdd = -susLevel / Math.max(1, susTime);
    const atkMul = Math.pow(1 / QT_ENV.span, 1 / Math.max(1, attack));
    const en = { level: (logs & 1) ? QT_ENV.floor : 0, stage: attack >= 1 ? 1 : 2 };
    if (en.stage === 2) en.level = 1;
    let relAdd = 0;
    en.off = () => { if (en.stage && en.stage !== 4) { en.stage = 4; relAdd = -en.level / Math.max(1, release); } };
    en.tick = () => {
      if (en.stage === 1) {
        en.level = (logs & 1) ? en.level * atkMul : en.level + 1 / attack;
        if (en.level >= 1) { en.level = 1; en.stage = 2; }
      } else if (en.stage === 2) {
        en.level = (logs & 2) ? en.level * decayMul : en.level + decayAdd;
        if (en.level <= susLevel) { en.level = susLevel; en.stage = 3; }
      } else if (en.stage === 3) {
        if (!forever) en.level = (logs & 4) ? en.level * susMul : en.level + susAdd;
      } else if (en.stage === 4) en.level = (logs & 8) ? en.level * relMul : en.level + relAdd;
      if (en.level <= QT_ENV.floor && en.stage > 1) { en.level = 0; en.stage = 0; }
    };
    return en;
  };
  /* An LFO's value `ms` into its note (AdvanceLFO): nothing until its
     delay, then the shape, from -1 to 1 by where the phase is in its
     period, times the depth, plus the offset, all scaled up from nothing
     over the ramp. The shapes, in the synthesizer's order from 1: sine,
     triangle, rising saw, falling saw, a square of 1 and 0, a square of -1
     and 1, and a random level held for a period. */
  const lfoAt = (l, ms, depth) => {
    if (ms < l.delay || !(l.period > 0)) return 0;
    const ph = (ms / l.period) % 1;
    let x;
    switch (l.shape) {
      case 1: x = Math.sin(2 * Math.PI * ph); break;
      case 2: x = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
      case 3: x = 2 * ph - 1; break;
      case 4: x = 1 - 2 * ph; break;
      case 5: x = ph > 0.5 ? 0 : 1; break;
      case 6: x = ph > 0.5 ? 1 : -1; break;
      case 7: { const n = Math.floor(ms / l.period) + l.seed; const r = Math.sin(n * 12.9898) * 43758.5453; x = 2 * (r - Math.floor(r)) - 1; break; }
      default: return 0;
    }
    const full = x * depth + l.offset;
    return l.ramp > 0 && ms - l.delay < l.ramp ? full * (ms - l.delay) / l.ramp : full;
  };

  const maxVoices = opts.voices || QT_VOICES;
  let voices = [], stolen = 0;
  const notes = events.filter(e => e.k === 'note' && e.vol !== 0).map((e, n) => [e, n]).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]).map(x => x[0]);
  for (const e of notes) {
    const part = partOf(e.part);
    const inst = part.inst;
    if (!inst) continue;
    const region = inst.regions.find(r => e.pitch >= r.low && e.pitch <= r.high)
      || inst.regions.reduce((b, r) => (!b || Math.abs(r.root - e.pitch) < Math.abs(b.root - e.pitch) ? r : b), null);
    if (!region || !region.pcm.length) continue;
    const k = region.knobs;
    const knob = (id, dflt) => k[id] === undefined ? dflt : k[id];
    // A key range answers only the velocities between its two knobs.
    if (e.vol < knob(QTMS_KNOB.velocityLow, 0) || e.vol > knob(QTMS_KNOB.velocityHigh, 127)) continue;
    const st = stateAt(e.part, e.t);
    let offUnit = e.t + Math.max(e.dur, 1);
    if (st.sustainOn) offUnit = Math.max(offUnit, st.sustainOffAfter == null ? lastUnit : st.sustainOffAfter);

    /* The envelopes, as StartNoteKeyrange hands them to SetADSRStuff (the
       account is over QT_ENV). The volume envelope's attack is the knob's
       time times "Velocity To Attack Time" raised to the velocity over
       128, its decay the knob's times "Key To Decay Time" raised to the
       key over 128. Envelope 2 has knobs of its own and no scaling; it is
       the pitch envelope where knob 0x35 names it, as every instrument in
       the set does. */
    const ms = v => v / 1000 * rate;
    const env = makeEnv(
      ms(knob(QTMS_KNOB.attack, 0) * Math.pow(knob(QTMS_KNOB.velToAttack, 65536) / 65536, e.vol / 128)),
      ms(knob(QTMS_KNOB.decay, 1000) * Math.pow(knob(QTMS_KNOB.keyToDecay, 65536) / 65536, e.pitch / 128)),
      knob(QTMS_KNOB.sustain, 32768) / 65536, ms(knob(QTMS_KNOB.sustainTime, 5000)), !!knob(QTMS_KNOB.sustainInfinite, 0),
      ms(knob(QTMS_KNOB.release, 180)), knob(QTMS_KNOB.logCurves, 4));
    const pitchEnvPick = knob(QTMS_KNOB.pitchEnvelope, 0), pitchEnvDepth = knob(QTMS_KNOB.pitchEnvelopeDepth, 0) / 256;
    const eb = pitchEnvPick === 1 ? 0x27 : 0x2E;   // envelope 1's knobs begin at 0x27, envelope 2's at 0x2E
    const penv = (pitchEnvPick === 1 || pitchEnvPick === 2) && pitchEnvDepth
      ? makeEnv(ms(knob(eb, 0)), ms(knob(eb + 1, 1000)), knob(eb + 2, 32768) / 65536, ms(knob(eb + 3, 5000)), !!knob(eb + 4, 0), ms(knob(eb + 5, 180)), knob(eb + 6, 4))
      : null;
    const looped = region.loopEnd > region.loopStart;

    /* How loud (Serve_This_One): the note's level, which is velocity plus
       one over 128 moved about a half by the velocity sensitivity knob,
       times the part's volume and its expression, the envelope, and one
       plus the volume LFO. */
    const vel = Math.max(0, ((e.vol + 1) / 128 - 0.5) * knob(QTMS_KNOB.velocitySensitivity, 100) / 100 + 0.5);
    const gain = Math.pow(vel, opts.velExp || QT_VELOCITY_POWER) * Math.pow(st.volume * st.expression, opts.volExp || 1);
    /* Where (the same routine): the part's pan controller, 1 to 2 in 8.8,
       or the instrument's "Default Pan Position" when the controller is
       under 1, moved by the key's distance from middle C times "Key
       Scaling"; then the right channel is the gain times that position
       from 0 to 2 and the left the gain times 2 less it, a straight law
       with both at the gain in the middle. */
    const panRaw = st.pan >= 1 ? st.pan * 256 : knob(QTMS_KNOB.defaultPan, 384);
    const pan = Math.max(0, Math.min(2, ((panRaw < 256 || panRaw > 512 ? 384 : panRaw) - 256) / 128 + knob(QTMS_KNOB.panKeyScaling, 0) * (e.pitch - 60) / 8192));
    const pl = 2 - pan, pr = pan;
    const f0 = Math.round(e.t / ups * rate);
    const offFrame = Math.round(offUnit / ups * rate) - f0;
    const steps = liveSteps(e.part, e.t, offUnit).map(c => [Math.round(c.t / ups * rate) - f0, c.ctl, fixed(c.val)]);
    let bend = st.bend, wheel = st.wheel, nextStep = 0;
    /* The pitch (Handle_PitchStep): the key, scaled about middle C by the
       pitch sensitivity knob, plus the transpose knob, the wheel, the pitch
       LFO and the pitch envelope's level times its depth. The mod wheel
       adds to each LFO's depth its "from wheel" knob for a full wheel. */
    const key = 60 + (e.pitch - 60) * knob(QTMS_KNOB.pitchSensitivity, 100) / 100;
    const transpose = knob(QTMS_KNOB.transpose, 0) / 256;
    const lfoP = { shape: knob(0x16, 1), delay: knob(0x13, 0), ramp: knob(0x14, 50), period: knob(0x15, 250), offset: knob(0x1B, 0) / 256, seed: f0 };
    const lfoV = { shape: knob(0x0A, 1), delay: knob(0x07, 20), ramp: knob(0x08, 50), period: knob(0x09, 250), offset: 0, seed: f0 + 7 };
    const depthP = () => (knob(0x17, 0) + wheel * 256 * knob(0x25, 16) / 32768) / 256;
    const depthV = () => (knob(0x0B, 0) + wheel * 256 * knob(0x24, 49152) / 32768) / 65536;
    const base = region.rate / rate;
    const msPerFrame = 1000 / rate;

    const pcm = region.pcm, loopLen = region.loopEnd - region.loopStart + 1;
    let pos = 0, i = 0, step = 0, trem = 1;
    const v = { part: e.part, pitch: e.pitch, region, born: f0, group: knob(QTMS_KNOB.exclusionGroup, 0), stage: env.stage };
    // The pitch and the tremolo are worked out every 32 frames, under a
    // millisecond, which is finer than the synthesizer's own step.
    const control = () => {
      const t = i * msPerFrame;
      const semis = key - region.root + transpose + bend + lfoAt(lfoP, t, depthP()) + (penv ? penv.level * pitchEnvDepth : 0);
      step = base * Math.pow(2, semis / 12);
      trem = Math.max(0, 1 + lfoAt(lfoV, t, depthV()));
    };
    const one = () => {
      let ip = pos | 0;
      if (looped && ip > region.loopEnd) { pos -= loopLen * Math.floor((pos - region.loopStart) / loopLen); ip = pos | 0; }
      if (ip >= pcm.length - 1 && !looped) { v.stage = 0; return; }
      const frac = pos - ip;
      const a = pcm[ip], b = ip + 1 < pcm.length ? pcm[ip + 1] : a;
      const smp = (a + (b - a) * frac) * env.level * gain * trem;
      left[f0 + i] += smp * pl; right[f0 + i] += smp * pr;
      pos += step;
    };
    // Play on to frame `upto` of the tune, or to the voice's end.
    v.run = upto => {
      for (; v.stage && f0 + i < upto; i++) {
        let moved = (i & 31) === 0;
        while (nextStep < steps.length && i >= steps[nextStep][0]) { const c = steps[nextStep++]; if (c[1] === 32) bend = c[2]; else wheel = Math.max(0, c[2]); moved = true; }
        if (i >= offFrame && env.stage !== 4) { env.off(); if (penv) penv.off(); }
        env.tick();
        if (penv) penv.tick();
        v.stage = env.stage;
        if (!v.stage) break;
        if (moved) control();
        one();
      }
    };
    // Cut short, as the synthesizer's fast release does within one of its
    // steps: a few milliseconds' straight fall, so the cut does not click.
    v.cut = at => {
      v.run(at);
      const n = Math.min(QT_CUT_FRAMES(rate), frames - (f0 + i));
      const from = env.level;
      for (let c = 0; v.stage && c < n; c++, i++) { env.level = from * (1 - (c + 1) / n); one(); }
      v.stage = 0;
    };

    /* The voices, as StartNoteKeyrange takes one. A note struck again on
       its part and key while the last still sounds cuts the last, and so
       does a note of the same part in the same exclusion group, which is
       how a kit's closed hat stops its open one. Then a
       free voice is taken; with none free, the one that scores highest
       goes: one already being cut, then one in its release, then any,
       and the oldest among equals. */
    for (const o of voices) o.run(f0);
    voices = voices.filter(o => o.stage);
    for (const o of voices) if (o.part === v.part && ((o.pitch === v.pitch && o.region === v.region) || (v.group && o.group === v.group))) o.cut(f0);
    voices = voices.filter(o => o.stage);
    if (voices.length >= maxVoices) {
      let best = voices[0];
      for (const o of voices) {
        const so = o.stage === 4 ? 1 : 0, sb = best.stage === 4 ? 1 : 0;
        if (so > sb || (so === sb && o.born < best.born)) best = o;
      }
      best.cut(f0);
      voices = voices.filter(o => o.stage);
      stolen++;
    }
    voices.push(v);
  }
  for (const o of voices) o.run(frames);

  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  if (peak > 0 && !opts.raw) { const g = 0.95 / peak; for (let i = 0; i < frames; i++) { left[i] *= g; right[i] *= g; } }
  return { left, right, rate, missing, stolen };
}

/* ===========================================================================
   A TUNE WRITTEN, and a MIDI file made into one (6 October 2026).

   The page has read QTMA tunes since it began (qParseTune, js/page-export.js)
   and never written one. This is the other direction, from Apple's
   QuickTimeMusic.h: every event below is built the way its qtma_Stuff*
   macros build it.

   WHAT A TUNE RESOURCE IS. A 'musi' sample description, { long size, 'musi',
   six zero bytes, short 1, long flags }, whose remaining bytes are the tune
   header: for each part a MIDI channel event (general event 8, one long),
   a used-notes event (general event 11, four longs, a bit a key from the
   top bit of the first long down), and a note request (general event 1, a
   NoteRequestInfo of eight bytes and a ToneDescription of 76: the
   synthesizer's type and name, the instrument's name, its number and its
   General MIDI number), then an end marker. After the description comes
   the sequence: a tempo marker, then rests, notes and controllers, and an
   end marker. The shipped tunes also carry beat markers and "tune
   difference" events, which hold the controllers' state for a player that
   starts part way in; a player that starts at the start needs neither, and
   they are not written.

   WHAT IS TAKEN FROM THE TUNE BEING REPLACED, since nothing here should
   know Cythera's files by heart: the sample description's flags, the
   NoteRequestInfo and the synthesizer's type and name. A part's instrument
   name is the instrument library's when the page has it and empty
   otherwise; QuickTime finds an instrument by its number.

   WHAT A MIDI FILE BECOMES. Times go through the file's tempo map to the
   tune's units, 600 a second in Cythera (QTMA_UNITS_PER_SECOND). Each
   channel and program that sounds a note is a part, at most 32, the count
   a short event's part field holds. A program is General MIDI number
   program + 1; channel 10 is the kit, instrument 16385. Controllers 1, 7,
   10, 11, 64 and 91, the pitch wheel and channel pressure become QuickTime's
   (8.8 fixed; pan 1 to 2; the wheel in semitones at the range the file
   sets, two by default). Everything else is counted and left out, and the
   count is returned so the page can say so.

   utilities/midi_import_check.mjs holds this to the shipped tunes: each
   one's header rebuilt from what was read out of it is the shipped header
   byte for byte, and each tune made into MIDI and back has its notes and
   controllers where they were. */
function qtmaWords(longs) {
  const out = new Uint8Array(longs.length * 4);
  for (let i = 0; i < longs.length; i++) { const w = longs[i] >>> 0; out[i * 4] = w >>> 24; out[i * 4 + 1] = (w >>> 16) & 255; out[i * 4 + 2] = (w >>> 8) & 255; out[i * 4 + 3] = w & 255; }
  return out;
}
// A general event: its length in longs at both ends, its subtype in the last.
function qtmaGeneral(part, subtype, bodyLongs) {
  const n = bodyLongs.length + 2;
  return [((0xF << 28) | (part << 16) | n) >>> 0, ...bodyLongs, ((3 << 30) | (subtype << 16) | n) >>> 0];
}
/* What a tune's header says of each part, and the description's flags: the
   reading the writer is checked against, and where an import takes what it
   does not make up. */
function qtmaHeaderParts(data) {
  const size = u32be(data, 0);
  if (fourcc(data, 4) !== 'musi' || size > data.length) throw new Error('not a QTMA tune');
  const parts = {};
  let o = 20;
  while (o + 4 <= size) {
    const x = u32be(data, o);
    if ((x >>> 28) !== 0xF) break;
    const n = x & 0xFFFF, part = (x >>> 16) & 0xFFF, sub = (u32be(data, o + 4 * (n - 1)) >>> 16) & 0x3FFF;
    const body = data.subarray(o + 4, o + 4 * (n - 1));
    const p = parts[part] || (parts[part] = { part });
    if (sub === 8) p.channel = u32be(body, 0);
    else if (sub === 11) p.used = [0, 1, 2, 3].map(k => u32be(body, 4 * k));
    else if (sub === 1 && body.length >= 84) {
      p.info = body.slice(0, 8);
      p.synthType = body.slice(8, 12);
      p.synthName = body.slice(12, 44);
      p.instName = body.slice(44, 76);
      p.instrument = u32be(body, 76) | 0;
      p.gm = u32be(body, 80) | 0;
    }
    o += 4 * n;
  }
  return { flags: u32be(data, 16), parts: Object.values(parts).sort((a, b) => a.part - b.part), size };
}
// A Pascal string in a field of 32 bytes, as the ToneDescription holds two.
function qtmaStr31(text) {
  const out = new Uint8Array(32);
  const t = String(text || '').slice(0, 31);
  out[0] = t.length;
  for (let i = 0; i < t.length; i++) out[1 + i] = t.charCodeAt(i) & 0xFF;
  return out;
}
/* A tune from its parts and its events. `parts` are qtmaHeaderParts's shape
   (channel, info, synthType, synthName, instName, instrument, gm; `used` is
   worked out from the notes); `events` are qParseTune's, times and lengths
   in the tune's units. */
function qtmaWrite(parts, events, opts) {
  opts = opts || {};
  const longsOf = bytes => { const l = []; for (let i = 0; i < bytes.length; i += 4) l.push(u32be(bytes, i)); return l; };
  const header = [];
  for (const p of parts) {
    const used = [0, 0, 0, 0];
    for (const e of events) if (e.k === 'note' && e.part === p.part && e.pitch >= 0 && e.pitch < 128) used[e.pitch >> 5] = (used[e.pitch >> 5] | (0x80000000 >>> (e.pitch & 31))) >>> 0;
    const req = new Uint8Array(84);
    req.set(p.info, 0); req.set(p.synthType, 8); req.set(p.synthName, 12); req.set(p.instName, 44);
    req.set(qtmaWords([p.instrument, p.gm]), 76);
    header.push(...qtmaGeneral(p.part, 8, [p.channel >>> 0]), ...qtmaGeneral(p.part, 11, used), ...qtmaGeneral(p.part, 1, longsOf(req)));
  }
  header.push(QTMA.EndMarkerValue, 0);   // the shipped headers end with the marker and a zero long
  const seq = [((QTMA.MarkerEventType << 29) | (2 << 16)) >>> 0];   // the tempo marker the shipped tunes open with
  let now = 0;
  const order = events.map((e, i) => [e, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(x => x[0]);
  for (const e of order) {
    let rest = e.t - now;
    while (rest > 0) { const r = Math.min(rest, 0xFFFFFF); seq.push(r >>> 0); rest -= r; }
    now = e.t;
    if (e.k === 'note') {
      const dur = Math.max(1, e.dur | 0), vol = Math.max(1, Math.min(127, e.vol | 0));
      if (e.part < 32 && e.pitch >= 32 && e.pitch < 96 && dur < 2048)
        seq.push(((QTMA.NoteEventType << 29) | (e.part << 24) | ((e.pitch - 32) << 18) | (vol << 11) | dur) >>> 0);
      else
        seq.push(((QTMA.XNoteEventType << 28) | (e.part << 16) | (e.pitch & 0xFFFF)) >>> 0,
                 ((2 << 30) | (vol << 22) | Math.min(dur, 0x3FFFFF)) >>> 0);
    } else if (e.k === 'ctl') {
      seq.push(((QTMA.ControlEventType << 29) | (e.part << 24) | ((e.ctl & 0xFF) << 16) | (e.val & 0xFFFF)) >>> 0);
    }
  }
  seq.push(QTMA.EndMarkerValue);
  const size = 20 + header.length * 4;
  const out = new Uint8Array(size + seq.length * 4);
  out.set(qtmaWords([size]), 0);
  out.set([0x6D, 0x75, 0x73, 0x69], 4);                 // 'musi'
  out.set([0, 0, 0, 0, 0, 0, 0, 1], 8);                 // reserved, data reference 1
  out.set(qtmaWords([opts.flags === undefined ? 1 : opts.flags]), 16);
  out.set(qtmaWords(header), 20);
  out.set(qtmaWords(seq), size);
  return out;
}

/* A Standard MIDI File read: every channel event with its time in seconds,
   through the file's own tempo map. Formats 0 and 1; a file in SMPTE time
   is refused by name. */
function midiRead(bytes) {
  if (fourcc(bytes, 0) !== 'MThd') throw new Error('not a MIDI file: it does not begin MThd');
  const format = u16be(bytes, 8), ntrk = u16be(bytes, 10), division = u16be(bytes, 12);
  if (format > 1) throw new Error('a format ' + format + ' MIDI file, where the page reads 0 and 1');
  if (division & 0x8000) throw new Error('a MIDI file timed in SMPTE frames, where the page reads beats');
  const raw = [], tempos = [];
  let o = 8 + u32be(bytes, 4), order = 0;
  for (let t = 0; t < ntrk && o + 8 <= bytes.length; t++) {
    const len = u32be(bytes, o + 4), end = Math.min(bytes.length, o + 8 + len);
    if (fourcc(bytes, o) !== 'MTrk') { o = end; continue; }
    let p = o + 8, tick = 0, status = 0;
    const vlq = () => { let v = 0, b; do { if (p >= end) throw new Error('a MIDI track ends inside a number'); b = bytes[p++]; v = v * 128 + (b & 0x7F); } while (b & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let b = bytes[p];
      if (b === 0xFF) {
        const type = bytes[p + 1]; p += 2;
        const n = vlq();
        if (type === 0x51 && n >= 3) tempos.push({ tick, us: (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2], order: order++ });
        p += n;
        if (type === 0x2F) break;
        continue;
      }
      if (b === 0xF0 || b === 0xF7) { p++; const n = vlq(); p += n; continue; }
      if (b & 0x80) { status = b; p++; }
      if (!(status & 0x80)) throw new Error('a MIDI track has data before any status byte');
      const kind = status & 0xF0, ch = status & 0x0F;
      const d1 = bytes[p++], d2 = (kind === 0xC0 || kind === 0xD0) ? 0 : bytes[p++];
      raw.push({ tick, kind, ch, d1, d2, track: t, order: order++ });
    }
    o = end;
  }
  tempos.sort((a, b) => a.tick - b.tick || a.order - b.order);
  // Seconds at a tick: the tempo changes before it, each for its stretch.
  const marks = [{ tick: 0, sec: 0, us: 500000 }];
  for (const t of tempos) {
    const m = marks[marks.length - 1];
    const sec = m.sec + (t.tick - m.tick) * m.us / 1e6 / division;
    if (t.tick === m.tick) m.us = t.us; else marks.push({ tick: t.tick, sec, us: t.us });
  }
  const secAt = tick => { let m = marks[0]; for (const k of marks) { if (k.tick <= tick) m = k; else break; } return m.sec + (tick - m.tick) * m.us / 1e6 / division; };
  raw.sort((a, b) => a.tick - b.tick || a.order - b.order);
  for (const e of raw) e.sec = secAt(e.tick);
  return { format, division, events: raw, tempos: marks };
}

/* A MIDI file as a tune. opts.like is the tune being replaced (bytes), for
   the fields a tune carries that a MIDI file has no word for; opts.name is
   a function from an instrument number to its name, or absent;
   opts.unitsPerSecond the tune's clock. Returns { data, parts, notes,
   controllers, seconds, dropped }, dropped a count by reason. */
function midiToQtma(midiBytes, opts) {
  opts = opts || {};
  const ups = opts.unitsPerSecond || QTMA_UNITS_PER_SECOND;
  const like = opts.like ? qtmaHeaderParts(opts.like) : null;
  const model = like && like.parts.find(p => p.info) || null;
  if (!model) throw new Error('a tune to take the synthesizer’s name from is needed, and none was given');
  const midi = midiRead(midiBytes);
  const dropped = {};
  const drop = why => { dropped[why] = (dropped[why] || 0) + 1; };
  const unit = sec => Math.round(sec * ups);
  const partOf = new Map(), parts = [], events = [];
  const chan = Array.from({ length: 16 }, () => ({ program: 0, bendRange: 2, rpn: [127, 127], ctl: {}, part: null }));
  const partFor = (ch, c) => {
    const kit = ch === 9, key = kit ? 'kit' : ch + ':' + c.program;
    if (partOf.has(key)) return partOf.get(key);
    if (parts.length >= 32) { partOf.set(key, null); return null; }
    const instrument = kit ? 16385 : c.program + 1;
    const p = { part: parts.length, channel: parts.length + 1, info: model.info, synthType: model.synthType, synthName: model.synthName,
                instName: qtmaStr31(opts.name ? opts.name(instrument) : ''), instrument, gm: kit ? 0 : c.program + 1, midiChannel: ch };
    parts.push(p);
    partOf.set(key, p);
    return p;
  };
  // A controller reaches the part its channel is sounding; one sent before
  // the channel's first note is kept and sent as the part begins.
  const sendCtl = (c, t, ctl, val) => {
    c.ctl[ctl] = val;
    if (c.part) events.push({ t, k: 'ctl', part: c.part.part, ctl, val: val & 0xFFFF });
  };
  const held = new Map();
  for (const e of midi.events) {
    const c = chan[e.ch], t = unit(e.sec);
    if (e.kind === 0x90 && e.d2 > 0) {
      const p = partFor(e.ch, c);
      if (!p) { drop('notes on a 33rd part or later'); continue; }
      if (c.part !== p) { c.part = p; for (const k in c.ctl) events.push({ t, k: 'ctl', part: p.part, ctl: +k, val: c.ctl[k] & 0xFFFF }); }
      const key = e.ch + ':' + e.d1;
      if (!held.has(key)) held.set(key, []);
      const note = { t, k: 'note', part: p.part, pitch: e.d1, vol: e.d2, dur: 0 };
      held.get(key).push(note);
      events.push(note);
    } else if (e.kind === 0x80 || e.kind === 0x90) {
      const list = held.get(e.ch + ':' + e.d1);
      const note = list && list.shift();
      if (note) note.dur = Math.max(1, t - note.t); else drop('note-offs with no note on');
    } else if (e.kind === 0xC0) {
      c.program = e.d1;
    } else if (e.kind === 0xE0) {
      const semis = ((e.d1 | (e.d2 << 7)) - 8192) / 8192 * c.bendRange;
      sendCtl(c, t, QTC.PitchBend, Math.max(-32768, Math.min(32767, Math.round(semis * 256))));
    } else if (e.kind === 0xD0) {
      sendCtl(c, t, QTC.AfterTouch, e.d1 << 8);
    } else if (e.kind === 0xB0) {
      if (e.d1 === 101) c.rpn[0] = e.d2;
      else if (e.d1 === 100) c.rpn[1] = e.d2;
      else if (e.d1 === 6 && c.rpn[0] === 0 && c.rpn[1] === 0) c.bendRange = e.d2;
      else if (e.d1 === 1 || e.d1 === 7 || e.d1 === 11 || e.d1 === 91) sendCtl(c, t, e.d1, e.d2 << 8);
      else if (e.d1 === 10) sendCtl(c, t, QTC.Pan, Math.round((1 + e.d2 / 127) * 256));
      else if (e.d1 === 64) sendCtl(c, t, QTC.Sustain, e.d2 >= 64 ? 0x7F00 : 0);   // on is 127.0 in the shipped tunes
      else drop('controller ' + e.d1);
    } else drop(e.kind === 0xA0 ? 'key pressure' : 'other events');
  }
  // A note the file never ends is ended with the file.
  const last = midi.events.length ? unit(midi.events[midi.events.length - 1].sec) : 0;
  for (const list of held.values()) for (const note of list) { note.dur = Math.max(1, last - note.t); drop('notes never ended, ended with the file'); }
  if (!parts.length) throw new Error('the MIDI file sounds no note');
  const data = qtmaWrite(parts, events, { flags: like.flags });
  const total = events.reduce((m, e) => Math.max(m, e.t + (e.dur || 0)), 0);
  return { data, parts, notes: events.filter(e => e.k === 'note').length, controllers: events.filter(e => e.k === 'ctl').length,
           seconds: total / ups, dropped };
}

/* 16-bit stereo WAV bytes from qtmaRender's result. */
function qtmaWav(r) {
  const n = r.left.length;
  const { buffer } = wavHeader(n * 4, r.rate, 16, 2);
  // Little-endian samples straight into the buffer: a DataView call per
  // sample took longer than rendering the tune.
  const pcm = new Int16Array(buffer, 44, n * 2);
  for (let i = 0; i < n; i++) {
    pcm[2 * i] = Math.max(-32768, Math.min(32767, Math.round(r.left[i] * 32767)));
    pcm[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r.right[i] * 32767)));
  }
  return new Uint8Array(buffer);
}
