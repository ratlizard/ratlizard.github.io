# Vendored copies of grimoire's Delver format code

Nine files, copied verbatim from `ratlizard/grimoire`'s `js/`. Four the page
loads, for the Patches panel:

| | |
|---|---|
| `mac-bytes.js` | big-endian readers, Mac Roman, Pascal strings |
| `mac-containers.js` | BinHex 4.0 and MacBinary, the two single-file wrappers a patch travels in |
| `mac-stuffit.js` | reads a StuffIt archive: its catalog, its stored forks, and methods 13 and 15 decompressed. Any other method it names and stops on |
| `delv-archive.js` | the Delver Archive reader and writer, and `mergeDelverPatch` |

And five more that only the music worker loads (`../qt-music.js`, after
`mac-bytes.js`), to play the game's tunes through QuickTime 3's instruments:

| | |
|---|---|
| `mac-resfork.js` | a resource fork's map and data, which is what the instrument file is |
| `mac-media.js` | `wavHeader`, which `mac-qtmusic.js` names |
| `mac-vise.js` | `inflateRaw`, for the zip the QuickTime 3 installer is |
| `mac-installshield.js` | the InstallShield 3 archive inside that zip |
| `mac-qtmusic.js` | the instruments read, a tune read, and the synth (`qtmaRender`) |

The player leans on the decompression: the one published Magpie patch is a
method-13 fork inside a `.sit` inside a `.hqx`, and until grimoire could open
one the Patches panel refused the download and said to extract it first --
which on a phone, where this page exists to be used, is not something that can
be done at all.

**Copies, not originals.** The canonical file is `js/<name>` in grimoire; fix
bugs there and re-copy. `check_copies.sh` compares each file here against the
grimoire checkout beside this repository and skips cleanly when it is absent.

It compares the **whole file**, not a recorded hash of the original the way
`tools/COPIES.txt` does, because these run in the player rather than
beside it: a local edit that made the player behave differently from the tool
that proves the format would be exactly the failure worth catching, and a
recorded-hash check cannot see one. `COPIES.txt` records the hashes anyway, so
a checkout with no sibling still says which versions these are.

They are loaded as plain scripts, in the order the tables give, the first four
before the page's own script and the worker's by `importScripts`; each defines
globals and none is a module. Nothing else in grimoire's `js/` is needed: each
order loads clean with no other dependency, which `check_copies.sh` does not
test and the player's boot and `qt_music_smoke.mjs` do.
