# ratlizard.github.io — handoff

The handoff for the browser player alone. It carries decisions, open questions
and what was learned — never a tip or a count, which `tools/status.sh` in the
workspace derives. Split out of the workspace handoff on 8 September 2026; the
standing rules are in the workspace `NEXT-SESSION.md`. The fork it is built
from has its own handoff, `cythera-workbench/doc/SYSTEMLESS-NEXT.md`.

## After the crackle: static, the pause between screens, the load, 9 September 2026

The maintainer, on the same day: "Crackle gone but there's still underlying
static noise. The music also pauses between screens, and the long file-open
freeze is still there." Three separate things.

### The static is the game's own 8-bit sound, as far as anything here can tell

Not the page. Twenty seconds of the theme out of the module were measured
rather than described:

| | |
|---|---|
| samples at exactly the silent level | 20,439 of 441,600, so silence is silent |
| the music's own noise, if 8-bit quantisation were flat | 35 dB below its rms |
| under one 0.37 s stretch, the median spectral bin | 66 dB below the strongest |
| what the page's reading between samples adds above 11 kHz | −47 dB of the total |
| what a 16-tap windowed sinc would add instead | −52 dB |

So a better resampler is worth 5 dB in a band above 11 kHz, which is not what
anyone means by static, and it was not done. What is left is the source: an
8-bit stream at 22,050 Hz has a hiss about 35 dB under the music, and on a
phone with headphones that is audible where it never was through a Macintosh
speaker. **The WAV was sent to the maintainer to listen to**, since the
question of whether that is the noise he means is one only he can answer. If
it is, the only cure is to change the game's sound rather than reproduce it,
which is his call, not a bug.

### The music stopped between screens because the page threw that sound away

The page spends whole frames off the wall clock -- a black screen while a room
or a save loads, and the catch-up after -- and both branches drained the
runner's audio and dropped it, with the reasoning that it "belongs to a moment
that will not be played". It does not: the guest mixes in proportion to its
own clock, about 8,800 samples for every 24 ticks it advances, and during that
work the guest clock runs at roughly real time, so those frames hold real
music. They are carried now, newest ring-full first.

The ring drops the oldest when it overflows, which a load does to it about
once a second, and **that drop is now cross-faded like a gap rather than
stepped over** -- and the cross-fade carries the old wave on at the speed it
was going rather than holding it still, because a held value is a corner and
a corner is what is heard. Two negative controls hold that up: skipping three
samples at every feed reads 1.9e-1 against a 7.2e-3 allowance, and stepping
over the drop instead of fading it reads 6.3e-2. Both fail the check that
covers them.

### The file-open freeze was not measured, and here is why

`load_timing.mjs` did not open anything. It settles, clicks Onward through the
headless path, and times catch-up calls -- but the README already records that
a click delivered under Node does not register, and the sound path it prints
at the end still says the start-screen tune is playing, at tick 2,942, after
600 million instructions and 28 seconds. **What it timed was the game sitting
on its start screen at full instruction budget**, about 18 M instructions a
second, not a load. Any figure taken from that run for a load is wrong.

**What would settle it in one line from the maintainer**: the page already
logs `play: the screen was black for N s; ran unpaced until the game drew
again` and `play: caught up after N frames`. Pressing Log after opening a
character and reading those two lines back says whether the freeze is the
black-screen branch, the catch-up branch or neither, and how long it lasts.
Without that, the next step is the playthrough kit rather than the Node
runners, because that is what can actually deliver a click.

## The crackle was the page splicing audio buffers, 9 September 2026

The maintainer: "The music is kind of crackly on ratlizard, has been for a
while." It was not the fork's mixing and not the 8-bit source. Twenty seconds
of the theme rendered by `render_wav.mjs` hold no clipping — the signal sits
inside 51..220 of 0..255, with no rail-to-rail step anywhere and 23 adjacent
steps over 16 in 441,600 samples.

