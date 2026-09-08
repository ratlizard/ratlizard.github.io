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

## Conventions

**Nobody is named.** The maintainer is "the maintainer" in every file and
every commit. Never write a name, an email address or a home-directory path
into any file or commit. Commit as `e-z-g <e-z-g@users.noreply.github.com>`,
with no Claude attribution trailers.

**Commit messages are prose**, not conventional-commits: a sentence
describing the change from the user's side.

Plain register in UI text: say the thing once, and leave text that comes out
of the game's own data exactly as the file has it.
