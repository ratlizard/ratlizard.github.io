// A save or a patch sent to a phone arrives as a zip. This runs the page's own
// zip reader, save import and patch unwrapping -- lifted out of index.html,
// beside the vendored grimoire scripts as the page loads them -- over:
//
//   - Rocky the Flying Chicken, the community's two characters zipped on a Mac
//     in 2008, AppleDoubles under __MACOSX/ and a .DS_Store beside them;
//   - a character zipped as the Finder's Compress zips one (`ditto -c -k
//     --sequesterRsrc`), made here from the save store's I.M.Cheater;
//   - the same file zipped by Info-ZIP, which drops the resource fork and the
//     Finder type, and must be refused by name rather than imported half;
//   - the .bin the Saves panel exports, zipped;
//   - the Pumpkin Patch's .hqx, zipped.
//
// Usage: node zip_smoke.mjs      (macOS: the Finder-style case needs ditto)
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const ref = join(here, '..', '..', 'cythera-reference');
const addons = join(ref, 'community', 'addons');
const html = readFileSync(join(here, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

let failures = 0, skips = 0;
const fail = (what, why) => { failures++; console.error(`FAIL ${what}: ${why}`); };
const ok = (what, detail) => console.log(`  ok   ${what}${detail ? '  — ' + detail : ''}`);
const skip = (what) => { skips++; console.log(`  skip ${what}`); };

// ---- the page's code, in a context laid out as the page's global scope ----
const ctx = vm.createContext({ console, TextDecoder, TextEncoder, Blob, Response, DecompressionStream, Uint8Array, DataView });
for (const f of [...html.matchAll(/<script src="(delv\/[^"]+)"><\/script>/g)].map(m => m[1]))
  vm.runInContext(readFileSync(join(here, f), 'utf8'), ctx, { filename: f });
function lift(decl) {
  const at = script.indexOf(decl);
  if (at < 0) { fail('lifting', `${decl} is not in index.html`); return ''; }
  if (decl.startsWith('const ')) return script.slice(at, script.indexOf('\n', at));
  return script.slice(at, script.indexOf('\n}\n', at) + 2);
}
const said = [];
ctx.say = m => said.push(m);
vm.runInContext('const dec = new TextDecoder();\n' + [
  'const MUSIC_ANY', 'async function inflateRaw', 'function isZip', 'function appleDoubleParts',
  'async function readZip', 'function fromMacBinary', 'function toMacBinary', 'function crc16',
  'function typeCode', 'const GAME_CREATOR', 'async function savesFromFile',
  'function unwrapPatch(', 'async function unwrapPatchFile',
].map(lift).join('\n') + '\nthis.api = { readZip, savesFromFile, unwrapPatchFile, toMacBinary, typeCode };', ctx);
const { savesFromFile, unwrapPatchFile, toMacBinary, typeCode } = ctx.api;
const asFile = (name, u8) => ({ name, arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) });
const read = p => new Uint8Array(readFileSync(p));

// ---- Rocky the Flying Chicken ----------------------------------------------
{
  const p = join(addons, '616_Rocky_the_Flying_Chicken.zip');
  if (!existsSync(p)) skip('Rocky the Flying Chicken is not in the add-ons');
  else {
    const { recs, left } = await savesFromFile(asFile('Rocky.zip', read(p)));
    const names = recs.map(r => r.name).sort();
    if (names.join('|') !== 'Rocky the Flying Chicken|Rocky the Flying Chicken!')
      fail('Rocky', `took ${JSON.stringify(names)}`);
    else if (!recs.every(r => typeCode(r.type) === 'DelP' && typeCode(r.creator) === 'Delv' && r.rsrc.length === 3996))
      fail('Rocky', 'a character came out without its type, creator or resource fork: ' +
           recs.map(r => `${typeCode(r.type)}/${typeCode(r.creator)} ${r.rsrc.length}`).join(', '));
    else if (recs.map(r => r.data.length).sort().join() !== '333099,333412')
      fail('Rocky', 'data forks of ' + recs.map(r => r.data.length).join(', '));
    else if (left.length) fail('Rocky', 'left out ' + left.join(', '));
    else ok('Rocky the Flying Chicken: both characters, DelP/Delv, with their resource forks', 'the .DS_Store and the folder\'s AppleDouble passed over');
  }
}

// ---- a character, as the Finder zips one, and as Info-ZIP does -------------
const save = join(ref, 'game', 'installed-folders', '.systemless', 'saves', 'Cythera Installed Folder', 'Cythera 1.0.4 %C6%92', 'I.M.Cheater');
if (!existsSync(join(save, 'data.fork'))) skip('I.M.Cheater is not in the save store');
else {
  const data = read(join(save, 'data.fork')), rsrc = read(join(save, 'resource.fork'));
  const tmp = mkdtempSync(join(tmpdir(), 'zip_smoke-'));
  try {
    const file = join(tmp, 'I.M.Cheater');
    writeFileSync(file, data);
    let finderZip = null;
    try {
      writeFileSync(file + '/..namedfork/rsrc', rsrc);
      execFileSync('xattr', ['-wx', 'com.apple.FinderInfo', '44656C5044656C76' + '0100' + '00'.repeat(22), file]);
      execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', file, join(tmp, 'finder.zip')]);
      finderZip = read(join(tmp, 'finder.zip'));
    } catch (e) { skip('the Finder-style zip needs macOS (' + e.message.split('\n')[0] + ')'); }
    if (finderZip) {
      const { recs } = await savesFromFile(asFile('finder.zip', finderZip));
      const r = recs[0];
      if (recs.length !== 1) fail('Finder zip', `${recs.length} files taken`);
      else if (r.name !== 'I.M.Cheater' || typeCode(r.type) !== 'DelP' || typeCode(r.creator) !== 'Delv' || r.flags !== 0x0100)
        fail('Finder zip', `came out as ${r.name} ${typeCode(r.type)}/${typeCode(r.creator)} flags ${r.flags}`);
      else if (!Buffer.from(r.data).equals(Buffer.from(data)) || !Buffer.from(r.rsrc).equals(Buffer.from(rsrc)))
        fail('Finder zip', 'a fork did not come back byte for byte');
      else ok('a character zipped as the Finder zips one comes back whole', `${r.data.length} + ${r.rsrc.length} bytes, DelP/Delv`);
    }
    // Info-ZIP writes no AppleDouble. The data fork alone is not a character.
    execFileSync('zip', ['-q', '-X', '-j', join(tmp, 'plain.zip'), file]);
    let msg = '';
    try { await savesFromFile(asFile('plain.zip', read(join(tmp, 'plain.zip')))); } catch (e) { msg = e.message; }
    if (!/lost its resource fork/.test(msg)) fail('plain zip', msg ? 'refused, but not saying why: ' + msg : 'it was imported without its resource fork');
    else ok('a zip that dropped the resource fork is refused, and says so', msg);

    // The Saves panel's own export, zipped.
    const bin = toMacBinary({ path: 'x/I.M.Cheater', type: 0x44656C50, creator: 0x44656C76, flags: 0x0100, created: 1, modified: 2, data, rsrc });
    writeFileSync(join(tmp, 'I.M.Cheater.bin'), bin);
    execFileSync('zip', ['-q', '-X', '-j', join(tmp, 'bin.zip'), join(tmp, 'I.M.Cheater.bin')]);
    const { recs } = await savesFromFile(asFile('bin.zip', read(join(tmp, 'bin.zip'))));
    if (recs.length !== 1 || recs[0].name !== 'I.M.Cheater' || recs[0].rsrc.length !== rsrc.length)
      fail('zipped .bin', JSON.stringify(recs.map(r => [r.name, r.rsrc.length])));
    else ok('an exported .bin, zipped, imports', recs[0].name);

    // A file that is not the game's is named and left, not imported.
    const other = toMacBinary({ path: 'x/ReadMe', type: 0x54455854, creator: 0x74747874, flags: 0, created: 1, modified: 2, data: new TextEncoder().encode('hello'), rsrc: new Uint8Array(0) });
    writeFileSync(join(tmp, 'ReadMe.bin'), other);
    execFileSync('zip', ['-q', '-X', '-j', join(tmp, 'mixed.zip'), join(tmp, 'I.M.Cheater.bin'), join(tmp, 'ReadMe.bin')]);
    const mixed = await savesFromFile(asFile('mixed.zip', read(join(tmp, 'mixed.zip'))));
    if (mixed.recs.length !== 1 || mixed.left.length !== 1 || !/TEXT file, not one of Cythera's/.test(mixed.left[0]))
      fail('mixed zip', JSON.stringify({ took: mixed.recs.map(r => r.name), left: mixed.left }));
    else ok('a file in the zip that is not the game\'s is left out by name', mixed.left[0]);

    // The reader holds every entry to its CRC: flip a byte of stored data.
    execFileSync('zip', ['-q', '-X', '-0', '-j', join(tmp, 'stored.zip'), join(tmp, 'I.M.Cheater.bin')]);
    const bad = read(join(tmp, 'stored.zip')); bad[30 + 'I.M.Cheater.bin'.length + 200] ^= 1;
    msg = '';
    try { await savesFromFile(asFile('bad.zip', bad)); } catch (e) { msg = e.message; }
    if (!/checksum/.test(msg)) fail('corrupt zip', msg ? 'refused for the wrong reason: ' + msg : 'a corrupted entry was imported');
    else ok('a corrupted entry fails its checksum', msg);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---- the Pumpkin Patch, zipped ---------------------------------------------
{
  const hqx = join(addons, '614_MagpiePumpkinPatch.sit.hqx');
  if (!existsSync(hqx)) skip('the Pumpkin Patch is not in the add-ons');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'zip_smoke-'));
    try {
      writeFileSync(join(tmp, 'ReadMe.txt'), 'not the patch');
      execFileSync('zip', ['-q', '-X', '-j', join(tmp, 'patch.zip'), join(tmp, 'ReadMe.txt'), hqx]);
      const got = await unwrapPatchFile('patch.zip', read(join(tmp, 'patch.zip')));
      ctx.__b = got.bytes;
      if (!/Pumpkin Patch/.test(got.name) || !vm.runInContext('describeDelverArchive(__b).ok', ctx))
        fail('zipped patch', `came out as ${JSON.stringify(got.name)}`);
      else ok('the Pumpkin Patch, zipped beside a ReadMe, opens to the patch', `${got.name}, ${got.bytes.length.toLocaleString()} B`);
      let msg = '';
      execFileSync('zip', ['-q', '-X', '-j', join(tmp, 'none.zip'), join(tmp, 'ReadMe.txt')]);
      try { await unwrapPatchFile('none.zip', read(join(tmp, 'none.zip'))); } catch (e) { msg = e.message; }
      if (!/Nothing in none.zip is a Delver Archive.*ReadMe.txt/.test(msg)) fail('a zip with no patch', msg || 'it was accepted');
      else ok('a zip with no patch in it is refused, naming what it holds', msg);
    } catch (e) { fail('zipped patch', e.message); }
    finally { rmSync(tmp, { recursive: true, force: true }); }
  }
}

if (said.length) console.log('  page said: ' + said.join(' / '));
console.log(failures ? `${failures} failure(s)` : `all passed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