It was the page. Every animation frame it made an `AudioBuffer` of that
frame's samples, declared at the guest's 22,050 Hz, and scheduled a fresh
`AudioBufferSourceNode` after the last one. **Splicing source nodes end to
end puts a full-scale step at every join**, sixty a second. Measured in
Chrome offline against a 440 Hz sine at amplitude 0.5, comparing second
differences at the joins with those mid-chunk:

| how the samples reach the speaker | at the joins | the step there |
|---|---|---|
| one buffer a frame at 22,050, as it was | 26x the middle | 0.51 |
| the same, resampled in the page to the context's rate | 26x | 0.50 |
| the same, every chunk starting on an exact output frame | 26x | 0.50 |
| one AudioWorklet node reading a ring | 1.0x | 0.003 |
| one buffer, one node, no joins at all (the control) | 1.0x | 0.003 |

The same at 44,100, which is an exact double of the guest's rate, so it is
not resampling and not the arithmetic of the start times: **nothing that
schedules a node per frame can be made smooth.** The two middle rows are the
fixes that suggest themselves and neither moves the number, which is worth
knowing before anyone tries them again.

So one node now runs for the life of the page. The page posts each frame's
samples to it; it reads them at the context's rate with the fractional
position kept across callbacks, on the audio thread, where the emulator's
long main-thread slices cannot starve it. Running dry carries the wave on at
the speed it was going, takes that speed away over about five samples and
then fades, so a gap bends rather than clicks. **`?audio=legacy` puts the old
path back**, which is also the fallback where `AudioWorklet` is missing.

**The frame loop now asks the guest for sound by the ring's level rather than
by the wall clock** — whatever brings it back to 100 ms ahead, capped at a
tenth of a second a frame. The audio device's clock is the right master for
the Sound Manager's channels, and it removes the drift between the two clocks.

`www/audio_ring_check.mjs` lifts the processor out of `index.html` and runs
it under Node: a stream fed in pieces comes out with no step anywhere,
running dry bends rather than clicks and picks up again, a ring flooded past
its capacity stays inside full scale, reset empties it. **The measure is the
largest second difference anywhere**, which does not depend on guessing where
the joins fell — an earlier version looked at predicted positions, passed a
deliberately broken processor, and was thrown away. Reading between samples
in a straight line costs 3.6e-3 by itself, which is the floor; the negative
control, skipping three samples at every feed, reads 1.9e-1 and fails.

**For the maintainer**: is the crackle gone, and does the music now sound
late against what is on screen? A hundred milliseconds is kept ahead of the
speaker, which is the cost of never running dry, and it can come down if
sound effects feel behind the game. `?audio=legacy` on the URL is the old
sound if you want to hear them side by side.

## The page ran off the bottom of the phone, 9 September 2026

The maintainer, on Chrome on an iPhone 15: "the ratlizard window extends too
far down … i can't see the character row even". Two faults, both in the page's
layout, both measured in headless Chrome at 393x720 before and after (the
script is in the session's scratch space, not the repository; it lays the page
out in an iframe of the size asked for, because Chrome ignores
`--window-size` here, and leaves the page's own script out because the module
fetch never settles headless):

- The canvas was capped at `calc(100vh - 40px)` and stacked under the bar, so
  the document came to 756 px in a 720 px viewport — 36 px of the game below
  the fold before iOS is taken into account. On iOS it is worse: `100vh` there
  is the viewport with the browser's toolbars *retracted*, so the cap is
  larger than the screen while they are up.
- The bar's eight controls wrapped to two rows, 76 px rather than the 40 the
  canvas rule assumed, and `chooseScreen` subtracted the same nominal 40 — so
  the guest screen was chosen for a space taller than the one it got.

