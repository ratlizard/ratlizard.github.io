# CLAUDE.md

Guidance for AI assistants working in this repository.

## What this is

**`ratlizard.github.io`** — the organisation site, and the live browser
player: Cythera running in WebAssembly on the `wolflizard` fork of
systemless. It serves at the bare **https://ratlizard.github.io/**.

It was `web/` inside `ratlizard/alchemy` until 8 September 2026, split out
with `git subtree split -P web`, so its history before that date is
alchemy's and the early commit messages say "web:".

**The game is not in this repository and never will be.** The page fetches
the installer from archive.org when it opens, or takes a `game.sit` served
beside it.

## The repositories

The work is split across several, checked out flat beside each other. A
session that clones one gets none of the rest, so paths across them are
never assumed. **You are in `ratlizard.github.io`.**

| | |
|---|---|
| **`ratlizard/ratlizard.github.io`** | **the site. This one.** |
| `ratlizard/wolflizard` | the fork of benletchford/systemless that this binds to, on branch `cythera-detailed`. Checked out beside this one as `wolflizard/` |
| `ratlizard/alchemy` | the archive of retired attempts at running the game off a Macintosh; this page lived there until 8 September 2026 |
| `ratlizard/grimoire` | the public site of browser tools that read Cythera's files |
| `ratlizard/cythera-workbench` | private. The Python tools and the notes |

## How it deploys

Pages is served from the **GitHub Actions source**, not a branch: the
workflow builds the module, uploads `www/` as an artifact and deploys it.
The 11 MB wasm is therefore never committed — it is a build product, it does
not delta-compress, and a copy per deploy would grow the repository without
bound. The `gh-pages` branch from before 8 September 2026 is left as a
rollback path and is no longer written to.

## The two paths that must agree

`.github/workflows/pages.yml` checks this repository out at `path: site`,
and `cythera-web/Cargo.toml` reaches the fork with `../../wolflizard`. Both
assume exactly one directory level. **Change one and you must change the
other**, or the build resolves to nothing — this bit once already, when the
fork's checkout directory was renamed from `systemless/` to `wolflizard/`.

The Cargo *dependency* is still named `systemless`, because that is the
crate's package name upstream. Do not rename it: the fork is rebased onto
upstream regularly and every rename inside the tree is a conflict to
re-resolve each time.

## The page and the module

`cythera-web` is a `cdylib` over `../../wolflizard` (the fork, checked
out beside this repository) with `default-features = false`, exporting a C ABI
the page calls directly; `src/lib.rs` documents each export. `build.sh`
builds it — read its comments, they are the two toolchain facts that cost a
build each. `www/index.html` is the page, and a set of `*_smoke.mjs`
beside it run the same module under Node, which is how the executor was
measured and how a change is checked without a browser: `page_smoke` executes
the page's own script under a stub document (it catches a use-before-declare
that parsing cannot); `play_smoke` and `bench` pace the guest; `audio_smoke`
counts non-silent samples; `saves_smoke` drives the store; `menus_smoke`
selects a guest menu item; `music_smoke` lifts the page's zip reader out of
`index.html` and runs the whole substitute-music path; `patch_smoke` proves the
Magpie patch route; `load_timing` times a save load call by call. **Run them all after touching the page or the
module.** Two things the page does that are easy to break and easy to miss:
it holds a silent looping media element open, because iOS mutes a page that
uses only Web Audio; and it runs the guest unpaced while the screen is black
so a load is not paced out, then paces again the moment the game draws — a
guest that is ahead of the wall clock must be left to wait, never re-based
on, or the game keeps time several times too fast. The Pages
workflow checks the fork out at `cythera-detailed` and builds from that, so a
fork change reaches the site on the next push here. The game is fetched from
archive.org at run time and is never in this repository. The workbench's
`doc/mobile-web-feasibility.md` (private) has the measurements and the list of
what the page still lacks; the touch shell in `mobile/` is what to port for
the controls.

## Patches: the one add-on Cythera has

A **Magpie patch** is a Delver Archive carrying the same scenario title as
`Cythera Data` and holding only the resources to replace. Cythera has no
plug-in folder and never looks for one, so systemless's own
`import_vfs_file_relative_to_launched_app` — the call behind the plug-in
catalogue on systemless.org — has nothing to load here. The merge happens in
the page instead, between `cw_load` and `cw_start`: read the archive back off
the disk with `cw_vfs_stage`, merge in JavaScript, hand the result to
`cw_import`. The packaged copy is never touched and nothing is written back;
the patch is stored and re-merged at every load.

`mergeDelverPatch` is **grimoire's**, and `www/delv/` holds four of its
`js/` files verbatim — `delv/README.md` says which and why, and
`delv/check_copies.sh` compares them against the grimoire checkout beside this
repository. Fix format bugs there and re-copy.

Three things to know before touching it. The merge **re-serializes all 5.6 MB**
and has to: the resources a patch supplies are different lengths from the ones
they replace, so nothing can be patched in place. The rebuild is **not**
byte-identical to Ambrosia's file and is not meant to be — it lays resources
out as delvmod does, 12,542 bytes shorter — and the game accepts it; the
patched archive boots to the same tick and the same start screen as the
unpatched one. And `cw_import` records the imported file's fingerprint as
already stored, which is what stops the save scan offering the 5.6 MB archive
to IndexedDB as if the guest had written it.

The one published patch is the Pumpkin Patch, twelve tile sheets. It is
distributed as a `.hqx` wrapping a `.sit`, and `js/mac-stuffit.js` lists a
StuffIt archive but does not decompress one, so the page unwraps BinHex and
MacBinary and refuses a `.sit` by naming what is inside it. `CW_PATCH=<file>`
on `drive.mjs` reproduces a patched run without a browser.

## Conventions

**Nobody is named.** The maintainer is "the maintainer" in every file and
every commit. Never write a name, an email address or a home-directory path
into any file or commit. Commit as `e-z-g <e-z-g@users.noreply.github.com>`,
with no Claude attribution trailers.

**Commit messages are prose**, not conventional-commits: a sentence
describing the change from the user's side.

Plain register in UI text: say the thing once, and leave text that comes out
of the game's own data exactly as the file has it.
