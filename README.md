# ratlizard.github.io — Cythera in the browser

The organisation site: this repository serves at the bare
**https://ratlizard.github.io/**. It was `web/` in `ratlizard/alchemy` until
8 September 2026 and was split out with `git subtree split`, so the history
below that date is alchemy's.

`cythera-web/` is a C-ABI WebAssembly binding over `../../wolflizard` (the
fork, checked out beside this repository); `www/index.html` is the page that
runs it. `build.sh` builds the module locally and its comments record the two
toolchain facts that cost a build each. The Pages workflow builds from the
fork's `cythera-detailed` branch and deploys `www/` to Pages through the
Actions source, so the built module never enters git.

**The two relative paths have to agree**: the workflow checks this repository
out at `path: site` and `cythera-web/Cargo.toml` reaches the fork with
`../../wolflizard`. Both assume one directory level. Change one and you must
change the other, or the build resolves to nothing.

The Node runners in `www/` drive the same module without a browser:

| runner | what it proves |
|---|---|
| `bench.mjs` | instructions per second on the headless boot, and a frame |
| `play_smoke.mjs` | the wall-clock path runs with audio and input |
| `audio_smoke.mjs` | the module produces sound from the start screen |
| `saves_smoke.mjs` | import before start, scan, acknowledge, exclusions |
| `menus_smoke.mjs` | the menu snapshot and a selection through MenuSelect |
| `realtime_frame.mjs` | a frame after N seconds on the wall-clock path |
| `drive.mjs` | a scripted run: import a save store, wait, click, key, menu, frame. `CW_PATCH=<patch file>` merges a Magpie patch in before the game starts |
| `page_smoke.mjs` | the page's script runs top to bottom under a stub document |
| `audio_ring_check.mjs` | the audio ring out of the page: a stream fed in pieces comes out with no step anywhere, running dry bends rather than clicks and comes back without one, a ring flooded past its capacity stays bounded and cross-fades where it drops the oldest. Takes no arguments |
| `patch_smoke.mjs` | the Magpie patch route: the vendored format files, the module's exports, and the real patch through its wrappers |

Each takes the game archive as its first argument; `game.sit` beside the page
(gitignored) is the usual symlink — `ln -s
../../cythera-reference/game/installed-folders/"Cythera Installed Folder.sit"
www/game.sit`. It does not survive a move of this tree, and without it
`menus_smoke` and `saves_smoke` fail on ENOENT rather than skipping. The game is not in this repository.

The game's windows carry their own ornate frames (drawn by its window
definition procedure, which the fork calls on reveal and after a move) and
drag by those frames: press on a border or title plaque, move, release.