Now: the body is a flex column of a fixed height (`100dvh`, with `100vh` as
the fallback and a script that takes the smaller of that and `innerHeight`,
so nothing can fall off a browser that gets either wrong) and does not
scroll; the bar takes what it needs, the stage takes the rest, and the canvas
is the stage. `chooseScreen` measures the page's height less the bar's
instead of guessing. On a phone the bar is one row that scrolls sideways
rather than two that wrap, which gives the game back 35 px. The pads sit
above the home indicator (`env(safe-area-inset-bottom)`). After: the document
is exactly the viewport at 393x720, 393x640 and 852x340, and the drawn
picture fills the stage with no letterbox and nothing hidden.

**For the maintainer**: does the game now end above Chrome's bottom toolbar,
and does a bar you swipe sideways suit better than two rows? The iOS half of
this — that `100dvh` is the height the phone actually shows — is the one part
headless Chrome cannot check, because an iframe has no browser toolbars.

Two things the runners turned up while checking it, neither caused by the
change and both proved so by running them on the commit before it:

- `www/delv/check_copies.sh` had been failing since grimoire cut its map
  editor — two comment blocks in `delv-archive.js` had moved on there and the
  copy here had not. Re-copied; comments only, no code, and `patch_smoke`
  merges the real patch as before. **A grimoire change to one of the four
  vendored files does not reach this repository by itself.**
- `music_smoke` takes the substitute tune as its second argument and it must
  be the one the start screen plays, `FB7C80EC` (Cythera Theme). Any other
  tune installs fine and changes nothing the start screen mixes, and the
  check then reads "installing the tune changed nothing that reached the
  mixer", which sounds like a fault in the page and is not.

## Where things stood on 8 September 2026

### `ratlizard.github.io` — tip `89ad899`, new on 8 September, live

The browser player, split out of alchemy (see item 0b). Deploys through the
**Actions source**, so the 11 MB module never enters git; there is no
`gh-pages` branch and there should not be one again. Verified live rather than
by a green workflow: `200`, the served page reporting the build it was stamped
with, and the module returning `content-type: application/wasm`, which is what
lets `instantiateStreaming` take its fast path.

Two UI changes the same day. **Play becomes Restart** once play starts — a
reload, since saves are in IndexedDB and restored on boot — taking two presses
and disarming after four seconds. **Play still has to exist before that**: it
makes the AudioContext inside the tap, which is the only moment iOS allows one,
and the comment beside it says so, so it is not removed later as dead weight.
The bar's controls are styled and Grimoire is linked from it. The panels
(Saves, Music, Cheats, Patches, Menu) and the touch pads were **not** touched
and are worth their own pass. **The maintainer tried it on the iPhone on
8 September: it works, but it reads as Stop** — the reload lands on the bar
at Play, and Play has to be pressed again, because Play is what makes the
AudioContext inside a tap. Whether a restart should carry straight through
into the game, unlocking audio on the next in-game tap instead, is open.

- **The player loads a Magpie patch**, asked for as "plugin loading" after
  the feature was seen on systemless.org. Built in alchemy as `9421b32` and
  moved here with the rest of `web/`. **It is not that feature**:
  systemless.org's is a curated catalogue dropped into a folder
  beside the app, and Cythera has no such folder and never looks for one
  (`cythera-workbench/doc/mobile-web-feasibility.md` § *Plugins: Cythera does
  not have any*, 1 September, which said not to build one). What Cythera has
  is the **Magpie patch**: a Delver Archive with the same scenario title
  holding only the resources to replace. The page merges it into
  `Cythera Data` between `cw_load` and `cw_start` — new export `cw_vfs_stage`
  reads the archive back off the disk, grimoire's `mergeDelverPatch` merges,
  `cw_import` puts it back — and the patch is stored in IndexedDB and
  re-merged at every load. The packaged copy is never written to.
  - **The merge is grimoire's** (`87fdf34`, `js/delv-archive.js`), checked by
    `utilities/patch_check.mjs` against the **unpatched rebuild** rather than
    the shipped file, because the writer lays resources out as delvmod does
    and is 12,542 bytes shorter than Ambrosia's: 1,546 resources byte for
    byte, 12 equal to the patch, three refusals, and a negative control.
    Grimoire's suite is **20 checks, 0 failed**.
  - `www/delv/` is four of grimoire's `js/` files verbatim, with
    `check_copies.sh` comparing whole files rather than a recorded hash.
  - **Proved**: the patched archive boots to the same tick and the same start
    screen as the unpatched one (`CW_PATCH=<file> node drive.mjs …`).
    **Not proved**: the pumpkins seen in the world *in the browser* — the
    route there is Open Game, and Onward still reads "No Player Selected" in
    the browser (no item in this file covers that;
    `cythera-workbench/doc/onward-root-cause.md` has the native fix). The twelve tile sheets were rendered before and after instead,
    and 55 of their 192 tiles change.
  - The one published patch is a `.hqx` wrapping a `.sit`; the page unwraps
    BinHex and MacBinary and refuses a `.sit` naming what is inside, because
    `js/mac-stuffit.js` lists but does not decompress method 13.
  - **Two of its relative paths kept alchemy's depth through the move**
    (`76ca980`): `www/delv/check_copies.sh` answered "skip: grimoire is not
    checked out beside this repository" with grimoire checked out beside it,
    so the vendoring check had been passing without comparing anything, and
    `patch_smoke.mjs` skipped its real-file half the same way. Both try both
    depths now. **`www/game.sit` is gitignored and did not come across**; it was re-made
    on 8 September as a symlink into `cythera-reference`, so `menus_smoke`
    and `saves_smoke` run again, and it does not survive a move of the tree;
    the README names the target.

`www/index.html` had two raw NUL bytes in it — IndexedDB compound keys written
literally rather than as `\0` escapes — which made the whole 79 KB page a
*binary file* to `grep` and `file(1)`. They are escapes now and the page is
searchable text for the first time; the keys are byte for byte what they were.

## History: the player while it lived in `alchemy/web/`

The section below is the alchemy repository's as it stood on 8 September; the
work is real, the paths are the old ones.

### `alchemy` — tip `2ba7d77`, pushed; **an archive again, and nothing in it deploys.** The browser player left for `ratlizard.github.io` on 8 September (its own section below); `port/` and `mobile/` are the two retired attempts. The paragraphs below describe the player while it still lived in `alchemy/web/`; the work is real, the path is not.

**Five commits of 6 and 7 September.** Sound works on the phone at last: the page was
asking the module how many samples it had *before* draining, so it read zero
on the first frame and never drained again (`8aeffd7`); then iOS still
silenced it, because a page using only Web Audio runs in a session the
Ring/Silent switch mutes, so the page now holds a media session open with a
looping silent clip (`5bddcf6`, which also carried a test beep, since removed).
**Loads no longer stretch out**: the page runs the guest unpaced while the
screen is black and paces it again the moment the game draws, and a clock
re-base of mine that let the guest's idle fast-forwards drag the deadline
along — making the game keep time about seven times too fast — is gone
(`b178802`). **A Music panel** (`54ae961`, `3b6c03a`) takes a zip, a URL, or
files; offers what cytheraguides.com publishes; maps files onto tunes by
track order when they are not named by checksum; and converts any audio the
browser can decode to the 8-bit PCM the host reads. `www/music_smoke.mjs` and
`www/load_timing.mjs` are the new checks. **Untested: whether cytheraguides.com
allows a cross-origin fetch** — it did not answer from this machine at all.

The maintainer's intent, stated 5 September: alchemy is where attempts at
running the game off a Macintosh live, and `web/` is the live one — the
WebAssembly binding over the fork, the page, the Node runners and a Pages
workflow (`.github/workflows/pages.yml`) that checks the fork out at
`cythera-detailed`, builds the module and publishes `web/www/` on every push
to `main`. `CLAUDE.md` and `README.md` say so. The page fetches the game from
archive.org's `/cors/` path, or a `game.sit` served beside it. **Pages is not
yet enabled on the repository** — the `gh api` call to enable it was refused
by the session's permission gate; Settings › Pages › Source: GitHub Actions
is the one click, after which the next push (or a workflow re-run) deploys.
**Pages is set to "deploy from a branch", so the workflow publishes
`web/www/` plus the built module to a `gh-pages` branch**; the setting has to
name that branch (root), not `main`. The page boots the game at a
phone-shaped screen: 640 wide in portrait, 480 high in landscape, the other
axis filling the viewport, per the maintainer's point that Cythera lays its
start screen out for 640x480 and runs the game at any larger size; verified
under Node at 640x1200 and 1200x640 (start screen centred, 17.7 M
instructions/s). `?w=&h=` overrides. **A touch shell landed the same
morning**: movement and command pads over the canvas on coarse-pointer
devices, a held-keys map released on blur/hide/cancel, a 160 ms minimum
click dwell so a tap passes `StillDown`, draggable pads that remember their
place, and a hidden input that raises the phone keyboard and types into the
game. **Nobody has touched it on a phone yet** — that is the first thing to
ask the maintainer about; the design questions (does the dwell suit, are the
pads in the game's way, does the keyboard reach the name field) are all his.
Pages is set to `gh-pages` root and the site is live at
`https://ratlizard.github.io/alchemy/`. *(The three Pages states in this
section — not enabled, branch deploy, live at `/alchemy/` — are in the order
they happened; Pages is off on alchemy since 8 September.)* **Saves persist**
(same morning): the
binding splits boot into load and start so stored files go onto the disk
before the game looks, and offers changed files through a scan / read /
acknowledge cycle filtered like the desktop store but stricter under
Preferences (only `Cythera Preferences`; not the licence record or the log).
The page keeps them in IndexedDB per game source, restores on boot, scans
every two seconds and on hide, and has a Saves panel: characters listed,
export and import as MacBinary, delete. `web/www/saves_smoke.mjs` proves
the cycle under Node. **The maintainer's first iOS try showed nothing after
Play**: the module was still compiling and the buttons were live, and the
failure was silent. Buttons now wait for the module and every error prints
on the page. **Second phone try: the game runs at ~22 M instructions/s
(real time needs 25, so about 10% slow), the start screen was reached and
tapped through; no sound, and the boot felt long.** Fixed the same hour: the
audio context is now made inside the tap (iOS refuses one made later), and
the first 80M instructions of the boot run unpaced (`?ff=` overrides) so the
start screen arrives in about four seconds instead of sixteen. A Log button
shows the page's log while playing. Not yet confirmed on the phone. **The
game's menus are reachable** (`f536048`): the runner's menu snapshot drawn
as a panel, a choice routed through the guest's own MenuSelect, so Save,
Save As, Backup As, Revert, Preferences and Quit need no key chord;
`web/www/menus_smoke.mjs` proves it under Node. **A Cheats panel followed on the
afternoon of 5 September** (`e428d05`), at the maintainer's request: the
game's own cheat mode (`cythera-workbench/doc/cythera_keys.md` § Cheat keys)
needs bit 0 of the fourth UI Prefs byte, which nothing in the game sets; the
page sets it in the stored preference file's resource fork and reloads, types
`©gra` (then `M`), and offers the sixteen cheat keys as buttons sent as
their Mac Roman characters with option held. Proven natively first
(`Cheat mode activated.`, position `01d, 01b`). **Also this afternoon: the
audio question is still open** — the phone's audio context runs, Music is on
in the dialog, the module plays under Node with and without restored
preferences, and the phone mixes zero samples; the page now logs a `sound
path:` line (channels, components, tune players, queue) and the next
screenshot of it decides where the chain breaks. **Loads were a 15–20 s black
screen on the phone** (`06b7bab`): a save is ~110M instructions with nothing
drawn, and the wall-clock loop gave the guest 60% of the device; a third of
a second behind, the page now runs the guest unpaced for most of each frame
and re-bases the clock on the guest tick when it catches up. That closes the feature
list the feasibility addendum gave the page. **The maintainer's third phone
try (Chrome on iOS) turned up four things**, all answered the same
afternoon: the pads had never worked (a `const` key table declared below
the touch code that read it at load — a TDZ error the parse check could not
see; `web/www/page_smoke.mjs` now executes the script and would have caught
it); the browser had cached the old module against the new page (the module
URL now carries the build); fades stepped and play was slow (the phone gives
~21 M instructions/s against the profile's 25; cycles per tick now follow
the device at 90% of measured, and the frame budget widens when behind);
and **no sound, root-caused from the fourth screenshot**: the audio context
was running and zero samples had been pushed — a guest already at its tick
deadline returns from `run_gui_slice_with_audio` before the frame is
finished, so the audio budget it was handed was never mixed, and on a phone
that keeps up with the clock that is every frame. The desktop runner mixes
what its CPU loop did not consume; `cw_mix_audio` is that call and the page
makes it once a frame (`d6c62f8`'s successor). `audio_smoke.mjs` drives the
page's own loop shape and hears the theme from tick 959. The fourth
screenshot also showed the start screen up, the pads over it, four saves
restored and the guest exactly on the clock at 352k cycles/tick.

`port/smoke.sh` still has not been run since the 3 September vendoring fix.
Run it when convenient and confirm **ten** invariants. **Low priority**, said
the maintainer on 8 September: alchemy is an archive and nothing depends on
it; the item stays so it can be revisited, not because it is pressing.

## What to do next

Item numbers are the ones the workspace handoff used up to 8 September 2026, kept so that references in the docs still resolve.

0c. **Phone testing — mostly answered on 7 September; what is left is at the
   end.** (0) **The runner fix** (`246b4c4`): the game's main loop sleeps
   3 ticks in WaitNextEvent with a cooperative thread ready every single time
   (75,209 of 75,209 in the probe), and the runner idled that sleep away —
   advancing the clock and running no guest code. On the paced path that
   spent whole frames doing nothing, which is why a load never finished
   there. Now the sleep is skipped when a thread is ready. Probe unchanged
   frame, guest clock 347,512 → 127,841 ticks, DrawPicture 21,635 → 498,
   probe 84 s → 33 s. A follow-up that spent the sleep a tick at a time
   instead (`de1fc52`) was **reverted** — it cost the probe 3x and the idle
   it protected was a measuring artefact. (a) ~~**Sound**~~ **Found and fixed on the page,
   6 September** (alchemy, "web: sound on the phone…"): `pushAudio` asked
   `cw_audio_len` before draining, read zero on the first frame and never
   drained; the runner had 193,494 samples buffered and the page pushed
   none. (b) **The ten-second freeze on load is bounded**, same commit:
   the catch-up branch's one uncapped headless call skipped ~8,500 ticks of
   guest clock and ran the interrupt tasks for each; capped at 120 ticks a
   call now. **The cause is the runner's**: WaitNextEvent sleeps and
   TickCount spins are skipped whole while the game's loader thread waits
   for a yield (tick sources: wne_sleep 225,621 + spin_fastfwd 110,265 of
   346,912 in the probe) — `cythera-workbench/doc/SYSTEMLESS-NEXT.md`
   *Task H* has the numbers; the fix is `246b4c4` under (0), in and
   settled. **Ask the maintainer**: after the fix, does music play,
   how long does a load take, and does the Log say "caught up after 1
   frames" after it. (c) Frames and dragging on the phone. (d) Whether
   saves survive closing the browser, and whether the keyboard reaches the
   name field. **(e) Still open after 7 September, and all he can answer**:
   do the reworked instruments sound better than the old ones (two 45-second
   renders were sent for comparison, and a third with a library recording);
   does a load still feel like a wait now the page runs unpaced through a
   black screen; and does a tap-and-drag on the map window's frame recover in
   a real session, where the release comes from the host rather than from an
   instruction count — headless it deadlocks (Task I).

